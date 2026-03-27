import { asQueryResult, queryOutputSchema, validateCheckpointShape, validateQueryResultShape } from "./bundle-schema";
import { readHistoryEvents, readRecentCheckpoints } from "./history-store";
import { buildQueryPrompt } from "./prompt-builder";
import { invokeProvider } from "./provider-adapters";
import { readState } from "./state-store";
import type {
  AgentMemoryBundle,
  CheckpointState,
  HistoryEvent,
  QueryOptions,
  QueryResult,
  QueryShortlistItem,
} from "../types";

const MAX_SHORTLIST_ITEMS = 8;
const MAX_RECENT_CHECKPOINTS = 5;
const MIN_CONFIDENT_SCORE = 6;

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
    if (!haystack.includes(token)) {
      continue;
    }

    score += 4;
    if (summary.toLowerCase().includes(token)) {
      score += 2;
    }
  }
  return score;
}

function tokenMatchCount(questionTokens: string[], content: string, summary: string): number {
  const haystack = `${summary}\n${content}`.toLowerCase();
  let matches = 0;
  for (const token of questionTokens) {
    if (haystack.includes(token)) {
      matches += 1;
    }
  }
  return matches;
}

function sourceTypeWeight(sourceType: QueryShortlistItem["sourceType"]): number {
  switch (sourceType) {
    case "bundle":
      return 40;
    case "checkpoint":
      return 24;
    case "event":
      return 12;
    default:
      return 0;
  }
}

function recencyWeight(timestamp: string | null): number {
  if (!timestamp) {
    return 0;
  }

  const delta = Date.now() - Date.parse(timestamp);
  if (Number.isNaN(delta)) {
    return 0;
  }

  const day = 24 * 60 * 60 * 1000;
  if (delta <= day) {
    return 18;
  }
  if (delta <= 7 * day) {
    return 12;
  }
  if (delta <= 30 * day) {
    return 6;
  }

  return 0;
}

function checkpointProximityWeight(sourceType: QueryShortlistItem["sourceType"], sourceId: string): number {
  if (sourceType !== "checkpoint") {
    return 0;
  }

  const numeric = Number((sourceId.match(/^chk-(\d+)$/) ?? [])[1] ?? 0);
  return numeric > 0 ? 8 : 0;
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
      createdAt: null,
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
      createdAt: null,
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
      createdAt: bundle.currentFocus.validationSnapshot.validatedAt,
    },
    ...bundle.gotchas.map((gotcha, index) => ({
      sourceType: "bundle" as const,
      sourceId: `gotcha-${index + 1}`,
      pathOrSection: `bundle.gotchas.${gotcha.title}`,
      summary: gotcha.title,
      content: [gotcha.title, gotcha.symptom, gotcha.cause, gotcha.correctPath].join("\n"),
      createdAt: null,
    })),
    ...bundle.nextSteps.map((step, index) => ({
      sourceType: "bundle" as const,
      sourceId: `next-step-${index + 1}`,
      pathOrSection: `bundle.nextSteps.${step.title}`,
      summary: step.title,
      content: [step.title, step.why, step.start, step.done].join("\n"),
      createdAt: null,
    })),
  ];
}

function historyShortlist(events: HistoryEvent[]): QueryShortlistItem[] {
  return events.map((event) => ({
    sourceType: "event" as const,
    sourceId: event.id,
    pathOrSection: `event:${event.id}`,
    summary: event.summary,
    content: [
      event.summary,
      ...event.signals.decisions,
      ...event.signals.gotchas,
      ...event.signals.nextStepHints,
      ...event.signals.keyPaths,
      ...event.signals.validationObservations,
    ].join("\n"),
    createdAt: event.createdAt,
  }));
}

function checkpointShortlist(checkpoints: CheckpointState[]): QueryShortlistItem[] {
  return checkpoints.map((checkpoint) => ({
    sourceType: "checkpoint" as const,
    sourceId: checkpoint.id,
    pathOrSection: `checkpoint:${checkpoint.id}`,
    summary: checkpoint.summary,
    content: [
      checkpoint.summary,
      checkpoint.bundle.currentFocus.summary,
      checkpoint.bundle.currentFocus.validationSnapshot.summary,
      ...checkpoint.bundle.projectMap.architectureNotes,
      ...checkpoint.bundle.gotchas.map((gotcha) => `${gotcha.title}: ${gotcha.cause}`),
      ...checkpoint.bundle.nextSteps.map((step) => `${step.title}: ${step.start}`),
    ].join("\n"),
    createdAt: checkpoint.createdAt,
  }));
}

export async function runQuery(options: QueryOptions): Promise<QueryResult> {
  const state = await readState(options.cwd);
  const events = await readHistoryEvents(options.cwd);
  const checkpoints = await readRecentCheckpoints(options.cwd, MAX_RECENT_CHECKPOINTS);
  for (const checkpoint of checkpoints) {
    const errors = validateCheckpointShape(checkpoint);
    if (errors.length > 0) {
      throw new Error(`Checkpoint ${checkpoint.id} is invalid: ${errors.join(" ")}`);
    }
  }
  const questionTokens = tokenize(options.question);

  let items: QueryShortlistItem[] = [];
  if (options.scope === "state" || options.scope === "all") {
    items.push(...bundleShortlist(state.bundle));
    items.push(...checkpointShortlist(checkpoints));
  }

  if (options.scope === "history" || options.scope === "all") {
    items.push(...historyShortlist(events.slice(-50)));
  }

  const scoredItems = items
    .map((item) => ({
      ...item,
      tokenMatches: tokenMatchCount(questionTokens, item.content, item.summary),
      score:
        scoreText(questionTokens, item.content, item.summary) +
        sourceTypeWeight(item.sourceType) +
        recencyWeight(item.createdAt) +
        checkpointProximityWeight(item.sourceType, item.sourceId),
    }))
    .sort((left, right) => right.score - left.score || left.sourceId.localeCompare(right.sourceId))
    .slice(0, MAX_SHORTLIST_ITEMS);

  items = scoredItems.map(({ score: _score, tokenMatches: _tokenMatches, ...item }) => item);

  const topScore = scoredItems[0]?.score ?? 0;
  const topTokenMatches = scoredItems[0]?.tokenMatches ?? 0;

  if (items.length === 0 || topScore < MIN_CONFIDENT_SCORE || topTokenMatches < 2) {
    return {
      answer: "Current memory does not contain enough evidence to answer this confidently.",
      why: items.length === 0
        ? "No relevant bundle, history, or checkpoint evidence was found for this question."
        : topTokenMatches < 2
          ? "The available evidence only overlaps weakly with the question, so the answer would be speculative."
          : "The available evidence was too weak or too sparse to support a confident answer.",
      citations: items.slice(0, 2).map((item) => ({
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        pathOrSection: item.pathOrSection,
        summary: item.summary,
      })),
    };
  }

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
