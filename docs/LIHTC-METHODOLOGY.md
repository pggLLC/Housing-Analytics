# LIHTC Project Methodology

**Last updated**: 2026-06-09 (post-F185)

This document explains how the COHO Analytics repository identifies, counts, deduplicates, validates, and surfaces LIHTC (Low-Income Housing Tax Credit) projects across every consumer view (HNA, Opportunity Finder, Compare, Data Map).

> **TL;DR — Authoritative count today**: **928** LIHTC project records in the canonical CHFA feed; **1,026** unique LIHTC-tagged rows in the unified affordable-housing dataset (one project can carry multiple credit tags). **865** geographically-unique projects when we dedupe CHFA ∪ HUD by coordinates. Total housing units: **87,757**; assisted (low-income) units: **82,796**.

---

## 1. Data sources

The LIHTC universe is assembled from **four canonical sources** plus **two supplementary** ones:

### Canonical sources

| File | Source | Count | Vintage | Role |
|---|---|---:|---|---|
| `data/affordable-housing/lihtc/chfa-properties.json` | CHFA `HousingTaxCreditProperties_view` (ArcGIS) | **928** | live (fetched 2026-06-08) | Primary CHFA LIHTC database. Powers the LIHTC map markers on the Opportunity Finder, the HNA LIHTC layer, and the Compare project counts. |
| `data/chfa-lihtc.json` | Same CHFA feed, per-county fetched | **928** | live | Per-county fetch path used by the HNA controller. Same data as `chfa-properties.json` — duplicated for the on-demand HNA fetch pattern. |
| `data/market/hud_lihtc_co.geojson` | HUD national LIHTC database (CO subset) | **926** | 2025 federal release | Federal gold-standard registry. Used as the **validation source** for any LIHTC claim. |
| `data/affordable-housing/properties.json` | Union of CHFA + HUD + USDA + PHA, derived | **1,026** LIHTC-tagged rows | rebuilt nightly | Unified affordable-housing dataset. Each row carries a `program_type` array (e.g. `["lihtc-9pct", "preservation-candidate"]`). Consumed by the HNA "affordable housing in and around X" list, the Data Map's affordable-housing layer, the OF preservation badge. |

### Supplementary sources

| File | Source | Count | Role |
|---|---|---:|---|
| `data/affordable-housing/chfa-awards/2026-round-one.json` | CHFA 2026 Round One Award Report PDF (manually parsed) | **14** | Bridge file — surfaces 2026 R1 awards before they appear in the live ArcGIS feed (typically a Q4 delay). |
| `data/policy/chfa-awards-historical.json` | CHFA Annual Reports 2015-2025 + QAP award notices | **28** | Historical context: powers the OF QAP scoring rubric panel (F180). Includes awarded + not-awarded for award-rate calculation. |

### Sources that are NOT LIHTC (intentionally excluded)

| Source | Count | Why excluded |
|---|---:|---|
| HUD MULTIFAMILY_PROPERTIES_ASSISTED | 342 | Section 8 PBRA / 202 / 811 properties WITHOUT a confirmed LIHTC layer. Subsidized but not LIHTC. |
| USDA Rural Housing Assets | 116 | USDA 515 / 521 multifamily WITHOUT a confirmed LIHTC layer. |
| CHFA `PreservationProperties_Layer` (alone) | ~667 | At-risk affordable housing CHFA tracks for preservation — includes LIHTC + HUD-only + state-funded + locally-funded. **The preservation tag alone is not sufficient evidence of LIHTC.** This was the F184 mistake; F185 corrected it. |

---

## 2. Categorization — how a record becomes "LIHTC"

A record carries a LIHTC tag in `program_type` if it satisfies **at least one** of:

1. **It's in the live CHFA `HousingTaxCreditProperties_view` feed** → tagged based on the `CREDIT` string:
   - `"9% Competitive"` → `lihtc-9pct`
   - `"4% Tax Exempt"` → `lihtc-4pct`
   - `"4% and State"` → `lihtc-4pct` + `lihtc-state-paired`
   - `"9% and State"` → `lihtc-9pct` + `lihtc-state-paired`
   - `"MIHTC"` → `lihtc-mihtc`
   - `"...TOC..."` → also adds `lihtc-toc-paired`
   - Anything containing both 9% + 4% → adds both tags

2. **It's a 2026 R1 bridge award** → tagged `chfa-2026-r1-bridge` + the appropriate `lihtc-9pct` / `lihtc-4pct` / `lihtc-state-paired` based on the bridge file's credit fields.

