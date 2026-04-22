# `js/components/export-panel.js`

export-panel.js — COHO Analytics
Reusable per-stage export panel component.

Injects a panel of export buttons appropriate for the given workflow stage
and wires each button to the matching export function.

Usage:
  ExportPanel.render('myContainerId', 'hsa', { projectName: 'Boulder Analysis', countyName: 'Boulder' });
  ExportPanel.exportCsv(data, 'my-data.csv');

Requires: workflow-state.js (optional, used by exportFull)

## Symbols

### `_toCsv(data)`

Convert a plain object or array of objects to a CSV string.
Plain object  → two-column rows: key, value
Array         → header row derived from first object keys, then data rows

@param {Object|Array} data
@returns {string}
