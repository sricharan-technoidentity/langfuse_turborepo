# Deck Forge

Type a prompt, get a PowerPoint deck. Deck Forge is an app for Kiro Crew that uses a Kiro agent to write the slides, and every deck is traced in Langfuse. The repo is a Turborepo monorepo.

## Quick start

You need: Node 22.12 or newer, pnpm 10 (`corepack enable`), [uv](https://docs.astral.sh/uv/), Python 3, and `kiro-cli` logged in. Kiro Crew's gateway must be running (`kirocrew gateway`).

```bash
pnpm install
pnpm build            # builds the installable app into apps/deck-forge/dist/deck-forge
pnpm app:keys         # optional: saves your Langfuse keys (asks for them, hides the secret)
pnpm app:install      # installs or updates Deck Forge in Kiro Crew and prints the dashboard link
```

Open the dashboard link and click **Deck Forge** in the sidebar. Run `pnpm build` and `pnpm app:install` again after any code change, and bump `version` in `apps/deck-forge/app.json` first.

Without Langfuse keys the app works normally and tracing is skipped.

## Test it

1. Run the automated tests. They need no Kiro, no Langfuse and no network:
   ```bash
   pnpm check
   ```
2. Open Deck Forge in the dashboard, enter a prompt such as `Why observability matters, 3 slides`, and click **Generate**. This makes one real Kiro call (about 0.08 credits). When it finishes, download the `.pptx`.
3. Click **View trace** on the result, or open your Langfuse project and look under Tracing. You should see:
   - `deck-forge`, the whole request
   - `kiro-cli deck-forge-writer`, the Kiro call
   - `render-pptx`, the PowerPoint build

   The thumbs up and down buttons add a `user_feedback` score to the trace.

## Folders

```
apps/deck-forge/        The Kiro Crew app
  app.json              App manifest
  agents/  skills/      The Kiro agent and skill
  samples/              Example prompts
  backend/              Python backend and its tests
  ui/                   The dashboard page (React)
  scripts/              Build, install and key-saving scripts
packages/
  deck-renderer/        Turns slide JSON into a .pptx
  infra/                Langfuse connection (TypeScript and Python) and .env.example
  observability/        Tracing, prompts, scores, experiments (TypeScript and Python)
  tsconfig/             Shared TypeScript settings
```

## How it works

The dashboard page sends your prompt to the backend through the Kiro Crew gateway, which signs each request. The backend checks the signature and runs `kiro-cli chat --no-interactive --agent deck-forge-writer --trust-tools=`, with no tools allowed. The agent returns slide JSON and `deck-renderer` turns it into a `.pptx`. The app holds no model API keys, since Kiro uses your existing login.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Gateway not reachable` | Start it with `kirocrew gateway`. |
| `Nothing to install yet` | Run `pnpm build` first. |
| No traces in Langfuse | Run `pnpm app:keys`, then `pnpm app:install`. Check `grep Langfuse ~/.kiro/crew/apps/deck-forge/data/logs/backend.log`; it should say `enabled`. |
| Generate fails | Run `kiro-cli whoami`. The free tier has a monthly credit limit. |
| Local tests with Langfuse | Copy `packages/infra/.env.example` to `packages/infra/.env` and fill it in. |

The Kiro Crew gateway does not pass environment variables to app backends, which is why the keys live in a private file at `~/.kiro/crew/apps/deck-forge/data/langfuse.env` (created by `pnpm app:keys`). It stays outside the repo and is ignored by git.
