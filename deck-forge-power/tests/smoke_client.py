"""stdio smoke test: list tools, validate + render the sample deck, check Langfuse is off. No keys."""
import asyncio, json, os, sys, tempfile
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[1]

def payload(res):
    if getattr(res, "structuredContent", None): return res.structuredContent
    return json.loads(res.content[0].text)

async def main():
    out = Path(tempfile.mkdtemp()) / "sample.pptx"
    env = {k: v for k, v in os.environ.items() if not k.startswith("LANGFUSE_")}
    env["DECK_FORGE_OUT_DIR"] = tempfile.mkdtemp()
    params = StdioServerParameters(command=str(ROOT / "server/.venv/bin/python"), args=["-m", "deck_forge_mcp"], env=env)
    spec = json.loads((ROOT / "examples/sample.slides.json").read_text())
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            tools = await s.list_tools()
            print("tools:", [t.name for t in tools.tools])
            print("validate sample:", payload(await s.call_tool("validate_deck_spec", {"spec": spec})))
            print("validate bad:", payload(await s.call_tool("validate_deck_spec", {"spec": {"slides": []}})))
            res = payload(await s.call_tool("render_deck", {"spec": spec, "out_path": str(out), "prompt": "smoke"}))
            print("render:", res)
            rel = payload(await s.call_tool("render_deck", {"spec": spec, "out_path": "relative-check.pptx"}))
            assert Path(rel["path"]).parent == Path(env["DECK_FORGE_OUT_DIR"]).resolve(), rel
            print("relative out_path resolves into DECK_FORGE_OUT_DIR: OK")
            print("langfuse_status:", payload(await s.call_tool("langfuse_status", {})))
            print("feedback w/o keys:", payload(await s.call_tool("record_feedback", {"trace_id": "x", "positive": True})))
    from pptx import Presentation
    p = Presentation(str(out)); print("pptx slides on disk:", len(p.slides), "size:", out.stat().st_size)
    assert res["ok"] and res["slide_count"] == len(p.slides) == 4
    print("SMOKE OK")

asyncio.run(main())

async def fail_open():
    """Fake keys + unreachable Langfuse URL: rendering must still succeed (no network secrets involved)."""
    out = Path(tempfile.mkdtemp()) / "failopen.pptx"
    env = {k: v for k, v in os.environ.items() if not k.startswith("LANGFUSE_")}
    env.update(LANGFUSE_PUBLIC_KEY="pk-lf-fake", LANGFUSE_SECRET_KEY="sk-lf-fake", LANGFUSE_BASE_URL="http://127.0.0.1:9")
    params = StdioServerParameters(command=str(ROOT / "server/.venv/bin/python"), args=["-m", "deck_forge_mcp"], env=env)
    spec = json.loads((ROOT / "examples/sample.slides.json").read_text())
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            res = payload(await s.call_tool("render_deck", {"spec": spec, "out_path": str(out)}))
            print("render with fake keys:", {k: v for k, v in res.items() if k != "path"}, "trace_id present:", "trace_id" in res)
            assert res["ok"] and out.exists()
    print("FAIL-OPEN OK")

asyncio.run(fail_open())
