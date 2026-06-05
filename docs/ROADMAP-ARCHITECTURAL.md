# Architectural Roadmap — Deferred Items

**Last updated:** 2026-06-05

This document tracks the architectural changes recommended in the
June 2026 site audit that are too large for an opportunistic session
fix and need their own dedicated work block with careful regression
testing. Each item below is sequenced, scoped, and has acceptance
criteria ready for pickup.

The audit also recommended six smaller changes. Those have shipped:

| ID | Item | Shipped |
|---|---|---|
| F248 | Defensive helper for place-vs-county data masking (P0-3) | ✅ |
| F249 | Surface fetch failures in the UI (P0-2) | ✅ |
| F250 | Methodology version stamping (P2-7) + plausibility test env (P2-9) | ✅ |

The three items below are open and remain the top-leverage architectural
work.

---

## 1. Score engine unification (P0-1)

**The problem.** The same jurisdiction returns slightly different scores
on the Opportunity Finder, the Compare page, the Housing Needs
Assessment, and the IndiBuild internal Where-Should-I-Build view.
Each consumer computes its own score from its own copy of the inputs.
The numbers are close but they don't tie, and a user who notices loses
trust.

**The fix.** Build one shared `score-engine` module that every page calls.
Single exported function:

```js
// js/score-engine/index.js
function computeScore(jurisdiction, dealType, options = {})
  → ScoreResult { dimensions: {...}, weights: {...},
                  composite: 0-100, provenance: {...},
                  confidence: 'high'|'medium'|'low',
                  methodologyVersion: 'v2.4-2026-04-22' }
```

**Why it's hard.** There are 8 scoring sites currently:
1. `js/lihtc-opportunity-finder.js` — OF table + detail
2. `js/hna/hna-renderers.js` — HNA scorecard
3. `js/compare.js` — Compare table
4. `js/market-analysis.js` — PMA site score (different math; separate engine)
5. `js/deal-calculator.js` — uses scores as input
6. `js/co-lihtc-map.js` — colorado-deep-dive map color-coding
7. `js/ic-summary.js` — IC packet PDF export scoring
8. `js/components/site-score.js` — site-score component

Each has subtle differences (CDP penalty value, civic boost stacking,
basis-boost cap, percentile-rank cutpoints) that may be intentional
divergence or pure drift. Without a regression harness that captures
today's numbers per jurisdiction first, refactoring risks moving every
number on the site at once.

### Acceptance criteria

1. **Regression snapshot.** Before any code change, generate a baseline
   snapshot: for every (jurisdiction, dealType) combination, record
   every scoring site's current output. Stored at
   `test/score-engine-baseline.json`.
2. **Single `score-engine` module** exporting `computeScore(jurisdiction, dealType, options)`.
   Pure function. No DOM. No fetch. Takes all required data as inputs.
   Returns the `ScoreResult` shape above.
3. **Each of the 8 consumers migrated** to call the score engine. Inline
   scoring logic deleted. Where divergence was intentional, the engine
   takes an `options.variant` argument (`'standard'|'pma'|'ic-summary'`)
   that selects the right weight table or post-processing step.
4. **Snapshot diff < 0.5 points** for 95%+ of jurisdictions (small drift
   from float-precision normalization is acceptable). Each remaining
   divergence is explicitly documented with rationale.
5. **Test suite.** `test/score-engine.test.js` covering each variant +
   each dimension + boundary cases (missing data, low-confidence flags,
   zero-population, CDPs, place-vs-county fallback).
6. **Methodology version bumped** in `data/policy/methodology-version.json`
   to reflect the unification (e.g. `v3.0-YYYY-MM-DD`).
7. **Visible stamp** on every score on the site (use
   `MethodologyStamp.render()`, F250) so users know what version produced
   each number.

### Effort

- Snapshot generation: 1 day
- Engine module + variants: 2 days
- Consumer migrations: 1-2 days (8 sites)
- Test suite: 1 day
- Reconciliation of divergences: 0.5-1 day
- **Total: 5-7 days focused work**

### Risk

The most error-prone refactor in the codebase. A single off-by-one
dimension weight changes 482 published scores. Mitigated by the
snapshot-diff acceptance criterion.

---

## 2. Back-test the Opportunity Finder against historic CHFA awards (P1-4)

