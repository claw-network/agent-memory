import { z } from "zod";
import { getAutomationStatus, ensureAutomationDaemonRunning, runAutomationCycle } from "./automation-orchestrator";
import { readLatestCheckpoint } from "./history-store";
import {
  MCP_LONG_RUNNING_PROGRESS_STAGES,
  defineMcpTool,
  formatAuditFindings,
  formatAutomationStatus,
  formatEnsureRunningResult,
  formatJsonResult,
  formatQueryResult,
  formatStatusReport,
  formatWorkflowResult,
} from "./mcp-contract";
import { runQuery as runQueryOrchestrator } from "./query-orchestrator";
import { buildStatusReport } from "./status-orchestrator";
import { validateMemory } from "./validate-memory";
import {
  buildMemoryAssessWorkflow,
  buildMemoryCompactHandoffWorkflow,
  runMemoryMaintainWorkflow,
} from "./workflow-orchestrator";

const queryScopeSchema = z.enum(["state", "history", "all"]);
const queryOutputSchema = z.enum(["text", "json"]);
const emptyInputSchema = z.object({}).strict();

export function getMcpToolRegistry() {
  return [
    defineMcpTool({
      name: "memory_assess",
      title: "Assess Memory Health",
      description: "Assess memory, validation, automation, and integration health in one workflow result.",
      inputSchema: emptyInputSchema,
      readOnly: true,
      execute: async (rootDir) => await buildMemoryAssessWorkflow(rootDir),
      formatResult: formatWorkflowResult,
    }),
    defineMcpTool({
      name: "memory_maintain",
      title: "Maintain Memory",
      description: "Run one high-level maintenance workflow and report whether sync/recall changed anything.",
      inputSchema: emptyInputSchema,
      readOnly: false,
      progressStages: MCP_LONG_RUNNING_PROGRESS_STAGES,
      execute: async (rootDir) => await runMemoryMaintainWorkflow(rootDir),
      formatResult: formatWorkflowResult,
    }),
    defineMcpTool({
      name: "memory_compact_handoff",
      title: "Build Compact Handoff",
      description: "Build a compact-ready handoff summary from current focus, backlog, automation, and validation state.",
      inputSchema: emptyInputSchema,
      readOnly: true,
      execute: async (rootDir) => await buildMemoryCompactHandoffWorkflow(rootDir),
      formatResult: formatWorkflowResult,
    }),
    defineMcpTool({
      name: "memory_query",
      title: "Query Memory",
      description: "Query repository memory with natural-language retrieval modes.",
      inputSchema: z.object({
        question: z.string().min(1),
        scope: queryScopeSchema.optional(),
        output: queryOutputSchema.optional(),
      }).strict(),
      readOnly: true,
      progressStages: MCP_LONG_RUNNING_PROGRESS_STAGES,
      execute: async (rootDir, args) =>
        await runQueryOrchestrator({
          cwd: rootDir,
          provider: "auto",
          scope: args.scope ?? "all",
          question: args.question,
          output: args.output ?? null,
        }),
      formatResult: formatQueryResult,
    }),
    defineMcpTool({
      name: "memory_status",
      title: "Inspect Memory Status",
      description: "Inspect memory maintenance status, backlog, and checkpoint drift.",
      inputSchema: z.object({
        checkpointId: z.string().min(1).optional(),
        showDiff: z.boolean().optional(),
      }).strict(),
      readOnly: true,
      execute: async (rootDir, args) => {
        const checkpoint = args.checkpointId ? await readLatestCheckpoint(rootDir, args.checkpointId) : null;
        return await buildStatusReport(rootDir, checkpoint, args.showDiff === true);
      },
      formatResult: formatStatusReport,
    }),
    defineMcpTool({
      name: "memory_validate",
      title: "Validate Memory",
      description: "Validate the current canonical memory system and automation metadata.",
      inputSchema: emptyInputSchema,
      readOnly: true,
      progressStages: MCP_LONG_RUNNING_PROGRESS_STAGES,
      execute: async (rootDir) => await validateMemory(rootDir),
      formatResult: formatAuditFindings,
    }),
    defineMcpTool({
      name: "automation_status",
      title: "Inspect Automation Status",
      description: "Read local automation daemon status and latest run metadata.",
      inputSchema: emptyInputSchema,
      readOnly: true,
      execute: async (rootDir) => await getAutomationStatus(rootDir),
      formatResult: formatAutomationStatus,
    }),
    defineMcpTool({
      name: "automation_ensure_running",
      title: "Ensure Automation Running",
      description: "Ensure the local automation daemon is running.",
      inputSchema: emptyInputSchema,
      readOnly: false,
      execute: async (rootDir) => await ensureAutomationDaemonRunning(rootDir),
      formatResult: formatEnsureRunningResult,
    }),
    defineMcpTool({
      name: "automation_run_once",
      title: "Run Automation Once",
      description: "Run one automation maintenance cycle immediately.",
      inputSchema: emptyInputSchema,
      readOnly: false,
      execute: async (rootDir) => await runAutomationCycle(rootDir),
      formatResult: formatJsonResult,
    }),
  ];
}
