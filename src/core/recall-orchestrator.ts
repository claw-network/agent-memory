import { readFile } from "node:fs/promises";
import { asAgentMemoryBundle, bundleOutputSchema, validateBundleShape } from "./bundle-schema";
import { persistCanonicalState } from "./canonical-persistence";
import { collectContext } from "./context-collector";
import { renderUnifiedDiff } from "./diff-renderer";
import { eventsAfterCursor, filterEventsBySource, nextCheckpointId, readHistoryEvents, readSources } from "./history-store";
import { updateRecallMaintenance, cloneMaintenance } from "./history-event-builders";
import { planProjectionWrites, renderEntryContent } from "./merge-files";
import { buildRecallPrompt } from "./prompt-builder";
import { invokeProvider } from "./provider-adapters";
import { buildState, getStatePath, stableStringify } from "./state-store";
import { projectState } from "./bundle-projector";
import { readLatestCheckpoint } from "./history-store";
import type {
  AgentMemoryState,
  FileDiff,
  RecallCandidate,
  RecallDiffSummary,
  RecallOptions,
} from "../types";

interface PreparedRecall {
  currentState: AgentMemoryState;
  candidate: RecallCandidate;
  plannedChanges: Awaited<ReturnType<typeof planProjectionWrites>>;
  unrecalledCount: number;
}

async function readIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function titles(values: { title: string }[]): string[] {
  return values.map((value) => value.title);
}

function diffTitles(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((value) => !beforeSet.has(value)),
    removed: before.filter((value) => !afterSet.has(value)),
  };
}

function buildRecallSummary(before: AgentMemoryState["bundle"], after: AgentMemoryState["bundle"]): RecallDiffSummary {
  const changedSections: string[] = [];
  const gotchasDiff = diffTitles(titles(before.gotchas), titles(after.gotchas));
  const nextStepsDiff = diffTitles(titles(before.nextSteps), titles(after.nextSteps));
  const currentFocusChanged = stableStringify(before.currentFocus) !== stableStringify(after.currentFocus);
  const validationChanged =
    stableStringify(before.currentFocus.validationSnapshot) !== stableStringify(after.currentFocus.validationSnapshot);

  if (stableStringify(before.project) !== stableStringify(after.project)) {
    changedSections.push("project");
  }
  if (stableStringify(before.projectMap) !== stableStringify(after.projectMap)) {
    changedSections.push("project-map");
  }
  if (currentFocusChanged) {
    changedSections.push("current-focus");
  }
  if (gotchasDiff.added.length > 0 || gotchasDiff.removed.length > 0) {
    changedSections.push("gotchas");
  }
  if (nextStepsDiff.added.length > 0 || nextStepsDiff.removed.length > 0) {
    changedSections.push("next-steps");
  }
  if (stableStringify(before.validationCommands) !== stableStringify(after.validationCommands)) {
    changedSections.push("validation-commands");
  }

  return {
    changedSections,
    addedGotchas: gotchasDiff.added,
    removedGotchas: gotchasDiff.removed,
    addedNextSteps: nextStepsDiff.added,
    removedNextSteps: nextStepsDiff.removed,
    currentFocusChanged,
    validationChanged,
  };
}

function lastEventId(events: { id: string }[], fallback: string | null): string | null {
  return events.length > 0 ? events[events.length - 1].id : fallback;
}

async function buildFileDiffs(
  rootDir: string,
  state: AgentMemoryState,
): Promise<FileDiff[]> {
  const diffs: FileDiff[] = [];
  const projection = projectState(rootDir, state);
  const stateDiff = renderUnifiedDiff(
    getStatePath(rootDir),
    await readIfExists(getStatePath(rootDir)),
    `${stableStringify(state)}\n`,
  );
  if (stateDiff) {
    diffs.push(stateDiff);
  }

  for (const file of projection.files) {
    const diff = renderUnifiedDiff(file.path, await readIfExists(file.path), file.content);
    if (diff) {
      diffs.push(diff);
    }
  }

  const entryDiff = renderUnifiedDiff(
    projection.entryFile,
    await readIfExists(projection.entryFile),
    renderEntryContent((await readIfExists(projection.entryFile)) || null, projection.entrySnippet),
  );
  if (entryDiff) {
    diffs.push(entryDiff);
  }

  return diffs;
}

