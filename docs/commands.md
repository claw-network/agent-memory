# Commands

`agent-memory` exposes six command surfaces:

- `init`
- `update`
- `recall`
- `query`
- `import`
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
- `import sync`

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
- prints summary changes and file diffs
- applies only after confirmation, unless `--yes` is passed

If there are no unrecalled events, or if consolidation produces no durable changes, `recall` exits without writing state, checkpoints, or tool-run events.

Optional source filter:

```bash
npx agent-memory recall --source=imports
```

Phase 2 adds:

```bash
npx agent-memory recall --section=gotchas
npx agent-memory recall --policy=project-map-protected
npx agent-memory recall --show-diff
npx agent-memory recall --checkpoint chk-000001
```

For the full behavioral contract, see [Phase 2 Recall Rules](./phase2-recall-rules.md).

## `agent-memory query`

```bash
npx agent-memory query "how does caching work?"
```

Use `query` to retrieve an answer from the memory system.

What it does:

- builds a shortlist from bundle, history, and checkpoints
- synthesizes a short answer
- returns citations for each claim

Optional scope:

```bash
npx agent-memory query "what changed recently?" --scope=history
```

## `agent-memory import`

### Add a source

```bash
npx agent-memory import add claude-local ~/.claude --name claude
```

### Sync one source or all sources

```bash
npx agent-memory import sync claude
npx agent-memory import sync --all
```

### List registered sources

```bash
npx agent-memory import list
```

Current built-in source types:

- `claude-local`
- `codex-local`

`import sync` normalizes external sessions into standard history events. It does not directly rewrite the active bundle; use `recall` for that.

`import sync` is resilient to partial failures:

- valid sessions are imported
- duplicates are skipped
- malformed sessions are reported as failed items
- the source keeps a sync status that `validate` can later inspect

## `agent-memory status`

```bash
npx agent-memory status
```

Use `status` before `recall` when you want a maintenance-oriented readout.

It shows:

- current state and latest checkpoint id
- unrecalled backlog counts
- source sync health
- checkpoint drift summary
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

Important interpretation:

- `fail` means the canonical system is structurally unhealthy
- `warn` means the system is still usable, but maintenance is recommended

## Mental Model

- `init` = bootstrap
- `update` = refresh active memory
- `recall` = consolidate history
- `query` = retrieve memory
- `import` = ingest external sessions
- `validate` = audit the system
- `status` = inspect maintenance state before acting
