# PMA Methodology Audit

*Last updated 2026-05-25 · scope: market-analysis.html + Site Selection Score + PMA infrastructure scorecard*

This audit documents what the Primary Market Area (PMA) tooling does, where it gets data, what's stubbed, what's broken, and what's recommended for follow-up work. Written for the Codex handover so a fresh reviewer can re-validate.

---

## 1. The two scores users see

| Score | Source module | Weight model | Output |
|---|---|---|---|
| **PMA Score** (radar chart, 5 dimensions) | [`js/market-analysis.js` → `computePma()`](../../js/market-analysis.js) | 30/25/15/15/15 across demand/captureRisk/rentPressure/landSupply/workforce | Overall 0-100 + tier (Strong/Moderate/Marginal/Weak) |
| **Site Selection Score** (6 dimensions) | [`js/market-analysis/site-selection-score.js`](../../js/market-analysis/site-selection-score.js) | 25/20/15/15/15/10 across demand/subsidy/feasibility/access/policy/market | Composite 0-100 + Opportunity Band (High/Moderate/Lower) |

These two scores **measure different things**. The PMA Score is a market-demand/capture-risk lens (does an affordable project make sense in this market?). The Site Selection Score is a site-suitability lens (is this specific parcel a good choice?). They share some inputs (ACS demand, LIHTC saturation) but use them differently.

---

## 2. What's working

### 2.1 PMA Score 5-dimension model (`computePma`)

| Dimension | Weight | Inputs | Source |
|---|---|---|---|
| **Demand** | 30% | cost_burden_rate + renter_share + **(NEW 2026-05) severe_cost_burden_rate + poverty_rate** | ACS DP04 tract metrics |
| **Capture Risk** | 25% | existing LIHTC units ÷ qualified renters | HUD LIHTC + ACS |
| **Rent Pressure** | 15% | market median rent ÷ 60%-AMI affordable rent | ACS + HUD FMR |
| **Land Supply / Market Tightness** | 15% | vacancy rate, Bridge MLS land cost (when available) | ACS vacancy + Bridge MLS |
| **Workforce** | 15% | LEHD jobs density + service-employment share + workforce-tier rents | LEHD LODES + ACS |

**Defensible:** Each dimension has explicit weight calibration in the doc-block and a null-propagation contract — when a data source is missing, its weight redistributes to other dimensions rather than injecting a fake 50 (see lines 619-640 of `market-analysis.js`).

### 2.2 Site Selection 6-dimension model (`computeScore`)

