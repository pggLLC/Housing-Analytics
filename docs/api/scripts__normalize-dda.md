# `scripts/normalize-dda.js`

## Symbols

### `extractFips(ddaCode)`

normalize-dda.js
Post-processes data/dda-colorado.json to normalise the HUD DDA schema so it
matches the field names expected by the front-end rendering code
(colorado-deep-dive.html and js/housing-needs-assessment.js).

HUD source schema  →  normalised target schema
-------------------------------------------------
DDA_NAME           →  NAME        (tooltip label)
DDA_TYPE           →  DDATYPE     (type shown in popup)
DDA_CODE           →  GEOID       (5-digit state+county FIPS, e.g. "08067")
DDA_CODE (derived) →  COUNTYFP    (3-digit county FIPS, e.g. "067")
(computed)         →  STATEFP     ("08" for Colorado)

Only county-based DDA features (DDA_CODE starts with "NCNTY") whose embedded
state FIPS equals "08" (Colorado) are kept.  All other features are removed.

DDA_CODE format for county-based DDAs:
  NCNTY<5-digit-FIPS>N<5-digit-FIPS>
  e.g. "NCNTY08067N08067"  →  FIPS = "08067"
       chars 5-9 (0-indexed) = 5-digit state+county FIPS

Run:  node scripts/normalize-dda.js
Also called automatically by .github/workflows/cache-hud-gis-data.yml during CI.
/

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR   = path.resolve(__dirname, '..', 'data');
const DDA_FILE   = path.join(DATA_DIR, 'dda-colorado.json');
const CO_STATEFP = '08';

/**
Extract the 5-digit state+county FIPS code from a county-based DDA_CODE.
Returns null for codes that are not in the expected NCNTY format.

@param {string} ddaCode  e.g. "NCNTY08067N08067"
@returns {string|null}   e.g. "08067"

### `normaliseFeature(feature)`

Normalise a single GeoJSON Feature from the HUD DDA schema to the schema
expected by the front-end.  Returns null if the feature should be dropped.

@param {object} feature  GeoJSON Feature
@returns {object|null}
