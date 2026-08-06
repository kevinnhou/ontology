import json
import logging
import os
import socket
import threading
import time
import uuid
from collections.abc import Callable
from typing import Literal, Protocol

import httpx
import uvicorn
from ultralytics import YOLO

from .client import VisionControlPlaneClient
from .main import app
from .pipeline import (
    PipelineResult,
    load_model,
    run_pipeline,
    safe_error_message,
)
from .schemas import ProcessRequest

logger = logging.getLogger(__name__)

_POLL_INTERVAL_SECONDS = 5.0
_POLL_MAX_INTERVAL_SECONDS = 60.0
_HEARTBEAT_INTERVAL_SECONDS = 60.0
_MAX_HEARTBEAT_INTERVAL_SECONDS = 240.0
_SHUTDOWN_TIMEOUT_SECONDS = 30.0

WorkerState = Literal["starting", "idle", "processing", "stopping", "stopped", "failed"]
PipelineRunner = Callable[..., PipelineResult]


class ControlPlaneClient(Protocol):
    @property
    def http_client(self) -> httpx.Client: ...

    def claim_job(self, worker_id: str) -> ProcessRequest | None: ...

    def heartbeat(self, job_id: str, run_id: str) -> bool: ...

    def report_failure(self, job_id: str, run_id: str, error: str) -> bool: ...

    def close(self) -> None: ...


def _worker_id() -> str:
    return f"vision-{socket.gethostname()}-{uuid.uuid4().hex}"


class WorkerConfig:
    def __init__(
        self,
        site_url: str,
        callback_secret: str,
        worker_id: str,
        poll_interval_seconds: float,
        poll_max_interval_seconds: float,
        heartbeat_interval_seconds: float,
        shutdown_timeout_seconds: float,
    ) -> None:
        self.site_url = site_url
        self.callback_secret = callback_secret
        self.worker_id = worker_id
        self.poll_interval_seconds = poll_interval_seconds
        self.poll_max_interval_seconds = max(
            poll_interval_seconds,
            poll_max_interval_seconds,
        )
        self.heartbeat_interval_seconds = heartbeat_interval_seconds
        self.shutdown_timeout_seconds = shutdown_timeout_seconds

    @classmethod
    def from_environment(cls) -> "WorkerConfig":
        site_url = os.environ.get("CONVEX_SITE_URL", "").strip()
        callback_secret = os.environ.get("VISION_CALLBACK_SECRET", "")
        if not site_url:
            raise RuntimeError("CONVEX_SITE_URL is required")
        if not callback_secret:
            raise RuntimeError("VISION_CALLBACK_SECRET is required")

        return cls(
            site_url=site_url,
            callback_secret=callback_secret,
            worker_id=_worker_id(),
            poll_interval_seconds=_POLL_INTERVAL_SECONDS,
            poll_max_interval_seconds=_POLL_MAX_INTERVAL_SECONDS,
            heartbeat_interval_seconds=min(
                _MAX_HEARTBEAT_INTERVAL_SECONDS,
                _HEARTBEAT_INTERVAL_SECONDS,
            ),
            shutdown_timeout_seconds=_SHUTDOWN_TIMEOUT_SECONDS,
        )


