import { LangfuseClient } from "@langfuse/client";

import { getLangfuseConfig } from "./config.js";

let client: LangfuseClient | null | undefined;

/**
 * Returns a shared LangfuseClient (prompts, scores, datasets, experiments, REST API),
 * or null when Langfuse keys are not configured. Callers should treat null as
 * "run without Langfuse" rather than an error.
 */
export function getLangfuseClient(): LangfuseClient | null {
  if (client !== undefined) return client;

  const config = getLangfuseConfig();
  client = config.enabled
    ? new LangfuseClient({
        publicKey: config.publicKey,
        secretKey: config.secretKey,
        baseUrl: config.baseUrl,
      })
    : null;
  return client;
}

/** Sends queued scores. Tracing spans are flushed separately via flushTracing(). */
export async function flushLangfuseClient(): Promise<void> {
  await client?.flush();
}

export async function shutdownLangfuseClient(): Promise<void> {
  await client?.shutdown();
  client = undefined;
}

/** Override the shared client (pass null to force "disabled"). Intended for tests. */
export function setLangfuseClient(next: LangfuseClient | null | undefined): void {
  client = next;
}

/** Builds a link to a trace in the Langfuse UI, or null when Langfuse is disabled. */
export async function getTraceUrl(traceId: string | undefined): Promise<string | null> {
  const lf = getLangfuseClient();
  if (!lf || !traceId) return null;
  try {
    return await lf.getTraceUrl(traceId);
  } catch {
    return null;
  }
}
