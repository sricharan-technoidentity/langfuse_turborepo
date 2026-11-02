import { getLangfuseClient } from "./client.js";

/**
 * Prompt management.
 *
 * Every prompt is defined in code (the "local definition") and can also live in
 * Langfuse. At runtime we fetch the Langfuse version (label "production" by
 * default) so prompts can be edited in the Langfuse UI without a redeploy. The
 * local definition is the fallback when Langfuse is disabled or unreachable,
 * and the source for `seedChatPrompt()`, which pushes it to Langfuse.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatPromptDefinition<TConfig extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  messages: ChatMessage[];
  /** Model settings stored alongside the prompt (model name, temperature...). */
  config: TConfig;
  commitMessage?: string;
}

/** Links a generation to the prompt version that produced it (shown in Langfuse). */
export interface PromptLink {
  name: string;
  version: number;
  isFallback: boolean;
}

export interface ResolvedChatPrompt<TConfig extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  /** Langfuse version number, or null when the local fallback is used. */
  version: number | null;
  isFallback: boolean;
  /** Local config merged with the config stored in Langfuse (Langfuse wins). */
  config: TConfig;
  /** Fills in {{variables}} and returns ready-to-send messages. */
  compile(variables?: Record<string, string>): ChatMessage[];
  /** Pass to a generation so Langfuse links it to this prompt version. Undefined for fallbacks. */
  link: PromptLink | undefined;
}

export function defineChatPrompt<TConfig extends Record<string, unknown>>(
  definition: ChatPromptDefinition<TConfig>,
): ChatPromptDefinition<TConfig> {
  return definition;
}

/** Same {{variable}} syntax as Langfuse; unknown variables are left untouched. */
export function compileTemplate(template: string, variables: Record<string, string> = {}): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key: string) => variables[key] ?? match);
}

function localPrompt<TConfig extends Record<string, unknown>>(
  definition: ChatPromptDefinition<TConfig>,
): ResolvedChatPrompt<TConfig> {
  return {
    name: definition.name,
    version: null,
    isFallback: true,
    config: definition.config,
    compile: (variables) =>
      definition.messages.map((m) => ({ role: m.role, content: compileTemplate(m.content, variables) })),
    link: undefined,
  };
}

export interface GetPromptOptions {
  /** Langfuse label to fetch (default "production"). */
  label?: string;
  /** Client-side cache; prompts are refreshed in the background after this (default 60s). */
  cacheTtlSeconds?: number;
}

export async function getChatPrompt<TConfig extends Record<string, unknown>>(
  definition: ChatPromptDefinition<TConfig>,
  options: GetPromptOptions = {},
): Promise<ResolvedChatPrompt<TConfig>> {
  const client = getLangfuseClient();
  if (!client) return localPrompt(definition);

  const prompt = await client.prompt.get(definition.name, {
    type: "chat",
    label: options.label ?? "production",
    cacheTtlSeconds: options.cacheTtlSeconds ?? 60,
    fallback: definition.messages,
    maxRetries: 1,
  });

  const remoteConfig =
    prompt.config && typeof prompt.config === "object" ? (prompt.config as Partial<TConfig>) : {};

  return {
    name: prompt.name,
    version: prompt.isFallback ? null : prompt.version,
    isFallback: prompt.isFallback,
    config: { ...definition.config, ...remoteConfig },
    compile: (variables) => prompt.compile(variables) as ChatMessage[],
    link: prompt.isFallback
      ? undefined
      : { name: prompt.name, version: prompt.version, isFallback: false },
  };
}

export type SeedResult =
  | { name: string; status: "created"; version: number }
  | { name: string; status: "unchanged"; version: number }
  | { name: string; status: "skipped"; reason: string };

/**
 * Pushes a local prompt definition to Langfuse and labels it (default "production").
 * Creates a new version only when the messages or config differ from the current one,
 * so it's safe to run on every deploy.
 */
export async function seedChatPrompt(
  definition: ChatPromptDefinition,
  options: { labels?: string[] } = {},
): Promise<SeedResult> {
  const client = getLangfuseClient();
  if (!client) return { name: definition.name, status: "skipped", reason: "Langfuse disabled" };

  const labels = options.labels ?? ["production"];

  let current: { version: number; prompt: unknown; config?: unknown } | undefined;
  try {
    current = await client.api.prompts.get(definition.name, { label: labels[0] });
  } catch {
    current = undefined; // not found yet
  }

  // Compare only role + content: the SDK/API add fields such as `type: "chatmessage"`.
  const normalize = (messages: unknown) =>
    JSON.stringify(
      Array.isArray(messages)
        ? messages.map((m: { role?: unknown; content?: unknown }) => ({ role: m.role, content: m.content }))
        : messages,
    );

  if (
    current &&
    normalize(current.prompt) === normalize(definition.messages) &&
    JSON.stringify(current.config ?? {}) === JSON.stringify(definition.config)
  ) {
    return { name: definition.name, status: "unchanged", version: current.version };
  }

  const created = await client.prompt.create({
    name: definition.name,
    type: "chat",
    prompt: definition.messages,
    config: definition.config,
    labels,
    commitMessage: definition.commitMessage ?? "Seeded from repo",
  });
  return { name: definition.name, status: "created", version: created.version };
}