class VisionWorker:
    def __init__(
        self,
        config: WorkerConfig,
        *,
        client: ControlPlaneClient | None = None,
        model: YOLO | None = None,
        pipeline_runner: PipelineRunner = run_pipeline,
        on_state_change: Callable[[WorkerState], None] | None = None,
    ) -> None:
        self._config = config
        self._client = client or VisionControlPlaneClient(
            config.site_url,
            config.callback_secret,
        )
        self._model = model
        self._pipeline_runner = pipeline_runner
        self._on_state_change = on_state_change
        self._stop_event = threading.Event()
        self._state_lock = threading.Lock()
        self._state: WorkerState = "starting"
        self._current_job: ProcessRequest | None = None
        self._thread: threading.Thread | None = None

    @property
    def state(self) -> WorkerState:
        with self._state_lock:
            return self._state

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            raise RuntimeError("Vision worker is already running")
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self.run,
            daemon=True,
            name="vision-worker-loop",
        )
        self._thread.start()

    def stop(self, timeout: float | None = None) -> None:
        self._set_state("stopping")
        self._stop_event.set()
        if self._thread is None:
            return

        self._thread.join(timeout or self._config.shutdown_timeout_seconds)
        if self._thread.is_alive():
            job = self._current_job
            if job:
                logger.error(
                    "vision worker shutdown timed out worker_id=%s job_id=%s "
                    "match_id=%s; lease will expire for safe retry",
                    self._config.worker_id,
                    job.jobId,
                    job.matchId,
                )
            else:
                logger.error(
                    "vision worker shutdown timed out worker_id=%s",
                    self._config.worker_id,
                )

    def run(self) -> None:
        failed = False
        try:
            if self._model is None:
                self._model = load_model()
            self._set_state("idle")
            self._poll_loop()
        except Exception as error:
            failed = True
            logger.error(
                "vision worker stopped unexpectedly worker_id=%s reason=%s",
                self._config.worker_id,
                safe_error_message(error),
            )
            self._set_state("failed")
        finally:
            self._client.close()
            if not failed:
                self._set_state("stopped")

    def _poll_loop(self) -> None:
        delay = self._config.poll_interval_seconds
        while not self._stop_event.is_set():
            try:
                job = self._client.claim_job(self._config.worker_id)
            except httpx.HTTPError as error:
                logger.warning(
                    "vision worker poll failed worker_id=%s reason=%s",
                    self._config.worker_id,
                    safe_error_message(error),
                )
                self._wait(delay)
                delay = min(
                    self._config.poll_max_interval_seconds,
                    delay * 2,
                )
                continue
            except Exception as error:
                logger.error(
                    "vision worker poll failed unexpectedly worker_id=%s reason=%s",
                    self._config.worker_id,
                    safe_error_message(error),
                )
                self._wait(delay)
                delay = min(
                    self._config.poll_max_interval_seconds,
                    delay * 2,
                )
                continue

            if job is None:
                self._set_state("idle")
                self._wait(delay)
                delay = min(
                    self._config.poll_max_interval_seconds,
                    delay * 2,
                )
                continue

            delay = self._config.poll_interval_seconds
            self._process_job(job)
            if not self._stop_event.is_set():
                self._set_state("idle")

    def _process_job(self, job: ProcessRequest) -> None:
        self._current_job = job
        self._set_state("processing")
        started_at = time.monotonic()
        heartbeat_stop = threading.Event()
        heartbeat_thread = threading.Thread(
            target=self._heartbeat_loop,
            args=(job, heartbeat_stop),
            daemon=True,
            name=f"vision-heartbeat-{job.jobId}",
        )
        heartbeat_thread.start()

        try:
            result = self._pipeline_runner(
                job,
                model=self._model,
                http_client=self._client.http_client,
                callback_secret=self._config.callback_secret,
            )
        except Exception as error:
            safe_error = safe_error_message(error)
            logger.error(
                "vision pipeline raised unexpectedly worker_id=%s job_id=%s match_id=%s reason=%s",
                self._config.worker_id,
                job.jobId,
                job.matchId,
                safe_error,
            )
            failure_status = "callback_failed"
            try:
                failure_status = (
                    "reported"
                    if self._client.report_failure(job.jobId, job.runId, safe_error)
                    else "stale"
                )
            except httpx.HTTPError as report_error:
                logger.error(
                    "vision failure callback failed worker_id=%s job_id=%s reason=%s",
                    self._config.worker_id,
                    job.jobId,
                    safe_error_message(report_error),
                )
            result = PipelineResult(
                completed=False,
                processed_frames=0,
                total_frames=0,
                error=safe_error,
                failure_status=failure_status,
            )
        finally:
            heartbeat_stop.set()
            heartbeat_thread.join(timeout=min(5.0, self._config.heartbeat_interval_seconds))
            self._current_job = None

        duration_seconds = time.monotonic() - started_at
        telemetry_json = json.dumps(
            result.telemetry.to_dict() if result.telemetry is not None else {},
            separators=(",", ":"),
            sort_keys=True,
        )
        if result.completed:
            logger.info(
                "vision job completed worker_id=%s job_id=%s match_id=%s "
                "attempt=%d duration_seconds=%.1f processed_frames=%d "
                "total_frames=%d peak_memory_mb=%.1f telemetry=%s",
                self._config.worker_id,
                job.jobId,
                job.matchId,
                job.attemptCount,
                duration_seconds,
                result.processed_frames,
                result.total_frames,
                result.peak_memory_mb or 0.0,
                telemetry_json,
            )
        else:
            logger.error(
                "vision job failed worker_id=%s job_id=%s match_id=%s "
                "attempt=%d duration_seconds=%.1f processed_frames=%d "
                "total_frames=%d peak_memory_mb=%.1f telemetry=%s "
                "state=%s failure_reason=%s",
                self._config.worker_id,
                job.jobId,
                job.matchId,
                job.attemptCount,
                duration_seconds,
                result.processed_frames,
                result.total_frames,
                result.peak_memory_mb or 0.0,
                telemetry_json,
                result.failure_status or "unknown",
                result.error or "unknown pipeline failure",
            )

    def _heartbeat_loop(
        self,
        job: ProcessRequest,
        stop_event: threading.Event,
    ) -> None:
        while not stop_event.wait(self._config.heartbeat_interval_seconds):
            try:
                accepted = self._client.heartbeat(job.jobId, job.runId)
            except httpx.HTTPError as error:
                logger.warning(
                    "vision heartbeat failed worker_id=%s job_id=%s match_id=%s reason=%s",
                    self._config.worker_id,
                    job.jobId,
                    job.matchId,
                    safe_error_message(error),
                )
                continue

            if not accepted:
                logger.warning(
                    "vision heartbeat rejected as stale worker_id=%s job_id=%s match_id=%s",
                    self._config.worker_id,
                    job.jobId,
                    job.matchId,
                )
                return

    def _wait(self, seconds: float) -> None:
        self._stop_event.wait(seconds)

    def _set_state(self, state: WorkerState) -> None:
        with self._state_lock:
            self._state = state
        if self._on_state_change:
            self._on_state_change(state)


def _set_health_state(state: WorkerState) -> None:
    app.state.worker_status = state
    app.state.worker_ready = state in {"idle", "processing"}


def _port() -> int:
    raw = os.environ.get("PORT", "8000")
    try:
        return int(raw)
    except ValueError:
        logger.warning("invalid PORT value; using 8000")
        return 8000


def run_worker() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    config = WorkerConfig.from_environment()
    worker = VisionWorker(config, on_state_change=_set_health_state)
    worker.start()
    try:
        uvicorn.run(
            app,
            host="0.0.0.0",
            port=_port(),
            log_level=os.environ.get("LOG_LEVEL", "info").lower(),
        )
    finally:
        worker.stop(config.shutdown_timeout_seconds)
