export const DEFAULT_LANGFUSE_BASE_URL = "https://cloud.langfuse.com";

export interface LangfuseConfig {
  /** True when both API keys are present and look real (not the .env.example placeholders). */
  enabled: boolean;
  publicKey?: string;
  secretKey?: string;
  baseUrl: string;
  /** Shown as the environment filter in Langfuse (development, staging, production...). */
  environment: string;
  /** Optional release/version tag attached to every trace, e.g. a git SHA. */
  release?: string;
}

/** Template values like "<your-langfuse-public-key>" or "pk-lf-..." count as unset. */
const PLACEHOLDER = /^<.*>$|\.\.\.$/;

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || PLACEHOLDER.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Reads Langfuse settings from environment variables.
 * Uses the same variable names as the official Langfuse SDKs.
 */
export function getLangfuseConfig(env: NodeJS.ProcessEnv = process.env): LangfuseConfig {
  const publicKey = clean(env.LANGFUSE_PUBLIC_KEY);
  const secretKey = clean(env.LANGFUSE_SECRET_KEY);

  return {
    enabled: Boolean(publicKey?.startsWith("pk-lf-") && secretKey?.startsWith("sk-lf-")),
    publicKey,
    secretKey,
    baseUrl: clean(env.LANGFUSE_BASE_URL) ?? DEFAULT_LANGFUSE_BASE_URL,
    environment: clean(env.LANGFUSE_TRACING_ENVIRONMENT) ?? "development",
    release: clean(env.LANGFUSE_RELEASE),
  };
}

export function isLangfuseEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return getLangfuseConfig(env).enabled;
}

/** A one-line, secret-free description of the current setup, for startup logs. */
export function describeLangfuseConfig(config: LangfuseConfig = getLangfuseConfig()): string {
  if (!config.enabled) {
    return "Langfuse: disabled (set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in packages/infra/.env to send traces)";
  }
  const key = config.publicKey ? `${config.publicKey.slice(0, 10)}…` : "?";
  return `Langfuse: enabled → ${config.baseUrl} (env: ${config.environment}, key: ${key})`;
}
