const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");

async function importDogfoodLib() {
  return await import(path.join(REPO_ROOT, "scripts", "dogfood", "lib.mjs"));
}

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
      name: scan.projectName || "agent-memory",
      summary: provider + " generated " + mode + " bundle",
      primaryEcosystem: scan.primaryEcosystem || "node",
      packageManager: scan.packageManager || "npm",
      workspaceManager: scan.workspaceManager || "none",
      recommendedEntryFile: selectedEntryFile,
      keyPaths: ["package.json", "README.md", "src/cli.ts"]
    },
    projectMap: {
      modules: [
        {
          name: "src",
          path: "src",
          responsibility: "Primary application source surface."
        }
      ],
      entrypoints: [
        {
          path: "src/cli.ts",
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
      firstFilesToRead: ["package.json", "README.md", "src/cli.ts"]
    },
    currentFocus: {
      summary: provider + " " + mode + " focus summary",
      currentState: [
        "Mode: " + mode,
        "Project: " + (scan.projectName || "agent-memory")
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
  const events = parseJsonBlock(prompt, "UNRECALLED_EVIDENCE_JSON", []);
  const bundle = JSON.parse(JSON.stringify((currentState && currentState.bundle) || {}));
  const gotchaMap = new Map((bundle.gotchas || []).map((gotcha) => [gotcha.title, gotcha]));
  const nextStepMap = new Map((bundle.nextSteps || []).map((step) => [step.title, step]));
  const keyPaths = new Set(bundle.project && Array.isArray(bundle.project.keyPaths) ? bundle.project.keyPaths : []);

  for (const event of events) {
    const signals = event.signals || {};
    for (const gotchaTitle of signals.gotchas || []) {
      if (!gotchaMap.has(gotchaTitle)) {
        gotchaMap.set(gotchaTitle, {
          title: gotchaTitle,
          symptom: "Imported history",
          cause: "Derived from session history.",
          correctPath: "Follow recalled guidance."
        });
      }
    }
    for (const hint of signals.nextStepHints || []) {
      const title = hint.startsWith("NEXT: ") ? hint.slice(6) : hint;
      if (!nextStepMap.has(title)) {
        nextStepMap.set(title, {
          title,
          why: "Recalled from history.",
          start: "Follow the recalled action.",
          done: "The recalled action is complete."
        });
      }
    }
    for (const keyPath of signals.keyPaths || []) keyPaths.add(keyPath);
  }

  bundle.gotchas = Array.from(gotchaMap.values());
  bundle.nextSteps = Array.from(nextStepMap.values());
  bundle.project.keyPaths = Array.from(keyPaths);
  bundle.currentFocus.summary = "Recalled " + events.length + " history event(s).";
  bundle.currentFocus.currentState = unique([...(bundle.currentFocus.currentState || [])]);
  bundle.currentFocus.knownRisks = unique([...(bundle.currentFocus.knownRisks || [])]);
  return bundle;
}

function buildQueryResult(prompt) {
  const question = extractBlock(prompt, "QUERY_QUESTION") || "unknown question";
  const mode = extractBlock(prompt, "QUERY_MODE") || "answer";
  const shortlist = parseJsonBlock(prompt, "QUERY_SHORTLIST_JSON", []);
  return {
    mode,
    answer: mode.toUpperCase() + " answer for: " + question,
    why: "Built from " + shortlist.length + " shortlisted memory items.",
    citations: shortlist.slice(0, 2).map((item) => ({
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      pathOrSection: item.pathOrSection,
      summary: item.summary,
      projectionPath: item.projectionPath || null
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

function applyDogfoodRepair(cwd) {
  const packagePath = path.join(cwd, "package.json");
  const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  parsed.scripts = parsed.scripts || {};
  parsed.scripts.test = "node -e \\"process.stdout.write('test-ok')\\"";
  fs.writeFileSync(packagePath, JSON.stringify(parsed, null, 2) + "\\n", "utf8");
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
  const cwd = process.cwd();

  if (args.includes("--version") || args.includes("--help")) {
    process.stdout.write("fake-provider\\n");
    return;
  }

  if (args[0] === "mcp" && args[1] === "add") {
    process.stdout.write("fake codex mcp add success\\n");
    return;
  }

  if (args[0] === "exec" && !args.includes("--output-schema")) {
    if (process.env.DOGFOOD_FAKE_REPAIR_MODE === "fix-test-script") {
      applyDogfoodRepair(cwd);
      process.stdout.write("dogfood repair applied\\n");
      return;
    }
    process.stderr.write("fake agentic repair could not repair\\n");
    process.exit(1);
  }

  const provider = path.basename(process.argv[1]).includes("claude") ? "claude" : "codex";
  const prompt = provider === "codex" ? await readStdin() : args[args.length - 1] || "";

  let payload = "";
  if (prompt.includes("BEGIN_QUERY_QUESTION")) {
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

async function materializeTempRepo() {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-dogfood-repo-"));
  const skip = new Set([".git", "node_modules", "temp"]);

  for (const entry of await fs.readdir(REPO_ROOT, { withFileTypes: true })) {
    if (skip.has(entry.name)) {
      continue;
    }

    await fs.cp(path.join(REPO_ROOT, entry.name), path.join(repoDir, entry.name), {
      recursive: true,
      force: true,
    });
  }

  await fs.symlink(path.join(REPO_ROOT, "node_modules"), path.join(repoDir, "node_modules"), "dir");
  await runCommand("git", ["init"], { cwd: repoDir });
  await runCommand("git", ["config", "user.email", "dogfood@test.invalid"], { cwd: repoDir });
  await runCommand("git", ["config", "user.name", "dogfood test"], { cwd: repoDir });
  await runCommand("git", ["add", "-A"], { cwd: repoDir });
  await runCommand("git", ["commit", "-m", "initial"], { cwd: repoDir });

  return repoDir;
}

async function runCommand(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...(options.env || {}),
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
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && !options.allowFailure) {
        reject(new Error(`${command} ${args.join(" ")} failed: ${stderr || stdout}`));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}

async function runDogfood(repoDir, script, env = {}, allowFailure = false) {
  return await runCommand("npm", ["run", script], { cwd: repoDir, env, allowFailure });
}

function dogfoodTestEnv(repoDir, extra = {}) {
  return {
    HOME: path.join(repoDir, "temp", "dogfood", "home"),
    ...extra,
  };
}

test("classifyChangedPaths separates managed dogfood surfaces from repo paths", async () => {
  const { classifyChangedPaths } = await importDogfoodLib();
  const classified = classifyChangedPaths(
    [".agent-memory/state.json", "docs/agent-memory/README.md", ".mcp.json", "src/core/config-store.ts"],
    "src/cli.ts",
  );

  assert.deepEqual(classified.managedPaths, [".agent-memory/state.json", ".mcp.json", "docs/agent-memory/README.md"]);
  assert.deepEqual(classified.repoPaths, ["src/core/config-store.ts"]);
});

test("dogfood:init builds a self-host baseline in the repo root clone", { concurrency: false }, async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const repoDir = await materializeTempRepo();

  const result = await runDogfood(repoDir, "dogfood:init", {
    AGENT_MEMORY_CODEX_BIN: providers.codexPath,
    AGENT_MEMORY_CLAUDE_BIN: providers.claudePath,
    AGENT_MEMORY_DOGFOOD_SKIP_BUILD: "1",
    ...dogfoodTestEnv(repoDir),
  });
  assert.equal(result.code, 0, result.stderr);

  await fs.access(path.join(repoDir, ".agent-memory", "state.json"));
  await fs.access(path.join(repoDir, "docs", "agent-memory", "README.md"));
  await fs.access(path.join(repoDir, ".mcp.json"));
  await fs.access(path.join(repoDir, ".claude", "settings.json"));
  await fs.access(path.join(repoDir, ".claude", "skills", "agent-memory", "SKILL.md"));
  await fs.access(path.join(repoDir, "AGENTS.md"));
  await fs.access(path.join(repoDir, "temp", "dogfood", "home", ".codex", "config.toml"));
});

test("dogfood:exercise runs in an isolated worktree and writes the latest report", { concurrency: false }, async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const repoDir = await materializeTempRepo();
  const env = {
    AGENT_MEMORY_CODEX_BIN: providers.codexPath,
    AGENT_MEMORY_CLAUDE_BIN: providers.claudePath,
    AGENT_MEMORY_DOGFOOD_SKIP_BUILD: "1",
    ...dogfoodTestEnv(repoDir),
  };

  await runDogfood(repoDir, "dogfood:init", env);
  const beforeStatus = (await runCommand("git", ["status", "--short"], { cwd: repoDir })).stdout;

  const result = await runDogfood(repoDir, "dogfood:exercise", env, true);
  assert.equal(result.code, 1, "exercise should surface baseline drift before repair");

  const report = JSON.parse(await fs.readFile(path.join(repoDir, "temp", "dogfood", "reports", "latest.json"), "utf8"));
  assert.equal(report.mode, "exercise");
  assert.ok(Array.isArray(report.baselineDrift));
  assert.ok(report.mcpSummary);

  const afterStatus = (await runCommand("git", ["status", "--short"], { cwd: repoDir })).stdout;
  assert.equal(afterStatus, beforeStatus);
});

test("dogfood:repair fixes managed drift and applies the patch back to the root clone", { concurrency: false }, async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const repoDir = await materializeTempRepo();
  const env = {
    AGENT_MEMORY_CODEX_BIN: providers.codexPath,
    AGENT_MEMORY_CLAUDE_BIN: providers.claudePath,
    AGENT_MEMORY_DOGFOOD_SKIP_BUILD: "1",
    ...dogfoodTestEnv(repoDir),
  };

  await runDogfood(repoDir, "dogfood:init", env);
  await fs.writeFile(path.join(repoDir, ".mcp.json"), JSON.stringify({ mcpServers: { "agent-memory": { command: "echo", args: [] } } }), "utf8");

  const result = await runDogfood(repoDir, "dogfood:repair", env);
  assert.equal(result.code, 0, result.stderr);

  const repairedMcp = JSON.parse(await fs.readFile(path.join(repoDir, ".mcp.json"), "utf8"));
  assert.equal(repairedMcp.mcpServers["agent-memory"].command, "npx");

  const report = JSON.parse(await fs.readFile(path.join(repoDir, "temp", "dogfood", "reports", "latest.json"), "utf8"));
  assert.equal(report.appliedToRoot, true);
  assert.ok(["repaired", "pass"].includes(report.status));
});

test("dogfood:repair can enter whole-repo agentic repair and fix source-level breakage", { concurrency: false }, async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const repoDir = await materializeTempRepo();
  const env = {
    AGENT_MEMORY_CODEX_BIN: providers.codexPath,
    AGENT_MEMORY_CLAUDE_BIN: providers.claudePath,
    DOGFOOD_FAKE_REPAIR_MODE: "fix-test-script",
    AGENT_MEMORY_DOGFOOD_SKIP_BUILD: "1",
    ...dogfoodTestEnv(repoDir),
  };

  await runDogfood(repoDir, "dogfood:init", env);
  const packagePath = path.join(repoDir, "package.json");
  const pkg = JSON.parse(await fs.readFile(packagePath, "utf8"));
  pkg.scripts.test = "node -e \"process.exit(1)\"";
  await fs.writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

  const result = await runDogfood(repoDir, "dogfood:repair", env);
  assert.equal(result.code, 0, result.stderr);

  const repairedPkg = JSON.parse(await fs.readFile(packagePath, "utf8"));
  assert.match(repairedPkg.scripts.test, /test-ok/);

  const report = JSON.parse(await fs.readFile(path.join(repoDir, "temp", "dogfood", "reports", "latest.json"), "utf8"));
  assert.equal(report.appliedToRoot, true);
  assert.equal(report.status, "repaired");
  assert.ok(report.repairPassCount >= 1);
});