export async function prepareRecall(options: RecallOptions): Promise<PreparedRecall> {
  const context = await collectContext(options.cwd, "recall");
  const currentState = context.previousState;
  if (!currentState) {
    throw new Error("No canonical state exists yet. Run `agent-memory init` before `agent-memory recall`.");
  }

  const events = await readHistoryEvents(options.cwd);
  const sources = await readSources(options.cwd);
  const checkpoint = await readLatestCheckpoint(options.cwd, currentState.maintenance.latestCheckpointId);
  const cursor = currentState.maintenance.recallCursors[options.source];
  const unrecalledEvents = filterEventsBySource(eventsAfterCursor(events, cursor.lastRecalledEventId), options.source);

  if (unrecalledEvents.length === 0) {
    return {
      currentState,
      candidate: {
        state: currentState,
        summary: buildRecallSummary(currentState.bundle, currentState.bundle),
        fileDiffs: [],
        noopReason: "No unrecalled events matched the selected source scope.",
      },
      plannedChanges: [],
      unrecalledCount: 0,
    };
  }

  let candidateBundle = currentState.bundle;
  const result = await invokeProvider(options.provider, {
    cwd: options.cwd,
    prompt: buildRecallPrompt(context, currentState, checkpoint, unrecalledEvents, options.source),
    schema: bundleOutputSchema,
  });
  const errors = validateBundleShape(result.parsed);
  if (errors.length > 0) {
    throw new Error(`Recall returned an invalid memory bundle: ${errors.join(" ")}`);
  }

  const parsed = asAgentMemoryBundle(result.parsed);
  if (!parsed) {
    throw new Error("Recall did not return a valid memory bundle.");
  }
  candidateBundle = parsed;

  const now = new Date().toISOString();
  const reservedCheckpointId = await nextCheckpointId(options.cwd);
  const updatedMaintenance = updateRecallMaintenance(
    {
      ...cloneMaintenance(currentState.maintenance),
      latestCheckpointId: reservedCheckpointId,
      historyEventCount: events.length + 1,
      importSourceCount: sources.length,
    },
    options.source,
    lastEventId(unrecalledEvents, cursor.lastRecalledEventId),
    now,
  );

  const nextState = buildState(candidateBundle, currentState.provider, updatedMaintenance, now);
  const summary = buildRecallSummary(currentState.bundle, candidateBundle);
  const isNoop =
    stableStringify(currentState.bundle) === stableStringify(candidateBundle) &&
    summary.changedSections.length === 0;
  if (isNoop) {
    return {
      currentState,
      candidate: {
        state: currentState,
        summary,
        fileDiffs: [],
        noopReason: "Recall found no durable memory changes after consolidation.",
      },
      plannedChanges: [],
      unrecalledCount: unrecalledEvents.length,
    };
  }
  const fileDiffs = await buildFileDiffs(options.cwd, nextState);
  const plannedChanges = await planProjectionWrites(projectState(options.cwd, nextState), getStatePath(options.cwd));

  return {
    currentState,
    candidate: {
      state: nextState,
      summary,
      fileDiffs,
      noopReason: null,
    },
    plannedChanges,
    unrecalledCount: unrecalledEvents.length,
  };
}

export async function applyRecall(rootDir: string, candidate: RecallCandidate): Promise<void> {
  if (candidate.noopReason) {
    return;
  }

  await persistCanonicalState({
    rootDir,
    bundle: candidate.state.bundle,
    provider: candidate.state.provider,
    commandName: "recall",
    generatedAt: candidate.state.generatedAt,
    maintenance: candidate.state.maintenance,
    diffSummary: candidate.summary,
    reservedCheckpointId: candidate.state.maintenance.latestCheckpointId,
  });
}
