export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  /** Override the model's default model name for this call. */
  model?: string;
  messages: LlmMessage[];
  /** Ignored by providers that don't support it (see ChatModel.supportsTemperature). */
  temperature?: number;
  maxTokens?: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export interface CompletionResponse {
  /** Model name reported by the provider (may be a dated snapshot). */
  model: string;
  content: string;
  finishReason: "stop" | "length" | "other";
  usage: TokenUsage;
  /** When the first token arrived (lets Langfuse show time-to-first-token). */
  firstTokenAt?: Date;
}

export type ProviderName = "openai" | "anthropic";

/** Anything that can complete a chat. Implemented by the OpenAI and Anthropic models. */
export interface ChatModel {
  readonly provider: ProviderName;
  /** Default model name used when a request doesn't set one. */
  readonly model: string;
  /** False when the provider API has no temperature setting. */
  readonly supportsTemperature: boolean;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}
