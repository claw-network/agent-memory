const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  REPO_ROOT,
  createFakeProviderBinaries,
  createFixtureProject,
  providerEnv,
  runCli,
} = require("./helpers/cli-fixture.js");

const {
  buildMemoryAssessWorkflow,
  buildMemoryCompactHandoffWorkflow,
  runMemoryMaintainWorkflow,
} = require(path.join(__dirname, "..", "dist", "core", "workflow-orchestrator.js"));

test("buildMemoryAssessWorkflow returns the stable assess shape", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  const init = await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers));
  assert.equal(init.code, 0, init.stderr);

  const result = await buildMemoryAssessWorkflow(projectDir);
  assert.ok(["ok", "warn", "fail"].includes(result.status));
  assert.equal(typeof result.summary, "string");
  assert.ok(["healthy", "attention", "unhealthy"].includes(result.details.memoryHealth));
  assert.equal(typeof result.details.backlog.unrecalledAll, "number");
  assert.equal(typeof result.details.automation.running, "boolean");
  assert.ok(Array.isArray(result.details.validate.topFindings));
  assert.equal(typeof result.details.retention.enabled, "boolean");
});

test("runMemoryMaintainWorkflow returns the stable maintain shape", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  const init = await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers));
  assert.equal(init.code, 0, init.stderr);

  try {
    const ensure = await runCli(projectDir, ["automate", "ensure-running"], providerEnv(providers));
    assert.equal(ensure.code, 0, ensure.stderr);

    const result = await runMemoryMaintainWorkflow(projectDir);
    assert.ok(["ok", "warn", "fail"].includes(result.status));
    assert.equal(typeof result.details.daemon.wasRunning, "boolean");
    assert.equal(typeof result.details.daemon.startedNow, "boolean");
    assert.equal(typeof result.details.prune.attempted, "boolean");
    assert.ok(Array.isArray(result.details.changedFiles));
    assert.match(result.details.latestRunPath, /latest-run\.json$/);
  } finally {
    await runCli(projectDir, ["automate", "stop"], providerEnv(providers));
  }
});

test("buildMemoryCompactHandoffWorkflow returns the stable handoff shape", async () => {
  const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-provider-"));
  const providers = await createFakeProviderBinaries(providerDir);
  const projectDir = await createFixtureProject();

  const init = await runCli(projectDir, ["init", "--yes", "--provider=codex"], providerEnv(providers));
  assert.equal(init.code, 0, init.stderr);

  const result = await buildMemoryCompactHandoffWorkflow(projectDir);
  assert.ok(["ok", "warn", "fail"].includes(result.status));
  assert.equal(typeof result.details.currentFocusSummary, "string");
  assert.ok(Array.isArray(result.details.topGotchas));
  assert.ok(Array.isArray(result.details.topNextSteps));
  assert.equal(typeof result.details.unrecalledGroupedCount, "number");
  assert.equal(typeof result.details.retentionSummary, "string");
  assert.ok(Array.isArray(result.details.recommendedResumeActions));
});
