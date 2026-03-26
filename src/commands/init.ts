import { writeFile } from "node:fs/promises";
import { detectEntryFile, getFallbackEntryFile } from "../core/detect-entry-files";
import { confirm, formatPlan, printProjectSummary } from "../core/command-helpers";
import { generateMemory } from "../core/generate-memory";
import {
  applyEntryPatch,
  applyManagedFileWrite,
  planEntryPatch,
  wrapEntrySnippet,
} from "../core/merge-files";
import { buildMemoryTargets, planManagedMemoryWrites } from "../core/plan-memory-write";
import { runValidations } from "../core/run-validations";
import { scanProject } from "../core/scan-project";
import type { InitOptions } from "../types";

export async function runInit(options: InitOptions): Promise<number> {
  const scan = await scanProject(options.cwd);
  const memory = generateMemory(scan, "init");
  const entryFile = (await detectEntryFile(options.cwd)) ?? getFallbackEntryFile(options.cwd);
  const wrappedSnippet = wrapEntrySnippet(memory.entrySnippet);
  const fileTargets = buildMemoryTargets(options.cwd, memory);
  const { ownerships, changes } = await planManagedMemoryWrites(fileTargets);
  const plannedChanges = [...changes, ...(await planEntryPatch(entryFile, wrappedSnippet))];
  const currentFocusTarget = fileTargets.find((target) => target.fileId === "current-focus");
  const currentFocusOwnership = currentFocusTarget ? ownerships.get(currentFocusTarget.path) ?? null : null;

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
    const ownership = ownerships.get(target.path);
    if (!ownership) {
      continue;
    }
    await applyManagedFileWrite(target.path, target.content, ownership);
  }
  await applyEntryPatch(entryFile, wrappedSnippet);

  console.log("");
  console.log("Project memory initialized.");

  if (!options.validate && options.yes) {
    console.log("Validation commands were skipped because --yes uses the default non-validation path.");
    return 0;
  }

  if (scan.validationCandidates.length === 0) {
    console.log("No common validation command was inferred, so init is complete.");
    return 0;
  }

  const shouldValidate = options.validate
    ? true
    : await confirm("Run common validation commands and refresh current-focus.md?", false);
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

  const refreshedMemory = generateMemory(scan, "init", results);
  if (!currentFocusTarget || !currentFocusOwnership) {
    return 0;
  }

  if (currentFocusOwnership.state === "missing" || currentFocusOwnership.state === "managed") {
    await writeFile(currentFocusTarget.path, refreshedMemory.currentFocus, "utf8");
    console.log("Updated docs/agent-memory/current-focus.md with validation summary.");
  } else {
    await applyManagedFileWrite(currentFocusTarget.path, refreshedMemory.currentFocus, currentFocusOwnership);
    console.log("Wrote a generated current-focus backup with validation summary for manual merge.");
  }

  return 0;
}
