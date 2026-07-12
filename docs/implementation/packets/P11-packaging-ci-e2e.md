# P11 — Packaging, release CI, e2e smoke, launch docs

**Phase:** 5 (final integration) · **Depends on:** everything · **Unblocks:** release

**Owned files:** `.github/workflows/release.yml`, `e2e/**`, `README.md`, `LICENSE`,
`docs/pandas.md`, `docs/trace-format.md`.

## Objective

Ship one wheel containing the built SPA; protect the pitch with the Playwright smoke;
publish the launch-facing docs. Distribution is the killer feature — users never touch Node.

## Required reading

- `docs/design/09-packaging-security.md` — **all of it (build pipeline, security posture,
  NFRs, launch checklist)**
- `docs/design/04-cli.md` §8 (the demo flow the smoke drives)
- `01-interfaces.md` §10 (`demo --no-browser`)

## Implementation notes

**`release.yml`** (tag-triggered), steps in order (09 §1):
1. `npm ci && npm run build` in `frontend/`.
2. Copy `frontend/dist/*` → `src/tracelabel/static/`.
3. **`check-static`** (PKG-01): fail hard if `src/tracelabel/static/index.html` is missing —
   never ship a wheel without the UI.
4. `hatch build` → install the built wheel in a clean venv → `tracelabel --help` and
   `python -m tracelabel --help` (PKG-02) → run E2E smoke against the *installed* wheel.
5. Publish to PyPI (trusted publishing / `pypa/gh-action-pypi-publish`).

**E2E smoke (`e2e/smoke.spec.ts`, E2E-01 — this one test protects the entire pitch):**
- Playwright lives only in `e2e/` (own `package.json`); never a dependency of the wheel or
  `frontend/`.
- Spawn `tracelabel demo --port 8399 --no-browser`; poll `/api/session` until ready
  (bounded by the 3 s cold-start NFR ×5 for CI slack).
- The bundled `demo` runs the zero-config default, which is a **trace-level** pass/fail task
  (design 03 §2, default `level: trace`), so the label target is the whole trace. The per-turn
  `j` navigation and accent ring are turn-level affordances (`turnLevel && …` in `TracePane`)
  and do not apply here — the earlier turn-level phrasing of this bullet was a packet-doc bug.
- Drive: press `1` (verdict "pass" selected on the primary select) → `r`, wait for the
  reasoning textarea to focus (it focuses on the next animation frame), type a reason →
  `Control+Enter` (commits from a focused textarea per 06 §2 and 09 §4; plain `Enter` in a
  textarea inserts a newline, so `Esc` → `Enter` in NAV mode is an equivalent alternative).
- Assert: `GET /api/progress` shows `labeled == 1`; a fresh `GET /api/traces/{id}` returns the
  annotation with the typed reasoning (the real proof); and the ●saved indicator appears — but
  since commit optimistically advances to the next trace, step back (`p`) to the labeled trace
  to observe it.
- Add to `ci.yml` as a `smoke` job (Linux only is acceptable for PR CI; release runs it on
  the wheel).
- Also add the CI grep guard from P9: fail if `dangerouslySetInnerHTML` appears under
  `frontend/src/`.

**Launch docs (09 §5 checklist is the outline):**
- `README.md`: one-liner → demo GIF placeholder (`uvx tracelabel demo`, j/1/Enter) →
  3-line quickstart → **"your traces never leave your machine unless *you* run
  `suggest`"** stated loudly → config example → export/pandas teaser → positioning
  ("when to use Label Studio/Argilla instead") → Teams section (single-player today;
  schema is multi-annotator ready; planned `tracelabel merge a.db b.db`) → security
  posture summary (loopback-only, no telemetry).
- `docs/trace-format.md`: public copy of design doc 01 (readable standalone; the format is
  the API).
- `docs/pandas.md`: the 07 §8 three-line load + a groupby example per field type.
- `LICENSE`: Apache-2.0.

## Tests

Matrix rows **E2E-01, PKG-01, PKG-02, PKG-03** (PKG-03's matrix already exists from P0 —
verify it's green on all six cells before release).

## Verification

```
cd frontend && npm run build && cp -r dist/* ../src/tracelabel/static/   # (or the CI script)
pip install dist/tracelabel-*.whl  # in a clean venv, after hatch build
tracelabel demo --no-browser --port 8399   # manual sanity
cd e2e && npx playwright test
```

## Out of scope

New product behavior of any kind; version bumping strategy; docs beyond the 09 §5 checklist.
