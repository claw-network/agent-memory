const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { ListRootsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(REPO_ROOT, "dist", "cli.js");
const FIXTURES_DIR = path.join(REPO_ROOT, "test", "fixtures");

function fakeProviderConfig(overrides = {}) {
  return {
    projectName: "fixture-project",
    recommendedEntryFile: "src/index.js",
    keyPaths: ["package.json", "README.md", "src/index.js"],
    modulePath: "src",
    moduleResponsibility: "Primary application source surface.",
    updatedModuleResponsibility: "Updated application source surface.",
    entrypointRole: "Primary runtime entrypoint.",
    denseSourceNote: "Core repository logic lives here.",
    architectureNotes: [
      "Fake provider architecture note for {mode}.",
      "Provider used: {provider}.",
    ],
    gotchas: [
      {
        title: "Initial gotcha",
        symptom: "A fake failure is encountered.",
        cause: "The fake provider injected this sample gotcha.",
        correctPath: "Follow the generated docs and rerun the command.",
      },
    ],
    nextSteps: [
      {
        title: "Review the generated state",
        why: "Confirm the canonical bundle matches the repository reality.",
        start: "Open docs/agent-memory/current-focus.md.",
        done: "The generated memory looks trustworthy.",
      },
      {
        title: "Document package workflow",
        why: "Record the package manager workflow for the next contributor.",
        start: "Update docs/agent-memory/README.md.",
        done: "The package workflow is documented.",
      },
    ],
    validationCommands: [
      {
        label: "node smoke",
        command: ["node", "-e", "process.stdout.write('validation-ok')"],
        purpose: "Confirm Node-based command execution works.",
      },
    ],
    ...overrides,
  };
}

async function writeExecutable(filePath, content) {
  await fs.writeFile(filePath, content, "utf8");
  await fs.chmod(filePath, 0o755);
}

function buildFakeProviderSource(options = {}) {
  const config = fakeProviderConfig(options);

  return `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const CONFIG = ${JSON.stringify(config)};

function renderTemplate(value, provider, mode) {
  return String(value)
    .replaceAll("{provider}", provider)
    .replaceAll("{mode}", mode);
}

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
  const selectedEntryFile = context.selectedEntryFile || CONFIG.recommendedEntryFile;
  const snapshotStatus = computeSnapshotStatus(validationResults);
  const validatedAt = snapshotStatus === "not-run" ? null : new Date(Date.now() - 60 * 1000).toISOString();

  return {
    project: {
      name: scan.projectName || CONFIG.projectName,
      summary: provider + " generated " + mode + " bundle",
      primaryEcosystem: scan.primaryEcosystem || "node",
      packageManager: scan.packageManager || "npm",
      workspaceManager: scan.workspaceManager || "none",
      recommendedEntryFile: selectedEntryFile,
      keyPaths: CONFIG.keyPaths,
    },
    projectMap: {
      modules: [
        {
          name: CONFIG.modulePath,
          path: CONFIG.modulePath,
          responsibility: mode === "update" ? CONFIG.updatedModuleResponsibility : CONFIG.moduleResponsibility,
        },
      ],
      entrypoints: [
        {
          path: CONFIG.recommendedEntryFile,
          role: CONFIG.entrypointRole,
        },
      ],
      denseSourceAreas: [
        {
          path: CONFIG.modulePath,
          note: CONFIG.denseSourceNote,
        },
      ],
      architectureNotes: CONFIG.architectureNotes.map((note) => renderTemplate(note, provider, mode)),
      firstFilesToRead: CONFIG.keyPaths,
    },
    currentFocus: {
      summary: provider + " " + mode + " focus summary",
      currentState: [
        "Mode: " + mode,
        "Project: " + (scan.projectName || CONFIG.projectName),
      ],
      knownRisks: [
        "Fake provider risk for " + mode + ".",
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
              summary: result.summary,
            }))
          : [],
        suggestedNextActions: snapshotStatus === "not-run"
          ? ["Run the recommended validation command."]
          : ["Keep the validation baseline fresh."],
      },
    },
    gotchas: CONFIG.gotchas,
    nextSteps: CONFIG.nextSteps,
    validationCommands: CONFIG.validationCommands,
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
          correctPath: "Follow the recalled guidance.",
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
          done: "The recalled action is complete.",
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
      projectionPath: null,
    })),
  };
}

function buildImportedNormalization(prompt) {
  const item = parseJsonBlock(prompt, "IMPORT_ITEM_JSON", {});
  const payload = String(item.payload || "");
  const markers = parseMarkers(payload);
  return {
    summary: markers.decisions[0] || markers.gotchas[0] || markers.nextStepHints[0] || ("Imported " + (item.externalItemId || "session")),
    signals: markers,
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
}

async function createFakeProviderBinaries(dir, options = {}) {
  const providerSource = buildFakeProviderSource(options);
  const codexPath = path.join(dir, "fake-codex.js");
  const claudePath = path.join(dir, "fake-claude.js");
  await writeExecutable(codexPath, providerSource);
  await writeExecutable(claudePath, providerSource);
  return { codexPath, claudePath };
}

async function createFixtureProject(options = {}) {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-project-"));
  const packageJson = {
    name: options.name ?? "fixture-project",
    private: true,
    scripts: {
      build: "node -e \"process.stdout.write('build-ok')\"",
      test: "node -e \"process.stdout.write('test-ok')\"",
      ...(options.scripts ?? {}),
    },
    ...(options.packageJson ?? {}),
  };

  const entryFile = options.entryFile ?? "src/index.js";
  const entryPath = path.join(projectDir, entryFile);
  await fs.mkdir(path.dirname(entryPath), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(path.join(projectDir, "README.md"), options.readme ?? "# Fixture Project\n", "utf8");
  await fs.writeFile(entryPath, options.entryContent ?? "module.exports = { value: 1 };\n", "utf8");

  for (const [relativePath, content] of Object.entries(options.extraFiles ?? {})) {
    const absolutePath = path.join(projectDir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf8");
  }

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

module.exports = {
  CLI_PATH,
  FIXTURES_DIR,
  REPO_ROOT,
  checkpointFiles,
  connectSdkClient,
  createClaudeImportSource,
  createCodexImportSource,
  createFakeProviderBinaries,
  createFixtureProject,
  fixturePath,
  providerEnv,
  readAutomationDaemon,
  readAutomationRun,
  readConfig,
  readEvents,
  readSources,
  readState,
  runCli,
  startHttpMcpServer,
  startSdkMcpClient,
  writeStateFile,
};
