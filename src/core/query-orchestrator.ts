import { asQueryResult, queryOutputSchema, validateCheckpointShape, validateQueryResultShape } from "./bundle-schema";
import { readConfig } from "./config-store";
import { readHistoryEvents, readRecentCheckpoints } from "./history-store";
import { buildQueryPrompt } from "./prompt-builder";
import { invokeProvider } from "./provider-adapters";
import { readState } from "./state-store";
import type {
  AgentMemoryBundle,
  CheckpointState,
  Citation,
  CitationSourceType,
  HistoryEvent,
  QueryMode,
  QueryOptions,
  QueryResult,
  QueryShortlistItem,
} from "../types";

const MAX_SHORTLIST_ITEMS = 8;
const MAX_RECENT_CHECKPOINTS = 5;
const MIN_CONFIDENT_SCORE = 6;
const PROJECT_MAP_PROJECTION_PATH = "docs/agent-memory/project-map.md";
const CURRENT_FOCUS_PROJECTION_PATH = "docs/agent-memory/current-focus.md";
const GOTCHAS_PROJECTION_PATH = "docs/agent-memory/gotchas.md";
const NEXT_STEPS_PROJECTION_PATH = "docs/agent-memory/next-steps.md";

const SOURCE_TYPE_WEIGHTS: Record<QueryMode, Record<CitationSourceType, number>> = {
  answer: { bundle: 40, checkpoint: 24, event: 12 },
  changes: { bundle: 12, checkpoint: 44, event: 36 },
  next: { bundle: 28, checkpoint: 16, event: 22 },
  traps: { bundle: 28, checkpoint: 16, event: 22 },
};

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function includesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function detectQueryMode(question: string): QueryMode {
  const normalized = question.trim().toLowerCase();
  if (!normalized) {
    return "answer";
  }

  if (
    includesAny(normalized, [
      /what should i do next/,
      /what should we do next/,
      /\bnext step\b/,
      /\bnext steps\b/,
      /\btodo\b/,
      /follow[- ]?up/,
      /what remains/,
      /what now/,
    ])
  ) {
    return "next";
  }

  if (
    includesAny(normalized, [
      /\bgotcha\b/,
      /\bgotchas\b/,
      /\btrap\b/,
      /\btraps\b/,
      /\bpitfall\b/,
      /\bpitfalls\b/,
      /watch out/,
      /\bknown issue\b/,
      /\bknown issues\b/,
      /what breaks/,
    ])
  ) {
    return "traps";
  }

  if (
    includesAny(normalized, [
      /what changed/,
      /what(?:'s| is)? new/,
      /\brecent changes\b/,
      /\brecently changed\b/,
      /\bsince\b/,
    ])
  ) {
    return "changes";
  }

  return "answer";
}

export function projectionPathForCitation(sourceType: CitationSourceType, pathOrSection: string): string | null {
  if (sourceType !== "bundle") {
    return null;
  }

  if (pathOrSection.startsWith("bundle.project") || pathOrSection.startsWith("bundle.projectMap")) {
    return PROJECT_MAP_PROJECTION_PATH;
  }

  if (pathOrSection.startsWith("bundle.currentFocus")) {
    return CURRENT_FOCUS_PROJECTION_PATH;
  }

  if (pathOrSection.startsWith("bundle.gotchas")) {
    return GOTCHAS_PROJECTION_PATH;
  }

  if (pathOrSection.startsWith("bundle.nextSteps")) {
    return NEXT_STEPS_PROJECTION_PATH;
  }

  return null;
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

function sourceTypeWeight(mode: QueryMode, sourceType: QueryShortlistItem["sourceType"]): number {
  return SOURCE_TYPE_WEIGHTS[mode][sourceType];
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

function modeCategoryBoost(mode: QueryMode, item: QueryShortlistItem): number {
  switch (mode) {
    case "changes":
      switch (item.category) {
        case "checkpoint":
          return 20;
        case "event":
          return 14;
        case "current-focus":
          return 18;
        case "project":
          return -18;
        case "project-map":
          return -12;
        default:
          return 0;
      }
    case "next":
      switch (item.category) {
        case "next-step":
          return 24;
        case "suggested-action":
          return 22;
        case "current-focus":
          return 10;
        case "event":
          return item.tags.includes("next") ? 14 : -6;
        default:
          return 0;
      }
    case "traps":
      switch (item.category) {
        case "gotcha":
          return 24;
        case "current-focus":
          return 8;
        case "event":
          return item.tags.includes("traps") ? 14 : -6;
        default:
          return 0;
      }
    case "answer":
    default:
      return 0;
  }
}

function modeTagBoost(mode: QueryMode, item: QueryShortlistItem): number {
  if (mode === "answer") {
    return 0;
  }

  return item.tags.includes(mode) ? 12 : 0;
}

function bundleShortlist(bundle: AgentMemoryBundle): QueryShortlistItem[] {
  return [
    {
      sourceType: "bundle",
      sourceId: "project",
      pathOrSection: "bundle.project",
      summary: bundle.project.summary,
      content: [bundle.project.summary, ...bundle.project.keyPaths].join("\n"),
      createdAt: null,
      projectionPath: PROJECT_MAP_PROJECTION_PATH,
      category: "project",
      tags: ["answer"],
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
      projectionPath: PROJECT_MAP_PROJECTION_PATH,
      category: "project-map",
      tags: ["answer"],
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
      projectionPath: CURRENT_FOCUS_PROJECTION_PATH,
      category: "current-focus",
      tags: ["answer", "changes", "next", "traps"],
    },
    ...bundle.currentFocus.validationSnapshot.suggestedNextActions.map((action, index) => ({
      sourceType: "bundle" as const,
      sourceId: `suggested-action-${index + 1}`,
      pathOrSection: `bundle.currentFocus.validationSnapshot.suggestedNextActions.${index + 1}`,
      summary: action,
      content: `${action}\n${bundle.currentFocus.validationSnapshot.summary}`,
      createdAt: bundle.currentFocus.validationSnapshot.validatedAt,
      projectionPath: CURRENT_FOCUS_PROJECTION_PATH,
      category: "suggested-action" as const,
      tags: ["next" as const],
    })),
    ...bundle.gotchas.map((gotcha, index) => ({
      sourceType: "bundle" as const,
      sourceId: `gotcha-${index + 1}`,
      pathOrSection: `bundle.gotchas.${gotcha.title}`,
      summary: gotcha.title,
      content: [gotcha.title, gotcha.symptom, gotcha.cause, gotcha.correctPath].join("\n"),
      createdAt: null,
      projectionPath: GOTCHAS_PROJECTION_PATH,
      category: "gotcha" as const,
      tags: ["traps" as const],
    })),
    ...bundle.nextSteps.map((step, index) => ({
      sourceType: "bundle" as const,
      sourceId: `next-step-${index + 1}`,
      pathOrSection: `bundle.nextSteps.${step.title}`,
      summary: step.title,
      content: [step.title, step.why, step.start, step.done].join("\n"),
      createdAt: null,
      projectionPath: NEXT_STEPS_PROJECTION_PATH,
      category: "next-step" as const,
      tags: ["next" as const],
    })),
  ];
}

function historyShortlist(events: HistoryEvent[]): QueryShortlistItem[] {
  return events.map((event) => {
    const tags: QueryMode[] = ["changes"];
    if (event.signals.nextStepHints.length > 0) {
      tags.push("next");
    }
    if (event.signals.gotchas.length > 0 || event.signals.validationObservations.length > 0) {
      tags.push("traps");
    }

    return {
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
      projectionPath: null,
      category: "event",
      tags,
    };
  });
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
    projectionPath: null,
    category: "checkpoint",
    tags: ["changes"],
  }));
}

