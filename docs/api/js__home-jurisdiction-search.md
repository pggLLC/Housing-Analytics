# `js/home-jurisdiction-search.js`

js/home-jurisdiction-search.js — B-06 / #1097

Inline jurisdiction/place autocomplete for the homepage hero. Lets a
visitor search all 546 registry geographies (64 counties, 272 places,
210 CDPs) from the first screen and jump straight to the matched
profile, instead of navigating to select-jurisdiction.html first.

Routing: every match goes to the interactive profile
(housing-needs-assessment.html?geoid=…&geoType=…&auto=1 — the same
destination the select-jurisdiction flow ends at, and the ic-summary
deep-link convention). Static places/<geoid>.html pages are still the
browse-profile surface for the 482 place/CDP entries; uniform HNA routing
keeps the search action consistent with the full select-jurisdiction flow.

The registry (~130 KB) is fetched lazily on first focus so the
homepage's initial load is unaffected.

Matching + routing are pure functions with a dual-context export so
test/home-jurisdiction-search.test.js exercises the real code in Node
(no reimplemented copies — see #1152/#1120 for why that matters).

## Symbols

### `searchJurisdictions(entries, query, limit)`

Rank-and-filter registry entries for a query.
Prefix matches rank before mid-word matches; ties break by name
length (shorter = more exact) then alphabetically. Case-insensitive.

@param {Array<{geoid:string,name:string,type:string}>} entries
@param {string} query
@param {number} [limit]
@returns {Array} matched entries, best first

### `jurisdictionUrl(entry)`

Profile URL for a registry entry (relative to site root).
@param {{geoid:string,type:string}} entry
@returns {string|null}
