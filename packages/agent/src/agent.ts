import {
  getActiveTraceId,
  getChatPrompt,
  propagateAttributes,
  scoreCurrentTrace,
  startActiveObservation,
  type ChatPromptDefinition,
  type Evaluation,
} from "@repo/observability";
import { createChatModel, tracedCompletion, type ChatModel, type LlmMessage, type TokenUsage } from "@repo/llm";

export interface RunInput {
  /** Values for the {{placeholders}} in your prompt. */
  variables?: Record<string, string>;
  /** Appended as the final user message. */
  message?: string;
  /** Earlier conversation turns, inserted after the prompt's own messages. */
  history?: LlmMessage[];
  /** Langfuse user ID — enables per-user analytics. */
  userId?: string;
  /** Langfuse session ID — groups the traces of one conversation. */
  sessionId?: string;
  /** Extra Langfuse tags for this call. */
  tags?: string[];
  /** Extra metadata on the trace (string values, filterable in Langfuse). */
  metadata?: Record<string, string>;
}

export interface RunResult {
  output: string;
  /** Langfuse trace ID — hand it to clients so they can send feedback later. */
  traceId: string | undefined;
  /** "provider/model" that answered, e.g. "openai/gpt-6-luna-2026-09-22". */
  model: string;
  promptName: string;
  /** Langfuse prompt version, or null when the in-code fallback was used. */
  promptVersion: number | null;
  usage: TokenUsage;
  finishReason: string;
  latencyMs: number;
  /** Results of the agent's scorers (also attached to the trace as scores). */
  scores: Evaluation[];
}

/**
 * Online evaluation: runs after every call and is attached to the trace as a score.
 * Use it for cheap automatic checks (format, length, keywords) or an LLM judge.
 */
export type Scorer = (context: {
  input: RunInput;
  output: string;
  result: Omit<RunResult, "scores">;
}) => Evaluation | Evaluation[] | Promise<Evaluation | Evaluation[]>;

export interface AgentConfig {
  /** Name of the trace and root observation in Langfuse, e.g. "summarizer". */
  name: string;
  /** Your prompt. Fetched from Langfuse by name; this definition is the fallback and the seed. */
  prompt: ChatPromptDefinition;
  /** Langfuse prompt label to use (default "production"). */
  promptLabel?: string;
  /** Defaults to createChatModel(): OpenAI or Claude when a key is set, otherwise the mock. */
  model?: ChatModel;
  /** Online checks run after each call; results become trace scores. */
  scorers?: Scorer[];
  /** Tags added to every trace of this agent. */
  tags?: string[];
}

export interface Agent {
  readonly name: string;
  readonly model: ChatModel;
  readonly prompt: ChatPromptDefinition;
  run(input?: RunInput): Promise<RunResult>;
}

const asArray = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);
const numberOrUndefined = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/**
 * Creates a generic agent around one prompt. Each `run()` produces one Langfuse trace:
 *
 *   <name> (agent)                 input: variables + message · output: answer
 *   ├── llm-call (generation)      model, prompt version, parameters, usage, cost
 *   └── scorers (evaluator)        only when scorers are configured
 *
 * plus user/session/tags/metadata on every observation and one score per scorer result.
 * temperature / maxTokens are read from the prompt's config, so you can tune them in Langfuse.
 */
export function createAgent(config: AgentConfig): Agent {
  const model = config.model ?? createChatModel();

  async function execute(input: RunInput): Promise<RunResult> {
    return startActiveObservation(
      config.name,
      async (root) => {
        root.update({
          input: {
            variables: input.variables,
            message: input.message,
            historyTurns: input.history?.length ?? 0,
          },
        });
        const traceId = getActiveTraceId();

        const prompt = await getChatPrompt(config.prompt, { label: config.promptLabel });
        const messages: LlmMessage[] = [
          ...prompt.compile(input.variables),
          ...(input.history ?? []),
          ...(input.message !== undefined ? [{ role: "user" as const, content: input.message }] : []),
        ];
        if (!messages.some((m) => m.role === "user")) {
          throw new Error(
            `Agent "${config.name}" has no user message to send: pass \`message\` to run() or add a user message to the prompt.`,
          );
        }

        const started = performance.now();
        const response = await tracedCompletion(model, {
          name: "llm-call",
          messages,
          temperature: numberOrUndefined(prompt.config.temperature),
          maxTokens: numberOrUndefined(prompt.config.maxTokens),
          prompt: prompt.link,
        });
        const latencyMs = Math.round(performance.now() - started);
        const output = response.content.trim();

        const base: Omit<RunResult, "scores"> = {
          output,
          traceId,
          model: `${model.provider}/${response.model}`,
          promptName: prompt.name,
          promptVersion: prompt.version,
          usage: response.usage,
          finishReason: response.finishReason,
          latencyMs,
        };

        const scores = config.scorers?.length
          ? await startActiveObservation(
              "scorers",
              async (evaluator) => {
                const results: Evaluation[] = [];
                for (const scorer of config.scorers ?? []) {
                  try {
                    results.push(...asArray(await scorer({ input, output, result: base })));
                  } catch (error) {
                    console.warn(`[agent:${config.name}] scorer failed:`, error);
                  }
                }
                for (const s of results) {
                  scoreCurrentTrace(s.name, s.value, { comment: s.comment, dataType: s.dataType });
                }
                evaluator.update({ output: results });
                return results;
              },
              { asType: "evaluator" },
            )
          : [];

        root.update({
          output,
          metadata: {
            model: base.model,
            promptVersion: prompt.version,
            promptIsFallback: prompt.isFallback,
            finishReason: response.finishReason,
          },
        });
        return { ...base, scores };
      },
      { asType: "agent" },
    );
  }

  return {
    name: config.name,
    model,
    prompt: config.prompt,
    run(input = {}) {
      return propagateAttributes(
        {
          traceName: config.name,
          userId: input.userId,
          sessionId: input.sessionId,
          tags: [config.name, model.provider, ...(config.tags ?? []), ...(input.tags ?? [])],
          metadata: input.metadata,
        },
        () => execute(input),
      );
    },
  };
}
