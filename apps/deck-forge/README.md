# Deck Forge

Kiro Crew app that turns a prompt into a .pptx. Setup and testing steps are in the repository's root README.

- `app.json` declares the Python backend, the dashboard page `/apps/deck-forge` and the agent and skill.
- `agents/deck-forge-writer.json` is the writer agent. It has no tools and returns slide JSON only.
- `backend/` runs the agent with `kiro-cli chat --no-interactive --agent deck-forge-writer --trust-tools=` and builds the deck.
- Routes: `POST /api/generate`, `GET /api/jobs`, `GET /api/download/<id>`, `POST /api/feedback` (forwarded from `/apps/deck-forge/api/`).
- Decks are saved in `~/.kiro/crew/apps/deck-forge/data/decks/`.
