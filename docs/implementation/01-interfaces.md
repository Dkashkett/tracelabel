# 01 — Frozen Interfaces

**Status: FROZEN.** These are the cross-module contracts that make parallel packets safe.
Packets import and call exactly these names with exactly these signatures. Behavior semantics
live in the cited design-doc sections; this file pins *names, types, locations,* and the
handful of decisions the specs left open (each marked **DECISION**).

## 1. Change protocol

A packet that needs a different signature must (a) edit this file first, (b) note the change
in its final report, (c) check the *Used by* line here and update callers only if they are in
an **earlier or same** phase and already merged — otherwise just fixing this file is enough,
because later packets haven't been built yet. Silent deviation is a defect.

Type aliases used throughout:

```python
Level      = Literal["turn", "trace"]
TargetType = Literal["turn", "trace"]   # always equals the task's level
FieldType  = Literal["single_select", "multi_select", "text"]
Json       = dict[str, Any]
```

## 2. `errors.py` (built by P0; used by everyone)

```python
class TraceLabelError(Exception):
    exit_code: ClassVar[int] = 1

class UserError(TraceLabelError):    # bad config/data/usage → exit 1 (04 §9)
    exit_code = 1

class EnvError(TraceLabelError):     # ports exhausted, live lock, db newer than app → exit 2
    exit_code = 2
```

Library code **raises**; only `cli.py` catches `TraceLabelError`, prints `str(e)` to stderr,
and exits with `e.exit_code`. No `sys.exit` anywhere else.

## 3. `ctf.py` (P1) — canonical format, identity, hashing

Spec: `01-canonical-trace-format.md` (all), `07-import-export.md` §5 (fix examples).

```python
def canonical_json(x: Any) -> str
    # json.dumps(x, sort_keys=True, separators=(",", ":"), ensure_ascii=False)  — 01 §6

def sha256_hex(s: str) -> str                    # hashlib, utf-8

def detect_content_type(s: str) -> Literal["text", "json", "html"]     # 01 §4, verbatim

def content_type_of(content: str | list[Json]) -> Literal["text", "json", "html", "parts"]
    # str → detect_content_type(content); list → "parts"

def serialize_content(content: str | list[Json]) -> str
    # str → returned UNCHANGED (invariant #1); list → canonical_json(content).
    # DECISION: the parts *array wrapper* is ours to serialize (deterministically, via
    # canonical_json); the strings INSIDE parts (text / json_string / html) are never touched.

def derive_trace_id(messages: list[Json]) -> str   # "t_" + sha256_hex(canonical_json(messages))[:32]
def content_hash(messages: list[Json]) -> str      # full 64-char sha256_hex(canonical_json(messages))
    # DECISION: hash input is the parsed post-adapter message dicts exactly as they arrived
    # (01 §6 "after adapter mapping, before any storage") — NEVER a Pydantic model_dump.
```

Pydantic models (all `model_config = ConfigDict(extra="forbid")` unless noted):

```python
class ToolCallFunction(BaseModel):  name: str; arguments: str          # raw string, never parsed
class ToolCall(BaseModel):          id: str; type: Literal["function"]; function: ToolCallFunction
class ContentPart(BaseModel):
    type: Literal["text", "json", "html"]
    text: str | None = None; json_string: str | None = None; html: str | None = None
    # validator: exactly the field matching `type` must be set

class MessageIn(BaseModel):         # extra="allow" — see DECISION below
    role: Literal["system", "user", "assistant", "tool", "document"]
    content: str | list[ContentPart]
    tool_calls: list[ToolCall] | None = None
    tool_call_id: str | None = None
    name: str | None = None
    metadata: Json = {}
    raw: Json | None = None

class TraceIn(BaseModel):           # extra="allow" — 01 §2: unknown keys → raw, warn, never fatal
    format_version: int = 1
    id: str | None = None
    source: str | None = None
    metadata: Json = {}
    messages: list[MessageIn]       # min_length=1
    raw: Json | None = None
```

