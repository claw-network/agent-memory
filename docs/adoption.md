# Adoption Guide

This guide is for teams adopting the new canonical-state `agent-memory` model in an existing repository.

## First Run

Install the package and run:

```bash
npm install -D @agent-connect/memory
npx agent-memory init
```

This will:

- build the first canonical memory bundle
- create `/.agent-memory/state.json`
- rewrite `docs/agent-memory/*.md`
- insert or replace the top-level project memory block

## Runtime Control

If you want to force a specific runtime for the analysis pass:

```bash
npx agent-memory init --provider=claude
```

## Recommended Team Workflow

1. Run `init` once to establish the canonical bundle.
2. Read `docs/agent-memory/project-map.md` and `docs/agent-memory/current-focus.md`.
3. Use `update` after structural or workflow changes.
4. Use `update --validate` when you want a fresh validation baseline in the canonical state.
5. Use `validate` in CI or routine checks.

## What To Review After `init`

Even though the bundle is generated from a repository analysis pass, it is still worth reviewing:

- project summary quality
- module responsibilities
- entrypoint descriptions
- gotchas that should be kept or removed
- next steps that feel too vague for your team

The goal is not to preserve every generated sentence forever. The goal is to keep one trustworthy canonical memory bundle that can be refreshed when reality changes.

## When This Model Works Best

`agent-memory` is especially useful when:

- the repository is long-lived
- onboarding is expensive
- contributors rotate often
- coding agents are part of daily engineering work
- “just read the code” is too slow to recover context

## Package Name vs Command Name

The npm package is:

```text
@agent-connect/memory
```

The installed command remains:

```bash
agent-memory
```
