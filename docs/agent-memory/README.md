<!-- agent-memory:projection file=readme version=3 bundleHash=37b2761c7e3cd464944e92a2dce3e0a81841fd70230390a0f72009a4770a4e9b -->
# Agent Memory

This directory is a generated projection of the active canonical repository memory state.

## Canonical System

- Canonical state file: `.agent-memory/state.json`
- History log: `.agent-memory/history/events.jsonl`
- Checkpoints: `.agent-memory/history/checkpoints/`
- Import sources: `.agent-memory/sources.json`
- Last generated: 2026-04-09T08:18:49.148Z
- Provider: `codex`
- Recommended entry file: `AGENTS.md`

## Reading Order

1. `docs/agent-memory/README.md`
2. `docs/agent-memory/project-map.md`
3. `docs/agent-memory/current-focus.md`
4. `docs/agent-memory/gotchas.md` when behavior is surprising or expensive to debug
5. `docs/agent-memory/next-steps.md` when you need a practical starting point

## Refresh Flow

- Run `npx agent-memory update` to refresh the active canonical bundle.
- Run `npx agent-memory sync --all` to ingest external session history.
- Run `npx agent-memory recall` to consolidate unrecalled history into active memory.
- Run `npx agent-memory query "..."` to retrieve memory with citations.
- Run `npx agent-memory validate` to audit state, history, checkpoints, projections, and recall backlog.

## Troubleshooting Notes

- If `sync` reports failed items, imported history is still preserved; inspect the failure output and rerun later.
- If `recall` reports nothing to do, there were no unrecalled durable changes for the selected scope.
- If `query` says evidence is insufficient, import more history or run `recall` before relying on the answer.

## What Lives Here

- `project-map.md`: stable structure, modules, entrypoints, and architecture notes.
- `current-focus.md`: the active operating picture, risks, and validation snapshot.
- `gotchas.md`: costly traps that are easy to forget and expensive to rediscover.
- `next-steps.md`: the current actionable follow-ups after the latest recall/update pass.
