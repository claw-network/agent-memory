import {
  applyIntegrationPlan,
  applyRepairPlan,
  buildIntegrationStatusReport,
  formatIntegrationPlan,
  formatIntegrationStatusReport,
  previewIntegrationPlan,
  previewRepairPlan,
} from "../core/integration";
import type { IntegrateCommandOptions } from "../types";

export async function runIntegrate(options: IntegrateCommandOptions): Promise<number> {
  if (options.status) {
    const report = await buildIntegrationStatusReport(options.cwd, options.target);
    const effectiveOutput = options.output ?? "text";
    if (effectiveOutput === "json") {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatIntegrationStatusReport(report));
    }
    return 0;
  }

  if (options.dryRun) {
    if (options.repair) {
      const preview = await previewRepairPlan(options.cwd, options.target);
      console.log(formatIntegrationPlan(options.target, preview.changes, true, "repair"));
      if (preview.changes.length === 0) {
        console.log("Nothing to repair. No managed mismatches were found for the selected target.");
        console.log(`Suggested next action: ${preview.suggestedNextAction}`);
      }
      return 0;
    }

    const preview = await previewIntegrationPlan(options.cwd, options.target);
    console.log(formatIntegrationPlan(options.target, preview.changes, true, "integrate"));
    if (preview.projectConfigWouldBeCreated) {
      console.log("Note: project config missing; normal integrate would create .agent-memory/config.json.");
    }
    return 0;
  }

  if (options.repair) {
    const applied = await applyRepairPlan(options.cwd, options.target);
    if (applied.changes.length === 0) {
      console.log("Nothing to repair. No managed mismatches were found for the selected target.");
      console.log(`Suggested next action: ${applied.suggestedNextAction}`);
      return 0;
    }

    console.log(formatIntegrationPlan(options.target, applied.changes, false, "repair"));
    console.log(`Global changes were made: ${applied.globalChangesApplied ? "yes" : "no"}`);
    console.log("Suggested verification: agent-memory integrate --status");
    return 0;
  }

  const applied = await applyIntegrationPlan(options.cwd, options.target);
  console.log(formatIntegrationPlan(options.target, applied.changes, false, "integrate"));
  if (applied.projectConfigCreated) {
    console.log("Additional setup: created .agent-memory/config.json.");
  }
  console.log(`Global changes were made: ${applied.globalChangesApplied ? "yes" : "no"}`);
  console.log("Suggested verification: agent-memory integrate --status");

  return 0;
}
