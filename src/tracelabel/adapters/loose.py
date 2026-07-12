from collections import Counter
from collections.abc import Iterator
from typing import Any

from ..ctf import Json

_ROLE_SYNONYMS = {
    "human": "user",
    "ai": "assistant",
    "bot": "assistant",
    "agent": "assistant",
}

_ALIAS_KEYS = ("conversation", "turns", "chat")


class _NotLoose(Exception):
    pass


def _dedup(notes: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for n in notes:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out


def _norm_msg(m: Any) -> tuple[Any, list[str]]:
    notes: list[str] = []
    if not isinstance(m, dict):
        return m, notes
    m = dict(m)
    if "role" not in m:
        for k in ("speaker", "from"):
            if k in m:
                m["role"] = m.pop(k)
                notes.append(f'interpreted "{k}" as "role"')
                break
    r = m.get("role")
    if isinstance(r, str):
        mapped = _ROLE_SYNONYMS.get(r.lower())
        if mapped is not None and mapped != r:
            m["role"] = mapped
            notes.append("mapped role synonyms to CTF roles")
    return m, notes


def _langsmith_output(outputs: Any) -> Any:
    if isinstance(outputs, str):
        return outputs
    if isinstance(outputs, dict):
        msgs = outputs.get("messages")
        if isinstance(msgs, list) and msgs and isinstance(msgs[-1], dict):
            if "content" in msgs[-1]:
                return msgs[-1]["content"]
        if isinstance(outputs.get("content"), str):
            return outputs["content"]
        if isinstance(outputs.get("output"), str):
            return outputs["output"]
    return None


def _map(obj: Any) -> tuple[Json, list[str]]:
    if isinstance(obj, str):
        return {"messages": [{"role": "document", "content": obj}], "source": "loose"}, [
            "interpreted plain strings as documents"
        ]

    if isinstance(obj, list):
        return _finish(obj, ["interpreted a bare message list as a trace"], extra_raw=None)

    if isinstance(obj, dict):
        for key in _ALIAS_KEYS:
            if isinstance(obj.get(key), list):
                extra = {k: v for k, v in obj.items() if k != key}
                return _finish(
                    obj[key],
                    [f'interpreted "{key}" as "messages"'],
                    extra_raw=extra or None,
                )
        if isinstance(obj.get("messages"), list):
            extra = {k: v for k, v in obj.items() if k != "messages"}
            return _finish(obj["messages"], [], extra_raw=extra or None)
        if isinstance(obj.get("inputs"), dict) or "outputs" in obj:
            return _langsmith(obj)

    raise _NotLoose()


def _finish(msgs: Any, notes: list[str], extra_raw: Json | None) -> tuple[Json, list[str]]:
    out_msgs: list[Any] = []
    for m in msgs:
        nm, mnotes = _norm_msg(m)
        notes.extend(mnotes)
        out_msgs.append(nm)
    ctf: Json = {"messages": out_msgs, "source": "loose"}
    if extra_raw:
        ctf["raw"] = extra_raw
    return ctf, _dedup(notes)


def _langsmith(obj: Json) -> tuple[Json, list[str]]:
    notes = ["interpreted a LangSmith run as messages"]
    out_msgs: list[Any] = []
    inputs = obj.get("inputs") or {}
    for m in inputs.get("messages", []) or []:
        nm, mnotes = _norm_msg(m)
        notes.extend(mnotes)
        out_msgs.append(nm)
    text = _langsmith_output(obj.get("outputs"))
    if text is not None:
        out_msgs.append({"role": "assistant", "content": text})
    raw = {k: v for k, v in obj.items() if k not in ("inputs", "outputs")}
    if isinstance(inputs, dict):
        input_extras = {k: v for k, v in inputs.items() if k != "messages"}
        if input_extras:
            raw["inputs"] = input_extras
    ctf: Json = {"messages": out_msgs, "source": "loose"}
    if raw:
        ctf["raw"] = raw
    return ctf, _dedup(notes)


class LooseAdapter:
    name = "loose"

    def __init__(self) -> None:
        self._counts: Counter[str] = Counter()

    def sniff(self, first_lines: list[Any]) -> bool:
        if not first_lines:
            return False
        try:
            _map(first_lines[0])
            return True
        except _NotLoose:
            return False

    def to_ctf(self, obj: Any) -> Iterator[Json]:
        ctf, notes = _map(obj)
        for note in notes:
            self._counts[note] += 1
        yield ctf

    def notes(self) -> list[str]:
        return [f"{note} on {n} line{'s' if n != 1 else ''}" for note, n in self._counts.items()]
