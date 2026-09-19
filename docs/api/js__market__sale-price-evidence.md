# `js/market/sale-price-evidence.js`

What sale-price evidence exists for this place, and what it actually is.

data/market/redfin_place_market_tracker_co.json is rebuilt on a schedule,
freshness-checked, 1.5 MB, 121 Colorado places — and until this module
nothing on the site read it. The only place a reader could see a Redfin
median was a number copied by hand into a project fixture, which names the
file as its source and will drift from it silently at the next refresh.

#1620 §6 criterion 3 asks for both halves of this: a place with coverage
shows its median with a date, and a place without shows "no sale-price
source for this place" WITH the reasons. Neither half existed.

── The figure is not what its name suggests ──

Every one of the 121 rows is `redfin_zip_to_place_modeled`. There are no
direct place observations in the file, and the source's own limitations note
says so: "Place rows are modeled aggregates from ZIP-level Redfin data, not
direct Redfin place statistics."

Fruita's figure is allocated across seven ZIP codes, three of which
(81503, 81505, 81507) are Grand Junction. One place in the file draws on
forty-one ZIPs; twelve draw on one. Printing "$489,439 — median sale price,
Fruita" would be the most ordinary kind of lie this repo tells: a true
number under a label that means something else. So the ZIP count travels
with the value and the caveat is not optional.

Five of the 121 rows are also a year or more behind the rest. They sit in
the same file, in the same shape, with nothing to distinguish them, so they
are separated here rather than by whoever reads the number.

Pure: every dataset arrives already parsed.

## Symbols

### `reasons(context)`

Why there is no sale price here, from the sources' own files.

Read rather than written down, because these states change: Bridge is a
pending access decision (#1611) and the assessor endpoints are a coverage
number (#1602). A hardcoded sentence would keep telling a reader the
access was denied on the day it was granted.

### `forPlace(geoid, context)`

@param {string} geoid
@param {Object} context  { tracker, bridge, assessor }
