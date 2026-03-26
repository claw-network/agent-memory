import { createInterface } from "node:readline/promises";
import { writeFile } from "node:fs/promises";
import { stdin as input, stdout as output } from "node:process";
import { join } from "node:path";
import { detectEntryFile, getFallbackEntryFile } from "../core/detect-entry-files";
import { generateMemory } from "../core/generate-memory";
import {
  applyEntryPatch,
  applyFileWrite,
  planEntryPatch,
  planFileWrite,
  wrapEntrySnippet,
} from "../core/merge-files";
import { runValidations } from "../core/run-validations";
import { scanProject } from "../core/scan-project";
import type { InitOptions, PlannedChange } from "../types";

async function confirm(question: string, defaultValue: boolean): Promise<boolean> {
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

function formatPlan(plan: PlannedChange[]): string {
  return plan
    .map((item) => `- ${item.kind.toUpperCase()} ${item.path}: ${item.note}`)
    .join("\n");
}

function printProjectSummary(scan: Awaited<ReturnType<typeof scanProject>>): void {
  console.log(`Project: ${scan.projectName}`);
  console.log(`Root: ${scan.rootDir}`);
  console.log(`Signals: ${scan.projectSignals.length > 0 ? scan.projectSignals.join(", ") : "none"}`);
  console.log(`Package manager: ${scan.packageManager ?? "not detected"}`);
  console.log(`Workspace: ${scan.workspaceManager ?? "not detected"}`);

  if (!scan.projectSignals.some((signal) => signal === ".git" || signal === "package.json")) {
    console.log("Note: project signals are weak, so review the generated memory manually.");
  }
}

export async function runInit(options: InitOptions): Promise<number> {
  const scan = await scanProject(options.cwd);
  const memory = generateMemory(scan);
  const entryFile = (await detectEntryFile(options.cwd)) ?? getFallbackEntryFile(options.cwd);
  const wrappedSnippet = wrapEntrySnippet(memory.entrySnippet);
  const currentFocusPath = join(options.cwd, "docs/agent-memory/current-focus.md");

  const fileTargets = [
    { path: join(options.cwd, "docs/agent-memory/README.md"), content: memory.readme },
    { path: join(options.cwd, "docs/agent-memory/project-map.md"), content: memory.projectMap },
    { path: currentFocusPath, content: memory.currentFocus },
    { path: join(options.cwd, "docs/agent-memory/gotchas.md"), content: memory.gotchas },
    { path: join(options.cwd, "docs/agent-memory/next-steps.md"), content: memory.nextSteps },
  ];

  const plannedChanges: PlannedChange[] = [];
  for (const target of fileTargets) {
    plannedChanges.push(...(await planFileWrite(target.path, target.content)));
  }
  plannedChanges.push(...(await planEntryPatch(entryFile, wrappedSnippet)));
  const currentFocusIsNew = plannedChanges.some(
    (change) => change.path === currentFocusPath && change.kind === "create",
  );

  printProjectSummary(scan);
  console.log("");
  console.log("Planned changes:");
  console.log(formatPlan(plannedChanges));

  const shouldApply = options.yes ? true : await confirm("Apply these changes?", true);
  if (!shouldApply) {
    console.log("Aborted before writing files.");
    return 0;
  }

  for (const target of fileTargets) {
    await applyFileWrite(target.path, target.content);
  }
  await applyEntryPatch(entryFile, wrappedSnippet);

  console.log("");
  console.log("Project memory initialized.");

  if (options.yes) {
    console.log("Validation commands were skipped because --yes uses the default non-validation path.");
    return 0;
  }

  if (scan.validationCandidates.length === 0) {
    console.log("No common validation command was inferred, so init is complete.");
    return 0;
  }

  const shouldValidate = await confirm("Run common validation commands and refresh current-focus.md?", false);
  if (!shouldValidate) {
    console.log("Validation commands were not run.");
    return 0;
  }

  console.log("");
  console.log("Running validation commands...");
  const results = await runValidations(options.cwd, scan.validationCandidates);
  for (const result of results) {
    console.log(`- ${result.command}: ${result.status}`);
  }

  const refreshedMemory = generateMemory(scan, results);
  if (currentFocusIsNew) {
    await writeFile(currentFocusPath, refreshedMemory.currentFocus, "utf8");
    console.log("Updated docs/agent-memory/current-focus.md with validation summary.");
  } else {
    await applyFileWrite(currentFocusPath, refreshedMemory.currentFocus);
    console.log("Wrote a generated current-focus backup with validation summary for manual merge.");
  }

  return 0;
}
