# `js/market-analysis-supply.js`

Existing affordable supply inside a PMA (LIHTC + other assisted).
Exposed as window.PMAAffordableSupply; CommonJS for tests.

## Symbols

### `removeLihtcDuplicates(lihtcFeatures, otherProps)`

Split other-assisted records into those kept and those that duplicate a
LIHTC feature (rule above). Records or features without coordinates or a
distinctive name never match — they are kept, not guessed at.

@returns {{kept: Array, duplicates: Array, duplicatesRemoved: number}}

### `summarizeAffordableSupply(lihtcFeatures, otherProps)`

Existing affordable supply inside a PMA, kept in its two parts so every
surface can label what it shows. LIHTC projects come from the CHFA/HUD
LIHTC features; "other assisted" is the non-LIHTC inventory (HUD
Multifamily Assisted, USDA Rural Development, local PBV, CHFA
preservation) from data/affordable-housing/properties.json.

Units are affordable units: LIHTC LI_UNITS and other-assisted
assisted_units. A project that does not report those is counted at its
total units and disclosed through unitsFallbackReason. Projects that
report no unit count at all are counted in unitsUnknownCount and
disclosed through unitsUnavailableReason, so a total that omits them is
labelled as a floor rather than presented as complete. A units field is
null when projects exist but none of them report a count.

Other-assisted records that are the same property as a LIHTC feature in
the same PMA are removed first (removeLihtcDuplicates), so a property
listed by both feeds is counted once; duplicatesRemoved says how many.

@param {Array} lihtcFeatures - GeoJSON features already filtered to the PMA
@param {Array} otherProps    - non-LIHTC property records already filtered to the PMA
