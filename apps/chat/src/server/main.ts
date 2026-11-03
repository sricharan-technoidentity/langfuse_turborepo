import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { describeLangfuseConfig, getTraceUrl, initTracing, loadEnv, shutdownLangfuse } from "@repo/langfuse";
import { describeChatModel } from "@repo/llm";
import { recordUserFeedback } from "@repo/observability";

import { createChatAgent } from "./agent.ts";
import { createHandler } from "./handler.ts";

loadEnv();
initTracing();
// Created eagerly so a missing LLM key fails at startup, not on the first message.
const agent = createChatAgent();
console.log(describeChatModel(agent.model));
console.log(describeLangfuseConfig());

const port = Number(process.env.PORT || 3000);
// Same path from src/server (dev) and dist/server (built): apps/chat/dist/client.
const clientDir = fileURLToPath(new URL("../../dist/client/", import.meta.url));
const server = createServer(createHandler({ agent, getTraceUrl, recordFeedback: recordUserFeedback, clientDir }));
server.listen(port, () => console.log(`Chat API listening on http://localhost:${port}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    server.close();
    await shutdownLangfuse();
    process.exit(0);
  });
}
