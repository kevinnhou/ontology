from collections.abc import Iterable
from datetime import UTC, datetime
from json import dumps
from math import isfinite
from typing import cast

from .models import JsonValue, Numeric, RunRecord, StageStats


def _numeric_summary(values: Iterable[Numeric]) -> dict[str, JsonValue]:
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return {
            "count": 0,
            "min": None,
            "mean": None,
            "p50": None,
            "p95": None,
            "max": None,
        }

    stats = StageStats.from_samples(ordered)
    return {
        "count": stats.count,
        "min": stats.min_seconds,
        "mean": stats.mean_seconds,
        "p50": stats.p50_seconds,
        "p95": stats.p95_seconds,
        "max": stats.max_seconds,
    }


def _successful(records: Iterable[RunRecord]) -> list[RunRecord]:
    return [record for record in records if record.status == "completed"]


def _group_summary(records: list[RunRecord]) -> dict[str, JsonValue]:
    successful = _successful(records)
    configuration = {
        name: value for name, value in records[0].configuration.items() if name != "repetition"
    }
    stage_names = sorted({name for record in successful for name in record.telemetry.stages})
    stages: dict[str, JsonValue] = {}
    for name in stage_names:
        stages[name] = _numeric_summary(
            record.telemetry.stages[name].total_seconds
            for record in successful
            if name in record.telemetry.stages
        )

    metric_values: dict[str, list[Numeric]] = {}
    for record in successful:
        for name, value in record.telemetry.counters.items():
            metric_values.setdefault(f"counter.{name}", []).append(value)
        for name, value in record.telemetry.values.items():
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                metric_values.setdefault(name, []).append(value)

    return {
        "configuration": configuration,
        "input": _input_identity(records[0]),
        "runCount": len(records),
        "completedRuns": len(successful),
        "failedRuns": len(records) - len(successful),
        "wallTimeSeconds": _numeric_summary(record.duration_seconds for record in successful),
        "stages": stages,
        "metrics": {
            name: _numeric_summary(values) for name, values in sorted(metric_values.items())
        },
        "correctness": _correctness_summary(successful),
    }


def _delta(candidate: float | None, baseline: float | None) -> dict[str, JsonValue]:
    if candidate is None or baseline is None or baseline == 0:
        return {"baseline": baseline, "candidate": candidate, "deltaPercent": None}
    return {
        "baseline": baseline,
        "candidate": candidate,
        "deltaPercent": ((candidate - baseline) / baseline) * 100,
    }


def _comparison(
    benchmark_kind: str,
    configuration_key: str,
    baseline: dict[str, JsonValue],
    candidate: dict[str, JsonValue],
) -> dict[str, JsonValue]:
    baseline_wall = _nested_number(baseline, "wallTimeSeconds", "p50")
    candidate_wall = _nested_number(candidate, "wallTimeSeconds", "p50")
    speedup = (
        baseline_wall / candidate_wall
        if baseline_wall is not None and candidate_wall not in (None, 0)
        else None
    )

    return {
        "benchmarkKind": benchmark_kind,
        "configurationKey": configuration_key,
        "baselineVariant": "baseline",
        "candidateVariant": "candidate",
        "wallTimeP50Seconds": _delta(candidate_wall, baseline_wall),
        "speedup": speedup,
        "peakRssBytes": _metric_delta(
            baseline,
            candidate,
            "peakRssBytes",
        ),
        "processedFramesPerSecond": _metric_delta(
            baseline,
            candidate,
            "processedFramesPerSecond",
        ),
        "correctness": _correctness_comparison(baseline, candidate),
    }


def _metric_delta(
    baseline: dict[str, JsonValue],
    candidate: dict[str, JsonValue],
    name: str,
) -> dict[str, JsonValue]:
    baseline_value = _nested_number(baseline, "metrics", name, "p50")
    candidate_value = _nested_number(candidate, "metrics", name, "p50")
    return _delta(candidate_value, baseline_value)


def _correctness_comparison(
    baseline: dict[str, JsonValue],
    candidate: dict[str, JsonValue],
) -> dict[str, JsonValue]:
    baseline_fingerprints = _nested_value(baseline, "correctness", "fingerprints")
    candidate_fingerprints = _nested_value(candidate, "correctness", "fingerprints")
    baseline_runs = _nested_number(baseline, "completedRuns") or 0
    candidate_runs = _nested_number(candidate, "completedRuns") or 0
    fingerprints_match = baseline_fingerprints == candidate_fingerprints
    return {
        "status": (
            "equivalent"
            if baseline_runs > 0 and candidate_runs > 0 and fingerprints_match
            else "different"
        ),
        "fingerprintsMatch": fingerprints_match,
        "artifactFrameCount": _correctness_metric_delta(
            baseline,
            candidate,
            "artifactFrameCount",
        ),
        "shotEventCount": _correctness_metric_delta(
            baseline,
            candidate,
            "shotEventCount",
        ),
        "pathSampleCount": _correctness_metric_delta(
            baseline,
            candidate,
            "pathSampleCount",
        ),
    }


