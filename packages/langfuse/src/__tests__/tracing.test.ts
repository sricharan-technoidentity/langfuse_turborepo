import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runExperiment } from "../experiments.js";
import {
  createLangfuseSpanProcessor,
  getActiveTraceId,
  getLangfuseConfig,
  LangfuseSpanProcessor,
  propagateAttributes,
  startActiveObservation,
} from "../index.js";
import { createTestTracing, type TestTracing } from "../testing/index.js";

let tracing: TestTracing;

beforeAll(() => {
  tracing = createTestTracing();
});
beforeEach(() => tracing.reset());
afterAll(async () => {
  await tracing.shutdown();
});

describe("tracing through the Langfuse span processor", () => {
  it("nests observations and propagates user/session/tags", async () => {
    let traceId: string | undefined;

    await propagateAttributes({ userId: "user-1", sessionId: "session-1", tags: ["test"] }, () =>
      startActiveObservation(
        "handle-request",
        async (agent) => {
          traceId = getActiveTraceId();
          agent.update({ input: { message: "hello" } });
          await startActiveObservation(
            "llm-call",
            async (generation) => {
              generation.update({ model: "mock-gpt-small", usageDetails: { input: 10, output: 5 } });
            },
            { asType: "generation" },
          );
        },
        { asType: "agent" },
      ),
    );

    const [generation] = await tracing.byName("llm-call");
    const [root] = await tracing.byName("handle-request");

    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(root?.type).toBe("agent");
    expect(generation?.type).toBe("generation");
    expect(generation?.parentSpanId).toBe(root?.spanId);
    expect(root?.traceId).toBe(traceId);

    expect(root?.attributes["user.id"]).toBe("user-1");
    expect(root?.attributes["session.id"]).toBe("session-1");
    expect(root?.attributes["langfuse.environment"]).toBe("test");
    expect(JSON.parse(String(root?.attributes["langfuse.observation.input"]))).toEqual({ message: "hello" });
  });
});

describe("createLangfuseSpanProcessor (for apps with their own OpenTelemetry setup)", () => {
  it("returns nothing without keys and a Langfuse processor with keys", async () => {
    expect(createLangfuseSpanProcessor({ config: getLangfuseConfig({}) })).toBeUndefined();

    const processor = createLangfuseSpanProcessor({
      config: getLangfuseConfig({ LANGFUSE_PUBLIC_KEY: "pk-lf-test", LANGFUSE_SECRET_KEY: "sk-lf-test" }),
      exportMode: "immediate",
    });
    expect(processor).toBeInstanceOf(LangfuseSpanProcessor);
    await processor?.shutdown();
  });
});

describe("runExperiment without Langfuse keys", () => {
  it("runs task and evaluators locally and averages the scores", async () => {
    const summary = await runExperiment({
      name: "double",
      data: [
        { input: 1, expectedOutput: 2 },
        { input: 2, expectedOutput: 5 },
      ],
      task: async ({ input }) => input * 2,
      evaluators: [
        async ({ output, expectedOutput }) => ({ name: "exact", value: output === expectedOutput ? 1 : 0 }),
      ],
      runEvaluators: [async ({ itemResults }) => ({ name: "items", value: itemResults.length })],
    });

    expect(summary.mode).toBe("local");
    expect(summary.items.map((i) => i.output)).toEqual([2, 4]);
    expect(summary.averages).toEqual({ exact: 0.5 });
    expect(summary.runEvaluations).toEqual([{ name: "items", value: 2 }]);
    expect(await tracing.byName("experiment-item: double")).toHaveLength(2);
  });
});
