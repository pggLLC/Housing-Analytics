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

### `buildReportData()`

Collects the currently rendered housing-needs assessment values from
the DOM and returns a plain object suitable for CSV or JSON export.

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
