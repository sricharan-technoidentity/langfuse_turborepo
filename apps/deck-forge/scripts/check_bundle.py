"""Smoke test of the ASSEMBLED folder: runs dist/deck-forge/backend/server.py as the gateway would (PORT env,
proxy secret), with only the bundle on sys.path for workspace code, against the fake kiro-cli. No credentials."""
import hashlib, hmac, json, os, socket, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
OUT = APP / "dist" / "deck-forge"
for f in ("app.json", "requirements.txt", "ui/dist/index.mjs", "backend/server.py", "agents/deck-forge-writer.json",
          "skills/deck-forge-outline/SKILL.md", "backend/repo_langfuse/__init__.py", "backend/repo_observability/__init__.py",
          "backend/repo_deck_renderer/render.py", "backend/deck_forge_backend/server.py"):
    assert (OUT / f).is_file(), f"missing {f}"
m = json.loads((OUT / "app.json").read_text())
assert m["name"] == "deck-forge" and m["ui"]["pages"][0]["route"] == "/apps/deck-forge"
assert "langfuse>=5.0.4,<5.1" in (OUT / "requirements.txt").read_text()

s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
home = tempfile.mkdtemp(prefix="dfbundle-")
env = {k: v for k, v in os.environ.items() if not k.startswith(("LANGFUSE_", "DECK_FORGE_", "PYTHON"))}
env.update(PORT=str(port), KIROCREW_HOME=home, KIROCREW_PROXY_SECRET="bundle-secret",
           DECK_FORGE_KIRO_CLI=str(APP / "backend/tests/fake-kiro-cli"))
p = subprocess.Popen([sys.executable, "-I", str(OUT / "backend/server.py")], env=env, cwd=home,
                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
# -I isolates from the workspace's editable installs; the bundle's own sys.path insert must suffice.
base = f"http://127.0.0.1:{port}"


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else b""
    ts = str(int(time.time()))
    sig = hmac.new(b"bundle-secret", f"{ts}:{method}:{path}:{hashlib.sha256(data).hexdigest()}".encode(), hashlib.sha256).hexdigest()
    r = urllib.request.Request(base + path, data=data if method == "POST" else None, method=method,
                               headers={"X-KiroCrew-Proxy": f"{ts}:{sig}", "Content-Type": "application/json"})
    with urllib.request.urlopen(r) as resp:
        return resp.status, resp.read()


try:
    for _ in range(100):
        try:
            if urllib.request.urlopen(base + "/health").status == 200: break
        except OSError: time.sleep(0.1)
    else:
        raise SystemExit("bundle backend did not start:\n" + (p.stdout.read() if p.stdout else ""))
    code, body = call("POST", "/api/generate", {"prompt": "bundle check, 3 slides"})
    jid = json.loads(body)["id"]
    for _ in range(100):
        j = json.loads(call("GET", f"/api/jobs/{jid}")[1])
        if j["status"] in ("done", "error"): break
        time.sleep(0.1)
    assert j["status"] == "done" and j["slides"] == 3, j
    assert "trace_id" not in j
    print(f"bundle OK: health 200, generate -> done ({j['slides']} slides), Langfuse off")
finally:
    p.terminate(); p.wait(5)