**The problem.** There is no validation that places we score A+
actually win Colorado tax-credit allocations at higher rates than
places we score B. The model is defensible as a heuristic, but its
predictive power is unproven. A careful underwriter will ask.

**The fix.** Build a back-test harness that:
1. Ingests the 10 years of CHFA award history we already track in
   `data/policy/chfa-awards-historical.json`.
2. For each historic year, freezes all model inputs at what they
   were that year (ACS vintage, HUD income limits, QCT/DDA designations,
   civic readiness as of that date).
3. Runs the current scoring model against those inputs.
4. Compares model score quantiles against actual award outcomes.

Reports:
- Top-decile prediction accuracy ("Among the top-10% scored jurisdictions
  in 2018, X% won awards in 2019-2020").
- Calibration plot (predicted-rank vs. actual-award-rate).
- Per-dimension predictive power (which of the 5 dimensions actually
  carries signal? which is noise?).
- Out-of-sample test (train on years N-5 to N-1, test on year N).

Outputs:
- `docs/OPPORTUNITY-FINDER-BACKTEST-RESULTS.md` published with the
  methodology page so any user can read the validation.
- `data/audit/opportunity-finder-backtest.json` machine-readable for
  the Data Health dashboard.

### Acceptance criteria

1. Historic input freeze per year (ACS vintage, HUD vintage, QCT/DDA
   designations as of each year).
2. Score harness that runs the current scoring engine (F250 unification
   makes this single-call instead of 8 sites).
3. Per-year quantile vs. award-rate table.
4. Out-of-sample evaluation: drop the most recent year, train on the
   rest, predict the held-out year's awards.
5. Published results document (markdown) with honest framing — if the
   model lacks predictive power, say so plainly.
6. Re-runnable via `node scripts/audit/backtest-of.mjs`.

### Effort

- Historic input freeze logic: 1.5 days
- Score harness: 0.5 day (assuming P0-1 is done)
- Quantile/calibration analysis: 1 day
- Output documents: 0.5 day
- Honest framing + reviewer pass: 1 day
- **Total: 4-5 days focused work**

### Dependencies

Best done **after P0-1 score engine unification** so the harness only
has to call one function.

---

## 3. Preview deployment / staging environment (P1-5)

**The problem.** Every push to `main` ships live. Continuous Integration
catches structural failures (broken JSON, missing files, JavaScript
syntax errors), but a styling regression or content typo that compiles
cleanly goes straight to production. Mean time to detection depends on
a user noticing. Rollback is fast (one revert) but the window is open.

**The fix.** Switch from push-to-main shipping to PR-based shipping
with auto-deployed previews.

### Acceptance criteria

1. **GitHub Pages preview environment.** New workflow `.github/workflows/preview-deploy.yml`
   that runs on `pull_request` events. Deploys the PR's branch to a
   preview URL like `pr-XYZ.preview.cohoanalytics.com` (or under a
   GitHub Pages subpath if subdomain DNS adds complexity).
2. **Preview URL posted as PR comment** by a bot account.
3. **CI gate.** Existing CI checks remain required to merge.
4. **Main deploys unchanged.** Pushes to `main` continue to deploy
   production as today; no double-deploy.
5. **Documented rollback.** `docs/OPERATIONS-DEPLOY.md` explains the
   new flow.

### Effort

- Preview workflow: 1 day
- DNS / GitHub Pages configuration: 0.5 day
- PR comment integration: 0.5 day
- Documentation: 0.5 day
- **Total: 2-3 days, mostly infrastructure**

### Risk

Low. The preview environment is read-only and isolated from production.
Worst case: the preview workflow fails and the team merges without
previewing — the same as today.

### Not recommended (yet)

- **Moving off GitHub Pages.** Cloudflare Pages and Vercel offer
  richer preview tooling, but the boss report correctly notes the
  current setup is "fast and free with one-commit rollback." Not worth
  the migration cost yet.

---

## Sequencing

1. **F248-F250 already shipped** ✓
2. **P0-1 score engine** (5-7 days) — single biggest credibility lift,
   everything else easier or dependent on it.
3. **P1-5 preview deploys** (2-3 days) — buys safety for everything
   that follows.
4. **P1-4 back-test** (4-5 days) — answers "does this actually predict?"
   and surfaces calibration issues from #1.
5. P2 items as capacity allows.

Total P0/P1 architectural work: **~12-15 focused-engineering days** for
one engineer, or **~8 days parallelized** across two.
