const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  detectQueryMode,
  projectionPathForCitation,
  rankQueryShortlistItems,
} = require(path.join(__dirname, "..", "dist", "core", "query-orchestrator.js"));
const { readConfig } = require(path.join(__dirname, "..", "dist", "core", "config-store.js"));

function makeItem(input) {
  return {
    sourceType: input.sourceType || "bundle",
    sourceId: input.sourceId,
    pathOrSection: input.pathOrSection,
    summary: input.summary,
    content: input.content,
    createdAt: input.createdAt || null,
    projectionPath: input.projectionPath || null,
    category: input.category,
    tags: input.tags || [],
  };
}

test("detectQueryMode classifies changes, next, traps, and fallback answer", () => {
  assert.equal(detectQueryMode("what changed recently?"), "changes");
  assert.equal(detectQueryMode("what should I do next?"), "next");
  assert.equal(detectQueryMode("what are the known traps?"), "traps");
  assert.equal(detectQueryMode("how does caching work?"), "answer");
});

test("detectQueryMode applies priority next > traps > changes > answer", () => {
  assert.equal(detectQueryMode("what changed and what should I do next?"), "next");
  assert.equal(detectQueryMode("what changed and what are the known traps?"), "traps");
});

test("projectionPathForCitation maps bundle sections to projection docs", () => {
  assert.equal(projectionPathForCitation("bundle", "bundle.project"), "docs/agent-memory/project-map.md");
  assert.equal(projectionPathForCitation("bundle", "bundle.projectMap"), "docs/agent-memory/project-map.md");
  assert.equal(projectionPathForCitation("bundle", "bundle.currentFocus"), "docs/agent-memory/current-focus.md");
  assert.equal(projectionPathForCitation("bundle", "bundle.gotchas.Initial gotcha"), "docs/agent-memory/gotchas.md");
  assert.equal(projectionPathForCitation("bundle", "bundle.nextSteps.Review the generated state"), "docs/agent-memory/next-steps.md");
  assert.equal(projectionPathForCitation("event", "event:evt-000002"), null);
  assert.equal(projectionPathForCitation("checkpoint", "checkpoint:chk-000001"), null);
});

test("rankQueryShortlistItems prefers recent checkpoints and events in changes mode", () => {
  const ranked = rankQueryShortlistItems("changes", "what changed recently?", [
    makeItem({
      sourceId: "project",
      pathOrSection: "bundle.project",
      summary: "project summary",
      content: "what changed recently project summary",
      category: "project",
      tags: ["answer"],
      projectionPath: "docs/agent-memory/project-map.md",
    }),
    makeItem({
      sourceType: "checkpoint",
      sourceId: "chk-000002",
      pathOrSection: "checkpoint:chk-000002",
      summary: "recent checkpoint",
      content: "what changed recently recent checkpoint",
      createdAt: "2099-03-27T00:00:00.000Z",
      category: "checkpoint",
      tags: ["changes"],
    }),
  ]);

  assert.equal(ranked[0].sourceType, "checkpoint");
});

test("rankQueryShortlistItems prefers next steps and suggested actions in next mode", () => {
  const ranked = rankQueryShortlistItems("next", "what should I do next?", [
    makeItem({
      sourceId: "current-focus",
      pathOrSection: "bundle.currentFocus",
      summary: "focus summary",
      content: "what should I do next current focus",
      category: "current-focus",
      tags: ["changes", "next", "traps"],
      projectionPath: "docs/agent-memory/current-focus.md",
    }),
    makeItem({
      sourceId: "next-step-1",
      pathOrSection: "bundle.nextSteps.Do the thing",
      summary: "Do the thing",
      content: "what should I do next do the thing",
      category: "next-step",
      tags: ["next"],
      projectionPath: "docs/agent-memory/next-steps.md",
    }),
  ]);

  assert.equal(ranked[0].category, "next-step");
});

test("rankQueryShortlistItems prefers gotchas in traps mode", () => {
  const ranked = rankQueryShortlistItems("traps", "what are the known traps?", [
    makeItem({
      sourceId: "current-focus",
      pathOrSection: "bundle.currentFocus",
      summary: "focus summary",
      content: "what are the known traps current focus",
      category: "current-focus",
      tags: ["changes", "next", "traps"],
      projectionPath: "docs/agent-memory/current-focus.md",
    }),
    makeItem({
      sourceId: "gotcha-1",
      pathOrSection: "bundle.gotchas.Initial gotcha",
      summary: "Initial gotcha",
      content: "what are the known traps initial gotcha",
      category: "gotcha",
      tags: ["traps"],
      projectionPath: "docs/agent-memory/gotchas.md",
    }),
  ]);

  assert.equal(ranked[0].category, "gotcha");
});

test("readConfig supplies query defaults and merges partial template overrides", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-memory-query-config-"));
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
        templates: {
          next: {
            instructions: "Use project next override.",
          },
        },
      },
    }, null, 2),
    "utf8",
  );

  const config = await readConfig(projectDir);
  assert.equal(config.query.defaultOutput, "text");
  assert.equal(config.query.templates.next.instructions, "Use project next override.");
  assert.ok(config.query.templates.answer.instructions.length > 0);
});
