# `js/data-quality-check.js`

js/data-quality-check.js
Client-side data validation and freshness reporting.

Validates critical datasets on page load, reports results to the console,
and updates any `.data-reliability-badge` elements found on the page.

Public API (window.DataQuality):
  DataQuality.runAll()          — validate all datasets; returns Promise<Report[]>
  DataQuality.validate(cfg)     — validate a single dataset config; returns Promise<Report>
  DataQuality.renderBadge(el, report) — update a badge element with freshness info

Each Report: { key, label, ok, warning, message, featureCount, cacheAge }

Emits CustomEvent 'dq:complete' on document with detail { reports, allOk }.
Emits CustomEvent 'dq:stale'    on document when any dataset is stale/invalid.

## Symbols

### `DEFAULT_DATASETS`

Datasets validated by default on every page.

### `AGE_FRESH`

Relative age thresholds for freshness badges (ms).

### `runAll()`

Run default validations and render any `.data-reliability-badge` elements.
@returns {Promise<Report[]>}

### `validate(cfg)`

Validate a single dataset configuration object.
@param {{ key:string, label:string, path:string, minFeatures?:number,
           validate?:function, critical?:boolean }} cfg
@returns {Promise<Report>}

### `renderBadge(el, reportOrReports)`

Update a single badge element to reflect a report.
@param {Element} el
@param {Report}  report  (or array of reports — use aggregate)
