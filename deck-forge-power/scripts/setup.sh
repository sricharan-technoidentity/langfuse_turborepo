#!/usr/bin/env bash
# Create the server venv, install the MCP server, point mcp.json at this checkout, and run the smoke test.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/server"

if command -v uv >/dev/null 2>&1; then
  [ -x .venv/bin/python ] || uv venv .venv --python 3.13 2>/dev/null || uv venv .venv
  uv pip install --python .venv/bin/python -e .
else
  [ -x .venv/bin/python ] || python3 -m venv .venv
  .venv/bin/python -m pip install -e .
fi

# mcp.json needs an absolute interpreter path: rewrite it for this checkout.
python3 - "$ROOT" <<'PY'
import json, sys, pathlib
root = pathlib.Path(sys.argv[1])
p = root / "mcp.json"
d = json.loads(p.read_text())
d["mcpServers"]["deck-forge"]["command"] = str(root / "server/.venv/bin/python")
p.write_text(json.dumps(d, indent=2) + "\n")
print("mcp.json ->", d["mcpServers"]["deck-forge"]["command"])
PY

"$ROOT/server/.venv/bin/python" "$ROOT/tests/smoke_client.py"
