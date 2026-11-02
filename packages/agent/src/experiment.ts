import {
  runExperiment,
  type ExperimentItem,
  type ExperimentSummary,
  type ItemEvaluator,
  type RunEvaluator,
} from "@repo/langfuse";

import type { Agent, RunInput, RunResult } from "./agent.js";

export interface AgentExperimentConfig<E> {
  /** Experiment name in Langfuse (default: "<agent name> experiment"). */
  name?: string;
  description?: string;
  /** Test cases. `input` is a plain message string or a full RunInput (variables, history…). */
  data: ExperimentItem<string | RunInput, E>[];
  evaluators?: ItemEvaluator<string | RunInput, E, RunResult>[];
  runEvaluators?: RunEvaluator<string | RunInput, E, RunResult>[];
  maxConcurrency?: number;
}

/**
 * Runs an agent over a test set and scores every output.
 * With Langfuse keys the run appears under Experiments (pass `datasetName` to also store
 * the test cases as a Langfuse dataset); without keys it runs locally.
 */
export function runAgentExperiment<E>(
  agent: Agent,
  config: AgentExperimentConfig<E>,
  options: { datasetName?: string } = {},
): Promise<ExperimentSummary<string | RunInput, E, RunResult>> {
  return runExperiment(
    {
      name: config.name ?? `${agent.name} experiment`,
      description: config.description,
      metadata: { agent: agent.name, provider: agent.model.provider, model: agent.model.model, prompt: agent.prompt.name },
      data: config.data,
      task: ({ input }) => agent.run(typeof input === "string" ? { message: input, tags: ["experiment"] } : { ...input, tags: [...(input.tags ?? []), "experiment"] }),
      evaluators: config.evaluators,
      runEvaluators: config.runEvaluators,
      maxConcurrency: config.maxConcurrency,
    },
    options,
  );
}