```python
class CtfError(UserError):
    def __init__(self, file: str, line: int, rule: str, detail: str,
                 fixed_example: str | None = None): ...
    # __str__ renders the 07 §5 shape: "{file}:{line} — {detail}\n…\nFixed, it would be:\n\n  {example}\n"

def validate_ctf_line(obj: Json, file: str, line_no: int) -> TraceIn
    # Enforces 01 §7 rules 1–5 (rule 6, duplicate id in file, belongs to the pipeline — §7 below).
    # Consults KNOWN_MISTAKES for the fixed_example; falls back to the generic 01 §8 snippet.

KNOWN_MISTAKES: list[MistakePattern]
    # 07 §5 table: legacy "function" role, stringified-JSON messages, missing content,
    # each with matcher + targeted fix example. Exposed so adapters (P4) reuse it.
```

**DECISION — unknown keys:** a separate pure helper owns the folding, keeping
`validate_ctf_line` clean:

```python
def fold_unknown_keys(obj: Json) -> tuple[Json, list[str]]
    # Moves unknown trace-level keys into obj["raw"] (per 01 §2) and unknown message-level
    # keys into that message's "raw" (per 01 §3). Returns (folded_obj, warning_strings).
```

The pipeline (P4) calls `fold_unknown_keys` before `validate_ctf_line` and dedupes warnings
to once per key per file. The models are `extra="allow"` so an unfolded object still
validates rather than crashing.

*Used by:* P2 (sha256_hex, canonical_json), P3 (all serialization + hashing), P4
(validate_ctf_line, KNOWN_MISTAKES), P10 (validate_ctf_line).

## 4. `config.py` (P2) — YAML → ResolvedTaskConfig, schema hash, shared validator

Spec: `03-config.md` (all), `05-http-api.md` §3 (validator).

Models exactly per 03 §2: `FieldDef`, `PresetRef`, `LLMConfig`, `RawConfig`, plus:

```python
class SuggestConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instructions: str | None = None
```

Constants & pure functions per 03 §3/§5/§6, names verbatim: `DEFAULT_FIELDS`, `PRESETS`,
`expand(items) -> list[FieldDef]`, `canonical_field_dict(f) -> dict`,
`schema_hash(fields) -> str` (imports `ctf.sha256_hex`).

```python
@dataclass(frozen=True)
class CliArgs:                       # what cli.py hands to resolve(); all None = "not given"
    data: Path | None = None
    task: str | None = None
    level: Level | None = None
    annotator: str | None = None
    shuffle: bool | None = None
    db: Path | None = None
    yes: bool = False

@dataclass(frozen=True)
class ResolvedTaskConfig:            # 03 §4, verbatim fields
    name: str; level: Level
    fields: list[dict]               # canonical field dicts, order significant
    label_roles: list[str]
    shuffle: bool; annotator: str; schema_hash: str
    data_path: Path
    llm: LLMConfig | None
    suggest_instructions: str | None

def load_config(path: Path) -> RawConfig
    # yaml.safe_load + Pydantic; errors formatted per 03 §7 (file, YAML path, fixed example)
    # and raised as UserError. DECISION: resolves raw.data against path.parent before returning
    # (03 §1 "relative to this file"), so resolve() never needs to know where the YAML lived.

def raw_config_for_target(target: Path) -> RawConfig
    # .yaml/.yml → load_config(target); .jsonl/.json → RawConfig(data=target.resolve())
    # anything else → UserError naming accepted extensions. (04 §1 TARGET semantics.)

def resolve(raw: RawConfig, cli: CliArgs) -> ResolvedTaskConfig       # 03 §4, verbatim
def default_task_name(data: Path) -> str                              # f"{data.stem}-{date.today().isoformat()}"

def validate_annotation_values(values: Mapping[str, str | list[str]],
                               status: Literal["labeled", "skipped"],
                               fields: list[dict]) -> None
    # The 05 §3 pseudocode MINUS the db-dependent checks (target existence/labelable —
    # those live in server.py). Raises UserError with the actionable message; the server
    # maps it to HTTP 422, suggest (08 §3) treats it as a failed item.
    # DECISION: shared here because both P5 and P7 need identical validation.
```

