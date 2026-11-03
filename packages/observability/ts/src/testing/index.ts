import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";

import { flushTracing, getLangfuseConfig, initTracing, setLangfuseClient, shutdownTracing } from "@repo/langfuse";

/** A finished span, simplified for assertions. */
export interface CapturedSpan {
  name: string;
  /** Langfuse observation type: span, generation, agent, tool, retriever, guardrail... */
  type: string | undefined;
  traceId: string;
  spanId: string;
  parentSpanId: string | undefined;
  attributes: Record<string, unknown>;
}

export interface TestTracing {
  /** All spans finished so far, in end order (flushes the processor first). */
  spans(): Promise<CapturedSpan[]>;
  /** Spans whose name matches exactly. */
  byName(name: string): Promise<CapturedSpan[]>;
  reset(): void;
  shutdown(): Promise<void>;
}

function simplify(span: ReadableSpan): CapturedSpan {
  const attributes = { ...span.attributes } as Record<string, unknown>;
  return {
    name: span.name,
    type: attributes["langfuse.observation.type"] as string | undefined,
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanContext?.spanId,
    attributes,
  };
}

/**
 * Routes every Langfuse span into memory instead of the network, through the real
 * LangfuseSpanProcessor (so propagated attributes behave exactly as in production).
 * Also disables the Langfuse client so prompts fall back to local definitions.
 */
export function createTestTracing(): TestTracing {
  const exporter = new InMemorySpanExporter();
  setLangfuseClient(null);
  initTracing({
    config: { ...getLangfuseConfig({}), environment: "test" },
    exporter,
    exportMode: "immediate",
    silent: true,
  });

  const spans = async () => {
    await flushTracing();
    return exporter.getFinishedSpans().map(simplify);
  };

  return {
    spans,
    byName: async (name) => (await spans()).filter((s) => s.name === name),
    reset: () => exporter.reset(),
    shutdown: async () => {
      await shutdownTracing();
      setLangfuseClient(undefined);
    },
  };
}

export { InMemorySpanExporter };
