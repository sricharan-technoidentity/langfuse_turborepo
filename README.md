# turbo-langfuse-monorepo

A **Turborepo + pnpm** starter kit of reusable packages for building LLM features that are **traced, prompt-managed, scored and evaluated in Langfuse**, on **OpenAI or Claude**.

There's no app and no sample use case: you bring the prompt, the data and the app. The packages handle the plumbing:

- **Tracing**: every call becomes a Langfuse trace with model, tokens, cost, latency, user and session.
- **Prompt management**: prompts live in Langfuse (editable without a redeploy), with an in-code fallback.
- **Scores and feedback**: automatic checks on every call, plus user thumbs-up/down.
- **Experiments and evals**: run a test set and score it, with exact-match, contains, regex and LLM-as-a-judge evaluators.
- **Any model**: OpenAI or Claude, picked from `.env`. With no keys a mock model is used, so tests and CI run for free.

## What's inside

```
turbo-langfuse-monorepo/
├── packages/
│   ├── langfuse/   @repo/langfuse  Tracing setup, prompts, scores, experiments, test helpers
│   ├── llm/        @repo/llm       OpenAI + Claude + mock behind one ChatModel interface; traced calls
│   ├── agent/      @repo/agent     createAgent(): your prompt + model + scorers; evaluators; experiments
│   └── tsconfig/   @repo/tsconfig  Shared TypeScript settings
├── apps/           (empty)         Put your own apps here; they import the packages above
├── turbo.json                      Task pipeline + caching
└── .env.example                    LLM + Langfuse key placeholders
```

```
tsconfig ─► langfuse ─► llm ─► agent ─► (your apps)
```

## Quick start

Requirements: **Node.js 22.12+** and **pnpm 10** (`corepack enable` gives you the pinned pnpm).

```bash
pnpm install
pnpm check            # build + typecheck + test all packages (cached by Turborepo)
cp .env.example .env  # then fill in your keys
```

## Using this template in a project

This repo is a template, not a published npm package. Pick the option that fits.

**A. Start a new project from it.** Push this repo to GitHub, then:

```bash
pnpm dlx create-turbo@latest --example https://github.com/<you>/turbo-langfuse-monorepo
# or: GitHub "Use this template", or: git clone … && rm -rf .git && git init
```

Add your apps under `apps/` (see [Using the packages](#using-the-packages)).

**B. Add it to an existing Turborepo.** Copy `packages/tsconfig`, `packages/langfuse`, `packages/llm` and `packages/agent` into your repo, then:

1. Make sure your workspace globs include `packages/*` (`pnpm-workspace.yaml`, or `workspaces` in `package.json`).
2. In your `turbo.json`, give `build`, `typecheck` and `test` a `"dependsOn": ["^build"]`, set `"outputs": ["dist/**"]` on `build`, and copy the `globalPassThroughEnv` list from this repo's `turbo.json`.
3. Copy `.env.example` to your repo root as `.env`, then run your install.
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

## Configuration (`.env` in the repo root)

Replace the `<...>` placeholders. Anything still in `<...>` counts as "not set".

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
    "@repo/llm": "workspace:*"
  }
}
```

Then run `pnpm install`. Turborepo now builds the packages before your app and caches everything.

### 2. Start tracing once, at startup

```ts
import { initTracing, loadEnv, shutdownLangfuse, describeLangfuseConfig } from "@repo/langfuse";

loadEnv();                                   // reads the root .env
initTracing({ exportMode: "batched" });      // "immediate" for scripts / serverless; existing OTel setup → option C above
console.log(describeLangfuseConfig());

process.on("SIGTERM", async () => {
  await shutdownLangfuse();                  // flush traces + scores before exit
  process.exit(0);
});
```

### 3. Define a prompt and an agent

```ts
import { defineChatPrompt } from "@repo/langfuse";
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
import { seedChatPrompt } from "@repo/langfuse";

