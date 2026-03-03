# Market Analysis Method

## Purpose

The Market Analysis page provides a PMA (Primary Market Area)-style scoring tool
that approximates the demand, capture risk, and affordability assessment used in
LIHTC market studies. **All inputs are derived from public data sources only** —
no proprietary household surveys, MLS feeds, or commercial databases are used.

---

## Public Data Sources

### 1. American Community Survey (ACS) 5-Year Estimates — U.S. Census Bureau

- **What it provides:** County-level demographic, income, housing tenure, rent burden,
  and housing stock data.
- **URL:** <https://www.census.gov/programs-surveys/acs>
- **API:** <https://api.census.gov/>
- **Tables used:**
  - `DP02` — Social characteristics (total households: `DP02_0001E`)
  - `DP03` — Economic characteristics (median household income: `DP03_0062E`)
  - `DP04` — Housing characteristics:
    - `DP04_0046PE` — Renter-occupied % of occupied housing units
    - `DP04_0089E` — Median home value
    - `DP04_0134E` — Median gross rent
    - `DP04_0146PE` — % renters paying ≥ 35% of income for rent (cost burden)
- **Caching:** Data is pre-fetched and stored in `data/hna/summary/{geoid}.json`
  by automated GitHub Actions workflows.

### 2. TIGERweb — U.S. Census Bureau

- **What it provides:** Authoritative county boundary polygons for map display.
- **URL:** <https://www.census.gov/data/developers/data-sets/TIGERweb.html>
- **REST endpoint used:**
  ```
  https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query
  ?where=STATE=08&outFields=GEOID,NAME&outSR=4326&f=geojson
  ```
- The tool loads boundaries at runtime; if TIGERweb is unreachable, the county
  dropdown remains functional.

### 3. HUD LIHTC Database — U.S. Department of Housing and Urban Development

- **What it provides:** Low-Income Housing Tax Credit project locations and unit counts.
- **URL:** <https://www.huduser.gov/portal/datasets/lihtc.html>
- **Usage:** Existing affordable unit counts per county (`N_UNITS` field).
- **Caching:** County-level LIHTC summaries are stored in `data/hna/lihtc/{geoid}.json`.
- **Fallback:** When LIHTC data is unavailable, existing affordable units are estimated
  at 3% of total renter households (a conservative national baseline).

---

## Capture / Penetration

Capture rate and penetration proxy are the core output metrics in LIHTC market studies.
This tool approximates those metrics using public data only.

### Band Capture Rate

```
capture_rate = (existing_affordable_units + proposed_units) / qualified_renter_households
```

where:

```
qualified_renter_households = renter_households × AMI_band_fraction
```

`AMI_band_fraction` is an estimated fraction of renter households with income at or below
the selected AMI band ceiling (based on national ACS income distribution approximations):

| Band     | Fraction |
|----------|----------|
| ≤30% AMI | 0.12     |
| 31–50%   | 0.25     |
| 51–60%   | 0.33     |
| 61–80%   | 0.45     |

**Interpretation:** A capture rate below 15% is considered strong market depth;
above 25% raises underwriting concern (consistent with CHFA market-study guidance).

### Overall Penetration Proxy

```
overall_penetration_proxy = (existing_affordable_units + proposed_units) / (0.70 × renter_households)
```

The `0.70` factor approximates the proportion of all renter households with incomes
at or below 80% AMI (a commonly used "qualified universe" ceiling in market studies).

> **Note:** These formulas approximate PMA/capture logic using public data only.
> A full CHFA market study uses proprietary household survey data, on-site vacancy
> surveys, and project-specific amenity comparables. The public-data estimates here
> are suitable for screening and comparative analysis, not regulatory submissions.

---

## Scoring Weights (CHFA-Leaning)

See [PMA_SCORING.md](PMA_SCORING.md) for the full scoring methodology and thresholds.

| Dimension     | Weight |
|---------------|--------|
| Market Demand | 35%    |
| Capture Risk  | 35%    |
| Rent Pressure | 20%    |
| Land Supply   | 7%     |
| Workforce Gap | 3%     |

---

## Renter Household Derivation

```
renter_households = total_households × (renter_pct / 100)
```

- `total_households` = ACS `DP02_0001E`
- `renter_pct` = ACS `DP04_0046PE`

---

## Rent Pressure Index

```
RPI = (median_gross_rent × 12) / (median_household_income × 0.30)
```

- RPI > 1.0 means median rent exceeds the 30%-of-income affordability threshold.
- RPI ≥ 1.10 triggers an "elevated" risk flag.

---

## Limitations

- County-level analysis cannot capture sub-county PMA variation.
- AMI band fractions are national approximations; local income distributions vary.
- LIHTC unit counts may lag current inventory (HUD database has an update lag).
- Existing affordable units default to a 3% estimate when project-level data is absent.
- This tool is for screening and comparative analysis only.
