import asyncio
import json
import logging
import sqlite3
from dataclasses import dataclass
from typing import Any

from .config import LLMConfig, ResolvedTaskConfig, validate_annotation_values
from .db import (
    get_turns,
    targets_without_suggestion,
    unaddressed_targets,
    upsert_suggestion,
)
from .errors import UserError

_log = logging.getLogger("tracelabel.suggest")

TRANSCRIPT_BUDGET = 24_000  # chars; truncate longest tool outputs first (08 §3)
RETRY_DELAYS = (0.5, 1.0)  # per-item retry ×2 with backoff (08 §2)


@dataclass
class SuggestSummary:
    ok: int
    failed: int
    skipped_existing: int


@dataclass
class TargetContext:
    turns: list[sqlite3.Row]
    target_id: str
    target_idx: int | None


# ── prompt construction (08 §3) ──────────────────────────────────────────────


def render_fields_spec(fields: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for f in fields:
        ftype = f["type"]
        if ftype == "single_select":
            instr = f"choose exactly one of {json.dumps(f['options'])}"
        elif ftype == "multi_select":
            instr = f"choose zero or more of {json.dumps(f['options'])} as a JSON array"
        else:
            instr = "short free text"
        if f.get("help"):
            instr += f" — {f['help']}"
        lines.append(f"{f['name']}: {instr}")
    return "\n".join(lines)


def _tool_call_lines(raw_tool_calls: str | None) -> list[str]:
    if not raw_tool_calls:
        return []
    out: list[str] = []
    for call in json.loads(raw_tool_calls):
        fn = call["function"]
        args = fn["arguments"]
        if len(args) > 120:
            args = args[:120] + "…"
        out.append(f"[tool_call: {fn['name']}({args})]")
    return out


def _assemble_transcript(
    turns: list[sqlite3.Row], bodies: list[str], target_idx: int | None
) -> str:
    blocks: list[str] = []
    for i, t in enumerate(turns):
        marker = ">>> " if i == target_idx else ""
        parts = [f"{marker}{t['role']}:"]
        if bodies[i]:
            parts.append(bodies[i])
        parts.extend(_tool_call_lines(t["tool_calls"]))
        blocks.append("\n".join(parts))
    return "\n\n".join(blocks)


def render_transcript(turns: list[sqlite3.Row], target_idx: int | None) -> str:
    bodies = [t["content"] for t in turns]
    # Truncate longest tool-output turns first until under budget (08 §3).
    while len(_assemble_transcript(turns, bodies, target_idx)) > TRANSCRIPT_BUDGET:
        candidates = [
            i
            for i, t in enumerate(turns)
            if t["role"] == "tool" and not bodies[i].startswith("[...truncated ")
        ]
        if not candidates:
            break
        i = max(candidates, key=lambda i: len(bodies[i]))
        bodies[i] = f"[...truncated {len(bodies[i])} chars...]"
    return _assemble_transcript(turns, bodies, target_idx)


def build_prompt(cfg: ResolvedTaskConfig, ctx: TargetContext) -> str:
    target = (
        f"Turn #{ctx.target_idx} (marked >>> above)"
        if cfg.level == "turn"
        else "The entire conversation"
    )
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
{render_transcript(ctx.turns, ctx.target_idx)}

# Target
{target}

Respond with the JSON object now."""


# ── engine (08 §2) ───────────────────────────────────────────────────────────


def _require_litellm() -> Any:
    try:
        import litellm
    except ImportError as e:
        raise UserError("AI assist needs the optional extra: pip install 'tracelabel[ai]'") from e
    return litellm


def _require_llm_config(cfg: ResolvedTaskConfig) -> LLMConfig:
    if cfg.llm is None:
        raise UserError(
            "AI assist needs an `llm:` block in your config. For example:\n\n"
            "  llm:\n"
            "    model: gpt-4o-mini"
        )
    return cfg.llm


def load_context(conn: sqlite3.Connection, target_id: str, level: str) -> TargetContext:
    if level == "turn":
        row = conn.execute("SELECT trace_id, idx FROM turns WHERE id=?", (target_id,)).fetchone()
        if row is None:
            raise UserError(f"unknown turn target '{target_id}'")
        trace_id, target_idx = row["trace_id"], row["idx"]
    else:
        trace_id, target_idx = target_id, None
    return TargetContext(
        turns=get_turns(conn, trace_id), target_id=target_id, target_idx=target_idx
    )


def _response_text(resp: Any) -> str:
    try:
        return resp.choices[0].message.content  # type: ignore[no-any-return]
    except AttributeError:
        return resp["choices"][0]["message"]["content"]  # type: ignore[no-any-return]


def _parse_and_validate(raw: str, cfg: ResolvedTaskConfig) -> dict[str, Any]:
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as e:
        raise UserError(f"model did not return valid JSON: {e}") from e
    if not isinstance(values, dict):
        raise UserError("model output was not a JSON object")
    validate_annotation_values(values, status="labeled", fields=cfg.fields)
    return values


def _auth_error_types(litellm: Any) -> Any:
    # Auth failures affect every item — surface litellm's message (naming the env var)
    # instead of quietly turning it into a per-item failure (P7 notes; invariant #9).
    return getattr(litellm, "AuthenticationError", ())


async def _complete(litellm: Any, llm: LLMConfig, messages: list[dict[str, str]]) -> Any:
    last: Exception | None = None
    for attempt in range(len(RETRY_DELAYS) + 1):
        try:
            return await litellm.acompletion(
                model=llm.model,
                temperature=llm.temperature,
                max_tokens=llm.max_tokens,
                messages=messages,
                response_format={"type": "json_object"},
            )
        except _auth_error_types(litellm):
            raise
        except Exception as e:  # transient transport error → retry with backoff
            last = e
            if attempt < len(RETRY_DELAYS):
                await asyncio.sleep(RETRY_DELAYS[attempt])
    assert last is not None
    raise last


async def _process_one(
    litellm: Any,
    cfg: ResolvedTaskConfig,
    llm: LLMConfig,
    conn: sqlite3.Connection,
    target_id: str,
    counters: dict[str, int],
) -> None:
    ctx = load_context(conn, target_id, cfg.level)
    convo: list[dict[str, str]] = [{"role": "user", "content": build_prompt(cfg, ctx)}]
    for attempt in range(2):  # initial + one re-ask (08 §3)
        try:
            raw = _response_text(await _complete(litellm, llm, convo))
        except Exception as e:  # noqa: BLE001 — non-fatal per-item failure (08 §2)
            _log.warning("suggest %s failed: %s", target_id, e)
            counters["failed"] += 1
            return
        try:
            values = _parse_and_validate(raw, cfg)
        except UserError as e:
            if attempt == 0:
                convo.append({"role": "assistant", "content": raw})
                convo.append(
                    {
                        "role": "user",
                        "content": (
                            f"That response was invalid: {e}\n"
                            "Respond again with ONLY the JSON object."
                        ),
                    }
                )
                continue
            _log.warning("suggest %s invalid output (never stored): %s", target_id, e)
            counters["failed"] += 1
            return
        upsert_suggestion(
            conn,
            task=cfg.name,
            target_type=cfg.level,
            target_id=target_id,
            values=values,
            model=llm.model,
            raw_response=raw,
        )
        counters["ok"] += 1
        return


def run_suggest(
    cfg: ResolvedTaskConfig,
    conn: sqlite3.Connection,
    *,
    limit: int | None,
    overwrite: bool,
    concurrency: int = 4,
) -> SuggestSummary:
    litellm = _require_litellm()
    llm = _require_llm_config(cfg)

    targets = unaddressed_targets(conn, cfg)  # no annotation by cfg.annotator (08 §2)
    if overwrite:
        skipped_existing = 0
    else:
        kept = targets_without_suggestion(conn, cfg.name, targets)
        skipped_existing = len(targets) - len(kept)
        targets = kept
    if limit:
        targets = targets[:limit]

    counters = {"ok": 0, "failed": 0}
    sem = asyncio.Semaphore(concurrency)

    async def worker(target_id: str) -> None:
        async with sem:
            await _process_one(litellm, cfg, llm, conn, target_id, counters)

    async def run() -> None:
        await asyncio.gather(*(worker(t) for t in targets))

    asyncio.run(run())
    return SuggestSummary(
        ok=counters["ok"], failed=counters["failed"], skipped_existing=skipped_existing
    )
