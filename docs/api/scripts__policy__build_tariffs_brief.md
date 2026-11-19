# `scripts/policy/build_tariffs_brief.mjs`

## Symbols

### `change`

Percent change between two index values, to one decimal.

### `priceChanges(data)`

Every price series with its one-year change and its change since the baseline month.

### `jobsResult(data, id)`

A jobs series as a sentence: level now, and the change since the baseline month.

### `illustration(data)`

Dollars added per $100 of construction contract per square foot, to the nearest 10 cents.

### `costNote(rows, data, brief)`

The brief's conclusions for the construction cost pages: the three largest one-year
rises among the materials tracked (with fuel, which rose more, named beside them), what held flat, the hand-written caution, what production did and who pays.

### `whoItReaches(brief, data)`

Who the cost reaches is written once, in meta.renter_owner: the brief's renters-and-owners section is made
from it, the takeaway must end with its reach line, and the cost note carries its note line.
