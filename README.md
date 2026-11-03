# Deck Forge (Turborepo + Langfuse)

Deck Forge turns a prompt into a PowerPoint deck. It runs as an app inside Kiro Crew: a page on the Kiro Crew dashboard, a small Python backend, and a Kiro agent that writes the slide content. This repository is a Turborepo monorepo, and every deck generation is traced in Langfuse.

## How it works

1. You type a prompt on the Deck Forge page of the Kiro Crew dashboard.
2. The gateway forwards `/apps/deck-forge/api/*` to the backend and signs each request (HMAC header `X-KiroCrew-Proxy`). The backend checks the signature.
3. The backend runs `kiro-cli chat --no-interactive --agent deck-forge-writer --trust-tools=` (no tools allowed). The agent returns slide JSON only.
4. `render.py` turns the JSON into a 16:9 `.pptx` with python-pptx.
5. The job is traced to Langfuse: a root `deck-forge` agent observation, a `kiro-cli deck-forge-writer` generation and a `render-pptx` span. The page shows a "View trace" link and thumbs up/down, which are stored as a `user_feedback` score.

There are no model API keys in the app. Kiro uses your existing `kiro-cli` login.

## Layout

```
apps/deck-forge/            Kiro Crew app
  app.json                  manifest: agent, skill, Python backend, UI page
  agents/                   deck-forge-writer agent (no tools)
  skills/                   deck-forge-outline skill
  samples/                  example prompts (empty by default)
  backend/                  Python backend package and tests
  ui/                       React page (built to ui/dist/index.mjs)
  scripts/                  assemble.py builds dist/deck-forge, check_bundle.py checks it
packages/
  deck-renderer/            prompt JSON to .pptx (Python)
  infra/langfuse/           Langfuse connection, TypeScript
  infra/langfuse-python/    Langfuse connection, Python
  infra/.env.example        shared environment variable template
  observability/ts/         tracing, prompts, scores, experiments (TypeScript)
  observability/python/     the same for Python
  tsconfig/                 shared TypeScript config
docs/BUILD-REPORT.md        build notes and the full end-to-end run
```

## Prerequisites

- Node 22.12 or newer (see `.nvmrc`) and pnpm 10 (`corepack enable`)
- [uv](https://docs.astral.sh/uv/) for the Python packages
- Kiro Crew with its gateway running (`kirocrew gateway`, default `127.0.0.1:5476`)
- `kiro-cli` installed and logged in (`kiro-cli whoami`)
- A Langfuse project and its API keys (optional; without them the app works and tracing is skipped)

## Setup

```bash
pnpm install --frozen-lockfile
pnpm build        # also assembles apps/deck-forge/dist/deck-forge, the installable folder
```

### Langfuse keys

The Kiro Crew gateway does not pass `LANGFUSE_*` variables to app backends, so the installed app reads them from a private file in its data folder. This file is outside the repo and is ignored by git.

```bash
D=~/.kiro/crew/apps/deck-forge/data
mkdir -p "$D" && umask 077
cat > "$D/langfuse.env" <<'KEYS'
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://us.cloud.langfuse.com
KEYS
chmod 600 "$D/langfuse.env"
```

Use `https://cloud.langfuse.com` for the EU region. For local tests outside Kiro Crew, copy `packages/infra/.env.example` to `packages/infra/.env` instead.

### Install in Kiro Crew

```bash
B=http://127.0.0.1:5476
TOK=$(kirocrew token | tail -1 | sed 's/.*token=//')
curl -s -c /tmp/cj -o /dev/null "$B/?token=$TOK"          # sets the auth cookie

# the source must be an absolute path
SRC="$(pwd)/apps/deck-forge/dist/deck-forge"
curl -s -b /tmp/cj -X POST $B/api/apps/install -H 'Content-Type: application/json' -d "{\"source\":\"$SRC\"}"

kirocrew config set agent.apps_trusted '["deck-forge"]'   # keep any entries you already have
curl -s -b /tmp/cj -X POST $B/api/apps/deck-forge/enable
```

After you change the code, bump `version` in `apps/deck-forge/app.json`, run `pnpm build`, then:

```bash
curl -s -b /tmp/cj -X POST $B/api/apps/deck-forge/update -H 'Content-Type: application/json' -d "{\"source\":\"$SRC\"}"
```

Open `http://localhost:5476/?token=$TOK` and click Deck Forge in the sidebar.

## How to test

### 1. Automated tests (no Kiro, no Langfuse, no network)

```bash
pnpm check        # build + typecheck + test across all packages (18 tasks)
pnpm test         # tests only
```

The second run is served from the Turborepo cache. The backend tests use a fake `kiro-cli` and cover the signature check (valid, wrong signature, stale timestamp, tampered body). Tests that need Langfuse use a dummy key and an unreachable URL, so nothing is sent.

To test one package: `pnpm turbo run test --filter=@repo/deck-forge-backend`.

### 2. Check the installed app

```bash
curl -s -b /tmp/cj $B/api/apps/deck-forge | python3 -m json.tool | head -20   # version, enabled
curl -s -b /tmp/cj -o /dev/null -w '%{http_code}\n' $B/apps/deck-forge/ui/dist/index.mjs   # 200
ls ~/.kiro/agents/deck-forge--deck-forge-writer.json
grep Langfuse ~/.kiro/crew/apps/deck-forge/data/logs/backend.log | tail -1   # "Langfuse: enabled"
```

`/apps/deck-forge/health` returns the dashboard page, because the gateway forwards only `/apps/deck-forge/api/*` to the backend.

### 3. Generate a deck (uses one real Kiro call, about 0.08 credits)

In the dashboard, open Deck Forge, enter a prompt such as "Why observability matters for agent apps, 3 slides" and click Generate. Or from the command line:

```bash
J=$(curl -s -b /tmp/cj -X POST $B/apps/deck-forge/api/generate -H 'Content-Type: application/json' \
  -d '{"prompt":"Why observability matters for agent apps, 3 slides","tags":["smoke-test"]}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
until curl -s -b /tmp/cj $B/apps/deck-forge/api/jobs/$J | grep -qE '"status": "(done|error)"'; do sleep 5; done
curl -s -b /tmp/cj $B/apps/deck-forge/api/jobs/$J
curl -s -b /tmp/cj -o /tmp/smoke.pptx $B/apps/deck-forge/api/download/$J
```

Open `/tmp/smoke.pptx` and check the slide count.

### 4. Check the trace in Langfuse

Use the "View trace" link on the page, or the `trace_url` in the job JSON. In Langfuse you should see:

- `deck-forge` (agent) with the prompt as input and the title and slide count as output
- `kiro-cli deck-forge-writer` (generation), model "auto"
- `render-pptx` (span) with the file size and slide count

Click thumbs up or down on the page and the trace gets a `user_feedback` score.

## Troubleshooting

- **"Langfuse: disabled" in the log:** `langfuse.env` is missing, has placeholder values, or is not in `~/.kiro/crew/apps/deck-forge/data/`.
- **Install fails:** the `source` path must be absolute, and the app must be in `agent.apps_trusted` before you enable it.
- **Connection refused on 5476:** start the gateway with `kirocrew gateway`.
- **Generation fails:** run `kiro-cli whoami`. The free tier has a monthly credit limit.

## Notes

- `docs/BUILD-REPORT.md` has the full build notes and a recorded end-to-end run. Some commands there use the author's machine paths.
- Never commit `langfuse.env`, `.env` or a generated `.pptx`; `.gitignore` excludes them.
