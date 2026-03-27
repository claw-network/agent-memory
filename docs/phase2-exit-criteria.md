# Phase 2 Exit Criteria

This document defines when Phase 2 should be considered complete enough for the project to move on to Phase 3.

The goal is not to declare perfection. The goal is to define a clear maintenance baseline so future work can safely focus on retrieval improvements instead of reopening Phase 2 ambiguities.

## Exit Principle

Phase 2 is complete when `recall` is no longer just feature-rich, but behaviorally stable:

- operators can predict what it will do
- docs, tests, and implementation describe the same rules
- maintenance workflows are trustworthy enough for day-to-day use

## Required Capabilities

All of the following must be true:

### Recall behavior is stable

- section-aware recall works across the supported bundle sections
- policy handling is predictable and documented
- protected section behavior is enforced
- no-op recall is reliable
- preview and apply remain consistent

### Conservative dedupe is stable

- duplicate gotchas and next steps are merged only at high confidence
- dedupe does not cross section boundaries
- merged items are reported correctly in recall summary output
- dedupe-only recalls are still treated as meaningful changes

### Status is decision-useful

- `status` shows enough information to decide whether to run `import sync`, `recall`, `update`, or nothing
- the suggested-next-action priority order is stable
- source health, backlog, and checkpoint drift are visible without opening state files manually
- checkpoint comparison summaries are understandable without reading raw diffs

### Config is trustworthy

- `config.json` defaults are applied consistently
- CLI flags correctly override config values
- invalid config is caught by `validate`
- config-driven recall behavior matches documented precedence rules

## Documentation Criteria

Phase 2 is not complete until the behavioral contracts are written down.

The following documents must all exist and agree with implementation:

- [Phase 2 Recall Rules](./phase2-recall-rules.md)
- [Phase 2 Dedupe Rules](./phase2-dedupe-rules.md)
- [Phase 2 Status Rules](./phase2-status-rules.md)

Additionally:

- [README.md](../README.md) must expose the Phase 2 command surface clearly
- [Commands](./commands.md) must explain the operator-facing usage
- [Roadmap](./roadmap.md) must mark Phase 2 as established and point to the formal rules

## Test Criteria

Phase 2 should not be treated as complete unless these test categories are covered and passing:

### Recall rule coverage

- source combinations
- section combinations
- policy combinations
- config precedence
- no-op paths
- preview/apply consistency

### Dedupe coverage

- gotcha merge rules
- next-step merge rules
- flat-string dedupe rules
- protected-section safety
- merged vs removed summary integrity

### Status coverage

- failed source sync
- backlog above threshold
- backlog below threshold but still present
- checkpoint drift with no backlog
- no-action case
- explicit checkpoint comparison

### Regression coverage

- existing import/query/validate end-to-end tests remain green
- Phase 1 stabilization guarantees stay intact
- Phase 2 additions do not break old recall expectations

## Operator Acceptance Criteria

Phase 2 is complete only if a maintainer can do these tasks without reading source code:

1. register and sync an external history source
2. inspect whether recall is needed by running `status`
3. understand why recall changed or did not change memory
4. understand when a source sync failure is urgent versus merely recoverable
5. understand when query output is evidence-limited rather than authoritative

If any of these requires implementation knowledge rather than documented command behavior, Phase 2 is not fully closed.

## Release Readiness Criteria

Before declaring Phase 2 done:

- the full test suite passes
- docs are updated in the same branch as the behavior
- roadmap status is current
- no known high-severity mismatch remains between docs, tests, and implementation for recall, dedupe, or status

## What Does Not Block Phase 2 Exit

These are explicitly allowed to remain for Phase 3 or later:

- richer query ranking beyond the current baseline
- structured query modes
- JSON-only query outputs
- background automation or scheduled recall
- broader importer ecosystems beyond current built-ins
- retention or trust-weight policy systems

Those belong to later roadmap phases and should not keep Phase 2 open.
