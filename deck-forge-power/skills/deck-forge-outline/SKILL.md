---
name: deck-forge-outline
description: Write Deck Forge slide JSON (title, subtitle, slides with bullets and notes) for a presentation request. Use before calling the deck-forge render_deck tool.
---

# Deck Forge outline

Write ONE JSON object in this shape:

{"title": "...", "subtitle": "...", "slides": [{"title": "...", "bullets": ["..."], "notes": "..."}]}

- The requested slide count includes the title slide (top-level title/subtitle), so `slides` has count-1 entries. Default: 6 slides total.
- 3-5 bullets per slide, each under 15 words, concrete and specific.
- `notes`: 1-3 sentences of speaker notes. Plain text, no markdown.
