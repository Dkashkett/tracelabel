from pathlib import Path
from typing import Annotated

import click
import typer

from tracelabel.config.loader import raw_config_for_target
from tracelabel.config.models import CliArgs
from tracelabel.config.resolver import ConfigResolver
from tracelabel.errors import TraceLabelError, UserError

from .commands import (
    DemoCommand,
    ExportCommand,
    ImportCommand,
    ServeCommand,
    SuggestCommand,
    TasksListCommand,
)
from .options import (
    FormatChoice,
    FromChoice,
    LevelChoice,
    OnConflictChoice,
    StatusChoice,
)

app = typer.Typer(add_completion=False)
tasks_app = typer.Typer(add_completion=False)
app.add_typer(tasks_app, name="tasks")


@app.callback()
def main() -> None:
    pass


def target_path(target: str | None) -> Path:
    if target is not None:
        return Path(target)
    fallback = Path("config.yaml")
    if fallback.exists():
        return fallback
    raise UserError("No data file given (arg or `data:` in YAML)")


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
    path = target_path(target)
    cli = CliArgs(
        task=task,
        level=level.value if level else None,
        annotator=annotator,
        shuffle=shuffle,
        db=db,
        yes=yes,
    )
    config = ConfigResolver().resolve(raw_config_for_target(path), cli)
    ServeCommand().execute(config, path.parent, db, port, no_browser, yes)


@app.command(name="import")
def import_(
    target: Annotated[str, typer.Argument()],
    from_: Annotated[FromChoice, typer.Option("--from")] = FromChoice.auto,
    db: Annotated[Path | None, typer.Option("--db")] = None,
    on_conflict: Annotated[
        OnConflictChoice,
        typer.Option("--on-conflict"),
    ] = OnConflictChoice.fail,
    skip_invalid: Annotated[bool, typer.Option("--skip-invalid")] = False,
    as_documents: Annotated[bool, typer.Option("--as-documents")] = False,
) -> None:
    ImportCommand().execute(
        Path(target),
        database_path=db,
        from_=from_.value,
        on_conflict=on_conflict.value,
        skip_invalid=skip_invalid,
        as_documents=as_documents,
    )


@app.command()
def export(
    task: Annotated[str | None, typer.Option("--task")] = None,
    db: Annotated[Path | None, typer.Option("--db")] = None,
    format: Annotated[FormatChoice, typer.Option("--format")] = FormatChoice.jsonl,
    joined: Annotated[bool, typer.Option("--joined")] = False,
    out: Annotated[str | None, typer.Option("--out")] = None,
    status: Annotated[StatusChoice, typer.Option("--status")] = StatusChoice.all,
) -> None:
    ExportCommand().execute(
        task=task,
        database_path=db,
        format=format.value,
        joined=joined,
        out=Path(out) if out is not None else None,
        status=status.value,
    )


@tasks_app.command("list")
def tasks_list(db: Annotated[Path | None, typer.Option("--db")] = None) -> None:
    TasksListCommand().execute(db)


@app.command()
def suggest(
    target: Annotated[str | None, typer.Argument()] = None,
    task: Annotated[str | None, typer.Option("--task")] = None,
    db: Annotated[Path | None, typer.Option("--db")] = None,
    limit: Annotated[int | None, typer.Option("--limit")] = None,
    overwrite: Annotated[bool, typer.Option("--overwrite")] = False,
    concurrency: Annotated[int, typer.Option("--concurrency")] = 4,
) -> None:
    path = target_path(target)
    config = ConfigResolver().resolve(
        raw_config_for_target(path),
        CliArgs(task=task, db=db),
    )
    summary = SuggestCommand().execute(
        config,
        path.parent,
        db,
        limit=limit,
        overwrite=overwrite,
        concurrency=concurrency,
    )
    attempted = summary.ok + summary.failed
    typer.echo(f"suggested {summary.ok}/{attempted} · {summary.failed} failed (re-run to retry)")


@app.command()
def demo(
    port: Annotated[int, typer.Option("--port")] = 8377,
    no_browser: Annotated[bool, typer.Option("--no-browser")] = False,
) -> None:
    DemoCommand().execute(port, no_browser)


def run() -> None:
    try:
        app(standalone_mode=False)
    except TraceLabelError as error:
        typer.echo(str(error), err=True)
        raise SystemExit(error.exit_code) from error
    except (click.exceptions.Abort, KeyboardInterrupt) as error:
        raise SystemExit(130) from error
    except click.exceptions.ClickException as error:
        error.show()
        raise SystemExit(error.exit_code) from error
