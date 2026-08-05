import logging
import os
import time
from typing import Any

import httpx

from .schemas import ProcessRequest

logger = logging.getLogger(__name__)

_CONTROL_TIMEOUT = httpx.Timeout(30.0, connect=10.0, pool=10.0)
_UPLOAD_TIMEOUT = httpx.Timeout(120.0, connect=10.0, pool=10.0)
_RETRYABLE_STATUS_CODES = frozenset({408, 429, 500, 502, 503, 504})
_DEFAULT_MAX_RETRIES = 3
_MAX_RETRY_DELAY_SECONDS = 5.0


def _new_http_client() -> httpx.Client:
    return httpx.Client(
        limits=httpx.Limits(
            max_keepalive_connections=4,
            max_connections=4,
            keepalive_expiry=30.0,
        ),
        timeout=_CONTROL_TIMEOUT,
    )


def _retry_delay(response: httpx.Response, attempt: int) -> float:
    retry_after = response.headers.get("Retry-After")
    if retry_after:
        try:
            return min(_MAX_RETRY_DELAY_SECONDS, max(0.25, float(retry_after)))
        except ValueError:
            pass
    return min(_MAX_RETRY_DELAY_SECONDS, 0.25 * (2**attempt))


def _post_with_retries(
    client: httpx.Client,
    url: str,
    *,
    headers: dict[str, str],
    payload: dict[str, object],
    timeout: httpx.Timeout,
    max_retries: int,
) -> httpx.Response:
    for attempt in range(max_retries + 1):
        try:
            response = client.post(
                url,
                json=payload,
                headers=headers,
                timeout=timeout,
            )
        except (httpx.NetworkError, httpx.TimeoutException) as error:
            if attempt >= max_retries:
                raise
            logger.warning(
                "retrying control-plane request path=%s attempt=%d reason=%s",
                httpx.URL(url).path,
                attempt + 1,
                type(error).__name__,
            )
            time.sleep(0.25 * (2**attempt))
            continue

        if response.status_code not in _RETRYABLE_STATUS_CODES:
            return response
        if attempt >= max_retries:
            return response

        delay = _retry_delay(response, attempt)
        response.close()
        logger.warning(
            "retrying control-plane request path=%s attempt=%d status=%d",
            httpx.URL(url).path,
            attempt + 1,
            response.status_code,
        )
        time.sleep(delay)

    raise RuntimeError("Control-plane request retry loop ended unexpectedly")


class VisionControlPlaneClient:
    def __init__(
        self,
        site_url: str,
        secret: str,
        *,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._base = site_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {secret}"}
        self._http_client = http_client or _new_http_client()
        self._owns_client = http_client is None
        self._max_retries = _DEFAULT_MAX_RETRIES

    @property
    def http_client(self) -> httpx.Client:
        return self._http_client

    def close(self) -> None:
        if self._owns_client:
            self._http_client.close()

    def claim_job(self, worker_id: str) -> ProcessRequest | None:
        response = self._http_client.post(
            f"{self._base}/vision/claim",
            json={"workerId": worker_id},
            headers=self._headers,
            timeout=_CONTROL_TIMEOUT,
        )
        try:
            if response.status_code == 204:
                return None
            response.raise_for_status()
            return ProcessRequest.model_validate(response.json())
        finally:
            response.close()

    def heartbeat(self, job_id: str, run_id: str) -> bool:
        response = self._post_callback(
            "/vision/heartbeat",
            {"jobId": job_id, "runId": run_id},
        )
        try:
            if response.status_code == 409:
                return False
            response.raise_for_status()
            return True
        finally:
            response.close()

    def report_failure(self, job_id: str, run_id: str, error: str) -> bool:
        response = self._post_callback(
            "/vision/failed",
            {"jobId": job_id, "runId": run_id, "error": error[:500]},
        )
        try:
            if response.status_code == 409:
                return False
            response.raise_for_status()
            return True
        finally:
            response.close()

    def _post_callback(
        self,
        path: str,
        payload: dict[str, object],
    ) -> httpx.Response:
        return _post_with_retries(
            self._http_client,
            f"{self._base}{path}",
            headers=self._headers,
            payload=payload,
            timeout=_CONTROL_TIMEOUT,
            max_retries=self._max_retries,
        )


class ConvexCallbackClient:
    def __init__(
        self,
        callback_url: str,
        match_id: str,
        job_id: str,
        run_id: str,
        *,
        http_client: httpx.Client | None = None,
        secret: str | None = None,
    ) -> None:
        self._base = callback_url.rstrip("/")
        self._match_id = match_id
        self._job_id = job_id
        self._run_id = run_id
        callback_secret = secret or os.environ.get("VISION_CALLBACK_SECRET", "")
        self._headers = {"Authorization": f"Bearer {callback_secret}"}
        self._http_client = http_client or _new_http_client()
        self._owns_client = http_client is None
        self._max_retries = _DEFAULT_MAX_RETRIES
        self.processed_frames = 0
        self.total_frames = 0

    def close(self) -> None:
        if self._owns_client:
            self._http_client.close()

    def _post(
        self,
        path: str,
        payload: dict[str, object],
    ) -> dict[str, object] | None:
        body: dict[str, object] = {
            "matchId": self._match_id,
            "jobId": self._job_id,
            "runId": self._run_id,
        }
        body.update(payload)
        response = _post_with_retries(
            self._http_client,
            f"{self._base}{path}",
            headers=self._headers,
            payload=body,
            timeout=_CONTROL_TIMEOUT,
            max_retries=self._max_retries,
        )
        try:
            response.raise_for_status()
            response_body = response.json()
            return response_body if isinstance(response_body, dict) else None
        finally:
            response.close()

    def upload_detections(self, url: str, gzipped_bytes: bytes) -> None:
        response = self._http_client.put(
            url,
            content=gzipped_bytes,
            headers={
                "Content-Type": "application/json",
                "Content-Encoding": "gzip",
            },
            timeout=_UPLOAD_TIMEOUT,
        )
        try:
            response.raise_for_status()
        finally:
            response.close()

    def push_progress(self, processed_frames: int, total_frames: int) -> None:
        self.processed_frames = processed_frames
        self.total_frames = total_frames
        self._post(
            "/vision/progress",
            {"processedFrames": processed_frames, "totalFrames": total_frames},
        )

    def push_complete(
        self,
        shot_events: list[dict[str, Any]],
        analytics: dict[str, Any],
        path_samples: list[dict[str, Any]],
    ) -> None:
        self._post(
            "/vision/complete",
            {
                "shotEvents": shot_events,
                "analytics": analytics,
                "pathSamples": path_samples,
            },
        )

    def push_failed(self, error: str) -> str | None:
        try:
            response_body = self._post("/vision/failed", {"error": error[:500]})
        except httpx.HTTPStatusError as report_error:
            if report_error.response.status_code == 409:
                return "stale"
            logger.exception("failed to report pipeline failure")
            return None
        except httpx.HTTPError:
            logger.exception("failed to report pipeline failure")
            return None

        if response_body is None:
            return None
        status = response_body.get("status")
        return status if isinstance(status, str) else None
