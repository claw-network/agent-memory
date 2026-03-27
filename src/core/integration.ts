import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { getDefaultConfig, writeConfig } from "./config-store";
import { stableStringify } from "./state-store";

const AGENTS_START = "<!-- agent-memory:codex-integration start -->";
const AGENTS_END = "<!-- agent-memory:codex-integration end -->";
const CODEX_CONFIG_START = "# agent-memory:codex-mcp start";
const CODEX_CONFIG_END = "# agent-memory:codex-mcp end";

function npxCommand(): { command: string; args: string[] } {
  return {
    command: "npx",
    args: ["--no-install", "agent-memory", "mcp"],
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function replaceManagedBlock(
  content: string | null,
  startMarker: string,
  endMarker: string,
  body: string,
): string {
  const normalizedBody = `${startMarker}\n${body.trimEnd()}\n${endMarker}\n`;
  if (!content || content.trim().length === 0) {
    return normalizedBody;
  }

  const pattern = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}\\n?`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, normalizedBody);
  }

  return `${content.replace(/\s*$/, "\n\n")}${normalizedBody}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function codexManagedBlock(): string {
  const command = npxCommand();
  return [
    CODEX_CONFIG_START,
    "[mcp_servers.agent-memory]",
    `command = "${command.command}"`,
    `args = ["${command.args.join('", "')}"]`,
    CODEX_CONFIG_END,
  ].join("\n");
}

export function mergeProjectMcpJson(existingContent: string | null): string {
  const parsed = existingContent && existingContent.trim().length > 0 ? JSON.parse(existingContent) as Record<string, unknown> : {};
  const mcpServers =
    parsed.mcpServers && typeof parsed.mcpServers === "object" && !Array.isArray(parsed.mcpServers)
      ? parsed.mcpServers as Record<string, unknown>
      : {};
  const command = npxCommand();
  mcpServers["agent-memory"] = {
    command: command.command,
    args: command.args,
  };

  return `${stableStringify({
    ...parsed,
    mcpServers,
  })}\n`;
}

export function mergeClaudeSettings(existingContent: string | null): string {
  const parsed = existingContent && existingContent.trim().length > 0 ? JSON.parse(existingContent) as Record<string, unknown> : {};
  const hooks =
    parsed.hooks && typeof parsed.hooks === "object" && !Array.isArray(parsed.hooks)
      ? { ...(parsed.hooks as Record<string, unknown>) }
      : {};

  function ensureHook(eventName: "SessionStart" | "Stop", command: string): void {
    const currentEntries = Array.isArray(hooks[eventName]) ? [...(hooks[eventName] as Array<Record<string, unknown>>)] : [];
    const hasHook = currentEntries.some((entry) => {
      const nestedHooks = Array.isArray(entry.hooks) ? entry.hooks : [];
      return nestedHooks.some(
        (hook) => hook && typeof hook === "object" && !Array.isArray(hook) && (hook as Record<string, unknown>).command === command,
      );
    });

    if (!hasHook) {
      currentEntries.push({
        hooks: [
          {
            type: "command",
            command,
          },
        ],
      });
    }

    hooks[eventName] = currentEntries;
  }

  ensureHook("SessionStart", "agent-memory automate ensure-running");
  ensureHook("Stop", "agent-memory automate run-once");

  return `${stableStringify({
    ...parsed,
    hooks,
  })}\n`;
}

export function buildClaudeSkillContent(): string {
  return [
    "# agent-memory",
    "",
    "Use the `agent-memory` MCP tools selectively for repository memory tasks.",
    "",
    "Call `memory_query` first when:",
    "- the user asks about project structure, recent changes, next steps, or known traps",
    "- the answer may already exist in canonical memory or history",
    "",
    "Call `memory_status` or `memory_validate` when:",
    "- you are about to make a large change and want to inspect maintenance health",
    "- you need to know whether recall backlog or drift is accumulating",
    "",
    "Call `automation_status`, `automation_ensure_running`, or `automation_run_once` when:",
    "- you need to confirm the background daemon is alive",
    "- you need a manual maintenance pass",
    "",
    "Do not call agent-memory on every answer. Prefer it for context recovery, maintenance, and repository-memory questions.",
  ].join("\n");
}

export function mergeAgentsMd(existingContent: string | null): string {
  const body = [
    "## agent-memory Integration",
    "",
    "This repository is integrated with the `agent-memory` MCP server.",
    "",
    "Prefer `agent-memory` tools when the task is about:",
    "- project structure or current focus",
    "- recent changes",
    "- next steps",
    "- known gotchas",
    "",
    "Before relying on automation, prefer this order:",
    "1. `automation_ensure_running`",
    "2. `memory_query`",
    "3. `memory_status`",
    "4. `memory_validate`",
    "5. `automation_run_once` when immediate maintenance is needed",
    "",
    "Pay special attention to automation state at session start, before compact, and at major task boundaries.",
  ].join("\n");

  return replaceManagedBlock(existingContent, AGENTS_START, AGENTS_END, body);
}

export function mergeCodexConfigToml(existingContent: string | null): string {
  const block = `${codexManagedBlock()}\n`;
  if (!existingContent || existingContent.trim().length === 0) {
    return block;
  }

  const managedPattern = new RegExp(`${escapeRegExp(CODEX_CONFIG_START)}[\\s\\S]*?${escapeRegExp(CODEX_CONFIG_END)}\\n?`, "m");
  if (managedPattern.test(existingContent)) {
    return existingContent.replace(managedPattern, block);
  }

  const explicitBlockPattern = /^\[mcp_servers\.agent-memory\]\n(?:.+\n)*/m;
  if (explicitBlockPattern.test(existingContent)) {
    return existingContent.replace(explicitBlockPattern, block);
  }

  return `${existingContent.replace(/\s*$/, "\n\n")}${block}`;
}

export function codexConfigPath(): string {
  if (process.env.AGENT_MEMORY_CODEX_CONFIG_PATH) {
    return process.env.AGENT_MEMORY_CODEX_CONFIG_PATH;
  }

  return join(process.env.HOME ?? "~", ".codex", "config.toml");
}

async function writeTextFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function readTextIfPresent(path: string): Promise<string | null> {
  return (await exists(path)) ? await readFile(path, "utf8") : null;
}

async function runCommand(binary: string, args: string[], cwd: string): Promise<{ code: number | null; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn(binary, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => resolve({ code, stderr }));
    child.on("error", () => resolve({ code: null, stderr }));
  });
}

