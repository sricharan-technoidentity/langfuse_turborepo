# turbo-langfuse-monorepo

A **Turborepo** starter for LLM features that are **traced, prompt-managed, scored and evaluated in [Langfuse](https://langfuse.com)**, on **OpenAI or Claude**, in **TypeScript and Python**.

The packages provide the shared infrastructure: tracing, prompt management, scoring and evaluation. Applications live in `apps/`; `apps/chat` is a ready-to-run example chatbot built on them. Calling a model needs an OpenAI or Anthropic key. Tests use an in-test fake model and an in-memory exporter, so tests and CI need no credentials and no data leaves the machine.

## Packages

```
packages/
├── infra/                      connection to Langfuse
│   ├── .env.example            your keys (copy to .env)
│   ├── langfuse/               @repo/langfuse        TS
│   └── langfuse-python/        repo_langfuse         Python
├── observability/              features: tracing, prompts, scores, experiments
│   ├── ts/                     @repo/observability   TS
│   └── python/                 repo_observability    Python
├── llm/                        @repo/llm             OpenAI / Claude behind one interface
├── agent/                      @repo/agent           createAgent(), evaluators, experiments
└── tsconfig/                   @repo/tsconfig        shared TS settings
apps/                           your apps go here
└── chat/                       chat                  example chatbot: React (Vite) page + node:http API on @repo/agent
```

## Setup

Needs **Node.js 22.12+**, **pnpm 10** and **[uv](https://docs.astral.sh/uv/)** (uv is only needed for Python).

```bash
pnpm install
cp packages/infra/.env.example packages/infra/.env   # add your keys
pnpm check                                           # build, typecheck and test everything
```

Keys in `packages/infra/.env`:

| Variable | What it does |
| --- | --- |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | Picks the model provider. One of them is required to call a model |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | From Langfuse → Settings → API Keys. Without them, nothing is sent |
| `LANGFUSE_BASE_URL` | `https://cloud.langfuse.com` (EU, default), `https://us.cloud.langfuse.com` (US) or `https://jp.cloud.langfuse.com` (Japan) |

Other options (model names, `LLM_PROVIDER`, environment, release) are described in `.env.example`. Real environment variables, or a `.env` in your app folder or the repo root, override this file.

## Usage

### TypeScript

Add the packages your app needs to its `package.json` as `"workspace:*"` dependencies, then run `pnpm install`. At startup, call `loadEnv()` and `initTracing()` from `@repo/langfuse`. Before the process exits, call `shutdownLangfuse()`.

| Capability | API |
| --- | --- |
| Run a traced LLM call with a managed prompt | `createAgent()` in `@repo/agent` |
| Define a prompt, with an in-code fallback | `defineChatPrompt()`, `getChatPrompt()` in `@repo/observability` |
| Publish a prompt to Langfuse | `seedChatPrompt()`. Changes made in Langfuse reach the app within 60 seconds |
| Score traces and record user feedback | `scoreTrace()`, `scoreCurrentTrace()`, `recordUserFeedback()` |
| Score every call automatically | `scorers` option of `createAgent()`, e.g. `llmJudgeScorer()` |
| Run an experiment on a dataset | `runAgentExperiment()` with `exactMatch()`, `containsAll()`, `matchesPatterns()` or `llmJudge()` |
| Call OpenAI or Claude directly | `createChatModel()`, `tracedCompletion()` in `@repo/llm` |
| Test without network access | `createTestTracing()` in `@repo/observability/testing`, plus your own `ChatModel` stub passed as `model` |

If your app already sets up OpenTelemetry (for example with Next.js or Sentry), don't call `initTracing()`. Add `createLangfuseSpanProcessor()` to your existing setup instead.

### Python

Install `packages/infra/langfuse-python` and `packages/observability/python` as editable dependencies, for example with `uv add --editable`. At startup, call `load_env()` and `init_langfuse()` from `repo_langfuse`. Before the process exits, call `shutdown_langfuse()`.

`repo_observability` has the same features as the TypeScript package, with snake_case names: `observe`, `define_chat_prompt`, `get_chat_prompt`, `seed_chat_prompt`, `score_trace`, `record_user_feedback`, `run_experiment`. For tests, use `create_test_tracing` from `repo_observability.testing`.

## Chat app

`apps/chat` is a single-page chatbot built on the packages: a React (Vite) client and a small `node:http` API server running one `createAgent()` with the `chat-assistant` prompt. Each reply is a Langfuse trace (one session per page load), with thumbs up/down sent as `user_feedback` scores and a "View trace" link.

### Run it

1. Install dependencies from the repo root: `pnpm install`
2. Create your env file: `cp packages/infra/.env.example packages/infra/.env`
3. In `packages/infra/.env`, set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (required). For traces, feedback and trace links, also set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and your `LANGFUSE_BASE_URL` region.
4. Start it in dev mode: `pnpm dev`, then open <http://localhost:5173>. This builds the packages, starts Vite and the API server (port `PORT`, default 3000), and proxies `/api` to it. Server code restarts on change.
5. Production build: `pnpm --filter chat build`, then `pnpm --filter chat start` and open <http://localhost:3000>.

Startup logs show which model and Langfuse project are in use (no secrets). The default models are `gpt-6-luna` (OpenAI) and `claude-haiku-5-5` (Anthropic); OpenAI wins when both keys are set. Change them with `OPENAI_MODEL`, `ANTHROPIC_MODEL` or `LLM_PROVIDER`. Without an LLM key the server stops with "No LLM API key set". Without Langfuse keys chat still works, but nothing is traced, feedback is dropped and no trace links are shown.

### How a message flows

1. The page sends `POST /api/chat` with the new message, the earlier turns and a session ID (one per page load).
2. The server validates the request, then runs the `chat` agent. It fetches the `chat-assistant` prompt from Langfuse, or uses the in-code version in `src/server/agent.ts` when it isn't in Langfuse yet. It then calls the model (temperature 0.7, max 1024 tokens; Claude ignores temperature).
3. The reply is shown with 👍/👎 buttons and, with Langfuse keys, a "View trace" link.

Each message becomes one Langfuse trace, and all turns of a page load are grouped as one session:

```
chat (agent)                input: message · output: reply · tags: chat, openai|anthropic
└── llm-call (generation)   model, settings, messages, token usage, cost, latency
```

A 👍/👎 click adds a `user_feedback` score (1 or 0) to that trace, one vote per reply. Nothing is stored in the app: reloading the page starts a new chat.

| Route | What it does |
| --- | --- |
| `POST /api/chat` | `{ message, history, sessionId }` → `{ output, traceId, traceUrl, model }` |
| `POST /api/feedback` | `{ traceId, positive }` → records a `user_feedback` score |

Both require `Content-Type: application/json`. Invalid input gets a 400 (for example an empty message, over 8,000 characters, over 100 history turns, a body over 256 KB, or a `system` turn sent by the client). Model failures get a generic 502; details go only to the server log. The app has no authentication: don't expose it publicly as-is, since anyone who can reach it can spend your LLM credits.

### Files

```
apps/chat/
├── index.html, vite.config.ts      Vite entry; in dev also starts the API server and proxies /api
├── src/client/                     React page: App.tsx, main.tsx, styles.css
└── src/server/
    ├── main.ts                     startup: loadEnv, initTracing, listen on PORT, graceful shutdown
    ├── agent.ts                    the chat-assistant prompt and createChatAgent()
    ├── handler.ts                  routes, request validation, static files
    └── __tests__/                  handler tests with a fake model (no keys, no network)
```

### Customize

- **Change the system prompt without a deploy:** in Langfuse, create a chat prompt named `chat-assistant` with the `production` label. The app picks it up within 60 seconds, and the trace shows its version. Its `config` can override `temperature` and `maxTokens`.
- **Change the default prompt in code:** edit `chatPrompt` in `src/server/agent.ts`.
- **Score every reply automatically:** pass `scorers` (for example `llmJudgeScorer()` from `@repo/agent`) in `createChatAgent()`.

## Start a new project from this template

```bash
pnpm dlx create-turbo@latest --example https://github.com/sricharan-technoidentity/langfuse_turborepo
```

To add it to an existing Turborepo instead, copy the `packages/` folders you need and include `packages/*`, `packages/infra/*` and `packages/observability/*` in your workspace globs.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the apps in dev mode (currently `apps/chat`) |
| `pnpm check` | Typecheck and test all packages and apps, TypeScript and Python. Results are cached by Turborepo |
| `pnpm build` | Build the TS packages and apps |
| `pnpm test` | Run tests only |
| `pnpm turbo run typecheck test --filter='!@repo/*-python'` | Typecheck and test the TypeScript packages only (no uv required) |
| `pnpm clean` | Delete build output, caches and `node_modules` |
| `uv lock` (inside a Python package) | Update the lockfile after changing Python dependencies |

## Troubleshooting

- **`createChatModel()` throws "No LLM API key" even though a key is set.** Values left as `<...>` are treated as unset. Replace the whole placeholder with your key.
- **`pnpm dev` fails with `EADDRINUSE`.** Another process is using the API port. Set `PORT` to a free port in `packages/infra/.env` or the shell.
- **No traces appear in Langfuse.** Check the keys and the `LANGFUSE_BASE_URL` region, and make sure `shutdownLangfuse()` is called before the process exits.
- **The prompt version is `null`.** The in-code fallback was used. Run `seedChatPrompt()`, or create the prompt in Langfuse with the `production` label.
