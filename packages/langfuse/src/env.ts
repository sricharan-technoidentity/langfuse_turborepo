import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

let loadedFrom: string | null | undefined;

/**
 * Loads the nearest `.env` file, walking up from `startDir` until it finds one
 * or reaches the monorepo root (the folder containing `pnpm-workspace.yaml` or `turbo.json`).
 *
 * Variables that are already set in the environment are never overwritten,
 * so real environment variables (CI, Docker, etc.) always win over the file.
 *
 * Returns the path that was loaded, or null if no `.env` file was found.
 */
export function loadEnv(startDir: string = process.cwd()): string | null {
  if (loadedFrom !== undefined) return loadedFrom;

  let dir = startDir;
  while (true) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      loadedFrom = candidate;
      return candidate;
    }
    const isWorkspaceRoot = existsSync(join(dir, "pnpm-workspace.yaml")) || existsSync(join(dir, "turbo.json"));
    const parent = dirname(dir);
    if (isWorkspaceRoot || parent === dir) break;
    dir = parent;
  }

  loadedFrom = null;
  return null;
}
