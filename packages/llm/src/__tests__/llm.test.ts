import { createTestTracing, type TestTracing } from "@repo/observability/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { calculateCost, MockChatModel, tracedCompletion, type ChatModel } from "../index.js";

const messages = [
  { role: "system" as const, content: "You are concise." },
  { role: "user" as const, content: "Say hello" },
];

describe("MockChatModel", () => {
  it("echoes the last user message by default and estimates usage", async () => {
    const res = await new MockChatModel({ latencyMs: 0 }).complete({ messages });
    expect(res.content).toBe("[mock reply] Say hello");
    expect(res.model).toBe("mock-gpt-small");
    expect(res.finishReason).toBe("stop");
    expect(res.usage.total).toBe(res.usage.input + res.usage.output);
  });

  it("accepts a custom responder and model name", async () => {
    const model = new MockChatModel({
      latencyMs: 0,
      model: "mock-gpt-large",
      respond: (msgs) => `system said: ${msgs[0]?.content}`,
    });
    const res = await model.complete({ messages });
    expect(res.content).toBe("system said: You are concise.");
    expect(res.model).toBe("mock-gpt-large");
  });
});

describe("calculateCost", () => {
  it("prices mock models per million tokens and leaves real models to Langfuse", () => {
    expect(calculateCost("mock-gpt-small", { input: 1_000_000, output: 1_000_000, total: 2_000_000 })).toEqual({
      input: 0.15,
      output: 0.6,
      total: 0.75,
    });
    expect(calculateCost("gpt-6-luna", { input: 1, output: 1, total: 2 })).toBeUndefined();
  });
});

describe("tracedCompletion", () => {
  let tracing: TestTracing;
  beforeAll(() => {
    tracing = createTestTracing();
  });
  beforeEach(() => tracing.reset());
  afterAll(() => tracing.shutdown());

  it("records a generation with model, parameters, usage, cost and prompt link", async () => {
    await tracedCompletion(new MockChatModel({ latencyMs: 0 }), {
      name: "answer",
      temperature: 0.2,
      maxTokens: 100,
      messages,
      prompt: { name: "my-prompt", version: 3, isFallback: false },
    });

    const [generation] = await tracing.byName("answer");
    expect(generation?.type).toBe("generation");
    const attrs = generation!.attributes;
    expect(attrs["langfuse.observation.model.name"]).toBe("mock-gpt-small");
    expect(attrs["langfuse.observation.prompt.name"]).toBe("my-prompt");
    expect(attrs["langfuse.observation.prompt.version"]).toBe(3);
    expect(JSON.parse(String(attrs["langfuse.observation.model.parameters"]))).toEqual({ temperature: 0.2, maxTokens: 100 });
    expect(JSON.parse(String(attrs["langfuse.observation.usage_details"]))).toHaveProperty("total");
    expect(JSON.parse(String(attrs["langfuse.observation.cost_details"]))).toHaveProperty("total");
  });

  it("drops temperature for providers without it and marks failures as errors", async () => {
    const failing: ChatModel = {
      provider: "anthropic",
      model: "claude-test",
      supportsTemperature: false,
      complete: async (req) => {
        expect(req.temperature).toBeUndefined();
        throw new Error("rate limited");
      },
    };

    await expect(tracedCompletion(failing, { name: "fails", temperature: 0.7, messages })).rejects.toThrow("rate limited");

    const [generation] = await tracing.byName("fails");
    expect(generation?.attributes["langfuse.observation.level"]).toBe("ERROR");
    expect(generation?.attributes["langfuse.observation.status_message"]).toBe("rate limited");
    expect(JSON.parse(String(generation?.attributes["langfuse.observation.model.parameters"]))).toEqual({});
  });
});
