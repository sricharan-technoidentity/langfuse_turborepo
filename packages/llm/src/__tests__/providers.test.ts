import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AnthropicChatModel,
  createChatModel,
  describeChatModel,
  OpenAIChatModel,
  resolveProvider,
  type LlmMessage,
} from "../index.js";

/**
 * The real provider SDKs are pointed at a local fake server, so these tests check the
 * exact request we send and how we read the response — without API keys or cost.
 */

interface Recorded {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}

let server: Server;
let baseUrl: string;
let requests: Recorded[] = [];
let responder: (req: Recorded) => { status?: number; body: unknown };

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const recorded: Recorded = {
      path: req.url ?? "",
      headers: req.headers,
      body: chunks.length ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>) : {},
    };
    requests.push(recorded);
    const { status = 200, body } = responder(recorded);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  requests = [];
});

const conversation: LlmMessage[] = [
  { role: "system", content: "Be brief." },
  { role: "user", content: "Hi" },
  { role: "assistant", content: "Hello!" },
  { role: "user", content: "Capital of France?" },
];

describe("OpenAIChatModel", () => {
  const openaiReply = (content: string, finish = "stop") => ({
    body: {
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 0,
      model: "gpt-6-luna-2026-09-22",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finish }],
      usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
    },
  });

  it("sends messages, temperature and max_completion_tokens, and reads content + usage", async () => {
    responder = () => openaiReply("Paris.");
    const model = new OpenAIChatModel({ apiKey: "sk-test", baseURL: `${baseUrl}/v1`, maxRetries: 0 });

    const res = await model.complete({ messages: conversation, temperature: 0.2, maxTokens: 256 });

    const [req] = requests;
    expect(req?.path).toBe("/v1/chat/completions");
    expect(req?.headers.authorization).toBe("Bearer sk-test");
    expect(req?.body).toEqual({
      model: "gpt-6-luna",
      temperature: 0.2,
      max_completion_tokens: 256,
      messages: conversation,
    });
    expect(res).toEqual({
      model: "gpt-6-luna-2026-09-22",
      content: "Paris.",
      finishReason: "stop",
      usage: { input: 42, output: 7, total: 49 },
    });
  });

  it("reports truncated answers as finishReason 'length'", async () => {
    responder = () => openaiReply("Par", "length");
    const model = new OpenAIChatModel({ apiKey: "sk-test", baseURL: `${baseUrl}/v1`, maxRetries: 0 });
    expect((await model.complete({ messages: conversation, maxTokens: 1 })).finishReason).toBe("length");
  });

  it("retries without temperature when the model only allows the default", async () => {
    responder = (req) =>
      "temperature" in req.body
        ? {
            status: 400,
            body: { error: { message: "Unsupported value: 'temperature' does not support 0.2 with this model.", type: "invalid_request_error" } },
          }
        : openaiReply("ok");
    const model = new OpenAIChatModel({ apiKey: "sk-test", baseURL: `${baseUrl}/v1`, maxRetries: 0 });
    const res = await model.complete({ messages: [{ role: "user", content: "hi" }], temperature: 0.2 });
    expect(res.content).toBe("ok");
    expect(requests).toHaveLength(2);
    expect(requests[1]?.body).not.toHaveProperty("temperature");
  });
});

describe("AnthropicChatModel", () => {
  const anthropicReply = (text: string, stop = "end_turn") => ({
    body: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-haiku-5-5",
      content: [{ type: "text", text }],
      stop_reason: stop,
      stop_sequence: null,
      usage: { input_tokens: 30, output_tokens: 5 },
    },
  });

  it("moves system prompts to the system field and never sends temperature", async () => {
    responder = () => anthropicReply("Paris.");
    const model = new AnthropicChatModel({ apiKey: "sk-ant-test", baseURL: baseUrl, maxRetries: 0 });

    const res = await model.complete({ messages: conversation, temperature: 0.2 });

    const [req] = requests;
    expect(req?.path).toBe("/v1/messages");
    expect(req?.headers.authorization).toBe("Bearer sk-ant-test");
    expect(req?.headers["anthropic-version"]).toBeDefined();
    expect(req?.body).toEqual({
      model: "claude-haiku-5-5",
      max_tokens: 1024,
      system: "Be brief.",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
        { role: "user", content: "Capital of France?" },
      ],
    });
    expect(res).toEqual({ model: "claude-haiku-5-5", content: "Paris.", finishReason: "stop", usage: { input: 30, output: 5, total: 35 } });
    expect(model.supportsTemperature).toBe(false);
  });

  it("honours maxTokens and reports truncation", async () => {
    responder = () => anthropicReply("Pa", "max_tokens");
    const model = new AnthropicChatModel({ apiKey: "sk-ant-test", baseURL: baseUrl, maxRetries: 0 });
    const res = await model.complete({ messages: [{ role: "user", content: "Hi" }], maxTokens: 2 });
    expect(requests[0]?.body.max_tokens).toBe(2);
    expect(requests[0]?.body).not.toHaveProperty("system");
    expect(res.finishReason).toBe("length");
  });
});

describe("createChatModel", () => {
  it("auto-selects OpenAI, then Claude, then the mock", () => {
    expect(resolveProvider({})).toBe("mock");
    expect(resolveProvider({ ANTHROPIC_API_KEY: "sk-ant-x" })).toBe("anthropic");
    expect(resolveProvider({ OPENAI_API_KEY: "sk-x", ANTHROPIC_API_KEY: "sk-ant-x" })).toBe("openai");
    expect(resolveProvider({ LLM_PROVIDER: "anthropic", OPENAI_API_KEY: "sk-x", ANTHROPIC_API_KEY: "sk-ant-x" })).toBe("anthropic");
    expect(resolveProvider({ LLM_PROVIDER: "mock", OPENAI_API_KEY: "sk-x" })).toBe("mock");
  });

  it("treats the .env.example placeholders as missing keys", () => {
    expect(resolveProvider({ OPENAI_API_KEY: "<your-openai-api-key>", ANTHROPIC_API_KEY: "<your-anthropic-api-key>" })).toBe("mock");
  });

  it("builds the right model with custom model names", () => {
    const openai = createChatModel({ OPENAI_API_KEY: "sk-x", OPENAI_MODEL: "gpt-6-sol" });
    expect(openai.provider).toBe("openai");
    expect(openai.model).toBe("gpt-6-sol");
    expect(describeChatModel(openai)).toBe("LLM: OpenAI → gpt-6-sol");

    const claude = createChatModel({ ANTHROPIC_API_KEY: "sk-ant-x" });
    expect(claude.model).toBe("claude-haiku-5-5");
    expect(describeChatModel(claude)).toBe("LLM: Anthropic (Claude) → claude-haiku-5-5");

    expect(createChatModel({}).provider).toBe("mock");
  });

  it("fails clearly when a provider is forced without its key", () => {
    expect(() => createChatModel({ LLM_PROVIDER: "openai" })).toThrow(/OPENAI_API_KEY is not set/);
    expect(() => createChatModel({ LLM_PROVIDER: "claude" })).toThrow(/LLM_PROVIDER must be one of/);
  });
});
