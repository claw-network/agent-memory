import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AuditFinding, QueryResult, StatusReport } from "../types";

export const MCP_STRUCTURED_CONTENT_SCHEMA_VERSION = 1;
export const MCP_LONG_RUNNING_PROGRESS_STAGES = [
  "Loading state",
  "Running workflow",
  "Summarizing result",
] as const;

export type McpToolErrorCode =
  | "tool_not_found"
  | "invalid_arguments"
  | "execution_failed";

export interface McpToolSpec<TInputSchema extends z.ZodTypeAny = z.ZodTypeAny, TResult = unknown> {
  name: string;
  title: string;
  description: string;
  inputSchema: TInputSchema;
  readOnly: boolean;
  progressStages?: readonly string[];
  execute: (rootDir: string, args: z.output<TInputSchema>) => Promise<TResult>;
  formatResult?: (result: TResult) => string;
}

export function defineMcpTool<TInputSchema extends z.ZodTypeAny, TResult>(
  tool: McpToolSpec<TInputSchema, TResult>,
): McpToolSpec<TInputSchema, TResult> {
  return tool;
}

interface WorkflowLikeResult {
  status: string;
  summary: string;
  suggestedNextAction: string;
  warnings: string[];
  errors: string[];
}

export function isWorkflowResult(value: unknown): value is WorkflowLikeResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.status === "string" &&
    typeof record.summary === "string" &&
    typeof record.suggestedNextAction === "string" &&
    Array.isArray(record.warnings) &&
    Array.isArray(record.errors)
  );
}

export function formatWorkflowResult(value: WorkflowLikeResult): string {
  const lines = [
    `Status: ${value.status}`,
    `Summary: ${value.summary}`,
    `Suggested Next Action: ${value.suggestedNextAction}`,
  ];

  if (value.warnings.length > 0) {
    lines.push(`Warnings: ${value.warnings.join(" | ")}`);
  }

  if (value.errors.length > 0) {
    lines.push(`Errors: ${value.errors.join(" | ")}`);
  }

  return lines.join("\n");
}

export function formatQueryResult(result: QueryResult): string {
  const lines = [
    "Answer:",
    result.answer,
    "",
    `Mode: ${result.mode}`,
    "",
    "Why this answer:",
    result.why,
  ];

  if (result.citations.length > 0) {
    lines.push("", "Citations:");
    for (const citation of result.citations) {
      const projection = citation.projectionPath ? ` -> ${citation.projectionPath}` : "";
      lines.push(`- [${citation.sourceType}] ${citation.sourceId} ${citation.pathOrSection}: ${citation.summary}${projection}`);
    }
  }

  return lines.join("\n");
}

export function formatStatusReport(report: StatusReport): string {
  const failedSources = report.sources.filter((source) => source.status === "failed").length;
  return [
    `Latest checkpoint: ${report.state.latestCheckpointId ?? "none"}`,
    `Unrecalled backlog: ${report.history.unrecalledAll} total (${report.history.unrecalledLocal} local, ${report.history.unrecalledImports} imports)`,
    `Sources: ${report.sources.length} total, ${failedSources} failed`,
    `Retention candidates: ${report.retention.pruneCandidateEventCount} event(s), ${report.retention.pruneCandidateCheckpointCount} checkpoint(s)`,
    `Suggested Next Action: ${report.suggestedNextAction}`,
  ].join("\n");
}

export function formatAuditFindings(findings: AuditFinding[]): string {
  const failCount = findings.filter((finding) => finding.status === "fail").length;
  const warnCount = findings.filter((finding) => finding.status === "warn").length;
  const passCount = findings.filter((finding) => finding.status === "pass").length;
  const lines = [
    `Summary: ${failCount} fail, ${warnCount} warn, ${passCount} pass`,
  ];

  for (const finding of findings.filter((finding) => finding.status !== "pass").slice(0, 5)) {
    lines.push(`- [${finding.status}] ${finding.code}: ${finding.message}`);
  }

  if (lines.length === 1 && findings[0]) {
    lines.push(`- [${findings[0].status}] ${findings[0].code}: ${findings[0].message}`);
  }

  return lines.join("\n");
}

export function formatAutomationStatus(status: {
  running: boolean;
  daemon: { pid: number } | null;
  latestRun: { status: string; finishedAt: string } | null;
}): string {
  return [
    `Running: ${status.running ? "yes" : "no"}`,
    `PID: ${status.daemon?.pid ?? "none"}`,
    `Latest run: ${status.latestRun ? `${status.latestRun.status} at ${status.latestRun.finishedAt}` : "none"}`,
  ].join("\n");
}

export function formatEnsureRunningResult(result: { started: boolean; pid: number }): string {
  return result.started
    ? `Automation daemon started with pid ${result.pid}.`
    : `Automation daemon is already running with pid ${result.pid}.`;
}

export function formatJsonResult(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function toolAnnotations(input: { title: string; readOnly: boolean }): ToolAnnotations {
  return {
    title: input.title,
    readOnlyHint: input.readOnly,
    destructiveHint: !input.readOnly,
    idempotentHint: input.readOnly,
    openWorldHint: false,
  };
}

export function buildSuccessResult<T>(toolName: string, data: T, text: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    structuredContent: {
      tool: toolName,
      schemaVersion: MCP_STRUCTURED_CONTENT_SCHEMA_VERSION,
      data,
    },
  };
}

export function buildErrorResult(
  toolName: string,
  code: McpToolErrorCode,
  message: string,
  details?: unknown,
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: `Error [${code}]: ${message}`,
      },
    ],
    structuredContent: {
      tool: toolName,
      schemaVersion: MCP_STRUCTURED_CONTENT_SCHEMA_VERSION,
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    isError: true,
  };
}
