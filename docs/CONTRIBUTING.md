# Contributing to Housing-Analytics

This doc captures the engineering conventions, QA/QC layers, and recommended
repo settings that keep the dashboard accurate and fresh. New contributors
should read this in full; long-time contributors should treat it as the
canonical place for "what should I do when…" questions.

## Repository conventions

### Merge style: squash, always

Recent merges on `main` (post-2026-04-22) are all squash-merges with the PR
number appended (`feat(...): ... (#NNN)`). This keeps `main` linear and
makes `git log --oneline` readable. Don't merge with merge commits or
rebase-merges.

```bash
gh pr merge <PR> --squash --delete-branch
```

### Branch protection on `main` (recommended settings)

The repo currently has no branch protection. Enable these in
**Settings → Branches → main**:

| Setting | Value |
|---|---|
| Require a pull request before merging | ✅ |
| Required approvals | 1 |
| Dismiss stale reviews when new commits are pushed | ✅ |
| Require status checks before merging | ✅ |
| Required checks | `ci-checks`, `validate-and-zip`, `Analyze (python)`, `Analyze (javascript-typescript)`, `Analyze (actions)` |
| Require linear history | ✅ |
| Require deployments to succeed (Pages) | ✅ |
| Block force pushes | ✅ |
| Apply to administrators | ✅ |

Once enabled, the only way to land code on main is via a passing-CI PR.
Force-pushes and accidental rebases that lose history become impossible.

### Stale-branch cleanup

The `cleanup-stale-branches.yml` workflow runs weekly and auto-deletes
remote branches whose PR is merged AND whose last commit is older than 14
days. Abandoned branches (no merged PR) are kept for 60 days before
deletion. To preview what would be deleted without actually deleting:

```bash
gh workflow run cleanup-stale-branches.yml -f dry_run=true
```

## QA/QC layers

The repo runs four layers of data quality checks. Each catches a different
class of bug. New ingest pipelines should add at least one assertion in
every applicable layer.

### Layer 1 — Schema (`scripts/validate-schemas.js`)

Asserts file existence + JSON parseability + presence of expected keys
(`generated`, `series`, `counties`, etc.). Catches: file missing,
truncated download, sentinel keys deleted by upstream API change.

### Layer 2 — Sentinel (`scripts/audit/data-sentinels-check.mjs`)

Asserts row-count thresholds (e.g. CHAS county count = 64). Catches:
silently-truncated files where the file exists and parses but has 5
rows when it should have 500.

### Layer 3 — Bounds (`scripts/validate-critical-data.js` Phase 2 block)

Asserts numeric values fall within physically-realistic bounds (vacancy
rate ∈ [0, 50], pct_cost_burdened ∈ [0, 100], HUD AMI ∈ [$50K, $200K]).
Catches: parser misinterpreting columns, ACS rounding artifacts that
push values just over a logical bound (the Louviers 100.1 case).

To add a new bound check, append to `BOUND_CHECKS` in
`scripts/validate-critical-data.js`:

```js
{ file: 'data/some-file.json',
  field: 'rows[].some_pct',  // dot-path with [] for array iteration
  min: 0, max: 100 },
```

### Layer 4 — Cross-source plausibility (`tests/test_data_plausibility.py`)

The most powerful + most often missed. Asserts our derived data agrees with
an INDEPENDENT source. The 2026-05-08 CHAS Table 9 → Table 7 audit was
caught by this layer — schema/sentinel/bounds all stayed green because the
file existed, parsed, had records, and burdens were technically in [0,100].
The bug only surfaced when we compared CHAS county totals against ACS
B19001.

For every external-data ingest pipeline you add, write at least one
plausibility assertion. Examples:

- CHAS county total ≈ ACS B25003 county total (CO statewide ≈ 770K renters)
- DOLA county pop ≈ ACS B01003 county pop (within 5%)
- AMI gap totals < 2 × ACS county HH count
- DP04_0046PE + DP04_0047PE ≈ 100% (owner + renter share)
- Cost burden by tier: low-income tier burden rate should be 50-90%

When a plausibility test fails, debug:
1. Check upstream source manually (visit the API, download the dictionary)
2. Compare current parser output to last-known-good output (`git diff` on
   the data file)
3. Look for the column-mapping comment in the parser — is it still accurate?

### Layer 5 — Freshness (`scripts/audit/data-freshness-check.mjs`)

Asserts data files are within their SLA (9 days for weekly pipelines, 95
days for quarterly, 400 days for annual). Catches: pipeline crashed
silently, cron not firing, deploy stuck. Doesn't catch correctness — just
recency.

To add a freshness SLA for a new data file, edit `SLA_CONFIG` in
`scripts/audit/data-freshness-check.mjs`. Set `slaDays` comfortably
longer than the pipeline's refresh cadence (weekly → 9, monthly → 32,
quarterly → 95, annual → 400).

