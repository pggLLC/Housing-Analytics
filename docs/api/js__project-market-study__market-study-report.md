# `js/project-market-study/market-study-report.js`

Honest, self-contained screening-report assembly from a Phase-8 model.

## Symbols

### `PLAIN_LABELS`

Plain-language labels, shared with market-study-page.js so the page and
the downloaded report can never describe the same field two ways. These
only relabel engine field ids; every value shown beside them is still the
engine's own.

### `formatHouseholds(value)`

A count of households is a whole number of households. The engines keep
full precision (CHAS rows are split across AMI bands, so the pool is
routinely fractional) and every figure is still computed from it. Show
positive counts below one as <1 so they cannot be mistaken for zero;
larger counts use the existing whole-household rounding convention.

### `exampleInputsLabel(placeName)`

Sections that run on fixed example inputs — the land, resale and
settlement engines take a set home value, restricted price, four-person
AMI and loan terms from market-study-page.js, identical for every
jurisdiction. Before this they rendered under a banner saying the figures
were the selected jurisdiction's, so Denver and Fruita showed the same
dollars as if each were local. The label names the place the figures are
NOT from; the page and the report share this one wording.

### `SALE_PRICE_HEADING`

The "Local sale prices" section, as words. The page and the downloaded
report both render from this one object, so the figure, its label, its
period and its caveat cannot differ between the two (PC-1: same figure,
same source and year, everywhere). Before this the report had no such
section at all: the screen showed a sale price and the file a reader
kept did not.

`evidence` is SalePriceEvidence.forPlace() output, or null when there is
no jurisdiction (then there is no section, on screen or in the report).

### `AUTHORITY_NAME`

Housing authorities the report names, read from the rendered content so
the check below is about what a reader actually sees. A name is a run of
capitalised words ending in "Housing Authority"; the caveat lines
themselves are removed first, so a caveat cannot count as its own
reason to exist.

### `requiredCaveatsFor(html)`

Every caveat this content must carry: the fixed list, plus one per named authority.

### `verdictSection(model)`

Every report before this led with nine sections of tables and ended
on a screening-draft banner — a reader could fill in all 11 demand-
funnel stages correctly and still be handed no sentence saying what
the numbers add up to. This puts an answer, or an honest account of
why there isn't one yet, at the top — same "the answer, first"
pattern already used in js/hna/hna-renderers.js's ownership-need
panel. Plain prose only: no badge() calls here, since the exported
document's data-provenance-label counts are pinned exactly by
BADGE_COUNTS in test/market-study-report.test.js and every value
used below is already classified by the sections that compute it.
