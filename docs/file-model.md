# File Model

`agent-memory` now uses a canonical-state-plus-projection model.

The important change is simple:

- `/.agent-memory/state.json` is the only source of truth
- `docs/agent-memory/*.md` are generated projections

## Canonical State

The canonical file is:

```text
.agent-memory/state.json
```

It stores:

- `schemaVersion`
- `generatorVersion`
- `provider` metadata for the analysis run
- `generatedAt`
- `bundleHash`
- `bundle`

The `bundle` contains the durable memory payload:

- `project`
- `projectMap`
- `currentFocus`
- `gotchas`
- `nextSteps`
- `validationCommands`

## Projection Files

The readable projection lives in:

- `docs/agent-memory/README.md`
- `docs/agent-memory/project-map.md`
- `docs/agent-memory/current-focus.md`
- `docs/agent-memory/gotchas.md`
- `docs/agent-memory/next-steps.md`

Each file starts with a versioned projection marker that includes the canonical `bundleHash`.

Example:

```md
<!-- agent-memory:projection file=project-map version=2 bundleHash=<sha256> -->
```

That marker lets `validate` confirm that the readable file still matches the current canonical bundle.

## Entry Block

`agent-memory` also writes a versioned entry block into the repository’s preferred top-level entry file.

Marker shape:

```md
<!-- agent-memory:entry version=2 bundleHash=<sha256> start -->
...
<!-- agent-memory:entry end -->
```

This lets `validate` check that contributors still have a correct top-level pointer into the memory system.

## Bundle Sections

### `project`

High-level identity and orientation:

- project summary
- ecosystem
- package manager
- workspace mechanism
- recommended entry file
- key paths

### `projectMap`

Stable structure:

- modules
- entrypoints
- dense source areas
- architecture notes
- first files to read

### `currentFocus`

Current operational state:

- summary
- current state bullets
- known risks
- validation snapshot

### `gotchas`

Confirmed expensive traps:

- `title`
- `symptom`
- `cause`
- `correctPath`

### `nextSteps`

Actionable follow-ups:

- `title`
- `why`
- `start`
- `done`

### `validationCommands`

Up to two agent-recommended validation commands with:

- `label`
- `command`
- `purpose`

## Validation Freshness

Validation freshness now comes from the canonical bundle, not from a special markdown metadata header.

`currentFocus.validationSnapshot` carries:

- `status`
- `validatedAt`
- `summary`
- `results`
- `suggestedNextActions`

`validate` reads freshness from there and fails when the baseline is missing or stale.

## Compatibility Note

The old per-file managed-marker system is gone. There is no unmanaged/backup branch in the new model.

If a repository still uses the previous format, rerun:

```bash
npx agent-memory init
```
