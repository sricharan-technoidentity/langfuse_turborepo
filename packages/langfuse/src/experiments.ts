import { startActiveObservation } from "@langfuse/tracing";

import { getLangfuseClient } from "./client.js";
import type { ScoreDataType } from "./scores.js";

/**
 * Experiments = run your app over a fixed set of test cases and score every answer.
 *
 * - With Langfuse keys: uses the Langfuse experiment runner, so each item becomes a
 *   trace and results appear under Datasets / Experiments in the UI. Pass
 *   `datasetName` to store the test cases as a Langfuse dataset and link the run to it.
 * - Without keys: runs the same task + evaluators locally and returns the same summary.
 */

export interface ExperimentItem<I, E> {
  /** Stable ID, used to upsert the item when syncing to a Langfuse dataset. */
  id?: string;
  input: I;
  expectedOutput?: E;
  metadata?: Record<string, unknown>;
}

export interface Evaluation {
  name: string;
  value: number | string;
  comment?: string;
  /** Defaults to NUMERIC for numbers and CATEGORICAL for strings. */
  dataType?: ScoreDataType;
}

export type ItemEvaluator<I, E, O> = (params: {
  input: I;
  output: O;
  expectedOutput?: E;
  metadata?: Record<string, unknown>;
}) => Promise<Evaluation | Evaluation[]>;

export interface ItemResult<I, E, O> {
  input: I;
  expectedOutput?: E;
  output: O | undefined;
  evaluations: Evaluation[];
  traceId?: string;
  error?: string;
}

export type RunEvaluator<I, E, O> = (params: {
  itemResults: ItemResult<I, E, O>[];
}) => Promise<Evaluation | Evaluation[]>;

export interface ExperimentConfig<I, E, O> {
  name: string;
  description?: string;
  /** Stored on the experiment run in Langfuse (e.g. which model/provider was used). */
  metadata?: Record<string, unknown>;
  data: ExperimentItem<I, E>[];
  task: (item: { input: I; expectedOutput?: E; metadata?: Record<string, unknown> }) => Promise<O>;
  evaluators?: ItemEvaluator<I, E, O>[];
  runEvaluators?: RunEvaluator<I, E, O>[];
  maxConcurrency?: number;
}

export interface ExperimentSummary<I, E, O> {
  name: string;
  runName: string;
  mode: "langfuse" | "langfuse-dataset" | "local";
  url?: string;
  items: ItemResult<I, E, O>[];
  runEvaluations: Evaluation[];
  /** Mean of every numeric item-level evaluation, by name. */
  averages: Record<string, number>;
}

const asArray = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);

function averageByName(items: { evaluations: Evaluation[] }[]): Record<string, number> {
  const totals = new Map<string, { sum: number; count: number }>();
  for (const item of items) {
    for (const e of item.evaluations) {
      if (typeof e.value !== "number") continue;
      const t = totals.get(e.name) ?? { sum: 0, count: 0 };
      t.sum += e.value;
      t.count += 1;
      totals.set(e.name, t);
    }
  }
  return Object.fromEntries([...totals].map(([name, t]) => [name, t.sum / t.count]));
}

async function runLocally<I, E, O>(config: ExperimentConfig<I, E, O>): Promise<ExperimentSummary<I, E, O>> {
  const runName = `${config.name} - ${new Date().toISOString()}`;
  const items: ItemResult<I, E, O>[] = [];

  for (const item of config.data) {
    try {
      const output = await startActiveObservation(`experiment-item: ${config.name}`, async (span) => {
        span.update({ input: item.input });
        const result = await config.task(item);
        span.update({ output: result });
        return result;
      });
      const evaluations: Evaluation[] = [];
      for (const evaluator of config.evaluators ?? []) {
        evaluations.push(...asArray(await evaluator({ ...item, output })));
      }
      items.push({ input: item.input, expectedOutput: item.expectedOutput, output, evaluations });
    } catch (error) {
      items.push({
        input: item.input,
        expectedOutput: item.expectedOutput,
        output: undefined,
        evaluations: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const runEvaluations: Evaluation[] = [];
  for (const evaluator of config.runEvaluators ?? []) {
    runEvaluations.push(...asArray(await evaluator({ itemResults: items })));
  }

  return { name: config.name, runName, mode: "local", items, runEvaluations, averages: averageByName(items) };
}

/** Creates the dataset if needed and upserts every item (by ID), so re-running is safe. */
export async function syncDataset<I, E>(
  datasetName: string,
  data: ExperimentItem<I, E>[],
  description?: string,
): Promise<void> {
  const client = getLangfuseClient();
  if (!client) return;

  try {
    await client.api.datasets.get(datasetName);
  } catch {
    await client.api.datasets.create({ name: datasetName, description });
  }

  for (const [index, item] of data.entries()) {
    await client.api.datasetItems.create({
      datasetName,
      id: item.id ?? `${datasetName}-${index}`,
      input: item.input,
      expectedOutput: item.expectedOutput,
      metadata: item.metadata,
    });
  }
}

export async function runExperiment<I, E, O>(
  config: ExperimentConfig<I, E, O>,
  options: { datasetName?: string } = {},
): Promise<ExperimentSummary<I, E, O>> {
  const client = getLangfuseClient();
  if (!client) return runLocally(config);

  // The Langfuse runner passes items through as-is; our types are a compatible subset.
  const shared = {
    name: config.name,
    description: config.description,
    metadata: config.metadata,
    task: config.task as (item: unknown) => Promise<O>,
    evaluators: config.evaluators as never,
    runEvaluators: config.runEvaluators as never,
    maxConcurrency: config.maxConcurrency ?? 4,
  };

  let mode: ExperimentSummary<I, E, O>["mode"] = "langfuse";
  let result;
  if (options.datasetName) {
    await syncDataset(options.datasetName, config.data, config.description);
    const dataset = await client.dataset.get(options.datasetName);
    result = await dataset.runExperiment(shared);
    mode = "langfuse-dataset";
  } else {
    result = await client.experiment.run({ ...shared, data: config.data });
  }

  // The original item lives on `r.item` (top-level input/expectedOutput may be absent).
  const items: ItemResult<I, E, O>[] = result.itemResults.map((r) => ({
    input: (r.item?.input ?? r.input) as I,
    expectedOutput: (r.item?.expectedOutput ?? r.expectedOutput) as E | undefined,
    output: r.output as O,
    evaluations: r.evaluations.map((e) => ({
      name: e.name,
      value: e.value as number | string,
      comment: e.comment ?? undefined,
    })),
    traceId: r.traceId,
  }));

  return {
    name: config.name,
    runName: result.runName,
    mode,
    url: result.datasetRunUrl ?? result.experimentUrl,
    items,
    runEvaluations: result.runEvaluations.map((e) => ({
      name: e.name,
      value: e.value as number | string,
      comment: e.comment ?? undefined,
    })),
    averages: averageByName(items),
  };
}
