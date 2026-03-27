import { join } from "node:path";
import { ENTRY_VERSION, PROJECTION_VERSION } from "./constants";
import type {
  AgentGotcha,
  AgentMemoryState,
  AgentNextStep,
  ProjectedMemory,
  ProjectionFile,
  ProjectionFileId,
} from "../types";

const DOCS_DIR = "docs/agent-memory";

function renderBulletList(items: string[], fallback: string): string {
  if (items.length === 0) {
    return `- ${fallback}`;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function renderProjectionMarker(fileId: ProjectionFileId, bundleHash: string): string {
  return `<!-- agent-memory:projection file=${fileId} version=${PROJECTION_VERSION} bundleHash=${bundleHash} -->`;
}

function renderGotcha(gotcha: AgentGotcha): string {
  return [
    `## ${gotcha.title}`,
    "",
    `Symptom: ${gotcha.symptom}`,
    "",
    `Cause: ${gotcha.cause}`,
    "",
    `Correct path: ${gotcha.correctPath}`,
  ].join("\n");
}

function renderNextStep(step: AgentNextStep, index: number): string {
  return [
    `## ${index + 1}. ${step.title}`,
    "",
    `Why: ${step.why}`,
    "",
    `Start: ${step.start}`,
    "",
    `Done when: ${step.done}`,
  ].join("\n");
}

function withMarker(fileId: ProjectionFileId, bundleHash: string, body: string): string {
  return `${renderProjectionMarker(fileId, bundleHash)}\n${body.trimEnd()}\n`;
}

function renderReadme(state: AgentMemoryState): string {
  const { bundle, provider, generatedAt } = state;
  return [
    "# Agent Memory",
    "",
    "This directory is a generated projection of the active canonical repository memory state.",
    "",
    "## Canonical System",
    "",
    "- Canonical state file: `.agent-memory/state.json`",
    "- History log: `.agent-memory/history/events.jsonl`",
    "- Checkpoints: `.agent-memory/history/checkpoints/`",
    "- Import sources: `.agent-memory/sources.json`",
    `- Last generated: ${generatedAt}`,
    `- Provider: \`${provider.name}\``,
    `- Recommended entry file: \`${bundle.project.recommendedEntryFile}\``,
    "",
    "## Reading Order",
    "",
    "1. `docs/agent-memory/README.md`",
    "2. `docs/agent-memory/project-map.md`",
    "3. `docs/agent-memory/current-focus.md`",
    "4. `docs/agent-memory/gotchas.md` when behavior is surprising or expensive to debug",
    "5. `docs/agent-memory/next-steps.md` when you need a practical starting point",
    "",
    "## Refresh Flow",
    "",
    "- Run `npx agent-memory update` to refresh the active canonical bundle.",
    "- Run `npx agent-memory import sync --all` to ingest external session history.",
    "- Run `npx agent-memory recall` to consolidate unrecalled history into active memory.",
    "- Run `npx agent-memory query \"...\"` to retrieve memory with citations.",
    "- Run `npx agent-memory validate` to audit state, history, checkpoints, projections, and recall backlog.",
    "",
    "## Troubleshooting Notes",
    "",
    "- If `import sync` reports failed items, imported history is still preserved; inspect the failure output and rerun later.",
    "- If `recall` reports nothing to do, there were no unrecalled durable changes for the selected scope.",
    "- If `query` says evidence is insufficient, import more history or run `recall` before relying on the answer.",
    "",
    "## What Lives Here",
    "",
    "- `project-map.md`: stable structure, modules, entrypoints, and architecture notes.",
    "- `current-focus.md`: the active operating picture, risks, and validation snapshot.",
    "- `gotchas.md`: costly traps that are easy to forget and expensive to rediscover.",
    "- `next-steps.md`: the current actionable follow-ups after the latest recall/update pass.",
  ].join("\n");
}

function renderProjectMap(state: AgentMemoryState): string {
  const { bundle } = state;

  return [
    "# Project Map",
    "",
    bundle.project.summary,
    "",
    "## Engineering Facts",
    "",
    `- Primary ecosystem: ${bundle.project.primaryEcosystem}`,
    `- Package manager: ${bundle.project.packageManager}`,
    `- Workspace mechanism: ${bundle.project.workspaceManager}`,
    `- Recommended entry file: \`${bundle.project.recommendedEntryFile}\``,
    "",
    "## Key Paths",
    "",
    renderBulletList(bundle.project.keyPaths.map((path) => `\`${path}\``), "No key paths recorded."),
    "",
    "## Modules",
    "",
    renderBulletList(
      bundle.projectMap.modules.map((module) => `\`${module.path}\` (${module.name}): ${module.responsibility}`),
      "No modules recorded.",
    ),
    "",
    "## Entrypoints",
    "",
    renderBulletList(
      bundle.projectMap.entrypoints.map((entrypoint) => `\`${entrypoint.path}\`: ${entrypoint.role}`),
      "No entrypoints recorded.",
    ),
    "",
    "## Dense Source Areas",
    "",
    renderBulletList(
      bundle.projectMap.denseSourceAreas.map((area) => `\`${area.path}\`: ${area.note}`),
      "No high-density source areas recorded.",
    ),
    "",
    "## Architecture Notes",
    "",
    renderBulletList(bundle.projectMap.architectureNotes, "No architecture notes recorded."),
    "",
    "## First Files To Read",
    "",
    renderBulletList(bundle.projectMap.firstFilesToRead.map((path) => `\`${path}\``), "No first-read files recorded."),
  ].join("\n");
}

function renderCurrentFocus(state: AgentMemoryState): string {
  const { bundle } = state;
  const validation = bundle.currentFocus.validationSnapshot;

  return [
    "# Current Focus",
    "",
    bundle.currentFocus.summary,
    "",
    "## Current State",
    "",
    renderBulletList(bundle.currentFocus.currentState, "No current state bullets recorded."),
    "",
    "## Known Risks",
    "",
    renderBulletList(bundle.currentFocus.knownRisks, "No known risks recorded."),
    "",
    "## Validation Snapshot",
    "",
    `- Status: ${validation.status}`,
    `- Validated at: ${validation.validatedAt ?? "not recorded"}`,
    `- Summary: ${validation.summary}`,
    "",
    "## Validation Results",
    "",
    renderBulletList(
      validation.results.map((result) => `${result.status.toUpperCase()} ${result.command}: ${result.summary}`),
      "No validation results recorded.",
    ),
    "",
    "## Suggested Next Actions",
    "",
    renderBulletList(validation.suggestedNextActions, "No suggested next actions recorded."),
    "",
    "## Agent-Recommended Validation Commands",
    "",
    renderBulletList(
      bundle.validationCommands.map(
        (command) => `\`${command.command.join(" ")}\` (${command.label}): ${command.purpose}`,
      ),
      "No validation commands recorded.",
    ),
  ].join("\n");
}

function renderGotchas(state: AgentMemoryState): string {
  const { gotchas } = state.bundle;

  return [
    "# Gotchas",
    "",
    "Keep this file short, concrete, and limited to traps that are genuinely expensive to rediscover.",
    "",
    ...(gotchas.length > 0
      ? gotchas.flatMap((gotcha, index) => [renderGotcha(gotcha), ...(index < gotchas.length - 1 ? [""] : [])])
      : ["No confirmed gotchas have been recorded yet."]),
  ].join("\n");
}

function renderNextSteps(state: AgentMemoryState): string {
  const { nextSteps } = state.bundle;

  return [
    "# Next Steps",
    "",
    ...(nextSteps.length > 0
      ? nextSteps.flatMap((step, index) => [renderNextStep(step, index), ...(index < nextSteps.length - 1 ? [""] : [])])
      : ["No next steps have been recorded yet."]),
  ].join("\n");
}

export function buildEntrySnippet(state: AgentMemoryState): string {
  return [
    `<!-- agent-memory:entry version=${ENTRY_VERSION} bundleHash=${state.bundleHash} start -->`,
    "## Project Memory",
    "",
    "This repository keeps canonical project memory in `.agent-memory/state.json`.",
    "",
    "History and checkpoints live in `.agent-memory/history/`.",
    "",
    "Readable projections live in `docs/agent-memory/`.",
    "",
    "Recommended reading order:",
    "1. `docs/agent-memory/README.md`",
    "2. `docs/agent-memory/project-map.md`",
    "3. `docs/agent-memory/current-focus.md`",
    "4. `docs/agent-memory/gotchas.md` when debugging gets noisy or surprising",
    "5. `docs/agent-memory/next-steps.md` when you need a clean starting point",
    "",
    "Use `npx agent-memory import sync`, `npx agent-memory recall`, and `npx agent-memory query` to maintain and retrieve project memory.",
    "<!-- agent-memory:entry end -->",
  ].join("\n");
}

function projectionFile(rootDir: string, fileId: ProjectionFileId, content: string): ProjectionFile {
  const fileNameMap: Record<ProjectionFileId, string> = {
    readme: "README.md",
    "project-map": "project-map.md",
    "current-focus": "current-focus.md",
    gotchas: "gotchas.md",
    "next-steps": "next-steps.md",
  };

  return {
    fileId,
    path: join(rootDir, DOCS_DIR, fileNameMap[fileId]),
    content,
  };
}

export function projectState(rootDir: string, state: AgentMemoryState): ProjectedMemory {
  return {
    files: [
      projectionFile(rootDir, "readme", withMarker("readme", state.bundleHash, renderReadme(state))),
      projectionFile(rootDir, "project-map", withMarker("project-map", state.bundleHash, renderProjectMap(state))),
      projectionFile(rootDir, "current-focus", withMarker("current-focus", state.bundleHash, renderCurrentFocus(state))),
      projectionFile(rootDir, "gotchas", withMarker("gotchas", state.bundleHash, renderGotchas(state))),
      projectionFile(rootDir, "next-steps", withMarker("next-steps", state.bundleHash, renderNextSteps(state))),
    ],
    entryFile: join(rootDir, state.bundle.project.recommendedEntryFile),
    entrySnippet: buildEntrySnippet(state),
  };
}

export function parseProjectionMarker(
  content: string,
): { fileId: string; version: number; bundleHash: string } | null {
  const match = content.match(/^<!-- agent-memory:projection file=([a-z-]+) version=(\d+) bundleHash=([a-f0-9]+) -->\n?/);
  if (!match) {
    return null;
  }

  return {
    fileId: match[1],
    version: Number(match[2]),
    bundleHash: match[3],
  };
}

export function parseEntryMarker(
  content: string,
): { version: number; bundleHash: string } | null {
  const match = content.match(/<!-- agent-memory:entry version=(\d+) bundleHash=([a-f0-9]+) start -->/);
  if (!match) {
    return null;
  }

  return {
    version: Number(match[1]),
    bundleHash: match[2],
  };
}
