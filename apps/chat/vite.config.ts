import { spawn } from "node:child_process";

import { loadEnv as loadRepoEnv } from "@repo/langfuse";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Same .env files as the API server, so PORT matches for the proxy. Vite only exposes VITE_* vars to the browser.
loadRepoEnv();
const apiPort = process.env.PORT || "3000";

/** `vite` (dev) also runs the API server, restarting it when server files change. */
const apiServer = (): Plugin => ({
  name: "chat-api-server",
  apply: (_, { command, mode }) => command === "serve" && mode !== "test",
  configureServer(server) {
    const api = spawn(process.execPath, ["--experimental-strip-types", "--watch", "src/server/main.ts"], {
      stdio: "inherit",
      env: { ...process.env, PORT: apiPort },
    });
    const stop = () => api.kill("SIGTERM");
    server.httpServer?.once("close", stop);
    process.once("exit", stop);
  },
});

export default defineConfig({
  plugins: [react(), apiServer()],
  build: { outDir: "dist/client", emptyOutDir: true },
  server: { proxy: { "/api": `http://localhost:${apiPort}` } },
});
