# Codex Handoff: STR seasonal discount for rental vacancy (#1171, option 1 + option-2 calibration)

**For: Codex.** Owner decision (2026-07-14): implement **option 1** from #1171 —
discount `vacant_for_rent` by the tract's seasonal-unit share — as the uniform
statewide method, verified against **option-2-style evidence** (published STR
license counts) as a hand-curated, advisory calibration benchmark. License
data is NOT a scoring input and never becomes a pipeline dependency: Colorado
has no statewide STR registry; licensing is local, and published counts exist
mainly for the resort jurisdictions where this discount actually binds —
which is exactly what a calibration set needs.

**Two PRs, in order** (same pattern as #1163's PR A/PR B). Mark both
"Do not merge until external QA completes."

**Context to read first**: `docs/PMA_SCORING.md` § Land/Supply (the #1163
rental-vacancy switch + the STR-DISTORTED known-limitation section this work
partially retires), issue #1171 (option list), and
`js/market-analysis-scoring.js` (the scoring helper you'll extend).

---

## PR A — pipeline: seasonal-vacancy field on the tract file

1. Add `B25004_006E` to `ACS_VARIABLES` in
   `scripts/market/build_public_market_data.py`. Code verified against the
   live ACS 2023 acs5 variables endpoint on 2026-07-14: label "Estimate!!
   Total:!!For seasonal, recreational, or occasional use". Re-verify it
   yourself before use (post-#1129 rule; the doc's word is not evidence).
2. Emit one additive per-tract count: `vacant_seasonal` (int, `safe_int`
   convention like the #1168 fields). Do NOT touch existing fields; the tract
   file has ~10 non-PMA consumers and the additive-schema rule from #1168
   applies verbatim. Update the `meta.fields` documentation block.
3. Regenerate via `market_data_build.yml` workflow_dispatch (it opens a
   `chore/market-data-rebuild-*` PR — same flow as #1169). Sanity gates on
   the data PR: `vacant_seasonal ≤ vacant` for every tract; Summit County
   aggregate `vacant_seasonal / vacant` in the ~0.7–0.95 range (seasonal-
   dominated); Denver aggregate well under 0.3; legacy fields byte-identical.

## PR B — scoring: the discount, applied at buffer level

**Formula (aggregate from counts, never averaged rates — same principle as
#1170)**. In `aggregateAcs()` (`js/market-analysis.js`), sum the apportioned
`vacant_seasonal` alongside the existing counts, then derive at buffer level:

```
seasonal_share       = Σ vacant_seasonal / Σ vacant                (0 when Σ vacant = 0)
adj_vacant_for_rent  = Σ vacant_for_rent × (1 − seasonal_share)
str_adjusted_rental_vacancy_rate =
    adj_vacant_for_rent / (Σ renter_hh + adj_vacant_for_rent + Σ rented_not_occupied)
```

Rationale: in a seasonal-dominated buffer, the same share of "for rent"
listings is assumed to be short-term/vacation product unavailable to the
long-term market; discounted units leave the rental universe entirely (both
numerator and denominator), mirroring how the HVS universe would look if ACS
could distinguish terms. This is a proxy — say so in every disclosure.

**Scoring changes** (`js/market-analysis-scoring.js` +
`js/market-analysis/site-selection-score.js`):
1. `scoreMarketTightnessDetail()` preference order becomes:
   `str_adjusted_rental_vacancy_rate` (basis `'rental_vacancy_str_adjusted'`)
   → raw `rental_vacancy_rate` (basis `'rental_vacancy'`, for data predating
   PR A) → legacy total-vacancy fallback (unchanged). Same 0.10 ceiling for
   both rental bases — the ceiling is not in question here.
2. `scoreLandSupply()` mirrors the same preference (keep its `unavailable`
   propagation contract and the anti-re-divergence guard happy — extend that
   guard test for the new field rather than weakening it).
3. `isStrDistorted()` now evaluates on the ADJUSTED rate when present. Expected
   effect: Breckenridge/Aspen-class buffers mostly stop flagging because the
   adjusted rate drops below 0.08; keep the flag for residual cases and update
   its docstring + the `PMA_SCORING.md` section (the known-limitation text
   changes from "still floor at 0" to "mitigated by the seasonal discount;
   residual cases still flagged").
4. `computePma`'s dimension note discloses the basis, including the proxy
   caveat when STR-adjusted (e.g. "…seasonal-share discount applied as an STR
   proxy — verify against local STR-license data").
5. `docs/PMA_SCORING.md`: document the formula exactly as implemented, the
   proxy assumption, and the calibration benchmark below.

**Expected magnitudes (QA will check directionally, live)**: Breckenridge
3-mi buffer currently 51.4% raw rental vacancy → adjusted should land roughly
single-digit-to-low-teens and the Land/Supply score should move OFF 0;
Denver 3-mi (5.0% raw, low seasonal share) should move ≤1pt; Durango
(8.3% raw, moderate seasonal) should move modestly, not collapse to 0%.

**Tests** (`test/pma-scoring.test.js`, already in `test:ci`): fixture matrix
for the formula (seasonal-dominated, zero-seasonal, Σ vacant = 0, missing
`vacant_seasonal` → raw-rental fallback with correct basis); ceiling
unchanged; flag-on-adjusted behavior; anti-re-divergence guard extended; all
with non-vacuousness proofs (disable the discount → seasonal fixtures fail).

## Calibration benchmark (option-2 verification, advisory only)

New file `data/benchmarks/str-license-counts.json` + a warn-only checker
(e.g. `scripts/audit/str-discount-calibration.mjs`, `audit:` script, NOT in
`test:ci` — the `benchmark-freshness-check.mjs` warn-only convention).

**Data rules — absolute (fabrication has burned this repo before)**:
- Every entry must be a number **visible today at a cited official URL**
  (municipal/county STR license dashboard, official report, or open-data
  portal). Record: jurisdiction, geoid, `licensed_str_units`, `as_of`,
  `source_url`, and a short `source_note` quoting where on the page it
  appears. If you cannot fetch and read the number yourself, DO NOT include
  the jurisdiction — an absent row is fine, an invented or "remembered"
  number is not. Claude will fetch-verify EVERY row at QA; any row that
  doesn't check out fails the PR.
- Candidate jurisdictions to try (public programs known to exist; formats
  vary): Summit County + Breckenridge, Pitkin County + Aspen, Steamboat
  Springs/Routt, Vail + Eagle County, Telluride/San Miguel, Crested Butte/
  Mt. Crested Butte/Gunnison, Winter Park/Grand, Durango, Denver (open-data
  portal, machine-readable). 5–8 verified rows is a success; statewide
  coverage is explicitly NOT the goal.
- **What the checker asserts (weak, honest bounds — this is a proxy check,
  not an identity)**: for each benchmarked county/place buffer, the units the
  discount removes (`Σ vacant_for_rent × seasonal_share`, computed from the
  tract file over the jurisdiction) should be the same order of magnitude as
  licensed STR units — warn when removed > 1.5× licensed (discount too
  aggressive) or < 0.1× licensed in a seasonal-dominated market (discount
  not biting). Print a comparison table either way. Never fail the build.
- Note in the file's meta AND the checker output: licensed counts ≠ ACS
  "for rent at survey time" (different universes, different moments) — the
  comparison is order-of-magnitude calibration only.

## QA gates
- PR A: data-PR sanity gates above; legacy fields byte-identical for a tract
  sample; `validate:data` + sentinels.
- PR B: 
  - unit fixtures + non-vacuous proofs as specified; full `test:ci`;
  - live browser (Claude re-runs): Breckenridge buffer score moves off 0
    with basis `rental_vacancy_str_adjusted` and the proxy note visible in
    dimension metadata; Denver unchanged ≤1pt; zero console errors;
  - calibration checker runs, prints its table, exits 0; every benchmark row
    fetch-verifiable at its cited URL;
  - `PMA_SCORING.md` updated everywhere the old "floors at 0" language lived.

## Out of scope
- Any use of license counts inside scoring (advisory only, by owner design).
- AirDNA or other commercial data.
- The deferred suppressed-vacancy weight-redistribution question (#1163 note).
