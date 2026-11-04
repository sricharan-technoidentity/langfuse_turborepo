# Manual testing in Kiro IDE

1. Run `./scripts/setup.sh` and confirm `SMOKE OK`.
2. Open this folder in Kiro IDE and sign in.
3. Confirm the server is connected: in the MCP servers view, `deck-forge` should be listed with 4 tools.
4. In chat, run: *"Make a 5-slide deck on Turborepo caching."*
5. Expected agent behaviour:
   - it follows `deck-forge-outline` to write the slide JSON,
   - calls `validate_deck_spec`, fixing any problems,
   - calls `render_deck`, and reports the `.pptx` path.
6. Open the file and check: title slide, up to 8 bullets per slide, speaker notes present.
7. Negative test: ask for a deck with 12 bullets on one slide. Validation should reject it and the agent should shorten it.
8. Without Langfuse keys, `langfuse_status` returns `enabled: false` and `render_deck` still works.
9. With keys set (restart Kiro first): `render_deck` returns a `trace_id`; the trace appears in Langfuse under the name `deck-forge render_deck`. Say "thumbs up" and confirm a score is attached.
