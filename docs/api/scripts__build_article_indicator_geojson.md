# `scripts/build_article_indicator_geojson.mjs`

F208 — Join the article's county-indicator CSV with the county
boundaries GeoJSON so the data-map-browser can render the same
indicators that drive article-co-housing-costs.html as toggleable
choropleth layers.

Inputs:
  data/co-county-boundaries.json
  assets/co-housing-costs/snapshots/acs_county_latest.csv

Output:
  data/processed/co_county_housing_indicators.geojson

Each feature carries the standard TIGER properties (NAME, GEOID, ...)
PLUS the indicator columns from the CSV (median_gross_rent,
median_hh_income, vacancy_rate, rent_burden_30_plus). The map browser
renders one layer per indicator using a choropleth tint.

Idempotent: run as often as the article CSV is regenerated.

_No documented symbols — module has a file-header comment only._
