import { access, mkdir, open, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stableStringify } from "./state-store";
import type {
  AutomationDaemonState,
  AutomationLockState,
  AutomationRunResult,
  ProviderPreference,
} from "../types";

function automationDir(rootDir: string): string {
  return join(rootDir, ".agent-memory", "automation");
}

export function getAutomationDir(rootDir: string): string {
  return automationDir(rootDir);
}

export function getAutomationDaemonStatePath(rootDir: string): string {
  return join(automationDir(rootDir), "daemon.json");
}

export function getAutomationLatestRunPath(rootDir: string): string {
  return join(automationDir(rootDir), "latest-run.json");
}

export function getAutomationLockPath(rootDir: string): string {
  return join(automationDir(rootDir), "daemon.lock");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }

  return value;
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${path} must be a number.`);
  }

  return value;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean.`);
  }

  return value;
}

function expectStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array of strings.`);
  }

  return value.map((item, index) => expectString(item, `${path}[${index}]`));
}

function parseProviderPreference(value: unknown, path: string): ProviderPreference {
  const provider = expectString(value, path);
  if (provider !== "auto" && provider !== "codex" && provider !== "claude") {
    throw new Error(`${path} must be one of: auto, codex, claude.`);
  }

  return provider;
}

function parseImportSyncResults(value: unknown, path: string): AutomationRunResult["importSync"]["results"] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array.`);
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`${path}[${index}] must be an object.`);
    }

    return {
      sourceId: expectString(entry.sourceId, `${path}[${index}].sourceId`),
      importedCount: expectNumber(entry.importedCount, `${path}[${index}].importedCount`),
      skippedCount: expectNumber(entry.skippedCount, `${path}[${index}].skippedCount`),
      failedCount: expectNumber(entry.failedCount, `${path}[${index}].failedCount`),
      failures: Array.isArray(entry.failures)
        ? entry.failures.map((failure, failureIndex) => {
            if (!isRecord(failure)) {
              throw new Error(`${path}[${index}].failures[${failureIndex}] must be an object.`);
            }

            return {
              sourceRef: expectString(failure.sourceRef, `${path}[${index}].failures[${failureIndex}].sourceRef`),
              message: expectString(failure.message, `${path}[${index}].failures[${failureIndex}].message`),
            };
          })
        : [],
    };
  });
}

function parsePruneSnapshot(value: unknown, path: string): AutomationRunResult["prune"] {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object.`);
  }

  return {
    attempted: expectBoolean(value.attempted, `${path}.attempted`),
    archivedEventCount: expectNumber(value.archivedEventCount, `${path}.archivedEventCount`),
    archivedCheckpointCount: expectNumber(value.archivedCheckpointCount, `${path}.archivedCheckpointCount`),
    expiredArchiveBatchCount: expectNumber(value.expiredArchiveBatchCount, `${path}.expiredArchiveBatchCount`),
    archiveBatchPath: value.archiveBatchPath === null ? null : expectString(value.archiveBatchPath, `${path}.archiveBatchPath`),
    skippedReason: value.skippedReason === null ? null : expectString(value.skippedReason, `${path}.skippedReason`),
  };
}

export function validateAutomationDaemonStateShape(value: unknown): AutomationDaemonState {
  if (!isRecord(value)) {
    throw new Error("automation daemon state must be an object.");
  }

  return {
    pid: expectNumber(value.pid, "automation.pid"),
    startedAt: expectString(value.startedAt, "automation.startedAt"),
    lastHeartbeatAt: expectString(value.lastHeartbeatAt, "automation.lastHeartbeatAt"),
    intervalMinutes: expectNumber(value.intervalMinutes, "automation.intervalMinutes"),
    provider: parseProviderPreference(value.provider, "automation.provider"),
  };
}

export function validateAutomationLockStateShape(value: unknown): AutomationLockState {
  if (!isRecord(value)) {
    throw new Error("automation lock state must be an object.");
  }

  return {
    pid: expectNumber(value.pid, "automationLock.pid"),
    createdAt: expectString(value.createdAt, "automationLock.createdAt"),
  };
}

export function validateAutomationRunResultShape(value: unknown): AutomationRunResult {
  if (!isRecord(value)) {
    throw new Error("automation run result must be an object.");
  }

  const status = expectString(value.status, "automationRun.status");
  if (!["idle", "imported", "recalled", "recalled_noop", "failed"].includes(status)) {
    throw new Error("automationRun.status must be one of: idle, imported, recalled, recalled_noop, failed.");
  }

  if (!isRecord(value.importSync)) {
    throw new Error("automationRun.importSync must be an object.");
  }

  if (!isRecord(value.recall)) {
    throw new Error("automationRun.recall must be an object.");
  }

  if (!isRecord(value.prune)) {
    throw new Error("automationRun.prune must be an object.");
  }

  return {
    startedAt: expectString(value.startedAt, "automationRun.startedAt"),
    finishedAt: expectString(value.finishedAt, "automationRun.finishedAt"),
    status: status as AutomationRunResult["status"],
    provider: parseProviderPreference(value.provider, "automationRun.provider"),
    importSync: {
      attempted: expectBoolean(value.importSync.attempted, "automationRun.importSync.attempted"),
      results: parseImportSyncResults(value.importSync.results, "automationRun.importSync.results"),
    },
    recall: {
      attempted: expectBoolean(value.recall.attempted, "automationRun.recall.attempted"),
      applied: expectBoolean(value.recall.applied, "automationRun.recall.applied"),
      rawEventCount: expectNumber(value.recall.rawEventCount, "automationRun.recall.rawEventCount"),
      groupedItemCount: expectNumber(value.recall.groupedItemCount, "automationRun.recall.groupedItemCount"),
      noopReason:
        value.recall.noopReason === null ? null : expectString(value.recall.noopReason, "automationRun.recall.noopReason"),
    },
    prune: parsePruneSnapshot(value.prune, "automationRun.prune"),
    errors: expectStringArray(value.errors, "automationRun.errors"),
    warnings: expectStringArray(value.warnings, "automationRun.warnings"),
  };
}

export async function ensureAutomationLayout(rootDir: string): Promise<void> {
  await mkdir(automationDir(rootDir), { recursive: true });
}

export async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function writeAutomationDaemonState(rootDir: string, state: AutomationDaemonState): Promise<void> {
  const path = getAutomationDaemonStatePath(rootDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${stableStringify(state)}\n`, "utf8");
}

