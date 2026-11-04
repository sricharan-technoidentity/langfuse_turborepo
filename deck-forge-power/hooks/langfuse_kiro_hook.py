#!/usr/bin/env python3
"""Kiro hook -> Langfuse (OTLP/HTTP JSON). Stdlib only, fail-open (always exit 0).
One Langfuse trace per user turn: UserPromptSubmit opens it, PreToolUse/PostToolUse
add tool observations, Stop closes it with the root span. Grouped by Kiro session_id.
Env: LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL (default EU cloud),
     TRACE_TO_LANGFUSE=true to enable.
"""
import base64, json, os, secrets, sys, time, urllib.request
from pathlib import Path

STATE_DIR = Path(os.environ.get("KIRO_LF_STATE", Path.home() / ".kiro" / "langfuse-state"))
MAX = 20000  # truncate large payloads

def now_ns(): return time.time_ns()
def s(v): v = v if isinstance(v, str) else json.dumps(v, default=str); return v[:MAX]
def attr(k, v):
    if isinstance(v, bool): return {"key": k, "value": {"boolValue": v}}
    if isinstance(v, list): return {"key": k, "value": {"arrayValue": {"values": [{"stringValue": str(x)} for x in v]}}}
    return {"key": k, "value": {"stringValue": s(v)}}

def load(sid):
    p = STATE_DIR / f"{sid}.json"
    try: return json.loads(p.read_text())
    except Exception: return {}
def save(sid, st):
    STATE_DIR.mkdir(parents=True, exist_ok=True); (STATE_DIR / f"{sid}.json").write_text(json.dumps(st))

def send(spans):
    pk, sk = os.environ["LANGFUSE_PUBLIC_KEY"], os.environ["LANGFUSE_SECRET_KEY"]
    base = os.environ.get("LANGFUSE_BASE_URL", "https://cloud.langfuse.com").rstrip("/")
    body = {"resourceSpans": [{
        "resource": {"attributes": [attr("service.name", "kiro")]},
        "scopeSpans": [{"scope": {"name": "kiro-hooks"}, "spans": spans}]}]}
    req = urllib.request.Request(f"{base}/api/public/otel/v1/traces", data=json.dumps(body).encode(),
        method="POST", headers={
            "Content-Type": "application/json",
            "Authorization": "Basic " + base64.b64encode(f"{pk}:{sk}".encode()).decode(),
            "x-langfuse-ingestion-version": "4"})
    urllib.request.urlopen(req, timeout=5).read()

def span(st, name, start, end, attrs, parent=True, span_id=None):
    common = [attr("langfuse.session.id", st["session_id"]), attr("langfuse.trace.name", "kiro-turn"),
              attr("langfuse.user.id", os.environ.get("USER", "unknown")), attr("langfuse.trace.tags", ["kiro"])]
    d = {"traceId": st["trace_id"], "spanId": span_id or secrets.token_hex(8), "name": name, "kind": 1,
         "startTimeUnixNano": str(start), "endTimeUnixNano": str(end), "attributes": common + attrs}
    if parent: d["parentSpanId"] = st["root_id"]
    return d

def new_turn(sid, prompt=""):
    return {"session_id": sid, "trace_id": secrets.token_hex(16), "root_id": secrets.token_hex(8),
            "start": now_ns(), "prompt": prompt, "tools": {}, "n_tools": 0}

def main():
    if os.environ.get("TRACE_TO_LANGFUSE", "").lower() != "true": return
    ev = json.load(sys.stdin)
    name = ev.get("hook_event_name", "")
    sid = ev.get("session_id") or "unknown"
    st = load(sid)
    spans = []
    if name == "UserPromptSubmit":
        st = new_turn(sid, ev.get("prompt") or os.environ.get("USER_PROMPT", ""))
    else:
        if not st.get("trace_id"): st = new_turn(sid)   # tool fired without a prompt event
        if name == "PreToolUse":
            st["tools"][ev.get("tool_name", "?")] = now_ns()
        elif name == "PostToolUse":
            tool = ev.get("tool_name", "?")
            start = st["tools"].pop(tool, now_ns()); st["n_tools"] += 1
            spans.append(span(st, tool, start, now_ns(), [
                attr("langfuse.observation.type", "tool"),
                attr("langfuse.observation.input", ev.get("tool_input", {})),
                attr("langfuse.observation.output", ev.get("tool_response", {})),
                attr("langfuse.observation.metadata.cwd", ev.get("cwd", ""))]))
        elif name in ("Stop", "agentStop", "stop"):
            spans.append(span(st, "kiro-turn", st["start"], now_ns(), [
                attr("langfuse.observation.type", "agent"),
                attr("langfuse.observation.input", st.get("prompt", "")),
                attr("langfuse.observation.metadata.cwd", ev.get("cwd", "")),
                attr("langfuse.observation.metadata.tool_calls", str(st["n_tools"]))],
                parent=False, span_id=st["root_id"]))
            st = {}
    if spans: send(spans)
    save(sid, st)

if __name__ == "__main__":
    try: main()
    except Exception as e:
        if os.environ.get("KIRO_LF_DEBUG"): print(f"langfuse hook error: {e}", file=sys.stderr)
    sys.exit(0)  # never block Kiro; stdout is empty so nothing is injected into context