3. **It's a preservation candidate AND validated against HUD LIHTC** → tag(s) copied from HUD's `CREDIT` field. Validation is by normalized project name match OR coordinate match within ~100m. **F185** added this validation gate.

4. **It's manually confirmed** (e.g. Prairie Run via sponsor confirmation) → tagged with the appropriate `lihtc-*` and stamped with an `_note` documenting the manual source.

A record is **NOT** tagged LIHTC if it has only `preservation-candidate` from CHFA + no HUD LIHTC match, even if it's affordable housing. The conservative default after F185 is: **don't claim LIHTC without evidence**.

### Tag distribution (post-F185)

```
lihtc-4pct                527
lihtc-9pct                499
lihtc-state-paired        185
lihtc-toc-paired          14
lihtc-mihtc                4
                       ────────
Total LIHTC tags        1,229
Unique LIHTC rows       1,026   (one project may carry 2-3 tags)
```

---

## 3. Deduplication

Multiple sources can describe the same physical property. Dedupe rules:

| Layer | Dedupe key |
|---|---|
| Within `properties.json` | `property_id` (e.g. `lihtc:42`, `preservation:81639-MF-1501 Ospre-`) |
| Across canonical sources (CHFA, HUD) | Normalized project name (lowercase, strip "the/apts/apartments/llc/lp/inc/i-v" boilerplate, non-alphanumeric) AND coordinates within ~100m |
| HNA "affordable housing in and around X" list (F174) | Per-row: drop properties.json `lihtc-*` records that match a CHFA row by normalized name OR coordinate (~200m) |
| LIHTC + preservation combo badge (F174) | Match by normalized name OR coordinate (~80m); LIHTC stays the headline, preservation renders as a secondary tag |

Geographically-unique LIHTC projects (CHFA ∪ HUD, coordinate dedupe ~100m): **865**.

---

## 4. Validation — what counts as "evidence of LIHTC"

After the F184 → F185 lesson, the validation hierarchy is:

1. **Strong (gold standard)**: record is in HUD's federal LIHTC database. HUD publishes `YR_PIS` + `CREDIT` so we get year + credit type.
2. **Strong (current state)**: record is in CHFA's live `HousingTaxCreditProperties_view` feed. CHFA carries `AwardYear` + `YR_PIS` + `CREDIT`.
3. **Strong (announced)**: record is in the 2026 R1 bridge file (manually parsed from the CHFA Award Report PDF).
4. **Strong (user-confirmed)**: manual entry with explicit sponsor / owner confirmation. Stamped with `_note` for traceability.
5. **Insufficient**: CHFA preservation feed alone. The preservation feed tracks at-risk affordable housing, which includes LIHTC + HUD-only + state-funded + locally-funded. **Not enough to claim LIHTC.**

The F184 mistake was elevating signal #5 to a tag. F185 removed those false positives (667 records).

---

## 5. Known gaps + how they're handled

| Gap | Impact | Mitigation |
|---|---|---|
| CHFA ArcGIS feed lags published awards by ~Q4 | 2026 R1 awards (14 deals, 634 units, ~$219M equity) are not in `chfa-properties.json` | Bridge file `2026-round-one.json` consumed by OF, Compare, and recency-augmentation. Drops automatically when the live feed catches up. |
| Records with no parseable year | Recency calculation can't compute drought years | `recency_basis = "never_funded"` for the jurisdiction; consumer UIs render "—" rather than fabricating a year. |
| Preservation records without LIHTC evidence | 667 properties tagged `preservation-candidate` only | Surfaced in HNA list as preservation, not LIHTC. Conservative default: don't claim LIHTC without HUD match. |
| Manual additions (Prairie Run) with null year | Hayden's `latest_lihtc_year` anchors on 1996 (Vista Verde II), not the unknown Prairie Run year | `_note` documents the gap. User can patch year when known; cascade re-runs via `scripts/augment_ranking_index_recency.mjs`. |
| Property-name dedupe imperfect for CDPs | A CDP (Acres Green) won't match a city LIHTC project even if it's the same place | Recency augmentation normalizes city names but CDPs often have no LIHTC match by design — they're census aggregations of unincorporated land. |

---

## 6. Refresh cadence

