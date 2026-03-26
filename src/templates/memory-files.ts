import type { GenerationMode, ProjectScan, ValidationResult } from "../types";

interface NextStepCard {
  title: string;
  why: string;
  start: string;
  done: string;
}

function renderBulletList(items: string[], fallback: string): string {
  if (items.length === 0) {
    return `- ${fallback}`;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function describeProject(scan: ProjectScan): string {
  if (scan.primaryEcosystem === "node" && scan.workspaceModules.length > 0) {
    return "a multi-package Node.js repository";
  }

  if (scan.primaryEcosystem === "node") {
    return "a Node.js repository";
  }

  if (scan.primaryEcosystem === "python") {
    return "a Python repository";
  }

  if (scan.primaryEcosystem === "rust") {
    return "a Rust repository";
  }

  if (scan.primaryEcosystem === "go") {
    return "a Go repository";
  }

  return "a software repository";
}

function buildNextStepCards(
  scan: ProjectScan,
  validations: ValidationResult[],
  mode: GenerationMode,
): NextStepCard[] {
  const cards: NextStepCard[] = [];
  const hasValidationResults = validations.length > 0;
  const hasFailures = validations.some((result) => result.status === "failed");

  if (!hasValidationResults) {
    cards.push({
      title: "Establish a validation baseline",
      why: `${
        mode === "init" ? "The initial" : "This"
      } memory snapshot is static-only. Running one or two common checks turns current-focus.md into a real operational baseline.`,
      start: scan.validationCandidates.length > 0
        ? `Run the most common commands first: ${scan.validationCandidates
            .slice(0, 2)
            .map((candidate) => `\`${candidate.command.join(" ")}\``)
            .join(" and ")}.`
        : "Identify the project’s canonical build or test command and add it to the memory after the first run.",
      done: "current-focus.md records at least one recent verification result with a clear pass/fail summary.",
    });
  }

  if (hasFailures) {
    cards.push({
      title: "Turn failing checks into a known baseline",
      why: "A failed validation is still useful once the failure mode is named and tracked. It reduces repeated rediscovery for the next contributor.",
      start: "Take the first failing command in current-focus.md and record the actual blocker, owner, or subsystem.",
      done: "The failure is described in memory as a concrete known issue instead of a generic broken state.",
    });
  }

  if (scan.workspaceModules.length > 0) {
    cards.push({
      title: "Replace inferred module roles with real ownership",
      why: "The generator can infer module boundaries, but it cannot know domain intent. Tight roles make project-map.md much more valuable.",
      start: `Review ${scan.workspaceModules.length} detected workspace modules and replace any “role needs confirmation” entries with product-specific descriptions.`,
      done: "Each workspace module explains its responsibility in one short sentence.",
    });
  }

  cards.push({
    title: "Review the generated project map once with a human pass",
    why: "Static scanning is a strong starting point, but it cannot know the repo’s real business boundaries or team language.",
    start: "Read project-map.md and replace any vague wording around modules, entrypoints, or source areas with repo-specific language.",
    done: "A newcomer can understand the project structure in a few minutes without guessing what major modules do.",
  });

  cards.push({
    title: "Record the first expensive gotcha",
    why: "The highest-value memory usually starts when the team writes down one subtle trap that was painful to rediscover.",
    start: "When you hit a noisy runtime issue, packaging mismatch, or tricky entrypoint boundary, capture it in gotchas.md as symptom, cause, and correct path.",
    done: "gotchas.md contains at least one project-specific trap that a newcomer would not spot from static code alone.",
  });

  cards.push({
    title: "Keep the entry file authoritative",
    why: "The memory directory only works when future contributors know where to start. The entry file is the durable signpost.",
    start: "Confirm the injected Project Memory section matches your preferred collaboration entry file and team workflow.",
    done: "There is one clear top-level entry that points contributors to docs/agent-memory before deeper work starts.",
  });

  return cards.slice(0, 5);
}

export function renderMemoryReadme(scan: ProjectScan): string {
  return [
    "# Agent Memory",
    "",
    "This directory stores durable project memory for developers and coding agents.",
    "",
    "## Purpose",
    "",
    `- Give future contributors a fast, trustworthy starting point for ${scan.projectName}.`,
    "- Separate stable structure from current status so the repo keeps one clean map and one current snapshot.",
    "- Capture expensive lessons that are easy to forget and costly to rediscover.",
    "",
    "## What belongs here",
    "",
    "- `project-map.md`: the stable map of modules, entrypoints, and architecture.",
    "- `current-focus.md`: the current single-snapshot status, including the latest verification summary.",
    "- `gotchas.md`: high-cost traps, noisy failure modes, and subtle boundaries.",
    "- `next-steps.md`: practical starting points for the next contributor.",
    "",
    "## Maintenance rules",
    "",
    "- Update this memory when workspace structure changes.",
    "- Update it when command semantics or primary workflows change.",
    "- Refresh `current-focus.md` after meaningful build/test verification.",
    "- Add new entries to `gotchas.md` only when they are genuinely expensive to rediscover.",
    "- Keep `current-focus.md` as a single current snapshot, not a running changelog.",
    "",
    "## Scope boundary",
    "",
    "- Keep long tutorials, API walkthroughs, and product requirements outside this folder.",
    "- Link to external docs when helpful, but keep this folder high-signal and short.",
  ].join("\n");
}

export function renderProjectMap(scan: ProjectScan): string {
  const workspaceSection =
    scan.workspaceModules.length > 0
      ? scan.workspaceModules
          .map((moduleInfo) => `- \`${moduleInfo.path}\` (${moduleInfo.name}): ${moduleInfo.role}.`)
          .join("\n")
      : "- No workspace modules were detected during the current scan.";

  return [
    "# Project Map",
    "",
    `${scan.projectName} looks like ${describeProject(scan)} based on the current static scan.`,
    "",
    "## Engineering Facts",
    "",
    `- Primary ecosystem: ${scan.primaryEcosystem}.`,
    `- Package manager: ${scan.packageManager ?? "Not detected from static signals."}`,
    `- Workspace mechanism: ${scan.workspaceManager ?? "No explicit workspace manager detected."}`,
    `- Root scripts detected: ${scan.rootScripts.length > 0 ? scan.rootScripts.map((item) => `\`${item}\``).join(", ") : "none"}.`,
    "",
    "## Top-Level Layout",
    "",
    renderBulletList(
      scan.topLevelDirs.map((dir) => `\`${dir}/\``),
      "No top-level directories detected.",
    ),
    "",
    "## Workspace Modules",
    "",
    workspaceSection,
    "",
    "## Key Entrypoints",
    "",
    renderBulletList(
      scan.keyEntryFiles.map((file) => `\`${file}\``),
      "No obvious entry files were detected from manifests or common source conventions.",
    ),
    "",
    "## High-Density Source Areas",
    "",
    renderBulletList(scan.denseSourceDirs, "No dense source directories were detected."),
    "",
    "## Architecture Notes",
    "",
    "- Root manifests and scripts define the initial workflow surface.",
    `- ${scan.workspaceModules.length > 0 ? "Workspace modules appear to carry most domain logic and integration boundaries." : "Core logic likely lives directly under the root source tree."}`,
    `- ${scan.keyEntryFiles.some((file) => /browser|server|worker|cli/i.test(file)) ? "Runtime-specific entrypoints are present; keep those boundaries explicit." : "No strong runtime-specific entrypoint split was detected from the static scan."}`,
    "",
    "## First Files To Read",
    "",
    renderBulletList(
      scan.keyEntryFiles.slice(0, 5).map((file) => `\`${file}\``),
      "Start with the root manifest, README, and primary source entrypoint.",
    ),
  ].join("\n");
}

