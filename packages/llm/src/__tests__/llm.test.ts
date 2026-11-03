import { createTestTracing, type TestTracing } from "@repo/observability/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { tracedCompletion, type ChatModel } from "../index.js";
import { fakeModel } from "./fake-model.js";

const messages = [
  { role: "system" as const, content: "You are concise." },
  { role: "user" as const, content: "Say hello" },
];

describe("tracedCompletion", () => {
  let tracing: TestTracing;
  beforeAll(() => {
    tracing = createTestTracing();
  });
  beforeEach(() => tracing.reset());
  afterAll(() => tracing.shutdown());

  it("records a generation with model, parameters, usage and prompt link", async () => {
    await tracedCompletion(fakeModel(), {
      name: "answer",
      temperature: 0.2,
      maxTokens: 100,
      messages,
      prompt: { name: "my-prompt", version: 3, isFallback: false },
    });

    const [generation] = await tracing.byName("answer");
    expect(generation?.type).toBe("generation");
    const attrs = generation!.attributes;
    expect(attrs["langfuse.observation.model.name"]).toBe("test-model");
    expect(attrs["langfuse.observation.prompt.name"]).toBe("my-prompt");
    expect(attrs["langfuse.observation.prompt.version"]).toBe(3);
    expect(JSON.parse(String(attrs["langfuse.observation.model.parameters"]))).toEqual({ temperature: 0.2, maxTokens: 100 });
    expect(JSON.parse(String(attrs["langfuse.observation.usage_details"]))).toHaveProperty("total");
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
