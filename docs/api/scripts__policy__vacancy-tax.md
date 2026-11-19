# `scripts/policy/vacancy-tax.mjs`

Home rule, or a consolidated city and county (Denver, Broomfield), which is home rule too.

## Symbols

### `estimatePlace(geo, units, est)`

One place's estimate. geo is a data/hna/vacancy-status.json geography; units
is its B25001 housing-unit count. Returns null when the record is missing.

### `estimateAll(tax, vacancy, housing)`

Every municipality in the type list that has an ACS record, with its estimate.

### `briefRows(tax, vacancy, housing)`

The brief's two tables. Places that can levy: middle case at or above the dollar floor, or base
share at or above the share floor. Statutory places: base share at or above the share floor.
Both need at least min_base homes in the base, so a place of a few dozen homes is not ranked.
