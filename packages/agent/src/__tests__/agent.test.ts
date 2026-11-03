import { defineChatPrompt } from "@repo/observability";
import { createTestTracing, type TestTracing } from "@repo/observability/testing";
import type { ChatModel } from "@repo/llm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAgent } from "../index.js";
import { fakeModel } from "./fake-model.js";

let tracing: TestTracing;
beforeAll(() => {
  tracing = createTestTracing();
});
beforeEach(() => tracing.reset());
afterAll(() => tracing.shutdown());

const prompt = defineChatPrompt({
  name: "test/translator",
  messages: [{ role: "system", content: "Translate the user's text into {{language}}." }],
  config: { temperature: 0.3, maxTokens: 200 },
});

/** Shows exactly which messages reached the model. */
const recordingModel = () => {
  const calls: { messages: { role: string; content: string }[]; temperature?: number; maxTokens?: number }[] = [];
  const model = fakeModel((messages) => `translated: ${messages.at(-1)?.content}`);
  const original = model.complete.bind(model);
  model.complete = async (request) => {
    calls.push({ messages: request.messages, temperature: request.temperature, maxTokens: request.maxTokens });
    return original(request);
  };
  return { model, calls };
};

describe("createAgent", () => {
  it("compiles the prompt, appends history + message, and uses the prompt config", async () => {
    const { model, calls } = recordingModel();
    const agent = createAgent({ name: "translator", prompt, model });

    const result = await agent.run({
      variables: { language: "French" },
      history: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Salut" },
      ],
      message: "Good morning",
    });

    expect(calls[0]?.messages).toEqual([
      { role: "system", content: "Translate the user's text into French." },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Salut" },
      { role: "user", content: "Good morning" },
    ]);
    expect(calls[0]).toMatchObject({ temperature: 0.3, maxTokens: 200 });
    expect(result).toMatchObject({
      output: "translated: Good morning",
      model: "openai/test-model",
      promptName: "test/translator",
      promptVersion: null, // in-code fallback (Langfuse disabled in tests)
      finishReason: "stop",
      scores: [],
    });
    expect(result.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(result.usage.total).toBeGreaterThan(0);
  });

  it("produces one trace: agent root + generation, with user/session/tags/metadata", async () => {
    const agent = createAgent({ name: "translator", prompt, model: fakeModel(), tags: ["team-a"] });

    const result = await agent.run({
      variables: { language: "German" },
      message: "Thanks",
      userId: "user-1",
      sessionId: "session-1",
      tags: ["beta"],
      metadata: { feature: "inbox" },
    });

    const spans = await tracing.spans();
    expect(spans.map((s) => [s.name, s.type]).sort()).toEqual([
      ["llm-call", "generation"],
      ["translator", "agent"],
    ]);
    const root = spans.find((s) => s.name === "translator")!;
    const generation = spans.find((s) => s.name === "llm-call")!;
    expect(generation.parentSpanId).toBe(root.spanId);

    for (const span of spans) {
      expect(span.traceId).toBe(result.traceId);
      expect(span.attributes["user.id"]).toBe("user-1");
      expect(span.attributes["session.id"]).toBe("session-1");
      expect(span.attributes["langfuse.trace.name"]).toBe("translator");
      expect(span.attributes["langfuse.trace.tags"]).toEqual(["translator", "openai", "team-a", "beta"]);
      expect(JSON.parse(String(span.attributes["langfuse.trace.metadata.feature"]))).toBe("inbox");
    }
    expect(JSON.parse(String(root.attributes["langfuse.observation.input"]))).toEqual({
      variables: { language: "German" },
      message: "Thanks",
      historyTurns: 0,
    });
    expect(root.attributes["langfuse.observation.output"]).toBe("Thanks");
  });

  it("runs scorers after each call and records them in an evaluator observation", async () => {
    const agent = createAgent({
      name: "translator",
      prompt,
      model: fakeModel(),
      scorers: [
        ({ output }) => ({ name: "not_empty", value: output.length > 0 ? 1 : 0, dataType: "BOOLEAN" }),
        ({ result }) => [{ name: "tokens", value: result.usage.total }],
        () => {
          throw new Error("broken scorer");
        },
      ],
    });

    const result = await agent.run({ variables: { language: "Hindi" }, message: "Hello" });

    expect(result.scores.map((s) => s.name)).toEqual(["not_empty", "tokens"]);
    const [scorers] = await tracing.byName("scorers");
    expect(scorers?.type).toBe("evaluator");
  });

  it("does not send temperature to providers without it", async () => {
    let seen: number | undefined = -1;
    const claudeLike: ChatModel = {
      provider: "anthropic",
      model: "claude-test",
      supportsTemperature: false,
      complete: async (req) => {
        seen = req.temperature;
        return { model: "claude-test", content: "ok", finishReason: "stop", usage: { input: 5, output: 1, total: 6 } };
      },
    };
    const result = await createAgent({ name: "translator", prompt, model: claudeLike }).run({
      variables: { language: "Spanish" },
      message: "Hi",
    });
    expect(seen).toBeUndefined();
    expect(result.model).toBe("anthropic/claude-test");
  });

  it("explains what's missing when there is no user message", async () => {
    const agent = createAgent({ name: "translator", prompt, model: fakeModel() });
    await expect(agent.run({ variables: { language: "French" } })).rejects.toThrow(/no user message/);
  });
});
