# `js/co-lihtc-map.js`

co-lihtc-map.js — Colorado Deep Dive Leaflet map (standalone, no bundler required)
Depends on: js/vendor/leaflet.js loaded before this script.
Exports: window.ColoradoDeepDiveMap — the Leaflet map instance (set after initialization).
         window.coLihtcMap — legacy alias kept for backward compatibility.

## Symbols

### `formatShortDate(isoString)`

Format an ISO-8601 UTC string into a short human-readable date (e.g. "2025-10-14").
Returns an empty string if the input is missing or unparseable.
@param {string} isoString
@returns {string}

### `updateSourceDate(lihtcDate, overlayDate)`

Update the #map-source-date element (if present) with a combined source/date note
for the LIHTC, QCT, and DDA layers.  Each argument is a human-readable fragment
such as "LIHTC: 2025-10-14" or an empty string if the date is unknown.

@param {string} lihtcDate   Date string for LIHTC data, or ''
@param {string} overlayDate Date string for QCT/DDA overlay data, or ''

### `getCountyBoundaryStyle()`

Returns Leaflet path style options using CSS custom properties when available.

### `updateCountyBoundaryTheme()`

Re-applies theme-correct styles to the county boundary layer without re-fetching data.
