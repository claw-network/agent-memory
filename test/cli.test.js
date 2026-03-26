const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const CLI_PATH = path.join(REPO_ROOT, "dist", "cli.js");

async function writeExecutable(filePath, content) {
  await fs.writeFile(filePath, content, "utf8");
  await fs.chmod(filePath, 0o755);
}

async function createFakeProviderBinaries(dir) {
  const providerSource = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

function extractBlock(prompt, name) {
  const pattern = new RegExp("BEGIN_" + name + "\\\\n([\\\\s\\\\S]*?)\\\\nEND_" + name);
  const match = prompt.match(pattern);
  return match ? match[1] : null;
}

function parseJsonBlock(prompt, name, fallback) {
  const value = extractBlock(prompt, name);
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function computeSnapshotStatus(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return "not-run";
  }

  const statuses = new Set(results.map((result) => result.status));
  if (statuses.size === 1 && statuses.has("passed")) {
    return "passed";
  }
  if (statuses.size === 1 && statuses.has("failed")) {
    return "failed";
  }
  return "mixed";
}

function buildBundle(provider, prompt) {
  const context = parseJsonBlock(prompt, "CONTEXT_JSON", {});
  const validationResults = parseJsonBlock(prompt, "VALIDATION_RESULTS_JSON", []);
  const mode = context.mode || "init";
  const scan = context.staticScan || {};
  const selectedEntryFile = context.selectedEntryFile || "README.md";
  const snapshotStatus = computeSnapshotStatus(validationResults);
  const validatedAt = snapshotStatus === "not-run" ? null : "2026-03-26T00:00:00.000Z";

  return {
    project: {
      name: scan.projectName || "fixture-project",
      summary: provider + " generated " + mode + " bundle",
      primaryEcosystem: scan.primaryEcosystem || "node",
      packageManager: scan.packageManager || "npm",
      workspaceManager: scan.workspaceManager || "none",
      recommendedEntryFile: selectedEntryFile,
      keyPaths: ["package.json", "README.md", "src/index.js"]
    },
    projectMap: {
      modules: [
        {
          name: "src",
          path: "src",
          responsibility: mode === "update" ? "Updated application source surface." : "Primary application source surface."
        }
      ],
      entrypoints: [
        {
          path: "src/index.js",
          role: "Primary runtime entrypoint."
        }
      ],
      denseSourceAreas: [
        {
          path: "src",
          note: "Core repository logic lives here."
        }
      ],
      architectureNotes: [
        "Fake provider architecture note for " + mode + ".",
        "Provider used: " + provider + "."
      ],
      firstFilesToRead: ["package.json", "README.md", "src/index.js"]
    },
    currentFocus: {
      summary: provider + " " + mode + " focus summary",
      currentState: [
        "Mode: " + mode,
        "Project: " + (scan.projectName || "fixture-project")
      ],
      knownRisks: [
        "Fake provider risk for " + mode + "."
      ],
      validationSnapshot: {
        status: snapshotStatus,
        validatedAt,
        summary: snapshotStatus === "not-run"
          ? "No validation commands were run."
          : "Validation completed from fake provider results.",
        results: Array.isArray(validationResults)
          ? validationResults.map((result) => ({
              label: result.label,
              command: result.command,
              status: result.status,
              summary: result.summary
            }))
          : [],
        suggestedNextActions: snapshotStatus === "not-run"
          ? ["Run the recommended validation command."]
          : ["Keep the validation baseline fresh."]
      }
    },
    gotchas: [
      {
        title: "Fake gotcha",
        symptom: "A fake failure is encountered.",
        cause: "The fake provider injected this sample gotcha.",
        correctPath: "Follow the generated docs and rerun the command."
      }
    ],
    nextSteps: [
      {
        title: mode === "update" ? "Review the refreshed state" : "Review the generated state",
        why: "Confirm the canonical bundle matches the repository reality.",
        start: "Open docs/agent-memory/current-focus.md.",
        done: "The generated memory looks trustworthy."
      }
    ],
    validationCommands: [
      {
        label: "node smoke",
        command: ["node", "-e", "process.stdout.write('validation-ok')"],
        purpose: "Confirm Node-based command execution works."
      }
    ]
  };
}

async function readStdin() {
  return await new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.resume();
  });
}

