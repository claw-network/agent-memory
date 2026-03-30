# Commands

`agent-memory` exposes these command surfaces:

- `init`
- `update`
- `recall`
- `query`
- `add`
- `sync`
- `automate`
- `integrate`
- `mcp`
- `validate`
- `status`

Install the package first:

```bash
npm install -D @agent-connect/memory
```

or:

```bash
pnpm add -D @agent-connect/memory
```

Then run the local CLI with `npx agent-memory ...`.

## Runtime Control

Commands that synthesize or normalize memory accept:

```bash
--provider=auto|codex|claude
```

This applies to:

- `init`
- `update`
- `recall`
- `query`
- `sync`

Recall-oriented commands also read defaults from `/.agent-memory/config.json`.

## `agent-memory init`

```bash
npx agent-memory init
```

Use `init` to rebuild a repository into the current schema.

What it does:

- clears and rebuilds `/.agent-memory/`
- writes a fresh canonical bundle
- writes the first history event
- writes the first checkpoint
- rewrites projections and entry wiring

Optional validation:

```bash
npx agent-memory init --yes --validate
```

## `agent-memory update`

```bash
npx agent-memory update
```

Use `update` to refresh the active canonical bundle from current repository evidence.

What it does:

- reads the current canonical state
- re-synthesizes the active bundle
- writes a new tool-run event
- writes a new checkpoint
- rewrites projections and entry wiring

This command only supports the current schema. Old states must be replaced with `init`.

## `agent-memory recall`

```bash
npx agent-memory recall
```

Use `recall` to consolidate unrecalled history into the active canonical bundle.

What it does:

- reads unrecalled history events
- proposes a consolidated bundle
- previews grouped unrecalled history summary before apply
- prints summary changes and file diffs
- applies only after confirmation, unless `--yes` is passed

If there are no unrecalled events, or if consolidation produces no durable changes, `recall` exits without writing state, checkpoints, or tool-run events.

Optional source filter:

```bash
npx agent-memory recall --source=imports
npx agent-memory recall --section=gotchas
npx agent-memory recall --policy=project-map-protected
npx agent-memory recall --show-diff
npx agent-memory recall --checkpoint chk-000001
```

## `agent-memory query`

```bash
npx agent-memory query "how does caching work?"
```

Use `query` to retrieve an answer from the memory system.

What it does:

- builds a shortlist from bundle, history, and checkpoints
- detects natural-language retrieval modes such as changes, next actions, and traps
- synthesizes a short answer
- returns citations for each claim, with bundle citations cross-linked to projection docs when applicable

Optional scope:

```bash
npx agent-memory query "what changed recently?" --scope=history
```

Optional output:

```bash
npx agent-memory query "what should I do next?" --output=json
```

Projects can also override mode-specific retrieval instructions through `.agent-memory/config.json`.

## `agent-memory add`

### Add a source

```bash
npx agent-memory add claude-local ~/.claude --name claude
```

Use `add` to register an external session source.

## `agent-memory sync`

### Sync one source or all sources

```bash
npx agent-memory sync claude
npx agent-memory sync --all
```

Current built-in source types:

- `claude-local`
- `codex-local`

`sync` normalizes external sessions into standard history events. It does not directly rewrite the active bundle; use `recall` for that.

`sync` is resilient to partial failures:

- valid sessions are imported
- duplicates are skipped
- malformed sessions are reported as failed items
- the source keeps a sync status that `validate` can later inspect

## `agent-memory automate`

### Start the local daemon

```bash
npx agent-memory automate start
```

### Stop the local daemon

```bash
npx agent-memory automate stop
```

### Inspect daemon status

```bash
npx agent-memory automate status
```

### Run one automation cycle without daemonizing

```bash
npx agent-memory automate run-once
```

### Ensure the daemon is running

```bash
npx agent-memory automate ensure-running
```

First milestone behavior:

- the daemon is local and built in, not cron-backed
- each cycle can run `sync --all`
- each cycle can auto-apply `recall`
- each cycle also evaluates retention and can archive aged history/checkpoints
- dirty worktrees do not block the cycle
- runtime metadata lives in `.agent-memory/automation/`
- the latest machine-readable run result lives in `.agent-memory/automation/latest-run.json`
- archive batches live in `.agent-memory/archive/`
- retention is enabled by default, but archived data no longer participates in active query/recall/status baselines

