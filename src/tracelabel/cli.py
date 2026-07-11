import typer

from tracelabel.errors import TraceLabelError

app = typer.Typer()


@app.callback()
def main() -> None:
    pass


def run() -> None:
    try:
        app()
    except TraceLabelError as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(code=e.exit_code)
    except KeyboardInterrupt:
        raise typer.Exit(code=130)
