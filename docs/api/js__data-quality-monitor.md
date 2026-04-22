# `js/data-quality-monitor.js`

js/data-quality-monitor.js
Real-Time Data Quality Monitor — Phase 3 (Epic #447)

Provides live health indicators for all critical data sources.
Complements data-quality-check.js (batch validation) with:
  - Continuous interval-based polling
  - Per-dataset health state machine (healthy / degraded / stale / error)
  - UI health-bar and status-dot rendering
  - CustomEvent bus for dashboard integration
  - Metric history for sparkline rendering

Public API (window.DataQualityMonitor):
  DataQualityMonitor.start([intervalMs])  — begin polling (default: 5 min)
  DataQualityMonitor.stop()               — stop polling
  DataQualityMonitor.getStatus()          — current health snapshot
  DataQualityMonitor.getHistory(key)      — metric history array for sparkline
  DataQualityMonitor.renderDashboard(el)  — render health panel into element

Events emitted on document:
  'dqm:update'   — { detail: { snapshot, allHealthy } }  — on each poll cycle
  'dqm:degraded' — { detail: { key, state, message } }   — on status change to degraded/stale/error

Exposed as window.DataQualityMonitor (browser) and module.exports (Node/test).

## Symbols

### `AGE_FRESH`

Age thresholds in milliseconds.

### `MONITORED_DATASETS`

Critical data sources monitored on every poll cycle.

### `renderDashboard(el)`

Render a health dashboard panel into the given DOM element.
@param {HTMLElement} el

### `start(intervalMs)`

Start the monitor polling loop.
@param {number} [intervalMs=300000] — polling interval in milliseconds

### `stop()`

Stop the monitor polling loop.

### `getStatus()`

Return a copy of the current health snapshot.
@returns {Object} key → { state, message, count, ts }

### `getHistory(key)`

Return metric history array for sparkline rendering.
@param {string} key — dataset key
@returns {Array<{ts: number, state: string, count: number}>}
