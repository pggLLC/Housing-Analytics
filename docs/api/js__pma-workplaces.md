# `js/pma-workplaces.js`

js/pma-workplaces.js
"Where residents work" for the market area: the towns that employ the most of
the market area's working residents, from LEHD LODES 2023 primary jobs.

Reads data/market/tract-workplaces.json (scripts/market/build_tract_workplaces.py).
Each tract counts by the share of it inside the market area, the same share the
page uses for households. Display and export only: it adds no demand and changes
no score. NCHMA's market-study standard asks for commuting destinations
(Model Content Standards v3.1, III.F.8); CHFA counts outside demand only when
comparable projects document it.

## Symbols

### `summarize(data, tracts)`

tracts: [{ geoid, share }] (share 0–1, missing = 1).
Returns null when the file or every tract is missing, else
{ workers, otherStates, noTown, top: [{ geoid, name, workers, share }], year, tractsMissing }.

### `sentence(s)`

The one line printed on the page and in the export.
