import { startActiveObservation, type Evaluation, type ItemEvaluator, type RunEvaluator } from "@repo/langfuse";
import { createChatModel, tracedCompletion, type ChatModel } from "@repo/llm";

import type { Scorer } from "./agent.js";

/**
 * Reusable evaluators for experiments (`runAgentExperiment` / `runExperiment`).
 * Each compares an output with the item's `expectedOutput` and returns a 0..1 score.
 * Outputs may be plain strings or agent RunResults — the text is extracted for you.
 */

/** Gets the text to evaluate from a string, a RunResult ({ output }) or any other value. */
export function textOf(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object" && "output" in output && typeof output.output === "string") {
    return output.output;
  }
  return JSON.stringify(output ?? "");
}

const toList = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** 1 when the output equals expectedOutput (trimmed; case-insensitive by default). */
export function exactMatch<I = unknown, O = unknown>(
  options: { name?: string; caseSensitive?: boolean } = {},
): ItemEvaluator<I, string, O> {
  return async ({ output, expectedOutput }) => {
    const normalize = (s: string) => (options.caseSensitive ? s.trim() : s.trim().toLowerCase());
    const match = expectedOutput !== undefined && normalize(textOf(output)) === normalize(expectedOutput);
    return { name: options.name ?? "exact_match", value: match ? 1 : 0, dataType: "BOOLEAN" };
  };
}

/** Share (0..1) of the expected phrases that appear in the output (case-insensitive). */
export function containsAll<I = unknown, O = unknown>(
  options: { name?: string } = {},
): ItemEvaluator<I, string | string[], O> {
  return async ({ output, expectedOutput }) => {
    const text = textOf(output).toLowerCase();
    const required = toList(expectedOutput);
    const found = required.filter((phrase) => text.includes(phrase.toLowerCase()));
    return {
      name: options.name ?? "contains_all",
      value: required.length === 0 ? 1 : found.length / required.length,
      comment: `${found.length}/${required.length} found`,
    };
  };
}

/** Share (0..1) of the expected regex patterns that match the output (case-insensitive). */
export function matchesPatterns<I = unknown, O = unknown>(
  options: { name?: string } = {},
): ItemEvaluator<I, string | string[], O> {
  return async ({ output, expectedOutput }) => {
    const text = textOf(output);
    const patterns = toList(expectedOutput);
    const matched = patterns.filter((p) => new RegExp(p, "i").test(text));
    return {
      name: options.name ?? "matches_patterns",
      value: patterns.length === 0 ? 1 : matched.length / patterns.length,
      comment: `${matched.length}/${patterns.length} matched`,
    };
  };
}

/** Run-level score: share of items whose numeric scores are all ≥ threshold (default 1). */
export function passRate<I = unknown, E = unknown, O = unknown>(
  options: { name?: string; threshold?: number } = {},
): RunEvaluator<I, E, O> {
  const threshold = options.threshold ?? 1;
  return async ({ itemResults }) => {
    const passed = itemResults.filter(
      (r) =>
        !r.error &&
        r.evaluations.length > 0 &&
        r.evaluations.every((e) => typeof e.value !== "number" || e.value >= threshold),
    ).length;
    return {
      name: options.name ?? "pass_rate",
      value: itemResults.length ? passed / itemResults.length : 0,
      comment: `${passed}/${itemResults.length} items passed`,
    };
  };
}

// ───────────────────────────── LLM-as-a-judge ─────────────────────────────

export interface JudgeOptions {
  /** What a good output looks like, in plain words. */
  criteria: string;
  /** Score name (default "llm_judge"). */
  name?: string;
  /** Judge model (default createChatModel()). Use a strong model for reliable grading. */
  model?: ChatModel;
}

const JUDGE_SYSTEM =
  "You are a strict evaluator. Grade the OUTPUT against the CRITERIA.\n" +
  'Reply with JSON only, no other text: {"score": <number from 0 to 1>, "reasoning": "<one short sentence>"}';

/** Asks a model to grade an output; traced as an `evaluator` observation with a nested generation. */
export async function judgeWithLlm(params: {
  criteria: string;
  output: string;
  input?: unknown;
  expectedOutput?: unknown;
  name?: string;
  model?: ChatModel;
}): Promise<Evaluation> {
  const model = params.model ?? createChatModel();
  const name = params.name ?? "llm_judge";

  return startActiveObservation(
    `judge: ${name}`,
    async (evaluator) => {
      const sections = [
        `CRITERIA:\n${params.criteria}`,
        params.input !== undefined ? `INPUT:\n${typeof params.input === "string" ? params.input : JSON.stringify(params.input)}` : "",
        params.expectedOutput !== undefined
          ? `REFERENCE ANSWER:\n${typeof params.expectedOutput === "string" ? params.expectedOutput : JSON.stringify(params.expectedOutput)}`
          : "",
        `OUTPUT:\n${params.output}`,
      ].filter(Boolean);

      const response = await tracedCompletion(model, {
        name: "judge-llm-call",
        temperature: 0,
        maxTokens: 300,
        messages: [
          { role: "system", content: JUDGE_SYSTEM },
          { role: "user", content: sections.join("\n\n") },
        ],
      });

      let evaluation: Evaluation;
      try {
        const json = response.content.match(/\{[\s\S]*\}/)?.[0] ?? "";
        const parsed = JSON.parse(json) as { score?: unknown; reasoning?: unknown };
        const score = Number(parsed.score);
        if (!Number.isFinite(score)) throw new Error("score is not a number");
        evaluation = {
          name,
          value: Math.min(1, Math.max(0, score)),
          comment: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
        };
      } catch {
        evaluation = { name, value: 0, comment: `Judge reply was not valid JSON: ${response.content.slice(0, 200)}` };
      }

      evaluator.update({ output: evaluation });
      return evaluation;
    },
    { asType: "evaluator" },
  );
}

/** LLM-as-a-judge for experiments: grades each output, using expectedOutput as a reference when present. */
export function llmJudge<I = unknown, E = unknown, O = unknown>(options: JudgeOptions): ItemEvaluator<I, E, O> {
  return ({ input, output, expectedOutput }) =>
    judgeWithLlm({ ...options, input, expectedOutput, output: textOf(output) });
}

/** LLM-as-a-judge as an online scorer: grades every live agent call (adds cost and latency). */
export function llmJudgeScorer(options: JudgeOptions): Scorer {
  return ({ input, output }) =>
    judgeWithLlm({ ...options, input: { variables: input.variables, message: input.message }, output });
}
