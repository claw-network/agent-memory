const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { getDefaultConfig, writeConfig } = require(path.join(__dirname, "..", "dist", "core", "config-store.js"));
const { writeHistoryEvents, writeCheckpoint } = require(path.join(__dirname, "..", "dist", "core", "history-store.js"));
const {
  buildRetentionPlan,
  validateArchiveBatchManifestShape,
} = require(path.join(__dirname, "..", "dist", "core", "retention-orchestrator.js"));
const { buildState, writeState } = require(path.join(__dirname, "..", "dist", "core", "state-store.js"));

function fixtureBundle() {
  return {
    project: {
      name: "fixture",
      summary: "fixture bundle",
      primaryEcosystem: "node",
      packageManager: "npm",
      workspaceManager: "none",
      recommendedEntryFile: "src/index.js",
      keyPaths: ["package.json", "src/index.js"],
    },
    projectMap: {
      modules: [{ name: "src", path: "src", responsibility: "source" }],
      entrypoints: [{ path: "src/index.js", role: "entry" }],
      denseSourceAreas: [{ path: "src", note: "dense" }],
      architectureNotes: ["note"],
      firstFilesToRead: ["package.json"],
    },
    currentFocus: {
      summary: "focus",
      currentState: ["state"],
      knownRisks: ["risk"],
      validationSnapshot: {
        status: "passed",
        validatedAt: "2026-03-28T00:00:00.000Z",
        summary: "valid",
        results: [],
        suggestedNextActions: [],
      },
    },
    gotchas: [],
    nextSteps: [],
    validationCommands: [],
  };
}

test("validateArchiveBatchManifestShape accepts the expected manifest shape", () => {
  const errors = validateArchiveBatchManifestShape({
    createdAt: "2026-03-28T00:00:00.000Z",
    archivedEventIds: ["evt-000001"],
    archivedCheckpointIds: ["chk-000001"],
    historyMaxAgeDays: 90,
    checkpointMaxAgeDays: 30,
    keepRecent: 10,
    expireAfterDays: 180,
  });

  assert.deepEqual(errors, []);
});

test("buildRetentionPlan keeps unrecalled events and recent checkpoints out of the prune set", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-retention-plan-"));
  await fs.mkdir(path.join(projectDir, "src"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "src", "index.js"), "module.exports = 1;\n", "utf8");
  await fs.writeFile(path.join(projectDir, "package.json"), JSON.stringify({ name: "fixture" }, null, 2), "utf8");

  const config = getDefaultConfig();
  config.retention.history.maxAgeDays = 0;
  config.retention.checkpoints.maxAgeDays = 0;
  config.retention.checkpoints.keepRecent = 1;
  await writeConfig(projectDir, config);

  const maintenance = {
    lastRecalledAt: "2026-03-28T00:00:00.000Z",
    lastRecalledEventId: "evt-000001",
    latestCheckpointId: "chk-000002",
    historyEventCount: 2,
    importSourceCount: 0,
    recallCursors: {
      all: { lastRecalledAt: "2026-03-28T00:00:00.000Z", lastRecalledEventId: "evt-000001" },
      local: { lastRecalledAt: "2026-03-28T00:00:00.000Z", lastRecalledEventId: "evt-000001" },
      imports: { lastRecalledAt: null, lastRecalledEventId: null },
    },
  };

  await writeState(
    projectDir,
    buildState(
      fixtureBundle(),
      { name: "codex", binary: "codex", model: null, sessionId: null },
      maintenance,
      "2026-03-28T00:00:00.000Z",
    ),
  );

  await writeHistoryEvents(projectDir, [
    {
      id: "evt-000001",
      kind: "tool_run",
      sourceId: "agent-memory.local",
      externalItemId: null,
      createdAt: "2020-01-01T00:00:00.000Z",
      contentHash: "hash-1",
      summary: "old recalled event",
      signals: { decisions: [], gotchas: [], nextStepHints: [], keyPaths: [], validationObservations: [] },
      sourceRef: "agent-memory:init",
    },
    {
      id: "evt-000002",
      kind: "tool_run",
      sourceId: "agent-memory.local",
      externalItemId: null,
      createdAt: "2020-01-01T00:00:00.000Z",
      contentHash: "hash-2",
      summary: "old unrecalled event",
      signals: { decisions: [], gotchas: [], nextStepHints: [], keyPaths: [], validationObservations: [] },
      sourceRef: "agent-memory:update",
    },
  ]);

  await writeCheckpoint(projectDir, {
    id: "chk-000001",
    createdAt: "2020-01-01T00:00:00.000Z",
    eventId: "evt-000001",
    bundleHash: "bundle-1",
    bundle: fixtureBundle(),
    summary: "old checkpoint",
  });
  await writeCheckpoint(projectDir, {
    id: "chk-000002",
    createdAt: "2026-03-28T00:00:00.000Z",
    eventId: "evt-000002",
    bundleHash: "bundle-2",
    bundle: fixtureBundle(),
    summary: "latest checkpoint",
  });

  const plan = await buildRetentionPlan(projectDir);
  assert.deepEqual(plan.eligibleEvents.map((event) => event.id), ["evt-000001"]);
  assert.deepEqual(plan.retainedEvents.map((event) => event.id), ["evt-000002"]);
  assert.deepEqual(plan.eligibleCheckpoints.map((checkpoint) => checkpoint.id), ["chk-000001"]);
  assert.deepEqual(plan.retainedCheckpointIds, ["chk-000002"]);
});
