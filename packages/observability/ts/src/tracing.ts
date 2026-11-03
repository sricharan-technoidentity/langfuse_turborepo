// Tracing primitives from the official SDK, re-exported so apps depend on one package.
// They need tracing to be started first: initTracing() or createLangfuseSpanProcessor() from @repo/langfuse.
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
