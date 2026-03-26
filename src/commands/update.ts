import { writeFile } from "node:fs/promises";
import { detectEntryFile, getFallbackEntryFile } from "../core/detect-entry-files";
import { confirm, formatPlan, printProjectSummary } from "../core/command-helpers";
import { generateMemory } from "../core/generate-memory";
import { applyEntryPatch, applyManagedFileWrite, planEntryPatch } from "../core/merge-files";
import { buildMemoryTargets, planManagedMemoryWrites } from "../core/plan-memory-write";
import { runValidations } from "../core/run-validations";
import { scanProject } from "../core/scan-project";
import type { InitOptions } from "../types";

export async function runUpdate(options: InitOptions): Promise<number> {
  const scan = await scanProject(options.cwd);
  const memory = generateMemory(scan, "update");
  const entryFile = (await detectEntryFile(options.cwd)) ?? getFallbackEntryFile(options.cwd);
  const targets = buildMemoryTargets(options.cwd, memory);
  const { ownerships, changes } = await planManagedMemoryWrites(targets);
  const entryPlan = await planEntryPatch(entryFile, memory.entrySnippet ? `<!-- agent-memory:start -->\n${memory.entrySnippet}\n<!-- agent-memory:end -->` : "");
  const currentFocusTarget = targets.find((target) => target.fileId === "current-focus");
  const currentFocusOwnership = currentFocusTarget ? ownerships.get(currentFocusTarget.path) ?? null : null;
  const allMemoryMissing = Array.from(ownerships.values()).every((ownership) => ownership.state === "missing");
  const entryWasMissing = entryPlan.some((change) => change.kind === "create");

  printProjectSummary(scan);
  if (allMemoryMissing && entryWasMissing) {
    console.log("Note: no existing project memory was detected; update will repair bootstrap state.");
  }
  console.log("");
  console.log("Planned changes:");
  console.log(formatPlan([...changes, ...entryPlan]));

  const shouldApply = options.yes ? true : await confirm("Apply these changes?", true);
  if (!shouldApply) {
    console.log("Aborted before writing files.");
    return 0;
  }

  for (const target of targets) {
    const ownership = ownerships.get(target.path);
    if (!ownership) {
      continue;
    }
    await applyManagedFileWrite(target.path, target.content, ownership);
  }
  await applyEntryPatch(entryFile, `<!-- agent-memory:start -->\n${memory.entrySnippet}\n<!-- agent-memory:end -->`);

  console.log("");
  console.log("Project memory updated.");

  if (options.yes) {
    console.log("Validation commands were skipped because --yes uses the default non-validation path.");
    return 0;
  }

  if (scan.validationCandidates.length === 0) {
    console.log("No common validation command was inferred, so update is complete.");
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

  if (!currentFocusTarget || !currentFocusOwnership) {
    return 0;
  }

  const refreshedMemory = generateMemory(scan, "update", results);
  if (currentFocusOwnership.state === "missing" || currentFocusOwnership.state === "managed") {
    await writeFile(currentFocusTarget.path, refreshedMemory.currentFocus, "utf8");
    console.log("Updated docs/agent-memory/current-focus.md with validation summary.");
  } else {
    await applyManagedFileWrite(currentFocusTarget.path, refreshedMemory.currentFocus, currentFocusOwnership);
    console.log("Wrote a generated current-focus backup with validation summary for manual merge.");
  }

  return 0;
}