## `agent-memory integrate`

### Integrate everything

```bash
npx agent-memory integrate
```

### Preview changes without writing

```bash
npx agent-memory integrate --dry-run
```

### Inspect integration status

```bash
npx agent-memory integrate --status
npx agent-memory integrate --status --output=json
```

### Repair only managed mismatches

```bash
npx agent-memory integrate --repair
npx agent-memory integrate claude --repair --dry-run
```

### Integrate only Claude Code

```bash
npx agent-memory integrate claude
```

### Integrate only Codex

```bash
npx agent-memory integrate codex
```

First milestone behavior:

- `init` does not touch any chat-client config
- Claude Code integration is project-scoped
- Codex MCP registration is global but merged safely
- Claude Code uses project MCP + project skills + `SessionStart` / `Stop` hooks
- Codex uses MCP + `AGENTS.md` + the local daemon
- Claude and Codex guidance now prefer `memory_assess`, `memory_compact_handoff`, and `memory_maintain` before lower-level MCP tools
- `--dry-run` is read-only and does not write project or user files
- `--status` is read-only and reports current integration health
- `--status --output=json` returns machine-readable integration status
- `--repair` only rewrites managed mismatches and does not create missing components
- normal `integrate` may modify user-scope Codex config

Generated or updated files:

- `.mcp.json`
- `.claude/settings.json`
- `.claude/skills/agent-memory/SKILL.md`
- `AGENTS.md`
- `~/.codex/config.toml`

## `agent-memory mcp`

```bash
npx agent-memory mcp
npx agent-memory mcp --transport=http --port=8765
```

Starts the local MCP server for chat-client integrations.

- stdio is the default transport
- HTTP transport is available with `--transport=http --port=<port>`
- HTTP mode also supports `--host` and `--allowed-hosts`

Primary workflow tools:

- `memory_assess`
  Assess memory, automation, validation, and integration health in one response
- `memory_compact_handoff`
  Produce a compact-ready handoff summary before session end
- `memory_maintain`
  Ensure the daemon is running and perform one maintenance pass

Lower-level tools remain available for finer control:

- `memory_query`
- `memory_status`
- `memory_validate`
- `automation_status`
- `automation_ensure_running`
- `automation_run_once`

Tool calls return human-readable text content plus versioned `structuredContent` envelopes.
Long-running tools such as `memory_maintain`, `memory_query`, and `memory_validate` also emit progress notifications when the client supplies a progress token.

## `agent-memory status`

```bash
npx agent-memory status
```

Use `status` before `recall` when you want a maintenance-oriented readout.

It shows:

- current state and latest checkpoint id
- unrecalled backlog counts plus a grouped summary of unrecalled history
- source sync health
- checkpoint drift summary
- retention prune candidates and archive summary
- the next suggested action

Optional flags:

```bash
npx agent-memory status --checkpoint chk-000001 --show-diff
```

## `agent-memory validate`

```bash
npx agent-memory validate
```

This is a read-only audit.

It checks:

- current `state.json` schema and bundle hash
- history event readability and continuity
- checkpoint presence and latest checkpoint consistency
- source registry validity
- projection marker alignment
- entry block alignment
- referenced path existence
- validation baseline freshness
- recall backlog health
- recall configuration validity
- retention configuration validity
- archive manifest and batch integrity

Important interpretation:

- `fail` means the canonical system is structurally unhealthy
- `warn` means the system is still usable, but maintenance is recommended

## Mental Model

- `init` = bootstrap
- `update` = refresh active memory
- `recall` = consolidate history
- `query` = retrieve memory
- `automate` = run local automation for import-sync and recall
- `integrate` = connect Claude Code and Codex to agent-memory
- `mcp` = expose agent-memory as a local MCP server
- `add` = add external session sources
- `sync` = sync external session sources into history events
- `validate` = audit the system
- `status` = inspect maintenance state before acting
