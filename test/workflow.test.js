const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const CLI_PATH = path.join(REPO_ROOT, "dist", "cli.js");

const {
  buildMemoryAssessWorkflow,
  buildMemoryCompactHandoffWorkflow,
  runMemoryMaintainWorkflow,
} = require(path.join(__dirname, "..", "dist", "core", "workflow-orchestrator.js"));

async function writeExecutable(filePath, content) {
  await fs.writeFile(filePath, content, "utf8");
  await fs.chmod(filePath, 0o755);
}

async function createFakeProviderBinaries(dir) {
  const providerSource = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const payload = JSON.stringify({
  project: {
    name: "fixture-project",
    summary: "workflow test bundle",
    primaryEcosystem: "node",
    packageManager: "npm",
    workspaceManager: "none",
    recommendedEntryFile: "src/index.js",
    keyPaths: ["package.json", "README.md", "src/index.js"]
  },
  projectMap: {
    modules: [{ name: "src", path: "src", responsibility: "Primary source surface." }],
    entrypoints: [{ path: "src/index.js", role: "Primary runtime entrypoint." }],
    denseSourceAreas: [{ path: "src", note: "Main application code." }],
    architectureNotes: ["Workflow test architecture note."],
    firstFilesToRead: ["package.json", "README.md", "src/index.js"]
  },
  currentFocus: {
    summary: "Workflow test current focus summary.",
    currentState: ["State: initialized"],
    knownRisks: ["Workflow test risk."],
    validationSnapshot: {
      status: "not-run",
      validatedAt: null,
      summary: "No validation commands were run.",
      results: [],
      suggestedNextActions: ["Run the recommended validation command."]
    }
  },
  gotchas: [{
    title: "Workflow gotcha",
    symptom: "Something unexpected happened.",
    cause: "This is a test gotcha.",
    correctPath: "Follow the workflow docs."
  }],
  nextSteps: [{
    title: "Inspect current focus",
    why: "Confirm workflow state.",
    start: "Open docs/agent-memory/current-focus.md.",
    done: "The focus summary is understood."
  }],
  validationCommands: [{
    label: "node smoke",
    command: ["node", "-e", "process.stdout.write('ok')"],
    purpose: "Confirm command execution works."
  }]
}, null, 2);

if (process.argv.includes("--version") || process.argv.includes("--help")) {
  process.stdout.write("fake-provider\\n");
  process.exit(0);
}

if (path.basename(process.argv[1]).includes("codex")) {
  const outputIndex = process.argv.findIndex((arg) => arg === "-o" || arg === "--output-last-message");
  fs.writeFileSync(process.argv[outputIndex + 1], payload, "utf8");
} else {
  process.stdout.write(payload);
}
`;

  const codexPath = path.join(dir, "fake-codex.js");
  const claudePath = path.join(dir, "fake-claude.js");
  await writeExecutable(codexPath, providerSource);
  await writeExecutable(claudePath, providerSource);
  return { codexPath, claudePath };
}

async function createFixtureProject() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-workflow-project-"));
  await fs.mkdir(path.join(projectDir, "src"), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "package.json"),
    JSON.stringify({
      name: "fixture-project",
      private: true,
      scripts: {
        test: "node -e \"process.stdout.write('ok')\"",
      },
    }, null, 2),
    "utf8",
  );
  await fs.writeFile(path.join(projectDir, "README.md"), "# Fixture Project\n", "utf8");
  await fs.writeFile(path.join(projectDir, "src", "index.js"), "module.exports = 1;\n", "utf8");
  return projectDir;
}

async function runCli(projectDir, args, extraEnv = {}) {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: projectDir,
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function providerEnv(paths) {
  return {
    AGENT_MEMORY_CODEX_BIN: paths.codexPath,
    AGENT_MEMORY_CLAUDE_BIN: paths.claudePath,
  };
}

test("buildMemoryAssessWorkflow returns the stable assess shape", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  const init = await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers));
  assert.equal(init.code, 0, init.stderr);

  const result = await buildMemoryAssessWorkflow(projectDir);
  assert.ok(["ok", "warn", "fail"].includes(result.status));
  assert.equal(typeof result.summary, "string");
  assert.ok(["healthy", "attention", "unhealthy"].includes(result.details.memoryHealth));
  assert.equal(typeof result.details.backlog.unrecalledAll, "number");
  assert.equal(typeof result.details.automation.running, "boolean");
  assert.ok(Array.isArray(result.details.validate.topFindings));
});

test("runMemoryMaintainWorkflow returns the stable maintain shape", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  const init = await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers));
  assert.equal(init.code, 0, init.stderr);

  try {
    const ensure = await runCli(projectDir, ["automate", "ensure-running"], providerEnv(providers));
    assert.equal(ensure.code, 0, ensure.stderr);

    const result = await runMemoryMaintainWorkflow(projectDir);
    assert.ok(["ok", "warn", "fail"].includes(result.status));
    assert.equal(typeof result.details.daemon.wasRunning, "boolean");
    assert.equal(typeof result.details.daemon.startedNow, "boolean");
    assert.ok(Array.isArray(result.details.changedFiles));
    assert.match(result.details.latestRunPath, /latest-run\.json$/);
  } finally {
    await runCli(projectDir, ["automate", "stop"], providerEnv(providers));
  }
});

test("buildMemoryCompactHandoffWorkflow returns the stable handoff shape", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  const init = await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers));
  assert.equal(init.code, 0, init.stderr);

  const result = await buildMemoryCompactHandoffWorkflow(projectDir);
  assert.ok(["ok", "warn", "fail"].includes(result.status));
  assert.equal(typeof result.details.currentFocusSummary, "string");
  assert.ok(Array.isArray(result.details.topGotchas));
  assert.ok(Array.isArray(result.details.topNextSteps));
  assert.equal(typeof result.details.unrecalledGroupedCount, "number");
  assert.ok(Array.isArray(result.details.recommendedResumeActions));
});
