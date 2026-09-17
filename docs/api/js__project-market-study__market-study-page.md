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

### `renderSalePrice(data)`

The ownership market, said plainly.

#1620 §6 criterion 3 wants both halves: a covered place shows its figure
WITH its date, and an uncovered place shows "no sale-price source for this
place" WITH the reasons. Before this the page showed neither, because
nothing on the site read the tracker at all.

The label never says "median sale price for X". Every row in that file is
allocated from ZIP-level sales — Fruita's is spread across seven ZIPs,
three of them Grand Junction — so the ZIP count is part of the figure, not
a footnote under it.

### `optionalJson(url)`

A dataset that is simply absent for this geography is not an error — most
of Colorado's 546 geographies are missing something. Resolve to null and
let StudyGeography name what is missing.
