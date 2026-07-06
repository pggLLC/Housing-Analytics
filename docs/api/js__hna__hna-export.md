# `js/hna/hna-export.js`

## Symbols

### `_triggerDownload(blob, filename)`

Trigger a file download for a Blob in browsers that support it.

### `_showExportToast(message, type)`

Show a brief toast and announce to the #hnaLiveRegion (Recommendation 5.1).
Auto-dismisses after 4 seconds.

@param {string} message - Human-readable confirmation, e.g. "PDF downloaded ✓"
@param {'success'|'info'|'warn'} [type='success'] - Toast colour variant

### `_elText(id)`

Safely read visible text from a DOM element, returning '' on miss.

### `_csvField(v)`

Escape a CSV field: wrap in quotes and double any internal quotes.

### `_toCsv(rows)`

Convert an array-of-arrays to a CSV string.

### `_rankingEntry(geoid)`

Pull a ranking-index entry for the currently-selected geography by
matching geoid against window.HNARanking._get().allEntries. Returns
null if the ranking module isn't loaded yet — HNA single-jurisdiction
page doesn't load it; Compare does.

### `_metricsFromHnaState(geoid)`

Fallback metrics builder for the HNA single-jurisdiction page where
HNARanking isn't loaded. Reads from window.HNAState (the loaded
profile + chasData) and computes the same analytics-grade fields
the ranking-index would expose.

### `buildReportData()`

Collects the currently rendered housing-needs assessment values from
the DOM AND from the loaded ranking-index entry for the selected
geography. The DOM values give exact visual fidelity (formatted
strings); the ranking-index values give analytics-grade numerics
with explicit data-provenance flags.

@returns {object} reportData

### `exportPdf(filename)`

Exports the current HNA report view as a multi-page PDF.
Falls back to window.print() if the required libraries are unavailable.

@param {string} [filename] - Output filename (default: housing-needs-assessment.pdf)
@returns {Promise<void>}

### `exportCsv(reportData, filename)`

Exports key housing metrics for the current geography as a CSV file.

@param {object} [reportData] - Pre-built report object (from buildReportData).
  If omitted the function calls buildReportData() automatically.
@param {string} [filename]   - Output filename (default: housing-needs-assessment.csv)

### `exportJson(reportData, filename)`

Exports the full structured report snapshot as a JSON file.

@param {object} [reportData] - Pre-built report object (from buildReportData).
  If omitted the function calls buildReportData() automatically.
@param {string} [filename]   - Output filename (default: housing-needs-assessment.json)
