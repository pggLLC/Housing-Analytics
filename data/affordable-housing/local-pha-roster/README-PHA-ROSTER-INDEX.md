# Local-PHA roster index

This directory contains curated rosters for Colorado local Public Housing Authorities (PHAs) that operate locally-administered Project-Based Voucher (PBV) properties not appearing in any federal feed (CHFA LIHTC, HUD MULTIFAMILY_PROPERTIES_ASSISTED, USDA Rural Housing).

## Active roster files

| File | PHA | HUD Code | Coverage |
|---|---|---|---|
| `garfield-county-ha.json` | Garfield County HA | CO095 | Silt Senior Housing (verified) |
| `denver-housing-authority.json` | Denver Housing Authority | CO001 | Stub — DHA's federally-tagged properties already appear in HUD MF feed; this stub is reserved for any locally-administered PBV that isn't on the federal contract list |

## Top 10 CO PHAs by served population (expansion targets)

| Rank | PHA | HUD Code | Active stub | Households served (approx) |
|---|---|---|---|---|
| 1 | Denver Housing Authority | CO001 | ✓ | ~13,000 |
| 2 | Aurora Housing Authority | CO002 | — | ~3,500 |
| 3 | Boulder County Housing Authority | CO003 | — | ~2,800 |
| 4 | Jefferson County Housing Authority | CO005 | — | ~2,500 |
| 5 | Adams County Housing Authority | CO006 | — | ~2,400 |
| 6 | El Paso County Housing Authority | CO007 | — | ~2,300 |
| 7 | Larimer County Housing Authority | CO008 | — | ~1,800 |
| 8 | Pueblo Housing Authority | CO009 | — | ~1,700 |
| 9 | Mesa County Housing Authority | CO010 | — | ~1,500 |
| 10 | Garfield County Housing Authority | CO095 | ✓ | ~750 |

## How to expand

For each PHA:

1. Visit the authority's website (linked from HUD's [PHA contact list](https://www.hud.gov/states/colorado/renting/hawebsites))
2. Identify locally-administered PBV properties NOT in the federal HUD MF feed
3. For each, capture: property_name, address, city, zip, county_fips, lat/lng (US Census batch geocoder), total_units, assisted_units, subsidy_type ("pbv-local"), pha_administered_by, pbv_contract_sunset (if known)
4. Add to the relevant file in this directory using the schema documented in [README.md](README.md)
5. Run `node scripts/build-affordable-housing-properties.js` to rebuild the unified `properties.json`
6. Verify via `npm run validate:rosters` + `npm run test:smoke`
