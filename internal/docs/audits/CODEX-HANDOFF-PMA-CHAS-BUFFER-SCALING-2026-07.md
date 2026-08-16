# Codex Handoff: Fix PMA capture-rate CHAS denominator scoping (#1157)

**For: Codex.** One item. Fixes issue #1157, found during QA follow-up on PR #1156.

**Dependency: merge PR #1156 first.** This fix builds on the `js/market-analysis-scoring.js` helper that #1156 introduces. If #1156 is already merged when you pick this up, proceed; if not, wait.

---

## What's wrong (verified, with file:line)

`scoreCaptureRisk()` prefers a CHAS-based "LIHTC-eligible renter households" denominator over raw ACS renter households. The *source* and *intent* are correct — HUD CHAS is the standard basis for income-qualified renter pools in CHFA-style market studies, and narrowing to ≤80% AMI is the methodologically important part. The bug is geographic scoping:

- The **ACS fallback** denominator is buffer-scoped: `aggregateAcs()` sums `renter_hh` tract-by-tract over buffer tracts, apportioned by `_bufferShare` (`js/market-analysis.js:436`).
- The **CHAS path** (`_chasLihtcEligibleRenters()`, `js/market-analysis.js:662-724`) uses each county's **county-wide** `renter_hh_by_ami` tier totals from `data/hna/chas_affordability_gap.json`, weighted only *between* counties: `w = shareByCounty[fips] / totalShare` sums to 1.0 across counties (line 690). A buffer entirely inside one county gets `w = 1.0` — i.e. the **entire county's** ≤80% AMI renter pool as the demand denominator. The county totals are never scaled down to the buffer footprint.

**Verified magnitude**: Denver County's ≤80% AMI pool in the live data file is 36,499 + 24,032 + 30,282 = **90,813 renter HH**. Any 3–5 mile buffer inside Denver currently uses all 90,813 as its demand pool — larger than the buffer's entire all-income renter population — so the "income-narrowed" path actually *widens* the pool and **understates capture risk** in urban counties. The disclosure at `js/market-analysis.js:1094-1103` compounds this: it warns that the ACS fallback "under-states true LIHTC capture risk," which is backwards in this scenario.

## The fix

Scale each county's CHAS tier totals down to the buffer footprint using data already loaded at the call site. Per county `fips` present in the buffer:

```
bufferRentersInCounty = Σ over buffer tracts t in that county of (acsIdx[t.geoid].renter_hh * t._bufferShare)
chasCountyTotalRenters = lte30 + 31to50 + 51to80 + 81to100 + 100plus   // all 5 tiers, from the same CHAS record
countyScale = min(1, bufferRentersInCounty / chasCountyTotalRenters)
apportionedTier = chasTierTotal * countyScale                          // for lte30, 31to50, 51to80
```

Then sum `apportionedTier` across counties directly. **Delete the old cross-county `w` normalization** — `countyScale` replaces it entirely (the old `w` only normalized *between* counties and is the root cause). Keep the existing uniform-income-distribution assumption, but state it honestly in the comment: we assume the buffer's income mix matches the county's.

Notes on the formula:

- Using the CHAS record's own 5-tier sum as the scaling denominator keeps numerator and denominator internally consistent (same vintage, same universe). Do not fetch county ACS totals for this.
- The ACS-tract numerator (2019-2023 vintage) vs CHAS denominator (2018-2022) mismatch is why the `min(1, …)` cap exists — in small counties the ratio can nudge past 1. Cap it; don't let scaling *inflate* a county's pool.
- Edge case: if `bufferRentersInCounty <= 0` for a county (tracts missing from `acsIdx`), that county contributes 0. If *all* counties contribute 0, return the existing `{ value: null, …, source: 'unavailable' }` shape so `scoreCaptureRisk()` falls back to ACS exactly as today.

## Implementation

1. **Move the computation into the shared helper** (follows #1156's structure): add a pure function `chasLihtcEligibleRenters(chasCounties, bufTracts, acsIdx)` to `js/market-analysis-scoring.js`, exported alongside the existing `score*` functions. It takes `chasData.counties` as a plain argument (no module state), plus the buffer tracts and the tract-metrics index, and returns the same result shape as today: `{ value, tier_breakdown, source, counties }`. Keep the `counties` array's per-county entries (`{fips, share, lihtc_eligible}`) but make `share` the new `countyScale` and document that in the JSDoc.
2. **Delegate from `js/market-analysis.js`**: `_chasLihtcEligibleRenters()` becomes a thin wrapper calling `PMAScoring.chasLihtcEligibleRenters(chasData && chasData.counties, bufTracts, acsIdx)`.
3. **Thread `acsIdx` through**: the call site is `computePma()` (`js/market-analysis.js:988`, CHAS call at line 995). Its only caller is at line 2277, where `acsIdx` is already in scope (built at line 2161 via `buildAcsIndex`). Add `acsIdx` as a parameter to `computePma` and pass it down. Two signatures change, nothing else.
4. **Fix the one-sided disclosure** at `js/market-analysis.js:1094-1103`: when the CHAS path IS used, the metadata/note should say the pool is county-income-mix scaled to the buffer (approximation), not imply CHAS is strictly conservative. Keep the existing warning for the ACS-fallback case — that one is accurate.
5. **Tests** — extend `test/pma-scoring.test.js` (which after #1156 `require()`s the real helper):
   - Fixture A (the bug): one county, CHAS county total 10,000 renters (e.g. tiers 2500/2500/2500/1250/1250, so ≤80% pool = 7,500), buffer tracts summing to 1,000 ACS renters (`_bufferShare` respected). Assert `value ≈ 750` (7,500 × 0.10), **not** 7,500. Assert `tier_breakdown` scales the same way.
   - Fixture B (cap): buffer renters exceeding the CHAS county total → assert scale caps at 1 (value equals the full ≤80% pool, never more).
   - Fixture C (multi-county): two counties with different scales → assert the total is the sum of independently-scaled county pools, not a cross-county blend.
   - Fixture D (unavailable): empty/missing `acsIdx` entries → assert `source: 'unavailable'` and `scoreCaptureRisk` falls back to `acs_total_renter_hh`.
   - The tests must call the exported helper function directly. No new npm script needed — `test:pma-scoring` is already wired into `test:ci` by #1156.

## QA gate

- Run `npm run test:pma-scoring` and full `npm run test:ci`.
- **Prove Fixture A non-vacuous**: temporarily revert the scaling (set `countyScale = 1` unconditionally), confirm Fixture A fails with value 7,500 vs expected 750, then restore and confirm it passes.
- Browser smoke on `market-analysis.html`: run a PMA in a populous county (Denver-area site), confirm the capture-rate tile still renders, the denominator in the PMA metadata is now buffer-scale (thousands, not ~90k), and there are zero console errors.
- Sanity direction check: for the same site, capture risk score should be **lower or equal** after this fix (smaller denominator → higher capture ratio → lower score). If it goes up, something is inverted.

## Out of scope (do not do here)

- Rebuilding `data/hna/chas_affordability_gap.json` at tract level. CHAS publishes tract data, but the refresh pipeline is blocked (HUD WAF blocks unauthenticated downloads — known deferred item). The county-scale file + buffer scaling is the right interim.
- CHAS vintage refresh (same blocker).
- Renaming capture-rate labels (#1148) or the vacancy-threshold conflict (#1149) — separate items already handed off.
