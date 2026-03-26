import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { PlannedChange, ProjectScan } from "../types";

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
