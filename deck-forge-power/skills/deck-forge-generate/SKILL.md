---
name: deck-forge-generate
description: Generate a .pptx deck from a prompt with the deck-forge MCP tools (validate_deck_spec, render_deck, record_feedback). Use when the user asks for slides, a deck, or a PowerPoint.
---

# Generate a deck with Deck Forge

1. Write the slide JSON following the `deck-forge-outline` skill.
2. Call `validate_deck_spec` with `spec`. Fix every problem it reports and validate again.
3. Call `render_deck` with `spec`, the original `prompt`, and an `out_path` inside the workspace
   (for example `decks/<short-name>.pptx`). Omit `out_path` to use DECK_FORGE_OUT_DIR.
4. Tell the user the file path and slide count. If the result has `trace_url`, share it.
5. If the user says the deck was good or bad and a `trace_id` exists, call `record_feedback`.

Langfuse is optional. With no keys set, tracing is off and rendering still works.
