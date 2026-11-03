import { MockChatModel } from "./mock-model.js";
import { AnthropicChatModel, DEFAULT_ANTHROPIC_MODEL } from "./providers/anthropic.js";
import { DEFAULT_OPENAI_MODEL, OpenAIChatModel } from "./providers/openai.js";
import type { ChatModel, ProviderName } from "./types.js";

/**
 * Picks the chat model from environment variables:
 *
 *   LLM_PROVIDER=auto (default)  → OpenAI if OPENAI_API_KEY is set, else Claude if
 *                                  ANTHROPIC_API_KEY is set, else the mock model
 *   LLM_PROVIDER=openai          → OpenAI (OPENAI_API_KEY required)
 *   LLM_PROVIDER=anthropic       → Claude (ANTHROPIC_API_KEY required)
 *   LLM_PROVIDER=mock            → mock model, no key needed
 *
 * Optional: OPENAI_MODEL, OPENAI_BASE_URL, ANTHROPIC_MODEL.
 */

export type ProviderSetting = ProviderName | "auto";

/** Treats empty values and template placeholders like "<your-openai-api-key>" as unset. */
function readKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.startsWith("<") || trimmed.endsWith("...")) return undefined;
  return trimmed;
}

function readSetting(value: string | undefined): ProviderSetting {
  const setting = (value?.trim().toLowerCase() || "auto") as ProviderSetting;
  if (!["auto", "openai", "anthropic", "mock"].includes(setting)) {
    throw new Error(`LLM_PROVIDER must be one of auto, openai, anthropic, mock (got "${value}")`);
  }
  return setting;
}

export function resolveProvider(env: NodeJS.ProcessEnv = process.env): ProviderName {
  const setting = readSetting(env.LLM_PROVIDER);
  if (setting !== "auto") return setting;
  if (readKey(env.OPENAI_API_KEY)) return "openai";
  if (readKey(env.ANTHROPIC_API_KEY)) return "anthropic";
  return "mock";
}

export function createChatModel(env: NodeJS.ProcessEnv = process.env): ChatModel {
  const provider = resolveProvider(env);

  if (provider === "openai") {
    const apiKey = readKey(env.OPENAI_API_KEY);
    if (!apiKey) throw new Error("LLM_PROVIDER=openai but OPENAI_API_KEY is not set. Add it to packages/infra/.env.");
    return new OpenAIChatModel({
      apiKey,
      model: env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
      baseURL: env.OPENAI_BASE_URL?.trim() || undefined,
    });
  }

  if (provider === "anthropic") {
    const apiKey = readKey(env.ANTHROPIC_API_KEY);
    if (!apiKey) throw new Error("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set. Add it to packages/infra/.env.");
    return new AnthropicChatModel({
      apiKey,
      model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL,
    });
  }

  return new MockChatModel();
}

/** One-line description for startup logs (never prints keys). */
export function describeChatModel(model: ChatModel): string {
  if (model.provider === "mock") {
    return "LLM: mock model (set OPENAI_API_KEY or ANTHROPIC_API_KEY in packages/infra/.env to use a real model)";
  }
  const label = model.provider === "openai" ? "OpenAI" : "Anthropic (Claude)";
  return `LLM: ${label} → ${model.model}`;
}
