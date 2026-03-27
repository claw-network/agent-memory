import { spawn } from "node:child_process";
import { argv, execPath, pid as currentPid } from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { validateCheckpointShape, validateHistoryEventShape, validateHistorySourceShape } from "./bundle-schema";
import { readConfig } from "./config-store";
import { listRegisteredSources, syncSources } from "./import-framework";
import { readHistoryEvents, readLatestCheckpoint, readSources } from "./history-store";
import { applyRecall, prepareRecall } from "./recall-orchestrator";
import { readState, writeState } from "./state-store";
import {
  acquireAutomationLock,
  cleanupAutomationRuntime,
  isProcessAlive,
  readAutomationDaemonStateIfPresent,
  readAutomationLatestRunIfPresent,
  touchAutomationHeartbeat,
  writeAutomationLatestRun,
} from "./automation-runtime";
import type {
  AutomationDaemonState,
  AutomationRunResult,
  ProviderPreference,
} from "../types";

const DAEMON_START_TIMEOUT_MS = 2000;

function currentCliEntry(): string {
  return argv[1] ?? "dist/cli.js";
}

function stableProvider(provider: ProviderPreference): ProviderPreference {
  return provider === "auto" ? "auto" : provider;
}

function createRunResult(provider: ProviderPreference): AutomationRunResult {
  const startedAt = new Date().toISOString();
  return {
    startedAt,
    finishedAt: startedAt,
    status: "idle",
    provider,
    importSync: {
      attempted: false,
      results: [],
    },
    recall: {
      attempted: false,
      applied: false,
      rawEventCount: 0,
      groupedItemCount: 0,
      noopReason: null,
    },
    errors: [],
    warnings: [],
  };
}

async function assertAutomationPreconditions(rootDir: string): Promise<void> {
  const state = await readState(rootDir);
  const config = await readConfig(rootDir);
  const sources = await readSources(rootDir);
  const events = await readHistoryEvents(rootDir);

  for (const event of events) {
    const errors = validateHistoryEventShape(event);
    if (errors.length > 0) {
      throw new Error(`Invalid history event ${event.id}: ${errors.join(" ")}`);
    }
  }

  for (const source of sources) {
    const errors = validateHistorySourceShape(source);
    if (errors.length > 0) {
      throw new Error(`Invalid history source ${source.id}: ${errors.join(" ")}`);
    }
  }

  if (state.maintenance.latestCheckpointId) {
    const checkpoint = await readLatestCheckpoint(rootDir, state.maintenance.latestCheckpointId);
    if (!checkpoint) {
      throw new Error("Latest checkpoint is missing.");
    }
    const checkpointErrors = validateCheckpointShape(checkpoint);
    if (checkpointErrors.length > 0) {
      throw new Error(`Latest checkpoint is invalid: ${checkpointErrors.join(" ")}`);
    }
  }

  void config;
}

async function refreshStateMaintenanceAfterImport(rootDir: string): Promise<void> {
  const state = await readState(rootDir);
  const events = await readHistoryEvents(rootDir);
  const sources = await listRegisteredSources(rootDir);

  await writeState(rootDir, {
    ...state,
    maintenance: {
      ...state.maintenance,
      historyEventCount: events.length,
      importSourceCount: sources.length,
    },
  });
}

function summarizeImportWarnings(results: AutomationRunResult["importSync"]["results"]): string[] {
  const warnings: string[] = [];
  for (const result of results) {
    if (result.failedCount > 0) {
      warnings.push(`${result.sourceId} sync reported ${result.failedCount} failure(s).`);
    }
  }
  return warnings;
}

function countImported(results: AutomationRunResult["importSync"]["results"]): number {
  return results.reduce((total, result) => total + result.importedCount, 0);
}

export async function runAutomationCycle(rootDir: string): Promise<AutomationRunResult> {
  let configProvider: ProviderPreference = "auto";
  try {
    configProvider = stableProvider((await readConfig(rootDir)).automation.provider);
  } catch {
    configProvider = "auto";
  }

  const result = createRunResult(configProvider);

  try {
    await assertAutomationPreconditions(rootDir);
    const config = await readConfig(rootDir);
    result.provider = stableProvider(config.automation.provider);

    const sources = await listRegisteredSources(rootDir);
    if (config.automation.importSyncBeforeRecall && sources.length > 0) {
      result.importSync.attempted = true;
      result.importSync.results = await syncSources({
        cwd: rootDir,
        provider: config.automation.provider,
        target: null,
        all: true,
      });
      result.warnings.push(...summarizeImportWarnings(result.importSync.results));
      await refreshStateMaintenanceAfterImport(rootDir);
    }

    if (config.automation.autoRecall) {
      const prepared = await prepareRecall({
        cwd: rootDir,
        yes: true,
        provider: config.automation.provider,
        source: "all",
        section: "all",
        policy: null,
        showDiff: false,
        checkpointId: null,
      });

      result.recall.rawEventCount = prepared.unrecalledSummary.rawEventCount;
      result.recall.groupedItemCount = prepared.unrecalledSummary.groupedItemCount;

      if (prepared.unrecalledCount > 0) {
        result.recall.attempted = true;
        if (prepared.candidate.noopReason) {
          result.recall.noopReason = prepared.candidate.noopReason;
          result.status = "recalled_noop";
        } else {
          await applyRecall(rootDir, prepared.candidate);
          result.recall.applied = true;
          result.status = "recalled";
        }
      }
    }

    if (result.status === "idle" && result.importSync.attempted) {
      const importedCount = countImported(result.importSync.results);
      const hasImportFailures = result.importSync.results.some((entry) => entry.failedCount > 0);
      if (importedCount > 0) {
        result.status = "imported";
      } else if (hasImportFailures) {
        result.status = "failed";
      }
    }
  } catch (error) {
    result.status = "failed";
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  result.finishedAt = new Date().toISOString();
  await writeAutomationLatestRun(rootDir, result);
  return result;
}

async function waitForDaemonState(rootDir: string, pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const daemonState = await readAutomationDaemonStateIfPresent(rootDir).catch(() => null);
    if (daemonState?.pid === pid && (await isProcessAlive(pid))) {
      return true;
    }
    await sleep(50);
  }

  return false;
}

