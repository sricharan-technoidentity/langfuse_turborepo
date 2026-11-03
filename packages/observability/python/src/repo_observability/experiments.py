"""Experiments = run your app over a fixed set of test cases and score every answer.

- With Langfuse keys: uses the Langfuse experiment runner, so each item becomes a trace and
  results appear under Datasets / Experiments. Pass `dataset_name` to store the test cases as a
  Langfuse dataset and link the run to it.
- Without keys: runs the same task + evaluators locally and returns the same summary.

Evaluators use the SDK's signatures, so the same function works in both modes:
  item evaluator: (*, input, output, expected_output, metadata, **kwargs) -> Evaluation | list[Evaluation]
  run evaluator:  (*, item_results, **kwargs) -> Evaluation | list[Evaluation]
"""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, TypedDict

from langfuse import Evaluation
from langfuse.experiment import ExperimentItemResult

from repo_langfuse import get_langfuse_client
from .tracing import get_current_trace_id, start_as_current_observation


class ExperimentItem(TypedDict, total=False):
    # Stable ID, used to upsert the item when syncing to a Langfuse dataset.
    id: str
    input: Any
    expected_output: Any
    metadata: dict[str, Any]


Task = Callable[[ExperimentItem], Any]
ItemEvaluator = Callable[..., Any]
RunEvaluator = Callable[..., Any]


@dataclass
class ItemResult:
    input: Any
    expected_output: Any
    output: Any
    evaluations: list[Evaluation]
    trace_id: str | None = None
    error: str | None = None


@dataclass
class ExperimentSummary:
    name: str
    run_name: str
    mode: Literal["langfuse", "langfuse-dataset", "local"]
    items: list[ItemResult]
    run_evaluations: list[Evaluation]
    url: str | None = None
    # Mean of every numeric item-level evaluation, by name.
    averages: dict[str, float] = field(default_factory=dict)


def _resolve(value: Any) -> Any:
    # shortcut: async evaluators/tasks run via asyncio.run in local mode, so local runs can't start inside a running event loop.
    return asyncio.run(value) if inspect.iscoroutine(value) else value


def _as_list(value: Evaluation | list[Evaluation]) -> list[Evaluation]:
    return value if isinstance(value, list) else [value]


def _averages(items: list[ItemResult]) -> dict[str, float]:
    totals: dict[str, list[float]] = {}
    for item in items:
        for e in item.evaluations:
            if isinstance(e.value, (int, float)):
                totals.setdefault(e.name, []).append(float(e.value))
    return {name: sum(values) / len(values) for name, values in totals.items()}


def _run_locally(
    name: str, data: list[ExperimentItem], task: Task, evaluators: list[ItemEvaluator], run_evaluators: list[RunEvaluator]
) -> ExperimentSummary:
    run_name = f"{name} - {datetime.now(timezone.utc).isoformat()}"
    items: list[ItemResult] = []
    sdk_results: list[ExperimentItemResult] = []

    for item in data:
        try:
            with start_as_current_observation(name=f"experiment-item: {name}", input=item.get("input")) as span:
                output = _resolve(task(item))
                span.update(output=output)
                trace_id = get_current_trace_id()
            evaluations: list[Evaluation] = []
            for evaluator in evaluators:
                evaluations += _as_list(
                    _resolve(
                        evaluator(
                            input=item.get("input"),
                            output=output,
                            expected_output=item.get("expected_output"),
                            metadata=item.get("metadata"),
                        )
                    )
                )
            items.append(ItemResult(item.get("input"), item.get("expected_output"), output, evaluations, trace_id))
            sdk_results.append(
                ExperimentItemResult(item=item, output=output, evaluations=evaluations, trace_id=trace_id)  # type: ignore[arg-type]
            )
        except Exception as error:
            items.append(ItemResult(item.get("input"), item.get("expected_output"), None, [], error=str(error)))

    run_evaluations: list[Evaluation] = []
    for run_evaluator in run_evaluators:
        run_evaluations += _as_list(_resolve(run_evaluator(item_results=sdk_results)))

    return ExperimentSummary(name, run_name, "local", items, run_evaluations, averages=_averages(items))


def sync_dataset(dataset_name: str, data: list[ExperimentItem], description: str | None = None) -> None:
    """Creates the dataset if needed and upserts every item (by ID), so re-running is safe."""
    client = get_langfuse_client()
    if client is None:
        return
    try:
        client.get_dataset(dataset_name)
    except Exception:
        client.create_dataset(name=dataset_name, description=description)
    for index, item in enumerate(data):
        client.create_dataset_item(
            dataset_name=dataset_name,
            id=item.get("id", f"{dataset_name}-{index}"),
            input=item.get("input"),
            expected_output=item.get("expected_output"),
            metadata=item.get("metadata"),
        )


def _to_item(item: Any) -> ExperimentItem:
    # Langfuse passes local items as dicts and dataset items as objects.
    if isinstance(item, dict):
        return item  # type: ignore[return-value]
    return {"input": item.input, "expected_output": item.expected_output, "metadata": item.metadata or {}}


def run_experiment(
    *,
    name: str,
    data: list[ExperimentItem],
    task: Task,
    evaluators: list[ItemEvaluator] | None = None,
    run_evaluators: list[RunEvaluator] | None = None,
    description: str | None = None,
    metadata: dict[str, str] | None = None,
    max_concurrency: int = 4,
    dataset_name: str | None = None,
) -> ExperimentSummary:
    evaluators = evaluators or []
    run_evaluators = run_evaluators or []
    client = get_langfuse_client()
    if client is None:
        return _run_locally(name, data, task, evaluators, run_evaluators)

    shared: dict[str, Any] = {
        "name": name,
        "description": description,
        "metadata": metadata,
        "task": lambda *, item, **_: task(_to_item(item)),
        "evaluators": evaluators,
        "run_evaluators": run_evaluators,
        "max_concurrency": max_concurrency,
    }
    if dataset_name:
        sync_dataset(dataset_name, data, description)
        result = client.get_dataset(dataset_name).run_experiment(**shared)
        mode: Literal["langfuse", "langfuse-dataset"] = "langfuse-dataset"
    else:
        local_items = [{k: v for k, v in item.items() if k != "id"} for item in data]
        result = client.run_experiment(data=local_items, **shared)  # type: ignore[arg-type]
        mode = "langfuse"

    items = [
        ItemResult(
            input=_to_item(r.item).get("input"),
            expected_output=_to_item(r.item).get("expected_output"),
            output=r.output,
            evaluations=list(r.evaluations),
            trace_id=r.trace_id,
        )
        for r in result.item_results
    ]
    return ExperimentSummary(
        name=name,
        run_name=result.run_name,
        mode=mode,
        items=items,
        run_evaluations=list(result.run_evaluations),
        url=result.dataset_run_url or result.experiment_url,
        averages=_averages(items),
    )
