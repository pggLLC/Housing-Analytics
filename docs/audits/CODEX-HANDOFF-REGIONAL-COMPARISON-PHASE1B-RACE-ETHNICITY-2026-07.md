# Codex — Regional Comparison Phase 1b: Race/Ethnicity Metric (OPTIONAL, 2026-07)

**For**: Codex (implementer) — **do not start until the owner approves the metric definition and label in this doc.**
**QA**: Claude Code reviews the PR against the gate below before the owner merges.
**Owner**: paulglasow (merges; squash-merge convention)
**Repo**: `pggLLC/Housing-Analytics` · Public site: `cohoanalytics.com`
**Status**: Optional follow-on to Regional Comparison Phase 1/2 (PRs #1141, #1142, both merged — see `docs/audits/REGIONAL-COMPARISON-CLOSEOUT-2026-07-10.md`). Not required for those to be considered done.

## Straight answer up front

**Current data cannot support an EPS-report-equivalent "BIPOC Households" metric.** The EPS report's Table 9 measures race/ethnicity of the *household head* (household-level). This repo's DP05 data — even after the #1140 fix that corrected the stale variable codes — is population-level (every person counted individually, not by household). Population-level race share is a real, computable, correct metric; it is a **different statistic** than the report's household metric and will not match its numbers. If the owner wants the household-level equivalent, that requires a new Census table fetch (`B25006`, Race of Householder), not currently pulled anywhere in this repo — a separate, larger effort, not in scope here.

This doc specs the population-level metric as an optional addition, clearly labeled as such. It does not ask Codex to build the household-level version.

## 1. Recommended metric definition

**Formula**: `BIPOC population share = (Total population − Not Hispanic White alone) / Total population × 100`

**Exact DP05 fields** (all already fetched by `scripts/hna/build_hna_data.py` as of the #1140 fix — confirmed at lines 920-921, zero new ACS variable fetches required):
- Numerator: `DP05_0033E − DP05_0096E` (total population minus "Not Hispanic or Latino: White alone")
- Denominator: `DP05_0033E` (total population)

**Is Hispanic/Latino ethnicity included?** Yes. This is the standard, most-inclusive population-level BIPOC definition: everyone who is *either* Hispanic/Latino (any race) *or* non-Hispanic and not white-alone. Census treats Hispanic origin and race as two separate, overlapping axes — a person can be Hispanic and white, Hispanic and Black, non-Hispanic and Asian, etc.

**How double-counting is avoided — this is the part to get right**: do **not** sum the individual "race alone" categories (`DP05_0045E` Black, `DP05_0053E` AIAN, `DP05_0061E` Asian, `DP05_0069E` NHPI, `DP05_0074E` Some Other Race, `DP05_0035E` Two or More) plus `DP05_0090E` (Hispanic, any race). Those categories overlap — a Hispanic person who also identifies as Black is counted in both `DP05_0045E` and `DP05_0090E`, and summing them double-counts. The correct approach uses **the complement of the single, mutually-exclusive "Not Hispanic White alone" cell** (`DP05_0096E`) against total population. `DP05_0096E` sits in DP05's "HISPANIC OR LATINO AND RACE" cross-tabulation section, which by Census design partitions the *entire* population into non-overlapping cells — so `Total − NotHispanicWhiteAlone` is a clean, non-double-counted figure by construction. This is the "non-Hispanic white alone complement" method (recommended), not "summed race/ethnicity groups" (do not use — double-counts).

**Owner consideration, not a Codex decision**: some practitioners report Hispanic/Latino and "BIPOC" (race-based) as two separate rows rather than one collapsed number, since Hispanic/Latino is an ethnicity, not a race, and collapsing them can obscure that a meaningful share of Hispanic residents also identify as white. Both `DP05_0090E/DP05_0033E` (Hispanic share alone) and the complement formula above are already fetched and computable — if the owner prefers two rows over one, that's a small change to §3 below, not a data gap. Flagged as an owner decision in §6.

## 2. Recommended public label and tooltip/disclaimer

**Label: "Population identifying as BIPOC"** or **"BIPOC population share"** — **not** "BIPOC Households." Do not reuse the EPS report's exact label; it would misrepresent what this repo measures.

**Tooltip/disclaimer text** (draft, owner should confirm wording):
> "Share of total population identifying as Hispanic/Latino or as a race other than non-Hispanic White alone (ACS DP05, 2020–2024 5-year, population-level). This is a different measure than 'BIPOC Households' as some consultant reports define it — that measures the race/ethnicity of the household head, a household-level statistic this repo does not currently compute."

## 3. Exact implementation scope

**Files to change:**
1. `scripts/hna/build_jurisdiction_metrics_digest.mjs` — add `pct_bipoc_population` to `regionalComparisonMetrics()` (~line 382-416), following the exact shape of the existing `pct_age_65_plus` entry at line 408:
   ```js
   pct_bipoc_population: acsRegionalMetric(
     pctFromCounts(sumNumbers([acs.DP05_0033E]) - sumNumbers([acs.DP05_0096E]), acs.DP05_0033E),
     entry,
     'acs-profile-dp05',
     'total_population',
     acs.DP05_0033E,
   ),
   ```
   (Adjust null-safety to match this file's existing conventions — `sumNumbers`/`pctFromCounts` already null-guard individual fields; confirm the subtraction doesn't produce `NaN` when a field is legitimately absent, same as the other metrics in this function handle it.)
2. `js/hna/hna-renderers.js` — add one row to `REGIONAL_COMPARISON_ROWS` (~line in the "Demographics" section, next to `pct_age_65_plus`): `{ section: 'Demographics', label: '<approved label from §2>', key: 'pct_bipoc_population', format: 'pct' }`.
3. No changes needed to `scripts/hna/build_hna_data.py` — `DP05_0033E` and `DP05_0096E` are already in the ACS fetch list (confirmed).

**Generated artifacts:** `data/hna/jurisdiction-metrics-digest/*.json` (all ~337 county/place/CDP digests) — regenerate via the existing `build-hna-data.yml` workflow, same as Phase 1. No summary-cache changes needed (the source fields are already cached).

**Explicitly out of scope — do not build these here:**
- Household-level race/ethnicity (`B25006`, Race of Householder) — not fetched anywhere in this repo; a genuinely separate ETL effort if the owner later wants the EPS-equivalent household metric.
- Any change to the single-geography HNA page's existing "Race & ethnicity" section (`js/hna/hna-renderers.js:1035-1123`, fixed in #1140) — that section already shows the full race breakdown; this doc only adds a summary stat to the Regional Comparison table.
- Combined Jurisdictions ("Blended total") mode — not touched.
- Two-row Hispanic/BIPOC split (see §1's owner consideration) — only build this if the owner explicitly requests it in §6.

## 4. Tests Codex must add

Extend `test/jurisdiction-metrics-digest.test.js` (or add to the existing "regional comparison metrics" test):
1. **Sane bounds**: `pct_bipoc_population` is present, numeric, and `0 <= value <= 100` for every county/place/CDP with a valid digest.
2. **Shares-sum sanity**: for a sample geography, confirm `pct_bipoc_population` independently equals `100 - (DP05_0096E / DP05_0033E * 100)` computed straight from the cached `acsProfile`, not just internally consistent with itself — i.e. recompute from the raw source fields in the test, don't just assert the digest agrees with its own formula.
3. **Fixture values, two geographies** (verified against real regenerated data as of 2026-07-10, cite Census Reporter B03002 as the independent source in the test comment, same convention as `test/hna-race-ethnicity-dp05.test.js`):
   - Garfield County (`08045`): `pct_bipoc_population` ≈ **38.5%** (`100 - 61.5`)
   - Aspen (`0803620`): `pct_bipoc_population` ≈ **21.0%** (`100 - 79.0`)
4. **Label regression**: a source-grep assertion on `js/hna/hna-renderers.js` that the row label for `pct_bipoc_population` contains "population" (or explicitly does not contain "Household"/"Households") — this is the guard against silently drifting back toward the EPS report's misleading label.

## 5. QA gate

Exact commands:
```
npm run test:jurisdiction-metrics-digest
npm run test:hna
npm run validate
```
Before/after spot values to include in the PR body: Garfield County and Aspen `pct_bipoc_population`, matching §4's fixture values (38.5% / 21.0%), with the raw `DP05_0033E`/`DP05_0096E` counts shown for each so a reviewer can hand-check the math without re-running the build.

Rendered smoke check (required, live browser): load `housing-needs-assessment.html?geos=08045+0803620&combinedMode=regional`, confirm the new Demographics row appears with the approved label, shows 38.5% / 21.0%, and confirm the label text visually reads "population," not "households."

## 6. Owner decision points

1. **Include or defer this metric entirely?** Data supports the population-level version cleanly; the household-level EPS-equivalent does not exist without new ETL work.
2. **Preferred label** — "Population identifying as BIPOC," "BIPOC population share," or another phrasing. §2's draft is not final.
3. **One row or two?** — collapse Hispanic + non-Hispanic-nonwhite into one "BIPOC" figure (§1's recommended formula), or report Hispanic/Latino share and a separate non-Hispanic-BIPOC share as two distinct rows.
4. **Scope**: Regional Comparison table only (as specced above), or should the same summary stat also surface elsewhere (e.g., a single-geography HNA page summary card, alongside the existing detailed race breakdown)? Default recommendation: Regional Comparison only, for now — keeps this a small, contained addition.

## 7. Final Codex implementation prompt (paste after owner approval)

> Implement `docs/audits/CODEX-HANDOFF-REGIONAL-COMPARISON-PHASE1B-RACE-ETHNICITY-2026-07.md` for the Housing-Analytics repo. The owner has approved: metric = population-level BIPOC share using the non-Hispanic-white-alone complement (`DP05_0033E − DP05_0096E`) / `DP05_0033E`; label = "[owner's approved label from §6]"; [one row / two rows, per §6]; scope = Regional Comparison table only. Add `pct_bipoc_population` to `regionalComparisonMetrics()` in `scripts/hna/build_jurisdiction_metrics_digest.mjs`, add the corresponding row to `REGIONAL_COMPARISON_ROWS` in `js/hna/hna-renderers.js`, regenerate all jurisdiction-metrics-digest artifacts via `build-hna-data.yml`, and add the four tests specified in §4 (bounds, shares-sum sanity against raw ACS fields, Garfield County 38.5% / Aspen 21.0% fixtures, and a label-regression test confirming the row label says "population" not "households"). Run `npm run test:jurisdiction-metrics-digest`, `npm run test:hna`, and `npm run validate`, and do a live-browser rendered smoke check per §5 before opening the PR. Do not touch `js/hna/hna-controller.js`'s ACS fetch list (`DP05_0033E`/`DP05_0096E` are already fetched) or the single-geography HNA page's existing race breakdown section. Mark the PR "do not merge until external QA completes," matching this repo's established convention.