await seedChatPrompt(summarizePrompt);   // creates/updates the prompt with label "production"
```

- `seedChatPrompt` only creates a new version when the text or config changed, so it's safe to run on every deploy.
- After seeding, edit the prompt in the Langfuse UI. Agents pick up the new version within 60 seconds.
- `createAgent({ promptLabel: "staging" })` uses a different label, which lets you A/B test or stage prompts.
- If Langfuse is down or the keys are missing, the in-code definition is used and the trace shows the fallback.

### 5. Scores and user feedback

```ts
import { createAgent, llmJudgeScorer } from "@repo/agent";
import { recordUserFeedback, scoreTrace } from "@repo/langfuse";

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
import { startActiveObservation, propagateAttributes } from "@repo/langfuse";

const model = createChatModel();   // or new AnthropicChatModel({ apiKey, model: "claude-sonnet-5-5" })

// One traced LLM call without an agent:
const res = await tracedCompletion(model, { name: "classify", messages: [{ role: "user", content: "…" }] });

// Your own steps in the same trace (retrieval, parsing, …):
await startActiveObservation("search-docs", async (span) => {
  span.update({ input: { query } });
  /* … */
}, { asType: "retriever" });
```

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
| `@repo/langfuse` | `loadEnv`, `initTracing`, `createLangfuseSpanProcessor`, `shutdownLangfuse`, `getLangfuseConfig`, `describeLangfuseConfig`, `defineChatPrompt`, `getChatPrompt`, `seedChatPrompt`, `scoreCurrentTrace`, `scoreTrace`, `recordUserFeedback`, `runExperiment`, `syncDataset`, `getTraceUrl`, `getLangfuseClient`, plus the SDK's `startActiveObservation`, `startObservation`, `observe`, `propagateAttributes`, `getActiveTraceId` |
| `@repo/langfuse/testing` | `createTestTracing()`: captures spans in memory through the real Langfuse processor, for tests |
| `@repo/llm` | `ChatModel`, `createChatModel`, `describeChatModel`, `OpenAIChatModel`, `AnthropicChatModel`, `MockChatModel`, `tracedCompletion` |
| `@repo/agent` | `createAgent`, `runAgentExperiment`, `exactMatch`, `containsAll`, `matchesPatterns`, `llmJudge`, `llmJudgeScorer`, `judgeWithLlm`, `passRate`, `textOf` |

**Provider notes:**
- OpenAI sends `temperature` and `max_completion_tokens`. If a model only allows the default temperature, it retries once without it.
- Claude's current API has no temperature setting, so none is sent. `max_tokens` defaults to 1024.
- Langfuse calculates cost from OpenAI and Claude model names. The mock model sends its own made-up price.

## Testing your code

```ts
import { createTestTracing } from "@repo/langfuse/testing";
import { MockChatModel } from "@repo/llm";

const tracing = createTestTracing();                       // in-memory, no network, no keys
const agent = createAgent({ name: "x", prompt, model: new MockChatModel({ respond: () => "fixed reply" }) });
await agent.run({ message: "hi" });
const spans = await tracing.spans();                       // assert names, types, attributes
await tracing.shutdown();
```

The packages' own 37 tests (`pnpm test`) follow this pattern. The provider tests run the real OpenAI and Claude SDKs against a local fake server.

## Turborepo notes

- `build` depends on `^build`, so packages always build in dependency order. Outputs (`dist/**`) are cached.
- `typecheck` and `test` run in parallel once dependencies are built.
- API keys are in `globalPassThroughEnv`: your tasks can read them, but changing a key doesn't invalidate the cache.
- Run `pnpm check` twice to see `FULL TURBO`. Edit one package and only it and its dependents re-run.
- Remote cache: `npx turbo login && npx turbo link`. CI then reuses your local results.

## Troubleshooting

- **The mock model is still used.** Check that the key replaced the whole `<...>` placeholder and that `LLM_PROVIDER` isn't `mock`. `describeChatModel(agent.model)` prints what's active.
- **No traces in Langfuse.** `describeLangfuseConfig()` should say `enabled`. Keys are per project and per region, so make sure `LANGFUSE_BASE_URL` matches. Short scripts must `await shutdownLangfuse()` before exiting.
- **The prompt version shows null.** The in-code fallback was used. Run `seedChatPrompt()` or create the prompt with the `production` label in Langfuse.
