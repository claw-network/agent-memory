# agent-memory

Bootstrap durable project memory for developers and coding agents.

```bash
npx agent-memory init
```

```bash
npx agent-memory update
```

`agent-memory` creates a `docs/agent-memory/` directory in your project and wires in a lightweight entry section so future collaborators know where to look first.

## What it generates

- `docs/agent-memory/README.md`
- `docs/agent-memory/project-map.md`
- `docs/agent-memory/current-focus.md`
- `docs/agent-memory/gotchas.md`
- `docs/agent-memory/next-steps.md`

It also adds a small "Project Memory" section to the highest-priority entry file it can find:

1. `AGENTS.md`
2. `CLAUDE.md`
3. `README.md`

If none exist, it creates a minimal `AGENTS.md`.

## Product defaults

- English templates by default
- Strong static auto-generation
- Conservative merge behavior
- Validation commands are optional and **not** run by default
- Interactive init shows a dry summary before writing files

## Usage

### Standard

```bash
npx agent-memory init
npx agent-memory update
```

### Non-interactive

```bash
npx agent-memory init --yes
```

This accepts the write plan automatically and skips optional validation commands.

```bash
npx agent-memory update --yes
```

## Merge behavior

- Missing memory files are created
- Managed memory files are refreshed in place
- Legacy or unmanaged memory files are preserved
- A generated `.generated.bak.*` file is written when content already exists
- Existing entry snippets are not duplicated
- `update` can repair missing memory files and missing entry snippets

## Managed files

Generated memory files now include a small marker comment such as:

```md
<!-- agent-memory:file=project-map version=1 managed=true -->
```

`agent-memory update` only rewrites files that carry a matching managed marker. Older or manually maintained files are preserved and get a generated backup instead.

## Validation behavior

During interactive setup, `agent-memory` can optionally run common validation commands and summarize the outcome in `current-focus.md`.

Examples:

- `pnpm build`
- `pnpm test`
- `npm run build`
- `npm test`
- `pytest`
- `cargo test`
- `go test ./...`

## Development

```bash
npm install
npm run build
node dist/cli.js init --yes
node dist/cli.js update --yes
npm pack
npx --yes --package=./agent-memory-0.1.0.tgz agent-memory init --yes
npx --yes --package=./agent-memory-0.1.0.tgz agent-memory update --yes
```

## Planned commands

These are intentionally not part of v1 yet:

- `agent-memory doctor`
- `agent-memory validate`
