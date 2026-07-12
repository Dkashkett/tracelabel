import sqlite3
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal, TextIO, cast

from tracelabel.db.annotations import AnnotationRepository, ExportStatus
from tracelabel.db.database import decode_json
from tracelabel.db.tasks import TaskRepository
from tracelabel.db.traces import TraceRepository
from tracelabel.errors import UserError

from .serializers import CsvSerializer, ExportRow, JsonlSerializer

ExportFormat = Literal["jsonl", "csv"]


class ExportService:
    def __init__(
        self,
        tasks: TaskRepository,
        annotations: AnnotationRepository,
        traces: TraceRepository,
        *,
        stdout: TextIO | None = None,
        stderr: TextIO | None = None,
        cwd: Callable[[], Path] = Path.cwd,
    ) -> None:
        self._tasks = tasks
        self._annotations = annotations
        self._traces = traces
        self._stdout = stdout
        self._stderr = stderr
        self._cwd = cwd

    def export(
        self,
        task: str,
        format: ExportFormat,
        joined: bool,
        out: Path | None,
        status: ExportStatus = "all",
    ) -> int:
        task_row = self._tasks.get(task)
        if task_row is None:
            names = (
                ", ".join(str(item["name"]) for item in self._tasks.list_summaries()) or "(none)"
            )
            raise UserError(f"unknown task '{task}'. Existing tasks: {names}")
        fields = cast(list[dict[str, Any]], decode_json(task_row["resolved_schema"]))
        field_names = [str(field["name"]) for field in fields]
        rows = [
            self._build_row(field_names, joined, annotation)
            for annotation in self._annotations.list_for_export(task, status)
        ]
        output_path = self._output_path(task, format, out)
        self._write(rows, field_names, str(task_row["level"]), joined, format, output_path)
        destination = "<stdout>" if output_path is None else str(output_path)
        print(f"wrote {len(rows)} row(s) to {destination}", file=self._stderr or sys.stderr)
        return len(rows)

    def _build_row(
        self,
        field_names: list[str],
        joined: bool,
        annotation: sqlite3.Row,
    ) -> ExportRow:
        trace_id, turn_index = self._target_parts(
            annotation["target_type"],
            annotation["target_id"],
        )
        values = self._json_object(annotation["values"])
        row: ExportRow = {
            "task": annotation["task"],
            "trace_id": trace_id,
            "target_type": annotation["target_type"],
            "target_id": annotation["target_id"],
            "turn_index": turn_index,
            "annotator": annotation["annotator"],
            "status": annotation["status"],
            "prefill_model": annotation["prefill_model"],
            "schema_hash": annotation["schema_hash"],
            "created_at": annotation["created_at"],
            "updated_at": annotation["updated_at"],
            "values": {name: values.get(name) for name in field_names},
        }
        if not joined:
            return row
        if annotation["target_type"] == "turn":
            turn = self._traces.get_turn(annotation["target_id"])
            if turn is None:
                raise UserError(f"annotation target '{annotation['target_id']}' no longer exists")
            row.update(
                role=turn["role"],
                content=turn["content"],
                content_type=turn["content_type"],
            )
            return row
        turns = self._traces.get_turns(trace_id)
        row["messages"] = [self._reconstruct_message(turn) for turn in turns]
        trace = self._traces.get(trace_id)
        if trace is None:
            raise UserError(f"annotation target '{trace_id}' no longer exists")
        row["trace_metadata"] = self._json_object(trace["metadata"])
        return row

    @staticmethod
    def _target_parts(target_type: str, target_id: str) -> tuple[str, int | None]:
        if target_type == "turn":
            trace_id, index = target_id.rsplit("#", 1)
            return trace_id, int(index)
        return target_id, None

    @classmethod
    def _reconstruct_message(cls, turn: sqlite3.Row) -> ExportRow:
        content = (
            decode_json(turn["content"]) if turn["content_type"] == "parts" else turn["content"]
        )
        message: ExportRow = {"role": turn["role"], "content": content}
        if turn["tool_calls"] is not None:
            message["tool_calls"] = decode_json(turn["tool_calls"])
        if turn["tool_call_id"] is not None:
            message["tool_call_id"] = turn["tool_call_id"]
        if turn["name"] is not None:
            message["name"] = turn["name"]
        metadata = cls._json_object(turn["metadata"])
        if metadata:
            message["metadata"] = metadata
        return message

    def _write(
        self,
        rows: list[ExportRow],
        field_names: list[str],
        level: str,
        joined: bool,
        format: ExportFormat,
        output_path: Path | None,
    ) -> None:
        serializer = (
            JsonlSerializer() if format == "jsonl" else CsvSerializer(field_names, level, joined)
        )
        if output_path is None:
            serializer.write(rows, self._stdout or sys.stdout)
            return
        newline = "\n" if format == "jsonl" else ""
        with output_path.open("w", encoding="utf-8", newline=newline) as stream:
            serializer.write(rows, stream)

    def _output_path(
        self,
        task: str,
        format: ExportFormat,
        out: Path | None,
    ) -> Path | None:
        if out is None:
            return self._cwd() / f"{task}-annotations.{format}"
        if str(out) == "-":
            return None
        return out

    @staticmethod
    def _json_object(raw: str) -> dict[str, Any]:
        return cast(dict[str, Any], decode_json(raw))