export async function integrateClaudeProject(rootDir: string): Promise<string[]> {
  const updates: string[] = [];

  const mcpPath = join(rootDir, ".mcp.json");
  const mcpContent = mergeProjectMcpJson(await readTextIfPresent(mcpPath));
  await writeTextFile(mcpPath, mcpContent);
  updates.push(".mcp.json");

  const settingsPath = join(rootDir, ".claude", "settings.json");
  const settingsContent = mergeClaudeSettings(await readTextIfPresent(settingsPath));
  await writeTextFile(settingsPath, settingsContent);
  updates.push(".claude/settings.json");

  const skillPath = join(rootDir, ".claude", "skills", "agent-memory", "SKILL.md");
  await writeTextFile(skillPath, `${buildClaudeSkillContent()}\n`);
  updates.push(".claude/skills/agent-memory/SKILL.md");

  return updates;
}

export async function integrateCodexProject(rootDir: string): Promise<string[]> {
  const agentsPath = join(rootDir, "AGENTS.md");
  const agentsContent = mergeAgentsMd(await readTextIfPresent(agentsPath));
  await writeTextFile(agentsPath, agentsContent);
  return ["AGENTS.md"];
}

async function tryCodexCliRegistration(rootDir: string): Promise<boolean> {
  const codexBinary = process.env.AGENT_MEMORY_CODEX_BIN || "codex";
  const command = npxCommand();
  const result = await runCommand(
    codexBinary,
    ["mcp", "add", "agent-memory", "--", command.command, ...command.args],
    rootDir,
  );
  return result.code === 0;
}

export async function integrateCodexGlobal(rootDir: string): Promise<string[]> {
  const updates: string[] = [];
  void (await tryCodexCliRegistration(rootDir).catch(() => false));

  const path = codexConfigPath();
  const content = mergeCodexConfigToml(await readTextIfPresent(path));
  await writeTextFile(path, content);
  updates.push(path);
  return updates;
}

export async function ensureProjectConfigExists(rootDir: string): Promise<void> {
  const configPath = join(rootDir, ".agent-memory", "config.json");
  if (await exists(configPath)) {
    return;
  }

  await writeConfig(rootDir, getDefaultConfig());
}
