# HNA Projection Assumptions (Transparent + Checkable)

This site’s *planning* projections are meant to be auditable. The page surfaces all key assumptions and links directly to the source queries used.

## Where the inputs come from

### County baseline & forecast (primary)
- **County population & net migration (forecast)**: Colorado State Demography Office (DOLA/SDO) county **components-of-change**.
- **County households, housing units, vacancy (base year)**: DOLA/SDO county **profiles**.

These are cached by the ETL into `data/hna/projections/{countyFips}.json`.

### Municipal / CDP scaling inputs (derived, from ACS5)
For featured places/CDPs, the ETL also precomputes:
- **share0**: place population ÷ county population (latest ACS5 year)
- **pop_cagr**: annualized ACS5 population growth over two ACS5 years
- **county_pop_cagr**: same metric for the containing county
- **relative_pop_cagr**: pop_cagr − county_pop_cagr
- **headship_base**: households ÷ population (latest ACS5 year)
- **headship_slope_per_year**: linear slope between the two ACS5 years

These are cached into `data/hna/derived/geo-derived.json` **including the exact Census API URLs** used for the two year pulls.

## How municipal projections are constructed

For a selected place/CDP:
- Start with the county’s population forecast series.
- Apply a *time-varying share*:
  - `share(t) = clamp(share0 × exp(log(1 + relative_pop_cagr) × t), 0.02, 0.98)`
  - `place_pop(t) = min(county_pop(t) × share(t), county_pop(t))`

If `relative_pop_cagr` is not available, the model uses a constant share (`relative_pop_cagr = 0`).

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
