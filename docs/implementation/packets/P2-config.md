# P2 — Config (raw models, resolution, schema hash, shared validator)

**Phase:** 2 · **Depends on:** P1 · **Unblocks:** P5, P7, P8 (and P3's `open_task` uses the frozen `ResolvedTaskConfig` shape)

**Owned files:** `src/tracelabel/config.py`, `tests/test_config.py`.

## Objective

The YAML/CLI → `ResolvedTaskConfig` boundary. After this packet, nothing downstream ever
sees defaults, presets, or raw config (CLAUDE.md: "one resolved schema flows downstream").
Also home of the shared annotation-values validator used by both server and suggest.

## Required reading

- `docs/design/03-config.md` — **all of it; §2–§6 are normative code**
- `docs/design/05-http-api.md` §3 (the validator you are implementing the schema half of)
- `01-interfaces.md` §4 (frozen signatures incl. `CliArgs`, `load_config` DECISION)

## Implementation notes

- 03 §2 Pydantic models **verbatim**, including `extra="forbid"` everywhere and the
  `FieldDef` model_validator rules. Do not soften; typo'd keys must be hard errors.
- `DEFAULT_FIELDS`, `PRESETS`, `expand`, `canonical_field_dict`, `schema_hash`, `resolve`,
  `default_task_name`: implement the 03 §3–§6 pseudocode exactly. The one property that
  must hold (and is pinned by CFG-04): **no-config and explicit `pass_fail` preset produce
  the same `schema_hash`** — this is what makes their labels compatible.
- Note the label default in `canonical_field_dict`: `f.name.replace("_", " ").capitalize()`
  (exactly that — `.capitalize()`, not `.title()`; 03 §6).
- **Error formatting (03 §7):** wrap Pydantic's `ValidationError` into `UserError` whose
  message is `"{file}: {dotted.loc.path}: {msg}"` plus, for `Literal`/enum failures, a
  did-you-mean line (`difflib.get_close_matches` over the allowed values) and the list of
  valid values. Cover the 03 §7 example verbatim in a test.
- `raw_config_for_target`: `.yaml`/`.yml` → `load_config`; `.jsonl`/`.json` →
  `RawConfig(data=target.resolve())`; other suffix → UserError naming both accepted forms.
- `validate_annotation_values(values, status, fields)`: 05 §3 logic minus db checks —
  skipped-with-values, unknown field, single_select membership, multi_select
  list/membership/dupes, text is-str, required-truthy (empty string and empty list are
  not truthy). Raise `UserError` whose message names the field and the offending value.
- `resolve` must not read the filesystem or db — pure function of `(raw, cli)` (data-path
  existence is checked later by the import pipeline).

## Tests

Matrix rows **CFG-01 … CFG-13**. CFG-13 mirrors the API matrix cases (API-07…API-13) at
the function level so P5 only re-tests the HTTP mapping + db-dependent cases.

## Verification

```
pytest tests/test_config.py -q
```

## Out of scope

The db-dependent halves of write-path validation (P5); reading data files; CLI flag parsing
(P8 builds `CliArgs` and calls in).
