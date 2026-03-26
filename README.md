# agent-memory

[![npm version](https://img.shields.io/npm/v/%40agent-connect%2Fmemory)](https://www.npmjs.com/package/@agent-connect/memory)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![node >=18](https://img.shields.io/badge/node-%3E%3D18-417e38)](./package.json)

Canonical project memory for developers and coding agents.

`agent-memory` builds repository memory in two layers:

- it generates a canonical memory bundle in `/.agent-memory/state.json`
- it projects that bundle into `docs/agent-memory/` as readable repository docs

## Installation

```bash
npm install -D @agent-connect/memory
```

```bash
pnpm add -D @agent-connect/memory
```

Once installed, run the local CLI with `npx agent-memory ...`.

## How It Works

`agent-memory` does not treat markdown files as the source of truth.

Instead, it:

1. collects repository context
2. synthesizes a structured memory bundle
3. stores that bundle in `/.agent-memory/state.json`
4. rewrites `docs/agent-memory/*.md` as projections of that state
5. writes an entry block into the preferred top-level entry file

If you need to control which runtime executes the analysis pass, use `--provider=auto|codex|claude`.

## Core Model

The canonical source of truth is:

- `/.agent-memory/state.json`

Readable projections live in:

- `docs/agent-memory/README.md`
- `docs/agent-memory/project-map.md`
- `docs/agent-memory/current-focus.md`
- `docs/agent-memory/gotchas.md`
- `docs/agent-memory/next-steps.md`

An entry block is also written into the preferred top-level entry file, using this order:

1. `AGENTS.md`
2. `CLAUDE.md`
3. `README.md`
4. fallback create `AGENTS.md`

## Commands

### Initialize canonical memory

```bash
npx agent-memory init
```

This command:

- collects fresh repository context
- rebuilds the canonical memory bundle
- creates or replaces `/.agent-memory/state.json`
- rewrites `docs/agent-memory/*.md`
- inserts or replaces the project memory entry block

Run with validation:

```bash
npx agent-memory init --yes --validate
```

### Refresh canonical memory

```bash
npx agent-memory update
```

This command requires an existing `/.agent-memory/state.json`. It combines the previous canonical bundle with fresh repository context, then rewrites canonical state and projections.

Run with validation:

```bash
npx agent-memory update --yes --validate
```

### Audit memory health

```bash
npx agent-memory validate
```

This audits:

- `/.agent-memory/state.json` existence and schema
- state bundle hash integrity
- projection markers and hash alignment
- entry block presence and hash alignment
- referenced bundle paths
- validation baseline freshness

## Why This Exists

Most repositories still lose high-value engineering context:

- architecture is scattered across manifests, folders, and partial docs
- current state lives in chats, PRs, and short-lived notes
- costly gotchas are rediscovered repeatedly
- coding agents work best when a repo exposes stable, low-noise context

`agent-memory` turns that into a small canonical bundle that can be regenerated, audited, and projected back into repo-native docs.

## Design Principles

- canonical machine-readable state first
- readable projections second
- repository-grounded synthesis instead of static template guessing
- versioned markers and hash-based validation
- short, durable docs over sprawling internal wikis

## Learn More

- [Overview](./docs/overview.md)
- [Commands](./docs/commands.md)
- [File Model](./docs/file-model.md)
- [Adoption Guide](./docs/adoption.md)
- [Contributing](./CONTRIBUTING.md)

## License

MIT
