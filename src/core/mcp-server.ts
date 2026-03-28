import { stdin, stdout } from "node:process";
import { getAutomationStatus, ensureAutomationDaemonRunning, runAutomationCycle } from "./automation-orchestrator";
import { buildStatusReport } from "./status-orchestrator";
import { runQuery as runQueryOrchestrator } from "./query-orchestrator";
import { validateMemory } from "./validate-memory";
import { readLatestCheckpoint } from "./history-store";
import {
  buildMemoryAssessWorkflow,
  buildMemoryCompactHandoffWorkflow,
  runMemoryMaintainWorkflow,
} from "./workflow-orchestrator";

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  invoke: (rootDir: string, argumentsValue: Record<string, unknown>) => Promise<unknown>;
}

function isWorkflowResult(value: unknown): value is {
  status: string;
  summary: string;
  suggestedNextAction: string;
  warnings: string[];
  errors: string[];
  details: unknown;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.status === "string" &&
    typeof record.summary === "string" &&
    typeof record.suggestedNextAction === "string" &&
    Array.isArray(record.warnings) &&
    Array.isArray(record.errors) &&
    Object.prototype.hasOwnProperty.call(record, "details")
  );
}

function formatWorkflowResult(value: {
  status: string;
  summary: string;
  suggestedNextAction: string;
  warnings: string[];
  errors: string[];
}): string {
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

function writeMessage(message: Record<string, unknown>): void {
  const payload = JSON.stringify(message);
  const bytes = Buffer.byteLength(payload, "utf8");
  stdout.write(`Content-Length: ${bytes}\r\n\r\n${payload}`);
}

function toolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "memory_assess",
      description: "Assess memory, validation, automation, and integration health in one workflow result.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      invoke: async (rootDir) => await buildMemoryAssessWorkflow(rootDir),
    },
    {
      name: "memory_maintain",
      description: "Run one high-level maintenance workflow and report whether sync/recall changed anything.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      invoke: async (rootDir) => await runMemoryMaintainWorkflow(rootDir),
    },
    {
      name: "memory_compact_handoff",
      description: "Build a compact-ready handoff summary from current focus, backlog, automation, and validation state.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      invoke: async (rootDir) => await buildMemoryCompactHandoffWorkflow(rootDir),
    },
    {
      name: "memory_query",
      description: "Query repository memory with natural-language retrieval modes.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["question"],
        properties: {
          question: { type: "string" },
          scope: { type: "string", enum: ["state", "history", "all"] },
          output: { type: "string", enum: ["text", "json"] },
        },
      },
      invoke: async (rootDir, args) =>
        await runQueryOrchestrator({
          cwd: rootDir,
          provider: "auto",
          scope: typeof args.scope === "string" ? args.scope as "state" | "history" | "all" : "all",
          question: String(args.question),
          output: typeof args.output === "string" ? args.output as "text" | "json" : null,
        }),
    },
    {
      name: "memory_status",
      description: "Inspect memory maintenance status, backlog, and checkpoint drift.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          checkpointId: { type: "string" },
          showDiff: { type: "boolean" },
        },
      },
      invoke: async (rootDir, args) => {
        const checkpointId = typeof args.checkpointId === "string" ? args.checkpointId : null;
        const checkpoint = checkpointId ? await readLatestCheckpoint(rootDir, checkpointId) : null;
        return await buildStatusReport(rootDir, checkpoint, args.showDiff === true);
      },
    },
    {
      name: "memory_validate",
      description: "Validate the current canonical memory system and automation metadata.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      invoke: async (rootDir) => await validateMemory(rootDir),
    },
    {
      name: "automation_status",
      description: "Read local automation daemon status and latest run metadata.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      invoke: async (rootDir) => await getAutomationStatus(rootDir),
    },
    {
      name: "automation_ensure_running",
      description: "Ensure the local automation daemon is running.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      invoke: async (rootDir) => await ensureAutomationDaemonRunning(rootDir),
    },
    {
      name: "automation_run_once",
      description: "Run one automation maintenance cycle immediately.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      invoke: async (rootDir) => await runAutomationCycle(rootDir),
    },
  ];
}

function response(id: unknown, result: unknown): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function errorResponse(id: unknown, code: number, message: string): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

async function handleRequest(rootDir: string, request: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const id = request.id;
  const method = request.method;
  if (typeof method !== "string") {
    return errorResponse(id, -32600, "Invalid request.");
  }

  if (method === "initialize") {
    return response(id, {
      protocolVersion: "2025-06-18",
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: "agent-memory",
        version: "0.2.1",
      },
    });
  }

  if (method === "notifications/initialized") {
    return null;
  }

  if (method === "tools/list") {
    return response(id, {
      tools: toolDefinitions().map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    });
  }

  if (method === "tools/call") {
    const params = request.params;
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      return errorResponse(id, -32602, "Invalid tool call params.");
    }

    const requestParams = params as Record<string, unknown>;

    const toolName = typeof requestParams.name === "string" ? requestParams.name : "";
    const args = requestParams.arguments && typeof requestParams.arguments === "object" && !Array.isArray(requestParams.arguments)
      ? requestParams.arguments as Record<string, unknown>
      : {};
    const tool = toolDefinitions().find((entry) => entry.name === toolName);
    if (!tool) {
      return errorResponse(id, -32601, `Unknown tool: ${toolName}`);
    }

    try {
      const result = await tool.invoke(rootDir, args);
      return response(id, {
        content: [
          {
            type: "text",
            text: isWorkflowResult(result) ? formatWorkflowResult(result) : JSON.stringify(result, null, 2),
          },
        ],
        ...(result && typeof result === "object" && !Array.isArray(result) ? { structuredContent: result } : {}),
      });
    } catch (error) {
      return response(id, {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      });
    }
  }

  return errorResponse(id, -32601, `Unknown method: ${method}`);
}

export async function runMcpServer(rootDir: string): Promise<void> {
  let buffer = Buffer.alloc(0);
  stdin.on("data", async (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        break;
      }

      const header = buffer.slice(0, headerEnd).toString("utf8");
      const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!contentLengthMatch) {
        buffer = Buffer.alloc(0);
        writeMessage(errorResponse(null, -32700, "Missing Content-Length header."));
        break;
      }

      const contentLength = Number(contentLengthMatch[1]);
      const totalLength = headerEnd + 4 + contentLength;
      if (buffer.length < totalLength) {
        break;
      }

      const payloadBuffer = buffer.slice(headerEnd + 4, totalLength);
      buffer = buffer.slice(totalLength);

      try {
        const request = JSON.parse(payloadBuffer.toString("utf8")) as Record<string, unknown>;
        const result = await handleRequest(rootDir, request);
        if (result) {
          writeMessage(result);
        }
      } catch (error) {
        writeMessage(errorResponse(null, -32700, error instanceof Error ? error.message : String(error)));
      }
    }
  });

  stdin.resume();
  await new Promise(() => undefined);
}
