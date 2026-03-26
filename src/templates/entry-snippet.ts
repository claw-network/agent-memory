export function renderEntrySnippet(): string {
  return [
    "## Project Memory",
    "",
    "This repository keeps durable project memory in `docs/agent-memory/`.",
    "",
    "Recommended reading order:",
    "1. `docs/agent-memory/README.md`",
    "2. `docs/agent-memory/project-map.md` and `docs/agent-memory/current-focus.md`",
    "3. `docs/agent-memory/gotchas.md` when behavior looks noisy, surprising, or expensive to debug",
    "4. `docs/agent-memory/next-steps.md` when you need a clean starting point",
    "",
    "Refresh this memory whenever architecture, command semantics, validation baselines, or costly gotchas change.",
  ].join("\n");
}
