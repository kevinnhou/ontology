import threading
import time
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, cast

import httpx

from ..client import ConvexCallbackClient


class _ScenarioState:
    def __init__(
        self,
        *,
        latency_seconds: float,
        retryable_failures: int,
    ) -> None:
        self.latency_seconds = latency_seconds
        self.retryable_failures = retryable_failures
        self.requests = 0
        self.bytes_received = 0
        self.paths: Counter[str] = Counter()
        self.status_codes: Counter[int] = Counter()
        self._lock = threading.Lock()

    def record(self, path: str, body_size: int) -> int:
        with self._lock:
            self.requests += 1
            self.bytes_received += body_size
            self.paths[path] += 1
            should_retry = self.retryable_failures > 0 and path == "/vision/progress"
            if should_retry:
                self.retryable_failures -= 1
                status = 503
            else:
                status = 200
            self.status_codes[status] += 1
        if self.latency_seconds > 0:
            time.sleep(self.latency_seconds)
        return status

    def snapshot(self) -> dict[str, int]:
        with self._lock:
            return {
                "httpRequests": self.requests,
                "httpBytesReceived": self.bytes_received,
                "httpRetryResponses": self.status_codes[503],
                "httpSuccessfulResponses": self.status_codes[200],
                **{
                    f"httpPath.{path.strip('/').replace('/', '.')}.calls": count
                    for path, count in self.paths.items()
                },
            }


class _ScenarioHandler(BaseHTTPRequestHandler):
    def _respond(self, status: int, body: bytes = b"{}") -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        server = cast(_ScenarioServer, self.server)
        status = server.state.record(self.path, len(body))
        is_claim = self.path == "/vision/claim"
        self._respond(204 if is_claim else status, b"" if is_claim else b"{}")

    def do_POST(self) -> None:
        self._handle()

    def do_PUT(self) -> None:
        self._handle()

    def log_message(self, format: str, *args: Any) -> None:
        return


class _ScenarioServer(ThreadingHTTPServer):
    def __init__(self, state: _ScenarioState) -> None:
        super().__init__(("127.0.0.1", 0), _ScenarioHandler)
        self.state = state


class LocalIntegrationServer:
    def __init__(
        self,
        *,
        latency_seconds: float = 0.0,
        retryable_failures: int = 0,
    ) -> None:
        self._state = _ScenarioState(
            latency_seconds=latency_seconds,
            retryable_failures=retryable_failures,
        )
        self._server = _ScenarioServer(self._state)
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            daemon=True,
            name="vision-local-integration-server",
        )
        self._thread.start()

    @property
    def base_url(self) -> str:
        address = self._server.server_address
        host = str(address[0])
        port = int(address[1])
        return f"http://{host}:{port}"

    def snapshot(self) -> dict[str, int]:
        return self._state.snapshot()

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)

    def client(
        self,
        *,
        match_id: str,
        job_id: str,
        run_id: str,
    ) -> "RecordingCallbackClient":
        return RecordingCallbackClient(
            self.base_url,
            match_id,
            job_id,
            run_id,
            http_client=httpx.Client(),
            secret="local-integration",
        )

    def probe_control_plane(self, *, job_id: str, run_id: str) -> None:
        with httpx.Client() as client:
            client.post(f"{self.base_url}/vision/claim", json={"workerId": "local"})
            client.post(
                f"{self.base_url}/vision/heartbeat",
                json={"jobId": job_id, "runId": run_id},
            )


class RecordingCallbackClient(ConvexCallbackClient):
    def __init__(
        self,
        callback_url: str,
        match_id: str,
        job_id: str,
        run_id: str,
        *,
        http_client: httpx.Client,
        secret: str,
    ) -> None:
        super().__init__(
            callback_url,
            match_id,
            job_id,
            run_id,
            http_client=http_client,
            secret=secret,
        )
        self._local_http_client = http_client
        self.progress_calls = 0
        self.uploaded_bytes = 0
        self.shot_events: list[dict[str, Any]] = []
        self.analytics: dict[str, Any] = {}
        self.path_samples: list[dict[str, Any]] = []

    def close(self) -> None:
        super().close()
        self._local_http_client.close()

    def push_complete(
        self,
        shot_events: list[dict[str, Any]],
        analytics: dict[str, Any],
        path_samples: list[dict[str, Any]],
    ) -> None:
        super().push_complete(shot_events, analytics, path_samples)
        self.shot_events = shot_events
        self.analytics = analytics
        self.path_samples = path_samples

    def push_progress(self, processed_frames: int, total_frames: int) -> None:
        super().push_progress(processed_frames, total_frames)
        self.progress_calls += 1

    def upload_detections_file(self, url: str, path: Path) -> None:
        self.uploaded_bytes += path.stat().st_size
        super().upload_detections_file(url, path)


@contextmanager
def local_integration_server(
    *,
    latency_seconds: float = 0.0,
    retryable_failures: int = 0,
) -> Iterator[LocalIntegrationServer]:
    server = LocalIntegrationServer(
        latency_seconds=latency_seconds,
        retryable_failures=retryable_failures,
    )
    try:
        yield server
    finally:
        server.close()
