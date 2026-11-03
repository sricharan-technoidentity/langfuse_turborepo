import { setLangfuseClient } from "@repo/langfuse";
import { afterEach, describe, expect, it } from "vitest";

import { compileTemplate, defineChatPrompt, getChatPrompt, seedChatPrompt } from "../prompts.js";

describe("prompts without Langfuse", () => {
  afterEach(() => setLangfuseClient(undefined));

  const prompt = defineChatPrompt({
    name: "test/greeting",
    messages: [
      { role: "system", content: "You work for {{ company }}." },
      { role: "user", content: "{{question}} {{unknown}}" },
    ],
    config: { model: "mock-gpt-small", temperature: 0.1 },
  });

  it("compiles {{variables}} like Langfuse and keeps unknown ones", () => {
    expect(compileTemplate("Hi {{ name }} {{other}}", { name: "Ana" })).toBe("Hi Ana {{other}}");
  });

  it("falls back to the local definition", async () => {
    setLangfuseClient(null);
    const resolved = await getChatPrompt(prompt);
    expect(resolved.isFallback).toBe(true);
    expect(resolved.version).toBeNull();
    expect(resolved.link).toBeUndefined();
    expect(resolved.config).toEqual({ model: "mock-gpt-small", temperature: 0.1 });
    expect(resolved.compile({ company: "Acme", question: "Refunds?" })).toEqual([
      { role: "system", content: "You work for Acme." },
      { role: "user", content: "Refunds? {{unknown}}" },
    ]);
  });

  it("skips seeding when disabled", async () => {
    setLangfuseClient(null);
    expect(await seedChatPrompt(prompt)).toEqual({
      name: "test/greeting",
      status: "skipped",
      reason: "Langfuse disabled",
    });
  });
});
