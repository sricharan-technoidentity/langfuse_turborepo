# Deck Forge: a Kiro Crew app (prompt -> .pptx)

Type a prompt on the **Deck Forge** dashboard page and click **Generate**. The backend runs the app's shipped
agent `deck-forge-writer` through `kiro-cli chat --no-interactive --trust-tools=` (no tools are allowed). The agent
returns only slide JSON `{title, subtitle, slides:[{title, bullets[], notes}]}`, and `backend/render.py` turns that
into a 16:9 .pptx with python-pptx. Each deck costs about 0.08 Kiro credits.

## Layout
- `app.json`: manifest (agent, skill, python backend, UI page `/apps/deck-forge`, icon Presentation)
- `agents/deck-forge-writer.json`: JSON-only writer agent. Crew registers it as `~/.kiro/agents/deck-forge--deck-forge-writer.json`.
- `skills/deck-forge-outline/SKILL.md`: the same contract as a Crew skill (triggers: deck-forge)
- `backend/server.py`: entry shim for the vendored `deck_forge_backend` package (stdlib HTTP server on 127.0.0.1:$PORT. Verifies the gateway's `X-KiroCrew-Proxy` HMAC. Routes:
  `GET /health`, `POST /api/generate`, `GET /api/jobs[/<id>]`, `GET /api/download/<id>`, `POST /api/feedback`).
  Files go to `~/.kiro/crew/apps/deck-forge/data/decks/` (`<id>.pptx`, `.json`, `.prompt.txt`, `.agent.txt`).
- `backend/repo_deck_renderer/render.py`: deterministic renderer (vendored from packages/deck-renderer)
- `requirements.txt`: python-pptx + `langfuse>=5.0.4,<5.1`. The gateway provisions them on enable (pip --target).
- Langfuse: each job is one trace (see the monorepo's docs/BUILD-REPORT.md). Keys: `~/.kiro/crew/apps/deck-forge/data/langfuse.env` (chmod 600); without it tracing is skipped.
- `ui/`: Vite + React page using `@kirocrew/app-sdk` (`useAppApi`) and `@kirocrew/app-sdk/ui` (`PageHeader`, `Card`, `Btn`, `Badge`).
  The build writes `ui/dist/index.mjs` (ESM). react, react-dom, react/jsx-runtime, lucide-react and @kirocrew/app-sdk* are externals.
- `samples/`: empty placeholder (`.gitkeep`, header-only `prompts.md`); generated decks live in the app data dir

## Build (monorepo)
    cd /workspace/deck-forge-turbo && pnpm install --frozen-lockfile && pnpm build   # -> apps/deck-forge/dist/deck-forge

## Install and enable (gateway at 127.0.0.1:5476, token auth)
    B=http://127.0.0.1:5476
    TOK=$(kirocrew token | tail -1 | sed 's/.*token=//')
    curl -s -c /tmp/cj -o /dev/null "$B/?token=$TOK"          # sets the auth cookie (Bearer is rejected)
    curl -s -b /tmp/cj -X POST $B/api/apps/install -H 'Content-Type: application/json' \
         -d '{"source":"/workspace/deck-forge-turbo/apps/deck-forge/dist/deck-forge"}'  # ABSOLUTE path (see workarounds)
    kirocrew config set agent.apps_trusted '["deck-forge"]'      # trusts only this third-party app
    curl -s -b /tmp/cj -X POST $B/api/apps/deck-forge/enable
    # after editing the source: bump "version" in app.json, then
    curl -s -b /tmp/cj -X POST $B/api/apps/deck-forge/update -H 'Content-Type: application/json' -d '{}'
No gateway restart was needed.

## Verify
    curl -s -b /tmp/cj $B/api/apps/deck-forge        # enabled:true, manifest.ui.pages[0].route=/apps/deck-forge
    curl -s -b /tmp/cj $B/apps/deck-forge/ui/dist/index.mjs -o /dev/null -w '%{http_code}\n'   # 200
    curl -s -b /tmp/cj -X POST $B/apps/deck-forge/api/generate -H 'Content-Type: application/json' \
         -d '{"prompt":"Intro to Kiro Crew for developers, 5 slides"}'
    curl -s -b /tmp/cj $B/apps/deck-forge/api/jobs  # poll until status=done
    curl -s -b /tmp/cj -OJ $B/apps/deck-forge/api/download/<id>
In the dashboard, open http://localhost:5476/?token=<token> and choose **Deck Forge** in the sidebar.

## Uninstall
    curl -s -b /tmp/cj -X POST $B/api/apps/deck-forge/disable
    curl -s -b /tmp/cj -X POST $B/api/apps/deck-forge/uninstall
    kirocrew config set agent.apps_trusted '[]'

## Workarounds / notes
1. Install with the doc's relative path `./deck-forge` fails with `source_not_directory`. The path is resolved against the
   gateway's cwd (/workspace/kiro-crew-lab), so use an absolute path.
2. The first install returned `registration blocked by execution policy: third-party app execution is disabled`.
   The fix is `agent.apps_trusted=["deck-forge"]` (per-app). The global `apps_allow_third_party` was left off.
3. The doc's unauthenticated curl gets 403. Use the dashboard cookie from `/?token=$(kirocrew token)`.
4. `kirocrew_client.verify_proxy_request` (from the docs) is not installed in the crew venv, so server.py implements
   the same HMAC check with the stdlib: `ts:METHOD:path?query:sha256(body)`, ±60 s, secret from `KIROCREW_PROXY_SECRET`.
5. The install copies the source into ~/.kiro/crew/apps/deck-forge. After an edit, bump the version and POST /update
   (or use `kirocrew app dev` / a symlink).
6. The backend cannot use the in-process spawn SDK, which is for builtin route modules. It calls kiro-cli directly with the app's
   agent JSON copied into `data/agent-ws/.kiro/agents/` as the cwd-local agent. The same agent is also registered globally by Crew.
7. Jobs are held in memory and rebuilt from the decks on disk when the backend restarts.
