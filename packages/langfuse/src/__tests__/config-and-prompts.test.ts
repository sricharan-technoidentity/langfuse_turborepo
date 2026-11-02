import { afterEach, describe, expect, it } from "vitest";

import { setLangfuseClient } from "../client.js";
import { describeLangfuseConfig, getLangfuseConfig } from "../config.js";
import { compileTemplate, defineChatPrompt, getChatPrompt, seedChatPrompt } from "../prompts.js";

describe("getLangfuseConfig", () => {
  it("is disabled without keys and uses sensible defaults", () => {
    const config = getLangfuseConfig({});
    expect(config.enabled).toBe(false);
    expect(config.baseUrl).toBe("https://cloud.langfuse.com");
    expect(config.environment).toBe("development");
    expect(describeLangfuseConfig(config)).toContain("disabled");
  });

  it("treats the .env.example placeholders as missing", () => {
    for (const env of [
      { LANGFUSE_PUBLIC_KEY: "<your-langfuse-public-key>", LANGFUSE_SECRET_KEY: "<your-langfuse-secret-key>" },
      { LANGFUSE_PUBLIC_KEY: "pk-lf-...", LANGFUSE_SECRET_KEY: "sk-lf-..." },
    ]) {
      const config = getLangfuseConfig(env);
      expect(config.enabled).toBe(false);
      expect(config.publicKey).toBeUndefined();
    }
  });

  it("is enabled with real-looking keys and never prints the secret", () => {
    const config = getLangfuseConfig({
      LANGFUSE_PUBLIC_KEY: "pk-lf-1234567890",
      LANGFUSE_SECRET_KEY: "sk-lf-supersecret",
      LANGFUSE_BASE_URL: "https://us.cloud.langfuse.com",
      LANGFUSE_TRACING_ENVIRONMENT: "staging",
    });
    expect(config.enabled).toBe(true);
    expect(config.environment).toBe("staging");
    const description = describeLangfuseConfig(config);
    expect(description).toContain("us.cloud.langfuse.com");
    expect(description).not.toContain("supersecret");
  });
});

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
