from collections import Counter

import cv2
import numpy as np
import supervision as sv

_RED_LOW = 10
_RED_HIGH = 170
_BLUE_LOW = 100
_BLUE_HIGH = 130
_MIN_SATURATION = 90
_MIN_VALUE = 60
_MIN_COLOR_FRACTION = 0.04
_MIN_CONFIDENT_ALLIANCE_VOTES = 3


def classify_alliance(frame_bgr: np.ndarray, xyxy: np.ndarray) -> str:
    height, width = frame_bgr.shape[:2]
    x1 = max(0, int(xyxy[0]))
    y1 = max(0, int(xyxy[1]))
    x2 = min(width, int(xyxy[2]))
    y2 = min(height, int(xyxy[3]))
    if x2 - x1 < 4 or y2 - y1 < 4:
        return "unknown"

    y_mid = y1 + (y2 - y1) // 2
    patch = frame_bgr[y_mid:y2, x1:x2]
    if patch.size == 0:
        return "unknown"

    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
    hue = hsv[:, :, 0]
    sat = hsv[:, :, 1]
    val = hsv[:, :, 2]
    vivid = (sat > _MIN_SATURATION) & (val > _MIN_VALUE)

    red_mask = vivid & ((hue < _RED_LOW) | (hue > _RED_HIGH))
    blue_mask = vivid & (hue > _BLUE_LOW) & (hue < _BLUE_HIGH)

    total = patch.shape[0] * patch.shape[1]
    red_fraction = float(np.count_nonzero(red_mask)) / total
    blue_fraction = float(np.count_nonzero(blue_mask)) / total

    if max(red_fraction, blue_fraction) < _MIN_COLOR_FRACTION:
        return "unknown"
    return "red" if red_fraction > blue_fraction else "blue"


class RobotTracker:
    def __init__(self, fps: float) -> None:
        self._frame_rate = max(1, int(round(fps)))
        self._tracker = sv.ByteTrack(frame_rate=self._frame_rate)
        self._votes: dict[int, Counter[str]] = {}
        self._alliance_cache: dict[int, str] = {}

    def reset(self) -> None:
        self._tracker = sv.ByteTrack(frame_rate=self._frame_rate)
        self._votes.clear()
        self._alliance_cache.clear()

    def update(
        self, detections: sv.Detections, frame_bgr: np.ndarray
    ) -> tuple[sv.Detections, list[str]]:
        tracked = self._tracker.update_with_detections(detections)
        alliances: list[str] = []
        for index in range(len(tracked)):
            tracker_ids = tracked.tracker_id
            track_id = int(tracker_ids[index]) if tracker_ids is not None else None
            alliance = self._alliance_cache.get(track_id) if track_id is not None else None
            if alliance is None:
                alliance = classify_alliance(frame_bgr, tracked.xyxy[index])
                if track_id is not None and alliance != "unknown":
                    votes = self._votes.setdefault(track_id, Counter())
                    votes[alliance] += 1
                    most_common = votes.most_common()
                    if most_common[0][1] >= _MIN_CONFIDENT_ALLIANCE_VOTES:
                        self._alliance_cache[track_id] = most_common[0][0]
            alliances.append(alliance or "unknown")
        return tracked, alliances

    def alliance_for_track(self, track_id: int) -> str:
        votes = self._votes.get(track_id)
        if not votes:
            return "unknown"
        return votes.most_common(1)[0][0]
