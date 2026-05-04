# `js/data-quality-check.js`

js/data-quality-check.js
Client-side data validation and freshness reporting.

Validates critical datasets on page load, reports results to the console,
and updates any `.data-reliability-badge` elements found on the page.

Public API (window.DataQuality):
  DataQuality.runAll()          — validate all datasets; returns Promise<Report[]>
  DataQuality.validate(cfg)     — validate a single dataset config; returns Promise<Report>
  DataQuality.renderBadge(el, report) — update a badge element with freshness info

Each Report: { key, label, ok, warning, message, featureCount, cacheAge, dataAsOf, dataAgeMs }

Emits CustomEvent 'dq:complete' on document with detail { reports, allOk }.
Emits CustomEvent 'dq:stale'    on document when any dataset is stale/invalid.

## Symbols

### `DAY`

Datasets validated by default on every page.

Each dataset config now carries Data Freshness v2 metadata so the
dashboard's per-dataset health card can answer:
  - What's the upstream source? (sourceUrl)
  - How is the file kept current? (ingestWorkflow)
  - What does the data cover? (coverageLabel)
  - When does it become stale? (staleThresholdMs)
  - When does it become aging? (agingThresholdMs)

Stale thresholds are tuned per-dataset because cadences differ:
  - FRED data updates ~weekly (stale after 7 days)
  - CHAS data updates annually (stale after ~14 months)
  - LODES data updates annually (stale after ~14 months)
  - HUD LIHTC DB updates annually (stale after ~14 months)

### `AGE_FRESH`

Cache-age thresholds for the in-browser "last fetched" badge (ms).

### `freshnessState(dataAgeMs, cfg)`

Compute the freshness state for a dataset given the data's age and
the per-dataset thresholds. Returns one of:
  'fresh'    — within the aging threshold (or thresholds not configured)
  'aging'    — past aging threshold, before stale threshold
  'stale'    — past stale threshold
  'unknown'  — dataAgeMs is null (no timestamp in the file)

Pure function, exported for testing.

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
