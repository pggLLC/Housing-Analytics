# CHAS Rent-Burden Field Map

**Generated**: 2026-06-09 · F206 audit · Per CHAS Reliability Check Spec (QA-reviewed)

This is the canonical reference for every CHAS rent-burden field surfaced by the
COHO Analytics repository: where it lives on disk, what it measures, what
denominator it uses, where it's displayed in the UI, and whether it's currently
mixed with owner-cost-burden data.

> **Note on vintage.** Every CHAS field below is part of the **2018–2022** HUD
> special tabulation, which draws on the ACS 5-year survey for the same years.
> Per QA-FIX 1 in the spec: the same-vintage ACS 5-year detailed tables are a
> **definitional cross-check**, NOT a freshness check. Only ACS 1-year tables
> can move the freshness needle.

---

## 1. Source files on disk

| File | Geography | Records | Source script | Refresh |
|---|---|---|---|---|
| `data/market/chas_co.json` | County (64) | 64 | `scripts/fetch_chas.py` | Monthly (2nd, 03:00 UTC) · `.github/workflows/fetch-chas-data.yml` |
| `data/hna/chas_affordability_gap.json` | County (64) | 64 | `scripts/fetch_chas.py` (same source) | Monthly (same workflow) |
| `data/market/chas_tract_co.json` | Tract (~1,447) | 1,447 | `scripts/fetch_chas.py` | Monthly (same workflow) |
| `data/hna/place-chas.json` | Place/CDP (482 CO) | 482 | `scripts/hna/build_place_chas.py` (post-CHAS build) | Cascade after CHAS fetch |
| `data/hna/place-chas-coverage-stats.json` | Place metadata (482) | 482 | `scripts/hna/build_place_chas.py` | Cascade after CHAS fetch |

The county and place files use **different field-naming conventions**:

| Concept | County field | Place field |
|---|---|---|
| Renter HHs cost-burdened ≥30% | `pct_renter_cb30` (decimal) | `renter_cb30_share` (fraction) |
| Renter HHs cost-burdened ≥50% (severe) | `pct_renter_cb50` | `renter_cb50_share` |
| Owner HHs cost-burdened ≥30% | `pct_owner_cb30` | `owner_cb30_share` |
| Owner HHs cost-burdened ≥50% (severe) | `pct_owner_cb50` | `owner_cb50_share` |
| Total renter HHs | `total_renter_hh` | `total_renter_hh` |
| Total owner HHs | `total_owner_hh` | `total_owner_hh` |
| AMI-band detail (renters) | `renter_hh_by_ami.{lte30,31to50,51to80,81to100,100plus}` | (same shape) |
| AMI-band detail (owners) | `owner_hh_by_ami.{lte30,31to50,51to80,81to100,100plus}` | (same shape) |

---

## 2. Per-AMI-band fields

Same fields available at county and tract level. Sample structure:

```json
"renter_hh_by_ami": {
  "lte30":    { "total": ..., "cost_burdened_30pct": ..., "cost_burdened_50pct": ..., "pct_cost_burdened_30": ..., "pct_cost_burdened_50": ... },
  "31to50":   { ... },
  "51to80":   { ... },
  "81to100":  { ... },
  "100plus":  { ... }
}
```

AMI bands map directly to HUD's definitions:
- `lte30` — at or below 30% of Area Median Family Income (ELI: extremely low-income)
- `31to50` — >30% to ≤50% (VLI: very low-income)
- `51to80` — >50% to ≤80% (LI: low-income)
- `81to100` — >80% to ≤100%
- `100plus` — >100%

---

## 3. Denominators

| Field | Denominator | Includes "not computed"? |
|---|---|---|
| `pct_renter_cb30` / `renter_cb30_share` | `total_renter_hh` | **No** — denominator already excludes HHs whose income-to-rent ratio HUD couldn't compute |
| `pct_renter_cb50` / `renter_cb50_share` | `total_renter_hh` | No |
| `pct_owner_cb30` / `owner_cb30_share` | `total_owner_hh` | No |
| `pct_owner_cb50` / `owner_cb50_share` | `total_owner_hh` | No |
| AMI-band rates | total of that AMI band (renter or owner) | No |

The HUD CHAS feed already filters "not computed" rows from each tabulation, so the rates we serve are conditioned on having a known income-to-rent (or income-to-housing-cost) ratio.

---

## 4. UI surfaces

Every place CHAS data is displayed today (per F206 audit):

