# P7 — AI assist (batch suggestions)

**Phase:** 3 · **Depends on:** P2, P3 · **Unblocks:** P8

**Owned files:** `src/tracelabel/suggest.py`, `tests/test_suggest.py`.

## Objective

`tracelabel suggest`'s engine: batch pre-annotation into the `suggestions` table via
litellm, schema-validated, idempotent over holes, never touching `annotations`
(invariant #2 — the product's integrity claim).

## Required reading

- `docs/design/08-ai-assist.md` — **all of it; §2 flow and §3 prompt shape are normative**
- `docs/design/04-cli.md` §7 (missing-extra message)
- `01-interfaces.md` §9 (frozen signatures), §4 (`validate_annotation_values`), §5
  (`unaddressed_targets`, `targets_without_suggestion`, `upsert_suggestion`)

## Implementation notes

- **Lazy import discipline:** `import litellm` happens inside `run_suggest` only; module
  import of `suggest.py` must never pull litellm (CLAUDE.md; the core stays installable
  without `[ai]`). `ImportError` → the exact 04 §7 message. Missing `cfg.llm` → UserError
  naming the `llm:` YAML block with a two-line fixed example (03 §1 style).
- Target selection per 08 §2 verbatim: unaddressed by `cfg.annotator`; minus existing
  suggestions unless `--overwrite`; then `[:limit]`.
- **Concurrency:** `asyncio` + a semaphore of size `concurrency` around
  `litellm.acompletion(...)` with `response_format={"type": "json_object"}` and cfg's
  model/temperature/max_tokens. Db upserts happen on the event loop after each completion
  (single connection, no cross-thread access). Per-item retry ×2 with backoff; a failure
  after retries logs one line and continues (08 §2).
- **Validation:** parse the model output as JSON; run
  `config.validate_annotation_values(values, status="labeled", fields=cfg.fields)`. On
  failure, one re-ask appending the validator's error message; second failure → failed
  item, **nothing stored** (08 §3 — never store an invalid suggestion).
- **Prompt (08 §3):** implement `build_prompt` to the normative shape.
  `render_fields_spec` derives per-type instruction lines from canonical field dicts
  (choose exactly one of […] / zero or more as a JSON array / short free text, with `help`
  appended when present). `render_transcript` labels roles, marks the target line with
  `>>>`, and summarizes tool calls (`[tool_call: name(args…)]`). Truncation: while over
  `TRANSCRIPT_BUDGET` (24k chars), cut the longest tool-output turn's content to leave a
  `[...truncated N chars...]` marker, repeat.
- Summary print (P8 formats it): return `SuggestSummary`; the "est. cost printed by
  litellm" line comes from litellm's own logging — don't compute costs.
- API keys: never read, never log; litellm handles env vars (invariant #9). If litellm
  raises an auth error, surface its message naming the expected env var — pass through,
  don't wrap into something vaguer.

## Tests

Matrix rows **SUG-01 … SUG-09**. Mock `litellm.acompletion` with `monkeypatch` (module
injected into `sys.modules` for SUG-01's absence case use `monkeypatch.setitem(sys.modules,
"litellm", None)` / delitem to simulate missing). No network, ever, in tests.

## Verification

```
pytest tests/test_suggest.py -q
```

## Out of scope

Per-item UI generation endpoints (never exist — 08 §5), auto-accept (never exists),
agreement scoring, CLI parsing (P8).
