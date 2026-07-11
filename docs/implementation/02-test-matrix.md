# 02 — Test Matrix

Every normative rule in the design docs, pinned to a named test (CLAUDE.md testing bar +
`09-packaging-security.md` §4). Packet docs reference rows by ID. Test names are the
contract; an executing agent may add tests but not rename or drop these.

Conventions: pytest, plain `assert`. Property tests use `hypothesis`. API tests use
`fastapi.testclient.TestClient` over `build_app` with an in-memory-ish tmp db. Golden files
under `tests/golden/<adapter>/{input.*,expected.jsonl}` compared as parsed JSON.

## CTF core (P1) — `tests/test_ctf.py`, `tests/test_canonical.py`

| ID | Rule (spec §) | Test |
|---|---|---|
| CTF-01 | `messages` present & non-empty (01 §7.1) | `test_ctf.py::test_reject_missing_messages`, `::test_reject_empty_messages` |
| CTF-02 | valid `role` + `content` key on every message (01 §7.1) | `::test_reject_bad_role`, `::test_reject_missing_content` |
| CTF-03 | `tool_calls` only on assistant (01 §7.2) | `::test_reject_tool_calls_on_user` |
| CTF-04 | `tool_call_id` only on tool (01 §7.2) | `::test_reject_tool_call_id_on_assistant` |
| CTF-05 | `content==""` only with non-empty `tool_calls` (01 §7.3) | `::test_reject_empty_content_without_tool_calls`, `::test_accept_empty_content_with_tool_calls` |
| CTF-06 | `document` only in single-message traces (01 §7.4) | `::test_reject_document_in_multi_message_trace` |
| CTF-07 | `format_version > 1` rejected w/ upgrade msg (01 §7.5, §9) | `::test_reject_future_format_version` |
| CTF-08 | error shape: file:line + rule + fixed example (01 §7, 07 §5) | `::test_ctf_error_includes_location_and_fixed_example` |
| CTF-09 | known-mistake fix: legacy `function` role (07 §5) | `::test_fix_example_for_legacy_function_role` |
| CTF-10 | content-type detection text/json/html (01 §4) | `::test_detect_content_type_matrix` |
| CTF-11 | parts arrays → `content_type="parts"`; inner strings verbatim (01 §4) | `::test_parts_content_roundtrip_verbatim` |
| CTF-12 | unknown top-level keys → `raw`, never fatal (01 §2) | `::test_unknown_trace_keys_preserved_into_raw` |
| CTF-13 | derived id = `t_` + hash[:32]; provided id verbatim (01 §6) | `::test_derive_trace_id`, `::test_provided_id_verbatim` |
| CAN-01 | `canonical_json` determinism: key order/whitespace invariance (01 §6) | `test_canonical.py::test_canonical_json_key_order_invariant` *(hypothesis)* |
| CAN-02 | same messages → same hash → same id, unicode-safe (01 §6) | `::test_content_hash_stable` *(hypothesis)* |
| CAN-03 | `serialize_content` returns strings unchanged, byte-for-byte (inv. #1) | `::test_serialize_content_verbatim_strings` *(hypothesis)* |

## Config (P2) — `tests/test_config.py`

| ID | Rule (spec §) | Test |
|---|---|---|
| CFG-01 | no `fields` → exactly DEFAULT_FIELDS (03 §3) | `::test_default_fields_when_absent` |
| CFG-02 | custom fields replace, never merge (inv. #4) | `::test_custom_fields_replace_defaults` |
| CFG-03 | preset expands in place, order preserved (03 §5) | `::test_preset_expansion_order` |
| CFG-04 | **no-config ≡ explicit pass_fail preset → identical schema_hash** (03 §6) | `::test_schema_hash_noconfig_equals_pass_fail_preset` |
| CFG-05 | field order changes the hash; key order inside dicts does not (03 §6) | `::test_schema_hash_field_order_significant` |
| CFG-06 | select needs ≥2 unique options; text takes no options/no placeholder-on-select (03 §2) | `::test_fielddef_validation_matrix` |
| CFG-07 | duplicate field names → hard error (03 §4) | `::test_duplicate_field_names_rejected` |
| CFG-08 | unknown YAML keys rejected with location + suggestion (03 §2, §7) | `::test_unknown_key_error_names_file_and_path` |
| CFG-09 | `api_key` in `llm:` rejected by construction (inv. #9, 09 §2) | `::test_api_key_in_yaml_rejected` |
| CFG-10 | precedence CLI > YAML > default (03 §1) | `::test_precedence_cli_over_yaml_over_default` |
| CFG-11 | `data:` resolved relative to the YAML file (03 §1) | `::test_data_path_relative_to_config_file` |
| CFG-12 | default task name `{stem}-{date}` ; default label_roles ; default annotator (03 §4) | `::test_resolution_defaults` |
| CFG-13 | validator: full 05 §3 schema matrix (shared function) | `::test_validate_values_matrix` — cases mirror API-07…API-13 below (the schema-only checks; target/level checks are server-side) |

## Database (P3) — `tests/test_db.py`

| ID | Rule (spec §) | Test |
|---|---|---|
| DB-01 | pragmas set on open (WAL, FK, busy_timeout) (02 §1) | `::test_open_db_pragmas` |
| DB-02 | migration 001 creates full DDL; `user_version==1` (02 §2–3) | `::test_migration_001_schema` |
| DB-03 | db newer than app → EnvError with upgrade message (02 §3) | `::test_newer_db_refused` |
| DB-04 | **import idempotency: twice ≡ once** (02 §4) | `::test_import_twice_skipped_duplicate` *(property-style: counts + table state equal)* |
| DB-05 | same id, different content → UserError by default (inv. #5, 02 §4) | `::test_import_conflict_fails_loud` |
| DB-06 | `--on-conflict skip` keeps stored version + warns (02 §4) | `::test_import_conflict_skip` |
| DB-07 | turns stored verbatim, ids `{trace}#{idx}` (02 §4, 01 §6) | `::test_turn_rows_verbatim_and_ids` |
| DB-08 | task create stores seed iff shuffle (02 §5, 04 §3) | `::test_open_task_seed_only_when_shuffle` |
| DB-09 | level mismatch on existing task → UserError (02 §5) | `::test_open_task_level_mismatch` |
| DB-10 | schema drift: declined → UserError; confirmed/--yes → updated (inv. #5, 02 §5) | `::test_drift_declined_aborts`, `::test_drift_confirmed_updates` |
| DB-11 | annotation upsert last-write-wins, unique per (task,type,id,annotator) (02 §6, inv. #3) | `::test_upsert_annotation_lww` |
| DB-12 | suggestion upsert replaces (one live suggestion) (02 schema) | `::test_upsert_suggestion_replaces` |
| DB-13 | shuffle stable across resume: same seed → same order (04 §3, "deterministic") | `::test_build_queue_stable_across_reopen` |
| DB-14 | stale lock removed; live lock → EnvError with pid+port (02 §1) | `::test_lock_stale_reclaimed`, `::test_lock_live_refused` |
| DB-15 | progress counts in native units (02 §7) | `::test_target_counts_turn_and_trace_level` |

## HTTP API (P5) — `tests/test_api.py` (the 05 §3 write-path matrix)

| ID | Case | Expect |
|---|---|---|
| API-01 | `GET /api/session` returns task/fields in schema order | 200, fields order == resolved order |
| API-02 | `GET /api/queue` positions follow queue order; counts correct | 200 |
| API-03 | `GET /api/traces/{id}` unknown id | 404 |
| API-04 | PUT: `target_type` ≠ task level | 422 |
| API-05 | PUT: unknown target id | 404 |
| API-06 | PUT: turn target whose role ∉ label_roles | 422 |
| API-07 | PUT: `status=skipped` with non-empty values | 422 |
| API-08 | PUT: unknown field name | 422 |
| API-09 | PUT: single_select value not in options | 422 |
| API-10 | PUT: multi_select not-a-list / bad member / duplicates (3 cases) | 422 |
| API-11 | PUT: text value not a string | 422 |
| API-12 | PUT: required field missing | 422 |
| API-13 | PUT: required field empty string / empty list | 422 |
| API-14 | PUT: valid labeled commit | 200; row in db; `schema_hash` = task's current |
| API-15 | PUT: second commit same target updates row (`updated_at` advances) | 200 |
| API-16 | PUT: valid skip | 200; status `skipped`, values `{}` |
| API-17 | PUT: `prefill_model` persisted and echoed (inv. #2 provenance) | 200 |
| API-18 | `GET /api/progress` reflects commits, native unit | 200 |
| API-19 | suggestions returned in TraceDetail; never merged into annotations (inv. #2) | 200 |
| API-20 | unknown non-/api path → index.html; `/api/nope` → 404 JSON (05 §5) | — |
| API-21 | extra keys in AnnotationIn body rejected (`extra="forbid"`) | 422 |

Test names: `test_api.py::test_<id-slug>` e.g. `::test_skip_with_values_422` — one per row.

## Adapters (P4) — `tests/test_adapters.py` + `tests/golden/`

| ID | Rule (spec §) | Test |
|---|---|---|
| ADP-01 | sniff priority order ctf→adk→datadog→loose (07 §2) | `::test_detect_priority_order` |
| ADP-02 | golden: ADK session → expected CTF (07 §6, incl. tool_calls inline + tool turns + multi-agent `name`) | `::test_golden_adk` |
| ADP-03 | golden: Datadog spans → expected CTF (07 §7, grouping by trace_id, span meta → metadata) | `::test_golden_datadog` |
| ADP-04 | loose: bare message list per line (07 §3 row 1) | `::test_loose_bare_message_list` |
| ADP-05 | loose: `conversation`/`turns`/`chat` key rename + note (row 2) | `::test_loose_alias_keys` |
| ADP-06 | loose: plain string line → document trace (row 3) | `::test_loose_plain_string_document` |
| ADP-07 | loose: `speaker`/`from` + `human/ai/bot/agent` role mapping (row 4) | `::test_loose_role_synonyms` |
| ADP-08 | loose: LangSmith `inputs.messages`/`outputs` best-effort (row 5) | `::test_loose_langsmith` |
| ADP-09 | ambiguous input → format-help error, not a guess (07 §2, §5) | `::test_undetectable_input_dies_with_help` |
| ADP-10 | duplicate id within one file → error naming both lines (01 §7.6) | `::test_duplicate_id_in_file_names_both_lines` |
| ADP-11 | `--skip-invalid` imports valid lines + summary (01 §7) | `::test_skip_invalid_summary` |
| ADP-12 | `--as-documents`: jsonl lines and whole `.txt`/`.html` files, content verbatim (07 §4) | `::test_as_documents_modes` |
| ADP-13 | adapters never reformat content; unmapped fields land in `raw` (07 §1, inv. #1) | asserted inside ADP-02/03 goldens (byte-equal content strings) |
| ADP-14 | pipeline: `import_file` end-to-end into db with batching (02 §4, 09 §3) | `::test_import_file_pipeline` *(requires P3 merged)* |

## Export (P6) — `tests/test_export.py`

| ID | Rule (spec §) | Test |
|---|---|---|
| EXP-01 | column set + order is the stable long format (04 §5) | `::test_columns_stable_snapshot` |
| EXP-02 | CSV multi-select cell is a JSON-array string loadable by `json.loads` (04 §5) | `::test_csv_multiselect_json_array` |
| EXP-03 | `--joined` turn-level adds role/content/content_type; trace-level adds messages+metadata (04 §5) | `::test_joined_turn_level`, `::test_joined_trace_level` |
| EXP-04 | `--status` filter; skipped rows have empty values (04 §5) | `::test_status_filter` |
| EXP-05 | `--out -` → stdout; default filename `<task>-annotations.<fmt>` (04 §5) | `::test_out_stdout_and_default_name` |
| EXP-06 | works with no server running — pure db op (inv. #10) | implicit: tests never start a server |
| EXP-07 | suggestions are never exported (08 §1) | `::test_suggestions_not_exported` |

## Suggest (P7) — `tests/test_suggest.py` (litellm mocked via `monkeypatch`)

| ID | Rule (spec §) | Test |
|---|---|---|
| SUG-01 | missing litellm → exact extra-install message (04 §7) | `::test_missing_litellm_message` |
| SUG-02 | missing `llm:` config → actionable UserError (08 §2) | `::test_missing_llm_config` |
| SUG-03 | only unaddressed targets; holes-only on re-run; `--overwrite` regenerates (08 §2) | `::test_targets_idempotent_and_overwrite` |
| SUG-04 | invalid model output after one re-ask → failed item, **nothing stored** (08 §3) | `::test_invalid_output_never_stored` |
| SUG-05 | valid output validated with the shared validator, stored via upsert-replace (08 §2) | `::test_valid_suggestion_stored` |
| SUG-06 | prompt built from resolved schema; custom fields appear; target marked (08 §3) | `::test_build_prompt_contains_fields_and_target` |
| SUG-07 | transcript >24k chars truncates longest tool outputs first w/ marker (08 §3) | `::test_transcript_truncation` |
| SUG-08 | per-item failures don't abort the batch; summary counts (08 §2) | `::test_per_item_failure_continues` |
| SUG-09 | suggestions never touch `annotations` (inv. #2) | `::test_no_annotation_rows_created` |

## CLI (P8) — `tests/test_cli.py` (Typer `CliRunner`)

| ID | Rule (spec §) | Test |
|---|---|---|
| CLI-01 | exit codes: config error→1, env error→2 (04 §9) | `::test_exit_code_user_error`, `::test_exit_code_env_error` |
| CLI-02 | port fallback tries next 10 then exit 2 (04 §2, §9) | `::test_pick_port_fallback_and_exhaustion` |
| CLI-03 | import summary line format (04 §4) | `::test_import_summary_output` |
| CLI-04 | `tasks list` table with native-unit progress (04 §6) | `::test_tasks_list_output` |
| CLI-05 | `--yes` bypasses drift confirm (04 §9, 02 §5) | `::test_yes_bypasses_confirm` |
| CLI-06 | data-file TARGET implies empty config; yaml TARGET loads config (04 §1) | `::test_target_routing` |
| CLI-07 | errors → stderr, data → stdout (04 §9) | `::test_stderr_stdout_separation` |
| CLI-08 | `serve` never accepts `--host`; binds 127.0.0.1 (inv. #6) | `::test_no_host_flag_and_loopback_bind` *(assert flag absent + `uvicorn.run` called with host="127.0.0.1", mocked)* |

## Demo data (P10) — `tests/test_demo_data.py`

| ID | Rule | Test |
|---|---|---|
| DEMO-01 | every bundled line passes `validate_ctf_line`; ≥25 traces; contains tool-use, multi-agent `name`, JSON doc, HTML doc, long tool output (09 §1) | `::test_demo_data_valid_and_representative` |

## Packaging & E2E (P11) — CI + `e2e/`

| ID | Rule (spec §) | Test |
|---|---|---|
| E2E-01 | **the pitch**: `demo` → `j` → `1` → type reason → `Enter` → annotation row exists + progress incremented (09 §4) | `e2e/smoke.spec.ts` |
| PKG-01 | wheel refuses to build/release without `static/index.html` (09 §1) | release workflow step `check-static` |
| PKG-02 | `python -m tracelabel --help` and `tracelabel --help` work from an installed wheel | CI step in release workflow |
| PKG-03 | CI matrix {macOS, Linux, Windows} × {3.10, 3.12} runs pytest (09 §4) | `ci.yml` |

## Frontend (P9) — optional unit tests (not part of the 09 §4 minimum bar)

Recommended, vitest: keyboard reducer transitions (NAV/FIELD, digits→primary select),
`FieldRenderer` renders all three types, HTML always via sandboxed iframe (assert no
`dangerouslySetInnerHTML` usage — can also be a grep in CI). E2E-01 is the required coverage.
