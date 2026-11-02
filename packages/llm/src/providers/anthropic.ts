import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming, MessageParam } from "@anthropic-ai/sdk/resources/messages";

import type { ChatModel, CompletionRequest, CompletionResponse } from "../types.js";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";
/** The Messages API requires max_tokens on every request. */
const DEFAULT_MAX_TOKENS = 1024;

export interface AnthropicChatModelOptions {
  apiKey: string;
  model?: string;
  baseURL?: string;
  /** Max retries for rate limits / network errors (default 2). */
  maxRetries?: number;
}

/** Anthropic Messages API (Claude). System messages are sent in the separate `system` field. */
export class AnthropicChatModel implements ChatModel {
  readonly provider = "anthropic" as const;
  readonly model: string;
  /** The current Messages API has no temperature parameter. */
  readonly supportsTemperature = false;
  private readonly client: Anthropic;

  constructor(options: AnthropicChatModelOptions) {
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      maxRetries: options.maxRetries ?? 2,
    });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages: MessageParam[] = request.messages.flatMap((m) =>
      m.role === "user" || m.role === "assistant" ? [{ role: m.role, content: m.content }] : [],
    );

    const params: MessageCreateParamsNonStreaming = {
      model: request.model ?? this.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      ...(system ? { system } : {}),
    };

    const message = await this.client.messages.create(params);

    const content = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    const input = message.usage.input_tokens;
    const output = message.usage.output_tokens;

    return {
      model: message.model,
      content,
      finishReason:
        message.stop_reason === "end_turn" || message.stop_reason === "stop_sequence"
          ? "stop"
          : message.stop_reason === "max_tokens"
            ? "length"
            : "other",
      usage: { input, output, total: input + output },
    };
  }
}
