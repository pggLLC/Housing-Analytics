# `js/hna/geography-provenance.js`

Shared geography-provenance chips.

Answers one question a housing professional must be able to settle at a
glance before citing a figure in a funding application: *what geography is
this number, and how was it derived?*

This is deliberately separate from ProvenanceLabel (js/provenance-label.js),
which answers a different question — how well evidenced a claim is
(observed / modeled / user-entered). A figure can be impeccably sourced and
still be the county's rather than the town's; both labels can apply to the
same number.

Levels, from strongest to weakest claim:
  place         — measured at the selected place (e.g. an ACS place table)
  apportioned   — derived for the place from N underlying tracts
  county-proxy  — the containing county's figure, shown for a sub-county
                  selection because no local figure exists
  county        — a county figure, and the user selected that county
  state         — a statewide figure
  unavailable   — no figure at any level

`apportioned` carries the tract count because that is the real confidence
signal and it is already recorded per place in data/hna/place-chas.json:
270 of 482 Colorado places resolve to a single tract, where apportionment
means one tract's profile scaled by population share. That is a materially
weaker claim than a twelve-tract city and the reader deserves to see the
difference. The neighbouring `low_confidence` and `coverage_share` fields
are not used here: both are constant across all 482 places in the committed
data, so neither distinguishes anything.

## Symbols

### `describe(input)`

describe — resolve a geography level into a chip descriptor.

@param {object} input
@param {string} input.level        one of LEVELS
@param {number} [input.tractCount] underlying tracts, for 'apportioned'
@param {string} [input.countyName] containing county, for 'county-proxy'
@param {string} [input.metric]     metric name, used in the tooltip
@returns {{level:string, label:string, tone:string, title:string, tractCount:(number|null)}}

### `chipHtml(input)`

chipHtml — render a descriptor (or a describe() input) as a chip.
Styling lives in css/pages/housing-needs-assessment.css so the colours
come from the theme's semantic tokens and hold in both light and dark.

### `fromPlaceChasRecord(record, opts)`

fromPlaceChasRecord — map a data/hna/place-chas.json entry onto a level.
Returns null when there is no record, so callers can fall back rather
than assert a geography they cannot support.
