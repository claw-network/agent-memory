const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const CLI_PATH = path.join(REPO_ROOT, "dist", "cli.js");
const FIXTURES_DIR = path.join(__dirname, "fixtures");

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

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
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

function parseMarkers(payload) {
  const markers = {
    decisions: [],
    gotchas: [],
    nextStepHints: [],
    keyPaths: [],
    validationObservations: [],
  };
  const pattern = /(?:^|\\n)(DECISION|GOTCHA|NEXT|DONE|PATH|VALIDATION):\\s*(.+)$/gm;
  let match;
  while ((match = pattern.exec(payload)) !== null) {
    const kind = match[1];
    const value = match[2].trim();
    if (!value) continue;
    if (kind === "DECISION") markers.decisions.push(value);
    if (kind === "GOTCHA") markers.gotchas.push(value);
    if (kind === "NEXT") markers.nextStepHints.push("NEXT: " + value);
    if (kind === "DONE") markers.nextStepHints.push("DONE: " + value);
    if (kind === "PATH") markers.keyPaths.push(value);
    if (kind === "VALIDATION") markers.validationObservations.push(value);
  }
  return markers;
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
        title: "Initial gotcha",
        symptom: "A fake failure is encountered.",
        cause: "The fake provider injected this sample gotcha.",
        correctPath: "Follow the generated docs and rerun the command."
      }
    ],
    nextSteps: [
      {
        title: "Review the generated state",
        why: "Confirm the canonical bundle matches the repository reality.",
        start: "Open docs/agent-memory/current-focus.md.",
        done: "The generated memory looks trustworthy."
      },
      {
        title: "Document package workflow",
        why: "Record the package manager workflow for the next contributor.",
        start: "Update docs/agent-memory/README.md.",
        done: "The package workflow is documented."
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

function buildRecallBundle(prompt) {
  const currentState = parseJsonBlock(prompt, "CURRENT_STATE_JSON", {});
  const events = parseJsonBlock(prompt, "UNRECALLED_EVIDENCE_JSON", parseJsonBlock(prompt, "UNRECALLED_EVENTS_JSON", []));
  const bundle = JSON.parse(JSON.stringify((currentState && currentState.bundle) || {}));
  const gotchaMap = new Map((bundle.gotchas || []).map((gotcha) => [gotcha.title, gotcha]));
  const nextStepMap = new Map((bundle.nextSteps || []).map((step) => [step.title, step]));
  const doneTitles = new Set();
  const extraState = [];
  const extraRisks = [];
  const keyPaths = new Set(bundle.project && Array.isArray(bundle.project.keyPaths) ? bundle.project.keyPaths : []);

  for (const event of events) {
    const signals = event.signals || {};
    const sourceLabel = event.sourceId || (Array.isArray(event.sourceIds) && event.sourceIds.length > 0 ? event.sourceIds[0] : event.sourceScopeLabel || "history");
    for (const gotchaTitle of signals.gotchas || []) {
      if (!gotchaMap.has(gotchaTitle)) {
        gotchaMap.set(gotchaTitle, {
          title: gotchaTitle,
          symptom: "Imported from " + sourceLabel,
          cause: "Derived from external session history.",
          correctPath: "Follow the recalled guidance."
        });
      }
    }
    for (const hint of signals.nextStepHints || []) {
      if (hint.startsWith("DONE: ")) {
        doneTitles.add(hint.slice(6));
        continue;
      }
      const title = hint.startsWith("NEXT: ") ? hint.slice(6) : hint;
      if (!nextStepMap.has(title)) {
        nextStepMap.set(title, {
          title,
          why: "Recalled from imported history.",
          start: "Follow the recalled action.",
          done: "The recalled action is complete."
        });
      }
    }
    for (const decision of signals.decisions || []) extraState.push("Decision: " + decision);
    for (const observation of signals.validationObservations || []) extraRisks.push(observation);
    for (const keyPath of signals.keyPaths || []) keyPaths.add(keyPath);
  }

  for (const title of doneTitles) {
    nextStepMap.delete(title);
  }

  bundle.gotchas = Array.from(gotchaMap.values());
  bundle.nextSteps = Array.from(nextStepMap.values());
  bundle.project.keyPaths = Array.from(keyPaths);
  bundle.currentFocus.summary = "Recalled " + events.length + " history event(s).";
  bundle.currentFocus.currentState = unique([...(bundle.currentFocus.currentState || []), ...extraState]);
  bundle.currentFocus.knownRisks = unique([...(bundle.currentFocus.knownRisks || []), ...extraRisks]);
  return bundle;
}

function buildQueryResult(prompt) {
  const question = extractBlock(prompt, "QUERY_QUESTION") || "unknown question";
  const mode = extractBlock(prompt, "QUERY_MODE") || "answer";
  const templateInstructions = extractBlock(prompt, "QUERY_TEMPLATE_INSTRUCTIONS") || "";
  const templateHint = templateInstructions
    .split(/\\r?\\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const shortlist = parseJsonBlock(prompt, "QUERY_SHORTLIST_JSON", []);
  return {
    mode,
    answer: mode.toUpperCase() + " answer for: " + question,
    why: "Built from " + shortlist.length + " shortlisted memory items." + (templateHint ? " Template: " + templateHint : ""),
    citations: shortlist.slice(0, 2).map((item) => ({
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      pathOrSection: item.pathOrSection,
      summary: item.summary,
      projectionPath: null
    }))
  };
}

function buildImportedNormalization(prompt) {
  const item = parseJsonBlock(prompt, "IMPORT_ITEM_JSON", {});
  const payload = String(item.payload || "");
  const markers = parseMarkers(payload);
  return {
    summary: markers.decisions[0] || markers.gotchas[0] || markers.nextStepHints[0] || ("Imported " + (item.externalItemId || "session")),
    signals: markers
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

   if (args[0] === "mcp" && args[1] === "add") {
    const logPath = process.env.AGENT_MEMORY_FAKE_CODEX_MCP_LOG;
    if (logPath) {
      fs.appendFileSync(logPath, JSON.stringify(args) + "\\n", "utf8");
    }
    if (process.env.AGENT_MEMORY_FAKE_CODEX_MCP_MODE === "fail") {
      process.stderr.write("fake codex mcp add failure\\n");
      process.exit(1);
    }
    process.stdout.write("fake codex mcp add success\\n");
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
  } else if (prompt.includes("BEGIN_QUERY_QUESTION")) {
    payload = JSON.stringify(buildQueryResult(prompt), null, 2);
  } else if (prompt.includes("BEGIN_IMPORT_ITEM_JSON")) {
    payload = JSON.stringify(buildImportedNormalization(prompt), null, 2);
  } else if (prompt.includes("BEGIN_UNRECALLED_EVIDENCE_JSON") || prompt.includes("BEGIN_UNRECALLED_EVENTS_JSON")) {
    payload = JSON.stringify(buildRecallBundle(prompt), null, 2);
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

async function createClaudeImportSource(specs) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-claude-import-"));
  const transcriptsDir = path.join(rootDir, "transcripts");
  await fs.mkdir(transcriptsDir, { recursive: true });
  for (const [index, spec] of specs.entries()) {
    const filePath = path.join(transcriptsDir, `ses_${index + 1}.jsonl`);
    await fs.writeFile(
      filePath,
      `${JSON.stringify({
        type: "user",
        timestamp: spec.timestamp || "2026-03-26T00:00:00.000Z",
        content: spec.text,
      })}\n`,
      "utf8",
    );
  }
  return rootDir;
}

async function createCodexImportSource(specs) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-codex-import-"));
  const sessionsDir = path.join(rootDir, "sessions", "2026", "03", "27");
  await fs.mkdir(sessionsDir, { recursive: true });
  for (const [index, spec] of specs.entries()) {
    const filePath = path.join(sessionsDir, `rollout-${index + 1}.jsonl`);
    await fs.writeFile(
      filePath,
      `${JSON.stringify({
        timestamp: spec.timestamp || "2026-03-27T00:00:00.000Z",
        type: "session_meta",
        payload: { id: `session-${index + 1}` },
      })}\n${JSON.stringify({
        timestamp: spec.timestamp || "2026-03-27T00:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: spec.text }],
        },
      })}\n`,
      "utf8",
    );
  }
  return rootDir;
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

async function startMcpSession(projectDir, extraEnv = {}) {
  const child = spawn(process.execPath, [CLI_PATH, "mcp"], {
    cwd: projectDir,
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buffer = Buffer.alloc(0);
  const pending = new Map();
  let nextId = 1;

  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        break;
      }

      const header = buffer.slice(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = Buffer.alloc(0);
        break;
      }

      const contentLength = Number(match[1]);
      const totalLength = headerEnd + 4 + contentLength;
      if (buffer.length < totalLength) {
        break;
      }

      const payload = JSON.parse(buffer.slice(headerEnd + 4, totalLength).toString("utf8"));
      buffer = buffer.slice(totalLength);
      if (payload.id !== undefined && pending.has(payload.id)) {
        pending.get(payload.id)(payload);
        pending.delete(payload.id);
      }
    }
  });

  async function request(method, params) {
    const id = nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
    return await new Promise((resolve) => {
      pending.set(id, resolve);
    });
  }

  async function notify(method, params) {
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
  }

  return {
    child,
    request,
    notify,
    async close() {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.on("close", resolve));
    },
  };
}

function fixturePath(...parts) {
  return path.join(FIXTURES_DIR, ...parts);
}

async function readState(projectDir) {
  return JSON.parse(await fs.readFile(path.join(projectDir, ".agent-memory", "state.json"), "utf8"));
}

async function writeStateFile(projectDir, state) {
  await fs.writeFile(
    path.join(projectDir, ".agent-memory", "state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );
}

async function readEvents(projectDir) {
  const raw = await fs.readFile(path.join(projectDir, ".agent-memory", "history", "events.jsonl"), "utf8");
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function readSources(projectDir) {
  return JSON.parse(await fs.readFile(path.join(projectDir, ".agent-memory", "sources.json"), "utf8"));
}

async function readConfig(projectDir) {
  return JSON.parse(await fs.readFile(path.join(projectDir, ".agent-memory", "config.json"), "utf8"));
}

async function checkpointFiles(projectDir) {
  return await fs.readdir(path.join(projectDir, ".agent-memory", "history", "checkpoints"));
}

async function readAutomationRun(projectDir) {
  return JSON.parse(await fs.readFile(path.join(projectDir, ".agent-memory", "automation", "latest-run.json"), "utf8"));
}

async function readAutomationDaemon(projectDir) {
  return JSON.parse(await fs.readFile(path.join(projectDir, ".agent-memory", "automation", "daemon.json"), "utf8"));
}

function providerEnv(paths, extra = {}) {
  return {
    AGENT_MEMORY_CODEX_BIN: paths.codexPath,
    AGENT_MEMORY_CLAUDE_BIN: paths.claudePath,
    ...extra,
  };
}

test("init rebuilds the new canonical state, history, checkpoints, and projections", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  const result = await runCli(projectDir, ["init", "--yes", "--provider=auto"], providerEnv(providers));

  assert.equal(result.code, 0, result.stderr);
  const state = await readState(projectDir);
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.maintenance.historyEventCount, 1);
  assert.equal(state.maintenance.importSourceCount, 0);
  assert.equal((await readEvents(projectDir)).length, 1);
  assert.equal((await checkpointFiles(projectDir)).length, 1);
  assert.deepEqual(await readSources(projectDir), []);
  await fs.access(path.join(projectDir, "docs", "agent-memory", "README.md"));
});

test("update refreshes canonical memory and appends a tool-run event plus checkpoint", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const result = await runCli(projectDir, ["update", "--yes", "--provider=codex"], providerEnv(providers));

  assert.equal(result.code, 0, result.stderr);
  const state = await readState(projectDir);
  assert.equal(state.bundle.currentFocus.summary, "codex update focus summary");
  assert.equal(state.maintenance.historyEventCount, 2);
  assert.equal((await readEvents(projectDir)).length, 2);
  assert.equal((await checkpointFiles(projectDir)).length, 2);
});

test("update fails immediately on an old schema state", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  await fs.mkdir(path.join(projectDir, ".agent-memory"), { recursive: true });
  await fs.writeFile(path.join(projectDir, ".agent-memory", "state.json"), JSON.stringify({ schemaVersion: 1 }), "utf8");

  const result = await runCli(projectDir, ["update", "--yes", "--provider=codex"], providerEnv(providers));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Invalid state|schemaVersion/i);
});

