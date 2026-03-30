# Product Roadmap

This page reflects the current reality of `agent-memory`, not the historical sequence that got the project here.

The project is no longer just a repository memory bootstrapper. It is now a broader memory platform with durable state, retrieval, automation, integration, retention, and self-host dogfooding capabilities.

## Current Product Surface

Today `agent-memory` includes these product areas:

- Canonical memory
  `init`, `update`, `recall`, `status`, `validate`
- Retrieval
  `query` with natural-language modes, citations, and JSON output
- External history ingestion
  `add`, `sync`
- Local automation
  `automate start|stop|status|run-once|ensure-running`
- Client integration
  `integrate` for Claude Code and Codex
- MCP access
  `mcp`
- Retention and archive management
  archive-first pruning under `.agent-memory/archive/`
- Workflow layer
  higher-level workflow tools exposed through the MCP surface
- Self-host dogfood tooling
  `npm run dogfood:init|exercise|repair|status`

## What Is Already Complete

These foundations are established in the current codebase:

- Durable repository memory with canonical state, history, checkpoints, sources, and config
- Section-aware recall with policy controls and conservative deduplication
- Query retrieval across bundle, history, and checkpoints with citations and evidence-insufficient handling
- Status inspection with backlog, source health, checkpoint drift, and suggested next action
- Retention and archive-first pruning integrated into the automation path
- Local automation daemon for sync + recall maintenance
- Claude Code and Codex integration surfaces
- MCP tools and higher-level workflow entrypoints
- Self-host dogfood loops for exercising and repairing the project against itself

## Current Strategic Focus

The project has moved beyond the original Phase 1/2/3 framing. The meaningful frontier is now inside the broader platform.

The current focus areas are:

- make the workflow layer the default operator experience
- improve integration reliability for Claude Code and Codex
- deepen automation and retention safety
- expand the dogfood loop so the project can prove its own value continuously
- keep the active memory surface small while the platform around it grows

## Next Major Goals

### 1. Workflow-First Experience

Shift the product center of gravity from low-level commands to high-level workflows.

Near-term goals:

- strengthen workflow tools such as `memory_assess`, `memory_compact_handoff`, and `memory_maintain`
- make workflow outputs easier to trust and act on than raw command output
- keep low-level commands available, but treat them as expert-mode tools

### 2. Integration Maturity

Turn integration from “available” into “boring and reliable.”

Near-term goals:

- reduce mismatch states between managed integration assets and real project state
- improve repair flows for partially broken Claude/Codex integration
- tighten status/read-only inspection so operators can understand integration health without trial-and-error

### 3. Automation And Retention Safety

Automation now exists; the next step is making it resilient and predictable.

Near-term goals:

- improve daemon observability and run diagnostics
- harden archive-first pruning and archive expiry behavior
- ensure active query/recall/status semantics stay clean even as archives grow
- refine when aggressive auto-apply recall is acceptable versus risky

### 4. Broader Importer Coverage

Current importer support is intentionally narrow and local-first.

Near-term goals:

- support more real-world Claude/Codex local history layouts
- improve partial-failure handling and diagnostics
- expand beyond current built-ins only when reliability and operator clarity are preserved

### 5. Dogfood And Repair Loop

The dogfood layer is now a strategic asset, not just internal tooling.

Near-term goals:

- make the self-host exercise loop a stronger regression detector
- improve deterministic repair before escalating to provider-driven repair
- keep the dogfood worktree isolated while preserving realistic operator conditions

## Longer-Horizon Opportunities

These are intentionally not immediate commitments, but they are plausible extensions of the current platform:

- richer exporter/report surfaces for CI and dashboards
- stronger policy controls for automation and retention
- broader importer ecosystem
- deeper MCP workflow composition
- more agent-oriented output modes and structured handoff surfaces

## Product Principle

The platform should continue to optimize for this balance:

- keep active canonical memory small
- keep historical evidence durable
- make retrieval explainable
- make maintenance deliberate
- make automation observable
- make integrations safe by default

That is the line between “a memory bootstrap tool” and “a trustworthy memory operating system for coding workflows.”
