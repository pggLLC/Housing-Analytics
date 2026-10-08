# `js/market/sale-price-evidence.js`

Published Redfin city observations, or explicitly modeled ZIP allocations.
Geography, period, absence and county benchmark review flags travel with
the price to the screen and downloadable report. Pure; no source lookups.

## Symbols

### `reasons(context, unavailableReason)`

Why there is no sale price here, from the sources' own files.

Read rather than written down, because these states change: Bridge is a
pending access decision (#1611) and the assessor endpoints are a coverage
number (#1602). A hardcoded sentence would keep telling a reader the
access was denied on the day it was granted.

### `forPlace(geoid, context)`

@param {string} geoid
@param {Object} context  { tracker, bridge, assessor }
