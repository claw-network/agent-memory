# Overview

`agent-memory` is a repository memory system for developers and coding agents.

The current model is no longer just “generate some markdown.” It has three active jobs:

- capture durable memory state
- maintain that memory through history and recall
- retrieve that memory through query

## The Model

The system has four persistent pieces:

- `state.json`
  The current canonical bundle
- `history/events.jsonl`
  Append-only memory inputs from tool runs and imported sessions
- `history/checkpoints/`
  Snapshots of canonical bundles after meaningful writes
- `sources.json`
  The registry of external history inputs
- `config.json`
  The project-level recall defaults and policy surface

`docs/agent-memory/*.md` remains the readable projection layer, but it is no longer the source of truth.

## Why This Matters

The first version of `agent-memory` solved initialization. It did not solve long-term memory maintenance.

Over time, real projects need more than one good snapshot. They need a loop:

1. capture new signals
2. keep history
3. consolidate what matters
4. retrieve it later
5. audit drift and backlog

That is the purpose of the current architecture.

## Command Semantics

- `init`
  Destructive bootstrap into the current schema
- `update`
  Refresh the active bundle from current repository evidence
- `recall`
  Consolidate unrecalled history into the active bundle
- `status`
  Inspect backlog, source health, and checkpoint drift before acting
- `query`
  Answer a question from bundle, history, and checkpoints
- `import`
  Bring external sessions into the history layer
- `validate`
  Audit the whole system, not just the current bundle

## Design Principles

- canonical state first
- append-only history
- readable projections
- deliberate consolidation instead of silent drift
- configurable recall with explicit operator control
- retrieval with citations, not opaque answers
- explicit breaking changes over partial compatibility hacks

## Compatibility

This schema is intentionally breaking.

Old repositories should not be migrated in place. Re-run:

```bash
npx agent-memory init
```

to rebuild into the current system.

## Related Pages

- [Commands](./commands.md)
- [File Model](./file-model.md)
- [Phase 2 Recall Rules](./phase2-recall-rules.md)
- [Phase 2 Dedupe Rules](./phase2-dedupe-rules.md)
- [Phase 2 Status Rules](./phase2-status-rules.md)
- [Phase 2 Exit Criteria](./phase2-exit-criteria.md)
- [V1 Boundary And Roadmap](./roadmap.md)
- [Adoption Guide](./adoption.md)
