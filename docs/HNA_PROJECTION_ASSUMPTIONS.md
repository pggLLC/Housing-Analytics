# HNA Projection Assumptions (Transparent + Checkable)

This site’s *planning* projections are meant to be auditable. The page surfaces all key assumptions and links directly to the source queries used.

## Where the inputs come from

### County baseline & forecast (primary)
- **County population & net migration (forecast)**: Colorado State Demography Office (DOLA/SDO) county **components-of-change**.
- **County households, housing units, vacancy (base year)**: DOLA/SDO county **profiles**.

These are cached by the ETL into `data/hna/projections/{countyFips}.json`.

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

The page computes a planning estimate:

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