test("prepareRecall previews changes without writing files", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const claudeImportDir = await createClaudeImportSource([
    {
      text: "DECISION: Use cache layer\nGOTCHA: Reset local cache before query\nNEXT: Write cache playbook\nDONE: Review the generated state\nPATH: src/cache.ts\nVALIDATION: cache validation is flaky",
    },
  ]);

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

  const beforeState = await fs.readFile(path.join(projectDir, ".agent-memory", "state.json"), "utf8");
  const beforeEvents = await fs.readFile(path.join(projectDir, ".agent-memory", "history", "events.jsonl"), "utf8");
  const previousEnv = {
    AGENT_MEMORY_CODEX_BIN: process.env.AGENT_MEMORY_CODEX_BIN,
    AGENT_MEMORY_CLAUDE_BIN: process.env.AGENT_MEMORY_CLAUDE_BIN,
  };
  process.env.AGENT_MEMORY_CODEX_BIN = providers.codexPath;
  process.env.AGENT_MEMORY_CLAUDE_BIN = providers.claudePath;
  const { prepareRecall } = require(path.join(REPO_ROOT, "dist", "core", "recall-orchestrator.js"));

  try {
    const prepared = await prepareRecall({
      cwd: projectDir,
      yes: false,
      provider: "codex",
      source: "imports",
      section: "all",
      policy: null,
      showDiff: false,
      checkpointId: null,
    });
    assert.ok(prepared.candidate.fileDiffs.length > 0);
    assert.ok(prepared.candidate.summary.addedGotchas.includes("Reset local cache before query"));
  } finally {
    if (previousEnv.AGENT_MEMORY_CODEX_BIN === undefined) delete process.env.AGENT_MEMORY_CODEX_BIN;
    else process.env.AGENT_MEMORY_CODEX_BIN = previousEnv.AGENT_MEMORY_CODEX_BIN;
    if (previousEnv.AGENT_MEMORY_CLAUDE_BIN === undefined) delete process.env.AGENT_MEMORY_CLAUDE_BIN;
    else process.env.AGENT_MEMORY_CLAUDE_BIN = previousEnv.AGENT_MEMORY_CLAUDE_BIN;
  }

  assert.equal(await fs.readFile(path.join(projectDir, ".agent-memory", "state.json"), "utf8"), beforeState);
  assert.equal(await fs.readFile(path.join(projectDir, ".agent-memory", "history", "events.jsonl"), "utf8"), beforeEvents);
});

