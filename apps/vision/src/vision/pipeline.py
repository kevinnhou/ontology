import gzip
import json
import logging
import tempfile
from pathlib import Path
from typing import Any, cast

import cv2
import httpx
import numpy as np
import supervision as sv
from ultralytics import YOLO

from .analytics import build_analytics
from .client import ConvexCallbackClient
from .schemas import CropRect, ProcessRequest
from .shots import RobotState, ShotDetector
from .tracking import RobotTracker

logger = logging.getLogger(__name__)

_PROGRESS_INTERVAL = 25
_PATH_SAMPLE_BUCKET_MS = 5000
_ROBOT_CONFIDENCE_THRESHOLD = 0.40
_FUEL_CONFIDENCE_THRESHOLD = 0.35
_PREDICT_CONFIDENCE = 0.25
_MIN_IMGSZ = 640
_MAX_IMGSZ = 1280

DEFAULT_CROP = CropRect(x=0.0, y=0.12, w=1.0, h=0.63)

_ROBOT_LABELS = {"robot"}
_FUEL_LABELS = {"fuel"}


def _model_path() -> Path:
    return Path(__file__).resolve().parents[2] / "models" / "frc2026.pt"


def _download_video(url: str, destination: Path) -> None:
    with (
        httpx.stream("GET", url, timeout=httpx.Timeout(120.0)) as response,
        destination.open("wb") as file,
    ):
        response.raise_for_status()
        for chunk in response.iter_bytes(chunk_size=1 << 20):
            file.write(chunk)


def _sample_plan(
    ranges: list[tuple[float, float]],
    fps: float,
    total_frames: int,
    stride: int,
) -> list[list[int]]:
    if not ranges:
        ranges = [(0.0, (total_frames / fps) * 1000 if fps > 0 else 0.0)]

    plan: list[list[int]] = []
    for start_ms, end_ms in ranges:
        first = max(0, int(round((start_ms / 1000) * fps)))
        last = min(total_frames - 1, int(round((end_ms / 1000) * fps)))
        if last < first:
            continue
        plan.append(list(range(first, last + 1, stride)))
    return [group for group in plan if group]


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
    bucket_points: dict[int, list[dict[str, Any]]] = {}
    for frame in frames:
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
            bucket_points.setdefault(bucket_index, []).append(point)

    return [
        {"bucketIndex": bucket_index, "points": points}
        for bucket_index, points in sorted(bucket_points.items())
    ]


def _upload_detection_artifact(
    request: ProcessRequest,
    client: ConvexCallbackClient,
    frames: list[dict[str, Any]],
) -> None:
    artifact = {
        "version": 1,
        "frameStride": request.frameStride,
        "frames": frames,
    }
    gzipped = gzip.compress(json.dumps(artifact).encode("utf-8"))
    client.upload_detections(request.detectionsUploadUrl, gzipped)


def run_pipeline(request: ProcessRequest) -> None:
    client = ConvexCallbackClient(request.callbackUrl, request.matchId)
    try:
        _run(request, client)
    except Exception as error:
        logger.exception("vision pipeline failed for match %s", request.matchId)
        client.push_failed(str(error))


def _run(request: ProcessRequest, client: ConvexCallbackClient) -> None:
    model = YOLO(_model_path())
    names: dict[int, str] = model.names if isinstance(model.names, dict) else {}

    with tempfile.TemporaryDirectory() as temp_dir:
        video_path = Path(temp_dir) / "match.mp4"
        _download_video(request.videoUrl, video_path)

        capture = cv2.VideoCapture(str(video_path))
        if not capture.isOpened():
            raise RuntimeError("Could not open downloaded video")

        try:
            _process_capture(capture, model, names, request, client)
        finally:
            capture.release()


def _process_capture(
    capture: cv2.VideoCapture,
    model: YOLO,
    names: dict[int, str],
    request: ProcessRequest,
    client: ConvexCallbackClient,
) -> None:
    fps = capture.get(cv2.CAP_PROP_FPS) or 0.0
    if fps <= 0:
        fps = request.fps or 30.0
    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    frame_width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))

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
    dt_seconds = request.frameStride / fps

    processed = 0
    all_frames: list[dict[str, Any]] = []
    client.push_progress(0, total_samples)

    for group in plan:
        first_frame = group[0]
        capture.set(cv2.CAP_PROP_POS_FRAMES, first_frame)
        wanted = set(group)
        current = first_frame
        last_frame = group[-1]

        while current <= last_frame:
            grabbed = capture.grab()
            if not grabbed:
                break
            if current in wanted:
                ok, frame = capture.retrieve()
                if ok:
                    timestamp_ms = (current / fps) * 1000
                    frame_result = _process_frame(
                        frame[crop_y : crop_y + crop_h, crop_x : crop_x + crop_w],
                        (crop_x, crop_y, crop_w, crop_h),
                        (frame_width, frame_height),
                        current,
                        timestamp_ms,
                        model,
                        names,
                        tracker,
                        shot_detector,
                        dt_seconds,
                        imgsz,
                    )
                    all_frames.append(frame_result)
                    processed += 1

                    if processed % _PROGRESS_INTERVAL == 0:
                        client.push_progress(processed, total_samples)
            current += 1

    client.push_progress(processed, total_samples)

    shot_events = shot_detector.events
    for event in shot_events:
        track_id = event.get("trackId")
        if track_id is not None:
            event["alliance"] = tracker.alliance_for_track(int(track_id))

    processed_duration_ms = sum((group[-1] - group[0]) / fps * 1000 for group in plan)
    analytics = build_analytics(shot_events, processed, processed_duration_ms)
    path_samples = _compute_path_samples(all_frames)
    _upload_detection_artifact(request, client, all_frames)
    client.push_complete(shot_events, analytics, path_samples)


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
) -> dict[str, Any]:
    crop_x, crop_y, _crop_w, _crop_h = crop_px
    frame_width, frame_height = frame_size

    result = model.predict(cropped, verbose=False, imgsz=imgsz, conf=_PREDICT_CONFIDENCE)[0]
    robots, fuel = _split_detections(result, names)
    tracked_robots, alliances = tracker.update(robots, cropped)

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

    shot_detector.update(frame_index, timestamp_ms, fuel_centers, robot_states, dt_seconds)

    return {
        "frameIndex": frame_index,
        "timestampMs": timestamp_ms,
        "detections": detections,
    }
