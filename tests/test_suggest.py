import sys
from types import SimpleNamespace

import pytest

from tracelabel import db, suggest
from tracelabel.config import LLMConfig, ResolvedTaskConfig
from tracelabel.errors import UserError
from tracelabel.suggest import build_prompt, run_suggest

# ── fixtures ─────────────────────────────────────────────────────────────────

# A tool-use conversation: user / assistant+tool_call / tool / assistant.
TRACE_CONV = {
    "id": "t_conv",
    "messages": [
        {"role": "user", "content": "hi"},
        {
            "role": "assistant",
            "content": "let me check",
            "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": "lookup", "arguments": "{}"}}
            ],
        },
        {"role": "tool", "content": "result", "tool_call_id": "c1"},
        {"role": "assistant", "content": "done"},
    ],
}
TRACE_DOC = {"id": "t_doc", "messages": [{"role": "document", "content": "a document"}]}

FIELDS = [
    {
        "name": "verdict",
        "label": "Verdict",
        "type": "single_select",
        "required": True,
        "options": ["pass", "fail"],
    },
    {"name": "notes", "label": "Notes", "type": "text", "required": False},
]


def _cfg(tmp_path, *, level="turn", with_llm=True, fields=None):
    return ResolvedTaskConfig(
        name="task",
        level=level,
        fields=fields if fields is not None else FIELDS,
        label_roles=["assistant", "document"],
        shuffle=False,
        annotator="alice",
        schema_hash="sh_test",
        data_path=tmp_path / "traces.jsonl",
        llm=LLMConfig(model="gpt-4o-mini") if with_llm else None,
        suggest_instructions=None,
    )


def _setup(tmp_path, **cfg_kwargs):
    conn = db.open_db(db.default_db_path(tmp_path))
    db.import_trace(conn, TRACE_CONV, "loose")
    db.import_trace(conn, TRACE_DOC, "loose")
    cfg = _cfg(tmp_path, **cfg_kwargs)
    db.open_task(conn, cfg, assume_yes=True)
    return conn, cfg


def _resp(content: str):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


class FakeLiteLLM:
    """Stand-in for the litellm module injected into sys.modules."""

    def __init__(self, handler):
        self._handler = handler
        self.calls: list[dict] = []

    async def acompletion(self, **kwargs):
        self.calls.append(kwargs)
        return self._handler(kwargs, self.calls)


def _install(monkeypatch, handler) -> FakeLiteLLM:
    fake = FakeLiteLLM(handler)
    monkeypatch.setitem(sys.modules, "litellm", fake)
    return fake


def _always(content: str):
    return lambda kwargs, calls: _resp(content)


@pytest.fixture(autouse=True)
def _no_backoff(monkeypatch):
    # Keep retry tests fast; the values themselves are exercised implicitly by retry counts.
    monkeypatch.setattr(suggest, "RETRY_DELAYS", (0, 0))


# ── SUG-01 / SUG-02: preflight errors ────────────────────────────────────────


def test_missing_litellm_message(tmp_path, monkeypatch):
    conn, cfg = _setup(tmp_path)
    monkeypatch.setitem(sys.modules, "litellm", None)  # → import raises ImportError
    with pytest.raises(UserError) as exc:
        run_suggest(cfg, conn, limit=None, overwrite=False)
    assert str(exc.value) == "AI assist needs the optional extra: pip install 'tracelabel[ai]'"


def test_missing_llm_config(tmp_path, monkeypatch):
    conn, cfg = _setup(tmp_path, with_llm=False)
    _install(monkeypatch, _always('{"verdict": "pass"}'))
    with pytest.raises(UserError) as exc:
        run_suggest(cfg, conn, limit=None, overwrite=False)
    msg = str(exc.value)
    assert "llm:" in msg and "model:" in msg


# ── SUG-03: target selection, idempotency, overwrite ─────────────────────────


def test_targets_idempotent_and_overwrite(tmp_path, monkeypatch):
    conn, cfg = _setup(tmp_path)
    # Pre-annotate one target: it must be excluded as already addressed.
    db.upsert_annotation(
        conn,
        task=cfg.name,
        target_type="turn",
        target_id="t_doc#0",
        status="labeled",
        values={"verdict": "pass"},
        annotator=cfg.annotator,
        schema_hash=cfg.schema_hash,
        prefill_model=None,
    )
    fake = _install(monkeypatch, _always('{"verdict": "pass"}'))

    # First run: two unaddressed turns (t_conv#1, t_conv#3).
    s1 = run_suggest(cfg, conn, limit=None, overwrite=False)
    assert (s1.ok, s1.failed, s1.skipped_existing) == (2, 0, 0)
    assert len(fake.calls) == 2

    # Re-run without overwrite: both holes are filled → nothing to do.
    fake.calls.clear()
    s2 = run_suggest(cfg, conn, limit=None, overwrite=False)
    assert (s2.ok, s2.failed, s2.skipped_existing) == (0, 0, 2)
    assert fake.calls == []

    # Overwrite regenerates everything unaddressed.
    fake.calls.clear()
    s3 = run_suggest(cfg, conn, limit=None, overwrite=True)
    assert (s3.ok, s3.failed, s3.skipped_existing) == (2, 0, 0)
    assert len(fake.calls) == 2


