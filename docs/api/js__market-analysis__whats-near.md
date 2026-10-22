# `js/market-analysis/whats-near.js`

whats-near.js — the "What's near this site" block on Market Analysis.

Detail only: nothing here feeds the site score (site-selection-score.js
reads the nearest-distance inputs the controller builds, not this block).

Two tables, both plain <table>s with one header row so the shared sorter
and header tips pick them up (column help is each <th>'s data-tip):
  - Jobs in the site's census tract and within 5 and 10 miles, from LEHD
    LODES 2023 workplace counts by census tract. A tract's jobs count when
    the tract's centre point (TIGER 2020 internal point) is inside the
    distance; the site's own tract always counts, however large it is.
  - Places near the site: nearest one by name and straight-line distance,
    and how many are within 1 and 3 miles, from the OsmAmenities records
    (OpenStreetMap, statewide transit stops, CDPHE hospitals, CDHS child
    care, HRSA community health centers).
Plus the USDA Food Access Research Atlas flag for the site's tract.

API: window.WhatsNear.render(hostId, { lat, lon, tractGeoid })
The place rows draw at once; jobs and the food-access line fill in when
their files arrive. A later render() for another site wins: a slow load
for the previous site never overwrites it.

## Symbols

### `load(path)`

One fetch per file per page; a failed load is not cached.

### `tractAt(lat, lon, geometry)`

GEOID of the 2020 tract containing the point, or '' (TIGER display geometry).

### `setPlacesUnavailable(reason)`

Mark nearby places unavailable and redraw the current site's block.
