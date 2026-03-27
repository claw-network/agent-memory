const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { summarizeUnrecalledHistory } = require(path.join(__dirname, "..", "dist", "core", "recall-evidence.js"));

function makeEvent(input) {
  return {
    id: input.id,
    kind: input.kind || "imported_session",
    sourceId: input.sourceId || "source-a",
    externalItemId: null,
    createdAt: input.createdAt || "2026-03-27T00:00:00.000Z",
    contentHash: input.contentHash || input.id,
    summary: input.summary || input.id,
    sourceRef: input.sourceRef || input.id,
    signals: {
      decisions: input.decisions || [],
      gotchas: input.gotchas || [],
      nextStepHints: input.nextStepHints || [],
      keyPaths: input.keyPaths || [],
      validationObservations: input.validationObservations || [],
    },
  };
}

test("summarizeUnrecalledHistory groups local and imported events by shared gotcha topic", () => {
  const summary = summarizeUnrecalledHistory([
    makeEvent({
      id: "evt-000002",
      kind: "tool_run",
      sourceId: "agent-memory.local",
      summary: "Local cache gotcha",
      gotchas: ["Reset local cache before query: stale responses"],
    }),
    makeEvent({
      id: "evt-000003",
      kind: "imported_session",
      sourceId: "claude-a",
      createdAt: "2026-03-27T00:00:01.000Z",
      summary: "Imported cache gotcha",
      gotchas: ["Reset local cache before query: stale responses in CI"],
    }),
  ]);

  assert.equal(summary.rawEventCount, 2);
  assert.equal(summary.groupedItemCount, 1);
  assert.equal(summary.groups[0].sourceScopeLabel, "mixed");
  assert.deepEqual(summary.groups[0].eventIds, ["evt-000002", "evt-000003"]);
  assert.deepEqual(summary.groups[0].sourceIds, ["agent-memory.local", "claude-a"]);
});

test("summarizeUnrecalledHistory groups events by shared next-step topic", () => {
  const summary = summarizeUnrecalledHistory([
    makeEvent({
      id: "evt-000002",
      nextStepHints: ["NEXT: Write cache playbook: include reset steps"],
    }),
    makeEvent({
      id: "evt-000003",
      createdAt: "2026-03-27T00:00:01.000Z",
      nextStepHints: ["NEXT: Write cache playbook: add troubleshooting examples"],
    }),
  ]);

  assert.equal(summary.groupedItemCount, 1);
  assert.equal(summary.groups[0].signals.nextStepHints.length, 1);
});

test("summarizeUnrecalledHistory does not merge on shared path alone", () => {
  const summary = summarizeUnrecalledHistory([
    makeEvent({
      id: "evt-000002",
      keyPaths: ["src/cache.ts"],
      decisions: ["Enable read cache"],
    }),
    makeEvent({
      id: "evt-000003",
      createdAt: "2026-03-27T00:00:01.000Z",
      keyPaths: ["src/cache.ts"],
      decisions: ["Introduce write-through mode"],
    }),
  ]);

  assert.equal(summary.groupedItemCount, 2);
});

test("summarizeUnrecalledHistory keeps provenance and dedupes richer signal strings", () => {
  const summary = summarizeUnrecalledHistory([
    makeEvent({
      id: "evt-000002",
      sourceId: "claude-a",
      summary: "Short cache summary",
      gotchas: ["Reset cache before query: clear stale data"],
      keyPaths: ["src/cache.ts"],
      validationObservations: ["Cache validation is flaky: local runs"],
    }),
    makeEvent({
      id: "evt-000003",
      sourceId: "claude-b",
      createdAt: "2026-03-27T00:00:01.000Z",
      summary: "Longer cache summary with more context",
      gotchas: ["Reset cache before query: clear stale data in CI"],
      keyPaths: ["src/cache.ts"],
      validationObservations: ["Cache validation is flaky: CI runs after importer sync"],
    }),
  ]);

  assert.equal(summary.groupedItemCount, 1);
  assert.equal(summary.groups[0].representativeSummary, "Longer cache summary with more context");
  assert.deepEqual(summary.groups[0].sourceIds, ["claude-a", "claude-b"]);
  assert.equal(summary.groups[0].signals.validationObservations.length, 1);
  assert.match(summary.groups[0].signals.validationObservations[0], /CI/);
});
