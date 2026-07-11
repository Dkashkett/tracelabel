# P10 — Demo data

**Phase:** 1 (authoring; its test runs once P1 merges) · **Depends on:** P0 (P1 for the test) · **Unblocks:** P11 (e2e runs on this data)

**Owned files:** `src/tracelabel/demo_data/traces.jsonl`, `tests/test_demo_data.py`.

## Objective

The ~25 synthetic traces behind `uvx tracelabel demo` — the 15-second pitch and the e2e
smoke's substrate. Quality bar: a first-time user should believe these are real agent traces.

## Required reading

- `docs/design/01-canonical-trace-format.md` §2–§5, §8 (the shape being authored)
- `docs/design/09-packaging-security.md` §1 (bundled data requirements)
- `docs/design/04-cli.md` §8 (what demo shows)

## Composition (exact)

25 traces, ids `demo_001`…`demo_025`, all with explicit `id` and realistic `metadata`
(model name, env, latency). **All content synthetic — no real names, emails, keys, or
real-company data.** Themes: a customer-support agent, a research assistant, a coding agent.

| # | Content |
|---|---|
| 1–14 | Multi-turn tool-use conversations, 4–12 turns: system → user → assistant w/ `tool_calls` → `tool` result(s) → assistant answer. Vary: multiple parallel tool calls (≥2 traces), a failing tool + recovery (≥2), JSON tool results (most), a refusal (1), a clearly-wrong answer for fail-labeling (≥3) |
| 15–16 | Multi-agent traces: assistant turns with distinct `name` values (e.g. planner/researcher) |
| 17 | Long trace: 40+ turns (exercises virtualization + `j`/`k` flow) |
| 18 | A turn with a very long tool output (≥300 lines of JSON — exercises 40vh clamp + tree collapse) |
| 19–20 | Plain-text conversations, no tools (baseline) |
| 21 | JSON document: single `document` turn whose content is a JSON string (content_type detects `json`) |
| 22 | HTML document: single `document` turn with a full `<html>` page incl. a table (renders in the sandboxed iframe) |
| 23 | Parts-array message: text part + json part (exercises `parts` rendering) |
| 24–25 | Short 2-turn Q&A traces (fast wins for the GIF) |

## Implementation notes

- Every line must pass `ctf.validate_ctf_line` untouched — no loose shapes here; this file
  is also de-facto documentation of ideal CTF.
- Assistant turns carrying `tool_calls` with `content: ""` must have non-empty `tool_calls`
  (01 §7.3). Every `tool` turn's `tool_call_id` must match a prior call id in the same trace.
- Keep the file readable: one trace per line (JSONL), but content strings can be long.
  Target < 150 KB total.
- `tests/test_demo_data.py` (DEMO-01): iterate lines through `validate_ctf_line`; assert
  ≥25 traces; assert presence of: ≥1 trace with `tool_calls`, ≥1 assistant `name`, ≥1
  `document` with detected `json`, ≥1 `document` with detected `html`, ≥1 parts message,
  ≥1 trace with ≥40 messages; assert all ids unique.

## Tests

Matrix row **DEMO-01**.

## Verification

```
pytest tests/test_demo_data.py -q      # after P1 is merged
```

## Out of scope

The `demo` command itself (P8), packaging the data into the wheel (P0's pyproject already
includes `demo_data/**`).
