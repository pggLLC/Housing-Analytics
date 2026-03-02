# Market Analysis Methodology

## Overview

The Market Analysis page provides a Public Market Analysis (PMA) tool for affordable housing
site selection, using exclusively **freely available public data sources**. No proprietary
APIs (ESRI Business Analyst, MLS, Zillow, paid services) are used.

## Data Sources

| Source | Dataset | Use |
|--------|---------|-----|
| U.S. Census Bureau — ACS 5-Year Estimates | B25070 (cost burden), B25004 (vacancy), B25014 (overcrowding), B25003 (tenure) | Demand & market condition metrics |
| Census TIGERweb ArcGIS REST API | CENTLAT / CENTLON tract centroids | PMA buffer coverage |
| HUD Low Income Housing Tax Credit (LIHTC) database | `services.arcgis.com` public dataset | Comparable affordable supply count |

## ACS Field Mappings

| ACS Table | Field | Metric |
|-----------|-------|--------|
| B25070 | B25070_010E / B25070_001E | Cost-burdened renter households (≥ 30% income on rent) |
| B25004 | B25004_001E | Vacant housing units |
| B25014 | B25014_005E + B25014_011E | Overcrowded renter-occupied units (>1 person/room) |
| B25003 | B25003_003E / B25003_001E | Renter-occupied share |
| B25064 | B25064_001E | Median gross rent |
| B23025 | B23025_002E / B23025_001E | Labor force participation rate |

## PMA Buffer Methodology

1. Site coordinates are set via map click (WGS 84 lat/lon).
2. A Haversine-distance calculation identifies all Census tract centroids
   (from `data/market/tract_centroids_co.json`) within the selected radius (3/5/10/15 miles).
3. ACS metrics for the matching tracts are aggregated (population-weighted sums and averages).
4. HUD LIHTC projects are similarly filtered by Haversine distance.

**Why tract centroids instead of polygon intersection?**

Full polygon GIS intersection requires heavy client-side processing. Using tract centroids
(CENTLAT/CENTLON from TIGERweb) provides a good approximation at low computational cost,
consistent with industry practice for quick-turnaround PMA work.

## Scoring Formula

The Overall Site Score (0–100) is a weighted sum of five dimension scores:

```
Overall = 0.30 × Demand
        + 0.25 × CaptureRisk
        + 0.15 × RentPressure
        + 0.15 × LandSupply
        + 0.15 × Workforce
```

### Dimension Formulas

| Dimension | Weight | Formula |
|-----------|--------|---------|
| **Demand** | 30% | `min(100, (costBurdenedPct / 0.40) × 55 + (renterShare / 0.60) × 45)` |
| **Capture Risk** | 25% | `max(0, 100 − (lihtcCount / 10) × 100)` — inverted: more supply = lower score |
| **Rent Pressure** | 15% | `min(100, (medianGrossRent / 1400) × 70)` — CO median benchmark $1,400 |
| **Land/Supply** | 15% | `max(0, (1 − vacancyPct / 0.08) × 100)` — benchmark 8% vacancy |
| **Workforce** | 15% | `min(100, (lfpRate / 0.70) × 100)` — benchmark 70% LFP |

### Score Interpretation

| Range | Interpretation |
|-------|----------------|
| 70–100 | Strong market — high demand, limited supply |
| 45–69 | Moderate market — mixed signals |
| 0–44 | Weak market — low demand or high competing supply |

## CHFA Capture Rate Simulator

The capture-rate simulator estimates the fraction of income-qualified renter households
in the PMA that would be housed by the proposed project.

```
Qualified Households ≈ renterHouseholds × (costBurdenedPct + 0.10)

Capture Rate = proposedUnits / Qualified Households
```

The CHFA guideline threshold is **≤ 25%**. Projects exceeding this threshold receive a
risk flag in the analysis panel.

## Data Artifacts

Artifacts are pre-computed and committed to the repository under `data/market/`:

| File | Description |
|------|-------------|
| `tract_centroids_co.json` | Array of `{ geoid, lat, lon }` for all Colorado census tracts |
| `acs_tract_metrics_co.json` | Array of per-tract ACS metrics (see field list above) |
| `hud_lihtc_co.geojson` | GeoJSON FeatureCollection of HUD LIHTC projects in Colorado |

These are refreshed weekly by the `build-market-data.yml` GitHub Actions workflow.

## Python Builder

`scripts/market/build_public_market_data.py` fetches and transforms the above data:

1. Fetches Census ACS tract data via the Census Data API (no key required; optional key for higher rate limits).
2. Fetches TIGERweb tract centroids via the ArcGIS REST API.
3. Fetches HUD LIHTC public dataset.
4. Computes tract-level metrics.
5. Outputs `data/market/*.json` artifacts.
