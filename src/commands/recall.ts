import { applyRecall, prepareRecall } from "../core/recall-orchestrator";
import { confirm, formatPlan, formatUnrecalledHistorySummary } from "../core/command-helpers";
import { readConfig } from "../core/config-store";
import type { RecallOptions } from "../types";

const MAX_DIFF_LINES = 80;

function renderDiffPreview(diff: string): { text: string; truncated: boolean } {
  const lines = diff.split("\n");
  if (lines.length <= MAX_DIFF_LINES) {
    return { text: diff, truncated: false };
  }

  return {
    text: `${lines.slice(0, MAX_DIFF_LINES).join("\n")}\n... diff truncated, inspect the target files for the full change ...`,
    truncated: true,
  };
}

export async function runRecall(options: RecallOptions): Promise<number> {
  const config = await readConfig(options.cwd);
  const effectiveSection = options.section === "all" ? config.recall.defaultSection : options.section;
  const effectiveSource = options.source === "all" ? config.recall.defaultSource : options.source;
  const effectivePolicy = options.policy ?? config.recall.policy;
  const effectiveShowDiff = options.showDiff || config.recall.preview.showDiffByDefault;

  const prepared = await prepareRecall(options);

  console.log(`Recall source scope: ${effectiveSource}`);
  console.log(`Recall section: ${effectiveSection}`);
  console.log(`Recall policy: ${effectivePolicy}`);
  console.log(`Unrecalled events considered: ${prepared.unrecalledCount}`);
  if (prepared.unrecalledSummary.rawEventCount > 0) {
    console.log("");
    console.log("Unrecalled History Summary:");
    console.log(formatUnrecalledHistorySummary(prepared.unrecalledSummary));
  }
  if (prepared.candidate.noopReason) {
    console.log("");
    console.log("Nothing to recall.");
    console.log(prepared.candidate.noopReason);
    return 0;
  }
  console.log("");
  console.log("Planned changes:");
  console.log(formatPlan(prepared.plannedChanges));
  console.log("");
  console.log("Memory Summary:");
  console.log(`- Changed sections: ${prepared.candidate.summary.changedSections.join(", ") || "none"}`);
  console.log(`- Added gotchas: ${prepared.candidate.summary.addedGotchas.join(", ") || "none"}`);
  console.log(`- Removed gotchas: ${prepared.candidate.summary.removedGotchas.join(", ") || "none"}`);
  console.log(`- Added next steps: ${prepared.candidate.summary.addedNextSteps.join(", ") || "none"}`);
  console.log(`- Removed next steps: ${prepared.candidate.summary.removedNextSteps.join(", ") || "none"}`);
  console.log(`- Merged gotchas: ${prepared.candidate.summary.mergedGotchas.join(", ") || "none"}`);
  console.log(`- Merged next steps: ${prepared.candidate.summary.mergedNextSteps.join(", ") || "none"}`);
  console.log(`- Current focus changed: ${prepared.candidate.summary.currentFocusChanged ? "yes" : "no"}`);
  console.log(`- Validation changed: ${prepared.candidate.summary.validationChanged ? "yes" : "no"}`);
  console.log(`- Protected sections: ${prepared.candidate.summary.protectedSections.join(", ") || "none"}`);

  if (prepared.checkpointComparison) {
    console.log("");
    console.log("Checkpoint Summary:");
    console.log(`- Baseline: ${prepared.checkpointComparison.checkpointId ?? "none"}`);
    console.log(`- Changed sections: ${prepared.checkpointComparison.changedSections.join(", ") || "none"}`);
    console.log(`- Added gotchas: ${prepared.checkpointComparison.addedGotchas.join(", ") || "none"}`);
    console.log(`- Removed gotchas: ${prepared.checkpointComparison.removedGotchas.join(", ") || "none"}`);
    console.log(`- Added next steps: ${prepared.checkpointComparison.addedNextSteps.join(", ") || "none"}`);
    console.log(`- Removed next steps: ${prepared.checkpointComparison.removedNextSteps.join(", ") || "none"}`);
    console.log(`- Merged gotchas: ${prepared.checkpointComparison.mergedGotchas.join(", ") || "none"}`);
    console.log(`- Merged next steps: ${prepared.checkpointComparison.mergedNextSteps.join(", ") || "none"}`);
  }

  const diffsToShow = effectiveShowDiff
    ? prepared.checkpointComparison?.fileDiffs?.length
      ? prepared.checkpointComparison.fileDiffs
      : prepared.candidate.fileDiffs
    : [];

  if (diffsToShow.length === 0) {
    console.log("");
    console.log(effectiveShowDiff ? "No file diffs were produced." : "Diff output is hidden by default. Re-run with --show-diff to inspect file-level changes.");
  } else {
    console.log("");
    console.log("File diffs:");
    for (const fileDiff of diffsToShow) {
      const preview = renderDiffPreview(fileDiff.diff);
      console.log(preview.text);
      console.log("");
    }
  }

  const shouldApply = options.yes ? true : await confirm("Apply these recall changes?", true);
  if (!shouldApply) {
    console.log("Aborted before writing files.");
    return 0;
  }

  await applyRecall(options.cwd, prepared.candidate);
  console.log("Project memory recalled.");
  return 0;
}
