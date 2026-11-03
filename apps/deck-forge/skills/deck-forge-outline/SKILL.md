---
name: deck-forge-outline
description: How Deck Forge turns a deck request into slide JSON (title/bullets/notes) that its backend renders to .pptx.
triggers: [deck-forge, deck forge]
always: false
---

# Deck Forge outline skill

When asked for a Deck Forge deck, reply with ONLY one JSON object:

{"title": "...", "subtitle": "...", "slides": [{"title": "...", "bullets": ["..."], "notes": "..."}]}

- The requested slide count includes the title slide, so `slides` has count-1 entries.
- 3-5 bullets per slide, each under 15 words. Notes: 1-3 sentences.
- No markdown, no code fences, no tool calls. The Deck Forge backend renders the JSON with python-pptx.
