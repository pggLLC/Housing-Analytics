# Primary Market Area (PMA) Analysis

Site-level composite scoring for affordable-housing feasibility: you click a location, the tool draws a buffer, pulls data inside that buffer from half a dozen sources, and returns a 0–100 PMA score with per-factor breakdowns (vacancy, income qualification, commuting, transit, schools, competitive supply, development opportunity). Screening tool for early site selection; not a substitute for a CHFA-required formal PMA.

**Primary entry**: [`market-analysis.html`](../../market-analysis.html)
**Primary code**: [`js/market-analysis.js`](../../js/market-analysis.js) + the `js/pma-*.js` family
**Tests**: [`test/pma-competitive-set.test.js`](../../test/pma-competitive-set.test.js), [`test/pma-transit.test.js`](../../test/pma-transit.test.js), [`test/pma-confidence.test.js`](../../test/pma-confidence.test.js)

---

## What it does

Given a site (lat/lon) and a buffer radius, the PMA pipeline:

1. **Filters the tract / census-block data** within the buffer
2. **Runs source-specific scorers** (competitive set, transit accessibility, schools, food access, flood zones, EPA SLD, opportunity atlas)
3. **Composites the results** into the 0–100 PMA score
4. **Surfaces a justification narrative** suitable for attaching to a CHFA or lender application

The site's PMA score then flows into the [QAP Simulator](./qap-simulator.md) (Geography & Site points) and the [Deal Predictor](./deal-predictor.md) (execution-path selection).

---

## Inputs

### User-controlled (on `market-analysis.html`)

| Control | Options | Notes |
|---|---|---|
| Site location | Click on the map | Auto-geocodes to lat/lon |
| Buffer radius | 3 / 5 / 10 / 15 miles | Dropdown above the map. Default 5 mi |
| Jurisdiction context | Dropdown | Seeds Prop 123 overlays and FMR region |
| Isochrone toggles | Walking / biking rings | Visual layers on the map; don't affect the score |

### Auto-loaded data sources

| Source | Purpose | SLA |
|---|---|---|
| `data/market/tract_centroids_co.json` | Census tract geometry | 32 d |
| `data/market/acs_tract_metrics_co.json` | ACS demographic + income data | 32 d |
| `data/market/hud_lihtc_co.geojson` | Existing LIHTC projects | 95 d |
| `data/market/nhpd_co.geojson` | NHPD subsidized properties | 95 d |
| `data/market/epa_sld_co.json` | EPA Smart Location Database (transit / walk) | 90 d |
| `data/market/food_access_co.json` | USDA Food Access Research Atlas | 90 d |
| `data/market/flood_zones_co.geojson` | FEMA NFHL flood zones | 90 d |

Vintage badge on the page reads `data/market/acs_tract_metrics_co.json`'s `meta.generated` field — see [Data Quality doc](../DATA_QUALITY.md) for the staleness-signal pattern.

---

## Methodology

### Competitive set (`js/pma-competitive-set.js`)

`buildCompetitiveSet(lihtcFeatures, nhpdFeatures, siteLat, siteLon, radiusMiles)` merges HUD LIHTC + NHPD features within the buffer into a unified list. Each entry gets `distanceMiles`, `units`, `programType`, `subsidyExpiryYear`, and an `atExpiryRisk` flag (true when the subsidy expires within 5 years).

