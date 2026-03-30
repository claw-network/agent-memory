import { mkdir, mkdtemp, readFile, rm, symlink, writeFile, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DOGFOOD_COMMITTER_NAME = "agent-memory dogfood";
const DOGFOOD_COMMITTER_EMAIL = "dogfood@agent-memory.invalid";
const MANAGED_ROOTS = [
  ".agent-memory/",
  "docs/agent-memory/",
  ".claude/",
];
const MANAGED_FILES = new Set([".mcp.json", "AGENTS.md"]);

export function dogfoodProviderPreference(env = process.env) {
  const value = env.AGENT_MEMORY_DOGFOOD_PROVIDER || "auto";
  if (!["auto", "codex", "claude"].includes(value)) {
    throw new Error(`Unsupported AGENT_MEMORY_DOGFOOD_PROVIDER value: ${value}`);
  }

  return value;
}

async function loadStructuredProviderResolver(rootDir) {
  const moduleUrl = pathToFileURL(join(rootDir, "node_modules", "@agent-connect", "memory", "dist", "core", "provider-adapters.js")).href;
  return await import(moduleUrl);
}

async function readPackageVersion(rootDir) {
  const pkg = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
  return pkg.version;
}

function dogfoodPackageSpec(rootDir, env = process.env) {
  if (env.AGENT_MEMORY_DOGFOOD_PACKAGE_SPEC) {
    return env.AGENT_MEMORY_DOGFOOD_PACKAGE_SPEC;
  }

  return null;
}

async function installedPackageSpec(rootDir) {
  const installedPackagePath = join(rootDir, "node_modules", "@agent-connect", "memory", "package.json");
  if (!existsSync(installedPackagePath)) {
    return null;
  }

  const pkg = JSON.parse(await readFile(installedPackagePath, "utf8"));
  return pkg.version ? `@agent-connect/memory@${pkg.version}` : "@agent-connect/memory";
}

export async function ensureDogfoodAgentMemoryInstalled(rootDir, env = process.env) {
  const desiredSpec = dogfoodPackageSpec(rootDir, env) ?? `@agent-connect/memory@${await readPackageVersion(rootDir)}`;
  const installedSpec = await installedPackageSpec(rootDir);
  if (installedSpec === desiredSpec) {
    return desiredSpec;
  }

  await runCommand(
    "npm",
    ["install", "-D", "--no-fund", "--no-audit", desiredSpec],
    {
      cwd: rootDir,
      env,
    },
  );

  return desiredSpec;
}

export async function resolveDogfoodStructuredProvider(rootDir, preference, cwd, env) {
  if (!existsSync(join(rootDir, "node_modules", "@agent-connect", "memory", "dist", "core", "provider-adapters.js"))) {
    throw new Error("Dogfood structured provider resolution requires an installed @agent-connect/memory package.");
  }

  const { resolveProviderForStructuredUse } = await loadStructuredProviderResolver(rootDir);
  return await resolveProviderForStructuredUse(preference, cwd, env);
}

function trimmedLines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function shellWord(value) {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function isCommandAllowedFailure(result, options) {
  return options.allowFailure === true;
}

export function dogfoodPaths(rootDir) {
  const tempRoot = join(rootDir, "temp", "dogfood");
  const worktreeDir = join(tempRoot, "worktree");
  const homeDir = join(tempRoot, "home");
  const reportsDir = join(tempRoot, "reports");
  return {
    rootDir,
    tempRoot,
    worktreeDir,
    homeDir,
    reportsDir,
    latestJsonPath: join(reportsDir, "latest.json"),
    latestPatchPath: join(reportsDir, "latest.patch"),
    latestLogPath: join(reportsDir, "latest.log"),
  };
}

export function isManagedDogfoodPath(path, entryFile = null) {
  if (!path) {
    return false;
  }

  if (entryFile && path === entryFile) {
    return true;
  }

  if (MANAGED_FILES.has(path)) {
    return true;
  }

  return MANAGED_ROOTS.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix));
}

export function classifyChangedPaths(paths, entryFile = null) {
  const normalized = Array.from(new Set(paths.filter(Boolean))).sort((left, right) => left.localeCompare(right));
  return {
    managedPaths: normalized.filter((path) => isManagedDogfoodPath(path, entryFile)),
    repoPaths: normalized.filter((path) => !isManagedDogfoodPath(path, entryFile)),
  };
}

