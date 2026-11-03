import { shutdownLangfuseClient } from "./client.js";
import { shutdownTracing } from "./tracing.js";

/** Graceful shutdown: flushes spans and queued scores. Call before your process exits. */
export async function shutdownLangfuse(): Promise<void> {
  await Promise.all([shutdownTracing(), shutdownLangfuseClient()]);
}
