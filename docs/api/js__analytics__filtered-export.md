# `js/analytics/filtered-export.js`

js/analytics/filtered-export.js
Query-based filtered data export dialog.

Responsibilities:
 - FilteredExportDialog class
 - Query-based export functionality
 - CSV and JSON export options
 - Metadata inclusion (filters, source data info)

Exposed on window.FilteredExportDialog.

## Symbols

### `FilteredExportDialog(options)`

@class FilteredExportDialog
@param {object} [options]
@param {string} [options.title]          - Dialog title.
@param {boolean} [options.includeMetadata] - Whether to include filter/source metadata.
