# State-Level Analysis Methodology

## Overview

The Housing Needs Assessment (HNA) tool includes a **state-level analysis module** (`js/state-analysis.js`) that aggregates housing metrics from all 64 Colorado counties to produce statewide totals and weighted averages. This document describes the aggregation formulas, data mapping, confidence rules, known limitations, and how state analysis differs from county and municipality analysis.

---

## 1. Module Architecture

`js/state-analysis.js` is a pure-function IIFE module that:

- Exposes `window.StateAnalysis` in browser environments
- Exports a CommonJS module (`module.exports`) for Node.js / test environments
- Contains **no side effects**: no DOM manipulation, no `fetch()` calls, no localStorage access
- Receives data as function arguments and returns plain objects

### Public API

| Function | Purpose |
|---|---|
| `calculateStateScaling(allCountyData)` | Aggregates county-level metrics to state totals |
| `estimateStateHousingStock(allCountyData)` | Sums housing units across all counties |
| `scaleStateAffordability(allCountyData)` | Population-weighted affordability averages |
| `projectStateDemographics(allCountyProjections)` | Aggregates DOLA population projections |
| `estimateStateEmployment(allCountyLEHD)` | Totals LEHD employment data statewide |
| `calculateStateProp123Baseline(allCountyData)` | Aggregates Prop 123 housing baseline |
| `getStateDataConfidence(dataSource)` | Returns confidence level for given data source |

---

## 2. County-to-State Data Mapping

All state-level values are derived from county-level data files in `data/hna/`:

| State Metric | County Source | Aggregation Method |
|---|---|---|
| Total population | `DP05_0001E` | Sum |
| Total housing units | `DP04_0001E` | Sum |
| Weighted median household income | `DP03_0062E` | Population-weighted average |
| Weighted owner-occupancy rate | `DP04_0047PE` | Population-weighted average |
| Weighted renter rate | `DP04_0046PE` | Population-weighted average |
| Weighted median home value | `DP04_0089E` | Population-weighted average |
| Weighted median gross rent | `DP04_0134E` | Population-weighted average |
| Total vacant units | `DP04_0003E` | Sum |
| Rent burden rate (≥30%) | `DP04_0144PE` + higher bins | Population-weighted average |
| Population projections | `population_dola[]` array | Element-wise sum across counties |
| Employment (LEHD) | `inflow`, `outflow`, `within` | Sum |

### Population-Weighted Average Formula

For a metric _m_ with county values _mᵢ_ and county populations _pᵢ_:

```
weightedAvg(m) = Σ(mᵢ × pᵢ) / Σ(pᵢ)
```

Counties with missing or null values are excluded from both the numerator and denominator.

### Housing Stock Aggregation

Structure-type totals are summed from ACS fields `DP04_0004E` through `DP04_0010E`:
- `DP04_0004E` — Single-family detached
- `DP04_0005E` — Single-family attached
- `DP04_0006E` — 2-unit structures
- `DP04_0007E` — 3–4 unit structures
- `DP04_0008E` — 5–9 unit structures
- `DP04_0009E` — 10+ unit structures
- `DP04_0010E` — Mobile homes / other

---

## 3. Statewide Configuration Files

### `data/hna/state/state-config.json`

```json
{
  "fips": "08",
  "geoid": "08",
  "label": "Colorado (State)",
  "totalCounties": 64,
  "countyGeoids": ["08001", "08003", ...],
  "dataVintage": 2024
}
```

The `countyGeoids` array contains all 64 Colorado county FIPS codes as zero-padded 5-character strings (Rule 1: always use `"08XXX"` format, never bare integers).

### `data/hna/state/state-growth-rates.json`

Statewide demographic growth rates from DOLA SDO 2024 projections:

```json
{
  "baseYear": 2024,
  "annualPopulationGrowthRate": 0.0135,
  "annualHouseholdGrowthRate": 0.0148,
  "annualNetMigrationRate": 0.0042,
  "seniorGrowthRate65plus": 0.0310,
  "housingUnitGrowthRate": 0.0155
}
```

**Rule 3:** `baseYear` must always equal the current data vintage (2024). Do not advance this value without updating all associated data files.

---

## 4. Data Confidence Levels

`getStateDataConfidence(source)` returns a standardized confidence object:

```javascript
{ level: 'high' | 'medium' | 'low', description: string, score: number }
```

| Source String | Level | Score | Notes |
|---|---|---|---|
| `'acs1'` | high | 0.90 | ACS 1-year (large geographies only) |
| `'acs5'` | high | 0.85 | ACS 5-year (all county sizes) |
| `'cache'` | medium | 0.70 | Pre-built ETL cache |
| `'derived'` | medium | 0.65 | Analytically derived from cache |
| `'estimate'` | low | 0.40 | Statistical estimation |
| Any other | low | 0.30 | Unknown provenance |

For statewide analysis, the confidence level is set to `'cache'` when ≥ 60 of 64 county summaries are available, and `'estimate'` otherwise.

---

## 5. Known Limitations

1. **Data latency:** County summary files may be 1–3 months behind the Census Bureau release. The statewide aggregate reflects whatever county data is currently cached.

2. **Aggregation threshold:** If fewer than 60 of 64 county summary files are present, the statewide metrics are flagged with `'estimate'` confidence (score: 0.40).

3. **No direct ACS state-level query:** State totals are derived from county summaries. They will differ slightly from official ACS state-level publications due to rounding and partial-county exclusions.

4. **Income weighting:** Median household income cannot be precisely aggregated (medians don't add). The module uses a population-weighted average of county medians as an approximation.

5. **Projection alignment:** DOLA county projection years may not align exactly across all 64 counties. When arrays differ in length, only years present in the first valid projection entry are used.

---

## 6. How State Analysis Differs from County / Municipality

| Dimension | State | County | Municipality |
|---|---|---|---|
| Geography FIPS | `"08"` (2-digit) | `"08XXX"` (5-digit) | `"08XXXXX"` (7-digit) |
| Boundary layer | None (statewide) | TIGERweb county layer | TIGERweb place layer |
| Data source | Aggregated from 64 counties | ACS + DOLA + LEHD | Interpolated from county |
| Data confidence | medium (cache) typical | high (acs1/acs5) typical | medium (interpolated) |
| LIHTC overlay | Statewide count only | County-filtered | County-filtered |
| Prop 123 | Statewide baseline (sum) | County baseline | Municipality baseline |
| Comparison panel | N/A | State vs. county panel | Municipal vs. county panel |

---

## 7. ETL Integration

State-level data does **not** have a dedicated ETL pipeline — it is aggregated at runtime from the existing 64-county `data/hna/summary/*.json` files. To update the statewide analysis:

1. Run the county-level HNA data build: `python scripts/hna/build_hna_data.py`
2. Verify all 64 county summary files are present in `data/hna/summary/`
3. Reload the HNA page and select "State (Colorado)" scope

See `DEPLOYMENT-GUIDE.txt` for the full ETL workflow.