*Used by:* P3 (`ResolvedTaskConfig` in `open_task`), P5, P7, P8.

## 5. `db.py` (P3) — storage, migrations, lock, normative writes

Spec: `02-database.md` (all), `04-cli.md` §3 (queue).

```python
def now_iso() -> str                                  # UTC, "%Y-%m-%dT%H:%M:%SZ"
def default_db_path(project_dir: Path) -> Path        # project_dir / ".tracelabel" / "tracelabel.db"

def open_db(db_path: Path) -> sqlite3.Connection
    # mkdir parents; connect(check_same_thread=False); row_factory = sqlite3.Row;
    # PRAGMA journal_mode=WAL, foreign_keys=ON, busy_timeout=5000; then upgrade(conn).

MIGRATIONS: list[Callable[[sqlite3.Connection], None]]     # [migrate_001_initial]
def upgrade(conn) -> None            # 02 §3 verbatim; newer-db → EnvError

def acquire_lock(project_dir: Path, port: int) -> None     # 02 §1 verbatim; live pid → EnvError
def release_lock(project_dir: Path) -> None                # idempotent; registered via atexit

ImportResult = Literal["inserted", "skipped_duplicate", "skipped_conflict"]
def import_trace(conn, ctf: Json, source: str,
                 on_conflict: Literal["fail", "skip"] = "fail") -> ImportResult
    # 02 §4 verbatim. `ctf` is a validated CTF dict (post validate_ctf_line, model re-dumped
    # is FORBIDDEN — pass the original dicts; see ctf.py hashing DECISION).
    # conflict + on_conflict="fail" → UserError with the 02 §4 message.

def open_task(conn, resolved: ResolvedTaskConfig, assume_yes: bool,
              confirm: Callable[[str], bool] | None = None) -> None
    # 02 §5 verbatim. confirm defaults to a stdin y/N prompt; injected for tests.
    # Declined drift → UserError("Aborted. Use a new --task name…").

def upsert_annotation(conn, *, task: str, target_type: TargetType, target_id: str,
                      status: str, values: Json, annotator: str,
                      schema_hash: str, prefill_model: str | None) -> sqlite3.Row
    # 02 §6 verbatim; returns the stored row (server echoes it back).

def upsert_suggestion(conn, *, task: str, target_type: TargetType, target_id: str,
                      values: Json, model: str, raw_response: str | None) -> None
    # INSERT … ON CONFLICT(task,target_type,target_id) DO UPDATE (02 schema: one live suggestion)

def build_queue(conn, task_name: str) -> list[str]         # 04 §3 verbatim (stored seed)
```

Read helpers (thin, typed rows; used by P5/P6/P7/P8):

```python
def get_task(conn, name: str) -> sqlite3.Row | None
def list_tasks(conn) -> list[Json]
    # per task: name, level, schema_hash, updated_at, total, addressed (02 §7 queries)
def get_trace(conn, trace_id: str) -> sqlite3.Row | None
def get_turns(conn, trace_id: str) -> list[sqlite3.Row]                 # ORDER BY idx
def annotations_for_trace(conn, task: str, annotator: str, trace_id: str) -> list[sqlite3.Row]
def suggestions_for_trace(conn, task: str, trace_id: str) -> list[sqlite3.Row]
def target_counts(conn, task_row: sqlite3.Row, annotator: str) -> dict[str, tuple[int, int, int]]
    # trace_id → (n_targets, n_labeled, n_skipped); one query, drives /api/queue + /api/progress
def unaddressed_targets(conn, cfg: ResolvedTaskConfig) -> list[str]     # target ids w/o annotation by cfg.annotator
def targets_without_suggestion(conn, task: str, target_ids: list[str]) -> list[str]
```

