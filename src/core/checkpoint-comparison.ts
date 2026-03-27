import { readFile } from "node:fs/promises";
import { renderUnifiedDiff } from "./diff-renderer";
import { renderEntryContent } from "./merge-files";
import { getStatePath, stableStringify } from "./state-store";
import { projectState } from "./bundle-projector";
import type { AgentMemoryState, CheckpointComparisonSummary, CheckpointState, DeduplicationResult, FileDiff } from "../types";

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

export async function compareStateWithCheckpoint(
  rootDir: string,
  state: AgentMemoryState,
  checkpoint: CheckpointState | null,
  includeDiffs: boolean,
  dedupeResult?: DeduplicationResult | null,
): Promise<CheckpointComparisonSummary | null> {
  if (!checkpoint) {
    return null;
  }

  const before = checkpoint.bundle;
  const after = state.bundle;
  const changedSections: string[] = [];
  const gotchaDiff = diffTitles(titles(before.gotchas), titles(after.gotchas));
  const nextStepDiff = diffTitles(titles(before.nextSteps), titles(after.nextSteps));
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
  if (gotchaDiff.added.length > 0 || gotchaDiff.removed.length > 0) {
    changedSections.push("gotchas");
  }
  if (nextStepDiff.added.length > 0 || nextStepDiff.removed.length > 0) {
    changedSections.push("next-steps");
  }
  if (stableStringify(before.validationCommands) !== stableStringify(after.validationCommands)) {
    changedSections.push("validation-commands");
  }

  const fileDiffs: FileDiff[] = [];
  if (includeDiffs) {
    const projection = projectState(rootDir, state);
    const stateDiff = renderUnifiedDiff(
      getStatePath(rootDir),
      await readIfExists(getStatePath(rootDir)),
      `${stableStringify(state)}\n`,
    );
    if (stateDiff) {
      fileDiffs.push(stateDiff);
    }

    for (const file of projection.files) {
      const diff = renderUnifiedDiff(file.path, await readIfExists(file.path), file.content);
      if (diff) {
        fileDiffs.push(diff);
      }
    }

    const entryDiff = renderUnifiedDiff(
      projection.entryFile,
      await readIfExists(projection.entryFile),
      renderEntryContent((await readIfExists(projection.entryFile)) || null, projection.entrySnippet),
    );
    if (entryDiff) {
      fileDiffs.push(entryDiff);
    }
  }

  return {
    checkpointId: checkpoint.id,
    changedSections,
    addedGotchas: gotchaDiff.added,
    removedGotchas: gotchaDiff.removed,
    addedNextSteps: nextStepDiff.added,
    removedNextSteps: nextStepDiff.removed,
    mergedGotchas: dedupeResult?.mergedGotchas ?? [],
    mergedNextSteps: dedupeResult?.mergedNextSteps ?? [],
    currentFocusChanged,
    validationChanged,
    fileDiffs,
  };
}
