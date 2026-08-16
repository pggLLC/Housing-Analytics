# Scoping — Household-Level Race/Ethnicity Metric (2026-07)

**Status: RESOLVED.** The blocking question this doc originally raised (does a household-level race+ethnicity cross-tab table exist?) is answered: **yes.** This doc now specs a real implementation, not an open research question. See revision history at the bottom for what changed and why.

**For**: Codex (implementer) — pending owner approval of label/scope, same as Phase 1b.
**QA**: Claude Code reviews the PR against the gate below before the owner merges.
**Owner**: paulglasow
**Repo**: `pggLLC/Housing-Analytics`
**Triggered by**: Regional Comparison Phase 1b (`docs/audits/CODEX-HANDOFF-REGIONAL-COMPARISON-PHASE1B-RACE-ETHNICITY-2026-07.md`) deferred the EPS report's household-level "BIPOC Households" metric as needing further research. This doc is that research, now complete, with a verified formula that reproduces the EPS report's own published numbers exactly.

## The metric, verified

**Formula**: `BIPOC households % = (Total occupied housing units − White-alone-Not-Hispanic-householder occupied units) / Total occupied housing units × 100`

**Exact Census fields** (Detail Table B25003, "Tenure," and its race/ethnicity iteration `B25003H`):
- Numerator: `B25003_001E − B25003H_001E`
- Denominator: `B25003_001E`

