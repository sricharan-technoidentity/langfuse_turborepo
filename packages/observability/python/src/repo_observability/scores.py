"""Scores = evaluations attached to traces: user feedback, automated checks, LLM-as-a-judge.
All helpers are no-ops when Langfuse is disabled."""

from __future__ import annotations

from typing import Any, Literal

from ._connection import get_langfuse_client

ScoreDataType = Literal["NUMERIC", "BOOLEAN", "CATEGORICAL"]


def _typed(value: float | str, data_type: ScoreDataType | None) -> dict[str, Any]:
    # The SDK types string values as CATEGORICAL and numbers as NUMERIC/BOOLEAN.
    return {"value": value, "data_type": "CATEGORICAL" if isinstance(value, str) else data_type or "NUMERIC"}


def score_current_trace(
    name: str,
    value: float | str,
    *,
    comment: str | None = None,
    data_type: ScoreDataType | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Scores the trace that is currently active (call from inside an observation)."""
    client = get_langfuse_client()
    if client:
        client.score_current_trace(name=name, comment=comment, metadata=metadata, **_typed(value, data_type))


def score_trace(
    trace_id: str,
    name: str,
    value: float | str,
    *,
    comment: str | None = None,
    data_type: ScoreDataType | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Scores any trace by ID, e.g. when feedback arrives in a later HTTP request."""
    client = get_langfuse_client()
    if client:
        client.create_score(trace_id=trace_id, name=name, comment=comment, metadata=metadata, **_typed(value, data_type))


def record_user_feedback(*, trace_id: str, positive: bool, comment: str | None = None) -> None:
    """Records end-user feedback as a BOOLEAN score named "user_feedback"."""
    score_trace(trace_id, "user_feedback", 1 if positive else 0, data_type="BOOLEAN", comment=comment)
