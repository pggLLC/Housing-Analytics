# Local PHA roster — curated supplement

## What this is

Hand-curated records for affordable properties administered by **local
PHAs** (Public Housing Authorities) where the rental assistance is a
**locally-administered Project-Based Voucher (PBV)** rather than a
HUD-administered PBRA contract. These properties **do not appear** in:

- CHFA LIHTC feed (no tax-credit financing)
- CHFA Preservation feed (not on CHFA's portfolio)
- HUD MULTIFAMILY_PROPERTIES_ASSISTED ArcGIS service (PBRA-only, not PBV)
- USDA Rural Housing (not USDA-financed)

…which together make up the four feeds that build `properties.json`.

The original report that surfaced this: the LIHTC Opportunity Finder
showed Silt with zero existing affordable properties, but **Silt Senior
Housing** has 20 PBV units administered by the Garfield County Housing
Authority. The federal databases simply don't carry local PBVs.

## Scope of this gap (state-wide)

HUD's Picture of Subsidized Households counts 6,118 project-based
voucher homes at 21 Colorado housing authorities (quarter ending 31 Dec
2025; `data/affordable-housing/pbv-by-pha-co.json`). HUD does not publish
which buildings hold them, so a full property list is not possible from
public data. Realistic gap-fill requires per-authority records (annual
plans, administrative plans, board packets). The map labels this layer
"partial" and quotes the HUD total.

This file is intentionally small + verified. Expansion is a
data-collection task (see "How to add records" below). Do not add
records you cannot verify from a primary source.

## How to add records

Each record needs (at minimum):

- `property_name` — exact name from PHA listing
- `address`, `city`, `state`, `zip` — verifiable street address
- `lat`, `lng` — geocoded centroid (use US Census geocoder)
- `total_units` — verified from PHA report or property listing
- `assisted_units` — number of PBV units (may be < total_units)
- `subsidy_type` — `'pbv-local'` (this file's discriminator)
- `pha_administered_by` — the PHA name (e.g. "Garfield County HA")
- `source_url` — primary source: PHA report, news article, or
  AffordableHousingOnline / RentAssistance listing
- `_source` — short label for `source` field in unified output

## Files in this directory

- `garfield-county-ha.json` — Garfield County Housing Authority roster.
  Seeded with Silt Senior Housing (the original reported gap).

## Build integration

`scripts/build-affordable-housing-properties.js` reads all `*.json`
files in this directory and emits each property with:

- `program_type: ['pbv-local', 'preservation-candidate']`
- `subsidy_type: 'pbv-local'`
- `source: 'Local PHA roster (curated)'`

So they appear on the affordable-housing layer with the same slate-blue
"preservation candidate" color and in opportunity-finder market scans.
