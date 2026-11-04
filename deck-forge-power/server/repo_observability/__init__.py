"""repo_observability — Langfuse features for Python apps: tracing helpers, prompt management,
scores/feedback and experiments. Python counterpart of @repo/observability.

The connection (env files, keys, client, shutdown) is in repo_langfuse: call
`repo_langfuse.load_env()` + `init_langfuse()` once at startup and `shutdown_langfuse()` before exit.
"""

from langfuse import Evaluation

from .experiments import ExperimentItem, ExperimentSummary, ItemResult, run_experiment, sync_dataset
from .prompts import (
    ChatMessage,
    ChatPromptDefinition,
    ResolvedChatPrompt,
    SeedResult,
    compile_template,
    define_chat_prompt,
    get_chat_prompt,
    seed_chat_prompt,
)
from .scores import ScoreDataType, record_user_feedback, score_current_trace, score_trace
from .tracing import get_current_trace_id, observe, propagate_attributes, start_as_current_observation

__all__ = [
    "ChatMessage",
    "ChatPromptDefinition",
    "Evaluation",
    "ExperimentItem",
    "ExperimentSummary",
    "ItemResult",
    "ResolvedChatPrompt",
    "ScoreDataType",
    "SeedResult",
    "compile_template",
    "define_chat_prompt",
    "get_chat_prompt",
    "get_current_trace_id",
    "observe",
    "propagate_attributes",
    "record_user_feedback",
    "run_experiment",
    "score_current_trace",
    "score_trace",
    "seed_chat_prompt",
    "start_as_current_observation",
    "sync_dataset",
]
