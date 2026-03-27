const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  buildClaudeSkillContent,
  buildIntegrationStatusReport,
  mergeAgentsMd,
  mergeClaudeSettings,
  mergeCodexConfigToml,
  mergeProjectMcpJson,
  previewIntegrationPlan,
  previewRepairPlan,
} = require(path.join(__dirname, "..", "dist", "core", "integration.js"));

test("mergeProjectMcpJson adds and updates only the agent-memory server entry", () => {
  const merged = JSON.parse(
    mergeProjectMcpJson(JSON.stringify({
      mcpServers: {
        other: {
          command: "echo",
          args: ["hello"],
        },
      },
    })),
  );

  assert.ok(merged.mcpServers.other);
  assert.equal(merged.mcpServers["agent-memory"].command, "npx");
  assert.deepEqual(merged.mcpServers["agent-memory"].args, ["--no-install", "agent-memory", "mcp"]);
});

test("mergeClaudeSettings inserts hooks idempotently without removing unrelated hooks", () => {
  const once = JSON.parse(
    mergeClaudeSettings(JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command: "echo existing-stop" }],
          },
        ],
      },
    })),
  );

  assert.equal(once.hooks.SessionStart.length, 1);
  assert.equal(once.hooks.Stop.length, 2);

  const twice = JSON.parse(mergeClaudeSettings(JSON.stringify(once)));
  assert.equal(JSON.stringify(twice), JSON.stringify(once));
});

test("mergeAgentsMd inserts or updates only the managed agent-memory block", () => {
  const once = mergeAgentsMd("# Existing\n");
  assert.match(once, /agent-memory:codex-integration start/);
  const twice = mergeAgentsMd(once);
  assert.equal(twice, once);
});

test("mergeCodexConfigToml updates only the agent-memory MCP block", () => {
  const merged = mergeCodexConfigToml([
    '[mcp_servers.other]',
    'command = "echo"',
    'args = ["hello"]',
    '',
    '[mcp_servers.agent-memory]',
    'command = "old"',
    'args = ["old"]',
    '',
  ].join("\n"));

  assert.match(merged, /\[mcp_servers\.other\]/);
  assert.match(merged, /\[mcp_servers\.agent-memory\]/);
  assert.match(merged, /command = "npx"/);
  assert.match(merged, /"--no-install", "agent-memory", "mcp"/);
});

test("previewIntegrationPlan classifies create and unchanged actions", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-integrate-plan-"));
  const first = await previewIntegrationPlan(projectDir, "claude");
  assert.ok(first.projectConfigWouldBeCreated);
  assert.ok(first.changes.every((change) => change.action === "create"));

  await fs.writeFile(path.join(projectDir, ".mcp.json"), mergeProjectMcpJson(null), "utf8");
  await fs.mkdir(path.join(projectDir, ".claude", "skills", "agent-memory"), { recursive: true });
  await fs.writeFile(path.join(projectDir, ".claude", "settings.json"), mergeClaudeSettings(null), "utf8");
  await fs.writeFile(path.join(projectDir, ".claude", "skills", "agent-memory", "SKILL.md"), `${buildClaudeSkillContent()}\n`, "utf8");

  const second = await previewIntegrationPlan(projectDir, "claude");
  assert.ok(second.changes.every((change) => change.action === "unchanged"));
});

test("buildIntegrationStatusReport detects missing and mismatch states", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-integrate-status-"));
  const missing = await buildIntegrationStatusReport(projectDir, "all");
  assert.equal(missing.healthy, false);
  assert.ok(missing.missingItems.includes("claude.mcpProjectConfig"));

  await fs.writeFile(path.join(projectDir, ".mcp.json"), JSON.stringify({ mcpServers: { "agent-memory": { command: "echo", args: [] } } }), "utf8");
  const mismatch = await buildIntegrationStatusReport(projectDir, "claude");
  assert.equal(mismatch.claude.mcpProjectConfig.status, "managed_mismatch");
});

test("previewRepairPlan only includes managed_mismatch components", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-integrate-repair-"));
  await fs.writeFile(path.join(projectDir, ".mcp.json"), JSON.stringify({ mcpServers: { "agent-memory": { command: "echo", args: [] } } }), "utf8");
  await fs.mkdir(path.join(projectDir, ".claude", "skills", "agent-memory"), { recursive: true });
  await fs.writeFile(path.join(projectDir, ".claude", "settings.json"), mergeClaudeSettings(null), "utf8");
  await fs.writeFile(path.join(projectDir, ".claude", "skills", "agent-memory", "SKILL.md"), `${buildClaudeSkillContent()}\n`, "utf8");

  const repair = await previewRepairPlan(projectDir, "claude");
  assert.equal(repair.changes.length, 1);
  assert.equal(repair.changes[0].component, "claude-mcp");
});
