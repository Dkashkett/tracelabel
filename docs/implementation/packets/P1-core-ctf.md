# P1 — Core CTF (identity, hashing, validation)

**Phase:** 1 · **Depends on:** P0 · **Unblocks:** P2, P3, P4, P10

**Owned files:** `src/tracelabel/ctf.py`, `tests/test_ctf.py`, `tests/test_canonical.py`,
`tests/fixtures/ctf/` (valid + per-rejection-rule JSONL fixtures).

## Objective

Implement the contract of the whole tool: CTF v1 models, the six validation rules,
content-type detection, `canonical_json`/hash identity, and the error type whose message
quality is an adoption feature.

## Required reading

- `docs/design/01-canonical-trace-format.md` — **all of it; it is normative pseudocode**
- `docs/design/07-import-export.md` §5 (error UX + known-mistake table)
- `01-interfaces.md` §3 (your frozen signatures, including the two DECISIONs on hashing
  input and parts serialization)

## Implementation notes

- Everything in `01-interfaces.md` §3, exactly. The 01 §6 identity rules and 01 §4
  detection function are contracts — implement their behavior verbatim.
- **Hash input discipline:** `derive_trace_id`/`content_hash` take the *parsed dicts* as
  they arrived (post-adapter), never a Pydantic dump. `validate_ctf_line` therefore returns
  the `TraceIn` model for structured access **and** must not be the thing callers hash —
  document this with the one allowed kind of comment (a *why*, citing 01 §6).
- **Rule ordering in `validate_ctf_line`:** check `format_version` first (a v2 file should
  say "upgrade tracelabel", not fail rule 1), then 01 §7 rules 1→5 in order, first failure
  wins. Rule 6 (duplicate id in file) is *not* here — it needs file scope and lives in P4's
  `import_file`; say so in the module.
- **`CtfError` rendering** must match 07 §5's example shape: `{file}:{line} — {detail}`,
  the rule statement (valid values listed), then `Fixed, it would be:` + indented example,
  then the `--skip-invalid` hint (hint text is appended by P4's pipeline, not here — keep
  `CtfError` message self-contained without the hint).
- **`KNOWN_MISTAKES`:** a small list of `(matcher(obj_or_message) -> bool, rule_name,
  fixed_example_builder)` entries for: legacy `"function"` role (fix → `tool` +
  `tool_call_id`), stringified-JSON `messages` value, missing `content` key. Fallback
  example is the generic tool-use snippet from 01 §8.
- Unknown-key folding is the separate pure helper `fold_unknown_keys(obj) ->
  (folded_obj, warnings)` per the DECISION in `01-interfaces.md` §3. `validate_ctf_line`
  stays pure validation (models are `extra="allow"`, so unfolded input still validates);
  the pipeline (P4) folds first and owns warning dedupe. Never invent keys inside `raw`.
- Fixtures: `tests/fixtures/ctf/valid.jsonl` (a copy of 01 §8's two examples + a parts-array
  trace) and one file per rejection rule (`reject_bad_role.jsonl`, …) so P4 can reuse them.

## Tests

Matrix rows **CTF-01 … CTF-13** and **CAN-01 … CAN-03** (`02-test-matrix.md`). Hypothesis
strategies: JSON-ish dicts with unicode strings for CAN-01/02; arbitrary text including
whitespace-significant strings for CAN-03.

## Verification

```
pytest tests/test_ctf.py tests/test_canonical.py -q
```

## Out of scope

File/JSONL iteration, adapters, duplicate-id-across-file checks, db writes (P3/P4).
