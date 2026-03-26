# agent-memory

[![npm version](https://img.shields.io/npm/v/agent-memory)](https://www.npmjs.com/package/agent-memory)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![node >=18](https://img.shields.io/badge/node-%3E%3D18-417e38)](./package.json)

Durable project memory for developers and coding agents.

`agent-memory` gives a repository a lightweight memory layer that survives across handoffs, chats, PRs, and debugging sessions. It helps teams keep stable project structure, current status, expensive gotchas, and next working steps in one place that both humans and agents can reuse.

```bash
npx agent-memory init
```

## Why This Exists

Most projects lose context in the same way:

- README files explain the product, but not the current engineering reality.
- Issue threads and PRs contain decisions, but they are noisy and fragmented.
- Chat history is useful in the moment, but weak as a long-term system of record.
- Coding agents can move quickly, but only when a repository exposes stable, low-noise context.

`agent-memory` is designed for that gap. It does not try to replace your docs stack. It adds a small, explicit memory layer for the context that teams repeatedly need but rarely maintain well.

## Core Model

`agent-memory` initializes a `docs/agent-memory/` directory with five files, each with a single job:

- `README.md`
  Explains how the memory system works and how to maintain it.
- `project-map.md`
  Captures stable structure, module boundaries, and key entrypoints.
- `current-focus.md`
  Holds the current single-snapshot status, including the latest validation baseline.
- `gotchas.md`
  Stores high-cost traps, noisy failures, and subtle boundaries.
- `next-steps.md`
  Gives the next contributor a practical starting point.

This is not a generic template dump. It is a role-based memory model: stable map, current state, costly lessons, and immediate action.

## Quickstart

### 1. Initialize project memory

```bash
npx agent-memory init
```

Bootstraps `docs/agent-memory/` and wires a Project Memory entry section into the highest-priority entry file it can find.

### 2. Refresh managed memory

```bash
npx agent-memory update
```

Refreshes managed memory files, repairs missing pieces, and keeps legacy unmanaged files safe by writing generated backups instead of overwriting them.

### 3. Audit memory health

```bash
npx agent-memory validate
```

Runs a read-only audit of memory presence, managed ownership, entry integration, and `current-focus` validation freshness.

## How It Works

- Static scan first
  The tool inspects repo structure, manifests, entry files, scripts, and source layout before generating memory.
- Conservative merge strategy
  Missing files are created, but unmanaged files are preserved and get `.generated.bak.*` outputs for manual merge.
- Managed ownership markers
  Tool-managed files are explicitly marked so `update` can refresh only what it safely owns.
- Validation baseline tracking
  `current-focus.md` records machine-readable metadata so `validate` can check whether the latest baseline exists and is still fresh.

## Learn More

- [Overview](./docs/overview.md)
- [Commands](./docs/commands.md)
- [File Model](./docs/file-model.md)
- [Adoption Guide](./docs/adoption.md)
- [Contributing](./CONTRIBUTING.md)

## Command Summary

| Command | Purpose |
| --- | --- |
| `agent-memory init` | Bootstrap project memory and initial entry wiring |
| `agent-memory update` | Refresh managed memory and repair missing pieces |
| `agent-memory validate` | Audit memory health and validation baseline freshness |

## Who It Is For

`agent-memory` is for repositories where context loss is expensive:

- long-lived product codebases
- multi-package repos
- teams with frequent handoffs
- projects using coding agents in day-to-day development
- maintainers who want a lighter alternative to sprawling internal docs

It is designed for developers and agents equally. Humans get faster onboarding and less re-discovery. Agents get a stable context layer that reduces noisy exploration.

## Roadmap

Current direction:

- strengthen the memory model and command ergonomics
- improve adoption guidance for existing repositories
- add a future `doctor` command for deeper advice beyond strict validation

## License

MIT