def _correctness_metric_delta(
    baseline: dict[str, JsonValue],
    candidate: dict[str, JsonValue],
    name: str,
) -> dict[str, JsonValue]:
    baseline_value = _nested_number(baseline, "correctness", name, "p50")
    candidate_value = _nested_number(candidate, "correctness", name, "p50")
    return _delta(candidate_value, baseline_value)


def _nested_number(payload: dict[str, JsonValue], *keys: str) -> float | None:
    current = _nested_value(payload, *keys)
    if not isinstance(current, (int, float)) or isinstance(current, bool):
        return None
    return float(current) if isfinite(float(current)) else None


def _nested_value(payload: dict[str, JsonValue], *keys: str) -> JsonValue:
    current: JsonValue = payload
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def build_summary(records: Iterable[RunRecord]) -> dict[str, JsonValue]:
    record_list = list(records)
    grouped: dict[tuple[str, str, str], list[RunRecord]] = {}
    for record in record_list:
        comparison_key = _comparison_key(record)
        key = (record.benchmark_kind, record.variant, comparison_key)
        grouped.setdefault(key, []).append(record)

    groups: dict[str, JsonValue] = {
        _group_id(benchmark_kind, variant, comparison_key): _group_summary(group_records)
        for (benchmark_kind, variant, comparison_key), group_records in sorted(grouped.items())
    }
    comparisons: list[JsonValue] = []
    comparison_keys = sorted(
        {(record.benchmark_kind, _comparison_key(record)) for record in record_list}
    )
    for benchmark_kind, comparison_key in comparison_keys:
        baseline = groups.get(_group_id(benchmark_kind, "baseline", comparison_key))
        candidate = groups.get(_group_id(benchmark_kind, "candidate", comparison_key))
        if isinstance(baseline, dict) and isinstance(candidate, dict):
            comparisons.append(
                _comparison(
                    benchmark_kind,
                    comparison_key,
                    baseline,
                    candidate,
                )
            )

    return {
        "schemaVersion": 1,
        "recordType": "visionBenchmarkSummary",
        "generatedAt": datetime.now(UTC).isoformat(),
        "runCount": len(record_list),
        "completedRuns": sum(record.status == "completed" for record in record_list),
        "failedRuns": sum(record.status != "completed" for record in record_list),
        "groups": groups,
        "comparisons": comparisons,
    }


def _comparison_key(record: RunRecord) -> str:
    configuration = {
        name: value for name, value in record.configuration.items() if name != "repetition"
    }
    return dumps(
        {
            "configuration": configuration,
            "input": _input_identity(record),
        },
        separators=(",", ":"),
        sort_keys=True,
    )


def _input_identity(record: RunRecord) -> dict[str, JsonValue]:
    return {
        "video": _file_identity(record.input.get("video")),
        "model": _file_identity(record.input.get("model")),
    }


def _file_identity(value: JsonValue) -> dict[str, JsonValue]:
    if not isinstance(value, dict):
        return {}
    return {name: value[name] for name in ("sha256", "sizeBytes") if name in value}


def _correctness_summary(records: list[RunRecord]) -> dict[str, JsonValue]:
    def numeric_values(name: str) -> list[Numeric]:
        values: list[Numeric] = []
        for record in records:
            value = record.correctness.get(name)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                values.append(value)
        return values

    fingerprints = cast(
        list[JsonValue],
        sorted(
            {
                dumps(
                    {
                        name: record.correctness.get(name)
                        for name in (
                            "artifactCanonicalSha256",
                            "artifactFrameCount",
                            "shotEventCount",
                            "pathSampleCount",
                            "analytics",
                        )
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                )
                for record in records
            }
        ),
    )
    artifact_hashes = cast(
        list[JsonValue],
        sorted(
            {
                value
                for record in records
                for value in [record.correctness.get("artifactCanonicalSha256")]
                if isinstance(value, str)
            }
        ),
    )
    return {
        "artifactCanonicalSha256": artifact_hashes,
        "artifactFrameCount": _numeric_summary(numeric_values("artifactFrameCount")),
        "shotEventCount": _numeric_summary(numeric_values("shotEventCount")),
        "pathSampleCount": _numeric_summary(numeric_values("pathSampleCount")),
        "fingerprints": fingerprints,
    }


def _group_id(
    benchmark_kind: str,
    variant: str,
    configuration_key: str,
) -> str:
    return f"{benchmark_kind}:{variant}:{configuration_key}"