test("recall --yes applies consolidation, updates cursor, and appends a tool-run event", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const claudeImportDir = await createClaudeImportSource([
    {
      text: "DECISION: Use cache layer\nGOTCHA: Reset local cache before query\nNEXT: Write cache playbook\nDONE: Review the generated state\nPATH: src/cache.ts\nVALIDATION: cache validation is flaky",
    },
  ]);

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

  const result = await runCli(projectDir, ["recall", "--yes", "--provider=codex", "--source=imports"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);

  const state = await readState(projectDir);
  assert.equal(state.bundle.currentFocus.summary, "Recalled 1 history event(s).");
  assert.ok(state.bundle.gotchas.some((item) => item.title === "Reset local cache before query"));
  assert.ok(state.bundle.nextSteps.some((item) => item.title === "Write cache playbook"));
  assert.ok(!state.bundle.nextSteps.some((item) => item.title === "Review the generated state"));
  assert.equal(state.maintenance.historyEventCount, 3);
  assert.equal(state.maintenance.recallCursors.imports.lastRecalledEventId, "evt-000002");
  assert.equal((await readEvents(projectDir)).length, 3);
});

test("query returns an answer with citations and does not mutate files", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const beforeState = await fs.readFile(path.join(projectDir, ".agent-memory", "state.json"), "utf8");

  const result = await runCli(projectDir, ["query", "package workflow", "--provider=codex", "--scope=all"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Answer:/);
  assert.match(result.stdout, /Mode: answer/);
  assert.match(result.stdout, /Citations:/);
  assert.equal(await fs.readFile(path.join(projectDir, ".agent-memory", "state.json"), "utf8"), beforeState);
});

test("query detects changes mode from natural language and prioritizes recent checkpoint evidence", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["update", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);

  const result = await runCli(projectDir, ["query", "what changed recently?", "--provider=codex", "--scope=all"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Mode: changes/);
  assert.match(result.stdout, /\[checkpoint\] chk-000002 checkpoint:chk-000002/);
});

test("query detects next mode from natural language and links bundle citations to projection docs", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const result = await runCli(projectDir, ["query", "what should I do next?", "--provider=codex", "--scope=state"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Mode: next/);
  assert.match(result.stdout, /docs\/agent-memory\/next-steps\.md|docs\/agent-memory\/current-focus\.md/);
});

test("query detects traps mode from natural language", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const result = await runCli(projectDir, ["query", "what are the known traps?", "--provider=codex", "--scope=state"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Mode: traps/);
  assert.match(result.stdout, /docs\/agent-memory\/gotchas\.md/);
});

test("query can answer from imported history events before recall", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const codexImportDir = await createCodexImportSource([
    {
      text: "DECISION: Use query cache\nGOTCHA: Query cache grows stale quickly\nNEXT: Add cache ttl docs\nPATH: src/query-cache.ts",
    },
  ]);

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "add", "codex-local", codexImportDir, "--name", "codex-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

  const result = await runCli(projectDir, ["query", "stale quickly", "--provider=codex", "--scope=history"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\[event\] evt-000002 event:evt-000002/);
});

test("import add/list/sync registers sources and deduplicates imported sessions", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const codexImportDir = await createCodexImportSource([
    {
      text: "DECISION: Use query cache\nGOTCHA: Query cache grows stale quickly\nNEXT: Add cache ttl docs\nPATH: src/query-cache.ts\nVALIDATION: query cache test is noisy",
    },
  ]);

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "add", "codex-local", codexImportDir, "--name", "codex-a"], providerEnv(providers))).code, 0);

  const listResult = await runCli(projectDir, ["import", "list"], providerEnv(providers));
  assert.equal(listResult.code, 0, listResult.stderr);
  assert.match(listResult.stdout, /codex-a/);

  const syncResult1 = await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers));
  assert.equal(syncResult1.code, 0, syncResult1.stderr);
  assert.match(syncResult1.stdout, /imported=1 skipped=0/);

  const syncResult2 = await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers));
  assert.equal(syncResult2.code, 0, syncResult2.stderr);
  assert.match(syncResult2.stdout, /imported=0 skipped=1/);

  const state = await readState(projectDir);
  assert.equal(state.maintenance.importSourceCount, 1);
  assert.equal(state.maintenance.historyEventCount, 2);
});

test("history log stays prefix-stable across update, import sync, and recall", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const claudeImportDir = await createClaudeImportSource([
    {
      text: "DECISION: Use cache layer\nGOTCHA: Reset local cache before query\nNEXT: Write cache playbook\nPATH: src/cache.ts",
    },
  ]);

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const eventsAfterInit = await fs.readFile(path.join(projectDir, ".agent-memory", "history", "events.jsonl"), "utf8");

  assert.equal((await runCli(projectDir, ["update", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const eventsAfterUpdate = await fs.readFile(path.join(projectDir, ".agent-memory", "history", "events.jsonl"), "utf8");
  assert.ok(eventsAfterUpdate.startsWith(eventsAfterInit));

  assert.equal((await runCli(projectDir, ["import", "add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);
  const eventsAfterImport = await fs.readFile(path.join(projectDir, ".agent-memory", "history", "events.jsonl"), "utf8");
  assert.ok(eventsAfterImport.startsWith(eventsAfterUpdate));

  assert.equal((await runCli(projectDir, ["recall", "--yes", "--provider=codex", "--source=imports"], providerEnv(providers))).code, 0);
  const eventsAfterRecall = await fs.readFile(path.join(projectDir, ".agent-memory", "history", "events.jsonl"), "utf8");
  assert.ok(eventsAfterRecall.startsWith(eventsAfterImport));
});

test("import sync handles real fixture snapshots for Claude and Codex local history", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal(
    (await runCli(projectDir, ["import", "add", "claude-local", fixturePath("claude-local"), "--name", "claude-real"], providerEnv(providers))).code,
    0,
  );
  assert.equal(
    (await runCli(projectDir, ["import", "add", "codex-local", fixturePath("codex-local"), "--name", "codex-real"], providerEnv(providers))).code,
    0,
  );

  const result = await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /claude-real: imported=3 skipped=0 failed=0/);
  assert.match(result.stdout, /codex-real: imported=3 skipped=0 failed=0/);

  const sources = await readSources(projectDir);
  assert.ok(sources.every((source) => source.lastSyncStatus === "passed"));
  assert.equal((await readEvents(projectDir)).length, 7);
});

test("import sync reports partial failures without aborting the whole source", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal(
    (await runCli(projectDir, ["import", "add", "claude-local", fixturePath("claude-local-mixed"), "--name", "claude-mixed"], providerEnv(providers))).code,
    0,
  );

  const result = await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /claude-mixed: imported=1 skipped=0 failed=1/);
  assert.match(result.stdout, /failed .*bad\.jsonl: Invalid JSONL transcript/);

  const sources = await readSources(projectDir);
  const mixedSource = sources.find((source) => source.id === "claude-mixed");
  assert.ok(mixedSource);
  assert.equal(mixedSource.lastSyncStatus, "failed");
  assert.match(mixedSource.lastSyncError, /Invalid JSONL transcript/);
  assert.equal(mixedSource.lastImportedCount, 1);
});

test("recall prints a no-op message when nothing new needs consolidation", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const claudeImportDir = await createClaudeImportSource([
    {
      text: "DECISION: Use cache layer\nGOTCHA: Reset local cache before query\nNEXT: Write cache playbook\nDONE: Review the generated state\nPATH: src/cache.ts\nVALIDATION: cache validation is flaky",
    },
  ]);

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["recall", "--yes", "--provider=codex", "--source=imports"], providerEnv(providers))).code, 0);

  const stateBefore = await fs.readFile(path.join(projectDir, ".agent-memory", "state.json"), "utf8");
  const eventsBefore = await fs.readFile(path.join(projectDir, ".agent-memory", "history", "events.jsonl"), "utf8");
  const checkpointsBefore = await checkpointFiles(projectDir);

  const result = await runCli(projectDir, ["recall", "--provider=codex", "--source=imports"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Nothing to recall/);
  assert.equal(await fs.readFile(path.join(projectDir, ".agent-memory", "state.json"), "utf8"), stateBefore);
  assert.equal(await fs.readFile(path.join(projectDir, ".agent-memory", "history", "events.jsonl"), "utf8"), eventsBefore);
  assert.deepEqual(await checkpointFiles(projectDir), checkpointsBefore);
});

