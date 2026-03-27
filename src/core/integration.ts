import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { getDefaultConfig, writeConfig } from "./config-store";
import { stableStringify } from "./state-store";
import type {
  IntegrationActionResult,
  IntegrationActionType,
  IntegrationComponent,
  IntegrationScope,
  IntegrationStatusItem,
  IntegrationStatusReport,
  IntegrationTarget,
} from "../types";

const AGENTS_START = "<!-- agent-memory:codex-integration start -->";
const AGENTS_END = "<!-- agent-memory:codex-integration end -->";
const CODEX_CONFIG_START = "# agent-memory:codex-mcp start";
const CODEX_CONFIG_END = "# agent-memory:codex-mcp end";
const CLAUDE_SKILL_MARKER = "Use the `agent-memory` MCP tools selectively for repository memory tasks.";
const CLAUDE_SESSION_START_COMMAND = "agent-memory automate ensure-running";
const CLAUDE_STOP_COMMAND = "agent-memory automate run-once";

interface PlannedIntegrationChange extends IntegrationActionResult {
  nextContent: string;
}

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

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n");
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

function changeAction(currentContent: string | null, nextContent: string): IntegrationActionType {
  if (currentContent === null) {
    return "create";
  }

  return normalizeText(currentContent) === normalizeText(nextContent) ? "unchanged" : "update";
}

