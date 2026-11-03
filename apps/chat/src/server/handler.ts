import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

import type { Agent } from "@repo/agent";
import type { LlmMessage } from "@repo/llm";

export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_MESSAGE_CHARS = 8000;
export const MAX_HISTORY_TURNS = 100;
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const TRACE_ID = /^[0-9a-f]{32}$/;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

export interface HandlerDeps {
  agent: Pick<Agent, "run">;
  getTraceUrl: (traceId: string | undefined) => Promise<string | null>;
  recordFeedback: (input: { traceId: string; positive: boolean }) => void;
  /** Built client (Vite output). Omit to serve the API only. */
  clientDir?: string;
}

class HttpError extends Error {
  readonly status: number;
  readonly headers: Record<string, string>;
  constructor(status: number, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

const bad = (message: string) => new HttpError(400, message);
// The request body is left unread, so the socket can't be reused for the next request.
const rejectUnread = (status: number, message: string) => new HttpError(status, message, { Connection: "close" });

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  res.writeHead(status, {
    "X-Content-Type-Options": "nosniff",
    ...(payload !== undefined && { "Content-Type": "application/json; charset=utf-8" }),
    ...headers,
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  // Blocks cross-site form/text POSTs, which skip the CORS preflight.
  const mediaType = req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") throw rejectUnread(415, "Content-Type must be application/json");
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES) throw rejectUnread(400, "Request body too large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw rejectUnread(400, "Request body too large");
    chunks.push(chunk);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw bad("Invalid JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw bad("Body must be a JSON object");
  return body as Record<string, unknown>;
}

function parseChat(body: Record<string, unknown>) {
  const { message, history = [], sessionId } = body;
  if (typeof message !== "string" || !message.trim()) throw bad("message must be a non-empty string");
  if (message.length > MAX_MESSAGE_CHARS) throw bad(`message must be at most ${MAX_MESSAGE_CHARS} characters`);
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) throw bad("sessionId is missing or invalid");
  if (!Array.isArray(history)) throw bad("history must be an array");
  if (history.length > MAX_HISTORY_TURNS) throw bad(`history must have at most ${MAX_HISTORY_TURNS} turns`);
  // Only user/assistant turns: clients must not be able to inject system messages.
  const turns = history.map((turn: unknown): LlmMessage => {
    const { role, content } = (turn ?? {}) as Record<string, unknown>;
    if ((role === "user" || role === "assistant") && typeof content === "string") return { role, content };
    throw bad('history entries must be {role: "user" | "assistant", content: string}');
  });
  return { message, history: turns, sessionId };
}

function parseFeedback(body: Record<string, unknown>) {
  const { traceId, positive } = body;
  if (typeof traceId !== "string" || !TRACE_ID.test(traceId)) throw bad("traceId must be a 32-character hex string");
  if (typeof positive !== "boolean") throw bad("positive must be a boolean");
  return { traceId, positive };
}

async function serveStatic(clientDir: string, pathname: string, res: ServerResponse): Promise<void> {
  const root = resolve(clientDir);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw bad("Invalid path");
  }
  const file = resolve(root, `.${decoded}`);
  // Anything resolving outside the client dir (../, encoded slashes, NUL) gets the SPA page instead.
  const inside = !decoded.includes("\0") && file.startsWith(root + sep);
  const isFile = inside && (await stat(file).catch(() => null))?.isFile();
  const target = isFile ? file : resolve(root, "index.html");
  const content = await readFile(target).catch(() => null);
  if (!content) throw new HttpError(404, "Not found");
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[extname(target)] ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(content);
}

/** The whole HTTP app. Used by main.ts and, with a fake agent, by the tests. */
export function createHandler(deps: HandlerDeps) {
  const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => Promise<void>> = {
    "/api/chat": async (req, res) => {
      const input = parseChat(await readJson(req));
      let result;
      try {
        result = await deps.agent.run(input);
      } catch (error) {
        console.error("[chat] model call failed:", error);
        throw new HttpError(502, "The model request failed. Please try again.");
      }
      const traceId = result.traceId ?? null;
      send(res, 200, { output: result.output, traceId, traceUrl: await deps.getTraceUrl(result.traceId), model: result.model });
    },
    "/api/feedback": async (req, res) => {
      deps.recordFeedback(parseFeedback(await readJson(req)));
      send(res, 204);
    },
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const { pathname } = new URL(req.url ?? "/", "http://localhost");
      const route = routes[pathname];
      if (route) {
        if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" }, { Allow: "POST" });
        return await route(req, res);
      }
      if (pathname.startsWith("/api/") || !deps.clientDir) return send(res, 404, { error: "Not found" });
      if (req.method !== "GET" && req.method !== "HEAD") {
        return send(res, 405, { error: "Method not allowed" }, { Allow: "GET, HEAD" });
      }
      await serveStatic(deps.clientDir, pathname, res);
    } catch (error) {
      if (error instanceof HttpError) return send(res, error.status, { error: error.message }, error.headers);
      console.error("[chat] unexpected error:", error);
      if (!res.headersSent) send(res, 500, { error: "Internal server error" });
      else res.end();
    }
  };
}
