import {
  ensureAutomationDaemonRunning,
  getAutomationStatus,
  runAutomationCycle,
} from "./automation-orchestrator";
import { setTimeout as sleep } from "node:timers/promises";
import { buildIntegrationStatusReport } from "./integration";
import { buildStatusReport } from "./status-orchestrator";
import { readState } from "./state-store";
import { validateMemory } from "./validate-memory";
import type {
  AuditFinding,
  IntegrationHealthStatus,
  MemoryAssessWorkflowResult,
  MemoryCompactHandoffWorkflowResult,
  MemoryHealthStatus,
  MemoryMaintainWorkflowResult,
  WorkflowStatus,
} from "../types";

function summarizeFindings(findings: AuditFinding[]): {
  failCount: number;
  warnCount: number;
  topFindings: string[];
} {
  const failing = findings.filter((finding) => finding.status === "fail");
  const warning = findings.filter((finding) => finding.status === "warn");
  const topFindings = [...failing, ...warning]
    .slice(0, 3)
    .map((finding) => `${finding.code}: ${finding.message}`);

  return {
    failCount: failing.length,
    warnCount: warning.length,
    topFindings,
  };
}

function integrationHealth(ok: boolean): IntegrationHealthStatus {
  return ok ? "healthy" : "attention";
}

function componentHealthy(statuses: Array<{ status: string }>): boolean {
  return statuses.every((status) => status.status === "present");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function workflowStatus(input: {
  failCount: number;
  warnCount: number;
  backlog: number;
  automationRunning: boolean;
  integrationHealthy: boolean;
}): WorkflowStatus {
  if (input.failCount > 0) {
    return "fail";
  }

  if (
    input.warnCount > 0 ||
    input.backlog > 0 ||
    !input.automationRunning ||
    !input.integrationHealthy
  ) {
    return "warn";
  }

  return "ok";
}

function memoryHealth(status: WorkflowStatus): MemoryHealthStatus {
  if (status === "fail") {
    return "unhealthy";
  }

  if (status === "warn") {
    return "attention";
  }

  return "healthy";
}

function summarizeAutomationState(input: {
  running: boolean;
  lastRunStatus: string | null;
  lastRunFinishedAt: string | null;
}): string {
  if (!input.running) {
    return input.lastRunStatus
      ? `Automation daemon is stopped; last run status was ${input.lastRunStatus} at ${input.lastRunFinishedAt ?? "unknown time"}.`
      : "Automation daemon is stopped and no maintenance run has been recorded yet.";
  }

  if (!input.lastRunStatus) {
    return "Automation daemon is running and no maintenance run has been recorded yet.";
  }

  return `Automation daemon is running; last run status was ${input.lastRunStatus} at ${input.lastRunFinishedAt ?? "unknown time"}.`;
}

function maintainChangedFiles(result: Awaited<ReturnType<typeof runAutomationCycle>>): string[] {
  const changed = [".agent-memory/automation/latest-run.json"];
  const importedCount = result.importSync.results.reduce((total, item) => total + item.importedCount, 0);

  if (result.importSync.attempted) {
    changed.push(".agent-memory/sources.json", ".agent-memory/state.json");
  }

  if (importedCount > 0) {
    changed.push(".agent-memory/history/events.jsonl", ".agent-memory/state.json");
  }

  if (result.recall.applied) {
    changed.push(
      ".agent-memory/state.json",
      ".agent-memory/history/checkpoints/",
      "docs/agent-memory/README.md",
      "docs/agent-memory/project-map.md",
      "docs/agent-memory/current-focus.md",
      "docs/agent-memory/gotchas.md",
      "docs/agent-memory/next-steps.md",
    );
  }

  if (result.prune.archivedEventCount > 0 || result.prune.archivedCheckpointCount > 0) {
    changed.push(
      ".agent-memory/archive/",
      ".agent-memory/history/events.jsonl",
      ".agent-memory/history/checkpoints/",
      ".agent-memory/state.json",
    );
  }

  if (result.prune.expiredArchiveBatchCount > 0) {
    changed.push(".agent-memory/archive/");
  }

  return uniqueStrings(changed);
}

function maintainSummary(
  ensureStarted: boolean,
  result: Awaited<ReturnType<typeof runAutomationCycle>>,
): string {
  const daemonClause = ensureStarted ? "The daemon was started first." : "The daemon was already available.";
  const pruneClause =
    result.prune.archivedEventCount > 0 || result.prune.archivedCheckpointCount > 0
      ? ` Retention archived ${result.prune.archivedEventCount} event(s) and ${result.prune.archivedCheckpointCount} checkpoint(s).`
      : (result.prune.expiredArchiveBatchCount > 0
        ? ` Retention expired ${result.prune.expiredArchiveBatchCount} archive batch(es).`
        : "");
  switch (result.status) {
    case "recalled":
      return `Maintenance completed and applied recalled memory changes. ${daemonClause}${pruneClause}`;
    case "recalled_noop":
      return `Maintenance completed and checked recall, but no durable memory update was needed. ${daemonClause}${pruneClause}`;
    case "imported":
      return `Maintenance completed after syncing external sources. ${daemonClause}${pruneClause}`;
    case "failed":
      return `Maintenance failed after attempting a sync/recall cycle. ${daemonClause}${pruneClause}`;
    case "idle":
    default:
      return `Maintenance completed and there was nothing new to sync or recall. ${daemonClause}${pruneClause}`;
  }
}

function maintainSuggestedNextAction(result: Awaited<ReturnType<typeof runAutomationCycle>>): string {
  if (result.status === "failed") {
    return "Inspect `.agent-memory/automation/latest-run.json` and rerun maintenance after fixing the reported issue.";
  }

  if (result.recall.applied) {
    return "Use `memory_compact_handoff` before ending the session if you want a fresh handoff summary.";
  }

  if (result.recall.noopReason) {
    return "No immediate action is required.";
  }

  if (result.prune.archivedEventCount > 0 || result.prune.archivedCheckpointCount > 0) {
    return "Review `agent-memory status` if you want to inspect the current archive and prune baseline.";
  }

  if (result.importSync.attempted && result.importSync.results.some((entry) => entry.failedCount > 0)) {
    return "Retry `automation_run_once` after resolving the failing external source.";
  }

  return "No immediate action is required.";
}

function topGotchas(bundleGotchas: Awaited<ReturnType<typeof readState>>["bundle"]["gotchas"]): string[] {
  return bundleGotchas.slice(0, 3).map((gotcha) => `${gotcha.title}: ${gotcha.cause}`);
}

function topNextSteps(bundleNextSteps: Awaited<ReturnType<typeof readState>>["bundle"]["nextSteps"]): string[] {
  return bundleNextSteps.slice(0, 3).map((step) => `${step.title}: ${step.start}`);
}

async function waitForDaemonMaintenanceRun(rootDir: string, previousFinishedAt: string | null): Promise<Awaited<ReturnType<typeof runAutomationCycle>> | null> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const status = await getAutomationStatus(rootDir);
    if (status.latestRun && status.latestRun.finishedAt !== previousFinishedAt) {
      return status.latestRun;
    }
    await sleep(100);
  }

  return null;
}