## Pipeline anatomy

Every external-data ingest follows this pattern:

```
scripts/fetch-foo.py          ← fetches from upstream API
  └→ data/foo.json           ← raw fetch output
       └→ data/derived/foo.json  ← post-processed for consumers
            └→ js/.../foo.js     ← consumer
```

Add tests at every level:

| Level | What to test | Where |
|---|---|---|
| Fetch | Returns expected shape; row count > floor | parser unit test |
| Schema | Required keys present; types correct | `validate-schemas.js` |
| Sentinel | Count > expected min | `data-sentinels-check.mjs` |
| Bounds | Numeric values in [min, max] | `validate-critical-data.js` |
| Cross-source | Our value ≈ independent source | `tests/test_data_plausibility.py` |
| Freshness | mtime within SLA | `data-freshness-check.mjs` |

When you skip a layer, document why in the parser file's docstring.

## CI workflows that gate merging

Any PR triggers these. They must pass before the PR is mergeable when
branch protection is enabled.

| Workflow | What it does | Typical runtime |
|---|---|---|
| `ci-checks` | npm test:ci suite (60+ tests) | 2-3 min |
| `validate-and-zip` | Asset validation + Pages artifact bundle | 30 sec |
| `Analyze (actions/javascript-typescript/python)` | CodeQL static analysis | 1-2 min |
| `axe`, `contrast-audit`, `site-audit` | Accessibility + visual checks | 1-3 min |

CI runs `npm ci` (lockfile-enforced). To match what CI sees locally:

```bash
rm -rf node_modules
npm ci
npm run test:ci
```

## Adding new external data sources

Follow this checklist when ingesting a new source:

1. Add the fetch script to `scripts/` (or `scripts/market/` for market data)
2. Write at least one test for the parser in `test/` or `tests/`
3. Add a freshness SLA to `data-freshness-check.mjs`
4. Add a sentinel-count check to `data-sentinels-check.mjs` if the file has
   a known minimum row count
5. Add bound checks to `validate-critical-data.js` for any numeric fields
6. Add a cross-source plausibility test to `tests/test_data_plausibility.py`
7. Document the source in `docs/DATA-SOURCES.md` with: provider, URL, vintage,
   refresh cadence, license/attribution
8. Add a workflow `.github/workflows/fetch-foo.yml` that runs the script on
   the appropriate cron + commits the result
9. If the source has a published data dictionary, mirror it to
   `docs/_external-references/` so future debugging doesn't depend on
   external availability

## When upstream changes shape

External APIs occasionally rename columns or drop endpoints. The first
warning sign is usually a plausibility test failing or a field bound
check tripping. Triage:

1. Visit the upstream source manually (don't trust caches)
2. Diff the response against the parser's expected columns
3. If the change is a column rename: update the parser + parser test
4. If the change is a removed field: update the parser to fall back +
   surface a warning in the logs
5. If the change is a vintage update (new release): bump the
   `_VINTAGE` constant + verify dictionary still matches

## Releasing a hotfix to production

`main` auto-deploys to GitHub Pages on every push. To roll out a hotfix:

1. Branch from `main`: `git checkout -b fix/short-name`
2. Make + test the change locally: `npm run test:ci`
3. Open PR, get review, merge with `gh pr merge <#> --squash --delete-branch`
4. Verify Pages deploy completed: `gh run list --workflow=deploy.yml --limit 3`
5. Hard-refresh the live site (Cmd+Shift+R) to bypass browser cache

## Where things live

| What | Where |
|---|---|
| Fetch scripts | `scripts/`, `scripts/market/`, `scripts/hna/` |
| Data files | `data/`, `data/hna/`, `data/market/` |
| JS modules | `js/`, `js/hna/`, `js/market-analysis/` |
| Python tests | `tests/test_*.py` |
| Node tests | `test/*.test.js` |
| Workflows | `.github/workflows/*.yml` |
| Docs | `docs/`, `docs/_external-references/` |

## Help: why is X broken?

| Symptom | First thing to check |
|---|---|
| Data on the site looks wrong | Run `node scripts/audit/data-freshness-check.mjs` + `node scripts/validate-critical-data.js` locally |
| CI failing on a PR but local passes | `rm -rf node_modules && npm ci`, re-run |
| New ingest pipeline produces empty file | Check the source URL responds (WAF challenges return HTTP 202); check `data/` for cached input |
| Plausibility test fails after pulling main | Cross-source upstream may have shipped a new vintage; check `data-source-monitoring.yml` discovery report for new-source alerts |
| Pages deploy stuck | `gh workflow run deploy.yml` and check the run output |
