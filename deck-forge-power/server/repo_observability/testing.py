"""Test helpers: route every Langfuse span into memory instead of the network, through the real
Langfuse client (so propagated attributes behave exactly as in production). Also disables the API
client so prompts fall back to local definitions and scores are no-ops."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from repo_langfuse import flush_langfuse, get_langfuse_config, init_langfuse, set_langfuse_client, shutdown_langfuse

__all__ = ["CapturedSpan", "InMemorySpanExporter", "TestTracing", "create_test_tracing"]


@dataclass(frozen=True)
class CapturedSpan:
    name: str
    # Langfuse observation type: span, generation, agent, tool, retriever, evaluator...
    type: str | None
    trace_id: str
    span_id: str
    parent_span_id: str | None
    attributes: dict[str, Any]


def _simplify(span: ReadableSpan) -> CapturedSpan:
    attributes = dict(span.attributes or {})
    context = span.get_span_context()
    return CapturedSpan(
        name=span.name,
        type=attributes.get("langfuse.observation.type"),  # type: ignore[arg-type]
        trace_id=format(context.trace_id, "032x") if context else "",
        span_id=format(context.span_id, "016x") if context else "",
        parent_span_id=format(span.parent.span_id, "016x") if span.parent else None,
        attributes=attributes,
    )


class TestTracing:
    __test__ = False  # not a pytest test class

    def __init__(self, exporter: InMemorySpanExporter) -> None:
        self._exporter = exporter

    def spans(self) -> list[CapturedSpan]:
        """All spans finished so far, in end order (flushes first)."""
        flush_langfuse()
        return [_simplify(s) for s in self._exporter.get_finished_spans()]

    def by_name(self, name: str) -> list[CapturedSpan]:
        return [s for s in self.spans() if s.name == name]

    def reset(self) -> None:
        self._exporter.clear()

    def shutdown(self) -> None:
        shutdown_langfuse()
        set_langfuse_client()


_active: TestTracing | None = None


def create_test_tracing() -> TestTracing:
    """In-memory tracing for tests. Call once per test session (e.g. a session-scoped fixture);
    later calls return the same instance because the Langfuse SDK shares resources per process."""
    global _active
    if _active is None:
        exporter = InMemorySpanExporter()
        set_langfuse_client(None)
        config = get_langfuse_config({"LANGFUSE_TRACING_ENVIRONMENT": "test"})
        init_langfuse(config=config, span_exporter=exporter, silent=True)
        _active = TestTracing(exporter)
    return _active
