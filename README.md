# turbo-langfuse-monorepo

A **Turborepo** starter for LLM features that are **traced, prompt-managed, scored and evaluated in [Langfuse](https://langfuse.com)**, on **OpenAI or Claude**, in **TypeScript and Python**.

The packages provide the shared infrastructure: tracing, prompt management, scoring and evaluation. Applications live in `apps/`. When no API keys are configured, a mock model is used and no data leaves the machine, so tests and CI need no credentials.

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
├── llm/                        @repo/llm             OpenAI / Claude / mock behind one interface
├── agent/                      @repo/agent           createAgent(), evaluators, experiments
└── tsconfig/                   @repo/tsconfig        shared TS settings
apps/                           your apps go here
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
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | Picks the model provider. With neither set, the mock model is used |
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
| Call OpenAI, Claude or the mock model directly | `createChatModel()`, `tracedCompletion()` in `@repo/llm` |
| Test without network access | `createTestTracing()` in `@repo/observability/testing`, `MockChatModel` in `@repo/llm` |

If your app already sets up OpenTelemetry (for example with Next.js or Sentry), don't call `initTracing()`. Add `createLangfuseSpanProcessor()` to your existing setup instead.

### Python

Install `packages/infra/langfuse-python` and `packages/observability/python` as editable dependencies, for example with `uv add --editable`. At startup, call `load_env()` and `init_langfuse()` from `repo_langfuse`. Before the process exits, call `shutdown_langfuse()`.

`repo_observability` has the same features as the TypeScript package, with snake_case names: `observe`, `define_chat_prompt`, `get_chat_prompt`, `seed_chat_prompt`, `score_trace`, `record_user_feedback`, `run_experiment`. For tests, use `create_test_tracing` from `repo_observability.testing`.

## Start a new project from this template

```bash
pnpm dlx create-turbo@latest --example https://github.com/sricharan-technoidentity/langfuse_turborepo
```

To add it to an existing Turborepo instead, copy the `packages/` folders you need and include `packages/*`, `packages/infra/*` and `packages/observability/*` in your workspace globs.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm check` | Typecheck and test all packages, TypeScript and Python. Results are cached by Turborepo |
| `pnpm build` | Build the TS packages |
| `pnpm test` | Run tests only |
| `pnpm turbo run typecheck test --filter='!@repo/*-python'` | Typecheck and test the TypeScript packages only (no uv required) |
| `pnpm clean` | Delete build output, caches and `node_modules` |
| `uv lock` (inside a Python package) | Update the lockfile after changing Python dependencies |

## Troubleshooting

- **The mock model is used even though a key is set.** Values left as `<...>` are treated as unset. Replace the whole placeholder with your key.
- **No traces appear in Langfuse.** Check the keys and the `LANGFUSE_BASE_URL` region, and make sure `shutdownLangfuse()` is called before the process exits.
- **The prompt version is `null`.** The in-code fallback was used. Run `seedChatPrompt()`, or create the prompt in Langfuse with the `production` label.