| Page / module | Field(s) accessed | Threshold(s) | Usage |
|---|---|---|---|
| **HNA** ([housing-needs-assessment.html](../housing-needs-assessment.html)) | `pct_renter_cb30/50`, `pct_owner_cb30/50` (county fallback); place-CHAS shares preferred | 30% + 50% | Scored (composite housing-need), charted (cost burden by AMI), narrative (gap analysis). Vintage tagged "CHAS 2018-2022" / "HUD CHAS 2018–2022" |
| **HNA renderers** ([js/hna/hna-renderers.js](../js/hna/hna-renderers.js)) | County: `s.pct_renter_cb30`, `s.pct_owner_cb30`, `s.pct_renter_cb50`. Place: `psum.owner_cb30_share` (3816–3830) | 30% + 50% ("moderate"/"severe") | Scored (3-bin need composite), charted (tenure-blended + by-AMI), methodology pill at 6631 |
| **Opportunity Finder** ([js/lihtc-opportunity-finder.js](../js/lihtc-opportunity-finder.js)) | Place: `ps.renter_cb30_share`, `ps.owner_cb30_share`, `ps.renter_cb50_share` (432–435). County: `s.pct_renter_cb30`, `s.pct_owner_cb30`, `s.pct_renter_cb50` (449–450) | 30% (blended) + 50% (severe renter) | Scored: `blended × 0.7 + rcb50 × 0.3`. "Scaled" badge (2118) when county-CHAS used as proxy |
| **Compare** ([js/compare.js](../js/compare.js)) | County `pct_renter_cb30/50`, `pct_owner_cb30`; place shares (89–91, 112–117, 431–432) | 30% + 50% | Charted (cost-burden columns) + scored (tenure-blended Housing Need benchmark rank) |
| **Colorado Deep Dive** ([js/colorado-deep-dive.js](../js/colorado-deep-dive.js)) | County: `totR` (renter cost-burdened count), `totB` (sum) from AMI tiers (568, 577) | 30% (implied) | County cost-burden map overlay |
| **Census Multifamily** ([js/census-multifamily.js](../js/census-multifamily.js)) | `record.pct_renter_cost_burdened` (207, 439) | 30% (implied renter-only) | UI metric — no vintage label |
| **HNA Export** ([js/hna/hna-export.js](../js/hna/hna-export.js)) | `ownerSum.pct_owner_cb30`, `ownerSum.owner_cb30_share` (172–174); renter via `_rba.lte30.cost_burdened_30pct` | 30% + 50% | Narrative in exported PDF/Excel |

---

## 5. Renter–owner mixing

Per QA-FIX 2 in the spec: **mixing renter and owner cost burden silently is forbidden**. Audit findings:

| Module | Mixing behavior | Status |
|---|---|---|
| `js/hna/hna-renderers.js:6431–6442` | Computes **tenure-blended CB30** for HNA composite (A score). Weighted by HH counts. Renter CB50 kept separate for "Worst-case need" (D). | **Intentional + labeled** — methodology pill at line 6631 says "tenure-blended" |
| `js/lihtc-opportunity-finder.js:401–450` | Blended = `(pRcb30 × pRenter + pOcb30 × pOwner) / pTot`. Composite = `blended × 0.7 + rcb50 × 0.3` | **Intentional + named** in code; UI label needs verification |
| `js/compare.js:112–117` | Blended = `(rcb30 × rH + ocb30 × oH) / total` | **Intentional + labeled** in Compare table |
| `js/hna/hna-comparison.js:673–825` | Renter ≤30 AMI + 31–50 AMI tracked **separately** from owner | **Separated correctly** — source pills distinguish place vs county fallback |
| `js/place-chas-lookup.js:117–146` | `compareToCounty()` returns `{place, county, delta}` for renter + owner **separately** | **Separated correctly** |

**No silent mixing detected.** Every place that blends owner + renter cost burden labels the result as "blended" or "composite" in its surrounding code/UI. **Action**: the F207 reliability module should annotate these blends with the underlying tenure split when surfacing confidence scores.

---

## 6. Vintage labels in UI

| Location | Label | Confirmed in source |
|---|---|---|
| HNA section pills (renderers 6631) | `HUD CHAS 2018–2022` | ✓ |
| Methodology footnote (renderers 3441) | `CHAS 2018-2022` | ✓ |
| Deep Dive map status (deep-dive.js 616) | `HUD CHAS 2018–2022` | ✓ |
| PDF export narrative | `CHAS 2018-2022` (embedded) | ✓ |
| `data/hna/place-chas.json` meta block | `"vintage_chas": "2018-2022"` (programmatic key) | ✓ |
| `housing-needs-assessment.html` (~line 3889) | Disclosure: "CHAS data is 3+ years old" | ✓ — **NOT** "latest" |
| `js/census-multifamily.js` | No vintage label | ✗ gap to address in F207 |

**No page uses "latest CHAS" or "current CHAS" language**. One disclosure ("3+ years old") explicitly frames CHAS as a baseline, not as current data. Inconsistent en-dash vs hyphen in the date range across HTML data-vintage attributes — cosmetic, low priority.

---

## 7. Margin of error handling

