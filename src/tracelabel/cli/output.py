from pathlib import Path
from typing import Any

import typer

from tracelabel.imports.service import ImportSummary


def print_import_summary(path: Path, summary: ImportSummary) -> None:
    typer.echo(
        f"imported {path.name}: {summary.inserted} inserted, "
        f"{summary.skipped_duplicate} skipped (duplicate), "
        f"{summary.skipped_conflict} conflicts, "
        f"{len(summary.invalid)} invalid lines skipped"
    )
    for note in summary.notes:
        typer.echo(f"  {note}")


def print_tasks_table(tasks: list[dict[str, Any]]) -> None:
    header = ["TASK", "LEVEL", "PROGRESS", "SCHEMA", "UPDATED"]
    rows: list[list[str]] = []
    for task in tasks:
        unit = "turns" if task["level"] == "turn" else "traces"
        rows.append(
            [
                str(task["name"]),
                str(task["level"]),
                f"{task['addressed']}/{task['total']} {unit}",
                str(task["schema_hash"])[:6] + "…",
                str(task["updated_at"]).replace("T", " ").rstrip("Z")[:16],
            ]
        )
    widths = [len(column) for column in header]
    for row in rows:
        widths = [max(width, len(cell)) for width, cell in zip(widths, row, strict=True)]
    header_line = "  ".join(
        column.ljust(width) for column, width in zip(header, widths, strict=True)
    )
    typer.echo(header_line.rstrip())
    for row in rows:
        typer.echo(
            "  ".join(cell.ljust(width) for cell, width in zip(row, widths, strict=True)).rstrip()
        )
