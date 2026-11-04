# Langfuse integration

## Two layers
1. **MCP server tracing (this Power).** `render_deck` opens a `deck-forge render_deck` span with the prompt and spec as input and the output path as output. It returns a `trace_id`. `record_feedback` attaches a score to that trace.
2. **Per-turn tracing via hooks (optional).** See [`../hooks/README.md`](../hooks/README.md).

## Configuration
| Variable | Notes |
|---|---|
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | Both required to enable |
| `LANGFUSE_BASE_URL` | EU `https://cloud.langfuse.com`, US `https://us.cloud.langfuse.com`, or self-hosted |
| `LANGFUSE_TRACING_ENVIRONMENT` | Environment tag on traces |

The vendored `repo_langfuse` package defaults to the EU region when `LANGFUSE_BASE_URL` is unset. Set it explicitly if your project is in the US.

## Behaviour
- Fail-open: initialisation or export errors are logged to stderr and rendering continues.
- Logs go to stderr only, because stdout carries the MCP protocol.
- Langfuse Cloud moves to v4-only ingestion on 2026-11-16; the hook already sends `x-langfuse-ingestion-version: 4`.

## Verification status
Tested against a local fake OTLP server only. A real Langfuse project has not been exercised yet.
