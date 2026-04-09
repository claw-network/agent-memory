# Adoption Guide

This guide is for teams adopting the current `agent-memory` system in an existing repository.

## First Run

Install the package and run:

```bash
npm install -D @agent-connect/memory
npx agent-memory init
```

This will:

- rebuild `/.agent-memory/`
- create the first canonical state
- create the first history event
- create the first checkpoint
- rewrite `docs/agent-memory/*.md`
- insert or replace the top-level project memory block

## Important Breaking Change

This version is intentionally destructive.

- there is no migration path
- old `state.json` files are not reused
- old projection markers are not reused
- existing repositories must rerun `npx agent-memory init`

Treat adoption as a rebuild:

```bash
npx agent-memory init
```

## Recommended Workflow

1. Run `init` once.
2. Use `status` to inspect memory health, backlog, and drift before changing anything.
3. Use `query` when you need an answer from memory instead of reading all artifacts manually.
4. Use `integrate --status` and `integrate --dry-run` to inspect client wiring safely.
5. Use `mcp` when you are ready to expose the local MCP surface to Claude Code or Codex.
6. Use `update` when current repository reality changes.
7. Use `add` and `sync` to ingest external sessions.
8. Use `recall` to consolidate history into active memory.
9. Use `validate` to audit integrity and backlog health.

`automate`, workflow-first MCP tools, and self-host dogfood remain available, but they are advanced paths rather than the default first-run path.

## When To Use `recall`

Run `recall` when:

- imported sessions have accumulated
- next steps feel stale
- gotchas are repetitive
- `validate` warns about recall backlog
- `sync` completed but reported partial failures and you want to consolidate what was still imported

## When To Use `query`

Run `query` when:

- you want a quick answer with citations
- the information may live in history rather than just the current bundle
- you want to inspect memory before deciding whether to run `recall`
- you want to sanity-check whether memory has enough evidence before relying on it

## Runtime Control

If you want to force a specific runtime for synthesis or retrieval:

```bash
npx agent-memory recall --provider=claude
```

## Package Name vs Command Name

The npm package is:

```text
@agent-connect/memory
```

The installed command remains:

```bash
agent-memory
```
