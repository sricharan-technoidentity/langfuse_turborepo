/**
 * @repo/langfuse — one import for everything Langfuse in this monorepo.
 *
 * Apps call `loadEnv()` + `initTracing()` once at startup, then use the tracing
 * primitives (re-exported from @langfuse/tracing) and the helpers below.
 */

export { loadEnv } from "./env.js";
export {
  DEFAULT_LANGFUSE_BASE_URL,
  describeLangfuseConfig,
  getLangfuseConfig,
  isLangfuseEnabled,
  type LangfuseConfig,
} from "./config.js";
export {
  createLangfuseSpanProcessor,
  flushTracing,
  initTracing,
  LangfuseSpanProcessor,
  shutdownTracing,
  type InitTracingOptions,
  type LangfuseProcessorOptions,
  type MaskFunction,
  type TracingHandle,
} from "./tracing.js";
export {
  flushLangfuseClient,
  getLangfuseClient,
  getTraceUrl,
  setLangfuseClient,
  shutdownLangfuseClient,
} from "./client.js";
export {
  compileTemplate,
  defineChatPrompt,
  getChatPrompt,
  seedChatPrompt,
  type ChatMessage,
  type ChatPromptDefinition,
  type GetPromptOptions,
  type PromptLink,
  type ResolvedChatPrompt,
  type SeedResult,
} from "./prompts.js";
export {
  recordUserFeedback,
  scoreCurrentTrace,
  scoreTrace,
  type ScoreDataType,
  type ScoreOptions,
} from "./scores.js";
export {
  runExperiment,
  syncDataset,
  type Evaluation,
  type ExperimentConfig,
  type ExperimentItem,
  type ExperimentSummary,
  type ItemEvaluator,
  type ItemResult,
  type RunEvaluator,
} from "./experiments.js";

export { shutdownLangfuse } from "./lifecycle.js";

// Tracing primitives from the official SDK, re-exported so apps depend on one package.
export {
  createTraceId,
  getActiveSpanId,
  getActiveTraceId,
  observe,
  propagateAttributes,
  startActiveObservation,
  startObservation,
  updateActiveObservation,
  type LangfuseAgent,
  type LangfuseEvaluator,
  type LangfuseGeneration,
  type LangfuseRetriever,
  type LangfuseSpan,
} from "@langfuse/tracing";
