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
  const events = parseJsonBlock(prompt, "UNRECALLED_EVENTS_JSON", []);
  const bundle = JSON.parse(JSON.stringify((currentState && currentState.bundle) || {}));
  const gotchaMap = new Map((bundle.gotchas || []).map((gotcha) => [gotcha.title, gotcha]));
  const nextStepMap = new Map((bundle.nextSteps || []).map((step) => [step.title, step]));
  const doneTitles = new Set();
  const extraState = [];
  const extraRisks = [];
  const keyPaths = new Set(bundle.project && Array.isArray(bundle.project.keyPaths) ? bundle.project.keyPaths : []);

  for (const event of events) {
    const signals = event.signals || {};
    for (const gotchaTitle of signals.gotchas || []) {
      if (!gotchaMap.has(gotchaTitle)) {
        gotchaMap.set(gotchaTitle, {
          title: gotchaTitle,
          symptom: "Imported from " + event.sourceId,
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
  const shortlist = parseJsonBlock(prompt, "QUERY_SHORTLIST_JSON", []);
  return {
    answer: "Answer for: " + question,
    why: "Built from " + shortlist.length + " shortlisted memory items.",
    citations: shortlist.slice(0, 2).map((item) => ({
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      pathOrSection: item.pathOrSection,
      summary: item.summary
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
  } else if (prompt.includes("BEGIN_UNRECALLED_EVENTS_JSON")) {
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

function fixturePath(...parts) {
  return path.join(FIXTURES_DIR, ...parts);
}

async function readState(projectDir) {
  return JSON.parse(await fs.readFile(path.join(projectDir, ".agent-memory", "state.json"), "utf8"));
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

async function checkpointFiles(projectDir) {
  return await fs.readdir(path.join(projectDir, ".agent-memory", "history", "checkpoints"));
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
  assert.match(result.stdout, /Citations:/);
  assert.equal(await fs.readFile(path.join(projectDir, ".agent-memory", "state.json"), "utf8"), beforeState);
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