test("recall supports section-aware updates and protects unselected sections", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const claudeImportDir = await createClaudeImportSource([
    {
      text: "DECISION: Use cache layer\nGOTCHA: Reset local cache before query\nNEXT: Write cache playbook\nDONE: Review the generated state\nPATH: src/cache.ts\nVALIDATION: cache validation is flaky",
    },
  ]);

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const beforeState = await readState(projectDir);
  assert.equal((await runCli(projectDir, ["import", "add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

  const result = await runCli(
    projectDir,
    ["recall", "--yes", "--provider=codex", "--source=imports", "--section=gotchas"],
    providerEnv(providers),
  );
  assert.equal(result.code, 0, result.stderr);

  const afterState = await readState(projectDir);
  assert.ok(afterState.bundle.gotchas.some((item) => item.title === "Reset local cache before query"));
  assert.deepEqual(afterState.bundle.nextSteps, beforeState.bundle.nextSteps);
  assert.deepEqual(afterState.bundle.projectMap, beforeState.bundle.projectMap);
});

test("project-map-protected policy prevents project-map changes during recall all", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const claudeImportDir = await createClaudeImportSource([
    {
      text: "DECISION: Replace project map\nNEXT: Rewrite architecture map\nPATH: src/cache.ts",
    },
  ]);

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const config = await readConfig(projectDir);
  config.recall.policy = "project-map-protected";
  await fs.writeFile(path.join(projectDir, ".agent-memory", "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const beforeState = await readState(projectDir);

  assert.equal((await runCli(projectDir, ["import", "add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["recall", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);

  const afterState = await readState(projectDir);
  assert.deepEqual(afterState.bundle.projectMap, beforeState.bundle.projectMap);
});

test("recall summary reports conservative dedupe merges", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const claudeImportDir = await createClaudeImportSource([
    {
      text: "GOTCHA: Reset local cache before query: refresh branch-local state\nNEXT: Write cache playbook: include reset steps\nPATH: src/cache.ts",
    },
    {
      text: "GOTCHA: Reset local cache before query: clear stale entries after branch changes\nNEXT: Write cache playbook: add troubleshooting examples\nPATH: src/cache.ts",
    },
  ]);

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

  const result = await runCli(projectDir, ["recall", "--provider=codex", "--show-diff"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Merged gotchas:/);
  assert.match(result.stdout, /Merged next steps:/);
});

test("recall preview includes grouped unrecalled history summary", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const claudeImportDir = await createClaudeImportSource([
    {
      text: "GOTCHA: Reset local cache before query: refresh branch-local state\nNEXT: Write cache playbook: include reset steps\nPATH: src/cache.ts",
    },
    {
      text: "GOTCHA: Reset local cache before query: clear stale entries after branch changes\nNEXT: Write cache playbook: add troubleshooting examples\nPATH: src/cache.ts",
    },
  ]);

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

  const result = await runCli(projectDir, ["recall", "--provider=codex", "--source=imports"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Unrecalled History Summary:/);
  assert.match(result.stdout, /- raw events: 2/);
  assert.match(result.stdout, /- grouped items: 1/);
});

test("recall compresses near-duplicate current focus output deterministically", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const claudeImportDir = await createClaudeImportSource([
    {
      text: "DECISION: Cache layer is enabled for query responses\nVALIDATION: Cache validation is flaky",
    },
    {
      text: "DECISION: Cache layer is enabled for query responses in development\nVALIDATION: Cache validation is flaky in CI",
    },
  ]);

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["recall", "--yes", "--provider=codex", "--source=imports"], providerEnv(providers))).code, 0);

  const state = await readState(projectDir);
  const decisionLines = state.bundle.currentFocus.currentState.filter((line) =>
    line.startsWith("Decision: Cache layer is enabled for query responses"),
  );
  const riskLines = state.bundle.currentFocus.knownRisks.filter((line) => /cache validation is flaky/i.test(line));

  assert.equal(decisionLines.length, 1);
  assert.match(decisionLines[0], /development/);
  assert.equal(riskLines.length, 1);
  assert.match(riskLines[0], /in CI/);
});

test("recall groups duplicate local and imported history before provider synthesis", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const claudeImportDir = await createClaudeImportSource([
    {
      text: "GOTCHA: Reset local cache before query\nPATH: src/cache.ts",
    },
  ]);

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

  const state = await readState(projectDir);
  state.maintenance.historyEventCount = 3;
  state.maintenance.recallCursors.all.lastRecalledAt = "2026-03-27T00:00:00.000Z";
  state.maintenance.recallCursors.all.lastRecalledEventId = "evt-000001";
  state.maintenance.lastRecalledAt = "2026-03-27T00:00:00.000Z";
  state.maintenance.lastRecalledEventId = "evt-000001";
  await writeStateFile(projectDir, state);

  await fs.appendFile(
    path.join(projectDir, ".agent-memory", "history", "events.jsonl"),
    `${JSON.stringify({
      id: "evt-000003",
      kind: "tool_run",
      sourceId: "agent-memory.local",
      externalItemId: null,
      createdAt: "2026-03-27T00:00:02.000Z",
      contentHash: "manual-local-history",
      summary: "Manual local cache reminder",
      signals: {
        decisions: [],
        gotchas: ["Reset local cache before query"],
        nextStepHints: [],
        keyPaths: ["src/cache.ts"],
        validationObservations: [],
      },
      sourceRef: "agent-memory:update",
    })}\n`,
    "utf8",
  );

  const result = await runCli(projectDir, ["recall", "--yes", "--provider=codex"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);

  const afterState = await readState(projectDir);
  assert.equal(afterState.bundle.currentFocus.summary, "Recalled 1 history event(s).");
  assert.equal(afterState.maintenance.recallCursors.all.lastRecalledEventId, "evt-000003");
});

test("validate passes on a healthy initialized project with validation baseline", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--validate", "--provider=codex"], providerEnv(providers))).code, 0);
  const result = await runCli(projectDir, ["validate"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /0 failed/);
});

test("validate fails on damaged history and source registry", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--validate", "--provider=codex"], providerEnv(providers))).code, 0);
  await fs.writeFile(path.join(projectDir, ".agent-memory", "history", "events.jsonl"), "{broken jsonl}\n", "utf8");
  let result = await runCli(projectDir, ["validate"], providerEnv(providers));
  assert.equal(result.code, 1);
  assert.match(result.stdout, /history:events-read/);

  assert.equal((await runCli(projectDir, ["init", "--yes", "--validate", "--provider=codex"], providerEnv(providers))).code, 0);
  await fs.writeFile(path.join(projectDir, ".agent-memory", "sources.json"), "{broken json}", "utf8");
  result = await runCli(projectDir, ["validate"], providerEnv(providers));
  assert.equal(result.code, 1);
  assert.match(result.stdout, /sources:read/);
});

test("validate warns when the last import sync failed but state is still usable", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--validate", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal(
    (await runCli(projectDir, ["import", "add", "claude-local", fixturePath("claude-local-mixed"), "--name", "claude-mixed"], providerEnv(providers))).code,
    0,
  );
  assert.equal((await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

  const result = await runCli(projectDir, ["validate"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /WARN sources:sync:claude-mixed/);
});

test("query returns evidence-insufficient when memory does not support the question", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const result = await runCli(projectDir, ["query", "quantum entanglement history", "--provider=codex", "--scope=all"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /does not contain enough evidence/i);
});

test("query citations use stable section and checkpoint identifiers", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["update", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const result = await runCli(projectDir, ["query", "current focus", "--provider=codex", "--scope=all"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /bundle\.currentFocus|bundle\.project|checkpoint:chk-/);
});

test("query can cite an older checkpoint in state scope", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["update", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);

  const result = await runCli(projectDir, ["query", "init focus summary", "--provider=codex", "--scope=state"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\[checkpoint\] chk-000001 checkpoint:chk-000001/);
});

test("query supports json output for agents", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const result = await runCli(projectDir, ["query", "what should I do next?", "--provider=codex", "--output=json"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.mode, "next");
  assert.equal(typeof parsed.answer, "string");
  assert.ok(Array.isArray(parsed.citations));
  assert.ok(parsed.citations.every((citation) => Object.prototype.hasOwnProperty.call(citation, "projectionPath")));
});

test("query honors config defaultOutput when --output is omitted", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const config = await readConfig(projectDir);
  config.query.defaultOutput = "json";
  await fs.writeFile(path.join(projectDir, ".agent-memory", "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const result = await runCli(projectDir, ["query", "what changed recently?", "--provider=codex"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.mode, "changes");
});

test("query uses project-specific template overrides from config", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const config = await readConfig(projectDir);
  config.query.templates.next.instructions = "Use TEMPLATE NEXT OVERRIDE.";
  await fs.writeFile(path.join(projectDir, ".agent-memory", "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const result = await runCli(projectDir, ["query", "what should I do next?", "--provider=codex"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Template: Use TEMPLATE NEXT OVERRIDE\./);
});

test("automate run-once writes an idle latest-run result when no work is pending", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const state = await readState(projectDir);
  state.maintenance.recallCursors.all.lastRecalledAt = "2026-03-27T00:00:00.000Z";
  state.maintenance.recallCursors.all.lastRecalledEventId = "evt-000001";
  state.maintenance.lastRecalledAt = "2026-03-27T00:00:00.000Z";
  state.maintenance.lastRecalledEventId = "evt-000001";
  await writeStateFile(projectDir, state);

  const result = await runCli(projectDir, ["automate", "run-once"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Automation run status: idle/);

  const latestRun = await readAutomationRun(projectDir);
  assert.equal(latestRun.status, "idle");
  assert.equal(latestRun.importSync.attempted, false);
  assert.equal(latestRun.recall.attempted, false);
});

test("automate run-once performs import sync and aggressive recall even with local file changes", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const claudeImportDir = await createClaudeImportSource([
    {
      text: "DECISION: Use cache layer\nGOTCHA: Reset local cache before query\nNEXT: Write cache playbook\nPATH: src/cache.ts",
    },
  ]);

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  await fs.appendFile(path.join(projectDir, "README.md"), "dirty workspace change\n", "utf8");
  assert.equal((await runCli(projectDir, ["import", "add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);

  const result = await runCli(projectDir, ["automate", "run-once"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Automation run status: recalled/);

  const latestRun = await readAutomationRun(projectDir);
  assert.equal(latestRun.status, "recalled");
  assert.equal(latestRun.importSync.attempted, true);
  assert.equal(latestRun.recall.attempted, true);
  assert.equal(latestRun.recall.applied, true);

  const state = await readState(projectDir);
  assert.ok(state.bundle.gotchas.some((item) => item.title === "Reset local cache before query"));
});

test("automate run-once records recalled_noop when unrecalled events do not change durable memory", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const claudeImportDir = await createClaudeImportSource([
    {
      text: "DECISION: Use cache layer\nGOTCHA: Reset local cache before query\nNEXT: Write cache playbook\nDONE: Review the generated state\nPATH: src/cache.ts",
    },
  ]);

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["automate", "run-once"], providerEnv(providers))).code, 0);

  const state = await readState(projectDir);
  state.maintenance.historyEventCount = 4;
  state.maintenance.recallCursors.all.lastRecalledAt = "2026-03-27T00:00:00.000Z";
  state.maintenance.recallCursors.all.lastRecalledEventId = "evt-000003";
  state.maintenance.lastRecalledAt = "2026-03-27T00:00:00.000Z";
  state.maintenance.lastRecalledEventId = "evt-000003";
  await writeStateFile(projectDir, state);

  await fs.appendFile(
    path.join(projectDir, ".agent-memory", "history", "events.jsonl"),
    `${JSON.stringify({
      id: "evt-000004",
      kind: "tool_run",
      sourceId: "agent-memory.local",
      externalItemId: null,
      createdAt: "2026-03-27T00:00:02.000Z",
      contentHash: "noop-local-history",
      summary: "No-op local reminder",
      signals: {
        decisions: [],
        gotchas: [],
        nextStepHints: [],
        keyPaths: [],
        validationObservations: [],
      },
      sourceRef: "agent-memory:update",
    })}\n`,
    "utf8",
  );

  const result = await runCli(projectDir, ["automate", "run-once"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Automation run status: recalled_noop/);

  const latestRun = await readAutomationRun(projectDir);
  assert.equal(latestRun.status, "recalled_noop");
  assert.equal(latestRun.recall.applied, false);
  assert.ok(latestRun.recall.noopReason);
});

test("automate run-once reports failure when import sync cannot reach a source path", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const claudeImportDir = await createClaudeImportSource([
    {
      text: "DECISION: Use cache layer",
    },
  ]);

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const state = await readState(projectDir);
  state.maintenance.recallCursors.all.lastRecalledAt = "2026-03-27T00:00:00.000Z";
  state.maintenance.recallCursors.all.lastRecalledEventId = "evt-000001";
  state.maintenance.lastRecalledAt = "2026-03-27T00:00:00.000Z";
  state.maintenance.lastRecalledEventId = "evt-000001";
  await writeStateFile(projectDir, state);
  assert.equal((await runCli(projectDir, ["import", "add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  await fs.rm(claudeImportDir, { recursive: true, force: true });

  const result = await runCli(projectDir, ["automate", "run-once"], providerEnv(providers));
  assert.equal(result.code, 1);

  const latestRun = await readAutomationRun(projectDir);
  assert.equal(latestRun.status, "failed");
  assert.ok(latestRun.warnings.some((warning) => /failure/i.test(warning)));
});

test("automate daemon lifecycle supports start, status, duplicate start rejection, and stop", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);

  const startResult = await runCli(projectDir, ["automate", "start"], providerEnv(providers));
  assert.equal(startResult.code, 0, startResult.stderr);
  assert.match(startResult.stdout, /Automation daemon started/);

  try {
    const statusResult = await runCli(projectDir, ["automate", "status"], providerEnv(providers));
    assert.equal(statusResult.code, 0, statusResult.stderr);
    assert.match(statusResult.stdout, /Automation daemon: running/);

    const daemonState = await readAutomationDaemon(projectDir);
    assert.equal(typeof daemonState.pid, "number");

    const duplicateStart = await runCli(projectDir, ["automate", "start"], providerEnv(providers));
    assert.equal(duplicateStart.code, 1);
    assert.match(duplicateStart.stderr, /already running/i);
  } finally {
    const stopResult = await runCli(projectDir, ["automate", "stop"], providerEnv(providers));
    assert.equal(stopResult.code, 0, stopResult.stderr);
    assert.match(stopResult.stdout, /Automation daemon (stopped|was not running)/);
  }
});

test("automate ensure-running starts the daemon and is idempotent", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);

  try {
    const first = await runCli(projectDir, ["automate", "ensure-running"], providerEnv(providers));
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /Automation daemon started/);

    const second = await runCli(projectDir, ["automate", "ensure-running"], providerEnv(providers));
    assert.equal(second.code, 0, second.stderr);
    assert.match(second.stdout, /already running/);
  } finally {
    await runCli(projectDir, ["automate", "stop"], providerEnv(providers));
  }
});

test("integrate claude writes project MCP, hooks, and skill files idempotently", async () => {
  const projectDir = await createFixtureProject();
  const first = await runCli(projectDir, ["integrate", "claude"]);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /Integrated target: claude/);
  assert.match(first.stdout, /Changes applied:/);
  assert.match(first.stdout, /CREATE|UPDATE/);

  const mcp = JSON.parse(await fs.readFile(path.join(projectDir, ".mcp.json"), "utf8"));
  assert.equal(mcp.mcpServers["agent-memory"].command, "npx");

  const settings = JSON.parse(await fs.readFile(path.join(projectDir, ".claude", "settings.json"), "utf8"));
  assert.ok(settings.hooks.SessionStart);
  assert.ok(settings.hooks.Stop);

  const skill = await fs.readFile(path.join(projectDir, ".claude", "skills", "agent-memory", "SKILL.md"), "utf8");
  assert.match(skill, /memory_query/);

  const before = await fs.readFile(path.join(projectDir, ".claude", "settings.json"), "utf8");
  const second = await runCli(projectDir, ["integrate", "claude"]);
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /UNCHANGED/);
  const after = await fs.readFile(path.join(projectDir, ".claude", "settings.json"), "utf8");
  assert.equal(after, before);
});

test("integrate codex uses CLI registration when available and preserves AGENTS guidance", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-home-"));
  const codexLog = path.join(fakeHome, "codex-mcp.log");

  const result = await runCli(projectDir, ["integrate", "codex"], {
    ...providerEnv(providers),
    HOME: fakeHome,
    AGENT_MEMORY_FAKE_CODEX_MCP_LOG: codexLog,
  });
  assert.equal(result.code, 0, result.stderr);

  const agents = await fs.readFile(path.join(projectDir, "AGENTS.md"), "utf8");
  assert.match(agents, /automation_ensure_running/);
  assert.match(agents, /memory_query/);

  const codexConfig = await fs.readFile(path.join(fakeHome, ".codex", "config.toml"), "utf8");
  assert.match(codexConfig, /\[mcp_servers\.agent-memory\]/);
  assert.match(codexConfig, /command = "npx"/);

  const log = await fs.readFile(codexLog, "utf8");
  assert.match(log, /"mcp","add","agent-memory"/);
});

test("integrate codex falls back to safe config merge when codex CLI registration fails", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-home-"));

  await fs.mkdir(path.join(fakeHome, ".codex"), { recursive: true });
  await fs.writeFile(
    path.join(fakeHome, ".codex", "config.toml"),
    '[mcp_servers.other]\ncommand = "echo"\nargs = ["hello"]\n',
    "utf8",
  );

  const result = await runCli(projectDir, ["integrate", "codex"], {
    ...providerEnv(providers),
    HOME: fakeHome,
    AGENT_MEMORY_FAKE_CODEX_MCP_MODE: "fail",
  });
  assert.equal(result.code, 0, result.stderr);

  const codexConfig = await fs.readFile(path.join(fakeHome, ".codex", "config.toml"), "utf8");
  assert.match(codexConfig, /\[mcp_servers\.other\]/);
  assert.match(codexConfig, /\[mcp_servers\.agent-memory\]/);
});

test("integrate all combines Claude and Codex integration outputs", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-home-"));

  const result = await runCli(projectDir, ["integrate"], {
    ...providerEnv(providers),
    HOME: fakeHome,
  });
  assert.equal(result.code, 0, result.stderr);

  await fs.access(path.join(projectDir, ".mcp.json"));
  await fs.access(path.join(projectDir, ".claude", "settings.json"));
  await fs.access(path.join(projectDir, ".claude", "skills", "agent-memory", "SKILL.md"));
  await fs.access(path.join(projectDir, "AGENTS.md"));
  await fs.access(path.join(fakeHome, ".codex", "config.toml"));
});

test("integrate claude --dry-run previews changes without writing files", async () => {
  const projectDir = await createFixtureProject();
  const result = await runCli(projectDir, ["integrate", "claude", "--dry-run"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Dry run: yes/);
  assert.match(result.stdout, /Planned changes:/);
  assert.match(result.stdout, /CREATE/);

  await assert.rejects(() => fs.access(path.join(projectDir, ".mcp.json")));
  await assert.rejects(() => fs.access(path.join(projectDir, ".claude", "settings.json")));
});

test("integrate codex --dry-run does not write global config or call codex mcp add", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-home-"));
  const codexLog = path.join(fakeHome, "codex-mcp.log");

  const result = await runCli(projectDir, ["integrate", "codex", "--dry-run"], {
    ...providerEnv(providers),
    HOME: fakeHome,
    AGENT_MEMORY_FAKE_CODEX_MCP_LOG: codexLog,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Dry run: yes/);
  assert.match(result.stdout, /Planned changes:/);

  await assert.rejects(() => fs.access(path.join(fakeHome, ".codex", "config.toml")));
  await assert.rejects(() => fs.access(codexLog));
});

test("integrate --status is read-only and does not call codex mcp add", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-home-"));
  const codexLog = path.join(fakeHome, "codex-mcp.log");

  const result = await runCli(projectDir, ["integrate", "--status"], {
    ...providerEnv(providers),
    HOME: fakeHome,
    AGENT_MEMORY_FAKE_CODEX_MCP_LOG: codexLog,
  });
  assert.equal(result.code, 0, result.stderr);
  await assert.rejects(() => fs.access(path.join(projectDir, ".mcp.json")));
  await assert.rejects(() => fs.access(path.join(fakeHome, ".codex", "config.toml")));
  await assert.rejects(() => fs.access(codexLog));
});

test("integrate --status reports missing components before integration and present after integration", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-home-"));

  const before = await runCli(projectDir, ["integrate", "--status"], {
    ...providerEnv(providers),
    HOME: fakeHome,
  });
  assert.equal(before.code, 0, before.stderr);
  assert.match(before.stdout, /Integration Status:/);
  assert.match(before.stdout, /overall healthy: no/);
  assert.match(before.stdout, /missing/);

  assert.equal((await runCli(projectDir, ["integrate"], {
    ...providerEnv(providers),
    HOME: fakeHome,
  })).code, 0);

  const after = await runCli(projectDir, ["integrate", "--status"], {
    ...providerEnv(providers),
    HOME: fakeHome,
  });
  assert.equal(after.code, 0, after.stderr);
  assert.match(after.stdout, /overall healthy: yes/);
  assert.match(after.stdout, /present/);
  assert.match(after.stdout, /No action is required\./);
});

