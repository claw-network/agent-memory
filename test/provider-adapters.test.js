const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  probeProviderForStructuredUse,
  resolveProviderForStructuredUse,
} = require(path.join(__dirname, "..", "dist", "core", "provider-adapters.js"));

async function writeExecutable(filePath, content) {
  await fs.writeFile(filePath, content, "utf8");
  await fs.chmod(filePath, 0o755);
}

test("resolveProviderForStructuredUse falls back from codex auth failure to claude", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-fallback-"));
  const codexPath = path.join(dir, "fake-codex.js");
  const claudePath = path.join(dir, "fake-claude.js");

  await writeExecutable(codexPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("fake codex\\n");
  process.exit(0);
}
process.stderr.write("authentication required\\n");
process.exit(1);
`);

  await writeExecutable(claudePath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("fake claude\\n");
  process.exit(0);
}
process.stdout.write('{"ok":true}');
process.exit(0);
`);

  const env = {
    AGENT_MEMORY_CODEX_BIN: codexPath,
    AGENT_MEMORY_CLAUDE_BIN: claudePath,
  };

  const codexProbe = await probeProviderForStructuredUse("codex", process.cwd(), env);
  assert.equal(codexProbe.ok, false);
  assert.equal(codexProbe.reason, "auth");

  const resolved = await resolveProviderForStructuredUse("auto", process.cwd(), env);
  assert.equal(resolved.name, "claude");
  assert.equal(resolved.binary, claudePath);
});

test("resolveProviderForStructuredUse reports explicit codex auth failure clearly", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-explicit-"));
  const codexPath = path.join(dir, "fake-codex.js");

  await writeExecutable(codexPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("fake codex\\n");
  process.exit(0);
}
process.stderr.write("authentication required\\n");
process.exit(1);
`);

  await assert.rejects(
    () => resolveProviderForStructuredUse("codex", process.cwd(), {
      AGENT_MEMORY_CODEX_BIN: codexPath,
    }),
    /authentication is not ready/i,
  );
});
