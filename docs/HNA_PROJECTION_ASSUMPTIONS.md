# HNA Projection Assumptions (Transparent + Checkable)

This site’s *planning* projections are meant to be auditable. The page surfaces all key assumptions and links directly to the source queries used.

## Where the inputs come from

### County baseline & forecast (primary)
- **County population & net migration (forecast)**: Colorado State Demography Office (DOLA/SDO) county **components-of-change**.
- **County households, housing units, vacancy (base year)**: DOLA/SDO county **profiles**.
- **County households (forecast)**: DOLA/SDO county **household projections** (`household-county.csv`). The stored series `housing_need.households_dola` starts at the profile's base-year households and moves each later year by the forecast's change from its own base-year value, so it carries the forecast's changing household size and age structure. `housing_need.household_method` records the method per year: `sdo_household_forecast`, or `constant_headship` (population × the base-year headship rate) where the forecast has no value (#2260; La Plata County's 2024–2034 household growth was 61% low under the constant rate).

These are cached by the ETL into `data/hna/projections/{countyFips}.json`. The stored county series feeds `places.json`, the ranking index, the jurisdiction briefs and the homepage snapshot.

### Municipal / CDP projection inputs
Covered places/CDPs use `data/hna/projections/places.json`, which downscales
county DOLA projections with a 50/50 blend of:

- **ACS household share**: place households ÷ containing-county households
- **BPS permit share**: place permits ÷ containing-county permits over the
  complete 2020-2024 permit window

If permit share is unavailable, the place projection falls back to household
share. Cross-county municipalities use combined-county denominators before the
blended share is applied.

The legacy `data/hna/derived/geo-derived.json` cache still exists for fallback
and diagnostic context, but it is no longer the primary source for covered
place/CDP growth projections.

## How municipal projections are constructed

For a selected place/CDP:
- Prefer the place/CDP series in `data/hna/projections/places.json`.
- If a place/CDP is not covered by that file, fall back to the containing
  county DOLA projection scaled by a defensible local household/share proxy.
- Label the method so users can distinguish `place_permit_blend` from
  fallback county scaling.

## Converting population to housing need

The HNA page's interactive calculator (horizon, target vacancy and headship controls) computes a planning estimate from population and headship, and shows the stored county forecast beside it in its reconciliation note:

1) **Households**
- `households(t) = population(t) × headship(t)`

2) **Units needed**
- `units_needed(t) = households(t) ÷ (1 − target_vacancy)`

3) **Incremental units needed**
- `incremental_units(t) = units_needed(t) − base_housing_units`

### Headship mode
- **Hold**: constant `headship_base`
- **Trend**: `headship(t) = clamp(headship_base + headship_slope_per_year × t, 0.05, 0.95)`

## Validation

On the HNA page, the **Methodology** section includes a “Projection scaling inputs (precomputed)” panel for featured geographies that lists the derived values and links to the Census API queries.
