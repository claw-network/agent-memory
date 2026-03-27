# Phase 2 Recall Rules

This document is the behavioral contract for `agent-memory recall`.

It exists to keep docs, tests, and implementation aligned. If a future change would alter recall behavior, this file should be updated together with the relevant tests.

## Inputs

`recall` behavior is controlled by six inputs:

| Input | Source | Purpose |
| --- | --- | --- |
| `source` | CLI or config | Chooses which unrecalled history events are considered |
| `section` | CLI or config | Chooses which bundle section is allowed to be rewritten |
| `policy` | CLI or config | Applies additional protection or source-selection rules |
| `checkpoint` | CLI only | Chooses the comparison baseline for preview and status output |
| `showDiff` | CLI or config | Chooses whether file-level diffs are displayed |
| current state | canonical state | Supplies the active bundle that recall may partially rewrite |

## Priority Rules

The precedence order is fixed:

1. CLI flags
2. `/.agent-memory/config.json`
3. built-in defaults

Specific rules:

- `--source` overrides `config.recall.defaultSource`
- `--section` overrides `config.recall.defaultSection`
- `--policy` overrides `config.recall.policy`
- `--show-diff` overrides `config.recall.preview.showDiffByDefault`
- `--checkpoint` has no config fallback; if omitted, the latest checkpoint is used as the comparison baseline

## Source Rules

`source` only affects which unrecalled events are read.

| Value | Included events |
| --- | --- |
| `all` | `tool_run` and `imported_session` |
| `local` | `tool_run` only |
| `imports` | `imported_session` only |

Policy can still rewrite the effective source before recall runs:

- `imports-only` forces `imports`
- `local-only` forces `local`
- `balanced` leaves source unchanged
- `project-map-protected` does not change source

## Section Rules

`section` only affects which part of the bundle can be rewritten by the candidate bundle before write.

| Section | Mutable fields |
| --- | --- |
| `project` | `bundle.project` |
| `project-map` | `bundle.projectMap` |
| `current-focus` | `bundle.currentFocus` |
| `gotchas` | `bundle.gotchas` |
| `next-steps` | `bundle.nextSteps` |
| `validation-commands` | `bundle.validationCommands` |
| `all` | all of the above, subject to policy protections |

Non-selected sections must be copied from the current bundle unchanged.

## Policy Rules

Policies only affect recall. They do not affect `update`, `query`, or `import sync`.

| Policy | Effect |
| --- | --- |
| `balanced` | Use the selected source and section as-is |
| `imports-only` | Force effective source to `imports` |
| `local-only` | Force effective source to `local` |
| `project-map-protected` | Freeze `projectMap` unless `section=project-map` |

Important clarification:

- `section=all` does not mean every section may change unconditionally
- `project-map-protected + section=all` must leave `projectMap` unchanged
- `project-map-protected + section=project-map` allows explicit `projectMap` rewrite
- `validation-commands` recall may update command recommendations and purposes, but it must not execute commands

## No-Op Rules

`recall` must return a no-op result in either of these cases:

1. There are no unrecalled events after source filtering
2. Consolidation runs, but the final candidate bundle is durably identical to the current bundle after:
   - section merge
   - policy protection
   - deduplication

No-op recall behavior is fixed:

- print `Nothing to recall`
- do not write state
- do not write a checkpoint
- do not write a tool-run event
- do not change recall cursors

## Summary Contract

The recall summary is the stable structured description of the candidate change.

It must include:

- `changedSections`
- `addedGotchas`
- `removedGotchas`
- `addedNextSteps`
- `removedNextSteps`
- `mergedGotchas`
- `mergedNextSteps`
- `currentFocusChanged`
- `validationChanged`
- `selectedSection`
- `protectedSections`

Rules:

- `merged` and `removed` must not double-count the same logical record
- dedupe-only outcomes still count as a changed section
- `protectedSections` means “sections frozen in this run”, not “globally protected forever”
- in a no-op recall, the summary still exists, but all change collections must be empty and booleans must be `false`

## Preview / Apply / Checkpoint Comparison

Recall has three display layers:

### Memory Summary

Always shown.

Purpose:

- explain what recall wants to change
- show selected section, policy result, and protected sections
- surface merges, additions, removals, and high-level current-focus/validation changes

### Checkpoint Summary

Shown only when a comparison baseline exists.

Purpose:

- explain how the candidate state differs from the selected checkpoint
- summarize section drift before any write occurs

`--checkpoint <id>` changes only this comparison baseline.

It does not change:

- which unrecalled events are selected
- which checkpoint will be written on apply
- which event id becomes the new recall cursor

### File Diffs

Shown only when:

- `--show-diff` is passed, or
- `config.recall.preview.showDiffByDefault` is `true`

Rules:

- file diffs are secondary to summary output
- summary must still be sufficient to understand the intended change
- file diff must never be the only explanation of why a recall result exists

## Preview / Apply Consistency

These values must stay consistent between preview and apply:

- candidate bundle content
- selected section
- effective source
- effective policy
- protected sections
- summary fields
- projected file content

The write path may assign a fresh checkpoint file and tool-run event id, but the written state must correspond to the same candidate bundle described during preview.

## Test Matrix

Any recall change should keep this matrix green:

### Source combinations

- `source=all`
- `source=local`
- `source=imports`

### Section combinations

- `section=project`
- `section=project-map`
- `section=current-focus`
- `section=gotchas`
- `section=next-steps`
- `section=validation-commands`
- `section=all`

### Policy combinations

- `policy=balanced`
- `policy=imports-only`
- `policy=local-only`
- `policy=project-map-protected`

### Preview controls

- no-op with zero unrecalled events
- no-op with no durable candidate changes
- default summary-first preview
- `--show-diff`
- `--checkpoint <id>`

### Precedence cases

- config defaults only
- CLI overrides config for source
- CLI overrides config for section
- CLI overrides config for policy
- CLI overrides config for showDiff

## Implementation Note

This file defines the Phase 2 recall contract only.

It does not redefine:

- dedupe heuristics in full detail
- status suggestion logic
- Phase 2 exit criteria

Those are separate follow-up planning artifacts.
