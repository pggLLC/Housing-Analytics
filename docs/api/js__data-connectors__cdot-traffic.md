# `js/data-connectors/cdot-traffic.js`

NO DATA SOURCE — this connector is dormant.

It previously read a synthetic fixture that was never a real Colorado Department of Transportation
extract. That fixture carried part of the PMA workforce composite until
#1562 excluded it, and was deleted on 2026-09-09.

loadMetrics() resolves to the empty shape WITHOUT a network request. Do not
restore a fetch until a real source exists — requesting a file that cannot
exist produces console errors that fail the rendered site-audit gate.

Real source when someone wires it up: CDOT Traffic Data.

## Symbols

### `scoreTrafficConnectivity(agg)`

Score traffic connectivity 0–100 for PMA workforce dimension.
Higher AADT = better regional connectivity = more workforce access.
Scale: 0→0, 10k→40, 30k→70, 60k→85, 100k→95, 150k+→100