test("integrate --status --output=json returns machine-readable status", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-home-"));

  const result = await runCli(projectDir, ["integrate", "codex", "--status", "--output=json"], {
    ...providerEnv(providers),
    HOME: fakeHome,
  });
  assert.equal(result.code, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.target, "codex");
  assert.equal(typeof parsed.healthy, "boolean");
  assert.ok(parsed.codex.globalMcpConfig);
  assert.ok(Array.isArray(parsed.warnings));
});

test("integrate treats --status as higher priority than --dry-run", async () => {
  const projectDir = await createFixtureProject();
  const result = await runCli(projectDir, ["integrate", "claude", "--status", "--dry-run"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Integration Status:/);
  assert.doesNotMatch(result.stdout, /Planned changes:/);
});

test("integrate rejects --output without --status", async () => {
  const projectDir = await createFixtureProject();
  const result = await runCli(projectDir, ["integrate", "--output=json"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /only supported together with --status/i);
});

test("integrate status reports managed_mismatch and recover after re-run", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-home-"));

  assert.equal((await runCli(projectDir, ["integrate"], {
    ...providerEnv(providers),
    HOME: fakeHome,
  })).code, 0);

  await fs.writeFile(
    path.join(projectDir, ".mcp.json"),
    JSON.stringify({ mcpServers: { "agent-memory": { command: "echo", args: [] } } }, null, 2),
    "utf8",
  );

  const mismatch = await runCli(projectDir, ["integrate", "--status"], {
    ...providerEnv(providers),
    HOME: fakeHome,
  });
  assert.equal(mismatch.code, 0, mismatch.stderr);
  assert.match(mismatch.stdout, /managed_mismatch/);
  assert.match(mismatch.stdout, /Re-run integrate/);

  const repaired = await runCli(projectDir, ["integrate", "claude"], {
    ...providerEnv(providers),
    HOME: fakeHome,
  });
  assert.equal(repaired.code, 0, repaired.stderr);

  const after = await runCli(projectDir, ["integrate", "--status"], {
    ...providerEnv(providers),
    HOME: fakeHome,
  });
  assert.equal(after.code, 0, after.stderr);
  assert.doesNotMatch(after.stdout, /managed_mismatch/);
});

test("agent-memory mcp supports initialize, tools/list, and tool calls", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const session = await startMcpSession(projectDir, providerEnv(providers));

  try {
    const initResult = await session.request("initialize", {});
    assert.equal(initResult.result.serverInfo.name, "agent-memory");

    await session.notify("notifications/initialized", {});

    const toolsResult = await session.request("tools/list", {});
    assert.ok(Array.isArray(toolsResult.result.tools));
    assert.ok(toolsResult.result.tools.some((tool) => tool.name === "memory_query"));
    assert.ok(toolsResult.result.tools.some((tool) => tool.name === "automation_ensure_running"));

    const toolCall = await session.request("tools/call", {
      name: "memory_validate",
      arguments: {},
    });
    assert.equal(toolCall.result.content[0].type, "text");
    assert.match(toolCall.result.content[0].text, /state:schema|Summary:/);
  } finally {
    await session.close();
  }
});

