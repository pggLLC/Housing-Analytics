# `js/data-connectors/cdot-traffic.js`

js/data-connectors/cdot-traffic.js
Colorado Department of Transportation traffic count accessor.

Data source: data/market/cdot_traffic_co.json
Real data: https://www.codot.gov/programs/statewideplanning/traffic-data

Exposed as window.CdotTraffic.

## Symbols

### `scoreTrafficConnectivity(agg)`

Score traffic connectivity 0–100 for PMA workforce dimension.
Higher AADT = better regional connectivity = more workforce access.
Scale: 0→0, 10k→40, 30k→70, 60k→85, 100k→95, 150k+→100
