# Optional: per-turn Langfuse tracing for the whole Kiro IDE

These hooks trace everything the Kiro agent does, not only deck rendering. One Langfuse trace is created per user turn, with tool calls as child observations.

## Files
- `langfuse_kiro_hook.py`: stdlib-only script. Sends OTLP/HTTP JSON to `/api/public/otel/v1/traces` with `x-langfuse-ingestion-version: 4`. Always exits 0 (fail-open).
- `langfuse-tracing.json`: hook definitions for `UserPromptSubmit`, `PreToolUse`, `PostToolUse` and `Stop`.

## Install
```bash
mkdir -p ~/.kiro/hooks
cp langfuse_kiro_hook.py ~/.kiro/hooks/
cp langfuse-tracing.json <your-workspace>/.kiro/hooks/     # or the user-level hooks folder
export TRACE_TO_LANGFUSE=true LANGFUSE_PUBLIC_KEY=... LANGFUSE_SECRET_KEY=... LANGFUSE_BASE_URL=...
```
Restart Kiro after setting the variables.

## Limits
Hooks do not expose the model's replies, token counts or cost, so traces show prompts and tool calls only. Kiro has no base-URL setting, so a proxy gateway such as LiteLLM cannot be used to capture model calls.

## Debugging
Set `KIRO_LF_DEBUG=1` to print hook errors to stderr. Per-session state lives in `~/.kiro/langfuse-state/`.

Tested only against a fake Langfuse server.
