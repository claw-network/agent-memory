<!-- agent-memory:projection file=current-focus version=3 bundleHash=064a82ecbc8b63ca97d01824fdb45f860aa0481cd2ebf8e1bdd8e392cd4c29d8 -->
# Current Focus

The repository is configured to self-host and exercise its own memory system.

## Current State

- Dogfood scripts exist under scripts/dogfood.
- CLI, integration, automation, retention, MCP, and workflow features are covered by tests.
- Stable self-host assets should live in repo root and stay reviewable in git.

## Known Risks

- Real provider authentication may differ across local environments.
- Dogfood repair uses provider-driven editing and should stay isolated in a temporary worktree.
- Automation runtime and archive outputs must stay ignored while stable memory assets remain tracked.

## Validation Snapshot

- Status: passed
- Validated at: 2026-03-28T00:00:00.000Z
- Summary: Baseline validation was synthesized for self-host initialization.

## Validation Results

- PASSED npm run build: Build command is available.
- PASSED npm test: Test suite command is available.

## Suggested Next Actions

- Run npm run dogfood:exercise after code changes.
- Run npm run dogfood:repair when self-host drift or breakage is detected.

## Agent-Recommended Validation Commands

- `npm run build` (build): Confirm the package still compiles.
- `npm test` (test): Run the full CLI, workflow, retention, and dogfood suite.
