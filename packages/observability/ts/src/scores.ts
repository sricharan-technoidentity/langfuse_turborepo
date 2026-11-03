import { getLangfuseClient } from "@repo/langfuse";

/**
 * Scores = evaluations attached to traces or observations.
 * Use them for user feedback (thumbs up/down), automated checks inside your app,
 * and LLM-as-a-judge results. All helpers are no-ops when Langfuse is disabled.
 */

export type ScoreDataType = "NUMERIC" | "BOOLEAN" | "CATEGORICAL";

export interface ScoreOptions {
  comment?: string;
  dataType?: ScoreDataType;
  metadata?: Record<string, unknown>;
}

/** Scores the trace that is currently active (call from inside an observation). */
export function scoreCurrentTrace(name: string, value: number | string, options: ScoreOptions = {}): void {
  getLangfuseClient()?.score.activeTrace({
    name,
    value,
    comment: options.comment,
    dataType: options.dataType ?? (typeof value === "string" ? "CATEGORICAL" : "NUMERIC"),
    metadata: options.metadata,
  });
}

/** Scores any trace by ID, e.g. when feedback arrives in a later HTTP request. */
export function scoreTrace(
  traceId: string,
  name: string,
  value: number | string,
  options: ScoreOptions = {},
): void {
  getLangfuseClient()?.score.create({
    traceId,
    name,
    value,
    comment: options.comment,
    dataType: options.dataType ?? (typeof value === "string" ? "CATEGORICAL" : "NUMERIC"),
    metadata: options.metadata,
  });
}

/** Records end-user feedback as a BOOLEAN score named "user_feedback". */
export function recordUserFeedback(input: { traceId: string; positive: boolean; comment?: string }): void {
  scoreTrace(input.traceId, "user_feedback", input.positive ? 1 : 0, {
    dataType: "BOOLEAN",
    comment: input.comment,
  });
}
