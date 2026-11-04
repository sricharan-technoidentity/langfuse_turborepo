# Examples

`sample.slides.json` is a small valid deck. Shape:
```json
{ "title": "...", "subtitle": "...", "slides": [ { "title": "...", "bullets": ["..."], "notes": "..." } ] }
```
Rules: `title` is required, `slides` is a non-empty list, and each slide has at most 8 bullets (3 to 5 reads best).
Render it through the server with `tests/smoke_client.py`, or paste it into chat and ask the agent to render it.
