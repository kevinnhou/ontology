from __future__ import annotations

import argparse
import gzip
import json
import multiprocessing
import os
import tempfile
import time
import uuid
from contextlib import ExitStack
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from queue import Empty
from typing import TypedDict, cast

os.environ.setdefault(
    "MPLCONFIGDIR",
    str(Path(tempfile.gettempdir()) / "vision-matplotlib"),
)

from ultralytics import YOLO

from vision.benchmarks.integration import local_integration_server
from vision.client import NoOpPipelineClient, PipelineClient
from vision.pipeline import load_model, run_local_pipeline
from vision.schemas import CropRect, ProcessRequest, TimeRange
from vision.telemetry.collector import (
    TelemetryCollector,
    collect_environment,
    file_fingerprint,
    git_provenance,
    peak_rss_bytes,
    process_cpu_seconds,
)
from vision.telemetry.models import JsonValue, RunRecord
from vision.telemetry.output import JsonlWriter, read_jsonl, write_json
from vision.telemetry.summary import build_summary


class BenchmarkPayload(TypedDict):
    video_path: str
    model_path: str
    repository: str
    variant: str
    benchmark_kind: str
    mode: str
    frame_stride: int
    inference_batch_size: int
    ranges: list[tuple[float, float]]
    crop: dict[str, float] | None
    repetition: int
    warmup: bool
    integration_latency_seconds: float
    integration_retryable_failures: int


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _prepare_model_and_timing(
    mode: str,
    model_path: Path,
) -> tuple[YOLO | None, str, float, float]:
    model = load_model(model_path) if mode == "warm" else None
    return model, _utc_now(), time.perf_counter(), process_cpu_seconds()


def _request(
    payload: BenchmarkPayload,
    *,
    callback_url: str = "local://callbacks",
    upload_url: str = "local://detections",
) -> ProcessRequest:
    return ProcessRequest(
        jobId=f"benchmark-{uuid.uuid4().hex}",
        runId=uuid.uuid4().hex,
        matchId="local-benchmark",
        videoUrl=f"file://{payload['video_path']}",
        callbackUrl=callback_url,
        detectionsUploadUrl=upload_url,
        frameStride=payload["frame_stride"],
        inferenceBatchSize=payload["inference_batch_size"],
        ranges=[
            TimeRange(startMs=start_ms, endMs=end_ms) for start_ms, end_ms in payload["ranges"]
        ],
        crop=(CropRect(**payload["crop"]) if payload["crop"] is not None else None),
    )


