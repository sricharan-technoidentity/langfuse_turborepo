import { createAgent, type Agent } from "@repo/agent";
import type { ChatModel } from "@repo/llm";
import { defineChatPrompt } from "@repo/observability";

export const chatPrompt = defineChatPrompt({
  name: "chat-assistant",
  messages: [{ role: "system", content: "You are a helpful assistant." }],
  config: { temperature: 0.7, maxTokens: 1024 },
});

/** Without `model`, createChatModel() picks OpenAI/Claude from env and throws when no key is set. */
export const createChatAgent = (model?: ChatModel): Agent => createAgent({ name: "chat", prompt: chatPrompt, model });
