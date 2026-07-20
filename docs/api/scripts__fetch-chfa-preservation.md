# `scripts/fetch-chfa-preservation.js`

fetch-chfa-preservation.js

Fetches CHFA's PreservationProperties_Layer_Final_view_new feature layer and
writes a HUD-compatible GeoJSON to data/affordable-housing/preservation/chfa-preservation.json.

The CHFA preservation layer tracks 1,690+ affordable rental properties in
Colorado that are at risk of subsidy loss — including:
  - Section 8 PBRA (HUD project-based rental assistance)
  - HUD Section 202 / 811 (elderly / disabled)
  - USDA Rural Development 515 / 521 / 538
  - HOME-funded properties
  - LIHTC properties approaching Year-15 compliance period end

The source schema is intentionally lean (property identity only —
UniqueProjID / PropertyAddress / City / State / Zip / ProjectName /
TotalNumberofUnits / Latitude / Longitude). Subsidy-type and expiration
details are NOT in this layer — they would need to be joined from
HUD's Multifamily Properties Assisted dataset or NHPD.

For the Opportunity Finder, this layer answers "where are the
existing affordable rental properties?" — used by the Preservation
deal-type (forthcoming).

Source: https://services3.arcgis.com/gSW3qyxbcpEXSMfe/arcgis/rest/services/PreservationProperties_Layer_Final_view_new/FeatureServer/0
Surfaced via: https://chfa.maps.arcgis.com (CHFA's public preservation map app)

Run:  node scripts/fetch-chfa-preservation.js

Output: data/affordable-housing/preservation/chfa-preservation.json
Format: GeoJSON FeatureCollection
Field aliases: HUD-compatible (PROJECT, PROJ_ADD, PROJ_CTY, PROJ_ST,
  N_UNITS) for site-wide consumer compatibility + the source's
  original UniqueProjID for joining to other CHFA datasets.

## Symbols

### `toGeoJsonFeature(esriFeature)`

Convert a CHFA preservation feature to a HUD-compatible GeoJSON Feature.
Mirrors the schema-mapping pattern of scripts/fetch-chfa-lihtc.js so the
resulting file is shape-compatible with existing site consumers that
read PROJECT / PROJ_CTY / N_UNITS / etc.