test("status reports backlog, source health, checkpoint drift, and suggested next action", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const claudeImportDir = await createClaudeImportSource([
    {
      text: "DECISION: Use cache layer\nNEXT: Add cache troubleshooting",
    },
  ]);

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);
  const result = await runCli(projectDir, ["status"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /State:/);
  assert.match(result.stdout, /History:/);
  assert.match(result.stdout, /Sources:/);
  assert.match(result.stdout, /Checkpoint Drift:/);
  assert.match(result.stdout, /Suggested Next Action:/);
});

test("status summarizes grouped unrecalled history by default", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const claudeImportDir = await createClaudeImportSource([
    {
      text: "GOTCHA: Reset local cache before query: refresh branch-local state\nNEXT: Write cache playbook: include reset steps\nPATH: src/cache.ts",
    },
    {
      text: "GOTCHA: Reset local cache before query: clear stale entries after branch changes\nNEXT: Write cache playbook: add troubleshooting examples\nPATH: src/cache.ts",
    },
  ]);

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

  const state = await readState(projectDir);
  state.maintenance.recallCursors.all.lastRecalledAt = "2026-03-27T00:00:00.000Z";
  state.maintenance.recallCursors.all.lastRecalledEventId = "evt-000001";
  state.maintenance.lastRecalledAt = "2026-03-27T00:00:00.000Z";
  state.maintenance.lastRecalledEventId = "evt-000001";
  await writeStateFile(projectDir, state);

  const result = await runCli(projectDir, ["status"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Unrecalled Summary:/);
  assert.match(result.stdout, /- raw events: 2/);
  assert.match(result.stdout, /- grouped items: 1/);
});

