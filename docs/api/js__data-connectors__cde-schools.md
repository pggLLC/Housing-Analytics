# `js/data-connectors/cde-schools.js`

js/data-connectors/cde-schools.js
Colorado Department of Education school district quality accessor.

Data source: data/market/cde_schools_co.json
Real data: https://www.cde.state.co.us/accountability

Exposed as window.CdeSchools.

## Symbols

### `getNearestDistrict(lat, lon)`

Nearest district to a lat/lon (straight-line to centroid).
Returns null if no district data loaded.

### `scoreSchoolQuality(agg)`

Score school quality 0–100 for PMA workforce dimension.
composite_quality_score is already 0–100 from the data file.
Return the average quality score directly (or 55 neutral if no data).
