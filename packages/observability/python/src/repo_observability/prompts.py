"""Prompt management: prompts are defined in code and can also live in Langfuse.

At runtime the Langfuse version (label "production" by default) is fetched so prompts can be
edited in the UI without a redeploy. The local definition is the fallback when Langfuse is
disabled or unreachable, and the source for `seed_chat_prompt()`.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict

from langfuse.model import ChatPromptClient

from ._connection import get_langfuse_client


class ChatMessage(TypedDict):
    role: Literal["system", "user", "assistant"]
    content: str


@dataclass(frozen=True)
class ChatPromptDefinition:
    name: str
    messages: list[ChatMessage]
    # Model settings stored alongside the prompt (temperature, max_tokens...).
    config: dict[str, Any] = field(default_factory=dict)
    commit_message: str | None = None


def define_chat_prompt(
    *, name: str, messages: list[ChatMessage], config: dict[str, Any] | None = None, commit_message: str | None = None
) -> ChatPromptDefinition:
    return ChatPromptDefinition(name=name, messages=messages, config=config or {}, commit_message=commit_message)


_VARIABLE = re.compile(r"\{\{\s*([\w.-]+)\s*\}\}")


def compile_template(template: str, variables: dict[str, str] | None = None) -> str:
    """Same {{variable}} syntax as Langfuse; unknown variables are left untouched."""
    values = variables or {}
    return _VARIABLE.sub(lambda m: values.get(m.group(1), m.group(0)), template)


@dataclass(frozen=True)
class ResolvedChatPrompt:
    name: str
    # Langfuse version number, or None when the local fallback is used.
    version: int | None
    is_fallback: bool
    # Local config merged with the config stored in Langfuse (Langfuse wins).
    config: dict[str, Any]
    compile: Callable[[dict[str, str] | None], list[ChatMessage]]
    # Pass as `prompt=` to a generation so Langfuse links it to this version. None for fallbacks.
    link: ChatPromptClient | None


def _compile_local(definition: ChatPromptDefinition) -> Callable[[dict[str, str] | None], list[ChatMessage]]:
    def compile_local(variables: dict[str, str] | None = None) -> list[ChatMessage]:
        return [{"role": m["role"], "content": compile_template(m["content"], variables)} for m in definition.messages]

    return compile_local


def get_chat_prompt(
    definition: ChatPromptDefinition, *, label: str = "production", cache_ttl_seconds: int = 60
) -> ResolvedChatPrompt:
    client = get_langfuse_client()
    if client is None:
        return ResolvedChatPrompt(definition.name, None, True, dict(definition.config), _compile_local(definition), None)

    prompt = client.get_prompt(
        definition.name,
        type="chat",
        label=label,
        cache_ttl_seconds=cache_ttl_seconds,
        fallback=[{"role": m["role"], "content": m["content"]} for m in definition.messages],
        max_retries=1,
    )
    remote_config = prompt.config if isinstance(prompt.config, dict) else {}

    def compile_remote(variables: dict[str, str] | None = None) -> list[ChatMessage]:
        return [
            {"role": m["role"], "content": m["content"]}  # type: ignore[typeddict-item]
            for m in prompt.compile(**(variables or {}))
        ]

    return ResolvedChatPrompt(
        name=prompt.name,
        version=None if prompt.is_fallback else prompt.version,
        is_fallback=prompt.is_fallback,
        config={**definition.config, **remote_config},
        compile=compile_remote,
        link=None if prompt.is_fallback else prompt,
    )


class SeedResult(TypedDict, total=False):
    name: str
    status: Literal["created", "unchanged", "skipped"]
    version: int
    reason: str


def seed_chat_prompt(definition: ChatPromptDefinition, *, labels: list[str] | None = None) -> SeedResult:
    """Pushes the local definition to Langfuse and labels it (default "production"). Creates a new
    version only when the messages or config differ, so it's safe to run on every deploy."""
    client = get_langfuse_client()
    if client is None:
        return {"name": definition.name, "status": "skipped", "reason": "Langfuse disabled"}

    labels = labels or ["production"]
    try:
        current = client.get_prompt(definition.name, type="chat", label=labels[0], cache_ttl_seconds=0, max_retries=0)
    except Exception:
        current = None  # not found yet

    # Compare only role + content: the API adds fields such as `type: "chatmessage"`.
    def normalize(messages: Any) -> str:
        if isinstance(messages, list):
            messages = [{"role": m.get("role"), "content": m.get("content")} for m in messages]
        return json.dumps(messages, sort_keys=True)

    if (
        current is not None
        and normalize(current.prompt) == normalize(definition.messages)
        and json.dumps(current.config or {}, sort_keys=True) == json.dumps(definition.config, sort_keys=True)
    ):
        return {"name": definition.name, "status": "unchanged", "version": current.version}

    created = client.create_prompt(
        name=definition.name,
        type="chat",
        prompt=[{"role": m["role"], "content": m["content"]} for m in definition.messages],
        config=definition.config,
        labels=labels,
        commit_message=definition.commit_message or "Seeded from repo",
    )
    return {"name": definition.name, "status": "created", "version": created.version}
