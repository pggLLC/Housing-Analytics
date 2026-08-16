# Codex Handoff: Land/Supply on rental vacancy + unified 0.10 ceiling (#1163)

**For: Codex** (or whoever implements — Claude QAs against the gates below either way).
**Owner decision this implements**: paulglasow approved this direction on #1163 (2026-07-11) — fix the vacancy *input* first, then unify on a single **0.10** ceiling. Do not start until PR #1164 (divergence documentation) and PR #1165 (buffer default) are merged, so the files you touch are at their final pre-change state.

**Two PRs, in order.** PR A is pipeline + data (regenerate before any JS depends on it — this repo has been burned by shipping consumers before caches; see the coupling incidents in `docs/audits/`). PR B is scoring + docs + tests. PR B's fallback makes the ordering safe, but do them in order anyway.

---

## Why (verified evidence, 2026-07-11)

`vacancy_rate` in `data/market/acs_tract_metrics_co.json` is **total** vacancy — `B25004_001E / (occupied + vacant)` (`scripts/market/build_public_market_data.py:664-674`) — which counts seasonal/recreational homes as "vacant." Median tract vacancy from the live file: Denver 5.6%, El Paso 3.9% — but Pitkin 22.8%, Eagle 28.2%, Gunnison 46.3%, **Summit 63.3%**. Both existing Land/Supply ceilings (0.12 in `scoreMarketTightness`, 0.10 in `scoreLandSupply`) score every resort county **0** — reading Colorado's most workforce-housing-starved markets as "oversupplied / weak demand." The signal is inverted exactly where this platform's users work.

The fix: score the dimension on **rental vacancy** (the lease-up-risk concept the dimension actually claims to measure), computed per the Census HVS convention, and retire the 0.12 ceiling (undocumented; apparently reverse-engineered so the 5% suppressed-data default lands at "neutral 58") in favor of the underwriting-justified 0.10.

---

## PR A — pipeline: add rental-vacancy fields to the tract file

**File**: `scripts/market/build_public_market_data.py`