test("status summary omits grouped items beyond the first five", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const claudeImportDir = await createClaudeImportSource(
    Array.from({ length: 6 }, (_, index) => ({
      text: `DECISION: Decision ${index + 1}\nGOTCHA: Unique gotcha ${index + 1}\nNEXT: Unique follow-up ${index + 1}\nPATH: src/feature-${index + 1}.ts`,
    })),
  );

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

  const state = await readState(projectDir);
  state.maintenance.recallCursors.all.lastRecalledAt = "2026-03-27T00:00:00.000Z";
  state.maintenance.recallCursors.all.lastRecalledEventId = "evt-000001";
  state.maintenance.lastRecalledAt = "2026-03-27T00:00:00.000Z";
  state.maintenance.lastRecalledEventId = "evt-000001";
  await writeStateFile(projectDir, state);

  const result = await runCli(projectDir, ["status"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /- grouped items: 6/);
  assert.match(result.stdout, /\.\.\. 1 more grouped items omitted \.\.\./);
});

test("status can show diff against a specific checkpoint", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["update", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);

  const checkpoints = await checkpointFiles(projectDir);
  const firstCheckpointId = checkpoints[0].replace(/\.json$/, "");
  const result = await runCli(projectDir, ["status", "--checkpoint", firstCheckpointId, "--show-diff"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /checkpoint: chk-000001|checkpoint: chk-00000/);
  assert.match(result.stdout, /File Diffs:/);
});

