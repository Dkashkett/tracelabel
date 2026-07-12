# P0 — Scaffold

**Phase:** 0 (serial — everything depends on this) · **Depends on:** nothing · **Unblocks:** all packets

**Owned files:** `pyproject.toml`, `.gitignore`, `.github/workflows/ci.yml`,
`src/tracelabel/__init__.py`, `src/tracelabel/__main__.py`, `src/tracelabel/errors.py`,
module stubs (`ctf.py`, `config.py`, `db.py`, `server.py`, `export.py`, `suggest.py`,
`cli.py`, `adapters/__init__.py`), `tests/` (dir + `tests/helpers.py`), `frontend/` scaffold.

## Objective

A repo where every later packet can start immediately: installable package with entry
points, locked dependency surface, test harness, CI test workflow, and a building frontend
shell with the dev proxy.

## Required reading

- `docs/design/00-overview.md` §3 (stack table), `09-packaging-security.md` §1 (layout, deps)
- `01-interfaces.md` §2 (`errors.py` — implement it fully here; it is 15 lines)
- `.claude/CLAUDE.md`

## Implementation notes

**`pyproject.toml`** (hatchling):
- `name = "tracelabel"`, `requires-python = ">=3.10"`, `license = "Apache-2.0"`, version `0.1.0`.
- `dependencies = ["fastapi", "uvicorn", "pydantic>=2", "typer", "pyyaml"]` — exactly these
  five (CLAUDE.md non-negotiable). Extras: `ai = ["litellm"]`,
  `dev = ["pytest", "hypothesis", "httpx"]`.
- `[project.scripts] tracelabel = "tracelabel.cli.app:run"` (`run` is the error-handling
  wrapper from `01-interfaces.md` §10; the P0 stub is just `def run() -> None: app()`).
- Hatch config: packages from `src/`; **include** `src/tracelabel/static/**` and
  `src/tracelabel/demo_data/**` as package data (`artifacts`, since `static/` is gitignored).

**Python stubs:** `errors.py` fully implemented per `01-interfaces.md` §2. Every other module
is a stub that imports cleanly (empty file or, in `cli.py`, a minimal
`app = typer.Typer()` plus the `run()` wrapper stub so `tracelabel --help` runs).
`__main__.py`: `from tracelabel.cli.app import run; run()` guarded by
`if __name__ == "__main__":`. `__init__.py`: `__version__ = "0.1.0"` only.

**`.gitignore`:** `src/tracelabel/static/` (CI-populated — 09 §1), `frontend/node_modules/`,
`frontend/dist/`, `.tracelabel/`, `*.db`, `dist/`, `.venv/`, `__pycache__/`, `.pytest_cache/`,
plus remove/replace any existing IDE-generated ignores as appropriate (keep `.idea/` ignored).

**`tests/helpers.py`:** keep minimal — a `tmp_project(tmp_path)` helper returning a project
dir, and `read_jsonl(path)`. No conftest fixtures (packets keep their tests self-contained
to preserve file-ownership disjointness).

**`frontend/` scaffold:** Vite + React 18 + TypeScript + Tailwind. `vite.config.ts`:
`server.proxy = { "/api": "http://127.0.0.1:8377" }`; build output stays `frontend/dist`
(CI copies it into the wheel — P11). Vendor shadcn/ui primitives (button, textarea, badge,
progress — copied source under `frontend/src/components/ui/`, **not** an npm dependency;
CLAUDE.md). Add `npm run typecheck` (`tsc --noEmit`). A placeholder `App.tsx` rendering
"tracelabel" is enough; P9 owns everything after this.

**`.github/workflows/ci.yml`:** two jobs —
1. `test`: matrix `{ubuntu-latest, macos-latest, windows-latest} × {3.10, 3.12}` →
   `pip install -e ".[dev]"` → `pytest -q` (matrix row PKG-03).
2. `frontend`: `npm ci && npm run typecheck && npm run build` in `frontend/`.

## Tests

No matrix rows are owned by P0; the gate is that the harness itself works.

## Verification

```
pip install -e ".[dev]"
tracelabel --help && python -m tracelabel --help
pytest -q                      # collects, 0 failures (0 tests is fine)
cd frontend && npm install && npm run typecheck && npm run build
```

## Out of scope

Any real behavior in the stub modules; the release workflow (P11); demo data (P10).
