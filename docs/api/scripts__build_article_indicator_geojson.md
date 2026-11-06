# `scripts/build_article_indicator_geojson.mjs`

F208 — Join the article's county-indicator CSV with the county
boundaries GeoJSON so the data-map-browser can render the same
indicators that drive article-co-housing-costs.html as toggleable
choropleth layers.

Inputs:
  data/co-county-boundaries.json
  assets/co-housing-costs/snapshots/co_county_indicators_full.csv
    (falls back to acs_county_latest.csv, the 4-indicator ACS snapshot)

Output:
  data/processed/co_county_housing_indicators.geojson

Each feature carries the standard TIGER properties (NAME, GEOID, ...)
PLUS the indicator columns from the CSV (the four ACS fields, FHFA HPI
10-year change, QCEW construction wage, BPS permits per 1,000) and the
years each covers. The map browser renders one layer per indicator using
a choropleth tint and reads the years from these properties.

Idempotent: run as often as the article CSV is regenerated.

_No documented symbols — module has a file-header comment only._
