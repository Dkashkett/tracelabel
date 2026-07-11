# P5 — HTTP API server

**Phase:** 3 · **Depends on:** P2, P3 · **Unblocks:** P8, P11 (e2e), unblocks P9's final integration

**Owned files:** `src/tracelabel/server.py`, `tests/test_api.py`.

## Objective

The FastAPI app: five endpoints, authoritative write-path validation, static SPA serving.
One process = one task + one annotator, so the API carries no task/annotator parameters —
the server injects them from `ResolvedTaskConfig`.

## Required reading

- `docs/design/05-http-api.md` — **all of it; §2 shapes and §3 validation are normative**
- `01-interfaces.md` §7 (frozen `build_app` + the async/single-connection DECISION), §4
  (`validate_annotation_values`), §5 (read helpers + `upsert_annotation`)

## Implementation notes

- `build_app(conn, cfg, queue, static_dir=None)` returns a fully-wired app; no globals, no
  app-level state beyond what's closed over (testability: TestClient per test).
- Response models exactly per 05 §2. `Turn.labelable` is server-computed:
  `cfg.level == "turn" and role in cfg.label_roles`. `TraceDetail.annotations`/`suggestions`
  keyed by `target_id`, filtered to this task (+ this annotator for annotations).
- **All endpoints `async def`, no awaits around db calls** — this serializes sqlite access
  on the event loop (see the DECISION in `01-interfaces.md` §7; a *why* comment citing it
  is warranted).
- **PUT /api/annotations order of checks:** (1) `target_type == cfg.level` else 422;
  (2) target exists — trace id in `traces`, or turn id in `turns` — else 404;
  (3) turn target labelable (role ∈ `cfg.label_roles`) else 422;
  (4) `config.validate_annotation_values(values, status, cfg.fields)` — `UserError` → 422
  with `{"detail": str(e)}`; (5) `db.upsert_annotation(..., schema_hash=cfg.schema_hash)`;
  return the stored row as `AnnotationOut`. Writes are synchronous — the response reflects
  actual db state (05 §3).
- `GET /api/queue`: iterate the injected `queue` order, join `db.target_counts` (one query,
  not N+1); `position` is the post-shuffle index.
- `GET /api/progress`: `unit = "turns" if cfg.level == "turn" else "traces"`; totals from
  `target_counts`.
- Errors: FastAPI default `{"detail": ...}` shape only; register an exception handler that
  converts `UserError` → 422 and never leaks a traceback (05 §4).
- Static serving per the DECISION in `01-interfaces.md` §7 (immutable cache on `/assets`,
  SPA fallback to `index.html`, 503 with build hint when missing). API routes are matched
  before the fallback; `/api/*` unknown paths are 404 JSON, never index.html.

## Tests

Matrix rows **API-01 … API-21**. Setup helper builds a tmp db via `db.open_db` +
`db.import_trace` with a small in-test CTF fixture (two traces: one tool-use conversation,
one document), plus a hand-built `ResolvedTaskConfig` for each level. For API-20, point
`static_dir` at a tmp dir containing a marker `index.html`.

## Verification

```
pytest tests/test_api.py -q
```

## Out of scope

Uvicorn/run/port/lock (P8), export endpoint (never exists — invariant #10), task CRUD or
DELETE endpoints (deliberately absent, 05 §1), auth/host binding (invariant #6 — binding
happens in P8 and is always 127.0.0.1).