| Source | Refresh trigger |
|---|---|
| `chfa-properties.json` | `.github/workflows/fetch-chfa-lihtc.yml` runs **every Monday 05:00 UTC**. Pulls the live CHFA ArcGIS feed. |
| `properties.json` | Cascade from `scripts/build-affordable-housing-properties.js` after the CHFA fetch. Merges 4 sources. |
| `hud_lihtc_co.geojson` | Manual — refreshed on HUD's annual release schedule. |
| `2026-round-one.json` | Manual bridge — updated post-announcement. |
| `chfa-awards-historical.json` | Manual annual update. |
| `data/hna/ranking-index.json` recency fields | Re-augmented by `scripts/augment_ranking_index_recency.mjs` after any LIHTC source changes. |

---

## 7. Consumer views — where the count shows up

| Page | Source | What it shows |
|---|---|---|
| **HNA** ([housing-needs-assessment.html](../housing-needs-assessment.html)) | `chfa-lihtc.json` (county-fetched) | Per-jurisdiction LIHTC project count + units + map markers. F179 recency badge above the stat cards. |
| **Opportunity Finder** ([lihtc-opportunity-finder.html](../lihtc-opportunity-finder.html)) | `chfa-properties.json` (statewide) | Map markers, opportunity scoring, recency component, 2026 R1 badge, OF detail panel QAP rubric. |
| **Compare** ([compare.html](../compare.html)) | `chfa-lihtc.json` + 2026 R1 bridge + watchlist | Project count column, drought years, recency component, 2026 R1 row. |
| **Data Map** ([data-map-browser.html](../data-map-browser.html)) | `chfa-properties.json` as a toggleable layer | All 928 markers visible when "CHFA LIHTC properties" layer is on. |
| **HNA affordable-housing list** | `properties.json` + `chfa-lihtc.json` (F174) | Per-jurisdiction LIHTC + preservation combo badge. |

---

## 8. Code locations

| Concern | File |
|---|---|
| CHFA feed fetch | `scripts/fetch-chfa-lihtc.js` |
| Affordable-housing build | `scripts/build-affordable-housing-properties.js` |
| Credit-string → tag mapping | `js/components/affordable-housing-layer.js` (CATEGORIES + `_categorize`) |
| LIHTC categorization on the HNA list | `js/hna/hna-renderers.js` (`updateLihtcInfoPanel`) |
| LIHTC popup HTML | `js/hna/hna-utils.js` (`lihtcPopupHtml`) |
| Recency augmentation | `scripts/augment_ranking_index_recency.mjs` (F179) |
| F184 preservation-tag bulk-add | `scripts/tag_chfa_preservation_lihtc.mjs` (overreach — corrected by F185) |
| F185 validation + rollback | `scripts/validate_and_correct_f184_tags.mjs` |

---

## 9. Historical record

| Feature | Date | Why it mattered |
|---|---|---|
| F146 | 2026 | 4-year recency cap formula + 2026 R1 award integration |
| F166 | 2026 | Sponsor / built-by row in LIHTC popups + lists |
| F174 | 2026-06-09 | LIHTC + preservation combo badge (LIHTC primary, preservation secondary); fixed bounds-only filter on the HNA list |
| F179 | 2026-06-09 | Added `latest_lihtc_year` + `drought_years` + `recency_score` + `recency_basis` to `ranking-index.json` |
| F183 | 2026-06-09 | Surfaced Prairie Run (Hayden) — was in preservation feed but not tagged LIHTC |
| F184 | 2026-06-09 | **Overreached** — bulk-tagged 773 preservation records as LIHTC. Wrong. |
| F185 | 2026-06-09 | Cross-validated F184 against HUD. Kept 106 (validated + enriched with HUD's year + credit). Rolled back 667 (no HUD evidence). |

---

## Open questions / future work

- **Replace the F184 script with the F185 gating** so future preservation-feed ingests automatically check HUD before tagging.
- **Backfill HUD-validated years** for the ~106 records F185 enriched — currently they carry HUD's `YR_PIS` but not `YR_ALLOC` / `AwardYear`. Consumer views read `latest_year` so this is mostly transparent.
- **Surface a "data quality" badge** on each LIHTC row indicating its tagging source (CHFA-live / HUD-validated / R1-bridge / manual-confirmed) so users see provenance at a glance.
- **Periodic HUD-feed-vs-CHFA-feed reconciliation** — they're both supposed to be the same universe but differ by 2 records (928 vs 926). Worth auditing.
- **CDP coverage** — most CDPs show `lihtc_project_count: 0` because LIHTC records have a city name, not a CDP name. Cross-reference by census-tract → CDP membership would catch those.
