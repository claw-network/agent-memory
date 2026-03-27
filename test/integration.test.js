const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  mergeAgentsMd,
  mergeClaudeSettings,
  mergeCodexConfigToml,
  mergeProjectMcpJson,
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
