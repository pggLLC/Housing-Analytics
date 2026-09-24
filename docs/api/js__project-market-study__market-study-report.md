# `js/project-market-study/market-study-report.js`

Honest, self-contained screening-report assembly from a Phase-8 model.

## Symbols

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
