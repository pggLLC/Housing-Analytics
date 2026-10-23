# Local-PHA roster index

This directory contains curated rosters for Colorado local Public Housing Authorities (PHAs) that operate locally-administered Project-Based Voucher (PBV) properties not appearing in any federal feed (CHFA LIHTC, HUD MULTIFAMILY_PROPERTIES_ASSISTED, USDA Rural Housing).

## Active roster files

| File | PHA | HUD Code | Coverage |
|---|---|---|---|
| `garfield-county-ha.json` | Garfield County HA | CO095 | Silt Senior Housing (verified) |
| `denver-housing-authority.json` | Denver Housing Authority | CO001 | Stub — DHA's federally-tagged properties already appear in HUD MF feed; this stub is reserved for any locally-administered PBV that isn't on the federal contract list |

## Where Colorado's project-based vouchers are (expansion targets)

HUD's Picture of Subsidized Households counts project-based voucher (PBV)
homes for each housing authority but does not name the buildings. These
are the 21 Colorado authorities with PBVs, quarter ending 31 Dec 2025
(6,118 homes in all), from
`data/affordable-housing/pbv-by-pha-co.json`
(source: https://www.huduser.gov/portal/datasets/assthsg.html).

Many of these homes sit inside tax-credit or HUD properties already on the
map under that program. Only PBV buildings on no other feed belong here.

| HUD code | Authority | PBV homes (HUD, 31 Dec 2025) | Roster file |
|---|---|---|---|
| CO001 | Housing Authority of the City and County of Denver | 2,242 | ✓ |
| CO911 | Colorado Division of Housing | 1,165 | — |
| CO016 | Boulder Housing Partners | 433 | — |
| CO041 | Housing Catalyst | 366 | — |
| CO072 | Jefferson County Housing Authority | 274 | — |
| CO051 | Grand Junction Housing Authority | 239 | — |
| CO002 | Housing Authority of the City of Pueblo | 199 | — |
| CO036 | Littleton Housing Authority | 192 | — |
| CO035 | Housing Authority of the City of Greeley | 168 | — |
| CO058 | Adams County Housing Authority | 165 | — |
| CO052 | Aurora Housing Authority | 134 | — |
| CO070 | Longmont Housing Authority | 119 | — |
| CO034 | Loveland Housing Authority | 85 | — |
| CO061 | Boulder County Housing Authority | 77 | — |
| CO095 | Garfield County Housing Authority | 73 | ✓ |
| CO028 | Housing Authority of the City of Colorado Springs | 58 | — |
| CO090 | Housing Authority of Weld County | 55 | — |
| CO019 | Housing Authority of the City of Brighton | 36 | — |
| CO050 | Arvada Housing Authority | 17 | — |
| CO040 | Delta Housing Authority | 14 | — |
| CO087 | Montrose County Housing Authority | 7 | — |

## How to expand

For each PHA:

1. Visit the authority's website (linked from HUD's [PHA contact list](https://www.hud.gov/states/colorado/renting/hawebsites))
2. Identify locally-administered PBV properties NOT in the federal HUD MF feed
3. For each, capture: property_name, address, city, zip, county_fips, lat/lng (US Census batch geocoder), total_units, assisted_units, subsidy_type ("pbv-local"), pha_administered_by, pbv_contract_sunset (if known)
4. Add to the relevant file in this directory using the schema documented in [README.md](README.md)
5. Run `node scripts/build-affordable-housing-properties.js` to rebuild the unified `properties.json`
6. Verify via `npm run validate:rosters` + `npm run test:smoke`
