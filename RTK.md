# Runtime Toolkit

## Local Baseline

Use the repository with the npm baseline:

```bash
npm ci
npm run build
npm run test
```

## Main Smoke Path

These are the default commands to trust first:

```bash
npx agent-memory init
npx agent-memory status
npx agent-memory query "what should I do next?"
npx agent-memory integrate --status
npx agent-memory integrate --dry-run
npx agent-memory mcp
```

## Additional Verification

Use these when you are validating packaging or provider integration:

```bash
npm run smoke:consumer
npm run pack:dry-run
npm run smoke:real-provider
```

`dogfood:*` remains available as a deeper canary path, but it is secondary to the main build/test/consumer-smoke baseline.
