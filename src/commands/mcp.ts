import { runMcpServer as runMcpServerCore } from "../core/mcp-server";
import type { AutomationCommandOptions } from "../types";

export async function runMcpServer(options: AutomationCommandOptions): Promise<number> {
  await runMcpServerCore(options.cwd);
  return 0;
}
