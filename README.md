# turbo-langfuse-monorepo

A **Turborepo + pnpm** starter kit of reusable packages for building LLM features that are **traced, prompt-managed, scored and evaluated in Langfuse**, on **OpenAI or Claude**.

There's no app and no sample use case: you bring the prompt, the data and the app. The packages handle the plumbing:

- **Tracing**: every call becomes a Langfuse trace with model, tokens, cost, latency, user and session.
- **Prompt management**: prompts live in Langfuse (editable without a redeploy), with an in-code fallback.
- **Scores and feedback**: automatic checks on every call, plus user thumbs-up/down.
- **Experiments and evals**: run a test set and score it, with exact-match, contains, regex and LLM-as-a-judge evaluators.
- **Any model**: OpenAI or Claude, picked from `.env`. With no keys a mock model is used, so tests and CI run for free.
- **TypeScript and Python**: the observability features exist in both languages, with the same env vars.

## What's inside

```
turbo-langfuse-monorepo/
├── packages/
│   ├── infra/
│   │   ├── .env.example      (copy to .env)              LLM + Langfuse keys, shared by both infra packages
│   │   ├── langfuse/         @repo/langfuse              Connection (TS): env files, config, Langfuse client, OTel span processor, shutdown
│   │   └── langfuse-python/  repo-langfuse (uv)          Connection (Python): the same, for Python apps
│   ├── observability/
│   │   ├── ts/               @repo/observability         Features (TS): tracing helpers, prompts, scores/feedback, experiments, test helpers
│   │   └── python/           repo-observability (uv)     Features (Python): the same, in snake_case
│   ├── llm/                  @repo/llm                   OpenAI + Claude + mock behind one ChatModel interface; traced calls
│   ├── agent/                @repo/agent                 createAgent(): your prompt + model + scorers; evaluators; experiments
│   └── tsconfig/             @repo/tsconfig              Shared TypeScript settings
├── apps/                     (empty)                     Put your own apps here; they import the packages above
└── turbo.json                                            Task pipeline + caching
```

```
TS:      tsconfig ─► infra/langfuse ─► observability/ts ─► llm ─► agent ─► (your TS apps)
Python:  infra/langfuse-python ─► observability/python ─► (your Python apps)
Both read packages/infra/.env
```

## Quick start

