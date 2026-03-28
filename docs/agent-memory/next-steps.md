<!-- agent-memory:projection file=next-steps version=3 bundleHash=064a82ecbc8b63ca97d01824fdb45f860aa0481cd2ebf8e1bdd8e392cd4c29d8 -->
# Next Steps

## 1. Keep the self-host baseline fresh

Why: Repo-root memory and integration assets are now part of the product surface.

Start: Run npm run dogfood:init after major dogfood flow changes.

Done when: The stable root assets reflect the current repository behavior.

## 2. Use dogfood exercise before shipping big changes

Why: The worktree canary catches drift, integration breakage, and repair regressions.

Start: Run npm run dogfood:exercise.

Done when: The latest dogfood report is green.
