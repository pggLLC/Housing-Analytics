# Codex Audit Sweep - 2026-07-04

Scope: merged changes after `2ec44cbb1` through Task A hotfix merge `9a011262b`.

## Summary

No confirmed code/data defects found that require an immediate fix PR. One process finding remains on #1026: the PR body says the A+B ranking tuning was owner-picked, and the PR author is the repo owner, but the PR discussion thread itself has only bot comments, so there is no separate owner-approval comment in-thread for the reversal recorded as deferred in the 2026-07-03 handoff.

## Findings

### 1. #1026 - Apply A+B ranking tuning

Verdict: Process caveat; no confirmed code defect.

Evidence:
- PR #1026 body says it applies "owner-picked ranking tuning"; PR author is `paulglasow`.
- PR comments fetched from GitHub contain only bot QA/contrast comments, so the audit could not confirm a separate owner approval from the PR thread itself.
- Current `scripts/hna/build_ranking_index.py` still has `COMMUTER_AUGMENT_ALPHA = 0.20`, `GAP_COUNT_WEIGHT = 0.4`, and `GAP_RATE_WEIGHT = 0.6`.
- The commuter term remains augment-only: the final score is `community_need_core * (1 + COMMUTER_AUGMENT_ALPHA * (commuter_pressure / 100.0))`.
- The checked-in face-validity report `docs/qa/ranking-tuning-ab-2026-07-03.md` matches the #1026 body for the A+B scenario values and bounded rank movement.
- Post-Task-A top-50 changed from the pre-hotfix report, as expected after AMI-gap regeneration; it remains face-valid and dominated by Boulder/Front Range/resort high-need entries rather than obvious artifacts.

### 2. #1025 - CAR fallback hardening

Verdict: OK.

Evidence:
- The hardcoded month list is gone. `buildCARFallbackUrls(now, lookbackMonths)` walks months dynamically newest-first.
- `tryLoadCARFallback` keeps county-aware selection: newest report with selected county wins; otherwise newest real statewide report is retained as fallback.
- Missing/failing months stay quiet via the fetch `.catch(function () { return loadAt(i + 1, fallback); })` path.
- `node test/hna-car-loader.test.js` passed.

### 3. #1028 - CAR monthly cron dependency loading

Verdict: OK, with title hygiene noted.

Evidence:
- PR title was merged with a `Draft:` prefix, as flagged by the work order.
- `.github/workflows/car-data-update.yml` now runs `npm ci` before `node scripts/fetch-car-showingtime.mjs`.
- `package.json` lists `jsdom` under `dependencies`, and the fetcher wraps `require('jsdom')` with a best-effort no-write exit if unavailable.
- After `npm install --ignore-scripts`, the local fixture dry-run resolved `jsdom` and exited 0: `node scripts/fetch-car-showingtime.mjs --month 2026-05 --fixture-dir test/fixtures/car-showingtime --min-populated 4`.
- `node test/car-showingtime-fetcher.test.mjs` passed.

### 4. #1027 - Ranking scenario overlays

Verdict: OK.

Evidence:
- Task A regenerated `data/hna/ranking-index.json` first, then rebuilt all five `data/hna/ranking-scenarios/*.json` overlays.
- Current canonical `metadata.generatedAt` is `2026-07-04T19:36:54Z`.
- Each scenario file has `metadata.based_on = 2026-07-04T19:36:54Z` and 547 slim ranking rows.
- `node test/ranking-scenarios.test.js` passed.

### 5. #1029 - ZORI capture rescue

Verdict: OK.

Evidence:
- `lihtc-opportunity-finder.html` and `deal-calculator.html` both load `js/components/zori-rent-utils.js`.
- Deal calculator uses `ZoriRentUtils.getCountyRent` and `ZoriRentUtils.getPerBedroomRent`; Opportunity Finder uses `ZoriRentUtils.getCountyRent` while keeping FMR as the sortable baseline.
- Spot checks for Denver (`08031`), La Plata (`08067`), and Weld (`08123`) returned shared county ZORI and FMR-ratio-scaled per-bedroom outputs from the helper.
- `node test/lihtc-opportunity-finder-zori-capture.test.js` passed.

### 6. #1033 - Projector vacancy guard

Verdict: OK.

Evidence:
- `computeActiveMarketTargetVacancy` rejects implausible vacancy rate fields outside 0-30% before rendering.
- Statewide summary now has sane DP04 vacancy-rate semantics after #1036 (`DP04_0004E = 0.9`, `DP04_0005E = 4.6`).
- County examples remain sane: Garfield uses rental-only `3.0%`; La Plata uses rental-only `5.8%`.
- Projection caches expose active/total vacancy values in decimal form for fallback rendering.

### 7. #1036 - Statewide summary cache

Verdict: OK.

Evidence:
- `data/hna/summary/08.json` now stores real DP04 semantics: statewide total units `2,662,111`, homeowner vacancy `0.9%`, rental vacancy `4.6%`, detached units `1,628,288`, median income `$97,113`.
- Statewide unit counts are close to the sum of county caches (`2,662,111` statewide vs `2,665,068` county sum), with expected ACS-series/vintage tolerance.
- `.github/workflows/build-hna-data.yml` includes Phase 2.5 to refresh `data/hna/summary/08.json`, supports `statewide_only`, and runs `scripts/fetch_census_state_hna.py --validate-counties`.

### 8. #1032 - AMI methodology v2

Verdict: OK.

Evidence:
- Both AMI gap files have file-level `meta.methodology_version = 2` and `meta.demand_tenure = "renter"`.
- All 64 county rows and 482 place rows have `demand_tenure = "renter"`.
- Both files retain `all_households_le_ami_pct` for transparency while using renter-household demand for gaps.
- Sign convention remains as documented: county file stores units minus households where negative means deficit; place file stores positive deficit values.

### 9. Quarantine-bot commits

Verdict: OK for the latest bot commit; historical caution remains warranted.

Evidence:
- Latest bot commit after Task A, `8eb031fb1`, touched only documentation files: `docs/DATA_SOURCES_TABLE.md`, `docs/GENERATED-INVENTORY.md`, `docs/SITE-DESIGN-AUDIT.md`, `docs/data-architecture.md`, `docs/data-sources-audit.md`, and `docs/implementation-status.md`.
- It did not delete generator scripts.
- History confirms the known risk class: earlier bot commit `915423536` deleted `scripts/hna/build_ranking_scenarios.py`, but that generator exists again in the current tree and was used for Task A.

## Commands Run

- `node test/hna-car-loader.test.js`
- `npm install --ignore-scripts`
- `node scripts/fetch-car-showingtime.mjs --month 2026-05 --fixture-dir test/fixtures/car-showingtime --min-populated 4`
- `node test/car-showingtime-fetcher.test.mjs`
- `node test/lihtc-opportunity-finder-zori-capture.test.js`
- `node test/ranking-scenarios.test.js`

Note: the CAR fixture dry-run rewrote `data/car-market-report-2026-05.json` as expected; the generated file was restored before this audit commit.
