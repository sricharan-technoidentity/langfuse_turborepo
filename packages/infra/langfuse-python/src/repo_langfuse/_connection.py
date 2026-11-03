"""Connection to Langfuse: .env loading, config, the shared client and shutdown.

Python counterpart of @repo/langfuse (packages/infra/langfuse): same env vars, same placeholder rules.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from langfuse import Langfuse
from langfuse.types import MaskFunction
from opentelemetry.sdk.trace.export import SpanExporter

DEFAULT_LANGFUSE_BASE_URL = "https://cloud.langfuse.com"

# Template values like "<your-langfuse-public-key>" or "pk-lf-..." count as unset.
_PLACEHOLDER = re.compile(r"^<.*>$|\.\.\.$")


@dataclass(frozen=True)
class LangfuseConfig:
    enabled: bool
    public_key: str | None
    secret_key: str | None
    base_url: str
    environment: str
    release: str | None


def _clean(value: str | None) -> str | None:
    value = (value or "").strip()
    return None if not value or _PLACEHOLDER.search(value) else value


def get_langfuse_config(env: Mapping[str, str] | None = None) -> LangfuseConfig:
    """Reads Langfuse settings from environment variables (same names as the official SDKs)."""
    env = os.environ if env is None else env
    public_key = _clean(env.get("LANGFUSE_PUBLIC_KEY"))
    secret_key = _clean(env.get("LANGFUSE_SECRET_KEY"))
    return LangfuseConfig(
        enabled=bool(public_key and public_key.startswith("pk-lf-") and secret_key and secret_key.startswith("sk-lf-")),
        public_key=public_key,
        secret_key=secret_key,
        base_url=_clean(env.get("LANGFUSE_BASE_URL")) or DEFAULT_LANGFUSE_BASE_URL,
        environment=_clean(env.get("LANGFUSE_TRACING_ENVIRONMENT")) or "development",
        release=_clean(env.get("LANGFUSE_RELEASE")),
    )


def is_langfuse_enabled(env: Mapping[str, str] | None = None) -> bool:
    return get_langfuse_config(env).enabled


def describe_langfuse_config(config: LangfuseConfig | None = None) -> str:
    """A one-line, secret-free description of the current setup, for startup logs."""
    config = config or get_langfuse_config()
    if not config.enabled:
        return "Langfuse: disabled (set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in packages/infra/.env to send traces)"
    key = f"{config.public_key[:10]}…" if config.public_key else "?"
    return f"Langfuse: enabled → {config.base_url} (env: {config.environment}, key: {key})"


# The shared infra env file: packages/infra/.env (next to .env.example). Only exists in the repo
# (editable install); a non-editable install simply skips it.
INFRA_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"

_loaded: list[Path] | None = None


def _parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.removeprefix("export ").split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        else:
            value = value.split(" #", 1)[0].strip()
        values[key.strip()] = value
    return values


def _find_nearest_env(start_dir: Path) -> Path | None:
    """Nearest `.env` walking up from `start_dir`, stopping at the monorepo root."""
    for directory in (start_dir, *start_dir.parents):
        if (directory / ".env").is_file():
            return directory / ".env"
        if (directory / "pnpm-workspace.yaml").exists() or (directory / "turbo.json").exists():
            return None
    return None


def load_env(start_dir: str | Path | None = None, infra_env_file: Path = INFRA_ENV_FILE) -> list[Path]:
    """Loads env files, highest priority first (a variable is never overwritten once set):
      1. real environment variables (CI, Docker...)
      2. the nearest `.env` walking up from `start_dir` (default: cwd; your app folder or the repo root)
      3. `packages/infra/.env`, the shared infra config
    Returns the files that were loaded. Same rules as `loadEnv` in @repo/langfuse."""
    global _loaded
    if _loaded is not None:
        return _loaded

    nearest = _find_nearest_env(Path(start_dir or Path.cwd()).resolve())
    _loaded = []
    for file in (nearest, infra_env_file.resolve()):
        if file is not None and file.is_file() and file not in _loaded:
            for key, value in _parse_env_file(file).items():
                os.environ.setdefault(key, value)
            _loaded.append(file)
    return _loaded


_UNSET = object()
_langfuse: Langfuse | None = None
_api_client: Langfuse | None | object = _UNSET


def init_langfuse(
    *,
    config: LangfuseConfig | None = None,
    span_exporter: SpanExporter | None = None,
    mask: MaskFunction | None = None,
    silent: bool = False,
) -> Langfuse:
    """Creates the shared Langfuse client (tracing + API). Call once at startup.

    Without keys, tracing is switched off explicitly (the SDK would otherwise read placeholder
    keys from the environment) and the API features (prompts, scores, experiments) run locally.
    """
    global _langfuse
    if _langfuse is not None:
        return _langfuse

    config = config or get_langfuse_config()
    exporting = config.enabled or span_exporter is not None
    _langfuse = Langfuse(
        # A custom exporter (tests) needs a key-shaped value; nothing is sent to Langfuse with it.
        public_key=config.public_key if config.enabled else ("pk-lf-local" if span_exporter else None),
        secret_key=config.secret_key if config.enabled else ("sk-lf-local" if span_exporter else None),
        base_url=config.base_url,
        environment=config.environment,
        release=config.release,
        tracing_enabled=exporting,
        span_exporter=span_exporter,
        mask=mask,
    )
    if not exporting and not silent:
        print(
            "[langfuse] Keys not configured — nothing is sent. "
            "Copy packages/infra/.env.example to packages/infra/.env and add your Langfuse Cloud keys."
        )
    return _langfuse


def get_langfuse_client() -> Langfuse | None:
    """The shared client for API features, or None when Langfuse keys are not configured.
    Callers treat None as "run without Langfuse"."""
    if _api_client is not _UNSET:
        return _api_client  # type: ignore[return-value]
    return init_langfuse(silent=True) if get_langfuse_config().enabled else None


def set_langfuse_client(client: Langfuse | None | object = _UNSET) -> None:
    """Override the API client (None forces "disabled"; no argument restores the default). For tests."""
    global _api_client
    _api_client = client


def flush_langfuse() -> None:
    """Sends buffered spans and scores now. Call before a short-lived process exits."""
    if _langfuse is not None:
        _langfuse.flush()


def shutdown_langfuse() -> None:
    """Flushes and stops the client. Call once on shutdown."""
    global _langfuse
    if _langfuse is not None:
        _langfuse.shutdown()
        _langfuse = None
