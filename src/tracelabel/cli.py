import importlib.resources as resources
import socket
import sqlite3
import tempfile
import webbrowser
from enum import Enum
from pathlib import Path
from typing import Annotated, Any

import click
import typer
import uvicorn

from tracelabel.adapters import ImportSummary, import_file
from tracelabel.config import (
    CliArgs,
    ResolvedTaskConfig,
    raw_config_for_target,
    resolve,
)
from tracelabel.db import (
    acquire_lock,
    build_queue,
    default_db_path,
    list_tasks,
    open_db,
    open_task,
)
from tracelabel.errors import EnvError, TraceLabelError, UserError
from tracelabel.export import export_annotations
from tracelabel.server import build_app
from tracelabel.suggest import run_suggest

app = typer.Typer(add_completion=False)
tasks_app = typer.Typer(add_completion=False)
app.add_typer(tasks_app, name="tasks")


class LevelChoice(str, Enum):
    turn = "turn"
    trace = "trace"


class FromChoice(str, Enum):
    auto = "auto"
    ctf = "ctf"
    adk = "adk"
    datadog = "datadog"


class OnConflictChoice(str, Enum):
    fail = "fail"
    skip = "skip"


class FormatChoice(str, Enum):
    jsonl = "jsonl"
    csv = "csv"


class StatusChoice(str, Enum):
    labeled = "labeled"
    skipped = "skipped"
    all = "all"


@app.callback()
def main() -> None:
    pass


# ── shared helpers ────────────────────────────────────────────────────────────


def pick_port(requested: int = 8377) -> int:
    for port in range(requested, requested + 10):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
            except OSError:
                continue
        if port != requested:
            typer.echo(f"port {requested} is busy; using {port} instead")
        return port
    raise EnvError(
        f"No free port in {requested}–{requested + 9}. Free one up or pass a different --port."
    )


def _print_import_summary(path: Path, s: ImportSummary) -> None:
    typer.echo(
        f"imported {path.name}: {s.inserted} inserted, "
        f"{s.skipped_duplicate} skipped (duplicate), {s.skipped_conflict} conflicts, "
        f"{len(s.invalid)} invalid lines skipped"
    )
    for note in s.notes:
        typer.echo(f"  {note}")


def _target_path(target: str | None) -> Path:
    # serve/suggest with TARGET omitted → ./config.yaml if present, else UserError (04 §1).
    if target is not None:
        return Path(target)
    fallback = Path("config.yaml")
    if fallback.exists():
        return fallback
    raise UserError("No data file given (arg or `data:` in YAML)")


def _run_server(
    cfg: ResolvedTaskConfig,
    project_dir: Path,
    db: Path | None,
    port_req: int,
    no_browser: bool,
    assume_yes: bool,
) -> None:
    # 04 §2 serve order (frozen in 01-interfaces.md §10).
    db_path = db or default_db_path(project_dir)
    conn = open_db(db_path)
    port = pick_port(port_req)
    acquire_lock(project_dir, port)
    summary = import_file(conn, cfg.data_path, on_conflict="fail")
    _print_import_summary(cfg.data_path, summary)
    open_task(conn, cfg, assume_yes=assume_yes)
    queue = build_queue(conn, cfg.name)
    fastapi_app = build_app(conn, cfg, queue)
    typer.echo(f"tracelabel · task '{cfg.name}' ({cfg.level}-level) · http://127.0.0.1:{port}")
    # 09 §3 wants the browser opened only after the server is listening; opening right before
    # uvicorn.run is the accepted MVP simplification (the listen socket is claimed by pick_port
    # moments earlier, so the tab lands on a live server in practice).
    if not no_browser:
        webbrowser.open(f"http://127.0.0.1:{port}")
    uvicorn.run(fastapi_app, host="127.0.0.1", port=port)  # 127.0.0.1 ONLY — invariant #6


# ── commands ──────────────────────────────────────────────────────────────────


@app.command()
def serve(
    target: Annotated[str | None, typer.Argument()] = None,
    task: Annotated[str | None, typer.Option("--task")] = None,
    level: Annotated[LevelChoice | None, typer.Option("--level")] = None,
    annotator: Annotated[str | None, typer.Option("--annotator")] = None,
    shuffle: Annotated[bool | None, typer.Option("--shuffle/--no-shuffle")] = None,
    db: Annotated[Path | None, typer.Option("--db")] = None,
    port: Annotated[int, typer.Option("--port")] = 8377,
    no_browser: Annotated[bool, typer.Option("--no-browser")] = False,
    yes: Annotated[bool, typer.Option("--yes")] = False,
) -> None:
    path = _target_path(target)
    cli = CliArgs(
        task=task,
        level=level.value if level else None,
        annotator=annotator,
        shuffle=shuffle,
        db=db,
        yes=yes,
    )
    cfg = resolve(raw_config_for_target(path), cli)
    _run_server(cfg, path.parent, db, port, no_browser, yes)


