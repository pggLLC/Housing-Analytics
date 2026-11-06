# `js/commuting.js`

js/commuting.js
The public "Commuting and Jobs" page (commuting.html).

Reads data/market/commute-strength.json (scripts/market/build_commute_strength.py,
LEHD LODES 2023) and data/market/principal-employers.json (curated from audit filings).
Towns are dots sized by jobs and shaded by the share of their jobs held by people who
live 20 to 60 straight-line miles away. Tapping a town shows its numbers and draws lines
from the towns that send it the most workers.

## Symbols

### `answer(p)`

One plain sentence for a town: the first useful answer.

### `throughItem(p)`

The drive-through line: people who live farther out and pass the town on the way to work.
