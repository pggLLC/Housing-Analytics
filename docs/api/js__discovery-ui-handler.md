# `js/discovery-ui-handler.js`

## Symbols

### `renderMonitorBadge(report, pendingCount, state)`

Render the monitoring status badge in #drhMonitorBadge.
@param {object|null} report — result from DataSourceDiscovery.getLastReport()
@param {number}       pendingCount
@param {string}       [state]  'scanning' shows a spinner-style hint
                               while a fresh scan is in flight; default
                               renders the cached/most-recent report.

### `renderPendingTab(report)`

Render the "Pending Discovery" tab content from a discovery report.
@param {object} report

### `wireAdminPanel()`

Wire the manual scan trigger button.
