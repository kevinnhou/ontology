import gzip
import json
import logging
import re
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

import cv2
import httpx
import numpy as np
import supervision as sv
from ultralytics import YOLO

from .analytics import build_analytics
from .client import ConvexCallbackClient, NoOpPipelineClient, PipelineClient
from .schemas import CropRect, ProcessRequest
from .shots import RobotState, ShotDetector
from .telemetry.collector import TelemetryCollector, peak_rss_bytes
from .telemetry.models import TelemetrySnapshot
from .tracking import RobotTracker

logger = logging.getLogger(__name__)

_PROGRESS_INTERVAL_SECONDS = 1.0
_PATH_SAMPLE_BUCKET_MS = 5000
_ROBOT_CONFIDENCE_THRESHOLD = 0.40
_FUEL_CONFIDENCE_THRESHOLD = 0.35
_PREDICT_CONFIDENCE = _FUEL_CONFIDENCE_THRESHOLD
_MIN_IMGSZ = 640
_MAX_IMGSZ = 1280
_MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "frc2026.pt"

DEFAULT_CROP = CropRect(x=0.0, y=0.12, w=1.0, h=0.63)

_ROBOT_LABELS = {"robot"}
_FUEL_LABELS = {"fuel"}
_URL_PATTERN = re.compile(r"https?://[^\s)]+")


@dataclass(frozen=True, slots=True)
class PipelineResult:
    completed: bool
    processed_frames: int
    total_frames: int
    timings: dict[str, float] = field(default_factory=dict)
    peak_memory_mb: float | None = None
    telemetry: TelemetrySnapshot | None = None
    error: str | None = None
    failure_status: str | None = None


@dataclass(frozen=True, slots=True)
class _BufferedFrame:
    cropped: np.ndarray
    crop_px: tuple[int, int, int, int]
    frame_size: tuple[int, int]
    frame_index: int
    timestamp_ms: float
    dt_seconds: float


class _DetectionArtifactWriter:
    def __init__(
        self,
        path: Path,
        frame_stride: int,
        telemetry: TelemetryCollector | None = None,
    ) -> None:
        self._file = gzip.open(path, "wt", encoding="utf-8", compresslevel=6)
        self._telemetry = telemetry
        self._file.write(f'{{"version":1,"frameStride":{frame_stride},"frames":[')
        self._first_frame = True

    def write(self, frame: dict[str, Any]) -> None:
        if not self._first_frame:
            self._file.write(",")
        self._file.write(json.dumps(frame, separators=(",", ":")))
        self._first_frame = False

    def close(self) -> None:
        if self._telemetry is None:
            self._file.write("]}")
            self._file.close()
            return
        with self._telemetry.measure_stage("artifact_finalisation"):
            self._file.write("]}")
            self._file.close()

    def __enter__(self) -> "_DetectionArtifactWriter":
        return self

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        self.close()


