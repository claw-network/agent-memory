# Commands

`agent-memory` exposes three commands:

- `init`
- `update`
- `validate`

Install the package first:

```bash
npm install -D @agent-connect/memory
```

or:

```bash
pnpm add -D @agent-connect/memory
```

Then run the local CLI with `npx agent-memory ...`.

## Execution Notes

`init` and `update` both run a repository analysis pass and then rewrite the canonical state plus all projections.

If you need to control the runtime used for that analysis pass, override it with:

```bash
npx agent-memory init --provider=codex
```

If the selected runtime is unavailable, the command fails.

## `agent-memory init`

```bash
npx agent-memory init
```

Use `init` when a repository does not yet have canonical memory state, or when you want to rebuild it into the new model.

What it does:

- gathers repository context
- builds a fresh canonical bundle
- creates or replaces `/.agent-memory/state.json`
- rewrites `docs/agent-memory/*.md`
- inserts or replaces the project memory entry block

Non-interactive run with validation:

```bash
npx agent-memory init --yes --validate
```

Use `--validate` when you want the analysis flow to recommend validation commands, run up to two of them, and fold the real results into the final bundle.

## `agent-memory update`

```bash
npx agent-memory update
```

Use `update` when canonical state already exists and the repo has changed.

What it does:

- loads the previous canonical bundle from `/.agent-memory/state.json`
- rescans the repository
- rebuilds the bundle from both old state and fresh repo context
- rewrites canonical state and all projections

Non-interactive run with validation:

```bash
npx agent-memory update --yes --validate
```

Important behavior:

- `update` does not support the legacy static/managed-marker model
- if `/.agent-memory/state.json` is missing, `update` fails and tells you to run `init`

## `agent-memory validate`

```bash
npx agent-memory validate
```

This is a read-only audit.

It checks:

- `/.agent-memory/state.json` exists
- state JSON matches the canonical schema
- `bundleHash` matches the stored bundle
- projected markdown files exist and carry the current hash marker
- the entry block exists and carries the current hash marker
- bundle-referenced paths still exist
- the validation baseline is present and fresh

It does not:

- regenerate the bundle
- rerun repository analysis
- rewrite files

## Mental Model

- `init` = create canonical state
- `update` = refresh canonical state
- `validate` = audit canonical state and projections