export async function buildMemoryAssessWorkflow(rootDir: string): Promise<MemoryAssessWorkflowResult> {
  const [statusReport, findings, automation, integration] = await Promise.all([
    buildStatusReport(rootDir, null, false),
    validateMemory(rootDir),
    getAutomationStatus(rootDir),
    buildIntegrationStatusReport(rootDir, "all"),
  ]);

  const validationSummary = summarizeFindings(findings);
  const claudeHealthy = componentHealthy([
    integration.claude.mcpProjectConfig,
    integration.claude.settingsHooks,
    integration.claude.skills,
  ]);
  const codexHealthy = componentHealthy([
    integration.codex.agentsGuidance,
    integration.codex.globalMcpConfig,
  ]);
  const status = workflowStatus({
    failCount: validationSummary.failCount,
    warnCount: validationSummary.warnCount,
    backlog: statusReport.history.unrecalledAll,
    automationRunning: automation.running,
    integrationHealthy: claudeHealthy && codexHealthy,
  });
  const health = memoryHealth(status);
  const automationSummary = summarizeAutomationState({
    running: automation.running,
    lastRunStatus: automation.latestRun?.status ?? null,
    lastRunFinishedAt: automation.latestRun?.finishedAt ?? null,
  });
  const warnings = uniqueStrings([
    ...statusReport.unrecalledSummary.groups
      .slice(0, 2)
      .map((group) => `Unrecalled history: ${group.representativeSummary}`),
    ...findings.filter((finding) => finding.status === "warn").slice(0, 3).map((finding) => `${finding.code}: ${finding.message}`),
    ...integration.warnings,
    ...((!automation.running) ? [automationSummary] : []),
    ...(
      statusReport.retention.pruneCandidateEventCount + statusReport.retention.pruneCandidateCheckpointCount > 0
        ? [
            `Retention candidates: ${statusReport.retention.pruneCandidateEventCount} event(s), ${statusReport.retention.pruneCandidateCheckpointCount} checkpoint(s).`,
          ]
        : []
    ),
  ]);
  const errors = findings.filter((finding) => finding.status === "fail").map((finding) => `${finding.code}: ${finding.message}`);

  let suggestedNextAction = statusReport.suggestedNextAction;
  if (validationSummary.failCount > 0) {
    suggestedNextAction = "Run `agent-memory validate` and fix the failing canonical memory files before relying on automation.";
  } else if (!automation.running) {
    suggestedNextAction = "Run `agent-memory automate ensure-running` to restore the background daemon.";
  } else if (!integration.healthy) {
    suggestedNextAction = integration.suggestedNextAction;
  } else if (statusReport.retention.pruneCandidateEventCount + statusReport.retention.pruneCandidateCheckpointCount > 0) {
    suggestedNextAction = "Run `agent-memory automate run-once` to archive aged history and checkpoints.";
  }

  return {
    status,
    summary: [
      `Memory is ${health}.`,
      `${statusReport.history.unrecalledAll} unrecalled event(s) are waiting across ${statusReport.unrecalledSummary.groupedItemCount} grouped item(s).`,
      automationSummary,
    ].join(" "),
    suggestedNextAction,
    details: {
      memoryHealth: health,
      backlog: {
        unrecalledAll: statusReport.history.unrecalledAll,
        unrecalledLocal: statusReport.history.unrecalledLocal,
        unrecalledImports: statusReport.history.unrecalledImports,
      },
      automation: {
        running: automation.running,
        lastRunStatus: automation.latestRun?.status ?? null,
        lastRunFinishedAt: automation.latestRun?.finishedAt ?? null,
      },
      integration: {
        claude: integrationHealth(claudeHealthy),
        codex: integrationHealth(codexHealthy),
        healthy: integration.healthy,
      },
      validate: validationSummary,
      retention: statusReport.retention,
    },
    warnings,
    errors,
  };
}

