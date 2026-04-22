# `js/data-freshness-monitor.js`

## Symbols

### `runFreshnessCheck()`

Fetch all sources from DataSourceInventory + DATA-MANIFEST.json,
compute freshness for each, and return a structured report.
@returns {Promise<FreshnessReport>}

### `generateMarkdownReport(report)`

Generate a Markdown-formatted monthly freshness report.
@param {FreshnessReport} report
@returns {string}

### `downloadMarkdownReport(report)`

Trigger a browser download of the freshness report as Markdown.
@param {FreshnessReport} report