export async function readAutomationDaemonState(rootDir: string): Promise<AutomationDaemonState> {
  const path = getAutomationDaemonStatePath(rootDir);
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  return validateAutomationDaemonStateShape(parsed);
}

export async function readAutomationDaemonStateIfPresent(rootDir: string): Promise<AutomationDaemonState | null> {
  const path = getAutomationDaemonStatePath(rootDir);
  if (!(await exists(path))) {
    return null;
  }

  return readAutomationDaemonState(rootDir);
}

export async function writeAutomationLatestRun(rootDir: string, result: AutomationRunResult): Promise<void> {
  const path = getAutomationLatestRunPath(rootDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${stableStringify(result)}\n`, "utf8");
}

export async function readAutomationLatestRun(rootDir: string): Promise<AutomationRunResult> {
  const path = getAutomationLatestRunPath(rootDir);
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  return validateAutomationRunResultShape(parsed);
}

export async function readAutomationLatestRunIfPresent(rootDir: string): Promise<AutomationRunResult | null> {
  const path = getAutomationLatestRunPath(rootDir);
  if (!(await exists(path))) {
    return null;
  }

  return readAutomationLatestRun(rootDir);
}

export async function writeAutomationLock(rootDir: string, lock: AutomationLockState): Promise<void> {
  const path = getAutomationLockPath(rootDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${stableStringify(lock)}\n`, "utf8");
}

export async function readAutomationLock(rootDir: string): Promise<AutomationLockState> {
  const path = getAutomationLockPath(rootDir);
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  return validateAutomationLockStateShape(parsed);
}

export async function readAutomationLockIfPresent(rootDir: string): Promise<AutomationLockState | null> {
  const path = getAutomationLockPath(rootDir);
  if (!(await exists(path))) {
    return null;
  }

  return readAutomationLock(rootDir);
}

export async function acquireAutomationLock(rootDir: string, pid: number): Promise<void> {
  await ensureAutomationLayout(rootDir);
  const path = getAutomationLockPath(rootDir);
  const now = new Date().toISOString();

  try {
    const handle = await open(path, "wx");
    try {
      await handle.writeFile(`${stableStringify({ pid, createdAt: now })}\n`, "utf8");
    } finally {
      await handle.close();
    }
    return;
  } catch {
    const existing = await readAutomationLockIfPresent(rootDir);
    if (existing && (await isProcessAlive(existing.pid))) {
      throw new Error(`Automation daemon is already running with pid=${existing.pid}.`);
    }

    await writeAutomationLock(rootDir, { pid, createdAt: now });
  }
}

export async function releaseAutomationLock(rootDir: string): Promise<void> {
  const path = getAutomationLockPath(rootDir);
  if (!(await exists(path))) {
    return;
  }

  await unlink(path);
}

export async function removeAutomationDaemonState(rootDir: string): Promise<void> {
  const path = getAutomationDaemonStatePath(rootDir);
  if (!(await exists(path))) {
    return;
  }

  await unlink(path);
}

export async function cleanupAutomationRuntime(rootDir: string): Promise<void> {
  await releaseAutomationLock(rootDir);
  await removeAutomationDaemonState(rootDir);
}

export async function touchAutomationHeartbeat(rootDir: string, input: {
  pid: number;
  startedAt: string;
  intervalMinutes: number;
  provider: ProviderPreference;
}): Promise<void> {
  await writeAutomationDaemonState(rootDir, {
    pid: input.pid,
    startedAt: input.startedAt,
    lastHeartbeatAt: new Date().toISOString(),
    intervalMinutes: input.intervalMinutes,
    provider: input.provider,
  });
}

export async function removeAutomationRuntimeDirIfEmpty(rootDir: string): Promise<void> {
  const dir = getAutomationDir(rootDir);
  if (!(await exists(dir))) {
    return;
  }

  await rm(dir, { recursive: true, force: true });
}
