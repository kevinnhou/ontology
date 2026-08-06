import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import TextIO

from .models import JsonValue, RunRecord


class JsonlWriter:
    """Write one validated benchmark record per line."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._file: TextIO | None = None

    def __enter__(self) -> "JsonlWriter":
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._file = self._path.open("a", encoding="utf-8")
        return self

    def append(self, record: RunRecord) -> None:
        if self._file is None:
            raise RuntimeError("JsonlWriter must be used as a context manager")
        payload = json.dumps(
            record.to_dict(),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        self._file.write(f"{payload}\n")
        self._file.flush()

    def __exit__(
        self,
        _exc_type: object,
        _exc: object,
        _traceback: object,
    ) -> None:
        if self._file is not None:
            self._file.close()
            self._file = None


def read_jsonl(path: Path) -> list[RunRecord]:
    records: list[RunRecord] = []
    with path.open(encoding="utf-8") as file:
        for line_number, line in enumerate(file, start=1):
            if not line.strip():
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"invalid JSONL at line {line_number}") from error
            if not isinstance(payload, dict):
                raise ValueError(f"JSONL line {line_number} must be an object")
            records.append(RunRecord.from_dict(payload))
    return records


def write_json(path: Path, payload: dict[str, JsonValue]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=path.parent,
        prefix=f".{path.name}.",
        delete=False,
    ) as temporary:
        json.dump(
            payload,
            temporary,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    os.replace(temporary_path, path)
