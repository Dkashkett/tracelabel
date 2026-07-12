import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, cast

from tracelabel.config.models import LLMConfig, ResolvedTaskConfig
from tracelabel.config.validation import AnnotationValidator
from tracelabel.ctf.models import Json
from tracelabel.db.annotations import AnnotationRepository
from tracelabel.db.traces import TraceRepository
from tracelabel.errors import UserError

from .client import ChatMessage, ModelAuthenticationError, ModelClient
from .prompts import PromptBuilder, TargetContext

RETRY_DELAYS = (0.5, 1.0)
_log = logging.getLogger("tracelabel.suggestions")


@dataclass(frozen=True)
class SuggestionSummary:
    ok: int
    failed: int
    skipped_existing: int


@dataclass
class _Counters:
    ok: int = 0
    failed: int = 0


class SuggestionService:
    def __init__(
        self,
        config: ResolvedTaskConfig,
        traces: TraceRepository,
        annotations: AnnotationRepository,
        client: ModelClient,
        *,
        prompt_builder: PromptBuilder | None = None,
        retry_delays: tuple[float, ...] = RETRY_DELAYS,
        sleeper: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._config = config
        self._traces = traces
        self._annotations = annotations
        self._client = client
        self._prompt_builder = prompt_builder or PromptBuilder()
        self._retry_delays = retry_delays
        self._sleeper = sleeper
        self._validator = AnnotationValidator(config.fields)

    def run(
        self,
        *,
        limit: int | None,
        overwrite: bool,
        concurrency: int = 4,
    ) -> SuggestionSummary:
        llm = self._require_llm_config()
        targets = self._annotations.unaddressed_targets(self._config)
        if overwrite:
            skipped_existing = 0
        else:
            kept = self._annotations.targets_without_suggestion(self._config.name, targets)
            skipped_existing = len(targets) - len(kept)
            targets = kept
        if limit:
            targets = targets[:limit]
        counters = _Counters()
        asyncio.run(self._run_all(targets, llm, concurrency, counters))
        return SuggestionSummary(counters.ok, counters.failed, skipped_existing)

    async def _run_all(
        self,
        targets: list[str],
        llm: LLMConfig,
        concurrency: int,
        counters: _Counters,
    ) -> None:
        semaphore = asyncio.Semaphore(concurrency)

        async def worker(target_id: str) -> None:
            async with semaphore:
                await self._process_one(target_id, llm, counters)

        await asyncio.gather(*(worker(target) for target in targets))

    async def _process_one(
        self,
        target_id: str,
        llm: LLMConfig,
        counters: _Counters,
    ) -> None:
        context = self.load_context(target_id)
        conversation: list[ChatMessage] = [
            {"role": "user", "content": self._prompt_builder.build(self._config, context)}
        ]
        for validation_attempt in range(2):
            try:
                raw = await self._complete_with_retry(llm, conversation)
            except ModelAuthenticationError:
                raise
            except Exception as error:
                _log.warning("suggest %s failed: %s", target_id, error)
                counters.failed += 1
                return
            try:
                values = self._parse_and_validate(raw)
            except UserError as error:
                if validation_attempt == 0:
                    conversation.extend(
                        (
                            {"role": "assistant", "content": raw},
                            {
                                "role": "user",
                                "content": (
                                    f"That response was invalid: {error}\n"
                                    "Respond again with ONLY the JSON object."
                                ),
                            },
                        )
                    )
                    continue
                _log.warning("suggest %s invalid output (never stored): %s", target_id, error)
                counters.failed += 1
                return
            self._annotations.upsert_suggestion(
                task=self._config.name,
                target_type=self._config.level,
                target_id=target_id,
                values=values,
                model=llm.model,
                raw_response=raw,
            )
            counters.ok += 1
            return

    async def _complete_with_retry(
        self,
        llm: LLMConfig,
        conversation: list[ChatMessage],
    ) -> str:
        last_error: Exception | None = None
        for attempt in range(len(self._retry_delays) + 1):
            try:
                return await self._client.complete(llm, conversation)
            except ModelAuthenticationError:
                raise
            except Exception as error:
                last_error = error
                if attempt < len(self._retry_delays):
                    await self._sleeper(self._retry_delays[attempt])
        if last_error is None:
            raise RuntimeError("model completion failed without an exception")
        raise last_error

    def load_context(self, target_id: str) -> TargetContext:
        if self._config.level == "turn":
            turn = self._traces.get_turn(target_id)
            if turn is None:
                raise UserError(f"unknown turn target '{target_id}'")
            trace_id = str(turn["trace_id"])
            target_index = int(turn["idx"])
        else:
            trace_id = target_id
            target_index = None
        return TargetContext(
            turns=self._traces.get_turns(trace_id),
            target_id=target_id,
            target_index=target_index,
        )

    def _parse_and_validate(self, raw: str) -> Json:
        try:
            values: Any = json.loads(raw)
        except json.JSONDecodeError as error:
            raise UserError(f"model did not return valid JSON: {error}") from error
        if not isinstance(values, dict):
            raise UserError("model output was not a JSON object")
        typed_values = cast(dict[str, str | list[str]], values)
        self._validator.validate(typed_values, "labeled")
        return cast(Json, values)

    def _require_llm_config(self) -> LLMConfig:
        if self._config.llm is None:
            raise UserError(
                "AI assist needs an `llm:` block in your config. For example:\n\n"
                "  llm:\n"
                "    model: gpt-4o-mini"
            )
        return self._config.llm
