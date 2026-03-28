const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { readConfig } = require(path.join(__dirname, "..", "dist", "core", "config-store.js"));
const {
  acquireAutomationLock,
  cleanupAutomationRuntime,
  getAutomationLockPath,
  readAutomationLock,
  validateAutomationRunResultShape,
  writeAutomationDaemonState,
  writeAutomationLatestRun,
} = require(path.join(__dirname, "..", "dist", "core", "automation-runtime.js"));

test("readConfig supplies automation defaults and merges partial overrides", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-automation-config-"));
  await fs.mkdir(path.join(projectDir, ".agent-memory"), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, ".agent-memory", "config.json"),
    JSON.stringify({
      recall: {
        defaultSection: "all",
        defaultSource: "all",
        policy: "balanced",
        backlogWarnThreshold: 10,
        preview: { showDiffByDefault: false },
      },
      query: {
        defaultOutput: "text",
        templates: {},
      },
      automation: {
        intervalMinutes: 30,
        provider: "claude",
      },
    }, null, 2),
    "utf8",
  );

  const config = await readConfig(projectDir);
  assert.equal(config.automation.intervalMinutes, 30);
  assert.equal(config.automation.provider, "claude");
  assert.equal(config.automation.importSyncBeforeRecall, true);
  assert.equal(config.automation.autoRecall, true);
  assert.equal(config.retention.enabled, true);
  assert.equal(config.retention.history.maxAgeDays, 90);
  assert.equal(config.retention.checkpoints.maxAgeDays, 30);
  assert.equal(config.retention.checkpoints.keepRecent, 10);
  assert.equal(config.retention.archive.expireAfterDays, 180);
});

test("acquireAutomationLock recovers stale locks", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-automation-lock-"));
  const lockPath = getAutomationLockPath(projectDir);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, createdAt: "2026-03-27T00:00:00.000Z" }), "utf8");

  await acquireAutomationLock(projectDir, process.pid);
  const lockState = await readAutomationLock(projectDir);
  assert.equal(lockState.pid, process.pid);

  await cleanupAutomationRuntime(projectDir);
});

test("validateAutomationRunResultShape accepts idle, recalled, and failed statuses", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-automation-run-"));
  const base = {
    startedAt: "2026-03-27T00:00:00.000Z",
    finishedAt: "2026-03-27T00:01:00.000Z",
    provider: "auto",
    importSync: { attempted: false, results: [] },
    recall: {
      attempted: false,
      applied: false,
      rawEventCount: 0,
      groupedItemCount: 0,
      noopReason: null,
    },
    prune: {
      attempted: true,
      archivedEventCount: 0,
      archivedCheckpointCount: 0,
      expiredArchiveBatchCount: 0,
      archiveBatchPath: null,
      skippedReason: "No prune candidates or expired archive batches were found.",
    },
    errors: [],
    warnings: [],
  };

  const idle = validateAutomationRunResultShape({ ...base, status: "idle" });
  assert.equal(idle.status, "idle");

  const recalled = validateAutomationRunResultShape({
    ...base,
    status: "recalled",
    recall: {
      attempted: true,
      applied: true,
      rawEventCount: 2,
      groupedItemCount: 1,
      noopReason: null,
    },
  });
  assert.equal(recalled.status, "recalled");

  const failed = validateAutomationRunResultShape({
    ...base,
    status: "failed",
    errors: ["sync failed"],
  });
  assert.equal(failed.status, "failed");

  await writeAutomationLatestRun(projectDir, failed);
  await writeAutomationDaemonState(projectDir, {
    pid: process.pid,
    startedAt: base.startedAt,
    lastHeartbeatAt: base.finishedAt,
    intervalMinutes: 15,
    provider: "auto",
  });
});