Documented in [SITE-SELECTION-SCORE.md](#) (mirror in site-selection-score.js doc-blocks). PR #889 strengthened the Demand sub-factor to include severe burden + poverty.

The model honestly reports when fewer than 6 dimensions are available: output includes `dimensionsAvailable`, `dimensionsUnavailable`, `unavailableDimensions` so UI can show "scored on N of 6" rather than fake completeness.

### 2.3 PMA Site Summary card (post PR #889)

Now surfaces 7 facts under a buffer:
- Boundary method
- Census tracts
- Housing units / Rental households
- **Severe cost-burden, Poverty rate, Unemployment rate** (PR #889)
- Nearest transit / grocery / healthcare / school / park (PR #888)

This is the user-facing "what's in the buffer" snapshot.

### 2.4 PMA delineation methods

Three boundary methods available:
1. **Buffer-based** ("legacy") — circle of N miles around site
2. **Commuting-based** — LEHD LODES origin-destination polygon
3. **Hybrid** ("recommended") — commuting polygon refined by school + transit district

For LIHTC market studies the hybrid method is closest to NH&RA / Novogradac industry standards. Buffer is acknowledged as a screening simplification in [market-analysis.html:154](../../market-analysis.html#L154).

### 2.5 Honesty disclosures already in place

The codebase is unusually candid about its limits:
- `scoreFeasibility` doc-block: *"These scores are directional flags from public data. They do NOT replace Phase I ESA, geotechnical survey, or FEMA LOMA determination."*
- "Soil score" is actually CDC EJI environmental burden, NOT geotechnical — disclosed inline
- Subsidy basis boost is unified (single 40-pt bonus) not stacked QCT + DDA — correct per IRC §42(d)(5)(B)

---

## 3. What's broken or stubbed

### 3.1 🔴 Infrastructure Feasibility — utility capacity is stubbed

[`pma-infrastructure.js:100-105`](../../js/pma-infrastructure.js#L100):
```js
return Promise.resolve({ sewerHeadroom: 0.5, waterCapacity: 0.5 });
```

Every site gets neutral 50% headroom for sewer + water because `DataService.fetchUtilityCapacity()` was never connected to the existing `utility_capacity_co.geojson` layer.

**Impact:** Infrastructure feasibility composite is partially fabricated. Flood + climate parts are real; utility part is not.

**Fix options:**
1. Wire the geojson layer to a real `fetchUtilityCapacity()` method
2. Remove the utility component from the composite if data isn't trustworthy
3. Show "N/A — utility capacity data not available" instead of a number

### 3.2 🟡 Buffer radius — design but not methodologically tight

The buffer radius (5 mi default, user-adjustable) controls:
- Which ACS tracts are aggregated (`tractsInBuffer`)
- Which LIHTC projects count toward capture risk
- Visual circle on the map

But:
- It does **not** modify the score itself proportionally — a 5-mile buffer and a 3-mile buffer at the same site will produce different scores via different ACS aggregates, but neither weights tracts by distance from the center
- It does **not** account for barriers (rivers, highways) — a 5-mile buffer can cross a freeway no LIHTC tenant would walk across
- It does **not** carve out by commute-shed automatically (that's the separate "commuting" PMA method)

**Recommendation:** Either (a) document explicitly that buffer = simple radius and isn't a defensible PMA for market studies (currently this IS disclaimed at market-analysis.html:154), OR (b) move users to the Hybrid method by default and demote Buffer to "screening only" in the tab UI.

### 3.3 🟡 Loaded-but-unused data

Substantial data is loaded into the page but never read by the scoring engine:

| File | What's in it | Could feed |
|---|---|---|
| `chas_tract_co.json` | Tract-level CHAS (renter+owner burden by AMI tier) | Site-level demand component, fine-grained AMI gap |
| `cdle_job_postings_co.json` | Current job postings per county | Workforce dimension's job-trend signal |
| `cdot_traffic_co.json` | CDOT traffic counts | Site quality / arterial access |
| `epa_sld_co.json` | EPA Smart Location Database — walkability, transit access, density | Access dimension — replace OSM heuristics |
| `food_access_co.json` | USDA food desert flags per tract | Access dimension food-quality signal |
| `climate_hazards_co.json` | NOAA + EJI tract-level hazard scores | Feasibility climate component (partly used) |

### 3.4 🟡 Score weights are not calibrated to outcomes

The 6-dimension weights (25/20/15/15/15/10) and the 5-dimension PMA weights (30/25/15/15/15) are reasonable defaults but not back-tested against actual LIHTC project outcomes. There's no validation that weighting demand at 25% (vs 20% or 30%) produces better site recommendations.

**Recommendation:** A historical back-test against awarded CHFA LIHTC projects (which got built, which struggled at lease-up) could validate or recalibrate the weights. Not a quick fix but worth flagging.

### 3.5 🟢 Capture risk threshold (25%) is somewhat arbitrary

`RISK.captureHigh = 0.25` — meaning "25% of qualified renters already in existing LIHTC = high capture risk." This is a reasonable rule-of-thumb but not from any specific industry standard. Some markets (resort, college towns) might appropriately have higher saturation.

---

## 4. Recommendations (prioritized)

### Must-fix before formal use

1. **Wire utility_capacity_co.geojson** to `pma-infrastructure.js → fetchUtilityCapacity()`, OR remove the utility component from the Infrastructure Feasibility scorecard. The current stub silently injects neutral data into a published score.

### Should-fix soon

2. **Default the PMA method tabs to Hybrid** instead of Buffer, since buffer-method analysis is explicitly disclaimed as "screening only." Keep buffer as an option but make hybrid the visible default.

3. **Connect EPA SLD walkability** to the Access dimension (replaces OSM-distance heuristics with EPA's standard composite walkability/transit-access index). Data is loaded; just needs wiring.

4. **Connect tract-level CHAS** (`chas_tract_co.json`) for finer site-level AMI targeting. Each tract has full CHAS renter+owner burden by AMI tier.

### Nice-to-have

5. Back-test the weight calibration against CHFA awarded projects.
6. Add a "barriers-aware" buffer mode — circle minus natural-barrier polygons (rivers, freeways from `natural_barriers_co.geojson` already loaded).

---

## 5. Key file map

| File | Role |
|---|---|
| [`js/market-analysis.js`](../../js/market-analysis.js) | Main PMA controller — runAnalysis, computePma, scoreDemand/CaptureRisk/RentPressure/MarketTightness/Workforce |
| [`js/market-analysis/site-selection-score.js`](../../js/market-analysis/site-selection-score.js) | 6-dimension Site Selection Score model |
| [`js/market-analysis/market-analysis-utils.js`](../../js/market-analysis/market-analysis-utils.js) | Helpers — `opportunityBand()` thresholds |
| [`js/pma-infrastructure.js`](../../js/pma-infrastructure.js) | Infrastructure Feasibility composite (flood + climate + utility-STUB + food) |
| [`js/pma-delineation.js`](../../js/pma-delineation.js) | PMA polygon rendering (buffer / commuting / hybrid) |
| [`js/pma-commuting.js`](../../js/pma-commuting.js) | LEHD LODES commuting-shed polygon builder |
| [`js/pma-schools.js`](../../js/pma-schools.js) | School-district-aligned PMA refinement |
| [`js/data-connectors/osm-amenities.js`](../../js/data-connectors/osm-amenities.js) | OSM-loaded amenity lookup (used by Site Summary + Access score) |

---

## 6. Recent session changes (referenced PRs)

- **#881** — populated empty Snapshot panels; fixed BLS county lookup; clarified Affordability math
- **#882** — AMI Gap panel 7-band expansion + heatmap palette
- **#885** — Housing Needs Scorecard v2 (percentile-normalised, includes owner cost burden, resort-aware)
- **#887** — Target vacancy fix — ACS active-market subset, bounded 5-7%
- **#888** — PMA amenity wiring (Nearest grocery/healthcare/school/park)
- **#889** — PMA: severe burden + poverty + unemployment surfaced + strengthened demand score

All merged before this audit was written.
