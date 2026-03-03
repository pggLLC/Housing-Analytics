# Market Analysis Methodology

This document describes the data sources, ACS field mappings, buffer methodology,
and scoring formula used by the Public Market Analysis (PMA) scoring engine in
`js/market-analysis.js`.

---

## Data Sources

All data is **free and publicly available** — no API key is required for the
pre-built artifacts, and the optional Census API key only improves rate limits
when rebuilding.

| Artifact | Source | Refresh |
|---|---|---|
| `data/market/tract_centroids_co.json` | US Census TIGERweb ArcGIS REST | Weekly (GitHub Actions) |
| `data/market/acs_tract_metrics_co.json` | US Census ACS 5-Year Estimates | Weekly (GitHub Actions) |
| `data/market/hud_lihtc_co.geojson` | HUD LIHTC Database | Weekly (GitHub Actions) |

---

## ACS Field Mappings

| Field in artifact | Census variable | Description |
|---|---|---|
| `pop` | `B01003_001E` | Total population |
| `total_hh` | `B25003_001E` | Total occupied housing units |
| `owner_hh` | `B25003_002E` | Owner-occupied housing units |
| `renter_hh` | `B25003_003E` | Renter-occupied housing units |
| `vacant` | `B25004_001E` | Total vacant housing units |
| `median_gross_rent` | `B25064_001E` | Median gross rent ($/month) |
| `median_hh_income` | `B19013_001E` | Median household income ($/year) |
| `cost_burden_rate` | Derived from `B25070` | Share of renters paying ≥30% of income on rent |
| `vacancy_rate` | Derived | `vacant / (total_hh + vacant)` |

### Cost-burden rate derivation

```
cost_burden_rate = (B25070_007E + B25070_008E + B25070_009E + B25070_010E) / B25070_001E
```

- `B25070_007E` — 30.0–34.9% of income on rent
- `B25070_008E` — 35.0–39.9%
- `B25070_009E` — 40.0–49.9%
- `B25070_010E` — 50%+
- `B25070_001E` — Universe: renter-occupied units paying cash rent

---

## Buffer Methodology

The PMA engine draws a circular buffer of the selected radius (3, 5, 10, or 15 miles)
centered on the clicked site location.

1. **Haversine distance** is computed between the site coordinate and every
   tract centroid in `tract_centroids_co.json`.
2. Tracts whose centroid falls within the buffer radius are included.
3. ACS metrics for included tracts are **averaged** (weighted equally by tract).
4. LIHTC projects whose coordinate (from `hud_lihtc_co.geojson`) falls within
   the buffer are counted and their `TOTAL_UNITS` summed.

### Caveats
- Tract-centroid inclusion is a fast approximation. Tracts that straddle the
  buffer boundary are included only when their centroid is inside.
- No partial-tract weighting is applied to the prototype.

---

## Scoring Formula

See [PMA_SCORING.md](PMA_SCORING.md) for the full dimension definitions and
risk flag thresholds.

```
Overall Score = Demand(30%) + CaptureRisk(25%) + RentPressure(15%) + LandSupply(15%) + Workforce(15%)
```

Each dimension is normalised to **0–100** before weighting.

---

## Rebuilding Artifacts

```bash
python scripts/market/build_public_market_data.py
```

Or trigger the `Build Market Data` GitHub Actions workflow manually.
A `CENSUS_API_KEY` GitHub secret improves Census API rate limits but is not required.
