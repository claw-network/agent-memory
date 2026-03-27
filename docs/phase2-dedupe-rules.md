# Phase 2 Dedupe Rules

This document defines the conservative deduplication contract used by `agent-memory` during recall.

It exists to keep the product rules, implementation, and tests aligned. If dedupe behavior changes, this file should be updated together with the relevant tests.

## Purpose

Deduplication exists to keep the active canonical bundle small and stable without collapsing distinct information into one vague record.

The Phase 2 rule is explicit:

- prefer under-merging over over-merging
- only merge when duplicate confidence is high
- never do cross-section merging
- never remove information unless a richer record still preserves the durable content

## Scope

Phase 2 dedupe applies only inside `recall`, after:

1. provider consolidation
2. section filtering
3. policy protection

and before:

4. candidate state preview
5. checkpoint and tool-run write

Current covered targets:

- `bundle.gotchas`
- `bundle.nextSteps`
- `bundle.currentFocus.currentState`
- `bundle.currentFocus.knownRisks`
- `bundle.currentFocus.validationSnapshot.suggestedNextActions`

It does not dedupe:

- `project`
- `projectMap`
- `validationCommands`
- history events
- checkpoints

## Shared Normalization Rules

All dedupe logic starts from the same normalization pass:

- lowercase text
- strip punctuation and repeated separators
- split into token sets
- ignore very short tokens

This normalization is used only for comparison.

The visible output should keep the richer original wording, not the normalized form.

## Gotcha Merge Rules

Two gotchas may merge only when either:

1. normalized titles are exactly equal

or:

2. title overlap is high
   and
   at least one of `cause` or `correctPath` is also highly similar

Phase 2 implementation currently treats “high overlap” as a conservative threshold around the existing similarity heuristic. That heuristic may change internally, but the product contract stays:

- title similarity alone is not enough unless titles are effectively identical
- cause-only similarity is not enough
- symptom does not trigger a merge by itself

When a merge happens:

- the richer title wins
- the richer symptom wins
- the richer cause wins
- the richer correctPath wins

The result is one gotcha record.

The merged-away title is reported in `mergedGotchas`.

## Next Step Merge Rules

Two next steps may merge only when:

- title similarity is high
and
- at least one of `start` or `done` is also highly similar

`why` alone is not sufficient to merge two steps.

When a merge happens:

- keep the richer title
- keep the richer why
- keep the richer start
- keep the richer done

The merged-away title is reported in `mergedNextSteps`.

## Flat String Deduplication

For these arrays:

- `currentFocus.currentState`
- `currentFocus.knownRisks`
- `validationSnapshot.suggestedNextActions`

dedupe is stricter:

- normalized text must be equivalent
- near-miss similarity is not enough

When duplicates are folded:

- keep the richer original phrasing
- do not report them as “removed”
- the containing section still counts as changed if the array became smaller or richer

## What Counts As `merged` Versus `removed`

The contract is:

- `merged*` means two or more records were folded into one richer record
- `removed*` means a record disappeared without being preserved as a merge result

The same logical item must never be counted in both buckets in the same recall run.

Examples:

- two nearly identical gotchas become one richer gotcha
  This is `merged`, not `removed`.
- a next step disappears because recall concluded it is done and no richer replacement remains
  This is `removed`, not `merged`.

## Protected Section Interaction

Dedupe must respect section and policy boundaries.

That means:

- if a section is not selected, it must not be deduped
- if a section is protected by policy, it must not be deduped
- `section=all` still respects protected sections

So under `project-map-protected`:

- `projectMap` cannot be changed or deduped unless recall explicitly targets `project-map`

## No-Op Interaction

Dedupe participates in no-op detection.

That means a recall run is still considered meaningful if:

- provider output is unchanged
but
- dedupe merges or folds duplicate records

In other words:

- dedupe-only consolidation is still a real recall change
- dedupe-only outcomes should populate `mergedGotchas` and/or `mergedNextSteps`
- dedupe-only outcomes should mark the affected section as changed

## Test Expectations

The dedupe test matrix should guarantee:

### Gotchas

- exact-title duplicates merge
- near-title + similar-cause duplicates merge
- near-title but different cause/correctPath do not merge
- symptom-only similarity does not merge

### Next Steps

- similar title + similar start merges
- similar title + similar done merges
- similar title but unrelated action does not merge
- why-only similarity does not merge

### Flat Arrays

- whitespace/punctuation variants collapse
- semantically different strings do not collapse

### Cross-Boundary Safety

- no dedupe across sections
- no dedupe inside protected sections
- no dedupe when section filtering excludes the target section

### Summary Integrity

- merged items land in `mergedGotchas` / `mergedNextSteps`
- merged items are not also counted in `removedGotchas` / `removedNextSteps`
- dedupe-only results still mark the relevant section as changed

## Out Of Scope

This Phase 2 contract does not include:

- embedding-based semantic clustering
- cross-section dedupe
- configurable similarity thresholds
- user-editable dedupe policies
- history event dedupe beyond import dedupe

Those belong to later phases if needed.
