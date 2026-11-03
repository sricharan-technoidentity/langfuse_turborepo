import type { ChatModel, LlmMessage } from "@repo/llm";

/** Offline test stand-in for a provider. Replies with the last user message unless `reply` is given. */
export const fakeModel = (
  reply: (messages: LlmMessage[]) => string = (messages) => messages.findLast((m) => m.role === "user")?.content ?? "",
): ChatModel => ({
  provider: "openai",
  model: "test-model",
  supportsTemperature: true,
  complete: async ({ model, messages }) => ({ model: model ?? "test-model", content: reply(messages), finishReason: "stop", usage: { input: 1, output: 1, total: 2 } }),
});
