const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { ListRootsRequestSchema, ProgressNotificationSchema } = require("@modelcontextprotocol/sdk/types.js");

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

async function connectSdkClient(transport, roots = null) {
  const client = new Client(
    { name: "agent-memory-test-client", version: "1.0.0" },
    {
      capabilities: roots ? { roots: { listChanged: false } } : {},
    },
  );

  if (roots) {
    client.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: roots.map((root) => ({ uri: pathToFileURL(root).href })),
    }));
  }

  await client.connect(transport);
  return client;
}

async function startSdkMcpClient(projectDir, extraEnv = {}, options = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI_PATH, "mcp", ...(options.args ?? [])],
    cwd: projectDir,
    env: {
      ...process.env,
      ...extraEnv,
    },
    stderr: "pipe",
  });
  const client = await connectSdkClient(transport, options.roots ?? null);

  return {
    client,
    transport,
    async close() {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    },
  };
}

async function startHttpMcpServer(projectDir, extraEnv = {}, args = []) {
  const child = spawn(process.execPath, [CLI_PATH, "mcp", "--transport=http", "--port=0", ...args], {
    cwd: projectDir,
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  const baseUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for HTTP MCP server to start.")), 5000);

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      const match = stderr.match(/Listening on (\S+)/);
      if (!match) {
        return;
      }

      clearTimeout(timer);
      resolve(new URL(match[1]));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      reject(new Error(`HTTP MCP server exited early with code ${code}`));
    });
  });

  return {
    child,
    baseUrl,
    mcpUrl: new URL("/mcp", baseUrl),
    async close() {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.on("close", resolve));
    },
  };
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
  assert.equal((await runCli(projectDir, ["add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

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
  assert.equal((await runCli(projectDir, ["add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

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

  assert.equal((await runCli(projectDir, ["init", "--yes", "--validate", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["update", "--yes", "--validate", "--provider=codex"], providerEnv(providers))).code, 0);

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
  assert.equal((await runCli(projectDir, ["add", "codex-local", codexImportDir, "--name", "codex-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

  const result = await runCli(projectDir, ["query", "stale quickly", "--provider=codex", "--scope=history"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\[event\] evt-000002 event:evt-000002/);
});

test("add/sync register sources and deduplicate imported sessions", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const codexImportDir = await createCodexImportSource([
    {
      text: "DECISION: Use query cache\nGOTCHA: Query cache grows stale quickly\nNEXT: Add cache ttl docs\nPATH: src/query-cache.ts\nVALIDATION: query cache test is noisy",
    },
  ]);

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["add", "codex-local", codexImportDir, "--name", "codex-a"], providerEnv(providers))).code, 0);

  const syncResult1 = await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers));
  assert.equal(syncResult1.code, 0, syncResult1.stderr);
  assert.match(syncResult1.stdout, /imported=1 skipped=0/);

  const syncResult2 = await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers));
  assert.equal(syncResult2.code, 0, syncResult2.stderr);
  assert.match(syncResult2.stdout, /imported=0 skipped=1/);

  const state = await readState(projectDir);
  assert.equal(state.maintenance.importSourceCount, 1);
  assert.equal(state.maintenance.historyEventCount, 2);
});

test("history log stays prefix-stable across update, sync, and recall", async () => {
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

  assert.equal((await runCli(projectDir, ["add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);
  const eventsAfterImport = await fs.readFile(path.join(projectDir, ".agent-memory", "history", "events.jsonl"), "utf8");
  assert.ok(eventsAfterImport.startsWith(eventsAfterUpdate));

  assert.equal((await runCli(projectDir, ["recall", "--yes", "--provider=codex", "--source=imports"], providerEnv(providers))).code, 0);
  const eventsAfterRecall = await fs.readFile(path.join(projectDir, ".agent-memory", "history", "events.jsonl"), "utf8");
  assert.ok(eventsAfterRecall.startsWith(eventsAfterImport));
});

test("sync handles real fixture snapshots for Claude and Codex local history", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal(
    (await runCli(projectDir, ["add", "claude-local", fixturePath("claude-local"), "--name", "claude-real"], providerEnv(providers))).code,
    0,
  );
  assert.equal(
    (await runCli(projectDir, ["add", "codex-local", fixturePath("codex-local"), "--name", "codex-real"], providerEnv(providers))).code,
    0,
  );

  const result = await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /claude-real: imported=3 skipped=0 failed=0/);
  assert.match(result.stdout, /codex-real: imported=3 skipped=0 failed=0/);

  const sources = await readSources(projectDir);
  assert.ok(sources.every((source) => source.lastSyncStatus === "passed"));
  assert.equal((await readEvents(projectDir)).length, 7);
});

test("sync reports partial failures without aborting the whole source", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal(
    (await runCli(projectDir, ["add", "claude-local", fixturePath("claude-local-mixed"), "--name", "claude-mixed"], providerEnv(providers))).code,
    0,
  );

  const result = await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers));
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

test("import list is removed", async () => {
  const projectDir = await createFixtureProject();
  const result = await runCli(projectDir, ["import", "list"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Unknown command: import/);
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
  assert.equal((await runCli(projectDir, ["add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);
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
  assert.equal((await runCli(projectDir, ["add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

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

  assert.equal((await runCli(projectDir, ["add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);
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
  assert.equal((await runCli(projectDir, ["add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

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
  assert.equal((await runCli(projectDir, ["add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

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
  assert.equal((await runCli(projectDir, ["add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);
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
  assert.equal((await runCli(projectDir, ["add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

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

test("validate warns when the last sync failed but state is still usable", { concurrency: false }, async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--validate", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal(
    (await runCli(projectDir, ["add", "claude-local", fixturePath("claude-local-mixed"), "--name", "claude-mixed"], providerEnv(providers))).code,
    0,
  );
  assert.equal((await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

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

  assert.equal((await runCli(projectDir, ["init", "--yes", "--validate", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["update", "--yes", "--validate", "--provider=codex"], providerEnv(providers))).code, 0);
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
  assert.equal(latestRun.prune.attempted, true);
});

test("automate run-once archives recalled old events and older checkpoints", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--validate", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["update", "--yes", "--validate", "--provider=codex"], providerEnv(providers))).code, 0);

  const config = await readConfig(projectDir);
  config.retention.history.maxAgeDays = 0;
  config.retention.checkpoints.maxAgeDays = 0;
  config.retention.checkpoints.keepRecent = 1;
  await fs.writeFile(path.join(projectDir, ".agent-memory", "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const state = await readState(projectDir);
  state.maintenance.recallCursors.all.lastRecalledAt = "2026-03-28T00:00:00.000Z";
  state.maintenance.recallCursors.all.lastRecalledEventId = "evt-000002";
  state.maintenance.recallCursors.local.lastRecalledAt = "2026-03-28T00:00:00.000Z";
  state.maintenance.recallCursors.local.lastRecalledEventId = "evt-000002";
  state.maintenance.lastRecalledAt = "2026-03-28T00:00:00.000Z";
  state.maintenance.lastRecalledEventId = "evt-000002";
  await writeStateFile(projectDir, state);

  const result = await runCli(projectDir, ["automate", "run-once"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /archived events: 2/);
  assert.match(result.stdout, /archived checkpoints: 1/);

  const latestRun = await readAutomationRun(projectDir);
  assert.equal(latestRun.prune.archivedEventCount, 2);
  assert.equal(latestRun.prune.archivedCheckpointCount, 1);
  assert.ok(latestRun.prune.archiveBatchPath);

  const activeEvents = await readEvents(projectDir);
  assert.equal(activeEvents.length, 0);

  const checkpoints = await checkpointFiles(projectDir);
  assert.deepEqual(checkpoints.sort(), ["chk-000002.json"]);

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectDir, latestRun.prune.archiveBatchPath, "manifest.json"), "utf8"),
  );
  assert.deepEqual(manifest.archivedEventIds, ["evt-000001", "evt-000002"]);
  assert.deepEqual(manifest.archivedCheckpointIds, ["chk-000001"]);

  const validateResult = await runCli(projectDir, ["validate"], providerEnv(providers));
  assert.equal(validateResult.code, 0, validateResult.stderr);
});

test("automate run-once never prunes old unrecalled events", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);

  const config = await readConfig(projectDir);
  config.retention.history.maxAgeDays = 0;
  config.automation.autoRecall = false;
  await fs.writeFile(path.join(projectDir, ".agent-memory", "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const state = await readState(projectDir);
  state.maintenance.historyEventCount = 2;
  state.maintenance.recallCursors.all.lastRecalledAt = "2026-03-28T00:00:00.000Z";
  state.maintenance.recallCursors.all.lastRecalledEventId = "evt-000001";
  state.maintenance.recallCursors.local.lastRecalledAt = "2026-03-28T00:00:00.000Z";
  state.maintenance.recallCursors.local.lastRecalledEventId = "evt-000001";
  state.maintenance.lastRecalledAt = "2026-03-28T00:00:00.000Z";
  state.maintenance.lastRecalledEventId = "evt-000001";
  await writeStateFile(projectDir, state);

  await fs.appendFile(
    path.join(projectDir, ".agent-memory", "history", "events.jsonl"),
    `${JSON.stringify({
      id: "evt-000002",
      kind: "tool_run",
      sourceId: "agent-memory.local",
      externalItemId: null,
      createdAt: "2020-01-01T00:00:00.000Z",
      contentHash: "unrecalled-old-history",
      summary: "Old unrecalled local event",
      signals: {
        decisions: ["Keep unrecalled history"],
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

  const latestRun = await readAutomationRun(projectDir);
  assert.equal(latestRun.prune.archivedEventCount, 1);

  const remainingEvents = await readEvents(projectDir);
  assert.deepEqual(remainingEvents.map((event) => event.id), ["evt-000002"]);
});

test("automate run-once skips pruning when retention is disabled", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["update", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);

  const config = await readConfig(projectDir);
  config.retention.enabled = false;
  config.retention.history.maxAgeDays = 0;
  config.retention.checkpoints.maxAgeDays = 0;
  config.retention.checkpoints.keepRecent = 1;
  await fs.writeFile(path.join(projectDir, ".agent-memory", "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const state = await readState(projectDir);
  state.maintenance.recallCursors.all.lastRecalledAt = "2026-03-28T00:00:00.000Z";
  state.maintenance.recallCursors.all.lastRecalledEventId = "evt-000002";
  state.maintenance.recallCursors.local.lastRecalledAt = "2026-03-28T00:00:00.000Z";
  state.maintenance.recallCursors.local.lastRecalledEventId = "evt-000002";
  state.maintenance.lastRecalledAt = "2026-03-28T00:00:00.000Z";
  state.maintenance.lastRecalledEventId = "evt-000002";
  await writeStateFile(projectDir, state);

  const result = await runCli(projectDir, ["automate", "run-once"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);

  const latestRun = await readAutomationRun(projectDir);
  assert.equal(latestRun.prune.attempted, false);
  assert.match(latestRun.prune.skippedReason, /disabled/i);

  const activeEvents = await readEvents(projectDir);
  assert.equal(activeEvents.length, 2);
  assert.deepEqual((await checkpointFiles(projectDir)).sort(), ["chk-000001.json", "chk-000002.json"]);
});

test("automate run-once keeps active history and checkpoints unchanged when archive write fails", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["update", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);

  const config = await readConfig(projectDir);
  config.retention.history.maxAgeDays = 0;
  config.retention.checkpoints.maxAgeDays = 0;
  config.retention.checkpoints.keepRecent = 1;
  await fs.writeFile(path.join(projectDir, ".agent-memory", "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const state = await readState(projectDir);
  state.maintenance.recallCursors.all.lastRecalledAt = "2026-03-28T00:00:00.000Z";
  state.maintenance.recallCursors.all.lastRecalledEventId = "evt-000002";
  state.maintenance.recallCursors.local.lastRecalledAt = "2026-03-28T00:00:00.000Z";
  state.maintenance.recallCursors.local.lastRecalledEventId = "evt-000002";
  state.maintenance.lastRecalledAt = "2026-03-28T00:00:00.000Z";
  state.maintenance.lastRecalledEventId = "evt-000002";
  await writeStateFile(projectDir, state);

  const beforeEventsRaw = await fs.readFile(path.join(projectDir, ".agent-memory", "history", "events.jsonl"), "utf8");
  const beforeCheckpointFiles = (await checkpointFiles(projectDir)).sort();
  await fs.writeFile(path.join(projectDir, ".agent-memory", "archive"), "not-a-directory\n", "utf8");

  const result = await runCli(projectDir, ["automate", "run-once"], providerEnv(providers));
  assert.equal(result.code, 1);

  const afterEventsRaw = await fs.readFile(path.join(projectDir, ".agent-memory", "history", "events.jsonl"), "utf8");
  assert.equal(afterEventsRaw, beforeEventsRaw);
  assert.deepEqual((await checkpointFiles(projectDir)).sort(), beforeCheckpointFiles);
});

test("automate run-once expires old archive batches", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["update", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);

  const config = await readConfig(projectDir);
  config.retention.history.maxAgeDays = 0;
  config.retention.checkpoints.maxAgeDays = 0;
  config.retention.checkpoints.keepRecent = 1;
  config.retention.archive.expireAfterDays = 180;
  await fs.writeFile(path.join(projectDir, ".agent-memory", "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const state = await readState(projectDir);
  state.maintenance.recallCursors.all.lastRecalledAt = "2026-03-28T00:00:00.000Z";
  state.maintenance.recallCursors.all.lastRecalledEventId = "evt-000002";
  state.maintenance.recallCursors.local.lastRecalledAt = "2026-03-28T00:00:00.000Z";
  state.maintenance.recallCursors.local.lastRecalledEventId = "evt-000002";
  state.maintenance.lastRecalledAt = "2026-03-28T00:00:00.000Z";
  state.maintenance.lastRecalledEventId = "evt-000002";
  await writeStateFile(projectDir, state);

  assert.equal((await runCli(projectDir, ["automate", "run-once"], providerEnv(providers))).code, 0);
  const firstRun = await readAutomationRun(projectDir);
  const manifestPath = path.join(projectDir, firstRun.prune.archiveBatchPath, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.createdAt = "2020-01-01T00:00:00.000Z";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const configAfter = await readConfig(projectDir);
  configAfter.retention.archive.expireAfterDays = 0;
  await fs.writeFile(path.join(projectDir, ".agent-memory", "config.json"), `${JSON.stringify(configAfter, null, 2)}\n`, "utf8");

  const second = await runCli(projectDir, ["automate", "run-once"], providerEnv(providers));
  assert.equal(second.code, 0, second.stderr);

  const secondRun = await readAutomationRun(projectDir);
  assert.equal(secondRun.prune.expiredArchiveBatchCount, 1);
  await assert.rejects(() => fs.access(path.join(projectDir, firstRun.prune.archiveBatchPath)));
});

test("automate run-once performs sync and aggressive recall even with local file changes", async () => {
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
  assert.equal((await runCli(projectDir, ["add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);

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
  assert.equal((await runCli(projectDir, ["add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
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

test("automate run-once reports failure when sync cannot reach a source path", async () => {
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
  assert.equal((await runCli(projectDir, ["add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
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
  assert.match(skill, /memory_assess/);
  assert.match(skill, /memory_compact_handoff/);
  assert.match(skill, /memory_maintain/);
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
  assert.match(agents, /memory_assess/);
  assert.match(agents, /memory_query/);
  assert.match(agents, /memory_compact_handoff/);
  assert.match(agents, /memory_maintain/);

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

test("integrate rejects --repair together with --status", async () => {
  const projectDir = await createFixtureProject();
  const result = await runCli(projectDir, ["integrate", "--repair", "--status"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /cannot be used together with --status/i);
});

test("integrate --repair --dry-run previews only mismatched components without writing files", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-home-"));
  const codexLog = path.join(fakeHome, "codex-mcp.log");

  assert.equal((await runCli(projectDir, ["integrate"], {
    ...providerEnv(providers),
    HOME: fakeHome,
  })).code, 0);

  await fs.writeFile(
    path.join(projectDir, ".mcp.json"),
    JSON.stringify({ mcpServers: { "agent-memory": { command: "echo", args: [] } } }, null, 2),
    "utf8",
  );
  const beforeSettings = await fs.readFile(path.join(projectDir, ".claude", "settings.json"), "utf8");

  const result = await runCli(projectDir, ["integrate", "claude", "--repair", "--dry-run"], {
    ...providerEnv(providers),
    HOME: fakeHome,
    AGENT_MEMORY_FAKE_CODEX_MCP_LOG: codexLog,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Repair mode: yes/);
  assert.match(result.stdout, /Planned repairs:/);
  assert.match(result.stdout, /\.mcp\.json/);
  assert.doesNotMatch(result.stdout, /\.claude\/settings\.json/);

  const afterSettings = await fs.readFile(path.join(projectDir, ".claude", "settings.json"), "utf8");
  assert.equal(afterSettings, beforeSettings);
  await assert.rejects(() => fs.access(codexLog));
});

test("integrate --repair fixes only mismatched managed components", async () => {
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
  const beforeSkill = await fs.readFile(path.join(projectDir, ".claude", "skills", "agent-memory", "SKILL.md"), "utf8");

  const result = await runCli(projectDir, ["integrate", "claude", "--repair"], {
    ...providerEnv(providers),
    HOME: fakeHome,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Repair mode: yes/);
  assert.match(result.stdout, /Repairs applied:/);
  assert.match(result.stdout, /\.mcp\.json/);
  assert.doesNotMatch(result.stdout, /\.claude\/skills\/agent-memory\/SKILL\.md/);

  const repairedStatus = await runCli(projectDir, ["integrate", "claude", "--status"], {
    ...providerEnv(providers),
    HOME: fakeHome,
  });
  assert.equal(repairedStatus.code, 0, repairedStatus.stderr);
  assert.doesNotMatch(repairedStatus.stdout, /managed_mismatch/);

  const afterSkill = await fs.readFile(path.join(projectDir, ".claude", "skills", "agent-memory", "SKILL.md"), "utf8");
  assert.equal(afterSkill, beforeSkill);
});

test("integrate --repair does not create missing components and gives next action guidance", async () => {
  const projectDir = await createFixtureProject();
  const result = await runCli(projectDir, ["integrate", "claude", "--repair"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Nothing to repair/);
  assert.match(result.stdout, /Run `agent-memory integrate claude`/);
  await assert.rejects(() => fs.access(path.join(projectDir, ".mcp.json")));
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

test("agent-memory mcp exposes SDK-backed tools, annotations, and structured results over stdio", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const session = await startSdkMcpClient(projectDir, providerEnv(providers));

  try {
    const toolsResult = await session.client.listTools();
    assert.ok(Array.isArray(toolsResult.tools));
    assert.ok(toolsResult.tools.some((tool) => tool.name === "memory_assess"));
    assert.ok(toolsResult.tools.some((tool) => tool.name === "memory_maintain"));
    assert.ok(toolsResult.tools.some((tool) => tool.name === "memory_compact_handoff"));
    assert.ok(toolsResult.tools.some((tool) => tool.name === "memory_query"));
    assert.ok(toolsResult.tools.some((tool) => tool.name === "automation_ensure_running"));

    const assessTool = toolsResult.tools.find((tool) => tool.name === "memory_assess");
    assert.equal(assessTool.annotations.readOnlyHint, true);
    assert.equal(assessTool.annotations.destructiveHint, false);

    const assessCall = await session.client.callTool({
      name: "memory_assess",
      arguments: {},
    });
    assert.equal(assessCall.content[0].type, "text");
    assert.match(assessCall.content[0].text, /Status:/);
    assert.equal(assessCall.structuredContent.tool, "memory_assess");
    assert.equal(assessCall.structuredContent.schemaVersion, 1);
    assert.ok(["healthy", "attention", "unhealthy"].includes(assessCall.structuredContent.data.details.memoryHealth));
    assert.equal(typeof assessCall.structuredContent.data.details.backlog.unrecalledAll, "number");
    assert.equal(typeof assessCall.structuredContent.data.details.retention.enabled, "boolean");

    const handoffCall = await session.client.callTool({
      name: "memory_compact_handoff",
      arguments: {},
    });
    assert.equal(handoffCall.content[0].type, "text");
    assert.match(handoffCall.content[0].text, /Suggested Next Action:/);
    assert.equal(handoffCall.structuredContent.tool, "memory_compact_handoff");
    assert.ok(Array.isArray(handoffCall.structuredContent.data.details.topGotchas));
    assert.equal(typeof handoffCall.structuredContent.data.details.retentionSummary, "string");

    const maintainCall = await session.client.callTool({
      name: "memory_maintain",
      arguments: {},
    });
    assert.equal(maintainCall.content[0].type, "text");
    assert.equal(maintainCall.structuredContent.tool, "memory_maintain");
    assert.ok(["ok", "warn", "fail"].includes(maintainCall.structuredContent.data.status));
    assert.equal(typeof maintainCall.structuredContent.data.details.daemon.startedNow, "boolean");
    assert.equal(typeof maintainCall.structuredContent.data.details.prune.attempted, "boolean");
    assert.match(maintainCall.structuredContent.data.details.latestRunPath, /latest-run\.json$/);
  } finally {
    await runCli(projectDir, ["automate", "stop"], providerEnv(providers)).catch(() => undefined);
    await session.close();
  }
});

test("agent-memory mcp exposes query, status, and validate contracts with versioned structured content", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const session = await startSdkMcpClient(projectDir, providerEnv(providers));

  try {
    const queryCall = await session.client.callTool({
      name: "memory_query",
      arguments: {
        question: "what should I do next?",
      },
    });
    assert.equal(queryCall.structuredContent.tool, "memory_query");
    assert.equal(queryCall.structuredContent.schemaVersion, 1);
    assert.equal(typeof queryCall.structuredContent.data.answer, "string");
    assert.match(queryCall.content[0].text, /Answer:/);

    const statusCall = await session.client.callTool({
      name: "memory_status",
      arguments: {},
    });
    assert.equal(statusCall.structuredContent.tool, "memory_status");
    assert.equal(typeof statusCall.structuredContent.data.history.unrecalledAll, "number");
    assert.match(statusCall.content[0].text, /Latest checkpoint:/);

    const validateCall = await session.client.callTool({
      name: "memory_validate",
      arguments: {},
    });
    assert.equal(validateCall.structuredContent.tool, "memory_validate");
    assert.ok(Array.isArray(validateCall.structuredContent.data));
    assert.equal(validateCall.isError, undefined);
    assert.match(validateCall.content[0].text, /Summary:/);
  } finally {
    await session.close();
  }
});

test("agent-memory mcp prefers client roots over the process cwd", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const alternateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-empty-root-"));

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const session = await startSdkMcpClient(projectDir, providerEnv(providers), { roots: [alternateRoot] });

  try {
    const validateCall = await session.client.callTool({
      name: "memory_validate",
      arguments: {},
    });
    assert.equal(validateCall.structuredContent.tool, "memory_validate");
    assert.ok(validateCall.structuredContent.data.some((finding) => finding.code === "state:missing"));
  } finally {
    await session.close();
  }
});

test("agent-memory mcp sends progress notifications for long-running tools", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const session = await startSdkMcpClient(projectDir, providerEnv(providers));
  const progressMessages = [];

  try {
    session.client.setNotificationHandler(ProgressNotificationSchema, (notification) => {
      progressMessages.push(notification.params.message);
    });

    await session.client.callTool({
      name: "memory_validate",
      arguments: {},
      _meta: {
        progressToken: "validate-progress",
      },
    });

    assert.deepEqual(progressMessages, ["Loading state", "Running workflow", "Summarizing result"]);
  } finally {
    await session.close();
  }
});

test("agent-memory mcp supports HTTP transport with SDK clients", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const server = await startHttpMcpServer(projectDir, providerEnv(providers));
  const transport = new StreamableHTTPClientTransport(server.mcpUrl);
  const client = await connectSdkClient(transport);

  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "memory_assess"));

    const validateCall = await client.callTool({
      name: "memory_validate",
      arguments: {},
    });
    assert.equal(validateCall.structuredContent.tool, "memory_validate");
    assert.ok(Array.isArray(validateCall.structuredContent.data));
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    await server.close();
  }
});

test("agent-memory mcp HTTP transport rejects disallowed hosts", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const server = await startHttpMcpServer(projectDir, providerEnv(providers));

  try {
    const response = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: server.baseUrl.hostname,
        port: server.baseUrl.port,
        path: "/mcp",
        method: "GET",
        headers: {
          Host: "evil.example",
        },
      }, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += String(chunk);
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode, body });
        });
      });
      req.on("error", reject);
      req.end();
    });

    assert.equal(response.statusCode, 403);
    assert.match(response.body, /Access is only allowed/);
  } finally {
    await server.close();
  }
});

test("agent-memory mcp HTTP transport keeps session roots isolated across clients", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();
  const alternateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-empty-root-"));

  assert.equal((await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers))).code, 0);
  const server = await startHttpMcpServer(projectDir, providerEnv(providers));
  const transportA = new StreamableHTTPClientTransport(server.mcpUrl);
  const transportB = new StreamableHTTPClientTransport(server.mcpUrl);
  const clientA = await connectSdkClient(transportA);
  const clientB = await connectSdkClient(transportB, [alternateRoot]);

  try {
    const [validateA, validateB] = await Promise.all([
      clientA.callTool({ name: "memory_validate", arguments: {} }),
      clientB.callTool({ name: "memory_validate", arguments: {} }),
    ]);

    assert.equal(validateA.structuredContent.data.some((finding) => finding.code === "state:missing"), false);
    assert.equal(validateB.structuredContent.data.some((finding) => finding.code === "state:missing"), true);
  } finally {
    await clientA.close().catch(() => undefined);
    await clientB.close().catch(() => undefined);
    await transportA.close().catch(() => undefined);
    await transportB.close().catch(() => undefined);
    await server.close();
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
  assert.equal((await runCli(projectDir, ["add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);
  const result = await runCli(projectDir, ["status"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /State:/);
  assert.match(result.stdout, /History:/);
  assert.match(result.stdout, /Sources:/);
  assert.match(result.stdout, /Checkpoint Drift:/);
  assert.match(result.stdout, /Retention:/);
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
  assert.equal((await runCli(projectDir, ["add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

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
  assert.equal((await runCli(projectDir, ["add", "claude-local", claudeImportDir, "--name", "claude-a"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

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

test("validate warns on damaged archive manifests without failing the canonical system", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  assert.equal((await runCli(projectDir, ["init", "--yes", "--validate", "--provider=codex"], providerEnv(providers))).code, 0);
  await fs.mkdir(path.join(projectDir, ".agent-memory", "archive", "prune-bad"), { recursive: true });
  await fs.writeFile(path.join(projectDir, ".agent-memory", "archive", "prune-bad", "manifest.json"), "{broken json}\n", "utf8");

  const result = await runCli(projectDir, ["validate"], providerEnv(providers));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /WARN archive:manifest:prune-bad/);
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
  assert.equal((await runCli(projectDir, ["add", "claude-local", claudeImportDir, "--name", "claude-many"], providerEnv(providers))).code, 0);
  assert.equal((await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers))).code, 0);

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

test("recall, query, and sync reject an old schema state", async () => {
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

  const syncResult = await runCli(projectDir, ["sync", "--all", "--provider=codex"], providerEnv(providers));
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
  assert.match(roadmap, /Current Product Surface/i);
  assert.match(roadmap, /Canonical memory/i);
  assert.match(roadmap, /Retention and archive management/i);
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
  assert.match(roadmap, /natural-language modes, citations, and JSON output/i);
});

test("automation docs describe the local daemon and aggressive recall behavior", async () => {
  const [readme, commands, roadmap, fileModel] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, "README.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "commands.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "roadmap.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "file-model.md"), "utf8"),
  ]);

  assert.match(readme, /automate start/);
  assert.match(commands, /automate run-once/);
  assert.match(readme, /dirty worktrees do not block automation cycles/i);
  assert.match(commands, /dirty worktrees do not block the cycle/i);
  assert.match(roadmap, /Automation And Retention Safety/i);
  assert.match(roadmap, /archive-first pruning/i);
  assert.match(readme, /retention is enabled by default/i);
  assert.match(commands, /archive batches live in `\.agent-memory\/archive\/`/i);
  assert.match(fileModel, /archive-first retention layer/i);
  assert.match(fileModel, /retention\.history\.maxAgeDays/);
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
  assert.match(readme, /memory_assess/);
  assert.match(readme, /memory_compact_handoff/);
  assert.match(readme, /memory_maintain/);
  assert.match(readme, /integrate --dry-run/);
  assert.match(readme, /integrate --status --output=json/);
  assert.match(readme, /integrate --repair/);
  assert.match(commands, /integrate --dry-run/);
  assert.match(commands, /integrate --status --output=json/);
  assert.match(commands, /integrate --repair/);
  assert.match(readme, /transport=http/);
  assert.match(commands, /transport=http/);
  assert.match(commands, /memory_assess/);
  assert.match(commands, /memory_compact_handoff/);
  assert.match(commands, /memory_maintain/);
  assert.match(readme, /--dry-run.*without writing files/i);
  assert.match(commands, /--status.*read-only/i);
  assert.match(readme, /--repair.*managed mismatches/i);
  assert.match(roadmap, /Integration Maturity/i);
  assert.match(roadmap, /integrate/i);
});

test("workflow docs describe richer MCP workflow as the current Phase 4 focus", async () => {
  const [readme, commands, roadmap, fileModel] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, "README.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "commands.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "roadmap.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "file-model.md"), "utf8"),
  ]);

  assert.match(readme, /memory_assess/);
  assert.match(readme, /memory_compact_handoff/);
  assert.match(readme, /memory_maintain/);
  assert.match(commands, /memory_assess/);
  assert.match(commands, /memory_compact_handoff/);
  assert.match(commands, /memory_maintain/);
  assert.match(roadmap, /Workflow-First Experience/i);
  assert.match(roadmap, /memory_assess/);
  assert.match(roadmap, /memory_compact_handoff/);
  assert.match(roadmap, /memory_maintain/);
  assert.match(roadmap, /higher-level workflow tools exposed through the MCP surface/i);
  assert.match(fileModel, /archived data/i);
});

test("README and roadmap describe the self-host dogfood workflow", async () => {
  const [readme, roadmap] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, "README.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "roadmap.md"), "utf8"),
  ]);

  assert.match(readme, /npm run dogfood:init/);
  assert.match(readme, /npm run dogfood:exercise/);
  assert.match(readme, /npm run dogfood:repair/);
  assert.match(readme, /isolated git worktree/i);
  assert.match(readme, /inherits your real `HOME` by default/i);
  assert.match(roadmap, /Dogfood And Repair Loop/i);
  assert.match(roadmap, /dogfood:init\|exercise\|repair\|status/);
  assert.match(roadmap, /isolated while preserving realistic operator conditions/i);
});

test("docs describe add and sync as the official external session commands", async () => {
  const [readme, commands, roadmap, adoption] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, "README.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "commands.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "roadmap.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "adoption.md"), "utf8"),
  ]);

  assert.match(readme, /agent-memory add/);
  assert.match(readme, /agent-memory sync/);
  assert.doesNotMatch(readme, /agent-memory import list/);
  assert.match(commands, /## `agent-memory add`/);
  assert.match(commands, /## `agent-memory sync`/);
  assert.doesNotMatch(commands, /## `agent-memory import`/);
  assert.match(roadmap, /External history ingestion/);
  assert.match(roadmap, /`add`, `sync`/);
  assert.match(adoption, /Use `add` and `sync` to ingest external sessions/);
});

test("roadmap documents Phase 3 completion and Phase 4 first-milestone completion", async () => {
  const [roadmap, overview] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, "docs", "roadmap.md"), "utf8"),
    fs.readFile(path.join(REPO_ROOT, "docs", "overview.md"), "utf8"),
  ]);

  assert.match(roadmap, /Current Product Surface/);
  assert.match(roadmap, /natural-language modes, citations, and JSON output/i);
  assert.match(roadmap, /automate start\|stop\|status\|run-once\|ensure-running/);
  assert.match(roadmap, /integrate.*Claude Code and Codex/);
  assert.match(roadmap, /MCP access/);
  assert.match(roadmap, /Next Major Goals/);
  assert.match(overview, /- `status`/);
  assert.match(overview, /- `query`/);
  assert.match(overview, /- `add`/);
  assert.match(overview, /- `sync`/);
  assert.match(overview, /- `automate`/);
  assert.match(overview, /- `integrate`/);
  assert.match(overview, /- `mcp`/);
});
