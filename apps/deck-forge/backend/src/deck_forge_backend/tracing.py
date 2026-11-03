"""Langfuse wiring for Deck Forge. Uses repo_langfuse (connection) and repo_observability (features).

Without Langfuse keys every helper here is a no-op, so the app behaves exactly like v0.1.2."""

from __future__ import annotations

import contextlib
import os
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from repo_langfuse import (
    describe_langfuse_config,
    flush_langfuse,
    get_langfuse_client,
    get_langfuse_config,
    init_langfuse,
    shutdown_langfuse,
)
from repo_observability import (
    get_current_trace_id,
    propagate_attributes,
    record_user_feedback,
    start_as_current_observation,
)

_enabled = False
_trace_url_prefix: str | None = None
_LF_KEY = re.compile(r"^LANGFUSE_[A-Z_]+$")


class _Noop:
    def update(self, **_: Any) -> "_Noop":
        return self


def load_env_file(path: Path) -> list[str]:
    """Loads LANGFUSE_* lines from an env file into os.environ (real env vars win). Returns the names
    loaded (never values). The Kiro Crew gateway strips LANGFUSE_* from the backend env, so this file
    (data/langfuse.env in the app's data dir) is how the installed app gets its keys."""
    loaded: list[str] = []
    if not path.is_file():
        return loaded
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.removeprefix("export ").split("=", 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if _LF_KEY.match(key) and key not in os.environ:
            os.environ[key] = value
            loaded.append(key)
    return loaded


def setup(env_file: Path | None = None) -> bool:
    """Call once at startup. Enables tracing only when real keys are configured."""
    global _enabled
    names = load_env_file(env_file) if env_file else []
    config = get_langfuse_config()
    if config.enabled:
        init_langfuse(config=config, silent=True)
        _enabled = True
    print(f"[deck-forge] {describe_langfuse_config(config)}; env file vars: {names or 'none'}", flush=True)
    return _enabled


def enable_for_tests() -> None:
    """Used by tests after repo_observability.testing.create_test_tracing()."""
    global _enabled
    _enabled = True


def disable() -> None:
    global _enabled
    _enabled = False


def is_enabled() -> bool:
    return _enabled


def observation(**kwargs: Any) -> Any:
    return start_as_current_observation(**kwargs) if _enabled else contextlib.nullcontext(_Noop())


@contextlib.contextmanager
def job_attributes(*, user_id: str | None, session_id: str | None, tags: list[str],
                   metadata: dict[str, str], version: str) -> Iterator[None]:
    if not _enabled:
        yield
        return
    with propagate_attributes(user_id=user_id, session_id=session_id, tags=tags, metadata=metadata,
                              version=version, trace_name="deck-forge"):
        yield


def current_trace_id() -> str | None:
    return get_current_trace_id() if _enabled else None


def trace_url(trace_id: str | None) -> str | None:
    """Link to the trace in the Langfuse UI. The project lookup is done once per process."""
    global _trace_url_prefix
    if not trace_id or not _enabled:
        return None
    if _trace_url_prefix is None:
        client = get_langfuse_client()
        if client is None:
            return None
        try:
            url = client.get_trace_url(trace_id=trace_id)
        except Exception:  # noqa: BLE001
            return None
        if not url or not url.endswith(trace_id):
            return url
        _trace_url_prefix = url[: -len(trace_id)]
    return _trace_url_prefix + trace_id


def feedback(trace_id: str, positive: bool, comment: str | None = None) -> bool:
    if not _enabled or get_langfuse_client() is None:
        return False
    record_user_feedback(trace_id=trace_id, positive=positive, comment=comment)
    flush()
    return True


def flush() -> None:
    if _enabled:
        try:
            flush_langfuse()
        except Exception:  # noqa: BLE001
            pass


def shutdown() -> None:
    if _enabled:
        try:
            shutdown_langfuse()
        except Exception:  # noqa: BLE001
            pass
