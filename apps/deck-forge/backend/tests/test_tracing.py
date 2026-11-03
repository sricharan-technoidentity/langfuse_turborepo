"""Trace shape for one generate job, using the in-memory exporter from repo_observability.testing."""
import json, uuid

from repo_langfuse import set_langfuse_client

from deck_forge_backend import server, tracing


def _job(prompt):
    jid = uuid.uuid4().hex[:12]
    server.JOBS[jid] = {"id": jid, "prompt": prompt, "status": "queued", "started": 0}
    return jid


def test_trace_shape(tracing_on):
    jid = _job("Fake deck, 3 slides")
    server.run_job(jid, "Fake deck, 3 slides", user_id="u1", session_id="s1", extra_tags=["smoke-test"])
    job = server.JOBS[jid]
    assert job["status"] == "done" and job["trace_id"]
    spans = tracing_on.spans()
    by = {s.name: s for s in spans}
    root, gen, rend = by["deck-forge"], by["kiro-cli deck-forge-writer"], by["render-pptx"]
    assert (root.type, gen.type, rend.type) == ("agent", "generation", "span")
    assert {s.trace_id for s in spans} == {job["trace_id"]}
    assert gen.parent_span_id == root.span_id and rend.parent_span_id == root.span_id and root.parent_span_id is None
    a = root.attributes
    assert a["langfuse.observation.input"] == "Fake deck, 3 slides"
    assert json.loads(a["langfuse.observation.output"]) == {"title": "Fake Deck", "slides": 3}
    assert a["session.id"] == "s1" and a["user.id"] == "u1"
    assert set(a["langfuse.trace.tags"]) == {"deck-forge", "kiro-crew", "smoke-test"}
    assert json.loads(a["langfuse.trace.metadata.app_version"]) == "0.2.0"
    assert json.loads(a["langfuse.trace.metadata.agent"]) == "deck-forge-writer"
    g = gen.attributes
    assert g["langfuse.observation.model.name"] == "auto"
    assert "Fake Deck" in g["langfuse.observation.output"]
    assert not any("usage" in k or "cost" in k for k in g)  # no invented tokens/cost
    assert json.loads(rend.attributes["langfuse.observation.output"])["slides"] == 3


def test_error_recorded(tracing_on):
    jid = _job("FAIL")
    server.run_job(jid, "FAIL")
    assert server.JOBS[jid]["status"] == "error"
    by = {s.name: s for s in tracing_on.spans()}
    assert by["deck-forge"].attributes["langfuse.observation.level"] == "ERROR"
    assert by["kiro-cli deck-forge-writer"].attributes["langfuse.observation.level"] == "ERROR"
    assert "render-pptx" not in by


class FakeClient:
    def __init__(self): self.scores = []
    def create_score(self, **kw): self.scores.append(kw)
    def get_trace_url(self, *, trace_id): return f"https://us.cloud.langfuse.com/project/p1/traces/{trace_id}"
    def flush(self): pass


def test_trace_url_and_feedback_score(tracing_on):
    fake = FakeClient(); set_langfuse_client(fake); tracing._trace_url_prefix = None
    try:
        jid = _job("Fake deck")
        server.run_job(jid, "Fake deck")
        job = server.JOBS[jid]
        assert job["trace_url"].endswith("/traces/" + job["trace_id"])
        assert tracing.feedback(job["trace_id"], False, "meh") is True
        assert fake.scores == [{"trace_id": job["trace_id"], "name": "user_feedback", "comment": "meh",
                                "metadata": None, "value": 0, "data_type": "BOOLEAN"}]
    finally:
        set_langfuse_client(None); tracing._trace_url_prefix = None


def test_disabled_tracing_records_nothing(session_tracing):
    session_tracing.reset(); tracing.disable()
    jid = _job("Fake deck")
    server.run_job(jid, "Fake deck")
    assert server.JOBS[jid]["status"] == "done" and "trace_id" not in server.JOBS[jid]
    assert session_tracing.spans() == []


def test_env_file_loader(tmp_path, monkeypatch):
    for k in ("LANGFUSE_X_ONE", "LANGFUSE_X_TWO"): monkeypatch.delenv(k, raising=False)
    f = tmp_path / "langfuse.env"
    f.write_text('# c\nLANGFUSE_X_ONE="a"\nexport LANGFUSE_X_TWO=b\nOTHER=c\n')
    monkeypatch.setenv("LANGFUSE_X_TWO", "keep")
    assert tracing.load_env_file(f) == ["LANGFUSE_X_ONE"]
    import os
    assert os.environ["LANGFUSE_X_TWO"] == "keep" and "OTHER" not in os.environ
    monkeypatch.delenv("LANGFUSE_X_ONE")
