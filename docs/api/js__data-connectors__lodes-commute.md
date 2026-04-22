# `js/data-connectors/lodes-commute.js`

js/data-connectors/lodes-commute.js
LODES/LEHD job-housing balance accessor for PMA workforce scoring.

Data source: data/market/lodes_co.json
Real data: https://lehd.ces.census.gov/data/

Exposed as window.LodesCommute.

## Symbols

### `scoreJobAccessibility(agg)`

Compute a 0–100 job-accessibility score.
A ratio near 1.0 indicates balanced job-housing; higher = job centre;
lower = bedroom community.  Both extremes can support affordable housing —
use a bell curve centred at 0.8 (slight jobs surplus).