@app.command(name="import")
def import_(
    target: Annotated[str, typer.Argument()],
    from_: Annotated[FromChoice, typer.Option("--from")] = FromChoice.auto,
    db: Annotated[Path | None, typer.Option("--db")] = None,
    on_conflict: Annotated[OnConflictChoice, typer.Option("--on-conflict")] = OnConflictChoice.fail,
    skip_invalid: Annotated[bool, typer.Option("--skip-invalid")] = False,
    as_documents: Annotated[bool, typer.Option("--as-documents")] = False,
) -> None:
    path = Path(target)
    db_path = db or default_db_path(path.parent)
    conn = open_db(db_path)
    summary = import_file(
        conn,
        path,
        from_=from_.value,
        on_conflict=on_conflict.value,
        skip_invalid=skip_invalid,
        as_documents=as_documents,
    )
    _print_import_summary(path, summary)


@app.command()
def export(
    task: Annotated[str | None, typer.Option("--task")] = None,
    db: Annotated[Path | None, typer.Option("--db")] = None,
    format: Annotated[FormatChoice, typer.Option("--format")] = FormatChoice.jsonl,
    joined: Annotated[bool, typer.Option("--joined")] = False,
    out: Annotated[str | None, typer.Option("--out")] = None,
    status: Annotated[StatusChoice, typer.Option("--status")] = StatusChoice.all,
) -> None:
    db_path = db or default_db_path(Path.cwd())
    conn = open_db(db_path)
    name = _resolve_task(conn, task)
    out_path = Path(out) if out is not None else None
    export_annotations(conn, name, format.value, joined, out_path, status.value)


@tasks_app.command("list")
def tasks_list(db: Annotated[Path | None, typer.Option("--db")] = None) -> None:
    db_path = db or default_db_path(Path.cwd())
    conn = open_db(db_path)
    _print_tasks_table(list_tasks(conn))


@app.command()
def suggest(
    target: Annotated[str | None, typer.Argument()] = None,
    task: Annotated[str | None, typer.Option("--task")] = None,
    db: Annotated[Path | None, typer.Option("--db")] = None,
    limit: Annotated[int | None, typer.Option("--limit")] = None,
    overwrite: Annotated[bool, typer.Option("--overwrite")] = False,
    concurrency: Annotated[int, typer.Option("--concurrency")] = 4,
) -> None:
    path = _target_path(target)
    cfg = resolve(raw_config_for_target(path), CliArgs(task=task, db=db))
    db_path = db or default_db_path(path.parent)
    conn = open_db(db_path)
    summary = run_suggest(cfg, conn, limit=limit, overwrite=overwrite, concurrency=concurrency)
    attempted = summary.ok + summary.failed
    typer.echo(f"suggested {summary.ok}/{attempted} · {summary.failed} failed (re-run to retry)")


@app.command()
def demo(
    port: Annotated[int, typer.Option("--port")] = 8377,
    no_browser: Annotated[bool, typer.Option("--no-browser")] = False,
) -> None:
    src = resources.files("tracelabel.demo_data") / "traces.jsonl"
    # Temp project persists for the session so its db (under .tracelabel/) survives across
    # resume within the run; nothing cleans it up on purpose.
    project_dir = Path(tempfile.mkdtemp(prefix="tracelabel-demo-"))
    data = project_dir / "traces.jsonl"
    data.write_bytes(src.read_bytes())
    cfg = resolve(raw_config_for_target(data), CliArgs())
    _run_server(cfg, project_dir, None, port, no_browser, assume_yes=True)


# ── formatting ────────────────────────────────────────────────────────────────


def _resolve_task(conn: sqlite3.Connection, task: str | None) -> str:
    if task is not None:
        return task
    names = [str(t["name"]) for t in list_tasks(conn)]
    if len(names) == 1:
        return names[0]
    listed = ", ".join(names) or "(none)"
    raise UserError(f"--task is required; existing tasks: {listed}")


def _print_tasks_table(tasks: list[dict[str, Any]]) -> None:
    header = ["TASK", "LEVEL", "PROGRESS", "SCHEMA", "UPDATED"]
    rows: list[list[str]] = []
    for t in tasks:
        unit = "turns" if t["level"] == "turn" else "traces"
        rows.append(
            [
                t["name"],
                t["level"],
                f"{t['addressed']}/{t['total']} {unit}",
                t["schema_hash"][:6] + "…",
                t["updated_at"].replace("T", " ").rstrip("Z")[:16],
            ]
        )
    widths = [len(h) for h in header]
    for r in rows:
        widths = [max(w, len(c)) for w, c in zip(widths, r, strict=True)]
    line = "  ".join(h.ljust(w) for h, w in zip(header, widths, strict=True))
    typer.echo(line.rstrip())
    for r in rows:
        typer.echo("  ".join(c.ljust(w) for c, w in zip(r, widths, strict=True)).rstrip())


def run() -> None:
    # The ONE place TraceLabelError becomes an exit code (01-interfaces.md §2). standalone_mode
    # off so Click hands us KeyboardInterrupt/Abort instead of swallowing them; the lock is
    # released via the atexit hook acquire_lock registered.
    try:
        app(standalone_mode=False)
    except TraceLabelError as e:
        typer.echo(str(e), err=True)
        raise SystemExit(e.exit_code) from e
    except click.exceptions.Abort as e:
        raise SystemExit(130) from e
    except KeyboardInterrupt as e:
        raise SystemExit(130) from e
    except click.exceptions.ClickException as e:
        e.show()
        raise SystemExit(e.exit_code) from e
