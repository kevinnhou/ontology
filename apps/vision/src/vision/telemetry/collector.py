import os
import platform
import resource
import subprocess
import sys
import time
from collections.abc import Callable, Mapping
from contextlib import AbstractContextManager
from hashlib import sha256
from pathlib import Path

from .models import JsonValue, Numeric, StageStats, TelemetrySnapshot

type Clock = Callable[[], float]


class _StageMeasurement(AbstractContextManager[None]):
    def __init__(
        self,
        collector: "TelemetryCollector",
        name: str,
        clock: Clock,
    ) -> None:
        self._collector = collector
        self._name = name
        self._clock = clock
        self._started_at = 0.0

    def __enter__(self) -> None:
        self._started_at = self._clock()

    def __exit__(
        self,
        _exc_type: object,
        _exc: object,
        _traceback: object,
    ) -> None:
        self._collector.record_duration(
            self._name,
            self._clock() - self._started_at,
        )


class TelemetryCollector:
    def __init__(self, *, clock: Clock = time.perf_counter) -> None:
        self._clock = clock
        self._stage_samples: dict[str, list[float]] = {}
        self._counters: dict[str, Numeric] = {}
        self._values: dict[str, JsonValue] = {}

    def measure_stage(self, name: str) -> AbstractContextManager[None]:
        if not name:
            raise ValueError("telemetry stage name must not be empty")
        return _StageMeasurement(self, name, self._clock)

    def record_duration(self, name: str, duration_seconds: float) -> None:
        if not name:
            raise ValueError("telemetry stage name must not be empty")
        if duration_seconds < 0:
            raise ValueError("telemetry duration must not be negative")
        self._stage_samples.setdefault(name, []).append(duration_seconds)

    def increment(self, name: str, amount: Numeric = 1) -> None:
        if not name:
            raise ValueError("telemetry counter name must not be empty")
        self._counters[name] = self._counters.get(name, 0) + amount

    def set_value(self, name: str, value: JsonValue) -> None:
        if not name:
            raise ValueError("telemetry value name must not be empty")
        self._values[name] = value

    def update_values(self, values: Mapping[str, JsonValue]) -> None:
        for name, value in values.items():
            self.set_value(name, value)

    def snapshot(self) -> TelemetrySnapshot:
        return TelemetrySnapshot(
            stages={
                name: StageStats.from_samples(samples)
                for name, samples in self._stage_samples.items()
            },
            counters=dict(self._counters),
            values=dict(self._values),
        )


def peak_rss_bytes() -> int:
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform == "darwin":
        return int(usage)


def process_cpu_seconds() -> float:
    usage = resource.getrusage(resource.RUSAGE_SELF)
    return float(usage.ru_utime + usage.ru_stime)


def collect_environment() -> dict[str, JsonValue]:
    return {
        "os": platform.platform(),
        "system": platform.system(),
        "release": platform.release(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "pythonVersion": platform.python_version(),
        "cpuCount": os.cpu_count() or 1,
        "pid": os.getpid(),
        "threadEnvironment": {
            name: os.environ[name]
            for name in (
                "OMP_NUM_THREADS",
                "MKL_NUM_THREADS",
                "OPENBLAS_NUM_THREADS",
                "VECLIB_MAXIMUM_THREADS",
            )
            if name in os.environ
        },
    }


def file_fingerprint(path: Path) -> dict[str, JsonValue]:
    digest = sha256()
    size = 0
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1 << 20), b""):
            digest.update(chunk)
            size += len(chunk)
    return {
        "path": str(path.resolve()),
        "sizeBytes": size,
        "sha256": digest.hexdigest(),
    }


def git_provenance(repository: Path) -> dict[str, JsonValue]:
    def git(*arguments: str) -> str | None:
        try:
            completed = subprocess.run(
                ["git", "-C", str(repository), *arguments],
                check=True,
                capture_output=True,
                text=True,
            )
        except (OSError, subprocess.CalledProcessError):
            return None
        return completed.stdout.strip()

    commit = git("rev-parse", "HEAD")
    status = git("status", "--porcelain")
    diff = git("diff", "--binary")
    diff_hash = sha256(diff.encode()).hexdigest() if diff else None
    return {
        "gitCommit": commit,
        "gitDirty": bool(status),
        "gitDiffSha256": diff_hash,
    }
