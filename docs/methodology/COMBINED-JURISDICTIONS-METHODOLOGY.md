# Combined Jurisdictions Methodology

## Purpose

Combined Jurisdictions are a screening estimate for looking at two to six non-overlapping Colorado jurisdictions as one planning area. They are intended for early community planning and regional discussion. They are not a certified housing needs study, project feasibility model, underwriting conclusion, or agency funding decision.

## Selection Rules

Members may be places, CDPs, or whole counties. The validator rejects:

- Fewer than two or more than six members.
- Duplicate members.
- A place or CDP selected together with any county it overlaps.
- A cross-county place selected together with any of its member counties.

If a user wants to inspect a place next to its containing county, that is a paired comparison, not an aggregation. Summing a place with its county would double-count the place.

Phantom place GEOIDs are resolved through `data/hna/place-phantom-aliases.json` before lookup.

## Aggregation Rules

All combined calculations use one engine, `js/hna/combined-geo.js`.

### CHAS Counts

Household counts, cost-burdened counts, and AMI-band totals are summed from:

- `data/hna/place-chas.json` for places and CDPs.
- `data/hna/chas_affordability_gap.json` for counties.

Rates and shares are never averaged across members. They are re-derived after summing:

```text
combined_share = summed_numerator / summed_denominator
```

### AMI Gap

AMI gap uses raw cumulative fields from:

- `data/co_ami_gap_by_place.json`
- `data/co_ami_gap_by_county.json`

For each AMI band, the engine first sums cumulative households and cumulative units across members. It then converts those cumulative totals into band-over-band deltas, clamps each per-band shortage at zero, and finally re-cumulates:

```text
band_gap = max(0, delta_households - delta_units)
combined_cumulative_gap = cumulative_sum(band_gap)
```

This avoids the known failure mode where directly netting cumulative totals can create a non-monotonic combined gap.

### Median-Type Metrics

Combined areas do not have a true median home value, median rent, or median household income in this phase. Where member data exists, the UI may show member ranges and household-weighted modeled averages, clearly labeled `MODELED`. A weighted average must not be presented as a median.

### HUD AMI Limits

HUD AMI income limits are county-level. A single-county combined area can use that county's limits. A multi-county combined area lists each county's limits separately and never blends them.

## Unavailable Panels

Some HNA panels are intentionally unavailable for combined areas because summing would mislead users:

- LEHD commute flows and labor-market flows, because trips between members would double-count as both inflow and outflow.
- DOLA and projection panels unless every member has a compatible place-level projection.
- Neighborhood context and parcel/location panels.
- LIHTC map scope in this phase; it remains county/statewide scoped and must disclose that.

Unavailable panels render an explicit "Not available for combined areas" state. They must not silently show a single member's or containing county's data.

## Data Quality

The combined CHAS data quality is the worst member quality. If one member is low confidence or ACS-anchored, the combined result carries that caveat.

## Preset Regions

Preset regions live in `data/hna/combined-regions.json`. They are hand-curated config, not generated data. The four starter presets are:

- Colorado River Valley.
- Roaring Fork Valley.
- Yampa Valley.
- San Luis Valley Core.

Owner review may tune preset membership in later work.
