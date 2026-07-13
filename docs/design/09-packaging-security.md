# 09 — Packaging, Distribution, Security & NFRs

Distribution is the killer feature. **Users never touch Node, never clone a repo.**

## 1. Package & build

- Name `tracelabel` on PyPI; hatchling build; Python ≥ 3.10; pure-Python wheel.
- Runtime deps (core): `fastapi`, `uvicorn`, `pydantic>=2`, `typer`, `pyyaml`. That's it.
- Optional extras: `tracelabel[ai]` → `litellm`. Import of litellm is lazy and guarded
  (04 §7 error message).
- Frontend is **built in CI** (`vite build`) directly into `src/tracelabel/static/` before
  `hatch build`, shipping inside the wheel (the
  MLflow/Prefect/Streamlit pattern). A CI check fails the release if `static/index.html`
  is missing — never ship a wheel without the UI.
- Bundled demo data: `src/tracelabel/demo_data/traces.jsonl` (~25 traces: tool-use agent
  convos, a JSON doc, an HTML doc; all synthetic).
- Must work via `pip install tracelabel`, `uvx tracelabel`, and `python -m tracelabel`.

```
repo/
├── frontend/                 # Vite app (dev: `vite dev` proxying /api → :8377)
├── src/tracelabel/
│   ├── cli.py  server.py  config.py  db.py  ctf.py
│   ├── adapters/{loose,adk,datadog}.py
│   ├── suggest.py  export.py
│   ├── static/               # Vite-populated, gitignored
│   └── demo_data/
├── docs/                     # these specs + pandas.md + trace-format.md (public copy of 01)
└── .github/workflows/release.yml   # vite build → hatch build → pypi publish
```

## 2. Security posture

| Threat | Control |
|---|---|
| Server exposed on network | Bind `127.0.0.1` only; **no `--host` flag exists in MVP** (invariant #6). No auth because loopback-only. |
| Malicious HTML in traces (XSS) | Sandboxed iframe with empty `sandbox` attribute (06 §4). No `dangerouslySetInnerHTML` anywhere. |
| Malicious JSON/strings | Rendered as text/tree, never eval'd. |
| API keys leaking | Keys only via env (invariants #9); `ConfigDict(extra="forbid")` rejects `api_key:` in YAML with a pointed error; keys never logged, never in db. |
| Data exfiltration concerns | **No telemetry, period.** The only outbound network calls the package can make are litellm calls the user explicitly runs via `suggest`. State this loudly in the README: "your traces never leave your machine unless *you* run `suggest`." |
| Concurrent writers corrupting db | Project lock file (02 §1) + WAL + busy_timeout. |
| Supply-chain sprawl | Tiny core dep list; shadcn/ui vendored, not a dependency. |

## 3. Non-functional requirements

| NFR | Target |
|---|---|
| Install → first committed label | < 3 minutes on a fresh machine (measured in CI-adjacent smoke script using `demo`) |
| Cold start (`serve`, 1k traces) | < 3 s to browser-ready |
| Import throughput | ≥ 5k traces/min on laptop hardware (single transaction per batch of 500) |
| UI responsiveness | commit→next-target paint < 100 ms (optimistic advance while mutation settles); 300-turn trace scrolls at 60 fps (virtualization) |
| Dataset scale (MVP) | 100k traces / 1M turns without UI degradation (server paginates queue if needed post-MVP; MVP asserts graceful behavior at 10k) |
| Platforms | macOS, Linux, **Windows** (paths via `pathlib` everywhere; CI matrix runs the smoke test on all three) |
| Browser auto-open | `webbrowser.open` after server is listening; `--no-browser` for remote/tmux users |
| Upgrades | db migrations auto-run; older app + newer db refuses with upgrade message (02 §3) |

## 4. Testing strategy (minimum bar)

- **Contract tests:** CTF validation fixtures (valid + every rejection rule in 01 §7);
  adapter golden files (ADK session → expected CTF; Datadog spans → expected CTF; every
  LooseAdapter row in 07 §3).
- **Property tests:** schema_hash stability (no-config ≡ explicit pass_fail); import
  idempotency (import twice ≡ import once); canonical_json determinism.
- **API tests:** full write-path validation matrix from 05 §3.
- **E2E smoke (Playwright):** the trace-level workflow runs j → 1 → type reason → commit and
  asserts the annotation and progress; a turn-level tool fixture asserts raw source order,
  call-argument visibility, tool-result navigation, and independent tool annotation. (Commit is
  `Cmd/Ctrl+Enter` when a text field holds focus, plain `Enter` in NAV mode — see the keyboard
  model in 06 §2; a bare `Enter` inside a textarea is a newline, not a commit.)
- CI matrix: {macOS, Linux, Windows} × {3.10, 3.12}.

## 5. Launch checklist (adoption levers, from the design discussion)

- README top: one-liner ("Local-first, zero-config labeling for agent traces — keyboard-fast,
  no accounts, no server."), the `uvx tracelabel demo` GIF showing the j/1/Enter flow,
  3-line quickstart, "your traces never leave your machine."
- Positioning section: when to use Label Studio/Argilla instead (platforms; teams; images) —
  honesty here builds trust and keeps our scope disciplined.
- "Teams" section: single-player today; the schema is multi-annotator ready; planned answer
  is `tracelabel merge a.db b.db` + annotation export/import. Say it so teams don't
  disqualify us on day one.
- `docs/trace-format.md` published (public copy of doc 01) — the format is the API.
- License file: Apache-2.0. No CLA for MVP.

## 6. Deliberately unresolved (do not build yet)

Span tagging (new field type; enabled by invariant #1), live Datadog API sync, `--on-conflict
replace`, revision history, multi-user server mode, queue pagination, agreement metrics.
Each has a named future home in these docs; none blocks MVP.
