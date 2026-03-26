# Adoption Guide

This guide is for teams introducing `agent-memory` into an existing repository.

## Start Small

Use `init` first:

```bash
npx agent-memory init
```

This gives the repository a first memory layer without requiring a large documentation migration.

## Treat The First Pass As A Baseline

The first generated files are a starting point, not the final truth.

After `init`, review:

- `project-map.md`
- `current-focus.md`
- `next-steps.md`

Replace vague generated wording with repo-specific language where it matters.

## Legacy Repositories

If the repository already has hand-written memory-like documents:

- keep them
- do not overwrite them blindly
- let `update` produce generated backups when markers are missing

This is intentional. The tool is designed to be conservative when it cannot prove ownership.

## Human + Tool Collaboration

A healthy setup usually looks like this:

- humans refine the generated model
- the tool maintains files it explicitly owns
- `validate` ensures the repository stays in a healthy state
- `current-focus.md` is refreshed whenever the operational baseline changes

The goal is not to automate all documentation. The goal is to make the most important shared context durable.

## Suggested Team Workflow

1. Run `init` once.
2. Review and tighten the first generated memory files.
3. Use `update` after structural or workflow changes.
4. Use `validate` in CI or pre-release checks.
5. Add real gotchas only when they are painful enough to deserve permanent memory.

## When This Model Works Best

`agent-memory` is especially useful when:

- the project is long-lived
- onboarding cost is high
- contributors rotate frequently
- coding agents are part of the day-to-day workflow
- the repository has enough complexity that “just read the code” is too expensive

## When To Keep It Light

If a repository is tiny or short-lived, keep the memory layer small.

The model works best when it stays focused. More files are not the goal. Better continuity is.
