# `scripts/hud/designation-year.js`

## Symbols

### `sameSet(a, b)`

Which designation year a fetched HUD QCT or DDA layer actually holds.

HUD names its ArcGIS layers by year (Difficult_Development_Areas_2026), but
on 2026-10-23 it loaded the 2027 designations into the layers named 2026:
the Colorado nonmetro DDA counties in Difficult_Development_Areas_2026 have
since matched HUD's 2027 list (DDA2027NM.PDF: Archuleta and Chaffee in, San
Miguel out), not its 2026 list. A layer name is therefore not evidence of the
year. Designations change once a year, so the content is:

  - the same as the cached file  -> the cached year, whatever the layer says;
  - different, from a layer named later than the cache -> the layer's year;
  - different, from a layer named the same year as the cache (or earlier)
    -> the year after the cached one: HUD has loaded next year's list early;
  - no readable cached file or year -> nothing is written.

Next year's list applies only to allocations, bond issuance and placement in
service after December 31 (91 FR 63573, 2026-10-06, section VII.A), so it is
not written before January; the January run of cache-hud-gis-data.yml then
writes it with its real year.

resolveDesignationYear({ layerYear, thisYear, cachedYear, cachedKeys, fetchedKeys })
  -> { year, write, reason }

### `cachedDesignationYear(doc)`

Year recorded on a cached file; older files name it only in `source`.

### `featureKey(feature)`

Stable identity of a QCT (tract GEOID) or DDA (county code or ZIP) feature.
