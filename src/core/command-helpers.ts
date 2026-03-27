import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { PlannedChange, ProjectScan, RecallEvidenceGroup, UnrecalledHistorySummary } from "../types";

export async function confirm(question: string, defaultValue: boolean): Promise<boolean> {
  if (!input.isTTY || !output.isTTY) {
    return defaultValue;
  }

  const prompt = defaultValue ? " [Y/n] " : " [y/N] ";
  const rl = createInterface({ input, output });

  try {
    const answer = (await rl.question(`${question}${prompt}`)).trim().toLowerCase();
    if (answer.length === 0) {
      return defaultValue;
    }

    return ["y", "yes"].includes(answer);
  } finally {
    rl.close();
  }
}

export function formatPlan(plan: PlannedChange[]): string {
  return plan
    .map((item) => `- ${item.kind.toUpperCase()} ${item.path}: ${item.note}`)
    .join("\n");
}

export function printProjectSummary(scan: ProjectScan): void {
  console.log(`Project: ${scan.projectName}`);
  console.log(`Root: ${scan.rootDir}`);
  console.log(`Signals: ${scan.projectSignals.length > 0 ? scan.projectSignals.join(", ") : "none"}`);
  console.log(`Package manager: ${scan.packageManager ?? "not detected"}`);
  console.log(`Workspace: ${scan.workspaceManager ?? "not detected"}`);

  if (!scan.projectSignals.some((signal) => signal === ".git" || signal === "package.json")) {
    console.log("Note: project signals are weak, so review the generated memory manually.");
  }
}

function previewValues(values: string[], limit: number): string {
  if (values.length === 0) {
    return "none";
  }

  const head = values.slice(0, limit).join(", ");
  const remaining = values.length - limit;
  return remaining > 0 ? `${head}, +${remaining} more` : head;
}

function gotchaPreview(group: RecallEvidenceGroup): string {
  return previewValues(
    group.signals.gotchas.map((value) => {
      const index = value.indexOf(":");
      return index >= 0 ? value.slice(0, index).trim() : value;
    }),
    2,
  );
}

function nextStepPreview(group: RecallEvidenceGroup): string {
  return previewValues(
    group.signals.nextStepHints.map((value) => {
      const trimmed = value.replace(/^(NEXT:|DONE:)\s*/i, "").trim();
      const index = trimmed.indexOf(":");
      return index >= 0 ? trimmed.slice(0, index).trim() : trimmed;
    }),
    2,
  );
}

export function formatUnrecalledHistorySummary(summary: UnrecalledHistorySummary, limit = 5): string {
  const lines = [
    `- raw events: ${summary.rawEventCount}`,
    `- grouped items: ${summary.groupedItemCount}`,
  ];

  const groupsToShow = summary.groups.slice(0, limit);
  for (const group of groupsToShow) {
    lines.push(
      `- [${group.sourceScopeLabel}] ${group.representativeSummary} events=${group.eventIds.length} paths=${previewValues(group.signals.keyPaths, 3)}`,
    );

    const detailParts: string[] = [];
    if (group.signals.gotchas.length > 0) {
      detailParts.push(`gotchas=${gotchaPreview(group)}`);
    }
    if (group.signals.nextStepHints.length > 0) {
      detailParts.push(`next=${nextStepPreview(group)}`);
    }
    if (detailParts.length > 0) {
      lines.push(`  ${detailParts.join(" ")}`);
    }
  }

  if (summary.groupedItemCount > limit) {
    lines.push(`- ... ${summary.groupedItemCount - limit} more grouped items omitted ...`);
  }

  return lines.join("\n");
}
