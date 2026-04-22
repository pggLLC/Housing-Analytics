# `js/pma-parcel-zoning.js`

js/pma-parcel-zoning.js
Parcel and zoning overlay for identifying multifamily development sites.

Loads pre-built data from:
  data/market/parcel_aggregates_co.json   — county-level parcel aggregates
  data/market/zoning_compat_index_co.json — multifamily zoning compatibility

Color classification:
  ● Green  (compat ≥ 2.0, private, vacant/underutilized) — high MF opportunity
  ● Yellow (compat ≥ 1.0, low-density developed or infill) — moderate opportunity
  ● Gray   (compat < 1.0 or insufficient data) — limited/no MF opportunity

Circle-marker radius is scaled by the number of developable parcels so that
large counties with many opportunities are visually prominent.

Public API (window.PMAParcelZoning):
  loadParcelData()                           → Promise<{parcels, zoning}>
  renderParcelZoningLayer(map, lat, lon, mi) → void
  removeParcelLayer(map)                     → void
  getLoadedData()                            → {parcels, zoning} or null

Degrades gracefully when the data files are stubs (empty arrays).

## Symbols

### `loadParcelData()`

Load parcel and zoning data (deduplicated — second call returns cached).
@returns {Promise<{parcels: object[], zoning: object[]}>}

### `_classify(parcel, zone)`

Classify a parcel county record + zoning entry into a color tier.
@param {object} parcel  — from parcel_aggregates_co.json counties[]
@param {object} zone    — from zoning_compat_index_co.json jurisdictions[]
@returns {{ color: string, tier: string, label: string }}

### `renderParcelZoningLayer(map, lat, lon, bufferMiles)`

Render parcel/zoning markers within `bufferMiles` of (lat, lon).
Call loadParcelData() first (or let it auto-load here).

@param {L.Map}  map
@param {number} lat
@param {number} lon
@param {number} bufferMiles

### `removeParcelLayer(map)`

Remove all parcel/zoning markers from the map.
@param {L.Map} map

### `getLoadedData()`

Return loaded data (or null if not yet loaded).
