# Contributing

Thanks for contributing to `agent-memory`.

## Local Development

```bash
npm ci
npm run build
npm run test
```

Useful local smoke tests:

```bash
npm run smoke:consumer
npm run smoke:real-provider
node dist/cli.js init --yes
node dist/cli.js status
node dist/cli.js query "what should I do next?"
node dist/cli.js integrate --status
node dist/cli.js integrate --dry-run
```

Package-level smoke test:

```bash
npm run pack:dry-run
```

For command flows that rely on Codex or Claude, `agent-memory` now probes provider availability before the command does deeper work. If a provider is missing or not authenticated, fix that first rather than debugging the later command output.

## Published Package Usage

The public npm package is `@agent-connect/memory`, while the CLI command remains `agent-memory`.

Typical consumer workflow:

```bash
npm install -D @agent-connect/memory
npx agent-memory init
npx agent-memory status
npx agent-memory query "what should I do next?"
npx agent-memory integrate --status
npx agent-memory integrate --dry-run
npx agent-memory mcp
```

## Project Expectations

- Keep the tool small and explicit.
- Prefer conservative behavior over surprising automation.
- Treat human-edited project memory as higher priority than generated convenience.
- Keep README and docs aligned whenever command behavior changes.

## Pull Request Guidance

Good changes usually include at least one of these:

- clearer command behavior
- safer ownership and merge rules
- better generated memory quality
- better documentation for adoption and maintenance

If a change affects `init`, `update`, or `validate`, include the relevant CLI smoke test in your local verification notes.
