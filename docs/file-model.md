# File Model

`agent-memory` now uses a state + history + checkpoint model.

The source of truth is no longer just one generated markdown layer. The canonical system is:

- `/.agent-memory/state.json`
- `/.agent-memory/history/events.jsonl`
- `/.agent-memory/history/checkpoints/*.json`
- `/.agent-memory/archive/`
- `/.agent-memory/sources.json`
- `/.agent-memory/config.json`

## `state.json`

This is the active canonical memory state.

It stores:

- `schemaVersion`
- `generatorVersion`
- `provider`
- `generatedAt`
- `bundleHash`
- `bundle`
- `maintenance`

### `bundle`

The active memory payload:

- `project`
- `projectMap`
- `currentFocus`
- `gotchas`
- `nextSteps`
- `validationCommands`

### `maintenance`

Operational metadata for the memory system:

- `lastRecalledAt`
- `lastRecalledEventId`
- `latestCheckpointId`
- `historyEventCount`
- `importSourceCount`
- `recallCursors`

## `history/events.jsonl`

This is the active event stream.

Each event is normalized into one of two kinds:

- `tool_run`
- `imported_session`

Each event carries:

- `id`
- `sourceId`
- `createdAt`
- `contentHash`
- `summary`
- `signals`
- `sourceRef`

`signals` is the durable extraction layer used by recall and query. It includes:

- `decisions`
- `gotchas`
- `nextStepHints`
- `keyPaths`
- `validationObservations`

Retention can later archive older recalled events out of the active log. Archived events do not participate in active retrieval or consolidation.

## `history/checkpoints/`

Each checkpoint stores a snapshot of the canonical bundle after a meaningful write.

This gives the system:

- a stable diff baseline for `recall`
- a baseline for `status` checkpoint drift summaries
- a retrievable memory layer for `query`
- a structural integrity target for `validate`

Retention can later archive older checkpoints out of the active checkpoint set while always preserving the latest checkpoint and the configured recent tail.

## `archive/`

This is the archive-first retention layer.

Each batch lives under:

- `/.agent-memory/archive/prune-<timestamp>/manifest.json`
- `/.agent-memory/archive/prune-<timestamp>/events.jsonl`
- `/.agent-memory/archive/prune-<timestamp>/checkpoints/*.json`

Archive batches are written by automation-only pruning.

Archived data:

- is copied out of the active history/checkpoint store first
- does not participate in active `query`, `recall`, or `status`
- can later expire from the archive on a longer window

## `sources.json`

This is the import source registry.

Each source records:

- `id`
- `type`
- `path`
- `createdAt`
- `updatedAt`
- `lastSyncedAt`
- `lastSyncStatus`
- `lastSyncError`
- `lastImportedCount`

## `config.json`

This is the project-level recall and maintenance configuration.

The config now covers recall, retrieval, automation, and retention:

- `recall.defaultSection`
- `recall.defaultSource`
- `recall.policy`
- `recall.backlogWarnThreshold`
- `recall.preview.showDiffByDefault`
- `query.defaultOutput`
- `query.templates.*.instructions`
- `automation.intervalMinutes`
- `automation.provider`
- `automation.importSyncBeforeRecall`
- `automation.autoRecall`
- `retention.enabled`
- `retention.history.maxAgeDays`
- `retention.checkpoints.maxAgeDays`
- `retention.checkpoints.keepRecent`
- `retention.archive.expireAfterDays`

CLI flags can still override these defaults for a single command run.

## Projection Files

These are generated from the current canonical bundle:

- `docs/agent-memory/README.md`
- `docs/agent-memory/project-map.md`
- `docs/agent-memory/current-focus.md`
- `docs/agent-memory/gotchas.md`
- `docs/agent-memory/next-steps.md`

Each file starts with a versioned projection marker containing the active `bundleHash`.

## Entry Block

The top-level repository entry file contains a versioned project-memory block:

```md
<!-- agent-memory:entry version=3 bundleHash=<sha256> start -->
...
<!-- agent-memory:entry end -->
```

This lets `validate` confirm that contributors still have the correct top-level path into the memory system.

## Compatibility Note

The current schema is intentionally breaking.

- old state files are not read
- old projection markers are not preserved
- there is no migration path

Re-run:

```bash
npx agent-memory init
```

to rebuild a repository into the current model.
