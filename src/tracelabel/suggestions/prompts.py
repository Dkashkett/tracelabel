import json
import sqlite3
from dataclasses import dataclass
from typing import Any, cast

from tracelabel.config.models import ResolvedTaskConfig
from tracelabel.db.database import decode_json

TRANSCRIPT_BUDGET = 24_000


@dataclass(frozen=True)
class TargetContext:
    turns: list[sqlite3.Row]
    target_id: str
    target_index: int | None


def render_fields_spec(fields: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for field in fields:
        field_type = field["type"]
        if field_type == "single_select":
            instruction = f"choose exactly one of {json.dumps(field['options'])}"
        elif field_type == "multi_select":
            options = json.dumps(field["options"])
            instruction = f"choose zero or more of {options} as a JSON array"
        else:
            instruction = "short free text"
        if field.get("help"):
            instruction += f" — {field['help']}"
        lines.append(f"{field['name']}: {instruction}")
    return "\n".join(lines)


def _tool_call_lines(raw_tool_calls: str | None) -> list[str]:
    if not raw_tool_calls:
        return []
    calls = cast(list[dict[str, Any]], decode_json(raw_tool_calls))
    lines: list[str] = []
    for call in calls:
        function = call["function"]
        arguments = str(function["arguments"])
        if len(arguments) > 120:
            arguments = arguments[:120] + "…"
        lines.append(f"[tool_call: {function['name']}({arguments})]")
    return lines


def _assemble_transcript(
    turns: list[sqlite3.Row],
    bodies: list[str],
    target_index: int | None,
) -> str:
    blocks: list[str] = []
    for index, turn in enumerate(turns):
        marker = ">>> " if index == target_index else ""
        parts = [f"{marker}{turn['role']}:"]
        if bodies[index]:
            parts.append(bodies[index])
        parts.extend(_tool_call_lines(turn["tool_calls"]))
        blocks.append("\n".join(parts))
    return "\n\n".join(blocks)


def render_transcript(
    turns: list[sqlite3.Row],
    target_index: int | None,
    budget: int = TRANSCRIPT_BUDGET,
) -> str:
    bodies = [str(turn["content"]) for turn in turns]
    while len(_assemble_transcript(turns, bodies, target_index)) > budget:
        candidates = [
            index
            for index, turn in enumerate(turns)
            if turn["role"] == "tool" and not bodies[index].startswith("[...truncated ")
        ]
        if not candidates:
            break
        longest = max(candidates, key=lambda index: len(bodies[index]))
        bodies[longest] = f"[...truncated {len(bodies[longest])} chars...]"
    return _assemble_transcript(turns, bodies, target_index)


class PromptBuilder:
    def __init__(self, transcript_budget: int = TRANSCRIPT_BUDGET) -> None:
        self._transcript_budget = transcript_budget

    def build(self, config: ResolvedTaskConfig, context: TargetContext) -> str:
        target = (
            f"Turn #{context.target_index} (marked >>> above)"
            if config.level == "turn"
            else "The entire conversation"
        )
        transcript = render_transcript(
            context.turns,
            context.target_index,
            self._transcript_budget,
        )
        return f"""You are assisting a human data labeler. Judge the target below and respond
with ONLY a JSON object — no prose, no markdown fences.

# Task: {config.name} ({config.level}-level)
{config.suggest_instructions or ""}

# Fields (respond with exactly these keys)
{render_fields_spec(config.fields)}
# e.g.  verdict: choose exactly one of ["pass", "fail"]
#       reasoning: short free text — why is this a pass or fail?
#       error_type: choose zero or more of [...] as a JSON array

# Conversation context
{transcript}

# Target
{target}

Respond with the JSON object now."""