| Pipeline stage | MOE handled? | Source |
|---|---|---|
| `fetch_chas.py` ingest | **No** — only point estimates parsed | HUD CHAS feed publishes MOE columns; current parser ignores them |
| `build_place_chas.py` apportionment | **No** — population-share weights have no error propagation | Quality flag `low_confidence: true` set when `coverage_share < 0.8` (a coverage flag, NOT an MOE) |
| HNA / OF / Compare display | **No** — point estimates only | A general note about ACS MOE exists in `js/hna/hna-utils.js` for geographies <5,000 pop, but it doesn't propagate into CHAS displays |

Per QA-FIX 3 in the spec: **the F207 reliability module will compute MOE from raw ACS B25070 cells** (`*_001M` through `*_011M`) for the comparison rates, not for CHAS itself (CHAS publishes some MOEs but they're not propagated through the apportionment math anyway). The reliability score will use ACS MOE-range overlap as the "soften the warning" gate.

---

## 8. Known data-quality notes

| Issue | Source | Status |
|---|---|---|
| Table 7 (income × tenure × cost burden) vs Table 9 (race × tenure) | Documented in `fetch_chas.py:64–69`. Prior parser used Table 9 (wrong); produced 0.6% ELI vs real 18–28%. Fixed 2026-04. Now uses Table 7. | ✓ Fixed |
| Small-town rounding (F28) | Place-CHAS used area-share weighting → undercounted small embedded towns (e.g., New Castle 0.94% area vs 67% pop). Fixed with population-share apportionment | ✓ Fixed |
| 51/64 counties with aggregation issues | `housing-needs-assessment.html:~3385`: "CHAS data is 3+ years old and has known aggregation issues in 51/64 counties." Original source of this claim unverified in audit | ⚠ Surface in F207 confidence score |
| No place-level survey | CHAS is published at tract; place-CHAS is apportioned, not independently surveyed | ✓ Documented (coverage flag in metadata) |

---

## 9. Census fetch infrastructure available for F207

| Need | Available today? | Source |
|---|---|---|
| Census API key | **Yes** — already in repo secrets as `CENSUS_API_KEY` (used by `deploy.yml` to generate `js/config.js`) | `.github/workflows/deploy.yml` |
| CHAS feed → JSON | **Yes** — `scripts/fetch_chas.py` runs monthly via `.github/workflows/fetch-chas-data.yml` | Monthly cron + manual dispatch |
| ACS 5-year detailed tables (B25070) | **Yes** — already used by other backfill scripts (`scripts/backfill_dp04_value_brackets.mjs`, `scripts/backfill_hna_household_occupation.mjs`); pattern is established | Existing pattern |
| ACS 1-year detailed tables (B25070) | **Not yet** — F207 will add as a new fetch | Will need new precompute script |

**F207 will add** a precompute script `scripts/build_rent_burden_crosscheck.mjs` modeled on the existing backfill scripts, plus a workflow to run it after each Census release.

---

## 10. Next steps (F207 implementation plan)

1. **`data/metadata/rent_burden_sources.json`** — Source-hierarchy registry per spec
2. **`scripts/build_rent_burden_crosscheck.mjs`** — Fetches ACS B25070 (5-year AND 1-year) for every CO geography, computes rates + MOE propagation, cross-references against CHAS, writes `data/processed/rent_burden_crosscheck.json`
3. **`.github/workflows/build-rent-burden-crosscheck.yml`** — Annual run (ACS 1-year releases September; ACS 5-year December; CHAS less often)
4. **`js/rent-burden-reliability.js`** — Public-API module:
   - `loadCrosscheck()` — fetches the precomputed JSON
   - `computeReliability(geoid, geoType)` — returns `{definitional, freshness, combined, flags, notes}` per spec Section "Reliability scoring"
   - `confidenceBadge(reliability)` — returns markup for a small badge with tooltip
5. **UI integration** — minimal additions to existing CHAS displays in:
   - `js/hna/hna-renderers.js` (renderChasAffordabilityGap)
   - `js/compare.js` (cost burden columns)
   - `js/lihtc-opportunity-finder.js` (need composite header)
   - Adds source-confidence note + tooltip per spec UI section. No changes to existing CHAS calculations.

**Phasing**: F207a = source registry + reliability JS (works with CHAS-only data, no precompute yet). F207b = precompute script + workflow. F207c = UI integration. Each phase leaves the repo functional.

---

## QA reviewer note

Per the spec's reviewer Claude (2026-06-09): this field map fully covers the
"front half of Audit Tasks 1–3" called out in the spec. The implementation
plan respects the four guardrails:
1. Preserve current outputs — additive, no rename/removal
2. Same-vintage ACS 5-year = definitional check, never "newer"
3. CHR (when added in v2) labeled all-tenure, never adjacent to renter rate
4. MOE computed via root-sum-of-squares + proportion-MOE propagation
