import { asQueryResult, queryOutputSchema, validateQueryResultShape } from "./bundle-schema";
import { readLatestCheckpoint, readHistoryEvents } from "./history-store";
import { buildQueryPrompt } from "./prompt-builder";
import { invokeProvider } from "./provider-adapters";
import { readState } from "./state-store";
import type {
  AgentMemoryBundle,
  HistoryEvent,
  QueryOptions,
  QueryResult,
  QueryShortlistItem,
} from "../types";

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function scoreText(questionTokens: string[], content: string, summary: string): number {
  const haystack = `${summary}\n${content}`.toLowerCase();
  let score = 0;
  for (const token of questionTokens) {
    if (haystack.includes(token)) {
      score += 1;
    }
  }
  return score;
}

function bundleShortlist(bundle: AgentMemoryBundle): QueryShortlistItem[] {
  return [
    {
      sourceType: "bundle",
      sourceId: "project",
      pathOrSection: "bundle.project",
      summary: bundle.project.summary,
      content: [
        bundle.project.summary,
        ...bundle.project.keyPaths,
      ].join("\n"),
    },
    {
      sourceType: "bundle",
      sourceId: "project-map",
      pathOrSection: "bundle.projectMap",
      summary: bundle.projectMap.architectureNotes[0] ?? "Project map details",
      content: [
        ...bundle.projectMap.architectureNotes,
        ...bundle.projectMap.modules.map((module) => `${module.path}: ${module.responsibility}`),
        ...bundle.projectMap.entrypoints.map((entrypoint) => `${entrypoint.path}: ${entrypoint.role}`),
      ].join("\n"),
    },
    {
      sourceType: "bundle",
      sourceId: "current-focus",
      pathOrSection: "bundle.currentFocus",
      summary: bundle.currentFocus.summary,
      content: [
        bundle.currentFocus.summary,
        ...bundle.currentFocus.currentState,
        ...bundle.currentFocus.knownRisks,
        bundle.currentFocus.validationSnapshot.summary,
      ].join("\n"),
    },
    ...bundle.gotchas.map((gotcha, index) => ({
      sourceType: "bundle" as const,
      sourceId: `gotcha-${index + 1}`,
      pathOrSection: `bundle.gotchas[${index}]`,
      summary: gotcha.title,
      content: [gotcha.title, gotcha.symptom, gotcha.cause, gotcha.correctPath].join("\n"),
    })),
    ...bundle.nextSteps.map((step, index) => ({
      sourceType: "bundle" as const,
      sourceId: `next-step-${index + 1}`,
      pathOrSection: `bundle.nextSteps[${index}]`,
      summary: step.title,
      content: [step.title, step.why, step.start, step.done].join("\n"),
    })),
  ];
}

function historyShortlist(events: HistoryEvent[]): QueryShortlistItem[] {
  return events.map((event) => ({
    sourceType: "event" as const,
    sourceId: event.id,
    pathOrSection: event.sourceRef,
    summary: event.summary,
    content: [
      event.summary,
      ...event.signals.decisions,
      ...event.signals.gotchas,
      ...event.signals.nextStepHints,
      ...event.signals.keyPaths,
      ...event.signals.validationObservations,
    ].join("\n"),
  }));
}

export async function runQuery(options: QueryOptions): Promise<QueryResult> {
  const state = await readState(options.cwd);
  const events = await readHistoryEvents(options.cwd);
  const checkpoint = await readLatestCheckpoint(options.cwd, state.maintenance.latestCheckpointId);
  const questionTokens = tokenize(options.question);

  let items: QueryShortlistItem[] = [];
  if (options.scope === "state" || options.scope === "all") {
    items.push(...bundleShortlist(state.bundle));
    if (checkpoint) {
      items.push({
        sourceType: "checkpoint",
        sourceId: checkpoint.id,
        pathOrSection: ".agent-memory/history/checkpoints",
        summary: checkpoint.summary,
        content: checkpoint.summary,
      });
    }
  }

  if (options.scope === "history" || options.scope === "all") {
    items.push(...historyShortlist(events.slice(-50)));
  }

  items = items
    .map((item) => ({ ...item, score: scoreText(questionTokens, item.content, item.summary) }))
    .sort((left, right) => right.score - left.score || left.sourceId.localeCompare(right.sourceId))
    .slice(0, 8)
    .map(({ score: _score, ...item }) => item);

  const result = await invokeProvider(options.provider, {
    cwd: options.cwd,
    prompt: buildQueryPrompt(options.question, options.scope, items),
    schema: queryOutputSchema,
  });

  const errors = validateQueryResultShape(result.parsed);
  if (errors.length > 0) {
    throw new Error(`Query returned an invalid result: ${errors.join(" ")}`);
  }

  const parsed = asQueryResult(result.parsed);
  if (!parsed) {
    throw new Error("Query did not return a valid result.");
  }

  return parsed;
}