Requirements: **Node.js 22.12+**, **pnpm 10** (`corepack enable` gives you the pinned pnpm) and **[uv](https://docs.astral.sh/uv/)** for the Python packages.

```bash
pnpm install
pnpm check                                               # build + typecheck + test everything, TS and Python (cached by Turborepo)
cp packages/infra/.env.example packages/infra/.env       # then fill in your keys
```

No uv? Skip the Python packages with `pnpm turbo run typecheck test --filter='!@repo/*-python'`.

## Using this template in a project

This repo is a template, not a published npm package. Pick the option that fits.

**A. Start a new project from it.**

```bash
pnpm dlx create-turbo@latest --example https://github.com/sricharan-technoidentity/langfuse_turborepo
# or: GitHub "Use this template", or: git clone … && rm -rf .git && git init
```

Add your apps under `apps/` (see [Using the packages](#using-the-packages) and [Python](#python)).

**B. Add it to an existing Turborepo.** Copy `packages/tsconfig`, `packages/infra`, `packages/observability`, `packages/llm` and `packages/agent` into your repo (leave out `packages/infra/langfuse-python` and `packages/observability/python` if you don't need Python), then:

1. Make sure your workspace globs include `packages/*`, `packages/infra/*` and `packages/observability/*` (`pnpm-workspace.yaml`, or `workspaces` in `package.json`).
2. In your `turbo.json`, give `build`, `typecheck` and `test` a `"dependsOn": ["^build"]`, set `"outputs": ["dist/**"]` on `build`, and copy the `globalPassThroughEnv` list from this repo's `turbo.json`.
3. Copy `packages/infra/.env.example` to `packages/infra/.env` and fill in your keys, then run your install.
4. With npm, replace `"workspace:*"` with `"*"` in the copied `package.json` files. pnpm, Yarn and Bun understand `workspace:*`.

The packages are ESM and need Node.js 22.12+. The `@repo/*` scope is Turborepo's convention for internal packages. To rename it, find-and-replace `@repo/` across the copied folders.

**C. Your app already runs OpenTelemetry** (Next.js `instrumentation.ts`, Sentry, Datadog, `NodeSDK`…). Don't call `initTracing()`, because it registers its own global tracer provider. Add the Langfuse span processor to your existing setup instead. It only exports Langfuse and LLM spans, so your HTTP and DB spans stay out of Langfuse:

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { createLangfuseSpanProcessor } from "@repo/langfuse";

const langfuse = createLangfuseSpanProcessor({ exportMode: "batched" }); // undefined without keys
new NodeSDK({ spanProcessors: [...yourProcessors, ...(langfuse ? [langfuse] : [])] }).start();
```

Everything else (`createAgent`, prompts, scores, experiments) works the same either way.

## Configuration (`packages/infra/.env`)

Copy `packages/infra/.env.example` to `packages/infra/.env` and replace the `<...>` placeholders. Anything still in `<...>` counts as "not set". The file is git-ignored.

`loadEnv()` (TS) and `load_env()` (Python) use the same order. A variable that's already set is never overwritten:

1. Real environment variables (CI, Docker, your shell)
2. The nearest `.env` walking up from the current folder to the repo root (e.g. `apps/my-app/.env`, for per-app overrides)
3. `packages/infra/.env`, the shared default

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Use OpenAI. Default model `gpt-6-luna`; change it with `OPENAI_MODEL` |
| `ANTHROPIC_API_KEY` | Use Claude. Default model `claude-haiku-5-5`; change it with `ANTHROPIC_MODEL` |
| `LLM_PROVIDER` | `auto` (default): OpenAI if its key is set, else Claude, else mock. Or force `openai`, `anthropic` or `mock` |
| `OPENAI_BASE_URL` | Optional: any OpenAI-compatible API (Azure OpenAI, OpenRouter, Groq, Ollama…) |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | From Langfuse Cloud → project → **Settings → API Keys**. Without them, nothing is sent |
| `LANGFUSE_BASE_URL` | `https://cloud.langfuse.com` (EU, default) or `https://us.cloud.langfuse.com` (US) |
| `LANGFUSE_TRACING_ENVIRONMENT` | Environment filter in Langfuse (`development`, `production`…) |
| `LANGFUSE_RELEASE` | Optional version tag on every trace (e.g. a git SHA) |

## Using the packages

### 1. Add an app

Create e.g. `apps/my-app/package.json`:

```json
{
  "name": "@repo/my-app",
  "private": true,
  "type": "module",
  "scripts": { "build": "tsc", "start": "node dist/index.js" },
  "dependencies": {
    "@repo/agent": "workspace:*",
    "@repo/langfuse": "workspace:*",
    "@repo/llm": "workspace:*",
    "@repo/observability": "workspace:*"
  }
}
```

`@repo/langfuse` is the connection (start/stop tracing). `@repo/observability` has the features you call from your code.

Then run `pnpm install`. Turborepo now builds the packages before your app and caches everything.

### 2. Start tracing once, at startup

```ts
import { initTracing, loadEnv, shutdownLangfuse, describeLangfuseConfig } from "@repo/langfuse";

loadEnv();                                   // app/root .env, then packages/infra/.env
initTracing({ exportMode: "batched" });      // "immediate" for scripts / serverless; existing OTel setup → option C above
console.log(describeLangfuseConfig());

process.on("SIGTERM", async () => {
  await shutdownLangfuse();                  // flush traces + scores before exit
  process.exit(0);
});
```

### 3. Define a prompt and an agent

```ts
import { defineChatPrompt } from "@repo/observability";
import { createAgent } from "@repo/agent";

const summarizePrompt = defineChatPrompt({
  name: "summarizer/system",                  // name in Langfuse Prompt Management
  messages: [{ role: "system", content: "Summarize the text in {{style}} style, max {{words}} words." }],
  config: { temperature: 0.2, maxTokens: 500 }, // editable later in Langfuse
});

const summarizer = createAgent({
  name: "summarizer",                         // trace name in Langfuse
  prompt: summarizePrompt,
  // model: optional; defaults to OpenAI/Claude/mock based on .env
  // scorers: optional online checks (see step 5)
});

const result = await summarizer.run({
  variables: { style: "bullet-point", words: "50" },
  message: longText,                          // becomes the user message
  history: [],                                // optional earlier turns
  userId: "user-123",
  sessionId: "chat-456",
  tags: ["beta"],
  metadata: { feature: "inbox" },
});

result.output;         // the answer
result.traceId;        // send to the client so it can give feedback
result.model;          // e.g. "openai/gpt-6-luna-2026-09-22"
result.promptVersion;  // Langfuse prompt version (null = in-code fallback)
result.usage;          // { input, output, total } tokens
```

### 4. Manage prompts in Langfuse

```ts
import { seedChatPrompt } from "@repo/observability";

await seedChatPrompt(summarizePrompt);   // creates/updates the prompt with label "production"
```

- `seedChatPrompt` only creates a new version when the text or config changed, so it's safe to run on every deploy.
- After seeding, edit the prompt in the Langfuse UI. Agents pick up the new version within 60 seconds.
- `createAgent({ promptLabel: "staging" })` uses a different label, which lets you A/B test or stage prompts.
- If Langfuse is down or the keys are missing, the in-code definition is used and the trace shows the fallback.

### 5. Scores and user feedback

```ts
import { createAgent, llmJudgeScorer } from "@repo/agent";
import { recordUserFeedback, scoreTrace } from "@repo/observability";

const agent = createAgent({
  name: "summarizer",
  prompt: summarizePrompt,
  scorers: [
    // Cheap rule-based check on every call:
    ({ output }) => ({ name: "under_60_words", value: output.split(/\s+/).length <= 60 ? 1 : 0, dataType: "BOOLEAN" }),
    // LLM-as-a-judge on every call (adds cost + latency):
    llmJudgeScorer({ name: "faithfulness", criteria: "The summary only states facts present in the input." }),
  ],
});

// Later, when the user clicks 👍/👎:
recordUserFeedback({ traceId: result.traceId!, positive: true, comment: "Great summary" });

// Any other score, from anywhere:
scoreTrace(result.traceId!, "reviewed_by_human", "approved", { dataType: "CATEGORICAL" });
```

### 6. Experiments (offline evaluation)

```ts
import { runAgentExperiment, containsAll, matchesPatterns, exactMatch, llmJudge, passRate } from "@repo/agent";

const summary = await runAgentExperiment(
  summarizer,
  {
    name: "summarizer v2 prompt",
    data: [
      { input: { message: "…article 1…", variables: { style: "plain", words: "40" } }, expectedOutput: ["revenue", "Q3"] },
      { input: "…article 2…", expectedOutput: ["launch date"] },
    ],
    evaluators: [
      containsAll(),                                      // expected phrases present (0..1)
      llmJudge({ criteria: "Accurate, concise, no made-up facts." }),
    ],
    runEvaluators: [passRate({ threshold: 0.8 })],
  },
  { datasetName: "summarizer-golden" },                   // optional: store cases as a Langfuse dataset
);

console.log(summary.averages, summary.runEvaluations, summary.url);
```

Built-in evaluators each return a 0..1 score:

| Evaluator | `expectedOutput` | Checks |
| --- | --- | --- |
| `exactMatch({ caseSensitive? })` | `string` | Output equals expected |
| `containsAll()` | `string \| string[]` | Share of phrases present (case-insensitive) |
| `matchesPatterns()` | `string \| string[]` (regex) | Share of patterns matching. Good for flexible wording |
| `llmJudge({ criteria, model? })` | optional reference | A model grades the output against your criteria |
| `passRate({ threshold })` | (run-level) | Share of items whose scores are all ≥ threshold |

With Langfuse keys the run appears under **Experiments**; without keys it runs locally and returns the same summary.

### 7. Lower-level building blocks

```ts
import { createChatModel, OpenAIChatModel, AnthropicChatModel, tracedCompletion } from "@repo/llm";
import { startActiveObservation, propagateAttributes } from "@repo/observability";

const model = createChatModel();   // or new AnthropicChatModel({ apiKey, model: "claude-sonnet-5-5" })

// One traced LLM call without an agent:
const res = await tracedCompletion(model, { name: "classify", messages: [{ role: "user", content: "…" }] });

// Your own steps in the same trace (retrieval, parsing, …):
await startActiveObservation("search-docs", async (span) => {
  span.update({ input: { query } });
  /* … */
}, { asType: "retriever" });
```

## Python

The Python side has the same split as TypeScript. Both are [uv](https://docs.astral.sh/uv/) projects (Python 3.11+, Langfuse Python SDK v5) and read the same `packages/infra/.env`:

| Folder | Package (import) | Counterpart of |
| --- | --- | --- |
| `packages/infra/langfuse-python` | `repo-langfuse` (`repo_langfuse`): connection | `@repo/langfuse` |
| `packages/observability/python` | `repo-observability` (`repo_observability`): features | `@repo/observability` |

Add them to a Python app (e.g. `apps/my-api/`). Add both, because uv doesn't follow path dependencies of path dependencies:

```bash
cd apps/my-api
uv init --app && uv add --editable ../../packages/infra/langfuse-python ../../packages/observability/python
```

```python
from repo_langfuse import describe_langfuse_config, init_langfuse, load_env, shutdown_langfuse
from repo_observability import define_chat_prompt, get_chat_prompt, observe, propagate_attributes, record_user_feedback

load_env()                      # app/root .env, then packages/infra/.env
init_langfuse()                 # without keys: nothing is sent, features run locally
print(describe_langfuse_config())

prompt = define_chat_prompt(
    name="my-api/system",
    messages=[{"role": "system", "content": "Answer in {{language}}."}],
    config={"temperature": 0.2},
)

@observe(name="answer", as_type="agent")
def answer(question: str) -> str:
    messages = get_chat_prompt(prompt).compile({"language": "English"})  # Langfuse version, or the in-code fallback
    return call_your_llm(messages, question)

with propagate_attributes(user_id="user-123", session_id="chat-456"):
    print(answer("What is Langfuse?"))

record_user_feedback(trace_id="<trace id from your client>", positive=True)
shutdown_langfuse()             # flush before exit
```

| Module | Main exports |
| --- | --- |
| `repo_langfuse` (connection) | `load_env`, `init_langfuse`, `get_langfuse_config`, `describe_langfuse_config`, `get_langfuse_client`, `flush_langfuse`, `shutdown_langfuse` |
| tracing | `observe`, `propagate_attributes`, `start_as_current_observation`, `get_current_trace_id` |
| prompts | `define_chat_prompt`, `get_chat_prompt`, `seed_chat_prompt`, `compile_template` |
| scores | `score_current_trace`, `score_trace`, `record_user_feedback` |
| experiments | `run_experiment(name=, data=, task=, evaluators=, run_evaluators=, dataset_name=)`, `sync_dataset`, `Evaluation` |
| `repo_observability.testing` | `create_test_tracing()`: spans in memory, no network, no keys (see `tests/conftest.py`) |

Experiment evaluators use the Langfuse SDK signature `(*, input, output, expected_output, metadata, **kwargs) -> Evaluation`, so the same function works with and without keys. Turborepo runs each package's `mypy` and `pytest` through its `package.json` shim. Inside either folder, `uv run pytest` works directly.

## What you see in Langfuse

```
summarizer                  agent       user · session · tags [summarizer, openai, beta] · metadata
├── llm-call                generation  gpt-6-luna · prompt summarizer/system v3 · temperature · tokens · cost
└── scorers                 evaluator   only when scorers are configured
     └── judge: faithfulness evaluator  (LLM-as-a-judge, with its own generation)
scores: under_60_words, faithfulness, user_feedback, …
```

## Package reference

| Package | Main exports |
| --- | --- |
| `@repo/langfuse` (infra) | `loadEnv`, `initTracing`, `createLangfuseSpanProcessor`, `flushTracing`, `shutdownLangfuse`, `getLangfuseConfig`, `describeLangfuseConfig`, `getLangfuseClient`, `getTraceUrl` |
| `@repo/observability` | `defineChatPrompt`, `getChatPrompt`, `seedChatPrompt`, `scoreCurrentTrace`, `scoreTrace`, `recordUserFeedback`, `runExperiment`, `syncDataset`, plus the SDK's `startActiveObservation`, `startObservation`, `observe`, `propagateAttributes`, `getActiveTraceId` |
| `@repo/observability/testing` | `createTestTracing()`: captures spans in memory through the real Langfuse processor, for tests |
| `repo_langfuse`, `repo_observability` (Python) | See [Python](#python) |
| `@repo/llm` | `ChatModel`, `createChatModel`, `describeChatModel`, `OpenAIChatModel`, `AnthropicChatModel`, `MockChatModel`, `tracedCompletion` |
| `@repo/agent` | `createAgent`, `runAgentExperiment`, `exactMatch`, `containsAll`, `matchesPatterns`, `llmJudge`, `llmJudgeScorer`, `judgeWithLlm`, `passRate`, `textOf` |

**Provider notes:**
- OpenAI sends `temperature` and `max_completion_tokens`. If a model only allows the default temperature, it retries once without it.
- Claude's current API has no temperature setting, so none is sent. `max_tokens` defaults to 1024.
- Langfuse calculates cost from OpenAI and Claude model names. The mock model sends its own made-up price.

## Testing your code

```ts
import { createTestTracing } from "@repo/observability/testing";
import { MockChatModel } from "@repo/llm";

const tracing = createTestTracing();                       // in-memory, no network, no keys
const agent = createAgent({ name: "x", prompt, model: new MockChatModel({ respond: () => "fixed reply" }) });
await agent.run({ message: "hi" });
const spans = await tracing.spans();                       // assert names, types, attributes
await tracing.shutdown();
```

The packages' own tests (`pnpm test`: 40 TypeScript, 14 Python) follow this pattern. The provider tests run the real OpenAI and Claude SDKs against a local fake server.

## Turborepo notes

- `build` depends on `^build`, so packages always build in dependency order. Outputs (`dist/**`) are cached.
- `typecheck` and `test` run in parallel once dependencies are built.
- API keys are in `globalPassThroughEnv`: your tasks can read them, but changing a key doesn't invalidate the cache.
- Run `pnpm check` twice to see `FULL TURBO`. Edit one package and only it and its dependents re-run.
- Remote cache: `npx turbo login && npx turbo link`. CI then reuses your local results.
- The Python packages join the pipeline through a small `package.json` each (scripts call `uv run --frozen mypy` and `uv run --frozen pytest`). Their `turbo.json` adds `tests/**`, `pyproject.toml` and `uv.lock` to the cache inputs. `observability/python` also lists `infra/langfuse-python/src/**`, so changing the connection re-runs its checks. After changing Python dependencies, run `uv lock` in that folder.

## Troubleshooting

- **The mock model is still used.** Check that the key replaced the whole `<...>` placeholder and that `LLM_PROVIDER` isn't `mock`. `describeChatModel(agent.model)` prints what's active.
- **No traces in Langfuse.** `describeLangfuseConfig()` should say `enabled`. Keys are per project and per region, so make sure `LANGFUSE_BASE_URL` matches. Short scripts must `await shutdownLangfuse()` before exiting.
- **The prompt version shows null.** The in-code fallback was used. Run `seedChatPrompt()` or create the prompt with the `production` label in Langfuse.
