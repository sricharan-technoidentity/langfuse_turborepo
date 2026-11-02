import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import type { ChatModel, CompletionRequest, CompletionResponse } from "../types.js";

export const DEFAULT_OPENAI_MODEL = "gpt-6-luna";

export interface OpenAIChatModelOptions {
  apiKey: string;
  model?: string;
  /** Point at any OpenAI-compatible API (Azure OpenAI, OpenRouter, Groq, Ollama…). */
  baseURL?: string;
  /** Max retries for rate limits / network errors (default 2). */
  maxRetries?: number;
}

/** True when the API rejected the request because the model doesn't allow a custom temperature. */
function isTemperatureRejection(error: unknown): boolean {
  return error instanceof OpenAI.APIError && error.status === 400 && /temperature/i.test(error.message);
}

/** OpenAI Chat Completions API. */
export class OpenAIChatModel implements ChatModel {
  readonly provider = "openai" as const;
  readonly model: string;
  readonly supportsTemperature = true;
  private readonly client: OpenAI;

  constructor(options: OpenAIChatModelOptions) {
    this.model = options.model ?? DEFAULT_OPENAI_MODEL;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      maxRetries: options.maxRetries ?? 2,
    });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const params: ChatCompletionCreateParamsNonStreaming = {
      model: request.model ?? this.model,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(request.maxTokens !== undefined ? { max_completion_tokens: request.maxTokens } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    };

    let completion;
    try {
      completion = await this.client.chat.completions.create(params);
    } catch (error) {
      // Some reasoning models only accept the default temperature: retry once without it.
      if (params.temperature === undefined || !isTemperatureRejection(error)) throw error;
      const { temperature: _ignored, ...withoutTemperature } = params;
      completion = await this.client.chat.completions.create(withoutTemperature);
    }

    const choice = completion.choices[0];
    const input = completion.usage?.prompt_tokens ?? 0;
    const output = completion.usage?.completion_tokens ?? 0;

    return {
      model: completion.model,
      content: choice?.message.content ?? "",
      finishReason:
        choice?.finish_reason === "stop" ? "stop" : choice?.finish_reason === "length" ? "length" : "other",
      usage: { input, output, total: completion.usage?.total_tokens ?? input + output },
    };
  }
}
