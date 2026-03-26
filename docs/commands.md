# Commands

`agent-memory` currently exposes three commands:

- `init`
- `update`
- `validate`

They are intentionally separate because they do different jobs.

## `agent-memory init`

```bash
npx agent-memory init
```

Use `init` when a repository does not yet have project memory.

What it does:

- scans the project structure
- creates `docs/agent-memory/`
- writes the five initial memory files
- injects a Project Memory section into the highest-priority entry file
- optionally runs common validation commands and writes their summary into `current-focus.md`

Use it when:

- starting memory in a new project
- introducing the model to an existing repository for the first time

## `agent-memory update`

```bash
npx agent-memory update
```

Use `update` when project memory already exists and needs to be refreshed.

What it does:

- rescans the project
- refreshes tool-managed memory files
- repairs missing memory files or missing entry wiring
- preserves unmanaged or legacy files and writes generated backups for manual merge
- optionally refreshes the validation baseline in `current-focus.md`

Use it when:

- structure changed
- command semantics changed
- a new current snapshot should replace the old one
- a managed memory repo needs routine maintenance

## `agent-memory validate`

```bash
npx agent-memory validate
```

Use `validate` when you want a read-only audit of memory health.

What it checks:

- memory directory presence
- managed markers on all memory files
- entry snippet wiring
- `current-focus.md` metadata and validation freshness

What it does not do:

- it does not write files
- it does not repair problems
- it does not rerun project build or test commands

Use it when:

- enforcing memory quality in CI
- checking whether a repo is still in a healthy memory state
- confirming that `current-focus.md` still reflects a recent validation baseline

## Mental Model

- `init` = connect
- `update` = refresh
- `validate` = audit
