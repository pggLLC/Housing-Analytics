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

**Files to change:**
1. `scripts/hna/build_hna_data.py` — add `B25003_001E` and `B25003H_001E` to the existing B-series fetch function (~line 630-720, same function that already fetches `B25024`/`B25070`/`B25091`). No new fetch infrastructure needed; this is two more variable codes in an existing, proven request.
2. `scripts/hna/build_jurisdiction_metrics_digest.mjs` — add `pct_bipoc_households` to `regionalComparisonMetrics()` (~line 382-416), same pattern as every other metric in that function:
   ```js
   pct_bipoc_households: acsRegionalMetric(
     pctFromCounts(sumNumbers([acs.B25003_001E]) - sumNumbers([acs.B25003H_001E]), acs.B25003_001E),
     entry,
     'acs-b25003',
     'occupied_housing_units',
     acs.B25003_001E,
   ),
   ```
3. `js/hna/hna-renderers.js` — add a row to `REGIONAL_COMPARISON_ROWS` (Demographics section): `{ section: 'Demographics', label: 'BIPOC households', key: 'pct_bipoc_households', format: 'pct' }`. This label is accurate as-is — unlike Phase 1b's population-level metric, this one genuinely is a household statistic, so "BIPOC households" is the correct, non-misleading label here (the opposite framing caution from Phase 1b applies in reverse: don't accidentally call *this* one "population").

**Generated artifacts**: regenerate `data/hna/jurisdiction-metrics-digest/*.json` via `build-hna-data.yml`, same as Phase 1/1b.

**Relationship to Phase 1b**: this and the population-level metric are both real, correct, and answer different questions — recommend shipping both as separate Demographics rows ("Population identifying as BIPOC" and "BIPOC households"), not choosing one over the other. They will read differently (household composition skews the household-level number relative to population share, as seen above: Garfield 28.3% households vs. ~38.5% population), and that gap is itself informative, not a discrepancy to resolve.

**Data availability**: `B25003`/`B25003H` are standard Detail Table tenure iterations, same publication tier as the already-fetched `B25024`/`B25070`/`B25091` — no reason to expect worse small-place coverage than those. Spot-check a small place (e.g. Silt, Parachute) during implementation as a final confirmation, same as every other new field this session got checked before shipping, but this is a formality at this point, not an open risk.

## Tests Codex must add

Same shape as Phase 1b's §4:
1. Sane bounds: `0 <= pct_bipoc_households <= 100` for every geography.
2. Recompute independently from raw `acsProfile` fields in the test (not just internal consistency with the digest's own formula).
3. Fixture values: Garfield County **28.3%**, Aspen **21.8%** — cite this doc and the EPS report Table 9 as the independent source in the test comment.
4. Label regression: confirm the row label says "households," distinguishing it from Phase 1b's population-level row (guards against the two getting mislabeled or swapped).

## QA gate

```
npm run test:jurisdiction-metrics-digest
npm run test:hna
npm run validate
```
Rendered smoke: `housing-needs-assessment.html?geos=08045+0803620&combinedMode=regional`, confirm both the population-level row (Phase 1b, if merged) and this household-level row appear, with visibly different values, both labeled correctly.

## Owner decision points

1. Ship alongside Phase 1b (both rows) or standalone — recommend both, see "Relationship to Phase 1b" above.
2. Exact label wording — "BIPOC households" is accurate and matches the EPS report's own term for the concept it measures (unlike Phase 1b, where reusing their label would have been misleading).
3. Sequencing — this can implement independently of Phase 1b; they touch the same functions but different metrics/fields, no ordering dependency.

## Final Codex implementation prompt (paste after owner approval)

> Implement the household-level BIPOC metric from `docs/audits/SCOPING-HOUSEHOLD-RACE-B25006-2026-07.md`. Add `B25003_001E` and `B25003H_001E` to the existing B-series ACS fetch in `scripts/hna/build_hna_data.py`. Add `pct_bipoc_households` to `regionalComparisonMetrics()` in `scripts/hna/build_jurisdiction_metrics_digest.mjs` using the formula and pattern in this doc. Add the row to `REGIONAL_COMPARISON_ROWS` in `js/hna/hna-renderers.js` labeled "BIPOC households." Regenerate all jurisdiction-metrics-digest artifacts via `build-hna-data.yml`. Add the four tests in this doc's "Tests Codex must add" section, including the Garfield County (28.3%) and Aspen (21.8%) fixtures. Run `test:jurisdiction-metrics-digest`, `test:hna`, and `validate`, plus a live-browser rendered smoke check. Mark the PR "do not merge until external QA completes."

---

## Revision history

**2026-07-10, second pass**: superseded the original conclusion. First pass checked `B25006` (race-only, confirmed no ethnicity dimension) and `B11001I` (Hispanic household-type, wrong table concept) and concluded no cross-tab existed. Checking `B25003`'s full race/ethnicity iteration set found `B25003H` (White alone, Not Hispanic householder) — confirmed against the live Census API and validated by exactly reproducing the EPS report's own published Garfield County (28.3%) and Aspen (21.8%) BIPOC-household figures. This is now a real, verified, low-risk implementation handoff, not an open research question.
