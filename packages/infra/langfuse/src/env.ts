import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The shared infra env file: packages/infra/.env (next to .env.example). */
export const INFRA_ENV_FILE = fileURLToPath(new URL("../../.env", import.meta.url));

let loaded: string[] | undefined;

/** Nearest `.env` walking up from `startDir`, stopping at the monorepo root (`pnpm-workspace.yaml` or `turbo.json`). */
function findNearestEnv(startDir: string): string | undefined {
  for (let dir = startDir; ; dir = dirname(dir)) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    if (existsSync(join(dir, "pnpm-workspace.yaml")) || existsSync(join(dir, "turbo.json")) || dirname(dir) === dir) {
      return undefined;
    }
  }
}

/**
 * Loads env files, highest priority first (a variable is never overwritten once set):
 *   1. real environment variables (CI, Docker…)
 *   2. the nearest `.env` walking up from `startDir` (your app folder or the repo root)
 *   3. `packages/infra/.env`, the shared infra config
 *
 * Returns the files that were loaded.
 */
export function loadEnv(startDir: string = process.cwd(), infraEnvFile: string = INFRA_ENV_FILE): string[] {
  if (loaded) return loaded;
  const nearest = findNearestEnv(startDir);
  loaded = [...new Set([nearest, infraEnvFile])].filter((f): f is string => f !== undefined && existsSync(f));
  for (const file of loaded) process.loadEnvFile(file);
  return loaded;
}
