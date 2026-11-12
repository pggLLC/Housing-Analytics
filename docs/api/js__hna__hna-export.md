# `js/hna/hna-export.js`

## Symbols

### `_triggerDownload(blob, filename)`

Trigger a file download for a Blob in browsers that support it.

### `_pageMatchesSelection()`

True when the page shows one finished load for the selected place.

### `_exportStillCurrent()`

Called at every file sink: false means the page moved on, so do not save.

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

### `_viewTitle(base)`

'Housing Needs Assessment' -> 'Housing Needs Assessment — Who lives here'

### `_pageFieldReason(id)`

Why a page figure is blank in a download (evening practitioner QA,
 3 Nov 2026: the CSV left baseline units and target vacancy empty on
 views that do not carry the projection chapter).

### `_placeFilename(reportData, ext)`

housing-needs-assessment[-view]-<place>-<geoid>.<ext>: every download
 names the place it is for (evening practitioner QA, 3 Nov 2026).

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

### `CENSUS_GAP_NOTE`

AMI-gap rows: numbers kept as numbers, a real 0 kept as 0.

 HUD's count comes first: homes short for renters, from CHAS "affordable
 and available", quoted from the page's own cards. It is the figure the
 HNA tells a reader to cite. The Census rows follow, labelled for what
 they are: renter households minus rentals priced for them, which counts
 every cheap rental as available. A bare "80% AMI gap: 37" would be read
 as 37 homes short.

### `_hudShortFromPage()`

HUD's count as the page's cards show it (renderChasAvailableShortfall);
 a hidden card or a dash is null, never 0.

### `_lihtcRows(d)`

LIHTC / QCT / DDA rows, as the page's cards show them, with the reason
 the page gives when one is unavailable.

### `_rankingEntry(geoid)`

Pull a ranking-index entry for the currently-selected geography by
matching geoid against window.HNARanking._get().allEntries. Returns
null if the ranking module isn't loaded yet — HNA single-jurisdiction
page doesn't load it; Compare does.

### `_acsPeriodLabel(series, year)`

The ACS period of the profile on the page for `geoid`, read from the
profile itself (_acsSeries / _acsYear, set by the controller from the
summary file). A combined area says its members' periods.

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

### `exportJson(reportData, filename)`

Exports the full structured report snapshot as a JSON file.

@param {object} [reportData] - Pre-built report object (from buildReportData).
  If omitted the function calls buildReportData() automatically.
@param {string} [filename]   - Output filename (default: housing-needs-assessment.json)
