/**
 * @repo/observability — the Langfuse features apps use: tracing helpers, prompt
 * management, scores and feedback, experiments. The connection itself (keys, client,
 * span processor, shutdown) is in @repo/langfuse.
 */

export * from "./tracing.js";
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
