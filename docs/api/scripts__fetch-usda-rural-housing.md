# `scripts/fetch-usda-rural-housing.js`

fetch-usda-rural-housing.js

Fetches USDA Rural Housing Assets feature layer and writes to:
  data/affordable-housing/preservation/usda-rural-housing.json

Coverage in CO: ~116 properties.

Critical fields not available in other sources:
  - RESTRICTIVE_CLAUSE_EXPIRATION — the actual subsidy expiration date,
    which is the single most-important signal for preservation deal
    targeting (a property expiring within 5 years is a much hotter
    preservation candidate than one expiring in 30 years)
  - RA_UNITS — Rental Assistance units (Section 521 RA program)
  - HUD_UNITS — overlapping HUD-funded units within RD property
  - RENTAL_DESIGNATION — Family / Elderly / Special

Source: https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/USDA_Rural_Housing_Assets/FeatureServer/0

Run:  node scripts/fetch-usda-rural-housing.js

## Symbols

### `yearsToExpiration(expirationStr)`

Compute years-to-expiration from RESTRICTIVE_CLAUSE_EXPIRATION (string).
Helps surface preservation urgency.
