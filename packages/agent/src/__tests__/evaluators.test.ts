import { defineChatPrompt } from "@repo/observability";
import { createTestTracing, type TestTracing } from "@repo/observability/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  containsAll,
  createAgent,
  exactMatch,
  judgeWithLlm,
  llmJudge,
  llmJudgeScorer,
  matchesPatterns,
  passRate,
  runAgentExperiment,
  textOf,
} from "../index.js";
import { fakeModel } from "./fake-model.js";

let tracing: TestTracing;
beforeAll(() => {
  tracing = createTestTracing();
});
beforeEach(() => tracing.reset());
afterAll(() => tracing.shutdown());

const judgeModel = (reply: string) => fakeModel(() => reply);

describe("rule-based evaluators", () => {
  const base = { input: "q" };

  it("textOf reads strings, RunResults and other values", () => {
    expect(textOf("hi")).toBe("hi");
    expect(textOf({ output: "from agent", usage: {} })).toBe("from agent");
    expect(textOf({ a: 1 })).toBe('{"a":1}');
  });

  it("exactMatch ignores case and whitespace by default", async () => {
    expect(await exactMatch()({ ...base, output: "  Paris ", expectedOutput: "paris" })).toMatchObject({ name: "exact_match", value: 1 });
    expect(await exactMatch({ caseSensitive: true })({ ...base, output: "Paris", expectedOutput: "paris" })).toMatchObject({ value: 0 });
  });

  it("containsAll scores the share of expected phrases found", async () => {
    const result = await containsAll()({ ...base, output: { output: "Refunds take 5-7 business days." }, expectedOutput: ["refunds", "business days", "PayPal"] });
    expect(result).toMatchObject({ name: "contains_all", value: 2 / 3, comment: "2/3 found" });
  });

  it("matchesPatterns accepts different phrasings", async () => {
    const evaluator = matchesPatterns();
    for (const output of ["5-7 days", "5 to 7 days", "5–7 days"]) {
      expect(await evaluator({ ...base, output, expectedOutput: "5\\s*(-|–|to)\\s*7 days" })).toMatchObject({ value: 1 });
    }
  });

  it("passRate counts items whose numeric scores all meet the threshold", async () => {
    const result = await passRate({ threshold: 0.5 })({
      itemResults: [
        { input: 1, output: 1, evaluations: [{ name: "a", value: 1 }, { name: "b", value: 0.6 }] },
        { input: 2, output: 2, evaluations: [{ name: "a", value: 0.4 }] },
        { input: 3, output: undefined, evaluations: [], error: "boom" },
      ],
    });
    expect(result).toMatchObject({ name: "pass_rate", value: 1 / 3 });
  });
});

describe("LLM-as-a-judge", () => {
  it("parses the judge's JSON, clamps the score and traces an evaluator", async () => {
    const evaluation = await judgeWithLlm({
      criteria: "Polite and correct",
      output: "Bonjour !",
      model: judgeModel('Sure: {"score": 1.4, "reasoning": "Polite and correct."}'),
    });
    expect(evaluation).toEqual({ name: "llm_judge", value: 1, comment: "Polite and correct." });

    const spans = await tracing.spans();
    const judge = spans.find((s) => s.name === "judge: llm_judge");
    expect(judge?.type).toBe("evaluator");
    expect(spans.find((s) => s.name === "judge-llm-call")?.parentSpanId).toBe(judge?.spanId);
  });

  it("returns 0 with an explanation when the judge reply isn't JSON", async () => {
    const evaluation = await llmJudge({ criteria: "x", model: judgeModel("I think it's fine") })({
      input: "q",
      output: "a",
    });
    expect(evaluation).toMatchObject({ name: "llm_judge", value: 0 });
    expect(String((evaluation as { comment?: string }).comment)).toContain("not valid JSON");
  });

  it("works as an online scorer on an agent", async () => {
    const agent = createAgent({
      name: "greeter",
      prompt: defineChatPrompt({ name: "test/greeter", messages: [{ role: "system", content: "Greet." }], config: {} }),
      model: fakeModel(),
      scorers: [llmJudgeScorer({ name: "politeness", criteria: "Is it polite?", model: judgeModel('{"score":0.8,"reasoning":"ok"}') })],
    });
    const result = await agent.run({ message: "hello" });
    expect(result.scores).toEqual([{ name: "politeness", value: 0.8, comment: "ok" }]);
  });
});

describe("runAgentExperiment", () => {
  it("runs an agent over a dataset locally with evaluators and a pass rate", async () => {
    const agent = createAgent({
      name: "capitals",
      prompt: defineChatPrompt({
        name: "test/capitals",
        messages: [{ role: "system", content: "Answer with the capital city only." }],
        config: { temperature: 0 },
      }),
      model: fakeModel((messages) => ({ France: "Paris", Japan: "Tokyo" })[messages.at(-1)?.content ?? ""] ?? "Unknown"),
    });

    const summary = await runAgentExperiment(agent, {
      data: [
        { input: "France", expectedOutput: "Paris" },
        { input: { message: "Japan" }, expectedOutput: "Tokyo" },
        { input: "Peru", expectedOutput: "Lima" },
      ],
      evaluators: [exactMatch()],
      runEvaluators: [passRate()],
    });

    expect(summary.mode).toBe("local");
    expect(summary.name).toBe("capitals experiment");
    expect(summary.items.map((i) => i.output?.output)).toEqual(["Paris", "Tokyo", "Unknown"]);
    expect(summary.averages.exact_match).toBeCloseTo(2 / 3);
    expect(summary.runEvaluations[0]).toMatchObject({ name: "pass_rate", comment: "2/3 items passed" });

    const roots = await tracing.byName("capitals");
    expect(roots).toHaveLength(3);
    expect(roots[0]?.attributes["langfuse.trace.tags"]).toContain("experiment");
  });
});
