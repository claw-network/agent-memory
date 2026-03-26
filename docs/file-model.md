# File Model

`agent-memory` uses a fixed five-file model so each piece of context has a clear home.

Inside those files, repeated high-value records are written as small memory units with stable field labels. The files define the category. The units define the smallest reusable record.

## `README.md`

This file explains how the memory system works inside the target repository.

It should answer:

- what belongs in the memory folder
- how often it should be refreshed
- what should stay out of it

## `project-map.md`

This is the stable structural map.

It should capture:

- top-level modules or packages
- key entrypoints
- main architectural boundaries
- the first files a newcomer should read

It should not become a changelog.

## `current-focus.md`

This is the current single-snapshot operational state.

It should capture:

- the latest known repository state
- the latest verification summary
- current blockers or follow-ups

It is intentionally not historical. When the state changes, this file should be refreshed, not appended forever.

Recommended unit shape for follow-ups:

- `Why:` why this follow-up matters now
- `Start:` the cleanest next move
- `Done when:` the condition that closes the follow-up

## `gotchas.md`

This file is for traps that are expensive to rediscover.

Good entries are:

- noisy build failures with non-obvious causes
- import or runtime boundary traps
- environment assumptions that are easy to miss
- workflow mismatches that look like bugs

Each entry should stay short and high-signal.

Recommended unit shape for confirmed gotchas:

- `Symptom:` what someone sees when the trap appears
- `Cause:` the real root cause or hidden boundary
- `Correct path:` the fix, safe workflow, or source of truth

## `next-steps.md`

This file gives the next contributor a clean starting point.

It should answer:

- what to do next
- why it matters
- where to start
- what “done” looks like

Each next step is a memory unit with:

- `Why:`
- `Start:`
- `Done when:`

## Managed Ownership

Tool-managed files include an ownership marker:

```md
<!-- agent-memory:file=project-map version=1 managed=true -->
```

That marker tells `agent-memory update` and `agent-memory validate` that the file is safe to audit and refresh.

If a file exists without a valid marker, the tool treats it as unmanaged:

- `update` preserves it and writes a generated backup
- `validate` reports it as unhealthy until the repository is migrated

## `current-focus` Metadata

`current-focus.md` also includes machine-readable metadata for validation freshness:

```md
<!-- agent-memory:current-focus generatedAt=<ISO> mode=<init|update> validatedAt=<ISO|none> -->
```

This keeps the file human-readable while giving `validate` a stable source of truth.
