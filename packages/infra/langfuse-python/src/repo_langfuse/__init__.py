"""repo_langfuse — the connection to Langfuse for Python apps: env files, config, the shared
client and shutdown. Python counterpart of @repo/langfuse. Features (tracing helpers, prompts,
scores, experiments) live in repo_observability.

Call `load_env()` + `init_langfuse()` once at startup and `shutdown_langfuse()` before exit.
"""

from ._connection import (
    DEFAULT_LANGFUSE_BASE_URL,
    INFRA_ENV_FILE,
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

__all__ = [
    "DEFAULT_LANGFUSE_BASE_URL",
    "INFRA_ENV_FILE",
    "LangfuseConfig",
    "describe_langfuse_config",
    "flush_langfuse",
    "get_langfuse_client",
    "get_langfuse_config",
    "init_langfuse",
    "is_langfuse_enabled",
    "load_env",
    "set_langfuse_client",
    "shutdown_langfuse",
]