test("validate fails when the latest checkpoint is missing", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--validate", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["update", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const state = await readState(projectDir);
  await fs.rm(path.join(projectDir, ".agent-memory", "history", "checkpoints", `${state.maintenance.latestCheckpointId}.json`));

  const result = await runCli(projectDir, ["validate"], providerEnv(providers));
  assert.equal(result.code, 1);
  assert.match(result.stdout, /checkpoints:latest/);
});

test("validate fails when any older checkpoint becomes unreadable", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--validate", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["update", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);

  const checkpoints = await checkpointFiles(projectDir);
  const firstCheckpointId = checkpoints[0].replace(/\.json$/, "");
  await fs.writeFile(
    path.join(projectDir, ".agent-memory", "history", "checkpoints", `${firstCheckpointId}.json`),
    "{broken checkpoint json}\n",
    "utf8",
  );

  const result = await runCli(projectDir, ["validate"], providerEnv(providers));
  assert.equal(result.code, 1);
  assert.match(result.stdout, new RegExp(`checkpoints:read:${firstCheckpointId}`));
});

test("validate warns when recall backlog grows too large", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const claudeImportDir = await createClaudeImportSource(
    Array.from({ length: 11 }, (_, index) => ({
      text: `DECISION: Keep decision ${index + 1}\nGOTCHA: Imported gotcha ${index + 1}\nNEXT: Follow-up ${index + 1}`,
    })),
  );

  assert.equal((await runCli(projectDir, ["init", "--yes", "--validate", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "add", "claude-local", claudeImportDir, "--name", "claude-many"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

  const result = await runCli(projectDir, ["validate"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /WARN recall:backlog/);
});

test("validate fails on an invalid config file", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--validate", "--provider=codex"], providerEnv(providers))).code, 0);
  await fs.writeFile(
    path.join(projectDir, ".agent-memory", "config.json"),
    JSON.stringify({ recall: { defaultSection: "unknown" } }, null, 2),
    "utf8",
  );
  const result = await runCli(projectDir, ["validate"], providerEnv(providers));
  assert.equal(result.code, 1);
  assert.match(result.stdout, /config:schema/);
});

test("recall, query, and import sync reject an old schema state", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  await fs.mkdir(path.join(projectDir, ".agent-memory"), { recursive: true });
  await fs.writeFile(path.join(projectDir, ".agent-memory", "state.json"), JSON.stringify({ schemaVersion: 1 }), "utf8");

  const recallResult = await runCli(projectDir, ["recall", "--yes", "--provider=codex"], providerEnv(providers));
  assert.equal(recallResult.code, 1);
  assert.match(recallResult.stderr, /Invalid state|schemaVersion/i);

  const queryResult = await runCli(projectDir, ["query", "anything", "--provider=codex"], providerEnv(providers));
  assert.equal(queryResult.code, 1);
  assert.match(queryResult.stderr, /Invalid state|schemaVersion/i);

  const syncResult = await runCli(projectDir, ["import", "sync", "--all", "--provider=codex"], providerEnv(providers));
  assert.equal(syncResult.code, 1);
  assert.match(syncResult.stderr, /Invalid state|schemaVersion/i);
});

test("core docs consistently describe the destructive rebuild requirement", async () => {
  const [readme, adoption, overview] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, "README.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "adoption.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "overview.md"), "utf8"),
  ]);

  for (const content of [readme, adoption, overview]) {
    assert.match(content, /no migration path/i);
    assert.match(content, /npx agent-memory init/);
  }
});

test("commands and roadmap docs describe grouped unrecalled history summaries", async () => {
  const [readme, commands, roadmap] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, "README.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "commands.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "roadmap.md"), "utf8"),
  ]);

  assert.match(readme, /grouped unrecalled history summary/i);
  assert.match(commands, /grouped unrecalled history summary/i);
  assert.match(commands, /grouped summary of unrecalled history/i);
  assert.match(roadmap, /grouped unrecalled history summaries/i);
  assert.match(roadmap, /recall input is grouped across local and imported history/i);
});

test("query docs describe natural-language retrieval, json output, and projection links", async () => {
  const [readme, commands, roadmap] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, "README.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "commands.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "roadmap.md"), "utf8"),
  ]);

  assert.match(readme, /--output=json/);
  assert.match(commands, /--output=json/);
  assert.match(readme, /natural-language/i);
  assert.match(commands, /natural-language/i);
  assert.match(readme, /projection docs|projection doc/i);
  assert.match(commands, /projection docs|projection doc/i);
  assert.match(roadmap, /natural-language structured questions|natural language structured questions/i);
});

test("automation docs describe the local daemon and aggressive recall behavior", async () => {
  const [readme, commands, roadmap] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, "README.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "commands.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "roadmap.md"), "utf8"),
  ]);

  assert.match(readme, /automate start/);
  assert.match(commands, /automate run-once/);
  assert.match(readme, /dirty worktrees do not block automation cycles/i);
  assert.match(commands, /dirty worktrees do not block the cycle/i);
  assert.match(roadmap, /local built-in automation daemon/i);
  assert.match(roadmap, /aggressive auto-apply recall/i);
});

test("integration docs describe integrate, mcp, and ensure-running", async () => {
  const [readme, commands, roadmap] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, "README.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "commands.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "roadmap.md"), "utf8"),
  ]);

  assert.match(readme, /npx agent-memory integrate/);
  assert.match(commands, /## `agent-memory integrate`/);
  assert.match(commands, /## `agent-memory mcp`/);
  assert.match(readme, /automate ensure-running/);
  assert.match(commands, /automate ensure-running/);
  assert.match(readme, /Claude Code .*SessionStart.*Stop hooks/i);
  assert.match(readme, /Codex integration uses MCP \+ `AGENTS\.md` \+ the local daemon/i);
  assert.match(readme, /integrate --dry-run/);
  assert.match(readme, /integrate --status --output=json/);
  assert.match(commands, /integrate --dry-run/);
  assert.match(commands, /integrate --status --output=json/);
  assert.match(readme, /--dry-run.*without writing files/i);
  assert.match(commands, /--status.*read-only/i);
  assert.match(roadmap, /safe Codex MCP registration via `integrate`/);
});
