# deck-forge-mcp

stdio MCP server behind the Power. Python 3.11+.

## Layout
| Package | Role |
|---|---|
| `deck_forge_mcp` | MCP tools: `validate_deck_spec`, `render_deck`, `record_feedback`, `langfuse_status` |
| `repo_deck_renderer` | Slide JSON to `.pptx` (python-pptx). Vendored from `langfuse_turborepo/packages/deck-renderer` |
| `repo_langfuse` | Langfuse client config and init. Vendored from `packages/infra` |
| `repo_observability` | Tracing, scores, prompts, experiments helpers. Vendored from `packages/observability` |

The `repo_*` packages are copies. Re-sync them from the monorepo when those packages change.

## Run
```bash
uv venv .venv && uv pip install --python .venv/bin/python -e .
.venv/bin/python -m deck_forge_mcp     # speaks MCP on stdio
```

## Tools
- `validate_deck_spec(spec)` returns `{ok, problems, slide_count}`.
- `render_deck(spec, out_path="", prompt="")` returns `{ok, path, slide_count, trace_id?}`. A relative `out_path` resolves against `DECK_FORGE_OUT_DIR`, which defaults to `./decks`.
- `record_feedback(trace_id, positive, comment="")` needs Langfuse keys.
- `langfuse_status()` returns `{enabled, base_url}`.

## Dependencies
`mcp>=2.3,<3`, `python-pptx==1.0.2`, `langfuse>=5.0.4,<5.1`.
