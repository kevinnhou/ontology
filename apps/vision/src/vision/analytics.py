from collections import defaultdict
from typing import Any


def build_analytics(
    shot_events: list[dict[str, Any]],
    processed_frames: int,
    processed_duration_ms: float,
) -> dict[str, Any]:
    shots_by_alliance = {"red": 0, "blue": 0, "unknown": 0}
    track_shots: dict[int, list[dict[str, Any]]] = defaultdict(list)

    for event in shot_events:
        alliance = event.get("alliance", "unknown")
        if alliance not in shots_by_alliance:
            alliance = "unknown"
        shots_by_alliance[alliance] += 1
        track_id = event.get("trackId")
        if track_id is not None:
            track_shots[int(track_id)].append(event)

    total_shots = len(shot_events)
    minutes = processed_duration_ms / 60_000 if processed_duration_ms > 0 else 0
    shots_per_minute = total_shots / minutes if minutes > 0 else 0
    avg_shot_speed = (
        sum(float(event["speed"]) for event in shot_events) / total_shots if total_shots > 0 else 0
    )

    by_track = [
        {
            "trackId": track_id,
            "alliance": events[0].get("alliance", "unknown"),
            "shots": len(events),
            "avgSpeed": sum(float(event["speed"]) for event in events) / len(events),
        }
        for track_id, events in sorted(track_shots.items())
    ]

    return {
        "totalShots": total_shots,
        "shotsByAlliance": shots_by_alliance,
        "shotsPerMinute": shots_per_minute,
        "avgShotSpeed": avg_shot_speed,
        "byTrack": by_track,
        "processedFrames": processed_frames,
        "processedDurationMs": processed_duration_ms,
    }
