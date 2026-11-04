# Tests

`smoke_client.py` starts the server over stdio and checks:
1. the four tools are listed,
2. the sample deck validates and a malformed spec is rejected,
3. `render_deck` writes a readable `.pptx` (reopened with python-pptx),
4. a relative `out_path` resolves into `DECK_FORGE_OUT_DIR`,
5. with no Langfuse keys, tracing reports off and `record_feedback` fails cleanly,
6. fail-open: with fake keys and an unreachable Langfuse URL, rendering still succeeds (prints `FAIL-OPEN OK`).

Run it after `scripts/setup.sh`:
```bash
server/.venv/bin/python tests/smoke_client.py
```
It needs no real keys; the fail-open case only points at a closed local port.
