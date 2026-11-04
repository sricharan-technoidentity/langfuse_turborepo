# Deck Forge — Kiro Power (prototype)

Deck Forge (Kiro Crew app) repackaged as a Kiro IDE **Power**: the IDE agent writes the slide JSON,
and a local stdio MCP server (`deck-forge`) validates it, renders a `.pptx` with python-pptx,
and optionally traces and scores it in Langfuse.

## Contents
| Path | Purpose |
|---|---|
| `plugin.json` | Power manifest (Agent Plugins 1.0.0 schema) |
| `mcp.json` | Registers the `deck-forge` stdio MCP server |
| `skills/deck-forge-outline/SKILL.md` | Slide-JSON rules (ported from the Crew `deck-forge-outline` skill) |
| `skills/deck-forge-generate/SKILL.md` | Workflow: write JSON → `validate_deck_spec` → `render_deck` → `record_feedback` |
| `server/` | Python MCP server (`deck_forge_mcp`) + vendored `repo_deck_renderer`, `repo_langfuse`, `repo_observability` |
| `examples/sample.slides.json` | Sample deck (from the deck-renderer fixture) |
| `tests/smoke_client.py` | stdio client smoke test |

MCP tools: `validate_deck_spec(spec)`, `render_deck(spec, out_path?, prompt?)`,
`record_feedback(trace_id, positive, comment?)`, `langfuse_status()`.

## Setup (once)
```bash
cd /workspace/deck-forge-power/server
uv venv .venv --python 3.13          # or: python3 -m venv .venv
uv pip install --python .venv/bin/python -e .
../server/.venv/bin/python ../tests/smoke_client.py   # expect "SMOKE OK" and "FAIL-OPEN OK"
```
If you move the folder, update `command` in `mcp.json` (it's an absolute path to the venv's python).

## Install in Kiro
- **IDE:** Powers panel → **Add Custom Power** → *Import power from a folder* → pick this folder.
  Or *Import power from GitHub* after you push it to a repo (not done here).
- **CLI:** `kiro-cli` chat → `/powers install /workspace/deck-forge-power` (IDE 1.4.26+ also shows CLI-installed powers).
- Activates on keywords such as "deck", "slides", "pptx", "presentation". Try: *"Make a 5-slide deck on our Q3 roadmap"*.
- Kiro prefixes the server name on install (for example `power-deck-forge-deck-forge`).

## Environment variables (all optional)
| Var | Effect |
|---|---|
| `DECK_FORGE_OUT_DIR` | Where decks go (default `./decks/` in the workspace) |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | Tracing and feedback turn on **only if both are set** |
| `LANGFUSE_BASE_URL` | e.g. `https://cloud.langfuse.com` (EU) or `https://us.cloud.langfuse.com` |
| `LANGFUSE_TRACING_ENVIRONMENT` | Langfuse environment tag |

Set these in the shell or OS environment that launches Kiro. Unset or `${...}` placeholders count as "off".
Langfuse is fail-open, so an unreachable host or bad key never blocks rendering. Never commit keys.

## Sharing without an absolute path
Push the folder to a git repo and point `mcp.json` at:
`"command": "uvx", "args": ["--from", "git+https://github.com/<you>/deck-forge-power#subdirectory=server", "deck-forge-mcp"]`
(inferred, not tested here).

## Crew app → Power mapping and limitations
| Crew piece | In the IDE |
|---|---|
| `deck-forge-outline` skill | Power skill (ported) |
| `deck-forge-writer` agent + backend calling `kiro-cli` | IDE agent writes JSON itself, guided by the skills; optional IDE custom agent / steering file for persona |
| deck-renderer package | MCP tool `render_deck` |
| Langfuse trace per job | `render_deck` span (server); per-turn tracing via the Kiro hook at `/workspace/kiro-langfuse/langfuse_kiro_hook.py` (`TRACE_TO_LANGFUSE=true`) |
| Thumbs-up/down feedback | MCP tool `record_feedback` (agent asks you) |
| UI page, job queue/status, download button | **Not available**: Powers have no UI. The file is written to disk; open it from the explorer |
| Cron / gateway / proxy backend | **Not available**: Powers have no scheduler or server-side backend |
| Hooks / agents bundled in the app | Not in Powers; set them up separately as IDE hooks / custom agents |
