# `js/preservation.js`

js/preservation.js
Preservation inventory — Colorado affordable rental properties on the
Colorado Housing and Finance Authority (CHFA) preservation map.

Loads data/affordable-housing/preservation/chfa-preservation.json via
DataService, caches it with CacheManager, assigns each property a county
from its mapped location (js/county-from-coords.js), and renders KPI cards,
a units-by-county chart, a filterable property table and a CSV export.

The CHFA layer carries property identity only (name, address, city, ZIP,
total units, location). It has no subsidy type or expiration date, so this
dashboard shows neither and never infers risk from the listing.

Exposes window.PreservationDashboard for testing.

## Symbols

### `CACHE_TTL_MS`

@const {number} CacheManager TTL — 6 hours in ms.

### `CACHE_NS`

@const {string} CacheManager namespace.

### `CACHE_KEY`

@const {string} CacheManager key for GeoJSON payload.

### `DATA_PATH`

@const {string} Data path relative to data/.

### `CHART_TOP_N`

@const {number} Counties shown in the chart.

### `SOURCE_LABEL`

@const {string} Source label carried on every exported row.

### `LIMITATION`

@const {string} Limitation carried on every exported row.

### `SIZE_BANDS`

@const {Object} Unit-size bands for the size filter.

### `toCount(v)`

Safely coerces a value to a positive finite number; returns null when the
source gives no usable count (a missing count is unknown, not zero).
@param {*} v
@returns {number|null}

### `cityCase(s)`

Title-cases a city string ("COLORADO SPRINGS" → "Colorado Springs").
@param {string} s
@returns {string}

### `normaliseFeature(feature)`

Extracts and normalises one CHFA preservation feature (or a flat object).
@param {Object} feature
@returns {Object|null}

### `assignCounties(rows, lookup)`

Assigns a county name to each row from its mapped point, when the
county lookup is available. Rows outside every boundary keep ''.
@param {Array.<Object>} rows
@param {Function} lookup  (lat, lon) → {name} | null

### `computeKpis(rows)`

Computes summary KPIs from a row array.
@param {Array.<Object>} rows
@returns {{total: number, totalUnits: number, counties: number, unknownUnits: number}}

### `buildChartData(rows, topN)`

Sums listed units and properties by county, largest first.
@param {Array.<Object>} rows
@param {number} [topN]
@returns {{ labels: string[], unitCounts: number[], propertyCounts: number[] }}

### `renderChart(canvas, rows)`

Renders the units-by-county chart on the given canvas.
@param {HTMLCanvasElement} canvas
@param {Array.<Object>} rows

### `escHtml(s)`

Escapes a string for HTML attribute/text content.
@param {string} s
@returns {string}

### `renderTable(rows)`

Renders the property table body.
@param {Array.<Object>} rows

### `inSizeBand(r, band)`

True when a row falls in the named unit-size band.
@param {Object} r
@param {string} band
@returns {boolean}

### `getFilteredSorted()`

Returns the currently filtered and sorted rows.
@returns {Array.<Object>}

### `getVal(id)`

Reads the value of a form element by id.
@param {string} id
@returns {string}

### `setText(id, v)`

Sets the text content of an element by id.
@param {string} id
@param {string|number} v

### `refresh()`

Re-renders KPIs and table from current filter state.
Also announces update to screen readers.

### `populateFilters()`

Populates the county filter dropdown from loaded data.

### `setupSorting()`

Wires sort-click and keydown listeners to sortable table headers.

### `exportCsv()`

Downloads the current filtered rows as a CSV file.

### `loadData()`

Loads the CHFA preservation GeoJSON from cache or DataService.

### `countyLookup()`

Resolves once county boundaries are ready (or immediately when the
helper is absent), then returns a lookup function or null.
@returns {Promise<Function|null>}

### `onDataLoaded(geojson)`

Called once GeoJSON is available (from cache or network).
@param {Object} geojson
@returns {Promise|undefined}

### `showError(msg)`

Displays an error message in place of the inventory.
@param {string} msg

### `init()`

Bootstraps the dashboard when the DOM is ready.
