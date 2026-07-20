# `scripts/fetch-hud-multifamily.js`

fetch-hud-multifamily.js

Fetches HUD's MULTIFAMILY_PROPERTIES_ASSISTED feature layer (HUD's master
list of project-based assisted multifamily properties) and writes
a HUD-compatible GeoJSON to:
  data/affordable-housing/preservation/hud-multifamily-assisted.json

Coverage in CO: ~343 properties.

Why this matters: CHFA's preservation layer (1,688 properties) lacks
subsidy_type detail. HUD MF Assisted has 284 fields including:
  - IS_SEC8_STATE_AGENCY_HFA_IND (Section 8 PBRA project-based)
  - IS_202_811_IND               (Section 202 elderly / 811 disabled)
  - IS_INSURED_IND               (FHA-insured mortgage)
  - IS_221D3_IND / IS_221D4_IND  (FHA programs)
  - IS_236_IND                   (Section 236 interest reduction)
  - IS_FLEXIBLE_SUBSIDY_IND
  - HAS_USE_RESTRICTION_IND      (affordability restriction still active)

Source: https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/MULTIFAMILY_PROPERTIES_ASSISTED/FeatureServer/0
Discovered via: HUD Open Data Hub (hudgis-hud.opendata.arcgis.com)

Run:  node scripts/fetch-hud-multifamily.js

## Symbols

### `deriveSubsidyType(a)`

Derive a subsidy_type label from the HUD MF indicator flags.
Order matters — more-specific labels first.
