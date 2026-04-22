# `js/preservation.js`

js/preservation.js
NHPD Preservation Dashboard — subsidy tracking for Colorado affordable housing.

Loads data/market/nhpd_co.geojson via DataService, caches it with CacheManager,
and renders KPI cards, an expiration-timeline chart, a filterable property table,
and a CSV export.

Exposes window.PreservationDashboard for testing.

## Symbols

### `CACHE_TTL_MS`

@const {number} CacheManager TTL — 6 hours in ms.

### `CACHE_NS`

@const {string} CacheManager namespace.

### `CACHE_KEY`

@const {string} CacheManager key for GeoJSON payload.

### `EXPIRY_HORIZON_YEARS`

@const {number} Years ahead to flag a subsidy as "expiring soon".

### `TABLE_COLS`

@const {string[]} Columns used by the sortable table.

### `normaliseFeature(feature)`

Extracts and normalises properties from a GeoJSON Feature or flat object.
Returns a flat record with standardised field names.
@param {Object} feature
@returns {Object}

### `toNum(v)`

Safely coerces a value to a non-negative finite number; returns 0 on failure.
@param {*} v
@returns {number}

### `parseExpiryYear(raw)`

Returns the expiry year as a number, or null if unparseable.
@param {string|number|null} raw
@returns {number|null}

### `parseExpiryMs(raw)`

Returns the expiry date as a ms timestamp, or null.
@param {string|number|null} raw
@returns {number|null}

### `computeKpis(rows)`

Computes summary KPIs from a row array.
@param {Array.<Object>} rows
@returns {{total: number, totalUnits: number, expiringCount: number, expiringUnits: number}}

### `buildChartData(rows)`

Builds expiration-year bucketed data for the timeline chart.
@param {Array.<Object>} rows  All rows (unfiltered).
@returns {{ labels: string[], unitCounts: number[], propertyCounts: number[] }}

### `renderChart(canvas, rows)`

Renders or updates the expiration timeline chart on the given canvas.
@param {HTMLCanvasElement} canvas
@param {Array.<Object>} rows

### `expiryClass(expiry)`

Returns a CSS class indicating expiry urgency.
@param {string|number|null} expiry
@returns {string}

### `expiryLabel(expiry)`

Returns a human-readable expiry label.
@param {string|number|null} expiry
@returns {string}

### `subsidyLabel(t)`

Returns a label for subsidy type that's safe for HTML.
@param {string} t
@returns {string}

### `renderTable(rows)`

Renders the property table body.
@param {Array.<Object>} rows

### `escHtml(s)`

Escapes a string for HTML attribute/text content.
@param {string} s
@returns {string}

### `subsidyTypeSlug(t)`

Converts a subsidy type string to a CSS-safe slug.
@param {string} t
@returns {string}

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

Populates the county and subsidy-type filter dropdowns from loaded data.

### `setupSorting()`

Wires sort-click and keydown listeners to sortable table headers.

### `exportCsv()`

Downloads the current filtered rows as a CSV file.

### `loadData()`

Loads NHPD GeoJSON from cache or DataService and bootstraps the UI.

### `onDataLoaded(geojson)`

Called once GeoJSON is available (from cache or network).
@param {Object} geojson

### `showError(msg)`

Displays an error message in the table body.
@param {string} msg

### `init()`

Bootstraps the dashboard when the DOM is ready.
