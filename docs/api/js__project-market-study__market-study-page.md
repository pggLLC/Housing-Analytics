# `js/project-market-study/market-study-page.js`

Display-only controller for the for-sale market-study comparison workflow.

## Symbols

### `renderGeographyBanner(data)`

Say whose study this is, above everything else.

The page used to answer this nowhere. One town's AMI and home values were
loaded for every reader, and the only clue was the example project's name
six lines into section 1 — which a reader has no reason to read as a
statement about the DATA.

### `downloadName(data)`

A file on someone's disk outlives the tab it came from. Naming every
download after the example town guaranteed that a screening draft for
another jurisdiction would be filed, and later read, as that town's.

### `optionalJson(url)`

A dataset that is simply absent for this geography is not an error — most
of Colorado's 546 geographies are missing something. Resolve to null and
let StudyGeography name what is missing.