Key invariant enforced by [`test/pma-competitive-set.test.js`](../../test/pma-competitive-set.test.js): both HUD LIHTC's `PROJECT_NAME` / `LI_UNITS` uppercase fields **and** NHPD's `property_name` / `total_units` / `subsidy_expiration` snake_case fields must map through to the internal shape. A field-mapping regression in [#629](https://github.com/pggLLC/Housing-Analytics/issues/629) was fixed in [#634](https://github.com/pggLLC/Housing-Analytics/pull/634) — the test file locks that fix against future refactors.

`flagSubsidyExpiryRisk(nhpdFeatures, thresholdYears=5)` produces a sorted list of at-risk properties for the UI panel.

### Transit accessibility (`js/pma-transit.js`)

`calculateTransitScore(siteLat, siteLon, routes, epaData)` returns a 0–100 score. Composite of:
- **Frequency score** — share of nearby routes with headway ≤ 15 min, boosted if ≥3 routes are nearby
- **Coverage score** — count of distinct routes within 0.5 mi walk catchment
- **EPA Smart Location accessibility index** — raw value 0–20 scaled to 0–100
- **Walk score** — EPA D3b pedestrian environment

Weights: frequency 35%, coverage 30%, EPA 25%, walk 10%.

If EPA data is unavailable (no `_dataSource: 'epa-live' | 'epa-sld-local'` marker), the EPA and walk weights **redistribute** to frequency + coverage so the composite stays meaningful rather than collapsing to 0.

[`test/pma-transit.test.js`](../../test/pma-transit.test.js) locks the 0.5-mi walk catchment, the 15-min high-frequency threshold, and the weight-redistribution behavior in 24 assertions.

### Isochrone rings (visual only)

Walking (0.25 / 0.75 / 1.0 mi) + biking (2 / 3 / 5 mi) straight-line buffers drawn on the map. Don't affect the PMA score; strictly a navigability visualization (shipped in [`#622`](https://github.com/pggLLC/Housing-Analytics/pull/622) + [e0e1db7b](../../../../commit/e0e1db7b)). Live GTFS route integration is deferred.

### Confidence / absorption risk

`pma-analysis-runner.js` emits a `confidence` score reflecting how many input sources succeeded. Missing sources add a fallback reason (e.g. _\"Competitive set module data unavailable\"_) rather than silently zeroing out the score. See [`test/pma-confidence.test.js`](../../test/pma-confidence.test.js).

`calculateAbsorptionRisk(competitiveSet, proposedUnits)` returns `{ risk: 'low'|'medium'|'high', captureRate, totalCompetitiveUnits }`. Feeds the Deal Predictor's saturation signal.

---

## Outputs

Panels on `market-analysis.html`:

| Panel | What it shows |
|---|---|
| PMA Composite score | 0–100 overall score with letter-grade banding |
| LIHTC Supply in Buffer | Count + unit total of active/pipeline LIHTC properties in the buffer (see [explainer tooltip](../../market-analysis.html) on the card) |
| Peer Benchmarking | This site's score percentile against ~50 known CO LIHTC projects (see tooltip for scope) |
| Competitive Pipeline | LIHTC projects classified by development stage |
| Enhanced Pipeline Sources | Data-availability checklist (Transit, EPA SLD, HUD AFFH, HUD Opp. Atlas, Utility, USDA Food) |
| PMA Justification Narrative | Auto-generated plain-English rationale suitable for CHFA application attachments |

Every chart carries a source badge (auto-attached by [`js/components/source-badge.js`](../../js/components/source-badge.js) via MutationObserver — see [#651](https://github.com/pggLLC/Housing-Analytics/pull/651)).

---

## Limitations

| Limitation | Detail |
|---|---|
| Screening tool only | Not a substitute for a CHFA-required formal PMA. The disclaimer is in the page intro |
| Buffer is a circle, not the actual market area | A real PMA is drawn around commuting / shopping / service patterns. A circular buffer is a first approximation |
| Transit routes are point-radius filtered | Without GTFS schedules, high-frequency vs. low-frequency comes from a single `headwayMinutes` property per route. Live GTFS integration (RTD + CDOT) is deferred — see audit item #7 |
| Place-level inputs are downscaled | For place/CDP selections, some metrics are scaled from the containing county. UI surfaces this via the `(county-approx)` hint on place HNA pages and the detail-panel disclaimer on [`hna-comparative-analysis.html`](../../hna-comparative-analysis.html) (see [#647](https://github.com/pggLLC/Housing-Analytics/pull/647)) |
| NHPD expiry dates | Parsed from `subsidy_expiration` YYYY-MM-DD strings. Missing dates → the property doesn't count in the `atExpiryRisk` list — not conservative; it just won't flag |
| 50-project reference set | Peer Benchmarking compares against a curated set, not every historical CO deal. Sampling bias is real |

---

## Related

- [Deal Predictor guide](./deal-predictor.md) — consumes the PMA score for execution-path selection
- [QAP Simulator guide](./qap-simulator.md) — consumes the PMA score for Geography & Site points
- [Pro Forma guide](./pro-forma.md) — rent/vacancy assumptions downstream of the PMA's market signal
- [Data Quality doc](../DATA_QUALITY.md) — staleness / sentinel / schema signals on the data files this pipeline reads

## Change log
- 2026-04-21: Competitive-set NHPD field-mapping regression test ([#660](https://github.com/pggLLC/Housing-Analytics/pull/660)), transit scoring tests ([#668](https://github.com/pggLLC/Housing-Analytics/pull/668)), in-page methodology tooltips on LIHTC Supply + Peer Benchmarking ([#662](https://github.com/pggLLC/Housing-Analytics/pull/662)).
