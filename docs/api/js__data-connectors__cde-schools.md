# `js/data-connectors/cde-schools.js`

NO DATA SOURCE — this connector is dormant.

It previously read a synthetic fixture that was never a real Colorado Department of Education
extract. That fixture carried part of the PMA workforce composite until
#1562 excluded it, and was deleted on 2026-09-09.

loadMetrics() resolves to the empty shape WITHOUT a network request. Do not
restore a fetch until a real source exists — requesting a file that cannot
exist produces console errors that fail the rendered site-audit gate.

Real source when someone wires it up: CDE School Performance Frameworks.

## Symbols

### `getNearestDistrict(lat, lon)`

Nearest district to a lat/lon (straight-line to centroid).
Returns null if no district data loaded.

### `scoreSchoolQuality(agg)`

Score school quality 0–100 for PMA workforce dimension.
composite_quality_score is already 0–100 from the data file.
Return the average quality score directly (or 55 neutral if no data).
