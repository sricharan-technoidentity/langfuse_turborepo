/**
 * @repo/langfuse — the connection to Langfuse: env/config, the API client and the
 * OpenTelemetry span processor. Apps call `loadEnv()` + `initTracing()` once at startup
 * and `shutdownLangfuse()` before exit. Features (tracing helpers, prompts, scores,
 * experiments) live in @repo/observability.
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
export { shutdownLangfuse } from "./lifecycle.js";
