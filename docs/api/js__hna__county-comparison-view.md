# `js/hna/county-comparison-view.js`

Renders the place-vs-county comparison.

Pure presentation: all the judgement lives in county-comparison.js, which
decides what may honestly be compared. This fetches the two digests and
draws the result.

Fetching two ~29KB documents rather than the 1.64MB ranking-index keeps the
payload proportional to what is shown, and the digests carry the provenance
(geography_level, confidence, denominator) that the index does not.

## Symbols

### `renderFor(geoType, geoid)`

renderFor — draw the comparison for a selection, or hide it.
Only place/CDP selections have a containing county; a county compared with
itself is not a comparison, and statewide has nothing above it.

### `initFromUrl()`

Self-initialise from the URL.

The controller calls renderFor() on every selection, but that call sits
inside a pipeline which also fetches ACS profiles and projections — and a
throw anywhere in it (a rate-limited Census key, say) took this section
down with it, even though the comparison needs nothing but a geoid and two
static digests. A panel should not disappear because an unrelated request
failed.

So: read the geography from the URL on load and render independently. The
controller's call still runs and simply repaints the same content when the
user changes jurisdiction.
