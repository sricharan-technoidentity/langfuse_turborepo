import { startActiveObservation, type PromptLink } from "@repo/observability";

import type { ChatModel, CompletionRequest, CompletionResponse } from "./types.js";

export interface TracedCompletionOptions extends CompletionRequest {
  /** Observation name shown in Langfuse (default "llm-completion"). */
  name?: string;
  /** Links this generation to a Langfuse prompt version. */
  prompt?: PromptLink;
  metadata?: Record<string, unknown>;
}

/**
 * Calls the model inside a Langfuse *generation* observation and records everything
 * Langfuse needs for its LLM views: model, parameters actually sent, input messages,
 * output, token usage, time-to-first-token and the prompt version used.
 * Cost: Langfuse calculates it from OpenAI/Claude model names.
 */
export function tracedCompletion(model: ChatModel, options: TracedCompletionOptions): Promise<CompletionResponse> {
  const { name = "llm-completion", prompt, metadata, ...request } = options;

  // Only send (and record) a temperature when the provider supports it.
  if (!model.supportsTemperature) delete request.temperature;

  return startActiveObservation(
    name,
    async (generation) => {
      const modelParameters: Record<string, number> = {};
      if (request.temperature !== undefined) modelParameters.temperature = request.temperature;
      if (request.maxTokens !== undefined) modelParameters.maxTokens = request.maxTokens;

      generation.update({
        model: request.model ?? model.model,
        modelParameters,
        input: request.messages,
        prompt,
        metadata: { ...metadata, provider: model.provider },
      });

      try {
        const response = await model.complete(request);
        generation.update({
          model: response.model,
          output: { role: "assistant", content: response.content },
          completionStartTime: response.firstTokenAt,
          usageDetails: { ...response.usage },
          metadata: { finishReason: response.finishReason },
        });
        return response;
      } catch (error) {
        generation.update({
          level: "ERROR",
          statusMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    { asType: "generation" },
  );
}
