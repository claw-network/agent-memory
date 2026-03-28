import {
  ensureAutomationDaemonRunning,
  getAutomationStatus,
  runAutomationCycle,
  runAutomationDaemonLoop,
  startAutomationDaemon,
  stopAutomationDaemon,
} from "../core/automation-orchestrator";
import type { AutomationCommandOptions } from "../types";

function summarizeLatestRun(latestRun: Awaited<ReturnType<typeof getAutomationStatus>>["latestRun"]): string[] {
  if (!latestRun) {
    return ["- last run: none"];
  }

  return [
    `- last run status: ${latestRun.status}`,
    `- last run finishedAt: ${latestRun.finishedAt}`,
    `- sync attempted: ${latestRun.importSync.attempted ? "yes" : "no"}`,
    `- recall attempted: ${latestRun.recall.attempted ? "yes" : "no"}`,
    `- recall applied: ${latestRun.recall.applied ? "yes" : "no"}`,
    `- recall grouped items: ${latestRun.recall.groupedItemCount}`,
    ...(latestRun.errors.length > 0 ? [`- last errors: ${latestRun.errors.join(" | ")}`] : []),
    ...(latestRun.warnings.length > 0 ? [`- last warnings: ${latestRun.warnings.join(" | ")}`] : []),
  ];
}

export async function runAutomateStart(options: AutomationCommandOptions): Promise<number> {
  const result = await startAutomationDaemon(options.cwd);
  console.log(`Automation daemon started (pid=${result.pid}).`);
  return 0;
}

export async function runAutomateStop(options: AutomationCommandOptions): Promise<number> {
  const result = await stopAutomationDaemon(options.cwd);
  if (!result.stopped) {
    console.log(result.pid ? `Automation daemon was not running (stale pid=${result.pid}).` : "Automation daemon is not running.");
    return 0;
  }

  console.log(`Automation daemon stopped (pid=${result.pid}).`);
  return 0;
}

export async function runAutomateStatus(options: AutomationCommandOptions): Promise<number> {
  const status = await getAutomationStatus(options.cwd);
  console.log(`Automation daemon: ${status.running ? "running" : "stopped"}`);
  if (status.daemon) {
    console.log(`- pid: ${status.daemon.pid}`);
    console.log(`- startedAt: ${status.daemon.startedAt}`);
    console.log(`- lastHeartbeatAt: ${status.daemon.lastHeartbeatAt}`);
    console.log(`- intervalMinutes: ${status.daemon.intervalMinutes}`);
    console.log(`- provider: ${status.daemon.provider}`);
  }
  for (const line of summarizeLatestRun(status.latestRun)) {
    console.log(line);
  }

  return 0;
}

export async function runAutomateRunOnce(options: AutomationCommandOptions): Promise<number> {
  const result = await runAutomationCycle(options.cwd);
  console.log(`Automation run status: ${result.status}`);
  console.log(`- provider: ${result.provider}`);
  console.log(`- sync attempted: ${result.importSync.attempted ? "yes" : "no"}`);
  console.log(`- recall attempted: ${result.recall.attempted ? "yes" : "no"}`);
  console.log(`- recall applied: ${result.recall.applied ? "yes" : "no"}`);
  console.log(`- raw events: ${result.recall.rawEventCount}`);
  console.log(`- grouped items: ${result.recall.groupedItemCount}`);
  if (result.recall.noopReason) {
    console.log(`- noopReason: ${result.recall.noopReason}`);
  }
  if (result.warnings.length > 0) {
    console.log(`- warnings: ${result.warnings.join(" | ")}`);
  }
  if (result.errors.length > 0) {
    console.log(`- errors: ${result.errors.join(" | ")}`);
  }

  return result.status === "failed" ? 1 : 0;
}

export async function runAutomateEnsureRunning(options: AutomationCommandOptions): Promise<number> {
  const result = await ensureAutomationDaemonRunning(options.cwd);
  console.log(`Automation daemon ${result.started ? "started" : "already running"} (pid=${result.pid}).`);
  return 0;
}

export async function runAutomateDaemon(options: AutomationCommandOptions): Promise<number> {
  await runAutomationDaemonLoop(options.cwd);
  return 0;
}
