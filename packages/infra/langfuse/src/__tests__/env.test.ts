import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const KEYS = ["REPO_ENV_APP", "REPO_ENV_INFRA", "REPO_ENV_BOTH", "REPO_ENV_REAL", "REPO_ENV_OUTSIDE"];

async function freshLoadEnv() {
  vi.resetModules();
  return (await import("../env.js")).loadEnv;
}

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe("loadEnv", () => {
  it("loads the app/root .env first, then packages/infra/.env, never overwriting", async () => {
    const root = mkdtempSync(join(tmpdir(), "repo-"));
    writeFileSync(join(root, "turbo.json"), "{}");
    writeFileSync(join(root, ".env"), "REPO_ENV_APP=root\nREPO_ENV_BOTH=root\nREPO_ENV_REAL=file\n");
    mkdirSync(join(root, "packages", "infra"), { recursive: true });
    const infraEnv = join(root, "packages", "infra", ".env");
    writeFileSync(infraEnv, "REPO_ENV_INFRA=infra\nREPO_ENV_BOTH=infra\n");
    const app = join(root, "apps", "web");
    mkdirSync(app, { recursive: true });
    process.env.REPO_ENV_REAL = "real";

    const loadEnv = await freshLoadEnv();
    expect(loadEnv(app, infraEnv)).toEqual([join(root, ".env"), infraEnv]);
    expect(process.env.REPO_ENV_APP).toBe("root");
    expect(process.env.REPO_ENV_INFRA).toBe("infra");
    expect(process.env.REPO_ENV_BOTH).toBe("root");
    expect(process.env.REPO_ENV_REAL).toBe("real");
  });

  it("stops at the repo root and skips missing files", async () => {
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    writeFileSync(join(outside, ".env"), "REPO_ENV_OUTSIDE=1\n");
    const repo = join(outside, "repo");
    mkdirSync(repo);
    writeFileSync(join(repo, "pnpm-workspace.yaml"), "packages: []\n");

    const loadEnv = await freshLoadEnv();
    expect(loadEnv(repo, join(repo, "packages", "infra", ".env"))).toEqual([]);
    expect(process.env.REPO_ENV_OUTSIDE).toBeUndefined();
  });

  it("points at packages/infra/.env by default", async () => {
    vi.resetModules();
    const { INFRA_ENV_FILE } = await import("../env.js");
    expect(INFRA_ENV_FILE).toMatch(/packages[\\/]infra[\\/]\.env$/);
  });
});
