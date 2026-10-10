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

### `_viewInfo()`

The generated assessment views each hold a slice of the report and publish
window.HNA_VIEW (scripts/hna/build_hna_views.py). Without this every one of
them exported `housing-needs-assessment.pdf` with a cover reading
"Housing Needs Assessment" — five downloads with the same name, and
nothing inside to say which fifth of the report you were holding. The
canonical page publishes no view and keeps the original names verbatim.

### `_viewFilename(base)`

'housing-needs-assessment.csv' -> 'housing-needs-assessment-who-lives-here.csv'

### `_viewTitle(base)`

'Housing Needs Assessment' -> 'Housing Needs Assessment — Who lives here'

### `_csvField(v)`

Escape a CSV field: wrap in quotes and double any internal quotes.

### `_toCsv(rows)`

Convert an array-of-arrays to a CSV string.

### `_numOrNull(v)`

A number, or null when the value is absent. A real 0 stays 0.

### `_isBlankText(v)`

Page text that means "nothing shown" rather than a value.

### `_cleanHeadingText(el)`

Strip methodology popovers, tooltips and info glyphs from a heading, as
 the section rail does (js/hna/section-rail.js cleanLabel).

### `_cardLabel(id, fallback)`

The label on the page's own stat card, so an export row is named what
 the reader saw. Falls back to the card label in housing-needs-assessment.html.

### `_cardSub(id)`

The sub-note under a stat card (e.g. "in Fruita · 7 in Mesa County").

### `_overlayReason(toggleId)`

The reason a map overlay did not load, as the page states it on the
 overlay toggle (hna-renderers.js _markOverlayToggle).

### `_lehdWacYear(geoid, containingCounty)`

The LEHD LODES workplace-area (WAC) year of the data the page loaded.
County files carry `wacYear`; the place blobs apportioned from them carry
the same annualEmployment years, so the latest of those is the WAC year.
Read from the data, never a literal: the literal said 2021 while the data
and the page said 2023.

### `_snapshotRows(d)`

Executive-snapshot rows, labelled as the page's stat cards are.

### `_amiGapRows(d)`

AMI-gap rows: numbers kept as numbers, a real 0 kept as 0.

### `_lihtcRows(d)`

LIHTC / QCT / DDA rows, as the page's cards show them, with the reason
 the page gives when one is unavailable.

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
