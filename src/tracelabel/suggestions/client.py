import importlib
from collections.abc import Mapping, Sequence
from typing import Any, Protocol, cast

from tracelabel.config.models import LLMConfig
from tracelabel.errors import UserError

ChatMessage = dict[str, str]


class ModelAuthenticationError(UserError):
    pass


class ModelClient(Protocol):
    async def complete(self, config: LLMConfig, messages: list[ChatMessage]) -> str: ...


class LiteLLMModule(Protocol):
    async def acompletion(self, **kwargs: Any) -> object: ...


class LiteLLMClient:
    def __init__(self) -> None:
        try:
            module = importlib.import_module("litellm")
        except ImportError as error:
            raise UserError(
                "AI assist needs the optional extra: pip install 'tracelabel[ai]'"
            ) from error
        self._module = cast(LiteLLMModule, module)
        self._authentication_error = getattr(module, "AuthenticationError", None)

    async def complete(self, config: LLMConfig, messages: list[ChatMessage]) -> str:
        try:
            response = await self._module.acompletion(
                model=config.model,
                temperature=config.temperature,
                max_tokens=config.max_tokens,
                messages=messages,
                response_format={"type": "json_object"},
            )
        except Exception as error:
            if self._is_authentication_error(error):
                raise ModelAuthenticationError(str(error)) from error
            raise
        return self._response_text(response)

    def _is_authentication_error(self, error: Exception) -> bool:
        error_type = self._authentication_error
        return isinstance(error_type, type) and isinstance(error, error_type)

    @staticmethod
    def _response_text(response: object) -> str:
        content: object
        if isinstance(response, Mapping):
            choices = response.get("choices")
            if not isinstance(choices, Sequence) or not choices:
                raise UserError("model response had no choices")
            choice = choices[0]
            if not isinstance(choice, Mapping):
                raise UserError("model response choice was malformed")
            message = choice.get("message")
            if not isinstance(message, Mapping):
                raise UserError("model response message was malformed")
            content = message.get("content")
        else:
            choices = getattr(response, "choices", None)
            if not isinstance(choices, Sequence) or not choices:
                raise UserError("model response had no choices")
            message = getattr(choices[0], "message", None)
            content = getattr(message, "content", None)
        if not isinstance(content, str):
            raise UserError("model response content was not text")
        return content