export async function runMemoryMaintainWorkflow(rootDir: string): Promise<MemoryMaintainWorkflowResult> {
  const before = await getAutomationStatus(rootDir);
  const ensured = await ensureAutomationDaemonRunning(rootDir);
  const result = ensured.started
    ? (await waitForDaemonMaintenanceRun(rootDir, before.latestRun?.finishedAt ?? null)) ?? await runAutomationCycle(rootDir)
    : await runAutomationCycle(rootDir);
  const status: WorkflowStatus = result.status === "failed"
    ? "fail"
    : (result.warnings.length > 0 ? "warn" : "ok");

  return {
    status,
    summary: maintainSummary(ensured.started, result),
    suggestedNextAction: maintainSuggestedNextAction(result),
    details: {
      daemon: {
        wasRunning: before.running,
        startedNow: ensured.started,
      },
      run: {
        status: result.status,
        importAttempted: result.importSync.attempted,
        recallAttempted: result.recall.attempted,
        recallApplied: result.recall.applied,
        groupedItemCount: result.recall.groupedItemCount,
      },
      prune: result.prune,
      changedFiles: maintainChangedFiles(result),
      latestRunPath: ".agent-memory/automation/latest-run.json",
    },
    warnings: result.warnings,
    errors: result.errors,
  };
}

export async function buildMemoryCompactHandoffWorkflow(rootDir: string): Promise<MemoryCompactHandoffWorkflowResult> {
  const [state, statusReport, findings, automation] = await Promise.all([
    readState(rootDir),
    buildStatusReport(rootDir, null, false),
    validateMemory(rootDir),
    getAutomationStatus(rootDir),
  ]);

  const validationSummary = summarizeFindings(findings);
  const automationSummary = summarizeAutomationState({
    running: automation.running,
    lastRunStatus: automation.latestRun?.status ?? null,
    lastRunFinishedAt: automation.latestRun?.finishedAt ?? null,
  });
  const recommendedResumeActions = uniqueStrings([
    statusReport.suggestedNextAction === "No immediate action is required." ? "" : statusReport.suggestedNextAction,
    ...state.bundle.nextSteps.slice(0, 2).map((step) => step.start),
    ...validationSummary.topFindings.map((finding) => `Review validation finding: ${finding}`),
  ]).slice(0, 4);
  const warnings = uniqueStrings([
    ...findings.filter((finding) => finding.status === "warn").slice(0, 3).map((finding) => `${finding.code}: ${finding.message}`),
    ...(statusReport.unrecalledSummary.groupedItemCount > 0
      ? [`${statusReport.unrecalledSummary.groupedItemCount} grouped unrecalled history item(s) are still waiting for recall.`]
      : []),
    ...(!automation.running ? [automationSummary] : []),
  ]);
  const errors = findings.filter((finding) => finding.status === "fail").map((finding) => `${finding.code}: ${finding.message}`);
  const status: WorkflowStatus =
    errors.length > 0 ? "fail" : (warnings.length > 0 ? "warn" : "ok");

  return {
    status,
    summary: [
      state.bundle.currentFocus.summary,
      `${statusReport.unrecalledSummary.groupedItemCount} grouped unrecalled history item(s) remain.`,
      automationSummary,
    ].join(" "),
    suggestedNextAction: recommendedResumeActions[0] ?? "No immediate action is required.",
    details: {
      currentFocusSummary: state.bundle.currentFocus.summary,
      topGotchas: topGotchas(state.bundle.gotchas),
      topNextSteps: topNextSteps(state.bundle.nextSteps),
      unrecalledGroupedCount: statusReport.unrecalledSummary.groupedItemCount,
      automationSummary,
      retentionSummary:
        statusReport.retention.pruneCandidateEventCount + statusReport.retention.pruneCandidateCheckpointCount > 0
          ? `Retention currently has ${statusReport.retention.pruneCandidateEventCount} event candidate(s) and ${statusReport.retention.pruneCandidateCheckpointCount} checkpoint candidate(s).`
          : (statusReport.retention.archiveBatchCount > 0
            ? `Retention archive has ${statusReport.retention.archiveBatchCount} batch(es); oldest is ${statusReport.retention.oldestArchiveCreatedAt ?? "unknown"}.`
            : "No retention action is currently pending."),
      recommendedResumeActions,
    },
    warnings,
    errors,
  };
}
