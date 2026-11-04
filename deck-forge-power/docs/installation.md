# Installation

## Prerequisites
- Kiro IDE 1.4.26 or newer, or Kiro CLI with Powers support
- Python 3.11 or newer (`uv` recommended, plain `venv` works)

## 1. Build the server
```bash
./scripts/setup.sh
```
This creates `server/.venv`, installs the server in editable mode, rewrites `mcp.json` so `command` points at this checkout's venv Python, and runs `tests/smoke_client.py`. A healthy run prints `SMOKE OK` and `FAIL-OPEN OK`.

Manual equivalent:
```bash
cd server
uv venv .venv --python 3.13            # or: python3 -m venv .venv
uv pip install --python .venv/bin/python -e .
.venv/bin/python ../tests/smoke_client.py
```
Then edit `command` in `mcp.json` to the absolute path of `server/.venv/bin/python`.

## 2. Install the Power
- **IDE:** Powers panel, Add Custom Power, Import power from a folder, select this folder. Importing from GitHub also works once the folder is in a repo.
- **CLI:** in `kiro-cli` chat, run `/powers install <path-to-this-folder>`.

Kiro prefixes the server name on install, for example `power-deck-forge-deck-forge`.

## 3. Fallback: register the server without the Powers UI
If the Powers panel is unavailable, add the server to `~/.kiro/settings/mcp.json`:
```json
{
  "mcpServers": {
    "deck-forge": {
      "command": "<absolute path>/server/.venv/bin/python",
      "args": ["-m", "deck_forge_mcp"],
      "env": { "DECK_FORGE_OUT_DIR": "<where decks should go>" }
    }
  }
}
```
and copy `skills/*` into `~/.kiro/skills/`.

## 4. Optional: Langfuse
Export the variables from [`.env.example`](../.env.example) in the environment that launches Kiro, then restart Kiro. See [langfuse.md](langfuse.md).

## Troubleshooting
| Symptom | Fix |
|---|---|
| Server does not start | Check the `command` path in `mcp.json` exists; re-run `scripts/setup.sh` |
| Deck lands in an unexpected folder | Set `DECK_FORGE_OUT_DIR`; relative `out_path` values resolve against it |
| `langfuse_status` says disabled | One or both keys are unset, or still the literal `${...}` placeholder |
| Powers panel or chat blank, "Could not register service worker" | Start Kiro with a fresh profile: `kiro --user-data-dir /tmp/kiro-fresh --extensions-dir /tmp/kiro-fresh-ext --disable-gpu <folder>` |
