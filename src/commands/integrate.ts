import {
  ensureProjectConfigExists,
  integrateClaudeProject,
  integrateCodexGlobal,
  integrateCodexProject,
} from "../core/integration";
import type { IntegrateCommandOptions } from "../types";

export async function runIntegrate(options: IntegrateCommandOptions): Promise<number> {
  await ensureProjectConfigExists(options.cwd);

  const updated: string[] = [];
  const target = options.target === "all" ? ["claude", "codex"] : [options.target];

  if (target.includes("claude")) {
    updated.push(...(await integrateClaudeProject(options.cwd)));
  }

  if (target.includes("codex")) {
    updated.push(...(await integrateCodexProject(options.cwd)));
    updated.push(...(await integrateCodexGlobal(options.cwd)));
  }

  console.log(`Integrated target: ${options.target}`);
  console.log("Updated files:");
  for (const path of updated) {
    console.log(`- ${path}`);
  }

  return 0;
}
