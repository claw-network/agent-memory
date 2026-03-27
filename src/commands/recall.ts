import { applyRecall, prepareRecall } from "../core/recall-orchestrator";
import { confirm, formatPlan } from "../core/command-helpers";
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
  const prepared = await prepareRecall(options);

  console.log(`Recall source scope: ${options.source}`);
  console.log(`Unrecalled events considered: ${prepared.unrecalledCount}`);
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
  console.log(`- Current focus changed: ${prepared.candidate.summary.currentFocusChanged ? "yes" : "no"}`);
  console.log(`- Validation changed: ${prepared.candidate.summary.validationChanged ? "yes" : "no"}`);

  if (prepared.candidate.fileDiffs.length === 0) {
    console.log("");
    console.log("No file diffs were produced.");
  } else {
    console.log("");
    console.log("File diffs:");
    for (const fileDiff of prepared.candidate.fileDiffs) {
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
