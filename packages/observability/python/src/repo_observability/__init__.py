"""repo_observability — Langfuse for Python apps: connection, tracing helpers, prompt management,
scores/feedback and experiments. Python counterpart of @repo/langfuse + @repo/observability.

Call `load_env()` + `init_langfuse()` once at startup and `shutdown_langfuse()` before exit.
"""

from langfuse import Evaluation

from ._connection import (
    DEFAULT_LANGFUSE_BASE_URL,
    LangfuseConfig,
    describe_langfuse_config,
    flush_langfuse,
    get_langfuse_client,
    get_langfuse_config,
    init_langfuse,
    is_langfuse_enabled,
    load_env,
    set_langfuse_client,
    shutdown_langfuse,
)
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
    "DEFAULT_LANGFUSE_BASE_URL",
    "ChatMessage",
    "ChatPromptDefinition",
    "Evaluation",
    "ExperimentItem",
    "ExperimentSummary",
    "ItemResult",
    "LangfuseConfig",
    "ResolvedChatPrompt",
    "ScoreDataType",
    "SeedResult",
    "compile_template",
    "define_chat_prompt",
    "describe_langfuse_config",
    "flush_langfuse",
    "get_chat_prompt",
    "get_current_trace_id",
    "get_langfuse_client",
    "get_langfuse_config",
    "init_langfuse",
    "is_langfuse_enabled",
    "load_env",
    "observe",
    "propagate_attributes",
    "record_user_feedback",
    "run_experiment",
    "score_current_trace",
    "score_trace",
    "seed_chat_prompt",
    "set_langfuse_client",
    "shutdown_langfuse",
    "start_as_current_observation",
    "sync_dataset",
]