export function renderCurrentFocus(
  scan: ProjectScan,
  validations: ValidationResult[],
  mode: GenerationMode,
): string {
  const activeFollowUps = buildNextStepCards(scan, validations, mode)
    .slice(0, 4)
    .map((card) => card.title);
  const validationSection =
    validations.length === 0
      ? [
          "## Validation Snapshot",
          "",
          `- Status: Not run during ${mode}.`,
          `- Suggested next command(s): ${
            scan.validationCandidates.length > 0
              ? scan.validationCandidates
                  .slice(0, 2)
                  .map((candidate) => `\`${candidate.command.join(" ")}\``)
                  .join(", ")
              : "No common validation command was inferred."
          }`,
        ].join("\n")
      : [
          "## Validation Snapshot",
          "",
          ...validations.map(
            (result) =>
              `- ${result.status.toUpperCase()} ${result.command}: ${result.summary}`,
          ),
        ].join("\n");

  return [
    "# Current Focus",
    "",
    `Generated during ${mode} on ${scan.generatedAt}.`,
    "",
    "## Current State",
    "",
    `- Project signals: ${scan.projectSignals.length > 0 ? scan.projectSignals.map((signal) => `\`${signal}\``).join(", ") : "none detected"}.`,
    `- Package manager baseline: ${scan.packageManager ?? "not detected"}.`,
    `- Workspace baseline: ${scan.workspaceManager ?? "not detected"}.`,
    `- Root command surface: ${scan.rootScripts.length > 0 ? scan.rootScripts.map((script) => `\`${script}\``).join(", ") : "no root scripts detected"}.`,
    "",
    validationSection,
    "",
    "## Recent Important Facts",
    "",
    renderBulletList(
      [
        scan.workspaceModules.length > 0
          ? `${scan.workspaceModules.length} workspace module(s) were detected from manifests or workspace patterns.`
          : "No workspace modules were detected during the current scan.",
        scan.denseSourceDirs.length > 0
          ? `The highest-density source area is ${scan.denseSourceDirs[0]}.`
          : "No dense source directory stood out during the static scan.",
        scan.gotchas.length > 0
          ? `Static scan flagged ${scan.gotchas.length} potential gotcha signal(s).`
          : "Static scan did not surface strong project-specific gotcha signals yet.",
      ],
      "No additional important facts were inferred during the current scan.",
    ),
    "",
    "## Active Follow-Ups",
    "",
    renderBulletList(activeFollowUps, "Review and tighten the generated memory after the first manual pass."),
  ].join("\n");
}

export function renderGotchas(scan: ProjectScan): string {
  const detected = scan.gotchas.length > 0
    ? scan.gotchas
    : ["No strong project-specific gotchas were inferred from the static scan yet."];

  return [
    "# Gotchas",
    "",
    "Only keep items here if they are easy to forget and expensive to rediscover.",
    "",
    "## Auto-Detected Signals",
    "",
    renderBulletList(detected, "No signals detected."),
    "",
    "## Keep This File High-Signal",
    "",
    "- Prefer symptom -> cause -> correct path over long storytelling.",
    "- If a gotcha stops being relevant, delete it instead of keeping historical noise.",
    "- Add project-specific gotchas here after the first costly debugging session.",
  ].join("\n");
}

export function renderNextSteps(
  scan: ProjectScan,
  validations: ValidationResult[],
  mode: GenerationMode,
): string {
  const cards = buildNextStepCards(scan, validations, mode);

  return [
    "# Next Steps",
    "",
    ...cards.flatMap((card, index) => [
      `## ${index + 1}. ${card.title}`,
      "",
      `Why: ${card.why}`,
      "",
      `Start: ${card.start}`,
      "",
      `Done when: ${card.done}`,
      "",
    ]),
  ]
    .join("\n")
    .trimEnd()
    .concat("\n");
}
