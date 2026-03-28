<!-- agent-memory:projection file=project-map version=3 bundleHash=064a82ecbc8b63ca97d01824fdb45f860aa0481cd2ebf8e1bdd8e392cd4c29d8 -->
# Project Map

Self-host dogfood baseline for the agent-memory repository.

## Engineering Facts

- Primary ecosystem: node
- Package manager: npm
- Workspace mechanism: none
- Recommended entry file: `README.md`

## Key Paths

- `package.json`
- `README.md`
- `src/cli.ts`
- `scripts/dogfood/lib.mjs`

## Modules

- `src/commands` (commands): CLI entrypoints for operator-facing actions.
- `src/core` (core): Canonical memory, automation, integration, query, and workflow orchestration.
- `scripts/dogfood` (dogfood): Repo self-host exercise and repair flows.
- `test` (tests): Unit, CLI integration, retention, workflow, and dogfood coverage.

## Entrypoints

- `src/cli.ts`: Primary CLI entrypoint.
- `scripts/dogfood/init.mjs`: Self-host baseline bootstrap.
- `scripts/dogfood/exercise.mjs`: Isolated worktree dogfood exercise runner.
- `scripts/dogfood/repair.mjs`: Deterministic plus provider-driven self-heal runner.

## Dense Source Areas

- `src/core`: Core product logic lives here.
- `scripts/dogfood`: Self-host automation and repair orchestration.
- `test`: Coverage is broad and doubles as executable product spec.

## Architecture Notes

- Canonical state lives under .agent-memory and projects into docs/agent-memory.
- Automation, integration, MCP workflow, retention, and dogfood are all first-class product surfaces.
- The repository now self-hosts its own memory and integration baseline.

## First Files To Read

- `README.md`
- `src/cli.ts`
- `src/core/workflow-orchestrator.ts`
- `scripts/dogfood/lib.mjs`
