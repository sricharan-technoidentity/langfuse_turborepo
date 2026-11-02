import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";

import { getLangfuseConfig, type LangfuseConfig } from "./config.js";

export { LangfuseSpanProcessor };

/** Optional hook to redact data before it is exported (receives every input/output/metadata value). */
export type MaskFunction = (params: { data: unknown }) => unknown;

export interface LangfuseProcessorOptions {
  /** Defaults to values read from environment variables. */
  config?: LangfuseConfig;
  /**
   * "batched" (default) buffers spans and sends them in the background — best for servers.
   * "immediate" sends each span as it ends — best for scripts, serverless and tests.
   */
  exportMode?: "batched" | "immediate";
  /** Replace the OTLP exporter, e.g. with an in-memory exporter in tests. */
  exporter?: SpanExporter;
  /** Optional redaction hook applied to every exported input/output/metadata value. */
  mask?: MaskFunction;
}

export interface InitTracingOptions extends LangfuseProcessorOptions {
  /** Suppress the startup warning when Langfuse is disabled. */
  silent?: boolean;
}

export interface TracingHandle {
  /** True when spans are actually exported (keys present or a custom exporter given). */
  exporting: boolean;
  /** Sends any buffered spans now. Call before a short-lived process exits. */
  flush(): Promise<void>;
  /** Flushes and stops the tracer provider. Call once on shutdown. */
  shutdown(): Promise<void>;
}

let active: TracingHandle | undefined;

/**
 * The Langfuse span processor on its own, for apps that already run OpenTelemetry
 * (Next.js instrumentation.ts, Sentry, Datadog, NodeSDK...). Add it to their span
 * processors instead of calling initTracing(). It only exports Langfuse / GenAI spans.
 * Returns undefined when Langfuse keys are not configured (and no exporter is given).
 */
export function createLangfuseSpanProcessor(options: LangfuseProcessorOptions = {}): LangfuseSpanProcessor | undefined {
  const config = options.config ?? getLangfuseConfig();
  if (!config.enabled && !options.exporter) return undefined;
  return new LangfuseSpanProcessor({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    baseUrl: config.baseUrl,
    environment: config.environment,
    release: config.release,
    exportMode: options.exportMode ?? "batched",
    exporter: options.exporter,
    mask: options.mask,
  });
}

/**
 * Sets up OpenTelemetry with the Langfuse span processor. Call once, as early as
 * possible in your process (before your app code creates any observations).
 * If your app already configures OpenTelemetry, use createLangfuseSpanProcessor() instead.
 *
 * Without Langfuse keys, a tracer provider is still registered so trace IDs and
 * context propagation keep working — spans are simply not exported anywhere.
 */
export function initTracing(options: InitTracingOptions = {}): TracingHandle {
  if (active) return active;

  const processor = createLangfuseSpanProcessor(options);
  const exporting = Boolean(processor);

  const provider = new NodeTracerProvider({
    spanProcessors: processor ? [processor] : [],
  });
  provider.register();

  if (!exporting && !options.silent) {
    console.warn(
      "[langfuse] Keys not configured — tracing runs locally but nothing is sent. " +
        "Copy .env.example to .env and add your Langfuse Cloud keys.",
    );
  }

  let shutDown = false;
  active = {
    exporting,
    async flush() {
      await processor?.forceFlush();
    },
    async shutdown() {
      if (shutDown) return;
      shutDown = true;
      await provider.shutdown();
      active = undefined;
    },
  };
  return active;
}

/** Flushes spans if tracing was initialised; safe to call at any time. */
export async function flushTracing(): Promise<void> {
  await active?.flush();
}

/** Shuts tracing down if it was initialised; safe to call at any time. */
export async function shutdownTracing(): Promise<void> {
  await active?.shutdown();
}
