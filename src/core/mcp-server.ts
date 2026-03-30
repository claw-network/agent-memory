import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ProgressNotification, Tool } from "@modelcontextprotocol/sdk/types.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ZodError, z } from "zod";
import type { McpCommandOptions } from "../types";
import { GENERATOR_VERSION } from "./constants";
import { McpSessionBackend } from "./mcp-backend";
import {
  buildErrorResult,
  buildSuccessResult,
  formatJsonResult,
  toolAnnotations,
} from "./mcp-contract";
import { getMcpToolRegistry } from "./mcp-tools";

const MCP_HTTP_PATH = "/mcp";
const MCP_SERVER_INSTRUCTIONS = [
  "Prefer memory_assess at repository entry.",
  "Use memory_compact_handoff before compact or handoff.",
  "Use memory_maintain for a one-shot maintenance pass.",
].join(" ");

type ToolSpec = ReturnType<typeof getMcpToolRegistry>[number];
type ToolMap = Map<string, ToolSpec>;

interface HttpSession {
  server: Server;
  transport: StreamableHTTPServerTransport;
}

function asToolSchema(tool: ToolSpec): Tool {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.inputSchema) as Tool["inputSchema"],
    annotations: toolAnnotations({
      title: tool.title,
      readOnly: tool.readOnly,
    }),
  };
}

async function sendProgressNotification(
  progressToken: string | number | undefined,
  sendNotification: (notification: ProgressNotification) => Promise<void>,
  stageIndex: number,
  totalStages: number,
  message: string,
): Promise<void> {
  if (progressToken === undefined) {
    return;
  }

  await sendNotification({
    method: "notifications/progress",
    params: {
      progressToken,
      progress: stageIndex,
      total: totalStages,
      message,
    },
  });
}

