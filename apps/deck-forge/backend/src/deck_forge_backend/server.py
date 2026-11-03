"""Deck Forge backend: POST /api/generate {prompt} -> job; GET /api/jobs/<id>; GET /api/download/<id>;
POST /api/feedback {id, positive}. Runs the app's shipped Kiro agent (deck-forge-writer) through kiro-cli
(no tools trusted), parses its slide JSON and renders a .pptx with repo_deck_renderer. Stdlib HTTP server
bound to 127.0.0.1:$PORT. Each job is one Langfuse trace when Langfuse keys are configured."""
from __future__ import annotations

import atexit, hashlib, hmac, json, os, re, shutil, signal, subprocess, sys, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from . import tracing

APP = "deck-forge"
APP_ROOT = Path(os.environ.get("DECK_FORGE_APP_ROOT") or Path(__file__).resolve().parents[2])
HOME = Path(os.environ.get("KIROCREW_HOME") or Path.home() / ".kiro" / "crew")
DATA = HOME / "apps" / APP / "data"
DECKS = DATA / "decks"; DECKS.mkdir(parents=True, exist_ok=True)
ENV_FILE = DATA / "langfuse.env"
SECRET = os.environ.get("KIROCREW_PROXY_SECRET", "")
KIRO = os.environ.get("DECK_FORGE_KIRO_CLI") or shutil.which("kiro-cli") or str(Path.home() / ".local/bin/kiro-cli")
JOBS: dict[str, dict[str, Any]] = {}
ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
AGENT_FILE = APP_ROOT / "agents" / "deck-forge-writer.json"
_ID = re.compile(r"^[A-Za-z0-9._:@-]{1,128}$")


def app_version() -> str:
    try:
        return str(json.loads((APP_ROOT / "app.json").read_text()).get("version", "?"))
    except Exception:  # noqa: BLE001
        return "?"


def agent_workspace() -> tuple[Path, str]:
    """A cwd whose .kiro/agents holds the app's shipped agent, so kiro-cli resolves it locally."""
    ws = DATA / "agent-ws"; (ws / ".kiro" / "agents").mkdir(parents=True, exist_ok=True)
    src = json.loads(AGENT_FILE.read_text())
    spec = {k: src[k] for k in ("name", "description", "prompt", "tools", "allowedTools") if k in src}
    (ws / ".kiro" / "agents" / "deck-forge-writer.json").write_text(json.dumps(spec, indent=2))
    return ws, src["name"]


def agent_model() -> str:
    try:
        return str(json.loads(AGENT_FILE.read_text()).get("model") or "auto")
    except Exception:  # noqa: BLE001
        return "auto"


def extract_json(text: str) -> dict[str, Any]:
    text = ANSI.sub("", text)
    a, b = text.find("{"), text.rfind("}")
    if a < 0 or b <= a: raise ValueError("agent returned no JSON")
    return json.loads(text[a:b + 1])  # type: ignore[no-any-return]


def _clean_id(v: Any) -> str | None:
    return v if isinstance(v, str) and _ID.match(v) else None


def _clean_tags(v: Any) -> list[str]:
    if not isinstance(v, list): return []
    return [t for t in v if isinstance(t, str) and re.fullmatch(r"[A-Za-z0-9._-]{1,40}", t)][:5]


def run_job(jid: str, prompt: str, user_id: str | None = None, session_id: str | None = None,
            extra_tags: list[str] | None = None) -> None:
    job = JOBS[jid]
    version = app_version()
    tags = ["deck-forge", "kiro-crew", *(extra_tags or [])]
    meta = {"app": APP, "app_version": version, "agent": "deck-forge-writer", "job_id": jid}
    with tracing.job_attributes(user_id=user_id, session_id=session_id, tags=tags, metadata=meta, version=version):
        with tracing.observation(as_type="agent", name="deck-forge", input=prompt, metadata=meta) as root:
            tid = tracing.current_trace_id()
            if tid:
                job["trace_id"] = tid
                url = tracing.trace_url(tid)
                if url: job["trace_url"] = url
                (DECKS / f"{jid}.trace.json").write_text(json.dumps({"trace_id": tid, "trace_url": url}))
            try:
                (DECKS / f"{jid}.prompt.txt").write_text(prompt)
                ws, agent = agent_workspace()
                job["status"] = "writing"
                env = dict(os.environ); env.setdefault("HOME", str(Path.home()))
                for k in list(env):
                    if k.startswith("LANGFUSE_"): env.pop(k)  # the agent never needs Langfuse keys
                message = f"Deck request: {prompt}"
                argv = [KIRO, "chat", "--no-interactive", "--agent", agent, "--trust-tools=", message]
                with tracing.observation(as_type="generation", name="kiro-cli deck-forge-writer", model=agent_model(),
                                         input=message,
                                         metadata={"agent": agent, "cli": "kiro-cli chat --no-interactive --trust-tools=",
                                                   "model_source": "agent config (kiro-cli output does not name the model)"}) as gen:
                    t0 = time.time()
                    try:
                        p = subprocess.run(argv, cwd=ws, env=env, capture_output=True, text=True, timeout=300)
                    except Exception as e:  # noqa: BLE001
                        gen.update(level="ERROR", status_message=f"{type(e).__name__}: {e}")
                        raise
                    (DECKS / f"{jid}.agent.txt").write_text(p.stdout + "\n--- stderr ---\n" + p.stderr)
                    out = ANSI.sub("", p.stdout).strip()
                    gen.update(output=out[:20000], metadata={"exit_code": p.returncode, "duration_s": round(time.time() - t0, 3)})
                    try:
                        spec = extract_json(p.stdout)
                    except Exception as e:  # noqa: BLE001
                        gen.update(level="ERROR", status_message=f"{type(e).__name__}: {e}")
                        raise
                (DECKS / f"{jid}.json").write_text(json.dumps(spec, indent=2))
                job["status"] = "rendering"
                from repo_deck_renderer import render
                outp = DECKS / f"{jid}.pptx"
                with tracing.observation(as_type="span", name="render-pptx",
                                         input={"title": spec.get("title", ""), "slides_in_spec": len(spec.get("slides") or [])}) as sp:
                    try:
                        job["slides"] = render(spec, str(outp))
                    except Exception as e:  # noqa: BLE001
                        sp.update(level="ERROR", status_message=f"{type(e).__name__}: {e}")
                        raise
                    sp.update(output={"file": outp.name, "slides": job["slides"], "bytes": outp.stat().st_size})
                job.update(status="done", title=spec.get("title", ""), file=outp.name)
                root.update(output={"title": job["title"], "slides": job["slides"]})
            except Exception as e:  # noqa: BLE001
                job.update(status="error", error=f"{type(e).__name__}: {e}")
                root.update(level="ERROR", status_message=job["error"], output={"error": job["error"]})
    job["finished"] = time.time()
    tracing.flush()


