"""stdio MCP server: validate_deck_spec, render_deck, record_feedback, langfuse_status.

Reuses repo_deck_renderer (vendored from langfuse_turborepo/packages/deck-renderer).
Langfuse is optional: it is used only when LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set,
via the vendored repo_langfuse / repo_observability packages. Logs go to stderr only (stdout is MCP).
"""
from __future__ import annotations

import os
import sys
from contextlib import nullcontext
from pathlib import Path
from typing import Any

from mcp.server.mcpserver import MCPServer
from repo_deck_renderer import render

mcp = MCPServer("deck-forge")
_LF: dict[str, Any] = {"ready": False, "enabled": False}


def _log(msg: str) -> None:
    print(f"[deck-forge-mcp] {msg}", file=sys.stderr, flush=True)


def _clean_env() -> None:
    # mcp.json passes "${VAR}"; an unset var may arrive empty or literally. Treat both as unset.
    for k, v in list(os.environ.items()):
        if (k.startswith("LANGFUSE_") or k.startswith("DECK_FORGE_")) and (not v.strip() or v.startswith("${")):
            del os.environ[k]


def _langfuse() -> bool:
    if _LF["ready"]:
        return _LF["enabled"]
    _LF["ready"] = True
    if not (os.environ.get("LANGFUSE_PUBLIC_KEY") and os.environ.get("LANGFUSE_SECRET_KEY")):
        _log("Langfuse off (no keys)")
        return False
    try:
        from repo_langfuse import describe_langfuse_config, get_langfuse_config, init_langfuse
        cfg = get_langfuse_config()
        init_langfuse(config=cfg, silent=True)
        _LF["enabled"] = True
        _log(describe_langfuse_config(cfg))
    except Exception as e:  # fail open: rendering must never depend on tracing
        _log(f"Langfuse init failed, continuing without it: {type(e).__name__}")
    return _LF["enabled"]


def _problems(spec: Any) -> list[str]:
    p: list[str] = []
    if not isinstance(spec, dict):
        return ["spec must be a JSON object"]
    if not isinstance(spec.get("title"), str) or not spec["title"].strip():
        p.append("title must be a non-empty string")
    if "subtitle" in spec and not isinstance(spec["subtitle"], str):
        p.append("subtitle must be a string")
    slides = spec.get("slides")
    if not isinstance(slides, list) or not slides:
        return p + ["slides must be a non-empty list"]
    for i, s in enumerate(slides, start=2):
        if not isinstance(s, dict):
            p.append(f"slide {i}: must be an object"); continue
        if not isinstance(s.get("title", ""), str): p.append(f"slide {i}: title must be a string")
        b = s.get("bullets", [])
        if not isinstance(b, list) or not all(isinstance(x, str) for x in b):
            p.append(f"slide {i}: bullets must be a list of strings")
        elif len(b) > 8:
            p.append(f"slide {i}: at most 8 bullets (3-5 recommended), got {len(b)}")
        if not isinstance(s.get("notes", ""), str): p.append(f"slide {i}: notes must be a string")
    return p


@mcp.tool()
def validate_deck_spec(spec: dict) -> dict:
    """Check Deck Forge slide JSON ({title, subtitle, slides:[{title, bullets[], notes}]}). Returns {ok, problems, slide_count}."""
    probs = _problems(spec)
    n = 1 + len(spec.get("slides") or []) if isinstance(spec, dict) else 0
    return {"ok": not probs, "problems": probs, "slide_count": n}


@mcp.tool()
def render_deck(spec: dict, out_path: str = "", prompt: str = "") -> dict:
    """Render Deck Forge slide JSON to a .pptx with python-pptx. out_path defaults to
    $DECK_FORGE_OUT_DIR (or ./decks)/<title>.pptx. Traced to Langfuse when keys are set."""
    probs = _problems(spec)
    if probs:
        return {"ok": False, "problems": probs}
    if out_path:
        out = Path(out_path).expanduser()
    else:
        safe = "".join(c if c.isalnum() or c in "-_" else "-" for c in spec["title"].lower())[:60].strip("-") or "deck"
        out = Path(os.environ.get("DECK_FORGE_OUT_DIR") or "decks") / f"{safe}.pptx"
    if out.suffix.lower() != ".pptx":
        out = out.with_suffix(".pptx")
    out = out.resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    result: dict[str, Any] = {"ok": True, "path": str(out)}
    if _langfuse():
        from repo_langfuse import flush_langfuse
        from repo_observability import get_current_trace_id, start_as_current_observation
        ctx = start_as_current_observation(as_type="span", name="deck-forge render_deck",
                                           input={"prompt": prompt, "spec": spec})
    else:
        ctx = nullcontext()
    with ctx as span:
        n = render(spec, str(out))
        result["slide_count"] = n
        if span is not None:
            span.update(output={"path": str(out), "slide_count": n})
            tid = get_current_trace_id()
            if tid:
                result["trace_id"] = tid
    if _LF["enabled"]:
        flush_langfuse()
    return result


@mcp.tool()
def record_feedback(trace_id: str, positive: bool, comment: str = "") -> dict:
    """Record thumbs up/down for a render_deck trace as a Langfuse score. Needs Langfuse keys."""
    if not _langfuse():
        return {"ok": False, "error": "Langfuse is off (set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY)"}
    from repo_langfuse import flush_langfuse
    from repo_observability import record_user_feedback
    record_user_feedback(trace_id=trace_id, positive=positive, comment=comment or None)
    flush_langfuse()
    return {"ok": True}


@mcp.tool()
def langfuse_status() -> dict:
    """Report whether Langfuse tracing is enabled (never returns key values)."""
    return {"enabled": _langfuse(), "base_url": os.environ.get("LANGFUSE_BASE_URL") or "(default)"}


def main() -> None:
    _clean_env()
    mcp.run()  # stdio


if __name__ == "__main__":
    main()
