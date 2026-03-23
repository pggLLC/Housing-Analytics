# Site Selection Scoring — Method Guide

## Overview

The COHO Housing Analytics site selection scoring system evaluates proposed LIHTC development sites across multiple demand, competition, rent pressure, and supply dimensions. This document describes the scoring methodology, data sources, and integration with the LIHTC Deal Predictor.

The scoring system has two tiers:

1. **Heuristic PMA Score** — fast, ACS-based score available in all analysis modes
2. **Enhanced PMA Delineation Score** — multi-source score from the 9-step pipeline (Commuting and Hybrid modes)

---

## Heuristic PMA Score

### Data Sources

| Dimension | Source | Weight |
|---|---|---|
| Demand | Census ACS B01003 (population), B25003 (tenure) | 25% |
| Capture Risk | HUD LIHTC Database (nearby units) | 25% |
| Rent Pressure | ACS B25070 (gross rent as % of income) | 20% |
| Land Supply | ACS B25004 (vacancy status) | 10% |
| Workforce | LEHD LODES workplace data | 20% |

### Scoring Formulas

**Demand Score (0–100)**

Based on renter household share and population. A renter share >40% and population >5,000 in the buffer scores highest.

```
demand = min(100, renter_share_pct * 1.5 + pop_factor)
```

**Capture Risk Score (0–100)**

Inverted: more existing LIHTC units in the buffer = lower score.

```
capture_risk = max(0, 100 - (existing_lihtc_units / 10))
```

**Rent Pressure Score (0–100)**

Proportion of renter households paying >30% of income on rent. Higher cost burden = higher rent pressure = higher score (indicates unmet need).

```
rent_pressure = cost_burden_rate * 100
```

**Land Supply Score (0–100)**

Based on rental vacancy rate. Tight vacancy (<3%) scores highest.

```
land_supply = max(0, 100 - vacancy_rate_pct * 20)
```

**Workforce Score (0–100)**

Based on LODES workplace density and job access within the commuting zone. Derived from `_scoreWorkforceWithCoverage()` in `market-analysis.js`.

### Score Tiers

| Score Range | Tier | Interpretation |
|---|---|---|
| 80–100 | Excellent | Strong demand signals, low saturation, high rent pressure |
| 60–79 | Good | Adequate demand, manageable competition |
| 40–59 | Moderate | Mixed signals, review carefully |
| 20–39 | Below Average | Weak demand or high saturation |
| 0–19 | Poor | Site unlikely to support LIHTC feasibility |

---

## Enhanced PMA Delineation (Commuting / Hybrid Modes)

When using Commuting or Hybrid analysis mode, the 9-step pipeline runs additional data sources through `PMAAnalysisRunner`:

### Pipeline Steps

| Step | Module | Data Source |
|---|---|---|
| 1 | PMACommuting | LEHD LODES (workplace flows) |
| 2 | PMABarriers | USGS Hydrology, NLCD Land Cover, State Highways |
| 3 | PMAEmploymentCenters | LODES cluster analysis |
| 4 | PMASchools | NCES school boundary data |
| 5 | PMATransit | NTD transit routes, EPA Smart Location |
| 6 | PMACompetitiveSet | HUD LIHTC + NHPD preservation data |
| 7 | PMAOpportunities | HUD Opportunity Zones, AFFH, Opportunity Atlas |
| 8 | PMAInfrastructure | FEMA flood data, NOAA climate, utility capacity |
| 9 | PMAJustification | Synthesis and narrative generation |

### PMA Support Summary

After each enhanced run, `scoreRun.pmaSupportSummary` provides:

```json
{
  "runId": "pma-run-20260323-1",
  "method": "hybrid",
  "bufferMiles": 5,
  "sourceMode": "live",
  "sources": {
    "commuting": "live",
    "barriers": "fallback",
    "amenities": "synthetic",
    "infrastructure": "live"
  },
  "dataCompleteness": 0.71,
  "temporalFreshness": 0.90,
  "lihtcCoverage": 0.95,
  "sampleAdequacy": 0.55,
  "bufferProximity": 0.50,
  "overallConfidence": "medium",
  "confidenceBadge": "🟡",
  "fallbackModes": [
    "barriers: Barriers module data unavailable"
  ]
}
```

**Confidence calculation:**

```
confidence = (dataCompleteness × 0.40) + (lihtcCoverage × 0.25) +
             (sampleAdequacy × 0.20) + (temporalFreshness × 0.15)
```

- `high`: ≥0.75
- `medium`: ≥0.50
- `low`: <0.50

---

## Confidence Badge

The confidence badge summarizes data quality for the current analysis run:

| Badge | Level | Meaning |
|---|---|---|
| 🟢 | High | ≥3 live data sources; LODES data present; LIHTC coverage ≥90% |
| 🟡 | Medium | 2 live sources; partial LODES; coverage 60–89% |
| 🔴 | Low | Mostly fallback data; no LODES; coverage <60% |

Rendered by `PMAConfidence.renderConfidenceBadge()` (js/pma-confidence.js).

---

## Integration with LIHTC Deal Predictor

After a site is scored, the PMA score feeds directly into the LIHTC Deal Predictor:

```
Site Click → runAnalysis() → PMA Score → predictConcept()
                                              ↓
                                    DealRecommendation
                                              ↓
                                    Concept Card (UI)
```

The concept card renders:
- Recommended credit type (4% or 9%)
- Concept type (family/seniors/mixed-use/supportive)
- Suggested unit mix and AMI mix
- Indicative capital stack
- Key rationale and risks
- Alternative path description
- Confidence badge

For buffer mode, a summary card renders automatically after `runAnalysis()`. For Commuting/Hybrid mode, the full card renders in `pma-ui-controller.js` after the enhanced pipeline completes.

---

## Data Freshness

| Source | Update Frequency | Notes |
|---|---|---|
| ACS 5-Year Estimates | Annual (December) | 2019–2023 vintage as of 2026 |
| HUD LIHTC Database | Annual | Cached via `fetch-chfa-lihtc.yml` |
| LODES Workplace Data | Annual | 2021 vintage default |
| NHPD Preservation | Quarterly | 6-hour TTL via CacheManager |
| HUD QCT/DDA | Annual | Cached via `cache-hud-gis-data.yml` |

---

## Limitations

1. **ACS margins of error**: Tract-level ACS estimates have significant MOE at small geographies. Scores in small tracts (<500 households) should be interpreted cautiously.
2. **LIHTC coverage lag**: The HUD LIHTC database lags allocations by 12–18 months. Recent awards may not appear in competitive set analysis.
3. **No parcel-level zoning**: Site suitability does not incorporate local zoning entitlement risk.
4. **No environmental screening**: FEMA flood data and NOAA climate data may be unavailable for some sites (fallback neutral values used).
5. **Workforce data vintage**: LODES data uses 2021 vintage; post-pandemic commuting patterns may differ.

---

## Files

| File | Purpose |
|---|---|
| `js/market-analysis.js` | Heuristic PMA scoring engine |
| `js/pma-analysis-runner.js` | Enhanced pipeline orchestrator + PMA support summary |
| `js/pma-confidence.js` | Confidence badge rendering |
| `js/pma-justification.js` | Narrative synthesis |
| `js/lihtc-deal-predictor.js` | Concept recommendation from PMA score |
| `docs/PMA_SCORING.md` | Detailed PMA dimension scoring |
| `docs/PMA_CONFIDENCE_SCORING.md` | Confidence badge methodology |
| `docs/LIHTC_DEAL_PREDICTOR.md` | Deal predictor method guide |

---

*Part of the COHO Housing Analytics platform. See `README.md` for the full feature list.*
