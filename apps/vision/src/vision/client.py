"""HTTP client used to push pipeline results back into Convex."""

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(30.0)


class ConvexCallbackClient:
    def __init__(self, callback_url: str, match_id: str) -> None:
        self._base = callback_url.rstrip("/")
        self._match_id = match_id
        secret = os.environ.get("VISION_CALLBACK_SECRET", "")
        self._headers = {"Authorization": f"Bearer {secret}"}

    def _post(self, path: str, payload: dict[str, Any]) -> None:
        url = f"{self._base}{path}"
        response = httpx.post(
            url,
            json={"matchId": self._match_id, **payload},
            headers=self._headers,
            timeout=_TIMEOUT,
        )
        response.raise_for_status()

    def push_detections(self, frames: list[dict[str, Any]]) -> None:
        self._post("/vision/detections", {"frames": frames})

    def push_progress(self, processed_frames: int, total_frames: int) -> None:
        self._post(
            "/vision/progress",
            {"processedFrames": processed_frames, "totalFrames": total_frames},
        )

    def push_complete(
        self,
        shot_events: list[dict[str, Any]],
        analytics: dict[str, Any],
    ) -> None:
        self._post(
            "/vision/complete",
            {"shotEvents": shot_events, "analytics": analytics},
        )

    def push_failed(self, error: str) -> None:
        try:
            self._post("/vision/failed", {"error": error[:500]})
        except httpx.HTTPError:
            logger.exception("failed to report pipeline failure")
