import { orchestrateAgentMemory } from "../core/agent-orchestrator";
import { collectContext } from "../core/context-collector";
import { confirm, formatPlan, printProjectSummary } from "../core/command-helpers";
import { projectState } from "../core/bundle-projector";
import { applyEntrySnippet, planProjectionWrites, writeProjectionFile } from "../core/merge-files";
import { buildState, getStatePath, writeState } from "../core/state-store";
import type { CommandOptions } from "../types";

export async function runUpdate(options: CommandOptions): Promise<number> {
  const context = await collectContext(options.cwd, "update");
  if (!context.previousState) {
    throw new Error("No canonical state exists yet. Run `agent-memory init` before `agent-memory update`.");
  }

  printProjectSummary(context.scan);
  console.log(`Provider preference: ${options.provider}`);
  console.log("Loaded existing canonical state from .agent-memory/state.json.");
  console.log("");
  console.log("Running background agent...");

  const result = await orchestrateAgentMemory(context, options.provider, options.validate);
  const state = buildState(result.bundle, result.provider);
  const projection = projectState(options.cwd, state);
  const plannedChanges = await planProjectionWrites(projection, getStatePath(options.cwd));

  console.log("");
  console.log("Planned changes:");
  console.log(formatPlan(plannedChanges));

  const shouldApply = options.yes ? true : await confirm("Apply these changes?", true);
  if (!shouldApply) {
    console.log("Aborted before writing files.");
    return 0;
  }

  await writeState(options.cwd, state);
  for (const file of projection.files) {
    await writeProjectionFile(file);
  }
  await applyEntrySnippet(projection.entryFile, projection.entrySnippet);

  console.log("");
  console.log("Project memory updated.");
  console.log(`Canonical state: ${getStatePath(options.cwd)}`);

  if (result.discoveryErrors.length > 0) {
    console.log(`Discovery pass needed repair for ${result.discoveryErrors.length} issue(s) before finalizing.`);
  }

  if (options.validate) {
    if (result.validationResults.length === 0) {
      console.log("No agent-recommended validation commands were executed.");
    } else {
      console.log("Validation commands:");
      for (const validation of result.validationResults) {
        console.log(`- ${validation.command}: ${validation.status}`);
      }
    }
  }

  return 0;
}