`B25003H`'s universe, confirmed directly against the Census API, is literally "Occupied housing units with a householder who is White alone, not Hispanic or Latino" — the household-level equivalent of DP05's `DP05_0096E` used in the population-level metric (Phase 1b). Same complement methodology, different underlying tables, same reasoning for why it avoids double-counting (mutually-exclusive by Census's own table design, same as the population case).

**This is not a proxy or an approximation — it's confirmed to exactly reproduce the EPS report's own published figures**, independently, on two geographies:

| Geography | B25003 total | B25003H (Not-Hispanic-White) | Computed BIPOC households % | EPS report's own Table 9 figure (2024) |
|---|---:|---:|---:|---:|
| Garfield County (`08045`) | 23,404 | 16,776 | **28.3%** | **28.3%** (exact match) |
| Aspen (`0803620`) | 4,105 | 3,209 | **21.8%** | **21.8%** (exact match) |

Both fetched live from Census Reporter's B25003/B25003H tables, ACS 2024 5-year, and compared against the report's actual printed values (I read the PDF directly earlier in this work). This confirms `B25003`/`B25003H` is the right table pair and the complement formula is the right methodology — not just plausible, but numerically exact on two independent test cases.

## Why the original version of this doc got it wrong

The first pass checked `B25006` (Race of Householder) and `B11001I` (Household Type, Hispanic-or-Latino iteration) and concluded no single table cross-tabbed race and ethnicity together. That conclusion was correct about those two tables, but incomplete — it didn't check Census's *tenure*-table race/ethnicity iterations (`B25003A` through `B25003I`), where the "H" iteration (White alone, Not Hispanic) is exactly the missing piece. Worth naming plainly: the first pass stopped one table short of the answer. Flagging this so the same gap doesn't recur — when checking whether a race/ethnicity iteration exists for a concept, check the full iteration set (`A` White alone, `B` Black alone, `C` AIAN alone, `D` Asian alone, `E` NHPI alone, `F` Some other race alone, `G` Two or more races, `H` White alone Not Hispanic, `I` Hispanic or Latino) before concluding one doesn't exist.

## Implementation scope

**Correction (post-QA, see revision history)**: the original version of this section was wrong about the fetch path, and also overstated an existing claim. Both are fixed below.

**`B25024`/`B25070`/`B25091` are NOT actually populated for normal geographies today.** I said the fetch pattern for these was "proven, working" — that was true of the code as written, but misleading about what it actually does in practice. Verified directly: neither Garfield County's nor Aspen's current `acsProfile` cache contains `B25070_007E`, `B25024_002E`, or `B25003_001E` at all. The function holding those variables, `_fetch_acs5_b_series()` (`scripts/hna/build_hna_data.py:635`), is called from exactly one place (`fetch_acs_profile()`, line 979) — **only when the primary DP-profile fetch (batch A) fails entirely for a geography**. For the overwhelming majority of real geographies, including every one this session actually inspected, batch A succeeds, so this function never runs and none of its variables — old or newly added — land in the cached summary. Adding `B25003_001E`/`B25003H_001E` to this function's variable list would do nothing for Garfield, Aspen, or any other normally-fetched geography.

**Correct implementation path — an always-run supplement, not the fallback:**
1. `scripts/hna/build_hna_data.py`, inside `fetch_acs_profile()` — add a new, unconditional Detail Table fetch that runs for every geography regardless of whether batch A/B/C/D succeeded, modeled on the `supplements` loop (~line 990-995: `('C', vars_c, ...)`, `('D', vars_d, ...)`) but hitting the Detail Table endpoint instead of the Data Profile endpoint. `_fetch_batch()` (line 946) is hardcoded to `/acs/{series}/profile` — it cannot fetch `B25003`/`B25003H`, which live at `/acs/{series}` (no `/profile` suffix), the same endpoint shape already used inside `_fetch_acs5_b_series()` (see its `build_url`-equivalent construction there for the exact query-string pattern, including the manual colon-preserving encoding for `for=`/`in=`). Concretely: add a small helper (e.g. `_fetch_acs5_detail(year, batch_vars)`) that queries that endpoint with `['B25003_001E', 'B25003H_001E']`, call it unconditionally after the `supplements` loop, and merge its result into `merged` the same way batch C/D are merged (`merged.setdefault(k, v)` — don't overwrite if a key already exists from an earlier batch).
2. Confirm after implementing: `data/hna/summary/08045.json` and `.../0803620.json` (Garfield, Aspen) actually contain `B25003_001E`/`B25003H_001E` post-regeneration. This is not a formality — it's the check that would have caught the original version of this doc's mistake before it shipped.
3. `scripts/hna/build_jurisdiction_metrics_digest.mjs` — add `pct_bipoc_households` to `regionalComparisonMetrics()` (~line 382-416). **Use a dedicated helper with explicit null-checking on both raw fields before subtracting** — do not subtract two `sumNumbers()` calls directly (see the null-coercion bug this doc originally proposed, corrected below). Follow the exact shape of `housingBuiltPre1970Pct()` (~line 373-380), which already handles a similar multi-field computation safely:
   ```js
   function bipocHouseholdsPct(acs) {
     const total = numberOrNull(acs.B25003_001E);
     const nonHispanicWhite = numberOrNull(acs.B25003H_001E);
     if (total == null || nonHispanicWhite == null) return null;
     return pctFromCounts(total - nonHispanicWhite, total);
   }
   ```
   then in `regionalComparisonMetrics()`:
   ```js
   pct_bipoc_households: acsRegionalMetric(
     bipocHouseholdsPct(acs),
     entry,
     'acs-b25003',
     'occupied_housing_units',
     acs.B25003_001E,
   ),
   ```
   **Why the original snippet was a real bug, not just a style nitpick**: `sumNumbers([acs.B25003_001E]) - sumNumbers([acs.B25003H_001E])` — `sumNumbers()` returns `null` (not `0`) when its input is missing (confirmed at `build_jurisdiction_metrics_digest.mjs:291-301`). If `B25003H_001E` were ever missing for a geography while `B25003_001E` succeeded, JavaScript would coerce `null` to `0` in the subtraction (`someTotal - null` evaluates to `someTotal`, not `NaN`), so the metric would silently compute `pctFromCounts(total, total)` — a false **100% BIPOC households** — instead of correctly returning unavailable. `pctFromCounts`'s own null-check operates on the already-computed (and by then already-corrupted) difference, so it can't catch this after the fact. The fields must be null-checked individually, before the subtraction, which is what the corrected helper above does.
4. `js/hna/hna-renderers.js` — add a row to `REGIONAL_COMPARISON_ROWS` (Demographics section): `{ section: 'Demographics', label: 'BIPOC households', key: 'pct_bipoc_households', format: 'pct' }`. This label is accurate as-is — unlike Phase 1b's population-level metric, this one genuinely is a household statistic, so "BIPOC households" is the correct, non-misleading label here (the opposite framing caution from Phase 1b applies in reverse: don't accidentally call *this* one "population").

**Generated artifacts**: regenerate `data/hna/jurisdiction-metrics-digest/*.json` via `build-hna-data.yml`, same as Phase 1/1b. This regeneration is load-bearing here in a way it wasn't for other metrics — until it runs (and the new always-run fetch actually executes, not the fallback), `data/hna/summary/*.json` has no `B25003_001E`/`B25003H_001E` for any geography, and the digest metric will be `null` everywhere.

**Relationship to Phase 1b**: this and the population-level metric are both real, correct, and answer different questions — recommend shipping both as separate Demographics rows ("Population identifying as BIPOC" and "BIPOC households"), not choosing one over the other. They will read differently (household composition skews the household-level number relative to population share, as seen above: Garfield 28.3% households vs. ~38.5% population), and that gap is itself informative, not a discrepancy to resolve.

**Data availability**: `B25003`/`B25003H` are standard Detail Table tenure iterations, same publication tier as `B25024`/`B25070`/`B25091` — no reason to expect worse small-place coverage than those (which, per the correction above, is itself unverified for the normal-fetch path; don't cite those three as a reliability precedent without checking). Spot-check a small place (e.g. Silt, Parachute) after implementing to confirm the new supplement actually populates for a low-population geography, not just Garfield/Aspen.

## Tests Codex must add

Same shape as Phase 1b's §4, plus one new item specific to this metric's fetch-path fix and null-safety bug:
1. Sane bounds: `0 <= pct_bipoc_households <= 100` for every geography.
2. Recompute independently from raw `acsProfile` fields in the test (not just internal consistency with the digest's own formula).
3. Fixture values: Garfield County **28.3%**, Aspen **21.8%** — cite this doc and the EPS report Table 9 as the independent source in the test comment.
4. Label regression: confirm the row label says "households," distinguishing it from Phase 1b's population-level row (guards against the two getting mislabeled or swapped).
5. **Fetch-path regression**: assert `B25003_001E`/`B25003H_001E` are present in a *normal* (non-fallback) geography's regenerated summary cache — e.g. Garfield County, which is known to succeed on batch A. This is the test that would have caught this doc's original mistake; don't skip it even though it feels redundant with #1/#3.
6. **Null-safety regression**: unit-test `bipocHouseholdsPct()` (or equivalent) directly with a fixture where `B25003_001E` is present but `B25003H_001E` is `null`/missing, and assert the function returns `null` — not `100`. This is the regression guard for the coercion bug described in the Implementation scope section above.

## QA gate

```
npm run test:jurisdiction-metrics-digest
npm run test:hna
npm run validate
```
Additional check specific to this metric (not needed for a metric that only touches already-fetched fields, but required here since this adds a new always-run fetch): after regenerating via `build-hna-data.yml`, directly inspect `data/hna/summary/08045.json` and confirm `acsProfile.B25003_001E` and `acsProfile.B25003H_001E` are present and numeric — don't rely on the digest output alone to infer the fetch worked, since a silently-`null` digest value and a genuinely-missing raw field look the same from the digest side.

Rendered smoke: `housing-needs-assessment.html?geos=08045+0803620&combinedMode=regional`, confirm both the population-level row (Phase 1b, if merged) and this household-level row appear, with visibly different values, both labeled correctly.

## Owner decision points

1. Ship alongside Phase 1b (both rows) or standalone — recommend both, see "Relationship to Phase 1b" above.
2. Exact label wording — "BIPOC households" is accurate and matches the EPS report's own term for the concept it measures (unlike Phase 1b, where reusing their label would have been misleading).
3. Sequencing — this can implement independently of Phase 1b; they touch the same functions but different metrics/fields, no ordering dependency.

## Final Codex implementation prompt (paste after owner approval)

> Implement the household-level BIPOC metric from `docs/audits/SCOPING-HOUSEHOLD-RACE-B25006-2026-07.md`. **Read the "Implementation scope" section carefully — the fetch path is not what it looks like at first glance.** `B25003_001E`/`B25003H_001E` must be fetched via a new, unconditional (always-run) Detail Table supplement inside `fetch_acs_profile()` in `scripts/hna/build_hna_data.py`, modeled on the `supplements` loop pattern (batches C/D) but hitting the `/acs/{series}` Detail Table endpoint, not `/acs/{series}/profile`. Do **not** add these fields to `_fetch_acs5_b_series()` — that function only runs as a fallback when the primary profile fetch fails entirely, and would leave these fields absent for normal geographies like Garfield County and Aspen. After implementing, directly inspect a regenerated `data/hna/summary/08045.json` to confirm the fields actually landed there. Add `pct_bipoc_households` to `regionalComparisonMetrics()` in `scripts/hna/build_jurisdiction_metrics_digest.mjs` via a dedicated `bipocHouseholdsPct()` helper that null-checks `B25003_001E` and `B25003H_001E` individually *before* subtracting — do not subtract two `sumNumbers()` calls directly, since a missing `B25003H_001E` would silently coerce to a false 100% rather than correctly returning null. Add the row to `REGIONAL_COMPARISON_ROWS` in `js/hna/hna-renderers.js` labeled "BIPOC households." Regenerate all jurisdiction-metrics-digest artifacts via `build-hna-data.yml`. Add all six tests in this doc's "Tests Codex must add" section, including the fetch-path regression, the null-safety regression, and the Garfield County (28.3%) / Aspen (21.8%) fixtures. Run `test:jurisdiction-metrics-digest`, `test:hna`, and `validate`, plus a live-browser rendered smoke check. Mark the PR "do not merge until external QA completes."

---

## Revision history

**2026-07-10, second pass**: superseded the original conclusion. First pass checked `B25006` (race-only, confirmed no ethnicity dimension) and `B11001I` (Hispanic household-type, wrong table concept) and concluded no cross-tab existed. Checking `B25003`'s full race/ethnicity iteration set found `B25003H` (White alone, Not Hispanic householder) — confirmed against the live Census API and validated by exactly reproducing the EPS report's own published Garfield County (28.3%) and Aspen (21.8%) BIPOC-household figures. This is now a real, verified, low-risk implementation handoff, not an open research question.

**2026-07-10, third pass (post-Codex-QA)**: Codex's external QA on the resulting PR confirmed the B25003/B25003H table pair and fixture values are correct, but caught two real implementation-scope defects in the second pass's guidance, both fixed here: (1) the doc directed adding the new fields to `_fetch_acs5_b_series()`, which is fallback-only and never runs for normal geographies — confirmed directly that Garfield's and Aspen's current summary caches contain none of that function's variables, including the three (`B25024`/`B25070`/`B25091`) this doc previously cited as an already-proven pattern for normal geographies, which was itself an overstatement; corrected to specify a new always-run Detail Table supplement instead. (2) the proposed digest snippet subtracted two `sumNumbers()` calls directly, which silently coerces a missing `B25003H_001E` to a false 100% via JavaScript's `null` arithmetic rather than correctly returning unavailable; corrected to a dedicated helper with explicit per-field null-checking before the subtraction.