class _PathSampleCollector:
    def __init__(self) -> None:
        self._bucket_points: dict[int, list[dict[str, Any]]] = {}

    def add_frame(self, frame: dict[str, Any]) -> None:
        timestamp_ms = frame["timestampMs"]
        bucket_index = int(timestamp_ms // _PATH_SAMPLE_BUCKET_MS)
        for detection in frame["detections"]:
            if detection["label"] != "robot":
                continue
            bbox = detection["bbox"]
            point = {
                "x": bbox["x"] + bbox["w"] / 2,
                "y": bbox["y"] + bbox["h"] / 2,
                "timestampMs": timestamp_ms,
            }
            alliance = detection.get("alliance")
            if alliance is not None:
                point["alliance"] = alliance
            self._bucket_points.setdefault(bucket_index, []).append(point)

    def build(self) -> list[dict[str, Any]]:
        return [
            {"bucketIndex": bucket_index, "points": points}
            for bucket_index, points in sorted(self._bucket_points.items())
        ]


def load_model(model_path: Path | None = None) -> YOLO:
    return YOLO(model_path or _MODEL_PATH)


def safe_error_message(error: BaseException) -> str:
    message = str(error).strip()
    message = _URL_PATTERN.sub("[redacted-url]", message)
    if not message:
        message = "pipeline failed"
    return f"{type(error).__name__}: {message}"[:500]


def _download_video(url: str, destination: Path) -> None:
    with (
        httpx.stream("GET", url, timeout=httpx.Timeout(120.0)) as response,
        destination.open("wb") as file,
    ):
        response.raise_for_status()
        for chunk in response.iter_bytes(chunk_size=1 << 20):
            file.write(chunk)


def _normalise_ranges(
    ranges: list[tuple[float, float]],
    duration_ms: float,
) -> list[tuple[float, float]]:
    bounded = [(max(0.0, start_ms), min(duration_ms, end_ms)) for start_ms, end_ms in ranges]
    valid = [(start_ms, end_ms) for start_ms, end_ms in bounded if end_ms >= start_ms]
    valid.sort()

    merged: list[tuple[float, float]] = []
    for start_ms, end_ms in valid:
        if not merged or start_ms > merged[-1][1]:
            merged.append((start_ms, end_ms))
            continue
        previous_start, previous_end = merged[-1]
        merged[-1] = (previous_start, max(previous_end, end_ms))
    return merged


def _sample_plan(
    ranges: list[tuple[float, float]],
    fps: float,
    total_frames: int,
    stride: int,
) -> list[range]:
    if not ranges:
        ranges = [(0.0, (total_frames / fps) * 1000 if fps > 0 else 0.0)]
    else:
        ranges = _normalise_ranges(
            ranges,
            (total_frames / fps) * 1000 if fps > 0 else 0.0,
        )

    plan: list[range] = []
    for start_ms, end_ms in ranges:
        first = max(0, int(round((start_ms / 1000) * fps)))
        last = min(total_frames - 1, int(round((end_ms / 1000) * fps)))
        if last < first:
            continue
        group = range(first, last + 1, stride)
        if len(group) > 0:
            plan.append(group)
    return plan


def _split_detections(
    result: Any, names: dict[int, str]
) -> tuple[sv.Detections, list[tuple[float, float, float, float, float]]]:
    detections = sv.Detections.from_ultralytics(result)
    class_ids = detections.class_id
    confidences = detections.confidence
    if class_ids is None or confidences is None:
        return sv.Detections.empty(), []

    robot_mask = np.array(
        [
            names.get(int(class_id), "").lower() in _ROBOT_LABELS
            and confidence > _ROBOT_CONFIDENCE_THRESHOLD
            for class_id, confidence in zip(class_ids, confidences, strict=True)
        ],
        dtype=bool,
    )
    robots = cast(sv.Detections, detections[robot_mask])

    fuel: list[tuple[float, float, float, float, float]] = []
    for index in range(len(detections)):
        label = names.get(int(class_ids[index]), "").lower()
        confidence = float(confidences[index])
        if label in _FUEL_LABELS and confidence > _FUEL_CONFIDENCE_THRESHOLD:
            x1, y1, x2, y2 = (float(v) for v in detections.xyxy[index])
            fuel.append((x1, y1, x2, y2, confidence))

    return robots, fuel


def _compute_path_samples(frames: list[dict[str, Any]]) -> list[dict[str, Any]]:
    collector = _PathSampleCollector()
    for frame in frames:
        collector.add_frame(frame)
    return collector.build()


def run_pipeline(
    request: ProcessRequest,
    *,
    model: YOLO | None = None,
    http_client: httpx.Client | None = None,
    callback_secret: str | None = None,
    telemetry: TelemetryCollector | None = None,
    model_path: Path | None = None,
) -> PipelineResult:
    pipeline_telemetry = telemetry or TelemetryCollector()
    client = ConvexCallbackClient(
        request.callbackUrl,
        request.matchId,
        request.jobId,
        request.runId,
        http_client=http_client,
        secret=callback_secret,
    )
    return _execute_pipeline(
        request,
        client,
        model=model,
        telemetry=pipeline_telemetry,
        model_path=model_path,
    )


def run_local_pipeline(
    request: ProcessRequest,
    video_path: Path,
    *,
    model: YOLO | None = None,
    client: PipelineClient | None = None,
    telemetry: TelemetryCollector | None = None,
    artifact_path: Path | None = None,
    model_path: Path | None = None,
) -> PipelineResult:
    """Run the pipeline from a local video without requiring remote services."""
    pipeline_client = client or NoOpPipelineClient()
    pipeline_telemetry = telemetry or TelemetryCollector()
    return _execute_pipeline(
        request,
        pipeline_client,
        model=model,
        telemetry=pipeline_telemetry,
        video_path=video_path,
        artifact_path=artifact_path,
        model_path=model_path,
    )


def _execute_pipeline(
    request: ProcessRequest,
    client: PipelineClient,
    *,
    model: YOLO | None,
    telemetry: TelemetryCollector,
    video_path: Path | None = None,
    artifact_path: Path | None = None,
    model_path: Path | None = None,
) -> PipelineResult:
    try:
        _run(
            request,
            client,
            model,
            telemetry,
            video_path=video_path,
            artifact_path=artifact_path,
            model_path=model_path,
        )
        telemetry.set_value("peakRssBytes", peak_rss_bytes())
        snapshot = telemetry.snapshot()
        result = PipelineResult(
            completed=True,
            processed_frames=client.processed_frames,
            total_frames=client.total_frames,
            timings={name: stats.total_seconds for name, stats in snapshot.stages.items()},
            peak_memory_mb=_peak_memory_mb_from_snapshot(snapshot),
            telemetry=snapshot,
        )
        telemetry_json = json.dumps(
            snapshot.to_dict(),
            separators=(",", ":"),
            sort_keys=True,
        )
        logger.info(
            "vision pipeline metrics match_id=%s job_id=%s run_id=%s "
            "processed_frames=%d total_frames=%d peak_memory_mb=%.1f telemetry=%s",
            request.matchId,
            request.jobId,
            request.runId,
            result.processed_frames,
            result.total_frames,
            result.peak_memory_mb or 0.0,
            telemetry_json,
        )
        return result
    except Exception as error:
        telemetry.set_value("peakRssBytes", peak_rss_bytes())
        snapshot = telemetry.snapshot()
        safe_error = safe_error_message(error)
        logger.error(
            "pipeline failed for match %s (job %s, run %s): %s",
            request.matchId,
            request.jobId,
            request.runId,
            safe_error,
        )
        failure_status = client.push_failed(safe_error)
        return PipelineResult(
            completed=False,
            processed_frames=client.processed_frames,
            total_frames=client.total_frames,
            timings={name: stats.total_seconds for name, stats in snapshot.stages.items()},
            peak_memory_mb=_peak_memory_mb_from_snapshot(snapshot),
            telemetry=snapshot,
            error=safe_error,
            failure_status=failure_status,
        )
    finally:
        client.close()


def _run(
    request: ProcessRequest,
    client: PipelineClient,
    model: YOLO | None = None,
    telemetry: TelemetryCollector | None = None,
    *,
    video_path: Path | None = None,
    artifact_path: Path | None = None,
    model_path: Path | None = None,
) -> None:
    pipeline_telemetry = telemetry or TelemetryCollector()
    if model is None:
        with pipeline_telemetry.measure_stage("model_load"):
            inference_model = load_model(model_path)
    else:
        inference_model = model
    names: dict[int, str] = inference_model.names if isinstance(inference_model.names, dict) else {}

    with tempfile.TemporaryDirectory() as temp_dir:
        source_path = video_path
        if source_path is None:
            source_path = Path(temp_dir) / "match.mp4"
            with pipeline_telemetry.measure_stage("download"):
                _download_video(request.videoUrl, source_path)

        with pipeline_telemetry.measure_stage("capture_open"):
            capture = cv2.VideoCapture(str(source_path))
        if not capture.isOpened():
            raise RuntimeError("Could not open downloaded video")

        try:
            _process_capture(
                capture,
                inference_model,
                names,
                request,
                client,
                artifact_path or Path(temp_dir) / "detections.json.gz",
                pipeline_telemetry,
            )
        finally:
            capture.release()


def _peak_memory_mb_from_snapshot(snapshot: TelemetrySnapshot) -> float | None:
    peak_bytes = snapshot.values.get("peakRssBytes")
    if not isinstance(peak_bytes, (int, float)) or isinstance(peak_bytes, bool):
        return None
    return float(peak_bytes) / (1024 * 1024)


def _finalise_shot_alliances(
    shot_events: list[dict[str, Any]],
    tracker: RobotTracker,
) -> None:
    for event in shot_events:
        track_id = event.get("trackId")
        if track_id is None:
            continue
        alliance = tracker.alliance_for_track(int(track_id))
        if alliance != "unknown":
            event["alliance"] = alliance


def _process_capture(
    capture: cv2.VideoCapture,
    model: YOLO,
    names: dict[int, str],
    request: ProcessRequest,
    client: PipelineClient,
    artifact_path: Path,
    metrics: TelemetryCollector,
) -> None:
    fps = capture.get(cv2.CAP_PROP_FPS) or 0.0
    if fps <= 0:
        fps = request.fps or 30.0
    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    frame_width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    metrics.update_values(
        {
            "sourceFrames": total_frames,
            "videoFps": fps,
            "videoWidth": frame_width,
            "videoHeight": frame_height,
        }
    )

    crop = request.crop or DEFAULT_CROP
    crop_x = int(crop.x * frame_width)
    crop_y = int(crop.y * frame_height)
    crop_w = max(1, int(crop.w * frame_width))
    crop_h = max(1, int(crop.h * frame_height))

    plan = _sample_plan(
        [(r.startMs, r.endMs) for r in request.ranges],
        fps,
        total_frames,
        request.frameStride,
    )
    total_samples = sum(len(group) for group in plan)
    if total_samples == 0:
        raise RuntimeError("No frames selected for processing")

    imgsz = int(min(_MAX_IMGSZ, max(_MIN_IMGSZ, round(crop_w / 32) * 32)))

    tracker = RobotTracker(fps=fps / request.frameStride)
    shot_detector = ShotDetector()

    processed = 0
    path_collector = _PathSampleCollector()
    with metrics.measure_stage("callbacks"):
        client.push_progress(0, total_samples)
    client.total_frames = total_samples
    metrics.set_value("totalFrames", total_samples)

    with _DetectionArtifactWriter(
        artifact_path,
        request.frameStride,
        telemetry=metrics,
    ) as artifact_writer:
        last_progress_at = 0.0

        def emit_batch(batch: list[_BufferedFrame]) -> None:
            nonlocal last_progress_at, processed
            if not batch:
                return

            frame_results = _process_frame_batch(
                batch,
                model,
                names,
                tracker,
                shot_detector,
                imgsz,
                metrics,
            )
            for frame_result in frame_results:
                with metrics.measure_stage("serialisation"):
                    artifact_writer.write(frame_result)
                    path_collector.add_frame(frame_result)
                processed += 1

            now = time.monotonic()
            if processed == total_samples or now - last_progress_at >= _PROGRESS_INTERVAL_SECONDS:
                with metrics.measure_stage("callbacks"):
                    client.push_progress(processed, total_samples)
                last_progress_at = now

        finalised_event_count = 0
        for group_index, group in enumerate(plan):
            if group_index > 0:
                _finalise_shot_alliances(
                    shot_detector.events[finalised_event_count:],
                    tracker,
                )
                finalised_event_count = len(shot_detector.events)
                tracker.reset()
                shot_detector.reset()

            previous_sample_frame: int | None = None
            batch: list[_BufferedFrame] = []
            first_frame = group[0]
            capture.set(cv2.CAP_PROP_POS_FRAMES, first_frame)
            current = first_frame
            last_frame = group[-1]
            targets = iter(group)
            target = next(targets, None)

            while current <= last_frame and target is not None:
                decode_started = time.perf_counter()
                grabbed = capture.grab()
                if not grabbed:
                    break
                if current == target:
                    ok, frame = capture.retrieve()
                    metrics.record_duration(
                        "decode",
                        time.perf_counter() - decode_started,
                    )
                    if ok:
                        timestamp_ms = (current / fps) * 1000
                        dt_seconds = (
                            (current - previous_sample_frame) / fps
                            if previous_sample_frame is not None
                            else request.frameStride / fps
                        )
                        batch.append(
                            _BufferedFrame(
                                cropped=frame[
                                    crop_y : crop_y + crop_h,
                                    crop_x : crop_x + crop_w,
                                ],
                                crop_px=(crop_x, crop_y, crop_w, crop_h),
                                frame_size=(frame_width, frame_height),
                                frame_index=current,
                                timestamp_ms=timestamp_ms,
                                dt_seconds=dt_seconds,
                            )
                        )
                        previous_sample_frame = current
                        if len(batch) >= request.inferenceBatchSize:
                            emit_batch(batch)
                            batch.clear()
                    else:
                        metrics.increment("decodeFailures")
                    target = next(targets, None)
                else:
                    metrics.record_duration(
                        "decode",
                        time.perf_counter() - decode_started,
                    )
                current += 1
            emit_batch(batch)

    with metrics.measure_stage("callbacks"):
        client.push_progress(processed, total_samples)
    metrics.set_value("processedFrames", processed)
    shot_events = shot_detector.events
    _finalise_shot_alliances(shot_events[finalised_event_count:], tracker)
    processed_duration_ms = sum(
        max(request.frameStride, group[-1] - group[0] + request.frameStride) / fps * 1000
        for group in plan
    )
    with metrics.measure_stage("analytics"):
        analytics = build_analytics(shot_events, processed, processed_duration_ms)
    with metrics.measure_stage("path_aggregation"):
        path_samples = path_collector.build()
    with metrics.measure_stage("upload"):
        client.upload_detections_file(request.detectionsUploadUrl, artifact_path)
    metrics.set_value("artifactCompressedBytes", artifact_path.stat().st_size)
    with metrics.measure_stage("callbacks"):
        client.push_complete(shot_events, analytics, path_samples)
    metrics.set_value("shotEvents", len(shot_events))
    metrics.set_value("pathSamples", sum(len(bucket["points"]) for bucket in path_samples))


def _process_frame_batch(
    frames: list[_BufferedFrame],
    model: YOLO,
    names: dict[int, str],
    tracker: RobotTracker,
    shot_detector: ShotDetector,
    imgsz: int,
    metrics: TelemetryCollector,
) -> list[dict[str, Any]]:
    inference_started = time.perf_counter()
    results = model.predict(
        [frame.cropped for frame in frames],
        verbose=False,
        imgsz=imgsz,
        conf=_PREDICT_CONFIDENCE,
    )
    metrics.record_duration(
        "inference",
        time.perf_counter() - inference_started,
    )
    if len(results) != len(frames):
        raise RuntimeError("Model returned an unexpected number of frame results")

    return [
        _process_frame(
            frame.cropped,
            frame.crop_px,
            frame.frame_size,
            frame.frame_index,
            frame.timestamp_ms,
            model,
            names,
            tracker,
            shot_detector,
            frame.dt_seconds,
            imgsz,
            metrics,
            prediction=result,
        )
        for frame, result in zip(frames, results, strict=True)
    ]


def _process_frame(
    cropped: np.ndarray,
    crop_px: tuple[int, int, int, int],
    frame_size: tuple[int, int],
    frame_index: int,
    timestamp_ms: float,
    model: YOLO,
    names: dict[int, str],
    tracker: RobotTracker,
    shot_detector: ShotDetector,
    dt_seconds: float,
    imgsz: int,
    metrics: TelemetryCollector | None = None,
    prediction: Any | None = None,
) -> dict[str, Any]:
    crop_x, crop_y, _crop_w, _crop_h = crop_px
    frame_width, frame_height = frame_size

    if prediction is None:
        inference_started = time.perf_counter()
        result = model.predict(
            cropped,
            verbose=False,
            imgsz=imgsz,
            conf=_PREDICT_CONFIDENCE,
        )[0]
        if metrics is not None:
            metrics.record_duration(
                "inference",
                time.perf_counter() - inference_started,
            )
    else:
        result = prediction
    robots, fuel = _split_detections(result, names)

    tracking_started = time.perf_counter()
    tracked_robots, alliances = tracker.update(robots, cropped)
    if metrics is not None:
        metrics.record_duration(
            "robot_tracking",
            time.perf_counter() - tracking_started,
        )
        metrics.increment("robotDetections", len(robots))
        metrics.increment("fuelDetections", len(fuel))

    def to_full_norm_bbox(xyxy: np.ndarray) -> dict[str, float]:
        x1, y1, x2, y2 = (float(value) for value in xyxy)
        return {
            "x": (x1 + crop_x) / frame_width,
            "y": (y1 + crop_y) / frame_height,
            "w": (x2 - x1) / frame_width,
            "h": (y2 - y1) / frame_height,
        }

    detections: list[dict[str, Any]] = []
    robot_states: list[RobotState] = []
    confidences = tracked_robots.confidence
    if confidences is None:
        confidences = np.zeros(len(tracked_robots), dtype=float)

    for index in range(len(tracked_robots)):
        bbox = to_full_norm_bbox(tracked_robots.xyxy[index])
        tracker_ids = tracked_robots.tracker_id
        track_id = int(tracker_ids[index]) if tracker_ids is not None else None
        alliance = alliances[index]
        detections.append(
            {
                "label": "robot",
                "confidence": float(confidences[index]),
                "bbox": bbox,
                "trackId": track_id,
                "alliance": alliance,
            }
        )
        robot_states.append(
            RobotState(
                track_id=track_id,
                alliance=alliance,
                bbox=(bbox["x"], bbox["y"], bbox["w"], bbox["h"]),
            )
        )

    fuel_centers: list[tuple[float, float]] = []
    for x1, y1, x2, y2, confidence in fuel:
        bbox = {
            "x": (x1 + crop_x) / frame_width,
            "y": (y1 + crop_y) / frame_height,
            "w": (x2 - x1) / frame_width,
            "h": (y2 - y1) / frame_height,
        }
        fuel_centers.append((bbox["x"] + bbox["w"] / 2, bbox["y"] + bbox["h"] / 2))
        detections.append(
            {
                "label": "fuel",
                "confidence": confidence,
                "bbox": bbox,
            }
        )

    shot_started = time.perf_counter()
    shot_detector.update(frame_index, timestamp_ms, fuel_centers, robot_states, dt_seconds)
    if metrics is not None:
        metrics.record_duration(
            "fuel_tracking",
            time.perf_counter() - shot_started,
        )

    return {
        "frameIndex": frame_index,
        "timestampMs": timestamp_ms,
        "detections": detections,
    }
