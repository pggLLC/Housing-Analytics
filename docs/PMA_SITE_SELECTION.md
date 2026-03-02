# PMA & Site Selection — Definitions, Scoring & Formulas

*Housing Analytics — Colorado LIHTC & Affordable Housing*

---

## 1. Primary Market Area (PMA) Definition

A **Primary Market Area (PMA)** is the geographic zone from which a proposed affordable housing development is expected to draw the majority of its residents.

| Mode | Definition | When to Use |
|---|---|---|
| **Buffer-based (no API)** | Circular buffer around site centroid — 15-min drive ≈ 12 mi radius in urban/suburban areas; 20–25 mi in rural | Default; no external routing API required |
| **Isochrone-based** | True drive-time polygon using OpenRouteService or Mapbox Isochrone API | Preferred when API is available; more accurate for mountainous terrain |

### PMA Tiers
- **Primary PMA**: 15-minute drive-time (or ~12-mile buffer in absence of routing API)
- **Secondary PMA**: 30-minute drive-time (or ~25-mile buffer)
- **Competitive Set**: Properties within the Primary PMA that share ≥2 of: same program type (LIHTC, market-rate, HUD Section 8), overlapping bedroom mix, same AMI band (≤60% AMI, 60–80%, 80–120%)

---

## 2. PMA Scoring Algorithm (0–100)

All sub-scores are normalized to 0–100 using **percentile ranks within Colorado** across the same geography type (census tract or county subdivision). Scores are then weighted and summed.

### 2.1 Weights

| Domain | Weight | Sub-components |
|---|---|---|
| Access & Amenities | **30%** | Schools (distance), grocery stores, transit stops, healthcare facilities |
| Market Depth & Demand | **30%** | Rent burden share (ACS B25070), household growth (ACS B11001 YoY), job accessibility index |
| Competition & Absorption | **25%** | LIHTC units per 1,000 households, pipeline units (permits issued but not complete), vacancy proxy |
| Policy / Feasibility | **15%** | Prop 123 commitment status, zoning inclusionary rate, FEMA flood zone share, SB23-213 rezoning area |

### 2.2 PMA Score Formula

```
PMA_Score = 0.30 × Access_Score
           + 0.30 × Demand_Score
           + 0.25 × Competition_Score
           + 0.15 × Policy_Score
```

Where each component score is a 0–100 percentile rank value.

### 2.3 Component Definitions

**Access & Amenities Score (A)**
```
A = percentile_rank(
      0.30 × school_proximity_score      // 1 – (min_dist_to_school_km / 10), capped [0,1]
    + 0.25 × grocery_proximity_score     // 1 – (min_dist_to_grocery_km / 5), capped [0,1]
    + 0.25 × transit_stop_score          // min(stops_within_800m / 5, 1)
    + 0.20 × healthcare_proximity_score  // 1 – (min_dist_to_clinic_km / 8), capped [0,1]
)
```

**Market Depth & Demand Score (D)**
```
D = percentile_rank(
      0.40 × rent_burden_share      // ACS B25070: pct HH paying ≥30% income on rent
    + 0.35 × household_growth_rate  // (HH_current – HH_5yr_ago) / HH_5yr_ago
    + 0.25 × job_accessibility      // ln(sum of jobs reachable within 30-min drive)
)
```

**Competition & Absorption Score (C)**
```
// Lower competition = higher score (inverted)
C = 100 – percentile_rank(
      0.40 × lihtc_units_per_1k_hh   // LIHTC inventory / (HH count / 1000)
    + 0.35 × pipeline_pressure       // Permitted LIHTC units (12 mo) / (HH count / 1000)
    + 0.25 × vacancy_proxy           // ACS B25004 pct vacant units (inverted: lower vacancy → higher pressure)
)
```

**Policy / Feasibility Score (P)**
```
P = percentile_rank(
      0.35 × prop123_committed       // Binary: 1 if jurisdiction filed Prop 123, else 0
    + 0.30 × inclusionary_rate       // % of new residential units required to be affordable
    + 0.20 × flood_risk_inverse      // 1 – (pct parcels in FEMA AE/AO zone)
    + 0.15 × rezoning_opportunity    // Binary: 1 if within SB23-213 TOD or ADU-enabled zone
)
```

---

## 3. Site Selection Formula (0–100)

The Site Selection Score integrates the PMA Score with additional site-level attributes.

```
Site_Score = 0.35 × PMA_Score
           + 0.20 × Proximity_to_Services_Score
           + 0.15 × Land_Feasibility_Score
           + 0.15 × Competition_Risk_Score
           + 0.15 × Policy_Incentives_Score
```

### Component Definitions

| Component | Definition | Data Source |
|---|---|---|
| PMA_Score | Weighted PMA score from §2 above | Derived |
| Proximity_to_Services | Composite score: transit access + walkability index + grocery/healthcare proximity | OpenStreetMap (Overpass API), GTFS feeds |
| Land_Feasibility | Composite: parcel size adequacy + zoning compatibility + slope (terrain) + environmental constraint index | County assessor data, FEMA, USGS |
| Competition_Risk | Inverse of: LIHTC saturation + pipeline density within 2-mile radius | HUD LIHTC database, CHFA ArcGIS |
| Policy_Incentives | Prop 123 status + local inclusionary zoning rate + available subsidy programs | `data/prop123_jurisdictions.json`, DOLA |

---

## 4. Normalization Method

All raw metric values are normalized to 0–100 using **percentile ranks within Colorado** before weighting:

```javascript
function percentileRank(value, allValues) {
  const sorted = [...allValues].sort((a, b) => a - b);
  const below = sorted.filter(v => v < value).length;
  const equal = sorted.filter(v => v === value).length;
  return ((below + 0.5 * equal) / sorted.length) * 100;
}
```

This ensures scores are relative to the Colorado market context rather than absolute national benchmarks.

---

## 5. Explainability Guidelines

- Every score run must store the raw input values, percentile rank, and component weights used
- Score runs are versioned with a `run_id`, `created_at`, and `data_vintage` (e.g. ACS 5-year release year)
- End users can request a "score breakdown" that shows each component's contribution in plain language
- Weights can be overridden by analysts with documented justification (see `GIS_DATA_MODEL.md` ScoreRun schema)

---

## 6. Implementation Notes

1. **No proprietary API required**: Use Census ACS APIs, HUD ArcGIS public endpoints, and OpenStreetMap Overpass for all inputs
2. **Buffer-based default**: Ship with circular buffer PMA until routing API is configured
3. **Comparable set logic**: Filter LIHTC inventory by: within PMA OR within 5-mile radius PLUS matching ≥2 of program type, bedroom mix, AMI band
4. **Data vintage**: Use the most recent ACS 5-year estimates; update scores when new release is available (typically December each year)
5. **Score caching**: Cache score runs in `localStorage` with 30-day TTL; invalidate on data vintage change
