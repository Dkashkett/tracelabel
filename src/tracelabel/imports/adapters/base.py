from collections.abc import Callable, Iterator, Sequence
from typing import Any, Protocol, runtime_checkable

from tracelabel.ctf.models import Json
from tracelabel.errors import UserError

GENERIC_CTF_SNIPPET = (
    '{"messages":[{"role":"user","content":"What\'s AAPL trading at?"},'
    '{"role":"assistant","content":"AAPL is trading at $212.40."}]}'
)


@runtime_checkable
class Adapter(Protocol):
    name: str

    def sniff(self, first_values: list[Any]) -> bool: ...

    def to_ctf(self, value: Any) -> Iterator[Json]: ...


AdapterFactory = Callable[[], Adapter]


class AdapterRegistry:
    """Select fresh adapters in a stable, caller-provided priority order."""

    def __init__(self, factories: Sequence[AdapterFactory]) -> None:
        self._factories = tuple(factories)

    @classmethod
    def default(cls) -> "AdapterRegistry":
        from .adk import AdkAdapter
        from .ctf import CtfAdapter
        from .datadog import DatadogAdapter
        from .loose import LooseAdapter

        return cls((CtfAdapter, AdkAdapter, DatadogAdapter, LooseAdapter))

    def detect(self, first_values: list[Any]) -> Adapter:
        for factory in self._factories:
            adapter = factory()
            if adapter.sniff(first_values):
                return adapter
        raise UserError(
            "Could not detect the format of this file.\n"
            "Each line should be a CTF trace, for example:\n\n"
            f"  {GENERIC_CTF_SNIPPET}\n\n"
            "Pass --from adk|datadog|loose to force an adapter, or --as-documents to import "
            "freeform text. See docs/trace-format.md."
        )

    def select(self, name: str, first_values: list[Any]) -> Adapter:
        if name == "auto":
            return self.detect(first_values)
        for factory in self._factories:
            adapter = factory()
            if adapter.name == name:
                return adapter
        choices = ", ".join(("auto", *self.names()))
        raise UserError(f"Unknown --from value {name!r}. Choose from: {choices}.")

    def names(self) -> tuple[str, ...]:
        return tuple(factory().name for factory in self._factories)
