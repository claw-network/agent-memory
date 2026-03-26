# Contributing

Thanks for contributing to `agent-memory`.

## Local Development

```bash
npm install
npm run build
```

Useful local smoke tests:

```bash
node dist/cli.js init --yes
node dist/cli.js init --yes --validate
node dist/cli.js update --yes
node dist/cli.js update --yes --validate
node dist/cli.js validate
```

Package-level smoke test:

```bash
npm pack
```

## Published Package Usage

The public npm package is `@agent-connect/memory`, while the CLI command remains `agent-memory`.

Typical consumer workflow:

```bash
npm install -D @agent-connect/memory
npx agent-memory init
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
