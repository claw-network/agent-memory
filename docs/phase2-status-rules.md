# Phase 2 Status Rules

This document defines how `agent-memory status` should summarize maintenance state and choose the suggested next action.

It exists to keep the product rules, implementation, and tests aligned. If `status` behavior changes, this file should be updated together with the corresponding tests.

## Purpose

`status` is the operator-facing readout that answers one question before any maintenance action is taken:

> What should I do next, and why?

It is a read-only command. It must not:

- mutate canonical state
- mutate history
- write checkpoints
- trigger recall

## Inputs

`status` uses these inputs:

- current `state.json`
- current `history/events.jsonl`
- current `sources.json`
- current `config.json`
- comparison checkpoint
  latest by default, or `--checkpoint <id>` if specified
- `--show-diff`
  controls whether file diffs are shown for checkpoint comparison

## Output Sections

`status` always prints these top-level sections:

- `State`
- `History`
- `Sources`
- `Checkpoint Drift`
- `Suggested Next Action`

If no comparison baseline is available, `Checkpoint Drift` must still be shown with an explicit “no comparison available” style message.

## Suggested Next Action Priority

The priority order is fixed and must remain deterministic:

1. failed source sync
2. backlog above configured threshold
3. unrecalled history exists
4. checkpoint drift exists
5. no action required

That means:

- a failed source sync always beats backlog messaging
- backlog above threshold always beats ordinary checkpoint drift
- checkpoint drift only becomes the top recommendation when there is no failed source and no unrecalled backlog

## Suggested Action Rules

### 1. Failed source sync

Condition:

- at least one source has `lastSyncStatus=failed`

Suggested action:

- `Run \`agent-memory import sync --all\` to retry failed sources.`

Rationale:

- imported state may still be usable, but source health should be restored before new recall decisions are made

### 2. Backlog above threshold

Condition:

- `unrecalledAll > config.recall.backlogWarnThreshold`

Suggested action:

- `Run \`agent-memory recall\` because the backlog is above the configured threshold.`

Rationale:

- the system is telling the operator that history maintenance is overdue

### 3. Unrecalled history exists

Condition:

- `unrecalledAll > 0`
- backlog is not above threshold
- no failed source sync exists

Suggested action:

- `Run \`agent-memory recall\` to consolidate unrecalled history.`

Rationale:

- there is still maintenance work to do, but it is not yet urgent

### 4. Checkpoint drift exists

Condition:

- no failed source sync
- no unrecalled backlog
- checkpoint comparison reports changed sections

Suggested action:

- `Run \`agent-memory update\` if the active bundle no longer reflects repository reality.`

Rationale:

- the active memory differs from the comparison baseline even though there is no pending history backlog

### 5. No action required

Condition:

- no failed source sync
- no unrecalled backlog
- no checkpoint drift summary changes

Suggested action:

- `No immediate action is required.`

## Checkpoint Drift Semantics

Checkpoint drift in `status` is descriptive, not prescriptive by itself.

Rules:

- latest checkpoint is the default comparison baseline
- `--checkpoint <id>` only changes the baseline used for reporting
- `status` must not imply that the specified checkpoint will become the new latest checkpoint
- `status --show-diff` may surface file diffs, but summary-first output remains primary

If checkpoint comparison is not available:

- `status` must not guess
- it should show no comparison and fall back to other inputs when choosing the suggested action

## Source Health Semantics

For each source, `status` must surface:

- `id`
- `status`
- `lastSyncedAt`
- `lastImportedCount`
- `lastSyncError` when present

Interpretation:

- `passed`
  source is healthy at the last sync boundary
- `failed`
  source needs operator attention and takes top priority in suggested action
- `never`
  source is registered but has not been synced yet; this is informational, not an error by itself

## Backlog Semantics

`status` must show all three backlog counts:

- `unrecalledAll`
- `unrecalledLocal`
- `unrecalledImports`

The suggested next action is driven by `unrecalledAll`, but the detailed counts help the operator decide whether to run:

- a general recall
- an imports-only recall
- a local-only recall

## Config Interaction

`status` must respect these config fields:

- `recall.backlogWarnThreshold`

It must not be affected by:

- `recall.defaultSection`
- `recall.defaultSource`
- `recall.policy`
- `recall.preview.showDiffByDefault`

Those affect recall behavior, not status decision-making.

## Test Expectations

The status test matrix should guarantee:

- failed source sync outranks backlog
- backlog above threshold outranks ordinary recall suggestion
- ordinary recall suggestion outranks checkpoint drift
- checkpoint drift outranks no-op
- no-op is returned only when all higher-priority conditions are absent
- explicit checkpoint comparison changes reporting but does not change other decision inputs

## Out Of Scope

This Phase 2 contract does not include:

- confidence scoring for suggested actions
- multiple ranked recommendations
- auto-running any suggested action
- per-source suggestion text customization
- combining status with validate into one command

Those belong to later phases if needed.
