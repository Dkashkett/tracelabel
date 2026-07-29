import sys
from pathlib import Path
from typing import Annotated

import click
import typer

from tracelabel.errors import TraceLabelError
from tracelabel.workspace.workspace import default_workspace_root

from .commands import (
    AppCommand,
    DemoCommand,
    ExportCommand,
    ImportCommand,
    SuggestCommand,
)
from .options import (
    FormatChoice,
    FromChoice,
    OnConflictChoice,
    StatusChoice,
)

# `tracelabel [TARGET] --port --no-browser --dir` and `tracelabel <subcommand> ...`
# can't both be expressed as one Click Group: a Group with its own positional
# argument is ambiguous about whether the first token is that argument's value or a
# subcommand name (Click resolves the group's own params first, so `tracelabel
# import` would bind `target="import"` instead of dispatching to the `import`
# subcommand). Two separate Typer apps avoid the ambiguity entirely — `run()` below
# picks one based on whether the first argument names a known subcommand.
app = typer.Typer(add_completion=False)
launcher_app = typer.Typer(add_completion=False)

SUBCOMMANDS = ("demo", "import", "suggest", "export")

DirOption = Annotated[str | None, typer.Option("--dir", help="Workspace directory override")]
PortOption = Annotated[int, typer.Option("--port")]
NoBrowserOption = Annotated[bool, typer.Option("--no-browser")]


def _workspace_root(dir_: str | None) -> Path:
    return default_workspace_root(Path(dir_) if dir_ is not None else None)


@launcher_app.command()
def main(
    target: Annotated[str | None, typer.Argument()] = None,
    port: PortOption = 8377,
    no_browser: NoBrowserOption = False,
    dir_: DirOption = None,
) -> None:
    """`tracelabel [TARGET]`: launch the server, opening straight into the labeling
    view for TARGET if one is given, or the project list otherwise.
    """
    workspace_root = _workspace_root(dir_)
    AppCommand().execute(
        workspace_root,
        Path(target) if target is not None else None,
        port,
        no_browser,
    )


@app.command()
def demo(
    port: PortOption = 8377,
    no_browser: NoBrowserOption = False,
) -> None:
    """Launch against the bundled demo traces."""
    DemoCommand().execute(default_workspace_root(), port, no_browser)


@app.command(name="import")
def import_(
    target: Annotated[str, typer.Argument()],
    project: Annotated[str, typer.Option("--project")],
    dir_: DirOption = None,
    from_: Annotated[FromChoice, typer.Option("--from")] = FromChoice.auto,
    on_conflict: Annotated[
        OnConflictChoice,
        typer.Option("--on-conflict"),
    ] = OnConflictChoice.fail,
    skip_invalid: Annotated[bool, typer.Option("--skip-invalid")] = False,
    as_documents: Annotated[bool, typer.Option("--as-documents")] = False,
) -> None:
    ImportCommand().execute(
        _workspace_root(dir_),
        project,
        Path(target),
        from_=from_.value,
        on_conflict=on_conflict.value,
        skip_invalid=skip_invalid,
        as_documents=as_documents,
    )


@app.command()
def suggest(
    project: Annotated[str, typer.Option("--project")],
    task: Annotated[str, typer.Option("--task")],
    dir_: DirOption = None,
    limit: Annotated[int | None, typer.Option("--limit")] = None,
    overwrite: Annotated[bool, typer.Option("--overwrite")] = False,
    concurrency: Annotated[int, typer.Option("--concurrency")] = 4,
) -> None:
    summary = SuggestCommand().execute(
        _workspace_root(dir_),
        project,
        task,
        limit=limit,
        overwrite=overwrite,
        concurrency=concurrency,
    )
    attempted = summary.ok + summary.failed
    typer.echo(f"suggested {summary.ok}/{attempted} · {summary.failed} failed (re-run to retry)")


@app.command()
def export(
    project: Annotated[str | None, typer.Option("--project")] = None,
    task: Annotated[str | None, typer.Option("--task")] = None,
    dir_: DirOption = None,
    format: Annotated[FormatChoice, typer.Option("--format")] = FormatChoice.jsonl,
    joined: Annotated[bool, typer.Option("--joined")] = False,
    out: Annotated[str | None, typer.Option("--out")] = None,
    status: Annotated[StatusChoice, typer.Option("--status")] = StatusChoice.all,
) -> None:
    ExportCommand().execute(
        _workspace_root(dir_),
        project,
        task=task,
        format=format.value,
        joined=joined,
        out=Path(out) if out is not None else None,
        status=status.value,
    )


def run() -> None:
    argv = sys.argv[1:]
    dispatch = app if argv and argv[0] in SUBCOMMANDS else launcher_app
    try:
        dispatch(args=argv, standalone_mode=False)
    except TraceLabelError as error:
        typer.echo(str(error), err=True)
        raise SystemExit(error.exit_code) from error
    except (click.exceptions.Abort, KeyboardInterrupt) as error:
        raise SystemExit(130) from error
    except click.exceptions.ClickException as error:
        error.show()
        raise SystemExit(error.exit_code) from error
