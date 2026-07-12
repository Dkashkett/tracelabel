# 08 — AI Assist (Batch Suggestions)

Decision: **batch pre-annotation, not a per-item button.** `tracelabel suggest` fills the
`suggestions` table offline; the human then flies through the UI confirming or overriding
prefills. This keeps job-queue infrastructure out of the server entirely — the server only
ever *reads* suggestions.

## 1. Provenance rules (restating invariant #2 — the credibility of the dataset depends on this)

- Suggestions live only in the `suggestions` table (`source of truth: model`).
- A suggestion becomes labeled data **only** when a human commits the form, which writes an
  `annotations` row with `prefill_model` set.
- `prefill_model IS NULL` ⇒ unassisted human judgment. This one column answers "which labels
  did a human actually judge from scratch?" forever.
- Suggestions are never exported by `tracelabel export` (annotations only).

## 2. CLI

```
tracelabel suggest [TARGET] [--task NAME] [--limit N] [--overwrite] [--concurrency N=4]
```

Requires `pip install 'tracelabel[ai]'` (litellm is a heavy tree; keep it optional).
Provider API keys come **only** from env vars, per litellm conventions (`OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, …). Fail fast with the provider's expected var name if missing.

```python
def suggest(cfg: ResolvedTaskConfig, conn, limit, overwrite, concurrency):
    require_litellm(); require_llm_config(cfg)          # actionable errors otherwise
    targets = unaddressed_targets(conn, cfg)            # no annotation by cfg.annotator
    if not overwrite:
        targets = [t for t in targets if no_suggestion(conn, cfg.name, t)]
    targets = targets[:limit] if limit else targets

    async def one(t):
        prompt = build_prompt(cfg, load_context(conn, t))          # §3
        resp   = await litellm.acompletion(model=cfg.llm.model,
                    temperature=cfg.llm.temperature, max_tokens=cfg.llm.max_tokens,
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"})
        values = validate_against_schema(parse_json(resp), cfg.fields)   # same validator as 05 §3
        upsert_suggestion(conn, cfg.name, t, values, cfg.llm.model, raw=resp)  # REPLACE on conflict

    run_with_concurrency(targets, one, concurrency)     # progress bar; per-item retry ×2 w/ backoff
    print(f"suggested {ok}/{len(targets)} · {failed} failed (re-run to retry) · est. cost printed by litellm")
```

Failures are per-item and non-fatal: log, continue, summarize. Re-running `suggest` retries
only holes (idempotent), `--overwrite` regenerates everything.

## 3. Prompt construction (normative shape)

The prompt is generated from the **resolved schema** — custom fields work automatically:

```python
def build_prompt(cfg, ctx) -> str:
    return f"""You are assisting a human data labeler. Judge the target below and respond
with ONLY a JSON object — no prose, no markdown fences.

# Task: {cfg.name} ({cfg.level}-level)
{cfg.suggest_instructions or ""}

# Fields (respond with exactly these keys)
{render_fields_spec(cfg.fields)}
# e.g.  verdict: choose exactly one of ["pass", "fail"]
#       reasoning: short free text — why is this a pass or fail?
#       error_type: choose zero or more of [...] as a JSON array

# Conversation context
{ctx.document if ctx.document is not None else render_transcript(ctx.turns)}
# document trace: the document body verbatim. conversation trace: full trace,
# roles labeled, tool calls summarized

# Target
{"The document below" if ctx.document is not None else
 ("Turn #" + str(ctx.target_idx) + " (marked >>> above)" if cfg.level == "turn" else "The entire conversation")}

Respond with the JSON object now."""
```

Context policy: include the full trace (the target marked `>>>`), truncating longest tool
outputs first if the rendered transcript exceeds a budget (default 24k chars), with a
`[...truncated N chars...]` marker. Model output that fails schema validation after one
re-ask counts as a failed item — **never store an invalid suggestion.** A document trace has no
turns to render or truncate — `load_context` detects a non-null `trace.content` and short-circuits
straight to the document body (07 §9).

## 4. Review flow in the UI (see 06 §5)

Unannotated target with a suggestion → form pre-filled + `✦ suggested by gpt-4o-mini` badge.
Human paths:

| Action | Result |
|---|---|
| `Enter` (agree) | annotation written with suggestion's values, `prefill_model` set |
| edit fields, then `Enter` | annotation with human's values, `prefill_model` still set (it seeded the form) |
| clear form (`Esc`→`x` / clear button) | `prefill_model` nulled; commit is unassisted |
| `s` skip | skip recorded; suggestion remains but is never counted as data |

Existing annotations always render instead of suggestions.

## 5. Non-goals

No auto-accept mode (a human confirms every label — this is the product's integrity claim),
no server-side generation endpoints, no agreement scoring between model and human in MVP
(the columns make it a query later: compare `suggestions.values` to `annotations.values`).
