# `js/agency-funding-model.js`

agency-funding-model.js — the numbers behind the agency funding view (js/agency-funding.js).

Pure functions, no DOM: the page and test/agency-funding.test.mjs both call
them. Every award comes from a file that quotes its source:
  - CHFA tax credits and OEDIT Prop 123 awards: data/policy/funding-awards/
    ledger.json (scripts/funding/build_funding_awards.py, each award PDF
    checked against the total it prints), with the cleaned names and the row
    as printed from award-rows.json when that file has the row.
  - DOLA Division of Housing awards: data/policy/funding-awards/
    dola-awards.json, read by hand from DOLA's announcements, each with the
    sentence it rests on.

The three agencies award different things, so they are never added together
as money: CHFA awards tax credits (stated per year), OEDIT and DOLA award
grants and loans (dollars). The one measure all three report is homes, so
"All agencies" is measured in homes.

## Symbols

### `normalise(opts)`

One record per award, whichever agency made it.
opts: { ledger, documents, rows, dola, aliases, counties }
  counties: { '08001': { name: 'Adams', population: 530225 }, ... }