1. Add to `ACS_VARIABLES` (~line 588): `B25004_002E` (vacant — for rent) and `B25004_003E` (vacant — rented, not occupied). **Verify both codes against the ACS 2023 5-year variables endpoint before use** (`https://api.census.gov/data/2023/acs/acs5/variables/B25004_002E.json`) — this repo has shipped a vintage-shifted-code bug before (#1129); never trust a doc or memory for Census codes, including this one.
2. In the row loop (~line 663), derive:
   ```
   vacant_for_rent     = safe_int(row[B25004_002E])
   rented_not_occupied = safe_int(row[B25004_003E])
   rental_universe     = renter_hh + vacant_for_rent + rented_not_occupied
   rental_vacancy_rate = round(vacant_for_rent / rental_universe, 4) if rental_universe > 0 else None
   ```
   This is the Census Housing Vacancy Survey rental-vacancy formula (vacant-for-rent ÷ (renter-occupied + vacant-for-rent + rented-awaiting-occupancy)). Emit `None`/null when the universe is 0 — do **not** emit 0.0, which would read as "perfectly tight market" for tracts with no rental stock.
3. Emit three new per-tract fields (~line 731): `vacant_for_rent`, `rented_not_occupied` (counts — needed for correct buffer-level aggregation in PR B), and `rental_vacancy_rate`. **Additive only**: `vacant` and `vacancy_rate` (total) keep their exact current names, formulas, and meanings — the tract file has ~10 other consumers (`js/components/vacancy-context.js`, `scripts/hna/*`, monitoring, sentinels…) that must see no change.
4. Update the in-file `meta` variable documentation block (~line 761-768) with the three new fields, labeling `vacancy_rate` as "total vacancy (includes seasonal)" and `rental_vacancy_rate` as the HVS-convention rate.
5. Regenerate via the `market_data_build.yml` workflow (`workflow_dispatch`; needs `CENSUS_API_KEY` secret — keyless Census calls fail hard in this repo by design). Commit the regenerated `data/market/acs_tract_metrics_co.json` in PR A.

**PR A QA gate**: in the regenerated file, spot-check against ground truth — a Denver core tract should have `rental_vacancy_rate` in roughly the 2–9% range; Summit County tracts should drop from ~63% total vacancy to single-digit-to-low-teens rental vacancy. Confirm `vacancy_rate` (total) values are byte-identical to the prior file for a sample of tracts (proves additivity). Run `npm run validate:data` and the data sentinels.

---

## PR B — scoring: single 0.10 ceiling on rental vacancy, both paths

1. **`js/market-analysis-scoring.js` — `scoreMarketTightness(acs)`**:
   - Prefer `acs.rental_vacancy_rate` when it is a finite number; normalize against **0.10**:
     `score = max(0, min(100, (1 − rental_vacancy_rate / 0.10) × 100))`
   - Legacy fallback: when `rental_vacancy_rate` is absent (stale cached tract file, e.g. a fork that hasn't regenerated), fall back to the **current** behavior verbatim (total `vacancy_rate`, 0.12 ceiling, 0.05 default) and surface which path ran — return `{ score, basis: 'rental_vacancy' | 'legacy_total_vacancy' }` or add a second exported helper; pick whichever shape disturbs callers least, but the basis must reach `dimensionNotes` so the UI can disclose it. This keeps the site working if PR B ever outruns a data regen, without perpetuating dual ceilings on the *same* input.
   - Suppressed data: when `rental_vacancy_rate` is present-but-null AND legacy `vacancy_rate` is also null, keep the neutral-default convention for now — default input 0.05 → score 50 under the 0.10 ceiling. (Full weight-redistribution alignment is deliberately out of scope — it changes `computePma`'s composite; noted as a possible follow-up in #1163, owner hasn't asked for it.)
2. **`js/market-analysis.js` — `aggregateAcs()`** (~line 400): aggregate rental vacancy from **counts**, not by averaging tract rates — sum `renter_hh`, `vacant_for_rent`, `rented_not_occupied` with the existing `_bufferShare` apportionment (same pattern as `renter_hh` at line ~436), then derive buffer-level `rental_vacancy_rate = Σ vacant_for_rent / (Σ renter_hh + Σ vacant_for_rent + Σ rented_not_occupied)`, null when the denominator is 0. (The existing unweighted rate-averaging for `vacancy_rate` stays as-is for its consumers.)
3. **`js/market-analysis/site-selection-score.js` — `scoreLandSupply()`** (~line 598): same preference — `rental_vacancy_rate` at the 0.10 ceiling it already uses; keep its existing `unavailable` propagation semantics (that's this module's contract). Legacy fallback to total `vacancy_rate` at 0.10 as it does today. The Bridge blend in `scoreLandSupplyWithBridge()` is untouched — its value-add (60/40 land-cost blend) survives; only the vacancy base is unified.
4. **Remove the divergence stopgaps once unified**: replace the `NOTE (#1149)` comment at the preference point in `js/market-analysis.js` (~line 879) with a short "both paths score rental vacancy against a 0.10 ceiling per #1163" note, and rewrite `docs/PMA_SCORING.md` § Land/Supply from the two-paths-two-ceilings story (added by PR #1164) to the unified story: rental-vacancy definition, HVS formula, 0.10 ceiling with the underwriting rationale, seasonal-homes explanation of why total vacancy was wrong, legacy fallback disclosure. Also update the § "Land / Supply" row formula and anything else in that doc still asserting 0.12.
5. **Tests** (`test/pma-scoring.test.js`, already in `test:ci`):
   - Rental-preferred: `{rental_vacancy_rate: 0.05, vacancy_rate: 0.63}` → score 50 (proves rental wins over a resort-inflated total).
   - Ceiling: `{rental_vacancy_rate: 0.10}` → 0; `{rental_vacancy_rate: 0}` → 100.
   - Legacy fallback: `{vacancy_rate: 0.03}` (no rental field) → 75 (current 0.12-ceiling behavior preserved for stale data).
   - **Update the existing suppressed-vacancy assertion**: `scoreMarketTightness({vacancy_rate: null})` currently asserts 58; decide its new expected value from your implementation (50 if the neutral default routes through the 0.10 ceiling; 58 if suppressed data routes through the legacy path) and change the assertion deliberately, with a comment — do not leave it accidentally passing.
   - Anti-re-divergence guard: source-grep both scoring files and assert neither normalizes rental vacancy against anything but 0.10 (e.g. assert `/ 0.12` no longer appears in `market-analysis-scoring.js` except inside the clearly-marked legacy-fallback branch).
   - Update `SAMPLE_ACS` and the `pma-confidence`/`pma-scoring` fixtures to carry `rental_vacancy_rate` so composition tests exercise the new path.
6. **Sequencing within PR B**: it depends on PR A's regenerated data being on `main`. State this in the PR description.

**PR B QA gate**:
- All new tests pass; prove the rental-preferred test non-vacuous (temporarily make `scoreMarketTightness` ignore `rental_vacancy_rate`, confirm it fails, restore).
- Full `npm run test:ci`.
- Live browser, two contrasting sites: a Denver-area PMA (expect Land/Supply broadly similar to before, since metro total≈rental vacancy) and a **Summit or Eagle county PMA** (expect Land/Supply to move from ~0 to a mid-to-high score — the whole point of the change). Confirm the dimension note discloses the rental-vacancy basis, zero console errors.
- Confirm `js/components/vacancy-context.js` and one HNA page render unchanged (additivity check on the shared file).
- Close #1163 with a comment stating the shipped ceiling (0.10), the input definition, and that the suppressed-data weight-redistribution alignment was intentionally deferred.

---

## Out of scope

- Weight redistribution for suppressed vacancy in `computePma`'s composite (noted above; separate owner call if wanted).
- Any change to total `vacancy_rate` or its non-PMA consumers.
- Bridge/MLS enablement itself (#1163's original trigger); this change simply makes enabling it no longer flip thresholds.
