# P4 — Adapters & import pipeline

**Phase:** 2 (start in parallel with P2/P3; **merge after P3** — ADP-14 needs `db.import_trace`) · **Depends on:** P1 (hard), P3 (pipeline tests only) · **Unblocks:** P8

**Owned files:** `src/tracelabel/adapters/__init__.py`, `adapters/loose.py`,
`adapters/adk.py`, `adapters/datadog.py`, `tests/test_adapters.py`, `tests/golden/**`.

## Objective

The "liberal edge": every source format funnels through a thin adapter into clean CTF; the
importer only ever sees validated CTF. Includes format auto-detection, the LooseAdapter
bounce-risk killer, ADK and Datadog mappings, `--as-documents`, and the `import_file`
pipeline with its error UX.

## Required reading

- `docs/design/07-import-export.md` §1–§7 — **all normative** (sniff rules, loose table,
  ADK mapping pseudocode, Datadog strategy, error UX)
- `docs/design/01-canonical-trace-format.md` §7 rule 6 + §8 (duplicate ids; generic example)
- `01-interfaces.md` §6 (frozen signatures), §3 (`validate_ctf_line`, `fold_unknown_keys`,
  `KNOWN_MISTAKES`), §5 (`import_trace` signature only)

## Implementation notes

- **Sniff order is priority order** (07 §2): `[CtfAdapter, AdkAdapter, DatadogAdapter,
  LooseAdapter]` over the first 5 parsed lines; first match wins; no match →
  `die_with_format_help()` (UserError showing the generic CTF snippet + pointer to
  `docs/trace-format.md`).
- **CtfAdapter:** `sniff` = has `messages` list of dicts with `role`; `to_ctf` = identity.
- **LooseAdapter:** implement the 07 §3 table row-for-row. Every applied mapping records one
  note string per (rule, file) — e.g. `interpreted "turns" as "messages" on 412 lines` —
  aggregated in `ImportSummary.notes`. Anything not matching a row → the §5 error, never a
  guess. Role synonym map exactly: `human→user`, `ai/bot/agent→assistant`.
- **AdkAdapter:** the 07 §6 pseudocode is the mapping contract: one session → one trace;
  `author=="user"` → user else assistant with `name`=author; text parts concatenated;
  `function_call` parts → inline `tool_calls` with `arguments` as a **raw JSON string**
  (`canonical_json(args)` is acceptable since ADK gives parsed objects — note this: the
  string is *created* here, not reformatted, so invariant #1 is satisfied); `function_response`
  parts → separate `tool` turns; `invocationId` → turn metadata; unmapped → `raw`;
  `sniff` = `events` list with `author`/`invocation_id` keys or the session envelope.
- **DatadogAdapter:** per 07 §7 — accept a JSON array or JSONL of spans; group by
  `trace_id`, order by `start_ns`; LLM spans' `meta.input.messages`/`meta.output.messages`
  → user/assistant turns with history dedupe by content hash; tool spans → `tool_calls` +
  `tool` turns; span ids/timings → turn metadata; unmapped → `raw`; `source: "datadog"`.
  Keep the golden file small (2 traces, ~6 spans) — it *is* the spec of the mapping.
- **`iter_source`:** parses JSONL (or whole file for `--as-documents` on `.txt/.html/.json`),
  routes `--from`, yields `(line_no, ctf_dict)`. `--as-documents` per 07 §4 verbatim —
  content byte-for-byte, including trailing whitespace of whole files.
- **`import_file`:** per line → `fold_unknown_keys` → `validate_ctf_line` → duplicate-id
  check (`{id: first_line}`; error names both line numbers) → `db.import_trace`. Fail-fast
  on first `CtfError` unless `skip_invalid` (then collect formatted errors, continue,
  summarize). Append the `--skip-invalid` hint line when failing fast. Wrap every 500
  traces in one transaction (09 §3).
- **Golden layout:** `tests/golden/{adk,datadog,loose}/input.(json|jsonl)` +
  `expected.jsonl`; assert parsed-JSON equality **and** byte-equality of every content
  string (ADP-13).

## Tests

Matrix rows **ADP-01 … ADP-14** (ADP-14 requires P3 merged; keep it last in the file).

## Verification

```
pytest tests/test_adapters.py -q
```

## Out of scope

CLI wiring (P8), export (P6), live Datadog API sync (explicit post-MVP, 07 §7).
