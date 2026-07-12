import csv
import json
from collections.abc import Sequence
from typing import Any, TextIO

BASE_COLUMNS = [
    "task",
    "trace_id",
    "target_type",
    "target_id",
    "turn_index",
    "annotator",
    "status",
    "prefill_model",
    "schema_hash",
    "created_at",
    "updated_at",
]

ExportRow = dict[str, Any]


class JsonlSerializer:
    def write(self, rows: Sequence[ExportRow], stream: TextIO) -> None:
        stream.writelines(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)


class CsvSerializer:
    def __init__(self, field_names: list[str], level: str, joined: bool) -> None:
        self._field_names = field_names
        self._level = level
        self._joined = joined

    @property
    def columns(self) -> list[str]:
        columns = list(BASE_COLUMNS) + [f"value.{name}" for name in self._field_names]
        if self._joined:
            if self._level == "turn":
                columns.extend(("role", "content", "content_type", "trace_metadata", "source"))
            else:
                columns.extend(("messages", "content", "content_type", "trace_metadata"))
        return columns

    def write(self, rows: Sequence[ExportRow], stream: TextIO) -> None:
        writer = csv.DictWriter(stream, fieldnames=self.columns)
        writer.writeheader()
        for row in rows:
            writer.writerow(self._csv_row(row))

    def _csv_row(self, row: ExportRow) -> ExportRow:
        output = {column: row[column] for column in BASE_COLUMNS}
        values = row["values"]
        for name in self._field_names:
            value = values.get(name)
            output[f"value.{name}"] = json.dumps(value) if isinstance(value, list) else value
        if self._joined:
            if self._level == "turn":
                output["role"] = row["role"]
                output["content"] = row["content"]
                output["content_type"] = row["content_type"]
                output["trace_metadata"] = json.dumps(
                    row["trace_metadata"],
                    ensure_ascii=False,
                )
                output["source"] = row["source"]
            else:
                if "messages" in row:
                    output["messages"] = json.dumps(row["messages"], ensure_ascii=False)
                else:
                    output["content"] = row["content"]
                    output["content_type"] = row["content_type"]
                output["trace_metadata"] = json.dumps(
                    row["trace_metadata"],
                    ensure_ascii=False,
                )
        return output
