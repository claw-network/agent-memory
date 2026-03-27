# V1 Boundary And Roadmap

This page defines what the current `agent-memory` v1 is responsible for, what is intentionally out of scope, and what the next steps should be.

## V1 Boundary

Current v1 includes:

- destructive bootstrap into the current schema through `init`
- canonical state in `/.agent-memory/state.json`
- append-only history in `/.agent-memory/history/events.jsonl`
- bundle checkpoints in `/.agent-memory/history/checkpoints/`
- external source registry in `/.agent-memory/sources.json`
- active bundle refresh through `update`
- manual history consolidation through `recall`
- cited retrieval through `query`
- external session ingestion through `import add`, `import sync`, and `import list`
- system health auditing through `validate`
- built-in source adapters for `claude-local` and `codex-local`
- readable projections in `docs/agent-memory/`

In practical terms, v1 establishes the full loop:

1. capture repository state
2. ingest additional history
3. consolidate it back into active memory
4. retrieve it later with citations
5. audit drift and backlog

## Explicitly Out Of Scope For V1

V1 intentionally does not include:

- migration from older `agent-memory` schemas or markers
- background or scheduled recall runs
- automatic consolidation during `update` or `import sync`
- embeddings, vector search, or external databases
- manual editing workflows for history events or checkpoints
- source adapters beyond the built-in local Claude/Codex importers
- policy engines for retention, pruning windows, or per-project automation rules
- conflict-aware merge tooling for partially applying recall output
- a UI layer beyond CLI output and generated markdown

These exclusions are intentional. V1 is the first complete memory lifecycle, not the final form of the product.

## V1 Quality Bar

V1 should be considered healthy when these conditions hold:

- `init`, `update`, `recall`, `query`, `import`, and `validate` all work end-to-end
- history stays append-only and checkpoints remain readable
- `recall` can remove stale next steps, merge repeated gotchas, and compress noisy current focus output
- `query` can answer from bundle, history, and checkpoints with usable citations
- `validate` can detect broken state, broken history, missing checkpoints, invalid sources, and recall backlog
- destructive rebuild semantics are documented clearly enough that users do not expect migration

## Roadmap

### Phase 1: Stabilize V1

Focus on reliability and operator confidence:

- harden importer parsing against more real-world Claude/Codex session formats
- improve recall diff readability and reduce noisy preview output
- improve query answer quality and citation precision
- tighten validation findings and make warning/fail boundaries more predictable
- expand docs with more concrete examples and troubleshooting

### Phase 2: Better Memory Maintenance

Focus on making recall smarter and easier to use:

- section-aware recall, so users can consolidate only gotchas or next steps
- stronger duplicate detection across imported and local history
- checkpoint comparison and recall summaries that explain why a change was made
- optional recall policies such as “imports only” presets or project-level defaults
- better backlog visibility, including commands that summarize unrecalled history before apply

### Phase 3: Better Retrieval

Focus on making `query` a stronger day-to-day tool:

- richer shortlist ranking across bundle, events, and checkpoints
- structured query modes such as “what changed”, “what should I do next”, and “what are the known traps”
- project-specific retrieval prompts or templates
- better cross-linking between citations and generated projection files
- optional query outputs for agents, such as JSON-only answer modes

### Phase 4: Automation And Ecosystem

Focus on reducing maintenance overhead:

- optional scheduled or threshold-based recall suggestions
- project-level automation settings under `.agent-memory/`
- broader importer ecosystem beyond Claude/Codex local history
- export or report surfaces for CI, dashboards, or external knowledge systems
- higher-level memory policies such as retention windows or source trust weighting

## Product Principle

The core principle for the next phase is simple:

- keep canonical state small
- keep history durable
- make consolidation deliberate
- make retrieval explainable

That is the line between “generated docs” and a real repository memory system.

## Phase 1 Status

Phase 1 exit criteria are currently met in the implementation baseline:

- importer coverage includes static redacted Claude/Codex fixture snapshots
- recall supports no-op exits and summary-first previews
- query supports evidence-insufficient responses and stable citations
- validate distinguishes structural failures from maintenance warnings

Future work should now treat Phase 1 as the stabilization baseline and move incrementally into Phase 2.

## Phase 2 Status

Phase 2 is complete:

- recall supports section-aware consolidation across the full bundle
- conservative deduplication is applied before state write
- checkpoint comparison powers summary-first recall previews
- `status` provides backlog, source health, checkpoint drift, and suggested next action
- `config.json` provides project-level recall defaults and policy controls

Future work should now treat Phase 2 as complete and move into Phase 3.
