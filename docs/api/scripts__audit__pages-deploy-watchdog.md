# `scripts/audit/pages-deploy-watchdog.mjs`

## Symbols

### `DEFAULT_BRANCH`

Detect GitHub Pages deploys that are missing, failed, or stuck behind a
stale active run. The pure evaluator is unit-tested; the CLI uses the
GitHub Actions token available to the scheduled workflow.
