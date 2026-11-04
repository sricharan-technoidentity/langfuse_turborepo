# Deck Forge — Kiro IDE Power

Deck Forge is a Kiro Crew app that turns a prompt into a `.pptx` and traces it in Langfuse. This folder repackages it as a **Kiro IDE Power**: the IDE agent writes the slide JSON, and a local MCP server renders the deck and, optionally, traces and scores it in Langfuse.

Status: working prototype. The server and smoke test pass, and one deck was generated end to end from the Kiro IDE. Langfuse export has only been tested against a fake server, not a real Langfuse project.

## What you get

| Piece | What it does |
|---|---|
| Skill `deck-forge-outline` | Rules for writing valid slide JSON (ported from the Crew app) |
| Skill `deck-forge-generate` | Workflow: write JSON, validate, render, ask for feedback |
| MCP tool `validate_deck_spec` | Checks the slide JSON and returns the problems |
| MCP tool `render_deck` | Renders a `.pptx` with python-pptx and opens a Langfuse trace when enabled |
| MCP tool `record_feedback` | Stores thumbs up or down as a Langfuse score on a trace |
| MCP tool `langfuse_status` | Reports whether tracing is on (never returns keys) |
| `hooks/` (optional) | Per-turn Langfuse tracing of the whole Kiro IDE session |

## Repository layout

```
deck-forge-power/
├── plugin.json              Power manifest
├── mcp.json                 Registers the stdio MCP server (absolute venv path, rewritten by setup.sh)
├── skills/                  Power skills the IDE agent loads
│   ├── deck-forge-outline/SKILL.md
│   └── deck-forge-generate/SKILL.md
├── server/                  Python MCP server (see server/README.md)
│   ├── deck_forge_mcp/      Tool definitions
│   ├── repo_deck_renderer/  Vendored from langfuse_turborepo/packages/deck-renderer
│   ├── repo_langfuse/       Vendored Langfuse client wrapper
│   └── repo_observability/  Vendored tracing, scores and prompt helpers
├── hooks/                   Optional Kiro hooks for per-turn Langfuse tracing (see hooks/README.md)
├── examples/                Sample slide JSON
├── tests/                   Stdio smoke test
├── scripts/setup.sh         Creates the venv, fixes mcp.json, runs the smoke test
├── docs/                    Installation, manual testing, Langfuse, Crew-to-Power mapping
├── .env.example             Optional environment variables
└── .gitignore
```

## Quick start

```bash
./scripts/setup.sh          # venv + install + rewrite mcp.json + smoke test (expect "SMOKE OK" and "FAIL-OPEN OK")
```

Then in Kiro IDE: Powers panel, Add Custom Power, import from a folder, and pick this folder. Ask: *"Make a 5-slide deck on Turborepo caching."* The deck is written to `$DECK_FORGE_OUT_DIR`, or `./decks/` when that is unset.

More detail: [docs/installation.md](docs/installation.md), [docs/manual-testing.md](docs/manual-testing.md), [docs/langfuse.md](docs/langfuse.md), [docs/crew-to-power.md](docs/crew-to-power.md).

## Environment variables (all optional)

See [.env.example](.env.example). Tracing turns on only when both `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set. Langfuse failures never block rendering. Never commit keys.

## Known limitations

- Powers have no UI, job queue, scheduler or backend, so the Crew app's web page, status view and download button do not carry over. The file is written to disk.
- `mcp.json` needs an absolute interpreter path, so re-run `scripts/setup.sh` after moving the folder.
- The server needs Python 3.11 or newer.
- Per-turn tracing via hooks records prompts and tool calls only. Kiro hooks do not expose model replies, token counts or cost.
