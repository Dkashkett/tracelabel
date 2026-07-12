import csv
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any, Literal

from . import db
from .errors import UserError

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


def _target_parts(target_type: str, target_id: str) -> tuple[str, int | None]:
    if target_type == "turn":
        trace_id, idx = target_id.rsplit("#", 1)
        return trace_id, int(idx)
    return target_id, None


def _reconstruct_message(turn: sqlite3.Row) -> dict[str, Any]:
    # invariant #1: content strings pass through untouched; only the parts-array
    # wrapper (never the strings inside it) is ours to re-parse.
    content = json.loads(turn["content"]) if turn["content_type"] == "parts" else turn["content"]
    msg: dict[str, Any] = {"role": turn["role"], "content": content}
    if turn["tool_calls"] is not None:
        msg["tool_calls"] = json.loads(turn["tool_calls"])
    if turn["tool_call_id"] is not None:
        msg["tool_call_id"] = turn["tool_call_id"]
    if turn["name"] is not None:
        msg["name"] = turn["name"]
    metadata = json.loads(turn["metadata"])
    if metadata:
        msg["metadata"] = metadata
    return msg


def _build_row(
    conn: sqlite3.Connection, field_names: list[str], joined: bool, ann: sqlite3.Row
) -> dict[str, Any]:
    trace_id, turn_index = _target_parts(ann["target_type"], ann["target_id"])
    values = json.loads(ann["values"])
    row: dict[str, Any] = {
        "task": ann["task"],
        "trace_id": trace_id,
        "target_type": ann["target_type"],
        "target_id": ann["target_id"],
        "turn_index": turn_index,
        "annotator": ann["annotator"],
        "status": ann["status"],
        "prefill_model": ann["prefill_model"],
        "schema_hash": ann["schema_hash"],
        "created_at": ann["created_at"],
        "updated_at": ann["updated_at"],
        "values": {name: values.get(name) for name in field_names},
    }
    if joined:
        if ann["target_type"] == "turn":
            turn = conn.execute("SELECT * FROM turns WHERE id=?", (ann["target_id"],)).fetchone()
            row["role"] = turn["role"]
            row["content"] = turn["content"]
            row["content_type"] = turn["content_type"]
        else:
            turns = conn.execute(
                "SELECT * FROM turns WHERE trace_id=? ORDER BY idx", (trace_id,)
            ).fetchall()
            row["messages"] = [_reconstruct_message(t) for t in turns]
            trace = conn.execute("SELECT metadata FROM traces WHERE id=?", (trace_id,)).fetchone()
            row["trace_metadata"] = json.loads(trace["metadata"])
    return row


def _write_jsonl(rows: list[dict[str, Any]], out_path: Path | None) -> None:
    lines = (json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
    if out_path is None:
        sys.stdout.writelines(lines)
    else:
        with out_path.open("w", encoding="utf-8", newline="\n") as f:
            f.writelines(lines)


def _write_csv(
    rows: list[dict[str, Any]],
    field_names: list[str],
    level: str,
    joined: bool,
    out_path: Path | None,
) -> None:
    columns = list(BASE_COLUMNS) + [f"value.{name}" for name in field_names]
    if joined:
        if level == "turn":
            columns += ["role", "content", "content_type"]
        else:
            columns += ["messages", "trace_metadata"]

    def to_csv_row(r: dict[str, Any]) -> dict[str, Any]:
        out = {c: r[c] for c in BASE_COLUMNS}
        for name in field_names:
            v = r["values"].get(name)
            # multi-select cells: JSON-array string, unambiguous to json.loads (04 §5)
            out[f"value.{name}"] = json.dumps(v) if isinstance(v, list) else v
        if joined:
            if level == "turn":
                out["role"] = r["role"]
                out["content"] = r["content"]
                out["content_type"] = r["content_type"]
            else:
                out["messages"] = json.dumps(r["messages"], ensure_ascii=False)
                out["trace_metadata"] = json.dumps(r["trace_metadata"], ensure_ascii=False)
        return out

    def write(f: Any) -> None:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        for r in rows:
            writer.writerow(to_csv_row(r))

    if out_path is None:
        write(sys.stdout)
    else:
        with out_path.open("w", encoding="utf-8", newline="") as f:
            write(f)


def export_annotations(
    conn: sqlite3.Connection,
    task: str,
    fmt: Literal["jsonl", "csv"],
    joined: bool,
    out: Path | None,
    status: Literal["labeled", "skipped", "all"] = "all",
) -> int:
    task_row = db.get_task(conn, task)
    if task_row is None:
        names = ", ".join(t["name"] for t in db.list_tasks(conn)) or "(none)"
        raise UserError(f"unknown task '{task}'. Existing tasks: {names}")

    field_names = [f["name"] for f in json.loads(task_row["resolved_schema"])]

    sql = "SELECT * FROM annotations WHERE task=?"
    params: list[Any] = [task]
    if status != "all":
        sql += " AND status=?"
        params.append(status)
    sql += " ORDER BY target_type, target_id, annotator"

    rows = [_build_row(conn, field_names, joined, r) for r in conn.execute(sql, params).fetchall()]

    if out is None:
        out_path: Path | None = Path.cwd() / f"{task}-annotations.{fmt}"
    elif str(out) == "-":
        out_path = None
    else:
        out_path = out

    if fmt == "jsonl":
        _write_jsonl(rows, out_path)
    else:
        _write_csv(rows, field_names, task_row["level"], joined, out_path)

    print(
        f"wrote {len(rows)} row(s) to {'<stdout>' if out_path is None else out_path}",
        file=sys.stderr,
    )
    return len(rows)