export async function startAutomationDaemon(rootDir: string): Promise<{ pid: number }> {
  const existing = await readAutomationDaemonStateIfPresent(rootDir).catch(() => null);
  if (existing && (await isProcessAlive(existing.pid))) {
    throw new Error(`Automation daemon is already running with pid=${existing.pid}.`);
  }

  const child = spawn(execPath, [currentCliEntry(), "automate", "__daemon"], {
    cwd: rootDir,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  const started = await waitForDaemonState(rootDir, child.pid ?? 0, DAEMON_START_TIMEOUT_MS);
  if (!started) {
    throw new Error("Automation daemon failed to start.");
  }

  return { pid: child.pid ?? 0 };
}

export async function ensureAutomationDaemonRunning(rootDir: string): Promise<{ started: boolean; pid: number }> {
  const status = await getAutomationStatus(rootDir);
  if (status.running && status.daemon) {
    return {
      started: false,
      pid: status.daemon.pid,
    };
  }

  const started = await startAutomationDaemon(rootDir);
  return {
    started: true,
    pid: started.pid,
  };
}

export async function stopAutomationDaemon(rootDir: string): Promise<{ stopped: boolean; pid: number | null }> {
  const daemonState = await readAutomationDaemonStateIfPresent(rootDir).catch(() => null);
  if (!daemonState) {
    await cleanupAutomationRuntime(rootDir).catch(() => undefined);
    return { stopped: false, pid: null };
  }

  if (!(await isProcessAlive(daemonState.pid))) {
    await cleanupAutomationRuntime(rootDir).catch(() => undefined);
    return { stopped: false, pid: daemonState.pid };
  }

  process.kill(daemonState.pid, "SIGTERM");
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!(await isProcessAlive(daemonState.pid))) {
      break;
    }
    await sleep(50);
  }

  if (await isProcessAlive(daemonState.pid)) {
    process.kill(daemonState.pid, "SIGKILL");
  }

  await cleanupAutomationRuntime(rootDir).catch(() => undefined);
  return { stopped: true, pid: daemonState.pid };
}

export async function getAutomationStatus(rootDir: string): Promise<{
  running: boolean;
  daemon: AutomationDaemonState | null;
  latestRun: AutomationRunResult | null;
}> {
  const daemon = await readAutomationDaemonStateIfPresent(rootDir).catch(() => null);
  const latestRun = await readAutomationLatestRunIfPresent(rootDir).catch(() => null);

  if (!daemon) {
    return {
      running: false,
      daemon: null,
      latestRun,
    };
  }

  const running = await isProcessAlive(daemon.pid);
  return {
    running,
    daemon,
    latestRun,
  };
}

export async function runAutomationDaemonLoop(rootDir: string): Promise<void> {
  const config = await readConfig(rootDir);
  const intervalMinutes = config.automation.intervalMinutes;
  const provider = config.automation.provider;
  const startedAt = new Date().toISOString();
  let stopping = false;
  const sleepAbortController = new AbortController();

  await acquireAutomationLock(rootDir, currentPid);
  await touchAutomationHeartbeat(rootDir, {
    pid: currentPid,
    startedAt,
    intervalMinutes,
    provider,
  });

  const stopHandler = (): void => {
    stopping = true;
    sleepAbortController.abort();
  };

  process.once("SIGINT", () => {
    stopHandler();
  });
  process.once("SIGTERM", () => {
    stopHandler();
  });

  try {
    while (!stopping) {
      await touchAutomationHeartbeat(rootDir, {
        pid: currentPid,
        startedAt,
        intervalMinutes,
        provider,
      });

      const result = await runAutomationCycle(rootDir);
      await writeAutomationLatestRun(rootDir, result);

      if (stopping) {
        break;
      }

      try {
        await sleep(intervalMinutes * 60 * 1000, undefined, { signal: sleepAbortController.signal });
      } catch {
        if (!stopping) {
          throw new Error("Automation daemon sleep was interrupted unexpectedly.");
        }
      }
    }
  } finally {
    await cleanupAutomationRuntime(rootDir).catch(() => undefined);
  }
}
