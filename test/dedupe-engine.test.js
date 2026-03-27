const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { dedupeBundle } = require(path.join(__dirname, "..", "dist", "core", "dedupe-engine.js"));

test("dedupeBundle conservatively merges near-duplicate current focus strings", () => {
  const bundle = {
    project: {
      name: "fixture-project",
      summary: "fixture summary",
      primaryEcosystem: "node",
      packageManager: "npm",
      workspaceManager: "none",
      recommendedEntryFile: "README.md",
      keyPaths: ["README.md"],
    },
    projectMap: {
      modules: [],
      entrypoints: [],
      denseSourceAreas: [],
      architectureNotes: [],
      firstFilesToRead: ["README.md"],
    },
    currentFocus: {
      summary: "current focus",
      currentState: [
        "Cache layer is enabled for query responses",
        "Cache layer is enabled for query responses in development",
      ],
      knownRisks: [
        "Cache validation is flaky",
        "Cache validation is flaky in CI",
      ],
      validationSnapshot: {
        status: "passed",
        validatedAt: "2026-03-26T00:00:00.000Z",
        summary: "validation summary",
        results: [],
        suggestedNextActions: [
          "Refresh the cache troubleshooting guide",
          "Refresh the cache troubleshooting guide for the dev workflow",
        ],
      },
    },
    gotchas: [],
    nextSteps: [],
    validationCommands: [],
  };

  const deduped = dedupeBundle(bundle).bundle;

  assert.equal(deduped.currentFocus.currentState.length, 1);
  assert.match(deduped.currentFocus.currentState[0], /development/);
  assert.equal(deduped.currentFocus.knownRisks.length, 1);
  assert.match(deduped.currentFocus.knownRisks[0], /in CI/);
  assert.equal(deduped.currentFocus.validationSnapshot.suggestedNextActions.length, 1);
  assert.match(deduped.currentFocus.validationSnapshot.suggestedNextActions[0], /dev workflow/);
});
