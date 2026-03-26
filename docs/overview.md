# Overview

`agent-memory` is a repository-level memory layer for developers and coding agents, but its source of truth is no longer a set of hand-managed markdown files.

The new model is:

- repository context is gathered into one analysis pass
- that analysis produces a structured memory bundle
- `agent-memory` stores that bundle in `/.agent-memory/state.json`
- readable markdown files in `docs/agent-memory/` are projected from that canonical state

## Why This Shift Matters

The old static-template approach was cheap, but too shallow for real projects. It could identify manifests and source folders, yet it could not reliably explain:

- what modules are actually for
- which entrypoints matter most
- what the current operating picture is
- which gotchas are truly expensive
- what the next contributor should do first

The new architecture keeps local determinism where it matters, but moves the hard part into bundle synthesis: turning repository evidence into trustworthy project memory.

## The Model

The system now has two layers:

### Canonical layer

- `/.agent-memory/state.json`

This is the machine-readable source of truth. It contains:

- schema and generator version
- execution metadata
- generation timestamp
- `bundleHash`
- the full structured bundle

### Projection layer

- `docs/agent-memory/README.md`
- `docs/agent-memory/project-map.md`
- `docs/agent-memory/current-focus.md`
- `docs/agent-memory/gotchas.md`
- `docs/agent-memory/next-steps.md`

These are generated projections of the canonical state. They are optimized for quick reading and reuse, while `validate` can still audit them through versioned hash markers.

## Command Semantics

- `init` creates or replaces canonical state
- `update` refreshes canonical state from existing state plus fresh repo context
- `validate` audits canonical state and projection alignment

This means the repo always has one authoritative bundle, not several partially managed files pretending to be authoritative.

## Design Principles

- canonical state first
- projections are disposable and reproducible
- repository-grounded analysis over static guessing
- hash-based validation over marker ownership heuristics
- short, durable outputs over sprawling generated prose

## Compatibility

This model is intentionally breaking.

Legacy repositories using the previous managed-marker approach should rerun:

```bash
npx agent-memory init
```

to enter the canonical-state system.

## Related Pages

- [Commands](./commands.md)
- [File Model](./file-model.md)
- [Adoption Guide](./adoption.md)