def _canonical_artifact(path: Path) -> dict[str, JsonValue]:
    with gzip.open(path, "rt", encoding="utf-8") as file:
        artifact = json.load(file)
    if not isinstance(artifact, dict):
        raise ValueError("detection artefact must be a JSON object")

    canonical = json.dumps(
        artifact,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    frames = artifact.get("frames")
    frame_count = len(frames) if isinstance(frames, list) else 0
    return {
        "artifactSchemaVersion": artifact.get("version"),
        "artifactCanonicalSha256": sha256(canonical).hexdigest(),
        "artifactCompressedSha256": file_fingerprint(path)["sha256"],
        "artifactFrameCount": frame_count,
    }


def _record(
    payload: BenchmarkPayload,
    *,
    started_at: str,
    finished_at: str,
    duration_seconds: float,
    telemetry: TelemetryCollector,
    client: PipelineClient,
    artifact_path: Path,
    completed: bool,
    error: str | None = None,
) -> RunRecord:
    snapshot = telemetry.snapshot()
    correctness: dict[str, JsonValue] = {}
    if artifact_path.exists():
        correctness.update(_canonical_artifact(artifact_path))
    shot_events = getattr(client, "shot_events", [])
    analytics = getattr(client, "analytics", {})
    path_samples = getattr(client, "path_samples", [])
    correctness.update(
        {
            "shotEventCount": len(shot_events),
            "pathSampleCount": sum(len(bucket.get("points", [])) for bucket in path_samples),
            "analytics": analytics,
        }
    )

    return RunRecord(
        run_id=uuid.uuid4().hex,
        benchmark_kind=payload["benchmark_kind"],
        variant=payload["variant"],
        status="completed" if completed else "failed",
        started_at=started_at,
        finished_at=finished_at,
        duration_seconds=duration_seconds,
        environment={
            **collect_environment(),
            **git_provenance(Path(payload["repository"])),
            "executionMode": payload["mode"],
            "warmup": payload["warmup"],
        },
        input=_input_fingerprints(payload),
        configuration=_configuration(payload),
        telemetry=snapshot,
        correctness=correctness,
        error=error,
    )


def _input_fingerprints(payload: BenchmarkPayload) -> dict[str, JsonValue]:
    return {
        "video": _safe_file_fingerprint(Path(payload["video_path"])),
        "model": _safe_file_fingerprint(Path(payload["model_path"])),
    }


def _safe_file_fingerprint(path: Path) -> dict[str, JsonValue]:
    try:
        return file_fingerprint(path)
    except OSError as error:
        return {
            "path": str(path),
            "error": f"{type(error).__name__}: {error}",
        }


def _configuration(payload: BenchmarkPayload) -> dict[str, JsonValue]:
    ranges: list[JsonValue] = [
        cast(
            JsonValue,
            {"startMs": start_ms, "endMs": end_ms},
        )
        for start_ms, end_ms in payload["ranges"]
    ]
    return {
        "frameStride": payload["frame_stride"],
        "inferenceBatchSize": payload["inference_batch_size"],
        "mode": payload["mode"],
        "ranges": ranges,
        "crop": cast(JsonValue, payload["crop"]),
        "repetition": payload["repetition"],
    }


def _failed_record(
    payload: BenchmarkPayload,
    *,
    started_at: str,
    duration_seconds: float,
    error: str,
) -> RunRecord:
    telemetry = TelemetryCollector()
    telemetry.update_values(
        {
            "wallTimeSeconds": duration_seconds,
            "processCpuSeconds": 0.0,
        }
    )
    return RunRecord(
        run_id=uuid.uuid4().hex,
        benchmark_kind=payload["benchmark_kind"],
        variant=payload["variant"],
        status="failed",
        started_at=started_at,
        finished_at=_utc_now(),
        duration_seconds=duration_seconds,
        environment={
            **collect_environment(),
            **git_provenance(Path(payload["repository"])),
            "executionMode": payload["mode"],
            "warmup": payload["warmup"],
        },
        input=_input_fingerprints(payload),
        configuration=_configuration(payload),
        telemetry=telemetry.snapshot(),
        correctness={},
        error=error,
    )


def _child_entry(
    payload: BenchmarkPayload,
    result_queue: multiprocessing.Queue[dict[str, JsonValue]],
) -> None:
    telemetry = TelemetryCollector()
    client: PipelineClient = NoOpPipelineClient()
    started_at = _utc_now()
    wall_started = time.perf_counter()
    cpu_started = process_cpu_seconds()

    try:
        video_path = Path(payload["video_path"])
        model_path = Path(payload["model_path"])
        with ExitStack() as stack:
            integration_server = None
            if payload["benchmark_kind"] == "local_integration":
                integration_server = stack.enter_context(
                    local_integration_server(
                        latency_seconds=payload["integration_latency_seconds"],
                        retryable_failures=payload["integration_retryable_failures"],
                    )
                )
                client = integration_server.client(
                    match_id="local-benchmark",
                    job_id=f"benchmark-{uuid.uuid4().hex}",
                    run_id=uuid.uuid4().hex,
                )
                request = _request(
                    payload,
                    callback_url=integration_server.base_url,
                    upload_url=f"{integration_server.base_url}/upload",
                )
            else:
                request = _request(payload)

            with tempfile.TemporaryDirectory(prefix="vision-benchmark-") as temp_dir:
                artifact_path = Path(temp_dir) / "detections.json.gz"
                model, started_at, wall_started, cpu_started = _prepare_model_and_timing(
                    payload["mode"],
                    model_path,
                )
                result = run_local_pipeline(
                    request,
                    video_path,
                    model=model,
                    model_path=model_path,
                    client=client,
                    telemetry=telemetry,
                    artifact_path=artifact_path,
                )
                if integration_server is not None:
                    integration_server.probe_control_plane(
                        job_id=request.jobId,
                        run_id=request.runId,
                    )
                    telemetry.update_values(integration_server.snapshot())
                duration_seconds = time.perf_counter() - wall_started
                telemetry.update_values(
                    {
                        "wallTimeSeconds": duration_seconds,
                        "processCpuSeconds": max(
                            0.0,
                            process_cpu_seconds() - cpu_started,
                        ),
                        "peakRssBytes": peak_rss_bytes(),
                        "processedFramesPerSecond": (
                            result.processed_frames / duration_seconds
                            if duration_seconds > 0
                            else 0.0
                        ),
                        "progressCalls": getattr(client, "progress_calls", 0),
                        "uploadedBytes": getattr(client, "uploaded_bytes", 0),
                    }
                )
                record = _record(
                    payload,
                    started_at=started_at,
                    finished_at=_utc_now(),
                    duration_seconds=duration_seconds,
                    telemetry=telemetry,
                    client=client,
                    artifact_path=artifact_path,
                    completed=result.completed,
                    error=result.error,
                )
                result_queue.put(record.to_dict())
    except BaseException as error:
        duration_seconds = time.perf_counter() - wall_started
        telemetry.update_values(
            {
                "wallTimeSeconds": duration_seconds,
                "processCpuSeconds": max(
                    0.0,
                    process_cpu_seconds() - cpu_started,
                ),
                "peakRssBytes": peak_rss_bytes(),
            }
        )
        with tempfile.TemporaryDirectory(prefix="vision-benchmark-error-") as temp_dir:
            record = _record(
                payload,
                started_at=started_at,
                finished_at=_utc_now(),
                duration_seconds=duration_seconds,
                telemetry=telemetry,
                client=client,
                artifact_path=Path(temp_dir) / "missing-artifact.json.gz",
                completed=False,
                error=f"{type(error).__name__}: {error}",
            )
            result_queue.put(record.to_dict())


def _run_child(
    payload: BenchmarkPayload,
    timeout_seconds: float,
) -> RunRecord:
    context = multiprocessing.get_context("spawn")
    result_queue: multiprocessing.Queue[dict[str, JsonValue]] = context.Queue()
    started_at = _utc_now()
    wall_started = time.perf_counter()
    process = context.Process(
        target=_child_entry,
        args=(payload, result_queue),
        name=f"vision-benchmark-{payload['repetition']}",
    )
    try:
        process.start()
        process.join(timeout_seconds)
        if process.is_alive():
            process.terminate()
            process.join()
            return _failed_record(
                payload,
                started_at=started_at,
                duration_seconds=time.perf_counter() - wall_started,
                error=f"benchmark run exceeded {timeout_seconds:.0f} seconds",
            )
        try:
            result = result_queue.get(timeout=1.0)
        except Empty:
            return _failed_record(
                payload,
                started_at=started_at,
                duration_seconds=time.perf_counter() - wall_started,
                error=(f"benchmark child exited without a result (exit code {process.exitcode})"),
            )
        return RunRecord.from_dict(result)
    finally:
        result_queue.close()
        result_queue.join_thread()


def _parse_ranges(values: list[str]) -> list[tuple[float, float]]:
    ranges: list[tuple[float, float]] = []
    for value in values:
        try:
            start, end = (float(part) for part in value.split(":", 1))
        except (TypeError, ValueError) as error:
            raise ValueError(f"invalid range {value!r}; expected START_MS:END_MS") from error
        if end < start:
            raise ValueError(f"range end must be >= start: {value!r}")
        ranges.append((start, end))
    return ranges


def _parse_crop(value: str | None) -> dict[str, float] | None:
    if value is None:
        return None
    try:
        x, y, width, height = (float(part) for part in value.split(":", 3))
    except (TypeError, ValueError) as error:
        raise ValueError("invalid crop; expected X:Y:W:H as normalised values") from error
    if min(x, y, width, height) < 0 or max(x, y, width, height) > 1 or width == 0 or height == 0:
        raise ValueError("crop values must be between zero and one with non-zero size")
    return {"x": x, "y": y, "w": width, "h": height}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run isolated local vision pipeline benchmarks.")
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument(
        "--model",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "models" / "frc2026.pt",
    )
    parser.add_argument("--output", type=Path, default=Path("benchmark-results"))
    parser.add_argument("--variant", default="candidate")
    parser.add_argument("--benchmark-kind", default="local_compute")
    parser.add_argument("--mode", choices=("cold", "warm", "both"), default="warm")
    parser.add_argument("--frame-stride", type=int, default=5)
    parser.add_argument(
        "--batch-size",
        action="append",
        type=int,
        dest="batch_sizes",
        help="Repeat for multiple batch sizes; defaults to 1.",
    )
    parser.add_argument("--warmups", type=int, default=1)
    parser.add_argument("--repetitions", type=int, default=3)
    parser.add_argument(
        "--range",
        action="append",
        default=[],
        dest="ranges",
        help="Analyse START_MS:END_MS; repeat for multiple ranges.",
    )
    parser.add_argument(
        "--crop",
        help="Crop X:Y:W:H using normalised coordinates.",
    )
    parser.add_argument("--timeout-seconds", type=float, default=1800.0)
    parser.add_argument("--integration-latency-ms", type=float, default=0.0)
    parser.add_argument("--integration-retryable-failures", type=int, default=0)
    return parser


def main() -> None:
    args = _parser().parse_args()
    video_path = args.video.expanduser().resolve()
    model_path = args.model.expanduser().resolve()
    if not video_path.is_file():
        raise SystemExit(f"video does not exist: {video_path}")
    if not model_path.is_file():
        raise SystemExit(f"model does not exist: {model_path}")
    if args.warmups < 0 or args.repetitions < 1:
        raise SystemExit("warmups must be >= 0 and repetitions must be >= 1")
    if args.frame_stride < 1:
        raise SystemExit("frame stride must be >= 1")
    if args.timeout_seconds <= 0:
        raise SystemExit("timeout must be > 0")
    if args.integration_latency_ms < 0 or args.integration_retryable_failures < 0:
        raise SystemExit("integration latency and failures must be >= 0")

    batch_sizes = args.batch_sizes or [1]
    if any(batch_size < 1 or batch_size > 32 for batch_size in batch_sizes):
        raise SystemExit("batch sizes must be between 1 and 32")

    try:
        ranges = _parse_ranges(args.ranges)
        crop = _parse_crop(args.crop)
    except ValueError as error:
        raise SystemExit(str(error)) from error

    output_dir = args.output.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    runs_path = output_dir / "runs.jsonl"
    modes = ("cold", "warm") if args.mode == "both" else (args.mode,)

    with JsonlWriter(runs_path) as writer:
        for mode in modes:
            for batch_size in batch_sizes:
                for warmup in range(args.warmups):
                    payload: BenchmarkPayload = {
                        "video_path": str(video_path),
                        "model_path": str(model_path),
                        "repository": str(Path.cwd()),
                        "variant": args.variant,
                        "benchmark_kind": args.benchmark_kind,
                        "mode": mode,
                        "frame_stride": args.frame_stride,
                        "inference_batch_size": batch_size,
                        "ranges": ranges,
                        "crop": crop,
                        "repetition": warmup,
                        "warmup": True,
                        "integration_latency_seconds": args.integration_latency_ms / 1000,
                        "integration_retryable_failures": args.integration_retryable_failures,
                    }
                    _run_child(payload, args.timeout_seconds)

                for repetition in range(args.repetitions):
                    payload = {
                        "video_path": str(video_path),
                        "model_path": str(model_path),
                        "repository": str(Path.cwd()),
                        "variant": args.variant,
                        "benchmark_kind": args.benchmark_kind,
                        "mode": mode,
                        "frame_stride": args.frame_stride,
                        "inference_batch_size": batch_size,
                        "ranges": ranges,
                        "crop": crop,
                        "repetition": repetition,
                        "warmup": False,
                        "integration_latency_seconds": args.integration_latency_ms / 1000,
                        "integration_retryable_failures": args.integration_retryable_failures,
                    }
                    writer.append(_run_child(payload, args.timeout_seconds))

    summary = build_summary(read_jsonl(runs_path))
    write_json(output_dir / "summary.json", summary)
    print(
        json.dumps(
            {
                "runs": str(runs_path),
                "summary": str(output_dir / "summary.json"),
                "runCount": summary["runCount"],
                "failedRuns": summary["failedRuns"],
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
