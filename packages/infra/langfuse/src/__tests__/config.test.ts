import { describe, expect, it } from "vitest";

import { describeLangfuseConfig, getLangfuseConfig } from "../config.js";
import { createLangfuseSpanProcessor, LangfuseSpanProcessor } from "../tracing.js";

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
