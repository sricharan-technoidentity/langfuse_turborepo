import json
from typing import Any

from repo_observability import (
    Evaluation,
    get_current_trace_id,
    observe,
    propagate_attributes,
    record_user_feedback,
    run_experiment,
    score_current_trace,
)
from repo_observability.testing import TestTracing


def test_nests_observations_and_propagates_user_session_tags(tracing: TestTracing) -> None:
    trace_ids: list[str | None] = []

    @observe(name="llm-call", as_type="generation")
    def llm_call(message: str) -> str:
        return message.upper()

    @observe(name="handle-request", as_type="agent")
    def handle_request(message: str) -> str:
        trace_ids.append(get_current_trace_id())
        score_current_trace("checked", 1)  # no-op: the API client is disabled in tests
        return llm_call(message)

    with propagate_attributes(user_id="user-1", session_id="session-1", tags=["test"]):
        assert handle_request("hello") == "HELLO"

    [generation] = tracing.by_name("llm-call")
    [root] = tracing.by_name("handle-request")

    assert trace_ids[0] is not None and len(trace_ids[0]) == 32
    assert root.type == "agent"
    assert generation.type == "generation"
    assert generation.parent_span_id == root.span_id
    assert root.trace_id == trace_ids[0]
    assert root.attributes["user.id"] == "user-1"
    assert root.attributes["session.id"] == "session-1"
    assert root.attributes["langfuse.environment"] == "test"
    assert json.loads(str(root.attributes["langfuse.observation.input"]))["args"] == ["hello"]


def test_feedback_is_a_no_op_without_langfuse(tracing: TestTracing) -> None:
    record_user_feedback(trace_id="abc", positive=True, comment="great")


def test_runs_task_and_evaluators_locally_and_averages_scores(tracing: TestTracing) -> None:
    def exact(*, output: Any, expected_output: Any, **_: Any) -> Evaluation:
        return Evaluation(name="exact", value=1 if output == expected_output else 0)

    def count_items(*, item_results: list[Any], **_: Any) -> Evaluation:
        return Evaluation(name="items", value=len(item_results))

    async def async_exact(**kwargs: Any) -> Evaluation:
        return Evaluation(name="exact_async", value=exact(**kwargs).value)

    summary = run_experiment(
        name="double",
        data=[{"input": 1, "expected_output": 2}, {"input": 2, "expected_output": 5}],
        task=lambda item: item["input"] * 2,
        evaluators=[exact, async_exact],
        run_evaluators=[count_items],
    )

    assert summary.mode == "local"
    assert [i.output for i in summary.items] == [2, 4]
    assert all(i.trace_id for i in summary.items)
    assert summary.averages == {"exact": 0.5, "exact_async": 0.5}
    assert [(e.name, e.value) for e in summary.run_evaluations] == [("items", 2)]
    assert len(tracing.by_name("experiment-item: double")) == 2


def test_records_task_errors_per_item(tracing: TestTracing) -> None:
    def fail(item: Any) -> Any:
        raise ValueError("boom")

    summary = run_experiment(name="broken", data=[{"input": 1}], task=fail)
    assert summary.items[0].error == "boom"
    assert summary.items[0].output is None