def verified(h: Any) -> bool:
    if not SECRET: return True  # standalone/dev run
    hdr = h.headers.get("X-KiroCrew-Proxy", "")
    try: ts, sig = hdr.split(":", 1)
    except ValueError: return False
    if not ts.isdigit() or abs(time.time() - int(ts)) > 60: return False
    msg = f"{ts}:{h.command}:{h.path}:{hashlib.sha256(h._body).hexdigest()}"
    return hmac.compare_digest(sig, hmac.new(SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest())


class H(BaseHTTPRequestHandler):
    _body: bytes = b""

    def _send(self, code: int, obj: Any = None, raw: bytes | None = None, ctype: str = "application/json",
              extra: dict[str, str] | None = None) -> None:
        data = raw if raw is not None else json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(data)

    def _handle(self) -> None:
        n = int(self.headers.get("Content-Length") or 0)
        self._body = self.rfile.read(n) if n else b""
        path = self.path.split("?", 1)[0]
        if path == "/health": return self._send(200, {"ok": True})
        if not verified(self): return self._send(401, {"error": "bad proxy signature"})
        if self.command == "POST" and path == "/api/generate":
            body = json.loads(self._body or b"{}")
            prompt = (body.get("prompt") or "").strip()
            if not prompt: return self._send(400, {"error": "prompt required"})
            jid = uuid.uuid4().hex[:12]
            JOBS[jid] = {"id": jid, "prompt": prompt[:2000], "status": "queued", "started": time.time()}
            threading.Thread(target=run_job, args=(jid, prompt[:2000], _clean_id(body.get("userId")),
                             _clean_id(body.get("sessionId")), _clean_tags(body.get("tags"))), daemon=True).start()
            return self._send(202, JOBS[jid])
        if self.command == "POST" and path == "/api/feedback":
            body = json.loads(self._body or b"{}")
            job = JOBS.get(str(body.get("id", "")))
            if not job: return self._send(404, {"error": "not found"})
            if not isinstance(body.get("positive"), bool): return self._send(400, {"error": "positive (bool) required"})
            if not job.get("trace_id"): return self._send(409, {"error": "no trace for this job (Langfuse off)"})
            comment = body.get("comment") if isinstance(body.get("comment"), str) else None
            scored = tracing.feedback(job["trace_id"], body["positive"], comment)
            job["feedback"] = "up" if body["positive"] else "down"
            return self._send(200, {"ok": True, "scored": scored, "feedback": job["feedback"]})
        if self.command == "GET" and path == "/api/jobs":
            return self._send(200, sorted(JOBS.values(), key=lambda j: -j["started"]))
        m = re.fullmatch(r"/api/jobs/([0-9a-f]{12})", path)
        if self.command == "GET" and m:
            return self._send(200, JOBS.get(m[1]) or {"error": "not found"})
        m = re.fullmatch(r"/api/download/([0-9a-f]{12})", path)
        if self.command == "GET" and m and (DECKS / f"{m[1]}.pptx").exists():
            title = re.sub(r"[^A-Za-z0-9]+", "-", JOBS.get(m[1], {}).get("title", "deck")).strip("-") or "deck"
            return self._send(200, raw=(DECKS / f"{m[1]}.pptx").read_bytes(),
                ctype="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                extra={"Content-Disposition": f'attachment; filename="{title[:60]}.pptx"'})
        return self._send(404, {"error": "not found"})
    do_GET = do_POST = _handle

    def log_message(self, *a: Any) -> None: pass


def load_existing() -> None:
    """Rebuild the job list from decks on disk so finished decks survive a backend restart."""
    for f in DECKS.glob("*.pptx"):
        jid = f.stem
        try: spec = json.loads((DECKS / f"{jid}.json").read_text())
        except Exception: spec = {}  # noqa: BLE001
        JOBS[jid] = {"id": jid, "prompt": (DECKS / f"{jid}.prompt.txt").read_text() if (DECKS / f"{jid}.prompt.txt").exists() else "",
                     "status": "done", "title": spec.get("title", jid), "slides": 1 + len(spec.get("slides") or []),
                     "file": f.name, "started": f.stat().st_mtime}
        try: JOBS[jid].update({k: v for k, v in json.loads((DECKS / f"{jid}.trace.json").read_text()).items() if v})
        except Exception: pass  # noqa: BLE001


def main() -> None:
    tracing.setup(ENV_FILE)
    atexit.register(tracing.shutdown)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))  # -> atexit -> flush + shutdown
    load_existing()
    port = int(os.environ.get("PORT", "8765"))
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()


if __name__ == "__main__":
    main()
