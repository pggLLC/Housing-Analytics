# `js/local-incentives-data.js`

js/local-incentives-data.js
Pure logic behind the Local Housing Incentives page (local-incentives.html).

It joins four hand-verified files into one view per Colorado jurisdiction:
  data/policy/fee-reductions.json      fee relief (entries) and land-use incentives (land_use)
  data/policy/local-housing-funds.json dedicated funds, taxes, linkage fees, land and ownership tools
  data/policy/incentive-coverage.json  who was checked and found nothing, or could not be read
  data/policy/prop123_jurisdictions.json  Prop 123 commitment filings (DOLA)
and data/policy/incentive-alternatives.json, the catalog of tools with their
Colorado legal basis.

The rule this module exists to keep: a jurisdiction with no record has NOT
been shown to have no program. Every scope of every jurisdiction is in one of
three states, and they are never collapsed:
  'records'     at least one verified record
  'none_found'  someone read the official source and it has no such measure
  'unreadable'  the official source could not be read
  'not_checked' nobody has looked yet

No DOM, no fetch, no clock: the page and the tests both call it.

## Symbols

### `geographies(geoConfig)`

geo-config.json → Map geoid → { geoid, name, kind: county|place|cdp, county }

### `resolveFilingName(name, geo, byLabel)`

A DOLA filing name ("City of Aurora", "Town of Erie", "Adams County",
"City and County of Denver") → geoid, or null. Only municipalities and
counties can file, so a name that resolves only to a CDP is returned as
null: it is not a municipality, whatever the filing list says.

### `recordIndex(fees, funds)`

Every verified record as { scope, tool, record }, keyed by canonical geoid.

### `scopeState(items, ledgerRow, scope)`

One scope's state for one jurisdiction.

### `toolKeys(tool)`

Map a catalog tool's maps_to onto the record tool keys it counts.

### `itemMatchesTool(item, tool)`

A catalog tool may narrow a fee measure to some fee categories (e.g. rate discounts → utility_rate).

### `build(docs)`

Build the whole model once.
docs: { geoConfig, fees, funds, coverage, prop123, alternatives }

### `componentOf(record)`

Which FEE_COMPONENTS row a fee record belongs to.
