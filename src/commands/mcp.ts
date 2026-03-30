import { runMcpServer as runMcpServerCore } from "../core/mcp-server";
import type { McpCommandOptions } from "../types";

export async function runMcpServer(options: McpCommandOptions): Promise<number> {
  await runMcpServerCore(options);
  return 0;
}
