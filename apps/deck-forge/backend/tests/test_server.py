"""Validation, HMAC and job flow through the real HTTP server, with the fake kiro-cli. No credentials."""
import hashlib, hmac, json, threading, time, urllib.error, urllib.request
from http.server import ThreadingHTTPServer

import pytest

from deck_forge_backend import server


@pytest.fixture
def base():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), server.H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown(); server.SECRET = ""


def req(base, method, path, body=None, secret=None, ts=None, tamper=False):
    data = json.dumps(body).encode() if body is not None else b""
    r = urllib.request.Request(base + path, data=data if method == "POST" else None, method=method)
    r.add_header("Content-Type", "application/json")
    if secret:
        ts = str(ts or int(time.time()))
        msg = f"{ts}:{method}:{path}:{hashlib.sha256(data if method == 'POST' else b'').hexdigest()}"
        sig = hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()
        r.add_header("X-KiroCrew-Proxy", f"{ts}:{'0' * 64 if tamper else sig}")
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def test_health_needs_no_signature(base):
    server.SECRET = "s3"
    assert req(base, "GET", "/health")[:2] == (200, b'{"ok": true}')


def test_hmac_rejects_missing_bad_and_stale(base):
    server.SECRET = "s3"
    assert req(base, "GET", "/api/jobs")[0] == 401
    assert req(base, "GET", "/api/jobs", secret="s3", tamper=True)[0] == 401
    assert req(base, "GET", "/api/jobs", secret="s3", ts=int(time.time()) - 120)[0] == 401
    assert req(base, "GET", "/api/jobs", secret="wrong")[0] == 401
    assert req(base, "GET", "/api/jobs", secret="s3")[0] == 200


def test_validation(base):
    assert req(base, "POST", "/api/generate", {"prompt": "  "})[0] == 400
    assert req(base, "POST", "/api/generate", {})[0] == 400
    assert req(base, "GET", "/api/jobs/zzz")[0] == 404
    assert json.loads(req(base, "GET", "/api/jobs/000000000000")[1]) == {"error": "not found"}
    assert req(base, "GET", "/api/download/000000000000")[0] == 404
    assert req(base, "POST", "/api/feedback", {"id": "nope", "positive": True})[0] == 404


def _wait(base, jid, secret=None):
    for _ in range(100):
        j = json.loads(req(base, "GET", f"/api/jobs/{jid}", secret=secret)[1])
        if j["status"] in ("done", "error"): return j
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_generate_download_signed(base):
    server.SECRET = "s3"
    code, body, _ = req(base, "POST", "/api/generate", {"prompt": "Fake deck, 3 slides"}, secret="s3")
    assert code == 202
    jid = json.loads(body)["id"]
    j = _wait(base, jid, "s3")
    assert j["status"] == "done" and j["slides"] == 3 and j["title"] == "Fake Deck"
    assert "trace_id" not in j  # Langfuse off -> no trace, same as v0.1.2
    code, data, hdr = req(base, "GET", f"/api/download/{jid}", secret="s3")
    assert code == 200 and data[:2] == b"PK" and 'filename="Fake-Deck.pptx"' in hdr["Content-Disposition"]
    assert req(base, "POST", "/api/feedback", {"id": jid, "positive": True}, secret="s3")[0] == 409


def test_agent_failure_is_job_error(base):
    jid = json.loads(req(base, "POST", "/api/generate", {"prompt": "FAIL please"})[1])["id"]
    j = _wait(base, jid)
    assert j["status"] == "error" and "no JSON" in j["error"]


def test_hmac_rejects_tampered_body(base):
    """Signature computed over one body, a different body sent -> 401."""
    server.SECRET = "s3"
    ts = str(int(time.time()))
    signed = json.dumps({"prompt": "a"}).encode()
    sent = json.dumps({"prompt": "b"}).encode()
    sig = hmac.new(b"s3", f"{ts}:POST:/api/generate:{hashlib.sha256(signed).hexdigest()}".encode(), hashlib.sha256).hexdigest()
    r = urllib.request.Request(base + "/api/generate", data=sent, method="POST", headers={"X-KiroCrew-Proxy": f"{ts}:{sig}"})
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(r)
    assert e.value.code == 401
