# agent-memory

[![npm version](https://img.shields.io/npm/v/%40agent-connect%2Fmemory)](https://www.npmjs.com/package/@agent-connect/memory)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![node >=18](https://img.shields.io/badge/node-%3E%3D18-417e38)](./package.json)

Durable project memory with history, recall, and query.

`agent-memory` is now a full memory system for repositories:

- it stores the current canonical memory in `/.agent-memory/state.json`
- it records durable history in `/.agent-memory/history/`
- it supports configurable recall policies in `/.agent-memory/config.json`
- it projects the current memory into `docs/agent-memory/`
- it lets you consolidate memory with `recall`
- it lets you retrieve memory with `query`
- it lets you inspect backlog and checkpoint drift with `status`
- it can automate import-sync and recall with `automate`
- it can integrate Claude Code and Codex with `integrate`

## Why This Exists

Repositories keep losing the same expensive context:

- architectural boundaries live across code, manifests, and half-finished docs
- current state gets trapped in chats and PR threads
- repeated gotchas are rediscovered instead of remembered
- long-lived projects need both memory maintenance and memory retrieval

`agent-memory` turns that into a structured repository memory system instead of a pile of static notes.

## Core Model

The system now has four persistent layers:

- `/.agent-memory/state.json`
  Current canonical memory bundle
- `/.agent-memory/history/events.jsonl`
  Append-only history of tool runs and imported sessions
- `/.agent-memory/history/checkpoints/`
  Bundle checkpoints written after `init`, `update`, and `recall`
- `/.agent-memory/sources.json`
  Registered external history sources
- `/.agent-memory/config.json`
  Recall defaults, policy, and backlog thresholds

Readable projections still live in:

- `docs/agent-memory/README.md`
- `docs/agent-memory/project-map.md`
- `docs/agent-memory/current-focus.md`
- `docs/agent-memory/gotchas.md`
- `docs/agent-memory/next-steps.md`

An entry block is also written into the preferred top-level entry file.

## How It Works

`agent-memory` no longer treats markdown files as the source of truth.

Instead, it:

1. collects repository context
2. builds or refreshes a canonical bundle
3. appends durable history events and checkpoints
4. projects the active bundle into repository docs
5. lets you consolidate history back into memory with `recall`
6. lets you ask memory questions with `query`
7. lets you inspect backlog and checkpoint drift with `status`
8. can run local automation for import-sync and recall with `automate`
9. can integrate chat clients and MCP tooling with `integrate`

If you need to control the runtime used for synthesis, use `--provider=auto|codex|claude`.

## Commands

### Bootstrap memory

```bash
npx agent-memory init
```

Creates a fresh canonical state, resets the history scaffold, writes the first checkpoint, and projects the bundle into docs.

### Refresh current memory

```bash
npx agent-memory update
```

Refreshes the active canonical bundle from current repository evidence and writes a new checkpoint plus tool-run event.

### Consolidate memory

```bash
npx agent-memory recall
```

Reads unrecalled history, proposes a consolidated bundle, shows summary changes and file diffs, and applies only after confirmation.
The preview also includes a grouped unrecalled history summary before apply.

If no unrecalled events produced durable changes, `recall` exits with a clear no-op message and does not write a checkpoint or tool-run event.

- `--section=...` to limit consolidation to part of the bundle
- `--policy=...` to apply policy presets such as imports-only or project-map protection
- `--show-diff` to expand from summary-first preview into file-level diffs

### Query memory

```bash
npx agent-memory query "how does caching work?"
```

Returns a short answer plus citations from bundle sections, history events, and checkpoints. Natural-language structured questions such as `what changed recently?`, `what should I do next?`, and `what are the known traps?` are supported through the same command.

If current memory cannot support a confident answer, `query` now returns an explicit evidence-insufficient response instead of bluffing.

For agent-facing automation you can request JSON output:

```bash
npx agent-memory query "what changed recently?" --output=json
```

Bundle citations can also be cross-linked to the generated projection docs under `docs/agent-memory/`.
Projects can override retrieval instructions per query mode through `.agent-memory/config.json`.

### Import external sessions

```bash
npx agent-memory import add claude-local ~/.claude --name claude
npx agent-memory import sync --all
```

Registers external history sources and normalizes imported sessions into durable history events.

`import sync` may partially succeed:

- imported sessions become history events
- duplicate sessions are skipped
- broken session files are reported as failures without aborting the whole source

Each source also records sync status, last imported count, and the last sync error when applicable.

### Inspect memory status

```bash
npx agent-memory status
```

Shows:

- state and latest checkpoint id
- unrecalled backlog counts plus a grouped summary of unrecalled history
- source sync health
- checkpoint drift summary
- the next suggested action

### Local automation daemon

```bash
npx agent-memory automate start
npx agent-memory automate status
npx agent-memory automate run-once
npx agent-memory automate stop
```

The first Phase 4 milestone is a local built-in automation daemon.

- it runs as a repo-local background process
- it can run `import sync --all` and `recall --yes` on a schedule
- it writes runtime state under `.agent-memory/automation/`
- it records the latest machine-readable run result in `.agent-memory/automation/latest-run.json`
- it uses aggressive auto-apply recall by default
- dirty worktrees do not block automation cycles in this first version

### Integrate Claude Code + Codex

```bash
npx agent-memory integrate
npx agent-memory integrate --dry-run
npx agent-memory integrate --status
npx agent-memory integrate --status --output=json
```

This command is separate from `init`.

- `init` stays repo-local and never edits global chat tooling config
- `integrate` writes Claude Code project files
- `integrate` also registers Codex MCP globally with a safe merge

Install UX notes:

- `--dry-run` previews project/user changes without writing files
- `--status` is read-only and summarizes Claude/Codex integration health
- `--status --output=json` returns machine-readable integration status
- `--dry-run` and `--status` never write project files or global Codex config
- normal `integrate` may write user-scope Codex config when Codex integration is selected

Generated/updated files include:

- `.mcp.json`
- `.claude/settings.json`
- `.claude/skills/agent-memory/SKILL.md`
- `AGENTS.md`
- `~/.codex/config.toml`

Claude Code integration uses project MCP + project skills + SessionStart and Stop hooks.
Codex integration uses MCP + `AGENTS.md` + the local daemon.

### MCP server

```bash
npx agent-memory mcp
```

This starts the local stdio MCP server used by Claude Code and Codex integrations.

### Ensure automation is running

```bash
npx agent-memory automate ensure-running
```

This is the lightweight startup command used by Claude Code `SessionStart` hooks and can also be called directly.

### Audit health

```bash
npx agent-memory validate
```

Audits state integrity, history continuity, checkpoint presence, projection alignment, entry wiring, and recall backlog health.

## Troubleshooting

Common cases:

- `import sync` reports `failed=...`
  The source is still registered, but one or more session files could not be parsed or normalized. Run `agent-memory validate` to see whether this is now a warning condition.
- `recall` says `Nothing to recall`
  Either there are no unrecalled events for the selected scope, or consolidation produced no durable bundle changes.
- `status` suggests `recall`
  The backlog is above the configured threshold or the checkpoint drift summary suggests stale active memory.
- `query` says there is not enough evidence
  The current bundle, history, and checkpoints do not support a confident answer yet. Import more history or run `recall` before asking again.
- `validate` warns about recall backlog
  New history has accumulated and should be consolidated with `agent-memory recall`.

## Breaking Change

This is a destructive model change.

- old `state.json` formats are not supported
- old projection markers are not supported
- there is no migration path
- old repositories must rerun `npx agent-memory init`

## Learn More

- [Overview](./docs/overview.md)
- [Commands](./docs/commands.md)
- [File Model](./docs/file-model.md)
- [V1 Boundary And Roadmap](./docs/roadmap.md)
- [Adoption Guide](./docs/adoption.md)
- [Contributing](./CONTRIBUTING.md)

## License

MIT
