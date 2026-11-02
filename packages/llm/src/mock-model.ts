import { estimateTokens } from "./pricing.js";
import type { ChatModel, CompletionRequest, CompletionResponse, LlmMessage } from "./types.js";

export const MOCK_MODEL_NAME = "mock-gpt-small";

/** Decides what the mock "says". Receives the full message list of the request. */
export type MockResponder = (messages: LlmMessage[]) => string | Promise<string>;

export interface MockChatModelOptions {
  /** Model name reported in traces (default "mock-gpt-small"). */
  model?: string;
  /** Simulated response time in ms. Defaults to MOCK_LLM_LATENCY_MS or 0. */
  latencyMs?: number;
  /** Custom reply logic. Default: echoes the latest user message. */
  respond?: MockResponder;
}

/** Default reply: an obvious echo, so it's never mistaken for a real answer. */
export const echoResponder: MockResponder = (messages) => {
  const lastUser = messages.findLast((m) => m.role === "user");
  return `[mock reply] ${lastUser?.content ?? "(no user message)"}`;
};

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * A stand-in model so everything runs (and tests pass) without API keys or cost.
 * It never calls a network. Usage is estimated from text length (~4 characters per token).
 */
export class MockChatModel implements ChatModel {
  readonly provider = "mock" as const;
  readonly model: string;
  readonly supportsTemperature = true;
  private readonly latencyMs: number;
  private readonly respond: MockResponder;

  constructor(options: MockChatModelOptions = {}) {
    this.model = options.model ?? MOCK_MODEL_NAME;
    this.latencyMs = options.latencyMs ?? Number(process.env.MOCK_LLM_LATENCY_MS ?? 0);
    this.respond = options.respond ?? echoResponder;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    await sleep(this.latencyMs / 2);
    const firstTokenAt = new Date();
    await sleep(this.latencyMs / 2);

    const content = await this.respond(request.messages);
    const input = estimateTokens(request.messages.map((m) => m.content).join("\n"));
    const output = estimateTokens(content);

    return {
      model: request.model ?? this.model,
      content,
      finishReason: "stop",
      usage: { input, output, total: input + output },
      firstTokenAt,
    };
  }
}
