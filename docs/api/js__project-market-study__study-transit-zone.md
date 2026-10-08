# `js/project-market-study/study-transit-zone.js`

js/project-market-study/study-transit-zone.js — HB26-1065 transit-zone
screen for the for-sale market study (#1937 Phase 4).

The study is keyed by jurisdiction, not by a site, so it reports the area
figure from data/hna/transit-zone-by-geography.json (the same file the HNA
"Potential location" panel reads) and the designation note from
TransitZone.designation(). It never shows a credit amount: the Transit Zone
credit is a rental-housing credit, so for an ownership project it is only a
reason to consider a rental component (finish-line PC-2).

Missing data, an example (no jurisdiction) study, stale stop data or an
uncovered geography render "Unavailable" with the reason — never 0%.

## Symbols

### `summarize(geoid, data, mapStatus, now, tz)`

Returns { state, html }. Pure: no DOM, no fetch. The figures, rounding,
reasons and designation note come from TransitZone.areaSummary (`tz`),
the same summary the needs assessment and the recommendation read.
