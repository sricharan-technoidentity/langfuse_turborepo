"""Tracing helpers. `observe` and `propagate_attributes` come straight from the SDK."""

from __future__ import annotations

from typing import Any

from langfuse import get_client, observe, propagate_attributes

from ._connection import init_langfuse

__all__ = ["get_current_trace_id", "observe", "propagate_attributes", "start_as_current_observation"]


def start_as_current_observation(**kwargs: Any) -> Any:
    """Context manager for a span/generation/agent/... (same arguments as the SDK method)."""
    init_langfuse(silent=True)
    return get_client().start_as_current_observation(**kwargs)


def get_current_trace_id() -> str | None:
    """ID of the active trace (None outside an observation or when tracing is off)."""
    init_langfuse(silent=True)
    return get_client().get_current_trace_id()