export async function readJsonIfPresent(path) {
  if (!existsSync(path)) {
    return null;
  }

  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeText(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

export async function ensureDogfoodLayout(paths) {
  await mkdir(paths.homeDir, { recursive: true });
  await mkdir(paths.reportsDir, { recursive: true });
}

export async function runCommand(command, args, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = {
    ...process.env,
    ...(options.env ?? {}),
  };
  const stdin = options.stdin ?? null;

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      const result = {
        command,
        args,
        commandLine: [command, ...args].map(shellWord).join(" "),
        cwd,
        code: code ?? 1,
        stdout,
        stderr,
      };

      if (code !== 0 && !isCommandAllowedFailure(result, options)) {
        const error = new Error(
          `${result.commandLine} failed with exit code ${result.code}.\n${stderr || stdout || ""}`.trim(),
        );
        error.result = result;
        reject(error);
        return;
      }

      resolve(result);
    });

    child.stdin.end(stdin ?? undefined);
  });
}

export async function runNodeScript(cwd, scriptPath, args = [], options = {}) {
  return await runCommand(process.execPath, [scriptPath, ...args], { cwd, ...options });
}

export async function runNpmScript(cwd, scriptName, options = {}) {
  return await runCommand("npm", ["run", scriptName], { cwd, ...options });
}

export async function runAgentMemoryCli(cwd, args, options = {}) {
  return await runCommand("npm", ["exec", "--", "agent-memory", ...args], {
    cwd,
    ...options,
  });
}

export function dogfoodEnv(paths, extra = {}) {
  return {
    ...process.env,
    ...extra,
  };
}

async function removeExistingWorktree(rootDir, worktreeDir) {
  if (existsSync(worktreeDir)) {
    await runCommand("git", ["-C", rootDir, "worktree", "remove", "--force", worktreeDir], {
      cwd: rootDir,
      allowFailure: true,
    });
    await rm(worktreeDir, { recursive: true, force: true });
  }
}

async function ensureNodeModulesLink(rootDir, worktreeDir) {
  const source = join(rootDir, "node_modules");
  const target = join(worktreeDir, "node_modules");
  if (!existsSync(source)) {
    throw new Error(`node_modules is missing at ${source}. Install dependencies before running dogfood scripts.`);
  }

  if (existsSync(target)) {
    return;
  }

  await symlink(source, target, "dir");
}

async function copyUntrackedFile(rootDir, worktreeDir, relativePath) {
  const source = join(rootDir, relativePath);
  const target = join(worktreeDir, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: true });
}

async function overlayRootSnapshot(rootDir, worktreeDir) {
  const trackedDiff = await runCommand(
    "git",
    ["-C", rootDir, "diff", "--binary", "HEAD", "--", ".", ":(exclude)temp", ":(exclude)dist"],
    { cwd: rootDir, allowFailure: true },
  );

  if (trackedDiff.stdout.trim().length > 0) {
    await runCommand("git", ["-C", worktreeDir, "apply", "--allow-empty"], {
      cwd: worktreeDir,
      stdin: trackedDiff.stdout,
    });
  }

  const untracked = await runCommand(
    "git",
    ["-C", rootDir, "ls-files", "--others", "--exclude-standard"],
    { cwd: rootDir },
  );
  for (const relativePath of trimmedLines(untracked.stdout)) {
    await copyUntrackedFile(rootDir, worktreeDir, relativePath);
  }
}

async function createBaselineSnapshotCommit(worktreeDir) {
  await runCommand("git", ["-C", worktreeDir, "add", "-A"], { cwd: worktreeDir });
  const status = await runCommand("git", ["-C", worktreeDir, "status", "--porcelain"], { cwd: worktreeDir });
  if (status.stdout.trim().length === 0) {
    const rev = await runCommand("git", ["-C", worktreeDir, "rev-parse", "HEAD"], { cwd: worktreeDir });
    return rev.stdout.trim();
  }

  await runCommand(
    "git",
    [
      "-C",
      worktreeDir,
      "-c",
      `user.name=${DOGFOOD_COMMITTER_NAME}`,
      "-c",
      `user.email=${DOGFOOD_COMMITTER_EMAIL}`,
      "commit",
      "--no-verify",
      "-m",
      "dogfood baseline snapshot",
    ],
    { cwd: worktreeDir },
  );

  const rev = await runCommand("git", ["-C", worktreeDir, "rev-parse", "HEAD"], { cwd: worktreeDir });
  return rev.stdout.trim();
}

