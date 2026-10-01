# Market Analysis Methodology

This document describes the data sources, ACS field mappings, buffer methodology,
and scoring formula used by the Public Market Analysis (PMA) scoring engine in
`js/market-analysis.js`.

---

## Jurisdiction, market area and project site

These are three different geographies, and each answers a different question.

- **Jurisdiction** is the place, CDP, county or state you are studying. It sets
  the context for HNA figures, policy and the county income limits used by the
  screen. A figure can have a different source geography: the for-sale banner
  identifies HUD county income limits, place or county home values, and sale
  prices allocated from ZIP data. A county fallback or missing source is named
  for that figure, rather than presented as a place observation.
- **Market area (PMA)** is the area from which the study measures housing demand
  and competition. It is drawn around the project site or assembled from the
  census tracts you select. A circular buffer is a screening area, not the city
  boundary or a CHFA-compliant tract PMA. The banner and score card use the same
  result's radius or tract count, rather than the controls for a future run.
- **Exact project site** is the point where site-eligibility checks such as
  transit proximity, QCT/DDA and THIZ are tested. A jurisdiction centroid is
  context for exploring a market, not evidence of a project's eligibility.

A city boundary describes a government jurisdiction; housing demand and nearby
competition can extend across that line. A legitimate project can sit just
outside the selected city. The site check therefore gives a notice, not a
block, when the point **appears to be** outside the selected place/CDP or county
polygon. These boundaries are simplified, so the notice is not a parcel or
legal boundary determination. Missing or failed geometry is reported as
**Boundary check unavailable**. Statewide selections skip this check.

Changing to a different jurisdiction clears the saved workflow market step and
current PMA conclusions. SubjectProject keeps its name, unit counts, bedroom mix
and AMI tiers, but clears its address/coordinates, market rents and citations,
and location-specific utility allowance sources and amounts. This also applies
to a change between two places in the same county. Owner-paid utilities retain
their existing zero-allowance behavior. First binding from an empty jurisdiction
preserves entered subject details, and re-selecting the same GEOID preserves
state. Cached PMA runs must match the current GEOID and county binding; unbound
legacy runs and runs for another jurisdiction require a new analysis. Statewide
runs can restore for the same statewide selection with no county binding.

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

1. **Circle-bbox intersection** is tested between the buffer and each tract's
   bounding box (derived from the TIGERweb polygon geometry stored in
   `tract_centroids_co.json` as `bbox: [minLon, minLat, maxLon, maxLat]`).
   A tract is included when the nearest point on its bounding box to the
   site lies within the buffer radius.  This correctly captures tracts that
   straddle the buffer boundary even when their centroid is outside the radius.
2. When a tract record does not carry a `bbox` field (legacy data built before
   this improvement), the engine falls back to a Haversine distance check
   against the tract **centroid**.
3. ACS metrics for included tracts are **averaged** (weighted equally by tract).
4. LIHTC projects whose coordinate (from `hud_lihtc_co.geojson`) falls within
   the buffer are counted and their `TOTAL_UNITS` summed.

### Caveats
- Bounding-box intersection is a conservative (inclusive) test: a tract whose
  bounding box corner just clips the buffer might not actually overlap once the
  true polygon shape is considered.  This intentional over-inclusion is
  preferable to missed tracts.
- No partial-tract weighting is applied; each included tract contributes
  equally to the aggregated ACS averages.
- Rebuild the centroid file with `scripts/market/build_public_market_data.py`
  (or `scripts/generate_tract_centroids.py`) to populate the `bbox` field for
  all tracts.

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
