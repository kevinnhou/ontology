from collections.abc import Iterable
from dataclasses import dataclass
from math import isfinite

type JsonPrimitive = None | bool | int | float | str
type JsonValue = JsonPrimitive | list["JsonValue"] | dict[str, "JsonValue"]
type Numeric = int | float


def _percentile(samples: list[float], percentile: float) -> float | None:
    if not samples:
        return None

    if len(samples) == 1:
        return samples[0]

    position = (len(samples) - 1) * percentile
    lower = int(position)
    upper = min(lower + 1, len(samples) - 1)
    fraction = position - lower
    return samples[lower] + (samples[upper] - samples[lower]) * fraction


@dataclass(frozen=True, slots=True)
class StageStats:
    count: int
    total_seconds: float
    mean_seconds: float | None
    min_seconds: float | None
    p50_seconds: float | None
    p95_seconds: float | None
    max_seconds: float | None

    @classmethod
    def from_samples(cls, samples: Iterable[float]) -> "StageStats":
        ordered = sorted(samples)
        if not ordered:
            return cls(
                count=0,
                total_seconds=0.0,
                mean_seconds=None,
                min_seconds=None,
                p50_seconds=None,
                p95_seconds=None,
                max_seconds=None,
            )

        total_seconds = sum(ordered)
        return cls(
            count=len(ordered),
            total_seconds=total_seconds,
            mean_seconds=total_seconds / len(ordered),
            min_seconds=ordered[0],
            p50_seconds=_percentile(ordered, 0.50),
            p95_seconds=_percentile(ordered, 0.95),
            max_seconds=ordered[-1],
        )

    def to_dict(self) -> dict[str, JsonValue]:
        return {
            "count": self.count,
            "totalSeconds": self.total_seconds,
            "meanSeconds": self.mean_seconds,
            "minSeconds": self.min_seconds,
            "p50Seconds": self.p50_seconds,
            "p95Seconds": self.p95_seconds,
            "maxSeconds": self.max_seconds,
        }


@dataclass(frozen=True, slots=True)
class TelemetrySnapshot:
    stages: dict[str, StageStats]
    counters: dict[str, Numeric]
    values: dict[str, JsonValue]

    def to_dict(self) -> dict[str, JsonValue]:
        return {
            "stages": {name: stats.to_dict() for name, stats in sorted(self.stages.items())},
            "counters": dict(sorted(self.counters.items())),
            "values": dict(sorted(self.values.items())),
        }


@dataclass(frozen=True, slots=True)
class RunRecord:
    run_id: str
    benchmark_kind: str
    variant: str
    status: str
    started_at: str
    finished_at: str
    duration_seconds: float
    environment: dict[str, JsonValue]
    input: dict[str, JsonValue]
    configuration: dict[str, JsonValue]
    telemetry: TelemetrySnapshot
    correctness: dict[str, JsonValue]
    error: str | None = None
    schema_version: int = 1

    def to_dict(self) -> dict[str, JsonValue]:
        return {
            "schemaVersion": self.schema_version,
            "recordType": "visionBenchmarkRun",
            "runId": self.run_id,
            "benchmarkKind": self.benchmark_kind,
            "variant": self.variant,
            "status": self.status,
            "startedAt": self.started_at,
            "finishedAt": self.finished_at,
            "durationSeconds": self.duration_seconds,
            "environment": dict(self.environment),
            "input": dict(self.input),
            "configuration": dict(self.configuration),
            "telemetry": self.telemetry.to_dict(),
            "correctness": dict(self.correctness),
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, JsonValue]) -> "RunRecord":
        telemetry_payload = _dict_value(payload, "telemetry")
        stage_payload = _dict_value(telemetry_payload, "stages")
        stages: dict[str, StageStats] = {}
        for name in stage_payload:
            stats = _dict_value(stage_payload, name)
            stages[name] = StageStats(
                count=_int_value(stats, "count"),
                total_seconds=_float_value(stats, "totalSeconds"),
                mean_seconds=_optional_float_value(stats, "meanSeconds"),
                min_seconds=_optional_float_value(stats, "minSeconds"),
                p50_seconds=_optional_float_value(stats, "p50Seconds"),
                p95_seconds=_optional_float_value(stats, "p95Seconds"),
                max_seconds=_optional_float_value(stats, "maxSeconds"),
            )

        counters_payload = _dict_value(telemetry_payload, "counters")
        counters: dict[str, Numeric] = {}
        for name, value in counters_payload.items():
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                raise ValueError(f"telemetry counter {name!r} must be numeric")
            counters[name] = value

        return cls(
            schema_version=_int_value(payload, "schemaVersion"),
            run_id=_str_value(payload, "runId"),
            benchmark_kind=_str_value(payload, "benchmarkKind"),
            variant=_str_value(payload, "variant"),
            status=_str_value(payload, "status"),
            started_at=_str_value(payload, "startedAt"),
            finished_at=_str_value(payload, "finishedAt"),
            duration_seconds=_float_value(payload, "durationSeconds"),
            environment=_dict_value(payload, "environment"),
            input=_dict_value(payload, "input"),
            configuration=_dict_value(payload, "configuration"),
            telemetry=TelemetrySnapshot(
                stages=stages,
                counters=counters,
                values=_dict_value(telemetry_payload, "values"),
            ),
            correctness=_dict_value(payload, "correctness"),
            error=_optional_str_value(payload, "error"),
        )


def _dict_value(payload: dict[str, JsonValue], key: str) -> dict[str, JsonValue]:
    value = payload.get(key)
    if not isinstance(value, dict):
        raise ValueError(f"{key!r} must be an object")
    return value


def _str_value(payload: dict[str, JsonValue], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str):
        raise ValueError(f"{key!r} must be a string")
    return value


def _optional_str_value(payload: dict[str, JsonValue], key: str) -> str | None:
    value = payload.get(key)
    if value is not None and not isinstance(value, str):
        raise ValueError(f"{key!r} must be a string or null")
    return value


def _float_value(payload: dict[str, JsonValue], key: str) -> float:
    value = payload.get(key)
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"{key!r} must be numeric")
    result = float(value)
    if not isfinite(result):
        raise ValueError(f"{key!r} must be finite")
    return result


def _optional_float_value(payload: dict[str, JsonValue], key: str) -> float | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"{key!r} must be numeric or null")
    result = float(value)
    if not isfinite(result):
        raise ValueError(f"{key!r} must be finite")
    return result


def _int_value(payload: dict[str, JsonValue], key: str) -> int:
    value = payload.get(key)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{key!r} must be an integer")
    return value
