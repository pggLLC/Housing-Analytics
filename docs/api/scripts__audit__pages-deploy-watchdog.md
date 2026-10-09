# `scripts/audit/pages-deploy-watchdog.mjs`

Detect GitHub Pages deploys that are missing, failed, or stuck behind a
stale active run. The pure evaluator is unit-tested; the CLI uses the
GitHub Actions token available to the scheduled workflow.

## Symbols

### `checkDeployCoverage({ repoSlug, token, headSha, headCommitDate, apiUrl = 'https://api.github.com', branchName = DEFAULT_BRANCH, workflowId = DEFAULT_WORKFLOW_ID, now = new Date()`

Query the head directly; the branch listing is only a consistency check.