export function rankQueryShortlistItems(
  mode: QueryMode,
  question: string,
  items: QueryShortlistItem[],
): Array<QueryShortlistItem & { score: number; tokenMatches: number }> {
  const questionTokens = tokenize(question);
  return items
    .map((item) => ({
      ...item,
      tokenMatches: tokenMatchCount(questionTokens, item.content, item.summary),
      score:
        scoreText(questionTokens, item.content, item.summary) +
        sourceTypeWeight(mode, item.sourceType) +
        recencyWeight(item.createdAt) +
        checkpointProximityWeight(item.sourceType, item.sourceId) +
        modeCategoryBoost(mode, item) +
        modeTagBoost(mode, item),
    }))
    .sort((left, right) => right.score - left.score || left.sourceId.localeCompare(right.sourceId));
}

function enrichCitation(citation: Citation): Citation {
  return {
    ...citation,
    projectionPath: projectionPathForCitation(citation.sourceType, citation.pathOrSection),
  };
}

function templateInstructionsForMode(
  queryConfig: Awaited<ReturnType<typeof readConfig>>["query"],
  mode: QueryMode,
): string {
  return queryConfig.templates[mode].instructions;
}

export async function runQuery(options: QueryOptions): Promise<QueryResult> {
  const state = await readState(options.cwd);
  const config = await readConfig(options.cwd);
  const mode = detectQueryMode(options.question);
  const events = await readHistoryEvents(options.cwd);
  const checkpoints = await readRecentCheckpoints(options.cwd, MAX_RECENT_CHECKPOINTS);
  for (const checkpoint of checkpoints) {
    const errors = validateCheckpointShape(checkpoint);
    if (errors.length > 0) {
      throw new Error(`Checkpoint ${checkpoint.id} is invalid: ${errors.join(" ")}`);
    }
  }

  let items: QueryShortlistItem[] = [];
  if (options.scope === "state" || options.scope === "all") {
    items.push(...bundleShortlist(state.bundle));
    items.push(...checkpointShortlist(checkpoints));
  }

  if (options.scope === "history" || options.scope === "all") {
    items.push(...historyShortlist(events.slice(-50)));
  }

  const rankedItems = rankQueryShortlistItems(mode, options.question, items).slice(0, MAX_SHORTLIST_ITEMS);
  const shortlist = rankedItems.map(({ score: _score, tokenMatches: _tokenMatches, ...item }) => item);
  const topScore = rankedItems[0]?.score ?? 0;
  const topTokenMatches = rankedItems[0]?.tokenMatches ?? 0;
  const hasSufficientEvidence =
    shortlist.length > 0 &&
    topScore >= MIN_CONFIDENT_SCORE &&
    (mode !== "answer" || topTokenMatches >= 2);

  if (!hasSufficientEvidence) {
    return {
      mode,
      answer: "Current memory does not contain enough evidence to answer this confidently.",
      why: shortlist.length === 0
        ? "No relevant bundle, history, or checkpoint evidence was found for this question."
        : mode === "answer" && topTokenMatches < 2
          ? "The available evidence only overlaps weakly with the question, so the answer would be speculative."
          : "The available evidence was too weak or too sparse to support a confident answer.",
      citations: shortlist.slice(0, 2).map((item) =>
        enrichCitation({
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          pathOrSection: item.pathOrSection,
          summary: item.summary,
          projectionPath: item.projectionPath,
        }),
      ),
    };
  }

  const result = await invokeProvider(options.provider, {
    cwd: options.cwd,
    prompt: buildQueryPrompt(
      options.question,
      options.scope,
      mode,
      shortlist,
      templateInstructionsForMode(config.query, mode),
    ),
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

  if (parsed.mode !== mode) {
    throw new Error(`Query returned an unexpected mode: ${parsed.mode}`);
  }

  return {
    ...parsed,
    citations: parsed.citations.map(enrichCitation),
  };
}