export async function createDogfoodWorktree(rootDir, paths) {
  await ensureDogfoodLayout(paths);
  await removeExistingWorktree(rootDir, paths.worktreeDir);
  await runCommand("git", ["-C", rootDir, "worktree", "add", "--detach", "--force", paths.worktreeDir, "HEAD"], {
    cwd: rootDir,
  });
  await ensureNodeModulesLink(rootDir, paths.worktreeDir);
  await overlayRootSnapshot(rootDir, paths.worktreeDir);
  const baselineCommit = await createBaselineSnapshotCommit(paths.worktreeDir);
  return {
    worktreeDir: paths.worktreeDir,
    baselineCommit,
  };
}

export async function cleanupDogfoodWorktree(rootDir, paths) {
  await removeExistingWorktree(rootDir, paths.worktreeDir);
}

export async function collectChangedPaths(worktreeDir) {
  const status = await runCommand("git", ["-C", worktreeDir, "status", "--porcelain", "--untracked-files=all"], {
    cwd: worktreeDir,
  });

  return status.stdout
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      const renamed = line.slice(3);
      const arrowIndex = renamed.indexOf(" -> ");
      if (arrowIndex >= 0) {
        return renamed.slice(arrowIndex + 4);
      }
      return renamed;
    });
}

export async function generateBinaryPatch(worktreeDir, baselineCommit) {
  const patch = await runCommand(
    "git",
    ["-C", worktreeDir, "diff", "--binary", "--relative", baselineCommit],
    { cwd: worktreeDir, allowFailure: true },
  );
  return patch.stdout;
}

export async function applyPatchToRoot(rootDir, patchPath) {
  const check = await runCommand("git", ["-C", rootDir, "apply", "--check", patchPath], {
    cwd: rootDir,
    allowFailure: true,
  });
  if (check.code !== 0) {
    return false;
  }

  await runCommand("git", ["-C", rootDir, "apply", patchPath], { cwd: rootDir });
  return true;
}

export async function gitStatus(rootDir) {
  const result = await runCommand("git", ["-C", rootDir, "status", "--short"], { cwd: rootDir });
  return result.stdout.trim();
}

export function parseValidateSummary(output) {
  const summaryLine = trimmedLines(output).find((line) => line.startsWith("Summary:"));
  if (!summaryLine) {
    return {
      pass: 0,
      warn: 0,
      fail: 0,
    };
  }

  const match = summaryLine.match(/Summary:\s+(\d+)\s+passed,\s+(\d+)\s+warnings,\s+(\d+)\s+failed\./i);
  return match
    ? {
        pass: Number(match[1]),
        warn: Number(match[2]),
        fail: Number(match[3]),
      }
    : { pass: 0, warn: 0, fail: 0 };
}

export function parseTestSummary(result) {
  const passMatch = result.stdout.match(/pass\s+(\d+)/i);
  const failMatch = result.stdout.match(/fail\s+(\d+)/i);
  return {
    code: result.code,
    passCount: passMatch ? Number(passMatch[1]) : 0,
    failCount: failMatch ? Number(failMatch[1]) : 0,
  };
}

