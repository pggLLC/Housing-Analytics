# PMA Heuristic Confidence Scoring

## Overview

The PMA (Public Market Analysis) confidence score provides users with a transparent assessment of how reliable the computed PMA score is, based on the quality and completeness of the underlying data. It is implemented in `js/pma-confidence.js` and exposed as `window.PMAConfidence`.

## Confidence Levels

| Score | Level | Indicator | Interpretation |
|-------|-------|-----------|----------------|
| ≥ 80 | High | 🟢 | Full confidence — data coverage is adequate for reliable scoring |
| 60–79 | Medium | 🟡 | Moderate — recommend validating with additional sources |
| < 60 | Low | 🔴 | Sparse data — treat results as preliminary |

## Scoring Factors

The heuristic confidence score is a weighted composite of five independent factors:

### 1. Data Completeness (25%)
Measures what proportion of required ACS fields are non-null across all loaded tracts.

Required fields: `median_gross_rent`, `median_hh_income`, `cost_burden_rate`, `vacancy_rate`, `renter_hh`, `total_hh`

- 100% non-null → score 100
- 80% non-null → score 80
- etc.

### 2. Temporal Freshness (20%)
Penalises data older than the target ACS vintage year (currently 2022).

| Age | Score |
|-----|-------|
| ≤ 1 year | 100 |
| ≤ 2 years | 90 |
| ≤ 3 years | 75 |
| ≤ 4 years | 60 |
| ≤ 6 years | 40 |
| > 6 years | 20 |

### 3. Geographic LIHTC Coverage (20%)
Measures loaded LIHTC project count relative to expected statewide baseline (500 projects).

- 500+ projects → score 100
- 250 projects → score 50
- 100 projects → score 20

### 4. Sample Size Adequacy (20%)
Adequate total statewide tract count enables stable aggregate statistics (target: 1,300 tracts).

- 1,300+ tracts → score 100
- 650 tracts → score 50
- 130 tracts → score 10

### 5. Buffer Proximity / Depth (15%)
How many ACS tracts fall within the analysis buffer.

- < 5 tracts → score 0–50 (proportional)
- 5–20 tracts → score 50–100 (proportional)
- 20+ tracts → score 100

## Example Calculation

For a Denver site with 5-mile buffer:
- ACS: 1,447 tracts, all fields populated → completeness = 100, sample_size = 100 (capped)
- Vintage 2022, current year 2026 → 4 years old → freshness = 60
- LIHTC: 360 projects → lihtc_coverage = 72
- Buffer: ~25 tracts → buffer_depth = 100
- Composite: `100×0.25 + 60×0.20 + 72×0.20 + 100×0.20 + 100×0.15 = 83` → **High** 🟢

## Usage

```javascript
var result = window.PMAConfidence.compute({
  acsTracts:     acsMetrics.tracts,  // array of ACS tract records
  lihtcCount:    lihtcFeatures.length,
  centroidCount: tractCentroids.tracts.length,
  bufferTracts:  bufTracts.length,   // tracts in the analysis buffer
  acsVintage:    2022                // ACS data year
});

// result = { score: 83, level: "High", color: "var(--good)", factors: {...} }

// Render to DOM
window.PMAConfidence.renderConfidenceBadge('pmaHeuristicConfidence', result);
```

## Integration in PMA Export

The confidence score and all factor sub-scores are included in:
- **JSON export** (`pma-result.json`): `result.confidence`
- **CSV export** (`pma-result.csv`): `confidence_score`, `confidence_level`, and individual factor columns

## Updating

- `TARGET_ACS_VINTAGE` — update to the latest ACS 5-year release year when new data is available
- `TARGET_LIHTC_PROJECTS` — update if Colorado LIHTC database grows significantly
- `WEIGHTS` — adjust factor weights if research indicates different relative importance

See `js/pma-confidence.js` for full implementation.