function createPlannedChange(input: {
  path: string;
  scope: IntegrationScope;
  component: IntegrationComponent;
  note: string;
  currentContent: string | null;
  nextContent: string;
}): PlannedIntegrationChange {
  return {
    path: input.path,
    scope: input.scope,
    component: input.component,
    note: input.note,
    action: changeAction(input.currentContent, input.nextContent),
    nextContent: input.nextContent,
  };
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

function projectMcpPath(rootDir: string): string {
  return join(rootDir, ".mcp.json");
}

function claudeSettingsPath(rootDir: string): string {
  return join(rootDir, ".claude", "settings.json");
}

function claudeSkillPath(rootDir: string): string {
  return join(rootDir, ".claude", "skills", "agent-memory", "SKILL.md");
}

function agentsPath(rootDir: string): string {
  return join(rootDir, "AGENTS.md");
}

function projectConfigPath(rootDir: string): string {
  return join(rootDir, ".agent-memory", "config.json");
}

export function codexConfigPath(): string {
  if (process.env.AGENT_MEMORY_CODEX_CONFIG_PATH) {
    return process.env.AGENT_MEMORY_CODEX_CONFIG_PATH;
  }

  return join(process.env.HOME ?? "~", ".codex", "config.toml");
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

  ensureHook("SessionStart", CLAUDE_SESSION_START_COMMAND);
  ensureHook("Stop", CLAUDE_STOP_COMMAND);

  return `${stableStringify({
    ...parsed,
    hooks,
  })}\n`;
}

export function buildClaudeSkillContent(): string {
  return [
    "# agent-memory",
    "",
    CLAUDE_SKILL_MARKER,
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

function hasExpectedAgentMemoryMcpJson(content: string): boolean {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const mcpServers =
    parsed.mcpServers && typeof parsed.mcpServers === "object" && !Array.isArray(parsed.mcpServers)
      ? parsed.mcpServers as Record<string, unknown>
      : null;
  const command = npxCommand();
  if (!mcpServers || !mcpServers["agent-memory"] || typeof mcpServers["agent-memory"] !== "object" || Array.isArray(mcpServers["agent-memory"])) {
    return false;
  }

  const server = mcpServers["agent-memory"] as Record<string, unknown>;
  return (
    server.command === command.command &&
    Array.isArray(server.args) &&
    stableStringify(server.args) === stableStringify(command.args)
  );
}

function hasExpectedClaudeHooks(content: string): boolean {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const hooks =
    parsed.hooks && typeof parsed.hooks === "object" && !Array.isArray(parsed.hooks)
      ? parsed.hooks as Record<string, unknown>
      : null;
  if (!hooks) {
    return false;
  }
  const hooksRecord = hooks;

  function hasCommand(eventName: "SessionStart" | "Stop", command: string): boolean {
    const entries = Array.isArray(hooksRecord[eventName]) ? hooksRecord[eventName] as Array<Record<string, unknown>> : [];
    return entries.some((entry) => {
      const nestedHooks = Array.isArray(entry.hooks) ? entry.hooks : [];
      return nestedHooks.some(
        (hook) => hook && typeof hook === "object" && !Array.isArray(hook) && (hook as Record<string, unknown>).command === command,
      );
    });
  }

  return hasCommand("SessionStart", CLAUDE_SESSION_START_COMMAND) && hasCommand("Stop", CLAUDE_STOP_COMMAND);
}

function hasExpectedClaudeSkill(content: string): boolean {
  return content.includes(CLAUDE_SKILL_MARKER);
}

function hasExpectedAgentsBlock(content: string): boolean {
  return content.includes(AGENTS_START) && content.includes(AGENTS_END);
}

function hasExpectedCodexManagedBlock(content: string): boolean {
  return normalizeText(content).includes(normalizeText(codexManagedBlock()));
}

function statusItem(
  status: IntegrationStatusItem["status"],
  path: string,
  scope: IntegrationScope,
  note: string,
): IntegrationStatusItem {
  return { status, path, scope, note };
}

async function inspectFile(
  actualPath: string,
  displayPath: string,
  scope: IntegrationScope,
  checker: (content: string) => boolean,
  notes: {
    present: string;
    missing: string;
    mismatch: string;
    unreadable: string;
  },
): Promise<IntegrationStatusItem> {
  if (!(await exists(actualPath))) {
    return statusItem("missing", displayPath, scope, notes.missing);
  }

  try {
    const content = await readFile(actualPath, "utf8");
    return checker(content)
      ? statusItem("present", displayPath, scope, notes.present)
      : statusItem("managed_mismatch", displayPath, scope, notes.mismatch);
  } catch {
    return statusItem("unreadable", displayPath, scope, notes.unreadable);
  }
}

async function planClaudeProjectIntegration(rootDir: string): Promise<PlannedIntegrationChange[]> {
  const mcpPath = projectMcpPath(rootDir);
  const mcpCurrent = await readTextIfPresent(mcpPath);
  const settingsPath = claudeSettingsPath(rootDir);
  const settingsCurrent = await readTextIfPresent(settingsPath);
  const skillPath = claudeSkillPath(rootDir);
  const skillCurrent = await readTextIfPresent(skillPath);

  return [
    createPlannedChange({
      path: ".mcp.json",
      scope: "project",
      component: "claude-mcp",
      note: "Ensure Claude Code project MCP points to `agent-memory mcp`.",
      currentContent: mcpCurrent,
      nextContent: mergeProjectMcpJson(mcpCurrent),
    }),
    createPlannedChange({
      path: ".claude/settings.json",
      scope: "project",
      component: "claude-hooks",
      note: "Ensure SessionStart and Stop hooks manage automation startup and maintenance.",
      currentContent: settingsCurrent,
      nextContent: mergeClaudeSettings(settingsCurrent),
    }),
    createPlannedChange({
      path: ".claude/skills/agent-memory/SKILL.md",
      scope: "project",
      component: "claude-skill",
      note: "Install the project-managed Claude skill for agent-memory usage guidance.",
      currentContent: skillCurrent,
      nextContent: `${buildClaudeSkillContent()}\n`,
    }),
  ];
}

async function planCodexProjectIntegration(rootDir: string): Promise<PlannedIntegrationChange[]> {
  const current = await readTextIfPresent(agentsPath(rootDir));
  return [
    createPlannedChange({
      path: "AGENTS.md",
      scope: "project",
      component: "codex-agents",
      note: "Insert or refresh the managed AGENTS.md guidance block for Codex.",
      currentContent: current,
      nextContent: mergeAgentsMd(current),
    }),
  ];
}

async function planCodexGlobalIntegration(): Promise<PlannedIntegrationChange[]> {
  const path = codexConfigPath();
  const current = await readTextIfPresent(path);
  return [
    createPlannedChange({
      path,
      scope: "user",
      component: "codex-global-mcp",
      note: "Register or refresh the global Codex MCP entry for `agent-memory`.",
      currentContent: current,
      nextContent: mergeCodexConfigToml(current),
    }),
  ];
}

async function applyPlannedChangesForRoot(rootDir: string, changes: PlannedIntegrationChange[]): Promise<void> {
  for (const change of changes) {
    if (change.action === "unchanged") {
      continue;
    }
    const absolutePath = change.scope === "user" ? change.path : join(rootDir, change.path);
    await writeTextFile(absolutePath, change.nextContent);
  }
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

function selectedTargets(target: IntegrationTarget): IntegrationTarget[] {
  return target === "all" ? ["claude", "codex"] : [target];
}

function missingItemLabel(prefix: string, item: IntegrationStatusItem): string | null {
  return item.status === "missing" ? prefix : null;
}

export async function buildIntegrationStatusReport(rootDir: string, target: IntegrationTarget): Promise<IntegrationStatusReport> {
  const claude = {
    mcpProjectConfig: await inspectFile(projectMcpPath(rootDir), ".mcp.json", "project", hasExpectedAgentMemoryMcpJson, {
      present: "Claude Code project MCP configuration is present.",
      missing: "Claude Code project MCP configuration is missing.",
      mismatch: "Claude Code project MCP configuration does not match the managed agent-memory entry.",
      unreadable: "Claude Code project MCP configuration could not be parsed.",
    }),
    settingsHooks: await inspectFile(claudeSettingsPath(rootDir), ".claude/settings.json", "project", hasExpectedClaudeHooks, {
      present: "Claude Code SessionStart and Stop hooks are present.",
      missing: "Claude Code project hooks are missing.",
      mismatch: "Claude Code project hooks are present but do not match the expected commands.",
      unreadable: "Claude Code project settings could not be parsed.",
    }),
    skills: await inspectFile(claudeSkillPath(rootDir), ".claude/skills/agent-memory/SKILL.md", "project", hasExpectedClaudeSkill, {
      present: "Claude Code project skill is present.",
      missing: "Claude Code project skill is missing.",
      mismatch: "Claude Code project skill exists but does not contain the expected agent-memory guidance.",
      unreadable: "Claude Code project skill could not be read.",
    }),
  };

  const codex = {
    agentsGuidance: await inspectFile(agentsPath(rootDir), "AGENTS.md", "project", hasExpectedAgentsBlock, {
      present: "Codex AGENTS.md guidance is present.",
      missing: "Codex AGENTS.md guidance is missing.",
      mismatch: "Codex AGENTS.md exists but the managed agent-memory block is missing or changed.",
      unreadable: "AGENTS.md could not be read.",
    }),
    globalMcpConfig: await inspectFile(codexConfigPath(), codexConfigPath(), "user", hasExpectedCodexManagedBlock, {
      present: "Codex global MCP configuration is present.",
      missing: "Codex global MCP configuration is missing.",
      mismatch: "Codex global MCP configuration exists but the managed agent-memory block is missing or changed.",
      unreadable: "Codex global MCP configuration could not be read.",
    }),
  };

  const warnings: string[] = [];
  if (!(await exists(projectConfigPath(rootDir)))) {
    warnings.push("Project config missing; normal integrate would create .agent-memory/config.json.");
  }

  const selected = selectedTargets(target);
  const relevantItems = [
    ...(selected.includes("claude")
      ? [
          ["claude.mcpProjectConfig", claude.mcpProjectConfig],
          ["claude.settingsHooks", claude.settingsHooks],
          ["claude.skills", claude.skills],
        ]
      : []),
    ...(selected.includes("codex")
      ? [
          ["codex.agentsGuidance", codex.agentsGuidance],
          ["codex.globalMcpConfig", codex.globalMcpConfig],
        ]
      : []),
  ] as Array<[string, IntegrationStatusItem]>;

  const missingItems = relevantItems
    .map(([label, item]) => missingItemLabel(label, item))
    .filter((value): value is string => value !== null);
  warnings.push(
    ...relevantItems
      .filter(([, item]) => item.status === "managed_mismatch" || item.status === "unreadable")
      .map(([label, item]) => `${label}: ${item.note}`),
  );

  const healthy = relevantItems.every(([, item]) => item.status === "present");
  let suggestedNextAction = "No action is required.";
  if (!healthy) {
    const hasClaudeMissing = selected.includes("claude") && [claude.mcpProjectConfig, claude.settingsHooks, claude.skills].some((item) => item.status === "missing");
    const hasCodexMissing = selected.includes("codex") && [codex.agentsGuidance, codex.globalMcpConfig].some((item) => item.status === "missing");
    const hasMismatch = relevantItems.some(([, item]) => item.status === "managed_mismatch" || item.status === "unreadable");

    if (hasClaudeMissing && !hasCodexMissing && !hasMismatch) {
      suggestedNextAction = "Run `agent-memory integrate claude`.";
    } else if (hasCodexMissing && !hasClaudeMissing && !hasMismatch) {
      suggestedNextAction = "Run `agent-memory integrate codex`.";
    } else if (hasMismatch) {
      suggestedNextAction = "Re-run integrate for the affected target to refresh managed entries.";
    } else {
      suggestedNextAction = "Run `agent-memory integrate` for the missing integration target.";
    }
  }

  return {
    target,
    healthy,
    claude,
    codex,
    warnings,
    missingItems,
    suggestedNextAction,
  };
}

export function formatIntegrationStatusReport(report: IntegrationStatusReport): string {
  const lines = [
    "Integration Status:",
    `- target: ${report.target}`,
    `- overall healthy: ${report.healthy ? "yes" : "no"}`,
    "",
    "Claude Code:",
    `- project MCP: ${report.claude.mcpProjectConfig.status} (${report.claude.mcpProjectConfig.path})`,
    `- project hooks: ${report.claude.settingsHooks.status} (${report.claude.settingsHooks.path})`,
    `- project skill: ${report.claude.skills.status} (${report.claude.skills.path})`,
    "",
    "Codex:",
    `- AGENTS guidance: ${report.codex.agentsGuidance.status} (${report.codex.agentsGuidance.path})`,
    `- global MCP config: ${report.codex.globalMcpConfig.status} (${report.codex.globalMcpConfig.path})`,
    "",
    "Summary:",
    `- warnings: ${report.warnings.length > 0 ? report.warnings.join(" | ") : "none"}`,
    `- missing items: ${report.missingItems.length > 0 ? report.missingItems.join(", ") : "none"}`,
    `- suggested next action: ${report.suggestedNextAction}`,
  ];

  return lines.join("\n");
}

async function maybeCreateProjectConfig(rootDir: string): Promise<boolean> {
  if (await exists(projectConfigPath(rootDir))) {
    return false;
  }

  await writeConfig(rootDir, getDefaultConfig());
  return true;
}

export async function runIntegratePlan(rootDir: string, target: IntegrationTarget): Promise<PlannedIntegrationChange[]> {
  const selected = selectedTargets(target);
  const changes: PlannedIntegrationChange[] = [];

  if (selected.includes("claude")) {
    changes.push(...(await planClaudeProjectIntegration(rootDir)));
  }

  if (selected.includes("codex")) {
    changes.push(...(await planCodexProjectIntegration(rootDir)));
    changes.push(...(await planCodexGlobalIntegration()));
  }

  return changes;
}

export async function applyIntegrationPlan(rootDir: string, target: IntegrationTarget): Promise<{
  changes: IntegrationActionResult[];
  projectConfigCreated: boolean;
  globalChangesApplied: boolean;
}> {
  const projectConfigCreated = await maybeCreateProjectConfig(rootDir);
  const plannedChanges = await runIntegratePlan(rootDir, target);

  if (target === "all" || target === "claude" || target === "codex") {
    await applyPlannedChangesForRoot(rootDir, plannedChanges);
  }

  const globalCodexChange = plannedChanges.find((change) => change.component === "codex-global-mcp");
  if (globalCodexChange && globalCodexChange.action !== "unchanged") {
    void (await tryCodexCliRegistration(rootDir).catch(() => false));
  }

  return {
    changes: plannedChanges.map(({ nextContent: _nextContent, ...change }) => change),
    projectConfigCreated,
    globalChangesApplied: plannedChanges.some((change) => change.scope === "user" && change.action !== "unchanged"),
  };
}

export async function previewIntegrationPlan(rootDir: string, target: IntegrationTarget): Promise<{
  changes: IntegrationActionResult[];
  projectConfigWouldBeCreated: boolean;
}> {
  const plannedChanges = await runIntegratePlan(rootDir, target);
  return {
    changes: plannedChanges.map(({ nextContent: _nextContent, ...change }) => change),
    projectConfigWouldBeCreated: !(await exists(projectConfigPath(rootDir))),
  };
}

export function formatIntegrationPlan(target: IntegrationTarget, changes: IntegrationActionResult[], dryRun: boolean): string {
  const grouped = {
    project: changes.filter((change) => change.scope === "project"),
    user: changes.filter((change) => change.scope === "user"),
  };

  const lines = [
    `Integrated target: ${target}`,
    `Dry run: ${dryRun ? "yes" : "no"}`,
    dryRun ? "Planned changes:" : "Changes applied:",
  ];

  for (const scope of ["project", "user"] as const) {
    if (grouped[scope].length === 0) {
      continue;
    }
    lines.push(`- ${scope}:`);
    for (const change of grouped[scope]) {
      lines.push(`  [${change.scope}] ${change.action.toUpperCase()} ${change.path}: ${change.note}`);
    }
  }

  return lines.join("\n");
}
