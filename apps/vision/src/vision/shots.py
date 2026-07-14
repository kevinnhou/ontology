from dataclasses import dataclass, field

_MAX_MATCH_DISTANCE = 0.16
_SHOT_SPEED_THRESHOLD = 0.20
_ROBOT_EXPANSION = 0.4
_MAX_MISSED_FRAMES = 2


@dataclass
class RobotState:
    track_id: int | None
    alliance: str
    bbox: tuple[float, float, float, float]


@dataclass
class _FuelTracklet:
    center: tuple[float, float]
    frame_index: int
    near_robot: RobotState | None
    born_near_robot: RobotState | None
    missed: int = 0
    shot_emitted: bool = False
    speeds: list[float] = field(default_factory=list)


def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


def _robot_near(point: tuple[float, float], robots: list[RobotState]) -> RobotState | None:
    best: RobotState | None = None
    best_distance = float("inf")
    for robot in robots:
        x, y, w, h = robot.bbox
        pad_x = w * _ROBOT_EXPANSION
        pad_y = h * _ROBOT_EXPANSION
        inside = x - pad_x <= point[0] <= x + w + pad_x and y - pad_y <= point[1] <= y + h + pad_y
        if not inside:
            continue
        center = (x + w / 2, y + h / 2)
        distance = _distance(point, center)
        if distance < best_distance:
            best_distance = distance
            best = robot
    return best


class ShotDetector:
    def __init__(self) -> None:
        self._tracklets: list[_FuelTracklet] = []
        self.events: list[dict] = []

    def update(
        self,
        frame_index: int,
        timestamp_ms: float,
        fuel_centers: list[tuple[float, float]],
        robots: list[RobotState],
        dt_seconds: float,
    ) -> None:
        if dt_seconds <= 0:
            dt_seconds = 1 / 30

        unmatched = list(range(len(fuel_centers)))

        pairs: list[tuple[float, int, int]] = []
        for tracklet_index, tracklet in enumerate(self._tracklets):
            for fuel_index in unmatched:
                distance = _distance(tracklet.center, fuel_centers[fuel_index])
                if distance <= _MAX_MATCH_DISTANCE * (tracklet.missed + 1):
                    pairs.append((distance, tracklet_index, fuel_index))
        pairs.sort(key=lambda p: p[0])

        used_tracklets: set[int] = set()
        used_fuel: set[int] = set()
        for distance, tracklet_index, fuel_index in pairs:
            if tracklet_index in used_tracklets or fuel_index in used_fuel:
                continue
            used_tracklets.add(tracklet_index)
            used_fuel.add(fuel_index)

            tracklet = self._tracklets[tracklet_index]
            center = fuel_centers[fuel_index]
            elapsed = dt_seconds * (tracklet.missed + 1)
            speed = distance / elapsed
            previous_center = tracklet.center

            tracklet.speeds.append(speed)
            tracklet.center = center
            tracklet.frame_index = frame_index
            tracklet.missed = 0

            near = _robot_near(center, robots)
            origin_robot = tracklet.near_robot or tracklet.born_near_robot or near
            tracklet.near_robot = near

            moving_up = center[1] < previous_center[1] + 0.005
            if (
                not tracklet.shot_emitted
                and origin_robot is not None
                and speed >= _SHOT_SPEED_THRESHOLD
                and moving_up
            ):
                tracklet.shot_emitted = True
                robot_x, robot_y, robot_w, robot_h = origin_robot.bbox
                self.events.append(
                    {
                        "trackId": origin_robot.track_id,
                        "alliance": origin_robot.alliance,
                        "frameIndex": frame_index,
                        "timestampMs": timestamp_ms,
                        "origin": {
                            "x": robot_x + robot_w / 2,
                            "y": robot_y + robot_h / 2,
                        },
                        "speed": speed,
                    }
                )

        for fuel_index in range(len(fuel_centers)):
            if fuel_index in used_fuel:
                continue
            center = fuel_centers[fuel_index]
            near = _robot_near(center, robots)
            self._tracklets.append(
                _FuelTracklet(
                    center=center,
                    frame_index=frame_index,
                    near_robot=near,
                    born_near_robot=near,
                )
            )

        survivors: list[_FuelTracklet] = []
        for tracklet_index, tracklet in enumerate(self._tracklets):
            if tracklet_index not in used_tracklets:
                tracklet.missed += 1
            if tracklet.missed <= _MAX_MISSED_FRAMES:
                survivors.append(tracklet)
        self._tracklets = survivors