function formatZodError(error: ZodError): { message: string; details: unknown } {
  return {
    message: error.issues.map((issue) => issue.message).join(" | "),
    details: error.issues.map((issue) => ({
      code: issue.code,
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

function createProtocolServer(defaultRootDir: string): Server {
  const tools = getMcpToolRegistry();
  const toolMap: ToolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const listedTools = tools.map(asToolSchema);
  const server = new Server(
    {
      name: "agent-memory",
      version: GENERATOR_VERSION,
    },
    {
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      instructions: MCP_SERVER_INSTRUCTIONS,
    },
  );
  const backend = new McpSessionBackend(defaultRootDir, server);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listedTools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const toolName = request.params.name;
    const tool = toolMap.get(toolName);
    if (!tool) {
      return buildErrorResult(toolName, "tool_not_found", `Unknown tool: ${toolName}`);
    }

    let args: unknown;
    try {
      args = tool.inputSchema.parse(request.params.arguments ?? {});
    } catch (error) {
      if (error instanceof ZodError) {
        const formatted = formatZodError(error);
        return buildErrorResult(tool.name, "invalid_arguments", formatted.message, formatted.details);
      }
      return buildErrorResult(
        tool.name,
        "invalid_arguments",
        error instanceof Error ? error.message : String(error),
      );
    }

    try {
      const totalStages = tool.progressStages?.length ?? 0;
      if (tool.progressStages && totalStages > 0) {
        await sendProgressNotification(
          extra._meta?.progressToken,
          extra.sendNotification,
          1,
          totalStages,
          tool.progressStages[0],
        );
      }

      const rootDir = await backend.getRootDir();

      if (tool.progressStages && totalStages > 1) {
        await sendProgressNotification(
          extra._meta?.progressToken,
          extra.sendNotification,
          2,
          totalStages,
          tool.progressStages[1],
        );
      }

      const result = await tool.execute(rootDir, args as never);

      if (tool.progressStages && totalStages > 2) {
        await sendProgressNotification(
          extra._meta?.progressToken,
          extra.sendNotification,
          3,
          totalStages,
          tool.progressStages[2],
        );
      }

      const text = tool.formatResult ? tool.formatResult(result as never) : formatJsonResult(result);
      return buildSuccessResult(tool.name, result, text);
    } catch (error) {
      return buildErrorResult(
        tool.name,
        "execution_failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  return server;
}

function normalizeLoopbackHost(hostname: string): string {
  if (
    hostname === "0.0.0.0" ||
    hostname === "::" ||
    hostname === "::1" ||
    hostname === "127.0.0.1"
  ) {
    return "localhost";
  }

  return hostname;
}

function listenAddressUrl(address: AddressInfo): URL {
  const host = normalizeLoopbackHost(address.address);
  const wrappedHost = address.family === "IPv6" && !host.startsWith("[") ? `[${host}]` : host;
  return new URL(`http://${wrappedHost}:${address.port}`);
}

function allowedHostsForServer(url: URL, configured: string[]): string[] {
  if (configured.length > 0) {
    return configured.map((host) => host.toLowerCase());
  }

  const hosts = new Set<string>([url.host.toLowerCase()]);
  if (url.port) {
    hosts.add(`localhost:${url.port}`.toLowerCase());
    hosts.add(`127.0.0.1:${url.port}`.toLowerCase());
    hosts.add(`[::1]:${url.port}`.toLowerCase());
  }
  return Array.from(hosts);
}

function isAllowedHost(hostHeader: string | undefined, allowedHosts: string[]): boolean {
  if (!hostHeader) {
    return false;
  }

  return allowedHosts.includes(hostHeader.toLowerCase());
}

async function attachHttpSession(
  sessions: Map<string, HttpSession>,
  rootDir: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let sessionServer: Server | null = null;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: async (sessionId) => {
      if (!sessionServer) {
        return;
      }
      sessions.set(sessionId, {
        server: sessionServer,
        transport,
      });
    },
    onsessionclosed: async (sessionId) => {
      const session = sessions.get(sessionId);
      sessions.delete(sessionId);
      await session?.server.close().catch(() => undefined);
    },
  });

  sessionServer = createProtocolServer(rootDir);
  transport.onclose = () => {
    const sessionId = transport.sessionId;
    if (!sessionId) {
      return;
    }
    const session = sessions.get(sessionId);
    sessions.delete(sessionId);
    void session?.server.close().catch(() => undefined);
  };

  await sessionServer.connect(transport);
  await transport.handleRequest(req, res);
}

async function runHttpMcpServer(options: McpCommandOptions): Promise<void> {
  const port = options.port;
  if (port === null) {
    throw new Error("The --port flag is required when using --transport=http.");
  }

  const host = options.host ?? "127.0.0.1";
  const sessions = new Map<string, HttpSession>();
  const server = createHttpServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? "/", "http://localhost");
      if (requestUrl.pathname !== MCP_HTTP_PATH) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const address = server.address();
      if (!address || typeof address === "string") {
        res.statusCode = 500;
        res.end("Server address is unavailable");
        return;
      }

      const allowedHosts = allowedHostsForServer(listenAddressUrl(address), options.allowedHosts);
      if (!isAllowedHost(req.headers.host, allowedHosts)) {
        res.statusCode = 403;
        res.end(`Access is only allowed at ${allowedHosts.join(", ")}`);
        return;
      }

      const sessionIdHeader = req.headers["mcp-session-id"];
      const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
      if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session) {
          res.statusCode = 404;
          res.end("Session not found");
          return;
        }

        await session.transport.handleRequest(req, res);
        return;
      }

      if (req.method === "POST") {
        await attachHttpSession(sessions, options.cwd, req, res);
        return;
      }

      res.statusCode = 400;
      res.end("Session ID is required for this request");
    } catch (error) {
      res.statusCode = 500;
      res.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to determine the HTTP MCP server address.");
  }

  const url = listenAddressUrl(address);
  console.error([
    `Listening on ${url.toString()}`,
    "Put this in your client config:",
    JSON.stringify({
      mcpServers: {
        "agent-memory": {
          url: new URL(MCP_HTTP_PATH, url).toString(),
        },
      },
    }, null, 2),
    "Default integrate-generated config still uses stdio via `npx agent-memory mcp`.",
  ].join("\n"));

  await new Promise<void>(() => undefined);
}

export async function runMcpServer(options: McpCommandOptions): Promise<void> {
  if (options.transport === "http") {
    await runHttpMcpServer(options);
    return;
  }

  const server = createProtocolServer(options.cwd);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>(() => undefined);
}