# ── SUG-04 / SUG-05: validation gate ─────────────────────────────────────────


def test_invalid_output_never_stored(tmp_path, monkeypatch):
    conn, cfg = _setup(tmp_path)
    # "maybe" is not an option → fails validation on both the initial ask and the re-ask.
    fake = _install(monkeypatch, _always('{"verdict": "maybe"}'))
    summary = run_suggest(cfg, conn, limit=1, overwrite=False)
    assert (summary.ok, summary.failed) == (0, 1)
    assert len(fake.calls) == 2  # initial + one re-ask (08 §3)
    assert db.suggestions_for_trace(conn, cfg.name, "t_conv") == []


def test_valid_suggestion_stored(tmp_path, monkeypatch):
    conn, cfg = _setup(tmp_path)
    _install(monkeypatch, _always('{"verdict": "fail", "notes": "bad"}'))
    summary = run_suggest(cfg, conn, limit=1, overwrite=False)
    assert (summary.ok, summary.failed) == (1, 0)
    rows = db.suggestions_for_trace(conn, cfg.name, "t_conv")
    assert len(rows) == 1
    assert rows[0]["model"] == "gpt-4o-mini"
    assert '"verdict":"fail"' in rows[0]["values"]


# ── SUG-06: prompt shape ─────────────────────────────────────────────────────


def test_build_prompt_contains_fields_and_target(tmp_path):
    fields = FIELDS + [
        {
            "name": "error_type",
            "label": "Error type",
            "type": "multi_select",
            "required": False,
            "options": ["planning", "tool_use"],
            "help": "what went wrong",
        }
    ]
    conn, cfg = _setup(tmp_path, fields=fields)
    ctx = suggest.load_context(conn, "t_conv#1", "turn")
    prompt = build_prompt(cfg, ctx)
    assert "verdict: choose exactly one of" in prompt
    assert 'error_type: choose zero or more of ["planning", "tool_use"] as a JSON array' in prompt
    assert "what went wrong" in prompt  # help appended
    assert ">>> assistant:" in prompt  # target line marked
    assert "Turn #1 (marked >>> above)" in prompt


# ── SUG-07: transcript truncation ────────────────────────────────────────────


def test_transcript_truncation(tmp_path):
    big = "X" * 30_000
    small = "Y" * 500
    trace = {
        "id": "t_big",
        "messages": [
            {"role": "user", "content": "go"},
            {"role": "tool", "content": big, "tool_call_id": "c1"},
            {"role": "tool", "content": small, "tool_call_id": "c2"},
        ],
    }
    conn = db.open_db(db.default_db_path(tmp_path))
    db.import_trace(conn, trace, "loose")
    turns = db.get_turns(conn, "t_big")

    rendered = suggest.render_transcript(turns, target_idx=None)
    assert len(rendered) <= suggest.TRANSCRIPT_BUDGET
    assert "[...truncated 30000 chars...]" in rendered
    assert small in rendered  # the short tool output survives


# ── SUG-08: resilience ───────────────────────────────────────────────────────


def test_per_item_failure_continues(tmp_path, monkeypatch):
    conn, cfg = _setup(tmp_path)

    def handler(kwargs, calls):
        prompt = kwargs["messages"][0]["content"]
        if "Turn #3" in prompt:  # the last assistant turn always errors
            raise RuntimeError("boom")
        return _resp('{"verdict": "pass"}')

    _install(monkeypatch, handler)
    summary = run_suggest(cfg, conn, limit=None, overwrite=False, concurrency=1)
    assert (summary.ok, summary.failed) == (2, 1)  # doc#0 + conv#1 ok, conv#3 fails


# ── SUG-09: provenance invariant #2 ──────────────────────────────────────────


def test_no_annotation_rows_created(tmp_path, monkeypatch):
    conn, cfg = _setup(tmp_path)
    _install(monkeypatch, _always('{"verdict": "pass"}'))
    run_suggest(cfg, conn, limit=None, overwrite=False)
    assert conn.execute("SELECT count(*) FROM annotations").fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM suggestions").fetchone()[0] == 3
