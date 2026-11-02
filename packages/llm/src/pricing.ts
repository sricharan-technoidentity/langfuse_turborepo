import type { TokenUsage } from "./types.js";

/** USD per 1M tokens. Langfuse doesn't know our mock models, so we send costs ourselves. */
export const MODEL_PRICING: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  "mock-gpt-small": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "mock-gpt-large": { inputPerMillion: 2.5, outputPerMillion: 10 },
};

/** Rough token estimate (~4 characters per token), good enough for a mock. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function calculateCost(model: string, usage: TokenUsage): { input: number; output: number; total: number } | undefined {
  const price = MODEL_PRICING[model];
  if (!price) return undefined;
  const input = (usage.input / 1_000_000) * price.inputPerMillion;
  const output = (usage.output / 1_000_000) * price.outputPerMillion;
  return { input, output, total: input + output };
}
