# Crew app to Power mapping

| Crew piece | In the IDE Power |
|---|---|
| `app.json` manifest | `plugin.json` |
| `deck-forge-outline` skill | `skills/deck-forge-outline` (ported) |
| `deck-forge-writer` agent plus backend calling `kiro-cli` | The IDE agent writes the JSON itself, guided by the skills |
| `deck-renderer` package | MCP tool `render_deck` (vendored in `server/repo_deck_renderer`) |
| Langfuse trace per job | `render_deck` span, plus optional hook tracing per turn |
| Thumbs up or down in the UI | MCP tool `record_feedback` |
| Web page, job queue, download button | Not available: Powers have no UI. The file is written to disk |
| Cron, gateway proxy, backend service | Not available: Powers have no scheduler or backend |
| Hooks and agents bundled with the app | Not part of a Power; set up separately (see `hooks/`) |