export async function startMcpSession(worktreeDir, env) {
  const child = spawn("npm", ["exec", "--", "agent-memory", "mcp"], {
    cwd: worktreeDir,
    env: {
      ...process.env,
      ...env,
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
    request,
    notify,
    async close() {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.on("close", resolve));
    },
  };
}

export async function runMcpSmoke(worktreeDir, env) {
  const session = await startMcpSession(worktreeDir, env);
  try {
    const initialize = await session.request("initialize", {});
    await session.notify("notifications/initialized", {});
    const tools = await session.request("tools/list", {});
    const toolNames = Array.isArray(tools.result?.tools) ? tools.result.tools.map((tool) => tool.name) : [];
    const assess = await session.request("tools/call", { name: "memory_assess", arguments: {} });
    const handoff = await session.request("tools/call", { name: "memory_compact_handoff", arguments: {} });
    const maintain = await session.request("tools/call", { name: "memory_maintain", arguments: {} });
    return {
      success: true,
      serverName: initialize.result?.serverInfo?.name ?? null,
      tools: toolNames,
      memoryAssess: assess.result?.structuredContent ?? null,
      memoryCompactHandoff: handoff.result?.structuredContent ?? null,
      memoryMaintain: maintain.result?.structuredContent ?? null,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      serverName: null,
      tools: [],
      memoryAssess: null,
      memoryCompactHandoff: null,
      memoryMaintain: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await session.close();
  }
}

export function buildDogfoodReport(input) {
  return {
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    mode: input.mode,
    status: input.status,
    baselineDrift: input.baselineDrift,
    managedBreakage: input.managedBreakage,
    repoBreakage: input.repoBreakage,
    appliedToRoot: input.appliedToRoot,
    provider: input.provider,
    repairPassCount: input.repairPassCount,
    artifactDiffSummary: input.artifactDiffSummary,
    testSummary: input.testSummary,
    validateSummary: input.validateSummary,
    integrationSummary: input.integrationSummary,
    mcpSummary: input.mcpSummary,
  };
}

export function classifyExerciseOutcome(input) {
  const baselineDrift = input.managedPaths;
  const managedBreakage = [];
  const repoBreakage = [];

  for (const commandResult of input.commandResults) {
    if (commandResult.code === 0) {
      continue;
    }

    if (["build", "test"].includes(commandResult.name)) {
      repoBreakage.push(`${commandResult.name} failed`);
      continue;
    }

    managedBreakage.push(`${commandResult.name} failed`);
  }

  if (input.validateSummary.fail > 0) {
    managedBreakage.push("validate reported failing findings");
  }

  if (input.integrationSummary && input.integrationSummary.healthy === false) {
    managedBreakage.push("integrate --status reported unhealthy integration");
  }

  if (input.mcpSummary && input.mcpSummary.success === false) {
    managedBreakage.push("MCP smoke failed");
  }

  if (input.repoPaths.length > 0 && input.mode !== "repair") {
    repoBreakage.push(`non-managed paths changed: ${input.repoPaths.join(", ")}`);
  }

  return {
    baselineDrift,
    managedBreakage,
    repoBreakage,
  };
}

async function runExerciseAgainstWorktree(worktreeDir, baselineCommit, rootDir, paths, options = {}) {
  const startedAt = new Date().toISOString();
  const env = dogfoodEnv(paths, options.env ?? {});
  const resolvedProvider = await resolveDogfoodStructuredProvider(rootDir, options.provider ?? "auto", worktreeDir, env);
  const provider = resolvedProvider.name;
  const commandResults = [];
  let entryFile = null;
  let integrationSummary = null;
  let validateSummary = { pass: 0, warn: 0, fail: 0 };
  let testSummary = { code: 1, passCount: 0, failCount: 0 };
  let mcpSummary = {
    success: false,
    tools: [],
    memoryAssess: null,
    memoryCompactHandoff: null,
    memoryMaintain: null,
    error: "MCP smoke did not run.",
  };

  if (env.AGENT_MEMORY_DOGFOOD_SKIP_BUILD === "1" && existsSync(join(worktreeDir, "dist", "cli.js"))) {
    commandResults.push({
      name: "build",
      command: "npm",
      args: ["run", "build"],
      commandLine: "npm run build",
      cwd: worktreeDir,
      code: 0,
      stdout: "dogfood build skipped; reusing existing dist/cli.js\n",
      stderr: "",
    });
  } else {
    commandResults.push({ name: "build", ...(await runNpmScript(worktreeDir, "build", { env })) });
  }

  const updateResult = await runAgentMemoryCli(worktreeDir, ["update", "--yes", "--validate", `--provider=${provider}`], { env, allowFailure: true });
    commandResults.push({ name: "update", ...updateResult });

    const statusResult = await runAgentMemoryCli(worktreeDir, ["status"], { env, allowFailure: true });
    commandResults.push({ name: "status", ...statusResult });

    for (const [name, question] of [
      ["query_changes", "what changed recently?"],
      ["query_next", "what should I do next?"],
      ["query_traps", "what are the known traps?"],
    ]) {
      commandResults.push({
        name,
        ...(await runAgentMemoryCli(worktreeDir, ["query", question, `--provider=${provider}`], { env, allowFailure: true })),
      });
    }

    const automateResult = await runAgentMemoryCli(worktreeDir, ["automate", "run-once"], { env, allowFailure: true });
    commandResults.push({ name: "automate_run_once", ...automateResult });

    const integrateResult = await runAgentMemoryCli(worktreeDir, ["integrate"], { env, allowFailure: true });
    commandResults.push({ name: "integrate", ...integrateResult });

    const integrateStatus = await runAgentMemoryCli(
      worktreeDir,
      ["integrate", "--status", "--output=json"],
      { env, allowFailure: true },
    );
    commandResults.push({ name: "integrate_status", ...integrateStatus });
    if (integrateStatus.code === 0) {
      try {
        integrationSummary = JSON.parse(integrateStatus.stdout);
      } catch {
        integrationSummary = { healthy: false, parseError: true };
      }
    } else {
      integrationSummary = { healthy: false };
    }

    const validateResult = await runAgentMemoryCli(worktreeDir, ["validate"], { env, allowFailure: true });
    commandResults.push({ name: "validate", ...validateResult });
    validateSummary = parseValidateSummary(validateResult.stdout);

    mcpSummary = await runMcpSmoke(worktreeDir, env);

    const testResult = await runNpmScript(worktreeDir, "test", { env, allowFailure: true });
    commandResults.push({ name: "test", ...testResult });
    testSummary = parseTestSummary(testResult);

    const state = await readJsonIfPresent(join(worktreeDir, ".agent-memory", "state.json"));
    entryFile = state?.bundle?.project?.recommendedEntryFile ?? null;

    const changedPaths = await collectChangedPaths(worktreeDir);
    const { managedPaths, repoPaths } = classifyChangedPaths(changedPaths, entryFile);
    const classification = classifyExerciseOutcome({
      commandResults,
      managedPaths,
      repoPaths,
      validateSummary,
      integrationSummary,
      mcpSummary,
      mode: options.mode ?? "exercise",
    });

    const patch = await generateBinaryPatch(worktreeDir, baselineCommit);
    const finishedAt = new Date().toISOString();
    const report = buildDogfoodReport({
      startedAt,
      finishedAt,
      mode: options.mode ?? "exercise",
      status:
        classification.baselineDrift.length === 0 &&
        classification.managedBreakage.length === 0 &&
        classification.repoBreakage.length === 0
          ? "pass"
          : "fail",
      baselineDrift: classification.baselineDrift,
      managedBreakage: classification.managedBreakage,
      repoBreakage: classification.repoBreakage,
      appliedToRoot: false,
      provider,
      repairPassCount: options.repairPassCount ?? 0,
      artifactDiffSummary: {
        changedPaths,
        managedPaths,
        repoPaths,
      },
      testSummary,
      validateSummary,
      integrationSummary,
      mcpSummary,
    });

  return {
    report,
    patch,
    log: commandResults
      .map((result) => [
        `$ ${result.commandLine}`,
        result.stdout.trim(),
        result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : "",
      ].filter(Boolean).join("\n"))
      .join("\n\n"),
  };
}

export async function runExerciseCycle(rootDir, paths, options = {}) {
  const { baselineCommit } = await createDogfoodWorktree(rootDir, paths);

  try {
    const result = await runExerciseAgainstWorktree(paths.worktreeDir, baselineCommit, rootDir, paths, options);
    return {
      ...result,
      baselineCommit,
    };
  } finally {
    if (!options.keepWorktree) {
      await cleanupDogfoodWorktree(rootDir, paths);
    }
  }
}

export async function evaluateExistingDogfoodWorktree(rootDir, paths, baselineCommit, options = {}) {
  const result = await runExerciseAgainstWorktree(paths.worktreeDir, baselineCommit, rootDir, paths, options);
  return {
    ...result,
    baselineCommit,
  };
}

export async function writeDogfoodArtifacts(paths, report, patch, log) {
  await ensureDogfoodLayout(paths);
  await writeJson(paths.latestJsonPath, report);
  await writeText(paths.latestPatchPath, patch);
  await writeText(paths.latestLogPath, `${log.trim()}\n`);
}

export function repairPrompt(input) {
  return [
    "You are repairing the agent-memory repository in a temporary dogfood worktree.",
    "Fix the remaining failures using code edits in the worktree.",
    "You may modify any repository files, including src/, scripts/, docs/, integration assets, and memory artifacts.",
    "Do not rely on network calls or external services beyond the local repository and configured tools.",
    "Target state:",
    "- npm test passes",
    "- validate has no failing findings",
    "- integrate --status is healthy",
    "- MCP smoke succeeds",
    "",
    "DOGFOOD_REPORT_JSON:",
    JSON.stringify(input.report, null, 2),
    "",
    "CURRENT_DIFF_PATHS:",
    input.changedPaths.join("\n"),
  ].join("\n");
}

export async function runWholeRepoRepair(worktreeDir, paths, options) {
  const provider = options.provider ?? "auto";
  const codexBinary = options.env?.AGENT_MEMORY_CODEX_BIN || process.env.AGENT_MEMORY_CODEX_BIN || "codex";
  const claudeBinary = options.env?.AGENT_MEMORY_CLAUDE_BIN || process.env.AGENT_MEMORY_CLAUDE_BIN || "claude";
  const env = dogfoodEnv(paths, options.env ?? {});
  const prompt = repairPrompt(options);

  if (provider === "auto" || provider === "codex") {
    const result = await runCommand(
      codexBinary,
      [
        "exec",
        "-C",
        worktreeDir,
        "--skip-git-repo-check",
        "--full-auto",
        "--sandbox",
        "workspace-write",
        "--add-dir",
        worktreeDir,
        "-",
      ],
      {
        cwd: worktreeDir,
        env,
        stdin: prompt,
        allowFailure: true,
      },
    );

    if (result.code === 0 || provider === "codex") {
      return { provider: "codex", ...result };
    }
  }

  const claudeResult = await runCommand(
    claudeBinary,
    [
      "-p",
      "--no-session-persistence",
      "--permission-mode",
      "bypassPermissions",
      "--allowedTools",
      "Bash,Edit,Read",
      "--add-dir",
      worktreeDir,
      prompt,
    ],
    {
      cwd: worktreeDir,
      env,
      allowFailure: true,
    },
  );

  return { provider: "claude", ...claudeResult };
}

export async function initSelfHostBaseline(rootDir, paths, options = {}) {
  const env = dogfoodEnv(paths, options.env ?? {});
  await ensureDogfoodLayout(paths);
  await ensureDogfoodAgentMemoryInstalled(rootDir, env);
  const provider = (await resolveDogfoodStructuredProvider(rootDir, options.provider ?? "auto", rootDir, env)).name;
  await runAgentMemoryCli(rootDir, ["init", "--yes", "--validate", `--provider=${provider}`], { env });
  if (provider !== "auto") {
    const configPath = join(rootDir, ".agent-memory", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.automation = {
      ...(config.automation || {}),
      provider,
    };
    await writeJson(configPath, config);
  }
  await runAgentMemoryCli(rootDir, ["integrate"], { env });
  await runAgentMemoryCli(rootDir, ["status"], { env });
  await runAgentMemoryCli(rootDir, ["validate"], { env });
}

export async function loadLatestDogfoodReport(paths) {
  return await readJsonIfPresent(paths.latestJsonPath);
}

export function formatDogfoodStatus(report, paths) {
  if (!report) {
    return [
      "Dogfood status: none",
      `- report path: ${relative(paths.rootDir, paths.latestJsonPath)}`,
    ].join("\n");
  }

  return [
    `Dogfood status: ${report.status}`,
    `- mode: ${report.mode}`,
    `- startedAt: ${report.startedAt}`,
    `- finishedAt: ${report.finishedAt}`,
    `- provider: ${report.provider}`,
    `- repairPassCount: ${report.repairPassCount}`,
    `- baseline drift count: ${report.baselineDrift.length}`,
    `- managed breakage count: ${report.managedBreakage.length}`,
    `- repo breakage count: ${report.repoBreakage.length}`,
    `- appliedToRoot: ${report.appliedToRoot ? "yes" : "no"}`,
    `- report path: ${relative(paths.rootDir, paths.latestJsonPath)}`,
    `- patch path: ${relative(paths.rootDir, paths.latestPatchPath)}`,
  ].join("\n");
}
