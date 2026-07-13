# Contributing to tracelabel

## Prerequisites

- Python 3.10 or newer and [uv](https://docs.astral.sh/uv/)
- Node.js 20 and npm

Install the Python and frontend development dependencies from the repository root:

```bash
uv sync --extra dev
npm --prefix frontend ci
```

## Frontend development

The production frontend has one canonical build destination: `src/tracelabel/static/`. This is
the directory served by the Python CLI and bundled into release wheels. It is generated and
gitignored; do not edit or commit its contents.

Build the frontend from the repository root:

```bash
npm --prefix frontend run build
```

The build clears and recreates `src/tracelabel/static/`. After it completes, an editable checkout
can serve the production bundle directly:

```bash
uv run tracelabel demo --no-browser
```

For live frontend development, run the API and Vite dev server separately. Vite serves the UI at
`http://127.0.0.1:5173` and proxies `/api` to port 8377:

```bash
# Terminal 1
uv run tracelabel demo --no-browser --port 8377

# Terminal 2
npm --prefix frontend run dev
```

Release and smoke-test workflows use the same build command and fail if
`src/tracelabel/static/index.html` is missing.

## Tests and checks

Run the Python checks:

```bash
uv run pytest -q
uv run ruff check src tests
uv run mypy src/tracelabel
```

Run the frontend checks:

```bash
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Before opening a pull request, run both test suites and confirm the production frontend builds.
