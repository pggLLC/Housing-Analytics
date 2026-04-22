# `js/census-geo.js`

Census snapshot (ACS Profile) with geography dropdowns for:
 - National (United States aggregate)
 - States (uses cached data/census-acs-state.json first, no API key required)
 - Counties (within a state)
 - Places (within a state)

Also renders a Housing Construction Activity sub-section from fred-data.json.

Uses window.APP_CONFIG.CENSUS_API_KEY (js/config.js) for county/place/national.
State-level data is served from data/census-acs-state.json (pre-fetched cache).

_No documented symbols — module has a file-header comment only._
