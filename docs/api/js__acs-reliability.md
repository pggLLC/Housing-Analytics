# `js/acs-reliability.js`

acs-reliability.js
Responsibility: the Census margin of error and reliability tier of an ACS
  figure, read from data/hna/acs-reliability.json, which
  scripts/hna/build_acs_reliability.py builds from the published margins.
Dependencies: window.resolveAssetUrl, window.fetchWithTimeout (both optional)
Exposes: window.ACSReliability

Each entry in the file is the published estimate a page stores (e), its 90%
margin of error (m), the ACS year (y) and series (s) the estimate came from,
and a tier (t): good (CV 15% or less), fair (15-30%), use_with_caution
(over 30%) or zero_in_sample. A margin belongs to a number only when the
number shown equals e, so forValue() returns nothing for any other number,
such as a Zillow-based home value or a figure fetched live.

A 1-year figure (a geography of 65,000 or more) also has `five`: the ACS
5-year estimate ending the same year, with its own margin and tier, which
fiveYear() puts beside it with the difference.

## Symbols

### `load()`

Fetch the file once. Resolves to the file, or null when it cannot load.

### `forValue(geoid, field, value)`

The entry for this figure when `value` is the estimate it describes.

### `range(e, unit)`

The Census 90% range of a figure, clipped at 0 and, for a percentage, at
100, as the Census Bureau advises for a margin larger than its estimate.

### `describe(e, unit)`

Plain text for the source line: the margin, then the tier when it is not
good. Returns '' when the figure has no sampling error (a total controlled
to the Census population estimates).

### `tierForCv(cv)`

The tier for a coefficient of variation, by the rule the file is built
with (scripts/hna/build_acs_reliability.py tier_for): good at 15% or less,
fair to 30%, use with caution above that.

### `fiveYear(e, unit)`

For a 1-year figure, its 5-year twin, the series every smaller geography
has: "5-year 2020–2024: $1,781 ±$22 · this figure is $89 higher". The two
cover different periods, so the gap is partly change over time; it is not
a significance test. '' when the entry has no twin.

### `seriesLabel(e)`

"5-year" or "1-year" for an entry's series.
