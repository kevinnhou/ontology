import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(30.0)


class ConvexCallbackClient:
    def __init__(
        self,
        callback_url: str,
        match_id: str,
        job_id: str,
        run_id: str,
    ) -> None:
        self._base = callback_url.rstrip("/")
        self._match_id = match_id
        self._job_id = job_id
        self._run_id = run_id
        secret = os.environ.get("VISION_CALLBACK_SECRET", "")
        self._headers = {"Authorization": f"Bearer {secret}"}

    def _post(self, path: str, payload: dict[str, Any]) -> None:
        url = f"{self._base}{path}"
        response = httpx.post(
            url,
            json={
                "matchId": self._match_id,
                "jobId": self._job_id,
                "runId": self._run_id,
                **payload,
            },
            headers=self._headers,
            timeout=_TIMEOUT,
        )
        response.raise_for_status()

    def upload_detections(self, url: str, gzipped_bytes: bytes) -> None:
        response = httpx.put(
            url,
            content=gzipped_bytes,
            headers={
                "Content-Type": "application/json",
                "Content-Encoding": "gzip",
            },
            timeout=_TIMEOUT,
        )
        response.raise_for_status()

    def push_progress(self, processed_frames: int, total_frames: int) -> None:
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

    def push_failed(self, error: str) -> None:
        try:
            self._post("/vision/failed", {"error": error[:500]})
        except httpx.HTTPError:
            logger.exception("failed to report pipeline failure")
