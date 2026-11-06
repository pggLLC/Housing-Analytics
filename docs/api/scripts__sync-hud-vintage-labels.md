# `scripts/sync-hud-vintage-labels.mjs`

Keep every hard-coded HUD, ACS and LODES vintage label on the site equal to
the vintage of the data it describes.

The FMR and QCT/DDA fetchers now take the year in effect (FY2027 Fair
Market Rents from 2026-10-01; each year's QCT/DDA designations from
Jan 1), but ~20 labels name the year in page and script source. A data
refresh that left them alone would publish FY2027 rents captioned FY2026.
The fetch workflows run this after fetching and commit what it changes;
test/hud-vintage-labels-sync.test.mjs runs --check so a label edited by
hand cannot drift from the data either.

  node scripts/sync-hud-vintage-labels.mjs           # rewrite labels
  node scripts/sync-hud-vintage-labels.mjs --check   # exit 1 on any mismatch

Each rule names one label pattern with the year as its only capture group,
or, with `span: true`, an ACS 5-year range ("ACS 2020–2024") whose second
group is the data year and whose first is four years earlier.

ACS and LODES change only when a builder's year changes in code
(ACS_START_YEAR in scripts/hna/build_hna_data.py, ACS_YEAR in
scripts/market/build_public_market_data.py, LODES_YEAR in
build-hna-data.yml), so the test fails that PR until the labels follow.
js/data-source-inventory.js is covered too: its mtimes are generated, but
its descriptions and URLs are not. Docs and the working paper are not.

## Symbols

### `readVintages(root = ROOT)`

The vintage each label must name, read from the data it describes.

### `plan(vintages, read = (rel)`

Every label that disagrees with its vintage, and each file's corrected text.
Returns { matches, mismatches: [{file, rule, found, want}], rewrites: Map }.