**DECISION:** all JSON columns are written with `ctf.canonical_json`, except `turns.content`
which is `ctf.serialize_content` (invariant #1). Batch imports wrap every 500 traces in one
transaction (09 §3 throughput NFR) — that batching lives in P4's `import_file`, not here.

## 6. `adapters/` (P4) — pipeline + LooseAdapter/ADK/Datadog

Spec: `07-import-export.md` §1–§7, `01` §7 rule 6.

Layout: protocol + `CtfAdapter` + `detect` + `iter_source` + `import_file` in
`adapters/__init__.py`; `adapters/loose.py`, `adapters/adk.py`, `adapters/datadog.py`.

```python
class Adapter(Protocol):                                   # 07 §1 verbatim
    name: str
    def sniff(self, first_lines: list[Json]) -> bool: ...
    def to_ctf(self, obj: Json) -> Iterator[Json]: ...

ADAPTERS: list[Adapter]        # [CtfAdapter, AdkAdapter, DatadogAdapter, LooseAdapter] — priority order 07 §2
def detect(first_lines: list[Json]) -> Adapter             # no match → UserError via die_with_format_help (07 §5)

def iter_source(path: Path, from_: str = "auto",
                as_documents: bool = False) -> Iterator[tuple[int, Json]]
    # yields (source_line_no, ctf_dict). Handles: JSONL line parsing, --from routing,
    # as_documents wrapping (07 §4), whole-file modes (.txt/.html/.json single doc).

@dataclass
class ImportSummary:
    inserted: int = 0; skipped_duplicate: int = 0; skipped_conflict: int = 0
    invalid: list[str] = field(default_factory=list)       # formatted CtfError strings
    notes: list[str] = field(default_factory=list)         # loose-mapping summary lines (07 §3)

def import_file(conn, path: Path, from_: str = "auto",
                on_conflict: Literal["fail", "skip"] = "fail",
                skip_invalid: bool = False, as_documents: bool = False) -> ImportSummary
    # detect → to_ctf → validate_ctf_line → duplicate-id-in-file check (01 §7.6, tracks
    # {id: first_line}, error names both lines) → db.import_trace. Fail-fast unless
    # skip_invalid; batches of 500 per transaction; source = adapter.name.
```

*Used by:* P8 (`import` and `serve` commands call `import_file`).

## 7. `server.py` (P5) — FastAPI app

Spec: `05-http-api.md` (all).

```python
def build_app(conn: sqlite3.Connection, cfg: ResolvedTaskConfig, queue: list[str],
              static_dir: Path | None = None) -> FastAPI
    # static_dir defaults to Path(__file__).parent / "static"
```

Endpoints and Pydantic response models **exactly** per 05 §1–§2 (`SessionInfo`, `QueueEntry`,
`TraceDetail`, `TurnOut`, `AnnotationIn`, `AnnotationOut`, `SuggestionOut`, `Progress`).
`AnnotationIn` is `extra="forbid"`. `SessionInfo.fields` passes the canonical field dicts
through unmodified.

**DECISIONS:**
- All endpoints are `async def` **without** internal awaits on the db — FastAPI then runs
  them on the single event loop, serializing access to the one sqlite connection
  (`check_same_thread=False` + `busy_timeout` are the backstop). Do not use sync `def`
  endpoints (threadpool would race the shared connection).
- Write path: 05 §3 = `config.validate_annotation_values` for schema checks + server-side
  target checks (`404` unknown trace/target, `422` target_type≠level, `422` non-labelable
  turn i.e. role ∉ `cfg.label_roles`). `UserError` from the validator → HTTP 422 with
  `{"detail": str(e)}`.
- Static: `/assets` mounted from `static_dir` with `Cache-Control: public, max-age=31536000,
  immutable`; `/` and any non-`/api` path → `static_dir/index.html`; missing `index.html` →
  503 `{"detail": "frontend not built — run `npm run build` in frontend/ or use the Vite dev server"}`.

*Used by:* P8 (`serve`), P11 (e2e).

## 8. `export.py` (P6)

Spec: `04-cli.md` §5, `07-import-export.md` §8.

```python
def export_annotations(conn, task: str, fmt: Literal["jsonl", "csv"],
                       joined: bool, out: Path | None,
                       status: Literal["labeled", "skipped", "all"] = "all") -> int
    # returns rows written. out=None → Path(f"{task}-annotations.{fmt}") in CWD;
    # Path("-") → stdout. Unknown task → UserError listing existing task names.
```

Column order is a **stable API** (04 §5): `task, trace_id, target_type, target_id,
turn_index, annotator, status, prefill_model, schema_hash, created_at, updated_at`,
then `value.<field>` per resolved-schema field order; `--joined` appends `role, content,
content_type` (turn) or `messages, trace_metadata` (trace).

## 9. `suggest.py` (P7)

Spec: `08-ai-assist.md` (all), `04-cli.md` §7.

```python
@dataclass
class SuggestSummary: ok: int; failed: int; skipped_existing: int

def run_suggest(cfg: ResolvedTaskConfig, conn, *, limit: int | None,
                overwrite: bool, concurrency: int = 4) -> SuggestSummary
    # 08 §2 verbatim. litellm imported INSIDE this function; ImportError →
    # UserError("AI assist needs the optional extra: pip install 'tracelabel[ai]'").
    # cfg.llm is None → UserError pointing at the `llm:` YAML block (03 §1).

@dataclass
class TargetContext: turns: list[sqlite3.Row]; target_id: str; target_idx: int | None

def build_prompt(cfg: ResolvedTaskConfig, ctx: TargetContext) -> str    # 08 §3 verbatim
TRANSCRIPT_BUDGET = 24_000            # chars; truncate longest tool outputs first (08 §3)
```

## 10. `cli/app.py` + `__main__.py` (P8)

Spec: `04-cli.md` (all).

Typer app named `app`; commands `serve, import (name="import"), export, tasks list, suggest,
demo` with the exact flags of 04 §1. The pyproject entry point and `__main__.py` both target
`run` (not `app`): `tracelabel = "tracelabel.cli.app:run"`.

```python
def pick_port(requested: int = 8377) -> int    # try requested…requested+9; exhausted → EnvError
def run() -> None                              # wraps app(): TraceLabelError → stderr + exit_code;
                                               # KeyboardInterrupt → release_lock + exit 130
```

**DECISIONS** (both now codified in the design docs):
- `serve`/`suggest` with TARGET omitted: use `./config.yaml` if it exists, else UserError
  ("No data file given (arg or `data:` in YAML)") — per 04 §1.
- `demo` accepts `--no-browser` (needed for CI e2e) — per 04 §1/§8.
- `serve` order is fixed: `raw_config_for_target → resolve → open_db → pick_port →
  acquire_lock → import_file → open_task → build_queue → build_app → webbrowser.open →
  uvicorn.run(host="127.0.0.1")` (04 §2). **No `--host` flag exists** (invariant #6).

## 11. Frontend contract (P9)

The TypeScript interfaces in **05 §2 are copied verbatim** into `frontend/src/api/types.ts` —
that file is the frontend's only contract with the backend. Fetch base is same-origin (`""`);
`vite.config.ts` proxies `/api` → `http://127.0.0.1:8377` in dev. Mock fixtures satisfying
those types live in `frontend/src/mocks/fixtures.ts`; `VITE_MOCK=1` makes the API layer
serve fixtures instead of fetching (lets P9 run before P5 exists). File layout in packet P9.
