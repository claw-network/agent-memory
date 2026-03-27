import { orchestrateAgentMemory } from "../core/agent-orchestrator";
import { persistCanonicalState } from "../core/canonical-persistence";
import { collectContext } from "../core/context-collector";
import { confirm, formatPlan, printProjectSummary } from "../core/command-helpers";
import { planProjectionWrites } from "../core/merge-files";
import { getStatePath } from "../core/state-store";
import { projectState } from "../core/bundle-projector";
import { buildState } from "../core/state-store";
import type { CommandOptions } from "../types";

export async function runUpdate(options: CommandOptions): Promise<number> {
  const context = await collectContext(options.cwd, "update");
  if (!context.previousState) {
    throw new Error("No canonical state exists yet. Run `agent-memory init` before `agent-memory update`.");
  }

  printProjectSummary(context.scan);
  console.log(`Provider preference: ${options.provider}`);
  console.log("Loaded canonical state from .agent-memory/state.json.");
  console.log("");
  console.log("Running background analysis...");

  const result = await orchestrateAgentMemory(context, options.provider, options.validate);
  const previewState = buildState(result.bundle, result.provider, context.previousState.maintenance);
  const plannedChanges = await planProjectionWrites(projectState(options.cwd, previewState), getStatePath(options.cwd));

  console.log("");
  console.log("Planned changes:");
  console.log(formatPlan(plannedChanges));

  const shouldApply = options.yes ? true : await confirm("Apply these changes?", true);
  if (!shouldApply) {
    console.log("Aborted before writing files.");
    return 0;
  }

  await persistCanonicalState({
    rootDir: options.cwd,
    bundle: result.bundle,
    provider: result.provider,
    commandName: "update",
    validations: result.validationResults,
    maintenance: context.previousState.maintenance,
  });

  console.log("");
  console.log("Project memory updated.");
  console.log(`Canonical state: ${getStatePath(options.cwd)}`);

  if (result.validationResults.length > 0) {
    console.log("Validation commands:");
    for (const validation of result.validationResults) {
      console.log(`- ${validation.command}: ${validation.status}`);
    }
  }

  return 0;
}
