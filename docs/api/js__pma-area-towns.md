# `js/pma-area-towns.js`

js/pma-area-towns.js
Towns inside a tract-drawn market area, and who works there.

1. Other towns: a market area is built from whole Census tracts, as CHFA's
   Market Study Guide requires, so it can take in a second town. Each
   Census place's 2020 homes per tract (PL 94-171) name the main town (the
   place with the most homes in the area) and flag any tract where another
   town holds at least OTHER_TOWN_MIN_SHARE of the tract's homes (and at
   least OTHER_TOWN_MIN_HOMES homes) and more of them than the main town. The page does not drop a flagged tract: the analyst
   keeps it or drops it with the tract picker.
2. Who works here: LEHD LODES 2024 tract-to-tract jobs (all jobs, JT00).
   Jobs in the area's tracts are split into those held by people who live
   in the area and those held by in-commuters, by origin town. Jobs in a
   flagged tract are counted apart, so another town's jobs are not added
   to the main town's. A dropped tract's working residents show up as
   in-commuters from it.

Display only: nothing here is added to the CHFA count, capture or
penetration. CHFA counts demand from outside the market area only with
documented tenant-origin data.

## Symbols

### `townsInArea(placeDoc, tracts)`

tracts: [{ geoid, share }]. Returns null when the place file is missing, else
{ main: { place, name, homes } | null, others: [{ place, name, homes, tracts: [{ geoid, homes, tractHomes, share }] }],
  flagged: { geoid: [place ids] } }.

### `inflow(od, placeDoc, tracts, towns, counties)`

Jobs in the market area and where their workers live.
od: lodes_tract_od_co.json; tracts: [{ geoid, share }]; towns: townsInArea();
counties: { fips: label }. Work-side counts are weighted by each tract's
share in the area; a worker lives in the area when the home tract is in it.
