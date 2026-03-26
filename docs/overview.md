# Overview

`agent-memory` is a repository-level memory layer for developers and coding agents.

It exists because most projects already have documentation, but still lack durable engineering context:

- structure is scattered across manifests, source trees, and partial READMEs
- current status lives in chats, PRs, and temporary notes
- costly lessons are remembered by people, not by the repository
- next steps are often obvious only to whoever touched the code most recently

`agent-memory` addresses that gap with a small memory model that is easy to initialize, safe to refresh, and explicit enough for automation.

## The Model

The model separates context by job, not by author:

- `project-map.md`
  Stable structure and architecture
- `current-focus.md`
  Current single-snapshot status
- `gotchas.md`
  Expensive traps and noisy failures
- `next-steps.md`
  Clean entrypoints for the next contributor
- memory `README.md`
  Maintenance rules and scope boundary

This separation matters because long-lived projects need both:

- stable context that changes slowly
- operational context that changes often

Putting both into one file usually creates noise. Splitting them makes maintenance lighter and reuse easier.

## Why It Works For Humans And Agents

Developers benefit because the repository becomes easier to re-enter after time away.

Coding agents benefit because they can ground themselves in a low-noise context layer before exploring code or asking follow-up questions.

The result is not “AI-specific documentation.” It is a collaboration structure that improves continuity for everyone touching the repo.

## Design Principles

- small, durable surface area
- conservative updates
- explicit tool ownership
- readable by humans first, but machine-auditable where needed
- current state as a snapshot, not a running changelog

## Related Pages

- [Commands](./commands.md)
- [File Model](./file-model.md)
- [Adoption Guide](./adoption.md)
