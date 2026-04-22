# `js/hna/hna-controller.js`

hna-controller.js
Responsibility: Init, state management, data fetching, event orchestration.
Dependencies: window.HNAUtils, window.HNARenderers
Exposes: window.HNAController, window.HNAState, window.__HNA_* globals

## Symbols

### `_announceGeoOptions(count, typeName)`

Update the #geoSelectHint element so screen readers know how many options
are available after the geography type changes (Recommendation 5.5).

### `fetchAcsExtended(geoType, geoid)`

fetchAcsExtended — supplemental ACS fetch for extended analysis variables.

The cached summary files (data/hna/summary/*.json) store only ~22 snapshot
fields (population, income, home value, rent, tenure, structure type counts).
The extended analysis charts — Income Distribution, Age of Housing Stock,
Bedroom Mix, Owner Cost Burden, Housing Gap, Special Needs — require ~36
additional DP03/DP04/DP05/DP02 variables that are NOT in the cache.

This function fetches those missing variables from the ACS 5-year profile API
and returns them as a flat object so they can be merged into the cached profile.
Uses ACS 5-year (acs5) for reliability across all Colorado geography sizes.

Called from update() when a cached profile exists but lacks DP03_0052E
(the income bracket field that gates all extended chart rendering).

### `scenarioState`

_renderScenarioSection — populate the three scenario-based projection charts
(population comparison, single-scenario detail, household projection, and
housing-demand-by-AMI-tier).  Called from applyAssumptions so all four
canvases update whenever the geography or assumptions change.

### `exportScenarioCSV()`

exportScenarioCSV — build a CSV of all scenario projection series and
trigger a browser download.  Falls back silently if no data is loaded.