async function main() {
  const args = process.argv.slice(2);
  const fakeMode = process.env.AGENT_MEMORY_FAKE_MODE || "success";

  if (args.includes("--version") || args.includes("--help")) {
    process.stdout.write("fake-provider\\n");
    return;
  }

  if (fakeMode === "auth-error") {
    process.stderr.write("authentication required\\n");
    process.exit(1);
  }

  const provider = path.basename(process.argv[1]).includes("claude") ? "claude" : "codex";
  const prompt = provider === "codex" ? await readStdin() : args[args.length - 1] || "";

  let payload = "";
  if (fakeMode === "invalid-json") {
    payload = "this is not json";
  } else if (fakeMode === "schema-error") {
    payload = JSON.stringify({ project: { name: "broken" } }, null, 2);
  } else {
    payload = JSON.stringify(buildBundle(provider, prompt), null, 2);
  }

  if (provider === "codex") {
    const outputIndex = args.findIndex((arg) => arg === "-o" || arg === "--output-last-message");
    if (outputIndex < 0 || !args[outputIndex + 1]) {
      process.stderr.write("missing output path\\n");
      process.exit(1);
    }
    fs.writeFileSync(args[outputIndex + 1], payload, "utf8");
  } else {
    process.stdout.write(payload);
  }
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error));
  process.exit(1);
});
`;

  const codexPath = path.join(dir, "fake-codex.js");
  const claudePath = path.join(dir, "fake-claude.js");
  await writeExecutable(codexPath, providerSource);
  await writeExecutable(claudePath, providerSource);
  return { codexPath, claudePath };
}

async function createFixtureProject() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-project-"));
  await fs.mkdir(path.join(projectDir, "src"), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "package.json"),
    JSON.stringify(
      {
        name: "fixture-project",
        private: true,
        scripts: {
          build: "node -e \"process.stdout.write('build-ok')\"",
          test: "node -e \"process.stdout.write('test-ok')\"",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(path.join(projectDir, "README.md"), "# Fixture Project\n", "utf8");
  await fs.writeFile(path.join(projectDir, "src", "index.js"), "module.exports = { value: 1 };\n", "utf8");
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

async function readState(projectDir) {
  return JSON.parse(await fs.readFile(path.join(projectDir, ".agent-memory", "state.json"), "utf8"));
}

async function rewriteFromState(projectDir, state) {
  const { buildState, writeState } = require(path.join(REPO_ROOT, "dist", "core", "state-store.js"));
  const { projectState } = require(path.join(REPO_ROOT, "dist", "core", "bundle-projector.js"));
  const { writeProjectionFile, applyEntrySnippet } = require(path.join(REPO_ROOT, "dist", "core", "merge-files.js"));

  const canonicalState = buildState(state.bundle, state.provider, state.generatedAt);
  await writeState(projectDir, canonicalState);
  const projection = projectState(projectDir, canonicalState);
  for (const file of projection.files) {
    await writeProjectionFile(file);
  }
  await applyEntrySnippet(projection.entryFile, projection.entrySnippet);
  return canonicalState;
}

test("init with auto prefers codex and writes canonical artifacts", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const { codexPath, claudePath } = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  const result = await runCli(projectDir, ["init", "--yes", "--provider=auto"], {
    AGENT_MEMORY_CODEX_BIN: codexPath,
    AGENT_MEMORY_CLAUDE_BIN: claudePath,
  });

  assert.equal(result.code, 0, result.stderr);
  const state = await readState(projectDir);
  assert.equal(state.provider.name, "codex");
  assert.equal(state.bundle.project.summary, "codex generated init bundle");
  await fs.access(path.join(projectDir, "docs", "agent-memory", "README.md"));
  const entryFile = await fs.readFile(path.join(projectDir, "README.md"), "utf8");
  assert.match(entryFile, /agent-memory:entry version=2 bundleHash=/);
});

test("auto falls back to claude when codex is unavailable", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const { claudePath } = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  const result = await runCli(projectDir, ["init", "--yes", "--provider=auto"], {
    AGENT_MEMORY_CODEX_BIN: path.join(providerDir, "missing-codex"),
    AGENT_MEMORY_CLAUDE_BIN: claudePath,
  });

  assert.equal(result.code, 0, result.stderr);
  const state = await readState(projectDir);
  assert.equal(state.provider.name, "claude");
});

test("provider authentication failures surface as command errors", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const { codexPath } = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  const result = await runCli(projectDir, ["init", "--yes", "--provider=codex"], {
    AGENT_MEMORY_CODEX_BIN: codexPath,
    AGENT_MEMORY_FAKE_MODE: "auth-error",
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /authentication failed/i);
});

test("provider invalid JSON output fails init", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const { codexPath } = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  const result = await runCli(projectDir, ["init", "--yes", "--provider=codex"], {
    AGENT_MEMORY_CODEX_BIN: codexPath,
    AGENT_MEMORY_FAKE_MODE: "invalid-json",
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /invalid memory bundle/i);
});

test("provider schema-invalid output fails init", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const { codexPath } = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  const result = await runCli(projectDir, ["init", "--yes", "--provider=codex"], {
    AGENT_MEMORY_CODEX_BIN: codexPath,
    AGENT_MEMORY_FAKE_MODE: "schema-error",
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /invalid memory bundle/i);
});

test("init --validate records validation results in canonical state and projection", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const { codexPath } = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  const result = await runCli(projectDir, ["init", "--yes", "--validate", "--provider=codex"], {
    AGENT_MEMORY_CODEX_BIN: codexPath,
  });

  assert.equal(result.code, 0, result.stderr);
  const state = await readState(projectDir);
  assert.equal(state.bundle.currentFocus.validationSnapshot.status, "passed");
  assert.equal(state.bundle.currentFocus.validationSnapshot.results.length, 1);
  const currentFocus = await fs.readFile(path.join(projectDir, "docs", "agent-memory", "current-focus.md"), "utf8");
  assert.match(currentFocus, /PASSED node -e process\.stdout\.write\('validation-ok'\)/);
});

test("update refreshes an existing canonical state", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const { codexPath } = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  const initResult = await runCli(projectDir, ["init", "--yes", "--provider=codex"], {
    AGENT_MEMORY_CODEX_BIN: codexPath,
  });
  assert.equal(initResult.code, 0, initResult.stderr);

  const updateResult = await runCli(projectDir, ["update", "--yes", "--provider=codex"], {
    AGENT_MEMORY_CODEX_BIN: codexPath,
  });

  assert.equal(updateResult.code, 0, updateResult.stderr);
  const state = await readState(projectDir);
  assert.equal(state.bundle.currentFocus.summary, "codex update focus summary");
});

test("update fails when canonical state is missing", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const { codexPath } = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  const result = await runCli(projectDir, ["update", "--yes", "--provider=codex"], {
    AGENT_MEMORY_CODEX_BIN: codexPath,
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Run `agent-memory init`/);
});

test("validate passes for a healthy canonical state", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const { codexPath } = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  const initResult = await runCli(projectDir, ["init", "--yes", "--validate", "--provider=codex"], {
    AGENT_MEMORY_CODEX_BIN: codexPath,
  });
  assert.equal(initResult.code, 0, initResult.stderr);

  const validateResult = await runCli(projectDir, ["validate"]);
  assert.equal(validateResult.code, 0, validateResult.stderr);
  assert.match(validateResult.stdout, /0 failed/);
});

test("validate fails when a projection marker drifts from the canonical bundle", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const { codexPath } = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  const initResult = await runCli(projectDir, ["init", "--yes", "--validate", "--provider=codex"], {
    AGENT_MEMORY_CODEX_BIN: codexPath,
  });
  assert.equal(initResult.code, 0, initResult.stderr);

  const readmePath = path.join(projectDir, "docs", "agent-memory", "README.md");
  const readme = await fs.readFile(readmePath, "utf8");
  await fs.writeFile(readmePath, readme.replace(/bundleHash=[a-f0-9]+/, "bundleHash=deadbeef"), "utf8");

  const validateResult = await runCli(projectDir, ["validate"]);
  assert.equal(validateResult.code, 1);
  assert.match(validateResult.stdout, /projection:readme:drift/);
});

test("validate fails when the entry block is removed", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const { codexPath } = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  const initResult = await runCli(projectDir, ["init", "--yes", "--validate", "--provider=codex"], {
    AGENT_MEMORY_CODEX_BIN: codexPath,
  });
  assert.equal(initResult.code, 0, initResult.stderr);

  await fs.writeFile(path.join(projectDir, "README.md"), "# Fixture Project\n", "utf8");

  const validateResult = await runCli(projectDir, ["validate"]);
  assert.equal(validateResult.code, 1);
  assert.match(validateResult.stdout, /entry:marker/);
});

test("validate fails when the validation baseline is stale", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const { codexPath } = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  const initResult = await runCli(projectDir, ["init", "--yes", "--validate", "--provider=codex"], {
    AGENT_MEMORY_CODEX_BIN: codexPath,
  });
  assert.equal(initResult.code, 0, initResult.stderr);

  const state = await readState(projectDir);
  state.bundle.currentFocus.validationSnapshot.validatedAt = "2000-01-01T00:00:00.000Z";
  await rewriteFromState(projectDir, state);

  const validateResult = await runCli(projectDir, ["validate"]);
  assert.equal(validateResult.code, 1);
  assert.match(validateResult.stdout, /validation:freshness/);
});
