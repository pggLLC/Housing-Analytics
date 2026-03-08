# PMA & Site Selection — Definitions, Scoring & Formulas

*Housing Analytics — Colorado LIHTC & Affordable Housing*

---

## 1. Primary Market Area (PMA) Definition

A **Primary Market Area (PMA)** is the geographic zone from which a proposed affordable housing development is expected to draw the majority of its residents.

### 1.1 Delineation Methods

| Mode | Definition | When to Use |
|---|---|---|
| **Buffer-based (legacy)** | Circular buffer around site centroid — 3, 5, 10, or 15 mile options | Backward-compatible default; no external API required |
| **Commuting-based (recommended)** | LEHD/LODES commuting flow polygon capturing ~75 % of likely residents | Preferred for LIHTC market studies; meets NH&RA/Novogradac standards |
| **Hybrid (smart default)** | Commuting boundary + school district alignment + transit catchment | Best defensibility for CHFA applications |
| **Isochrone-based** | True drive-time polygon using OpenRouteService or Mapbox Isochrone API | When optional routing API is configured |

### 1.2 Commuting-Based Delineation Workflow

1. **Fetch LODES workplace data** — query LEHD/LODES WAC file for all workplace locations within a 30-mile radius (vintage 2021 by default).
2. **Analyze commuting flows** — aggregate job counts by census tract; identify origin zones that together account for ~75 % of workers.
3. **Generate convex hull boundary** — build a convex hull from the top origin zone centroids, including the site itself.
4. **Subtract barriers** — remove water bodies (USGS NHD), major highways (TIGERweb), and barrier land cover types (NLCD codes 11, 12, 95).
5. **Align with school districts** — optionally extend or constrain the boundary to match school attendance areas.
6. **Generate justification narrative** — produce an auto-written rationale document citing all data sources.

### 1.3 PMA Tiers
- **Primary PMA (PMA)**: Commuting-based polygon, or ~5–12 mile buffer
- **Secondary Market Area (SMA)**: 30-minute drive-time, or ~25-mile buffer
- **Competitive Set**: Properties within the PMA sharing ≥2 of: same program type, overlapping bedroom mix, same AMI band

---

## 2. Barrier Exclusion Logic

The `PMABarriers` module refines the candidate PMA polygon by excluding:

| Barrier type | Source | Exclusion logic |
|---|---|---|
| Open water bodies | USGS NHD (hydrology layer) | Features with NLCD code 11; any NHD polygon |
| Major highways | TIGERweb Transportation (RTTYP = I, U, S) | Buffered 111 m either side |
| Wetlands / ice | NLCD codes 12, 95 | Direct exclusion |

Estimated exclusion fractions are reported in the ScoreRun `barriers` object and included in the justification narrative.

---

## 3. School District Alignment Rationale

For family-size affordable housing (2+ BR), school quality is a primary resident draw factor. The `PMASchools` module:

1. Fetches ED attendance boundaries within the PMA bounding box.
2. Scores each district by proximity (60 %) and NCES performance index (40 %).
3. Reports the average performance score and lists aligned districts in the justification.

**Alignment rationale** is automatically generated: *"PMA boundary aligns with N school district(s) with avg performance score X/100."*

---

## 4. Transit Accessibility Weighting Formula

```
Transit_Score = 0.35 × Frequency_Score
              + 0.30 × Coverage_Score
              + 0.25 × EPA_SmartLocation_D4a
              + 0.10 × Walk_Score
```

- **Frequency_Score**: Fraction of nearby routes with headway ≤ 15 min × 100
- **Coverage_Score**: Number of distinct routes within 0.5 miles × 15, capped at 100
- **EPA_SmartLocation_D4a**: Transit accessibility index (0–20, scaled ×5)
- **Walk_Score**: EPA D3b pedestrian environment index (scaled ×5)

Transit deserts within the PMA are flagged when no transit stop is within a 0.5-mile walk of a 1-mile grid cell.

---

## 5. Subsidy Expiry Risk Calculation

The `PMACompetitiveSet` module flags HUD NHPD-assisted properties where the subsidy contract expires within the configurable threshold (default: 5 years).

```
atExpiryRisk = (expiryYear - currentYear) ≤ EXPIRY_THRESHOLD
```

At-risk units are listed in the justification narrative as a demand-driver signal: expiring affordable units may convert to market-rate, reducing competition and creating unmet demand.

---

## 6. Automated Justification Narrative Generation

The `PMAJustification` module synthesizes all component outputs into a structured plain-English narrative (≤500 words) suitable for LIHTC/CHFA application attachments.

**Narrative sections:**
1. Boundary method and capture rate
2. Barrier exclusions (if any)
3. Employment center summary
4. School district alignment
5. Transit accessibility rating
6. Opportunity Zone share and incentive eligibility
7. Infrastructure flags (flood risk, utility capacity)
8. Data quality and run ID

**Audit trail** (`generateAuditTrail()`) captures: run_id, data_vintage, LODES_vintage, component weights, data quality rating, and the full narrative.

---

## 7. PMA Scoring Algorithm (0–100)

All sub-scores are normalized to 0–100 using **percentile ranks within Colorado** across the same geography type (census tract or county subdivision). Scores are then weighted and summed.

### 7.1 Weights

| Domain | Weight | Sub-components |
|---|---|---|
| Access & Amenities | **30%** | Schools (distance), grocery stores, transit stops, healthcare facilities |
| Market Depth & Demand | **30%** | Rent burden share (ACS B25070), household growth (ACS B11001 YoY), job accessibility index |
| Competition & Absorption | **25%** | LIHTC units per 1,000 households, pipeline units (permits issued but not complete), vacancy proxy |
| Policy / Feasibility | **15%** | Prop 123 commitment status, zoning inclusionary rate, FEMA flood zone share, SB23-213 rezoning area |

### 7.2 PMA Score Formula

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
  // Use midpoint of tied ranks to avoid bias toward either end of ties
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
