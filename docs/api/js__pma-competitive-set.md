# `js/pma-competitive-set.js`

js/pma-competitive-set.js
Enhanced competitive property analysis with HUD NHPD subsidy expiry risk.

Responsibilities:
 - buildCompetitiveSet(lihtcFeatures, nhpdFeatures, lat, lon, radiusMiles)
 - flagSubsidyExpiryRisk(nhpdFeatures, thresholdYears) — at-risk properties
 - calculateAbsorptionRisk(competitiveSet, proposedUnits) — market saturation
 - getCompetitiveSetLayer() — GeoJSON for map display
 - getCompetitiveJustification() — audit-ready competitive analysis

Builds on the existing LIHTC filter logic in PMAEngine, layering in
NHPD subsidy data for a complete competitive landscape.

Exposed as window.PMACompetitiveSet.

## Symbols

### `buildCompetitiveSet(lihtcFeatures, nhpdFeatures, siteLat, siteLon, radiusMiles)`

Build the competitive property set by merging LIHTC and NHPD data
within the specified radius of the proposed site.

@param {Array}  lihtcFeatures - GeoJSON features from hud_lihtc_co
@param {Array}  nhpdFeatures  - NHPD subsidized property features
@param {number} siteLat
@param {number} siteLon
@param {number} [radiusMiles]
@returns {Array} competitive set with merged subsidy metadata

### `flagSubsidyExpiryRisk(nhpdFeatures, thresholdYears)`

Flag subsidized properties at risk of subsidy expiry.
@param {Array}  nhpdFeatures
@param {number} [thresholdYears]
@returns {Array} at-risk properties sorted by expiry year

### `calculateAbsorptionRisk(competitiveSet, proposedUnits)`

Assess absorption risk based on competitive unit count vs proposed units.
@param {Array}  competitiveSet - Output of buildCompetitiveSet
@param {number} proposedUnits
@returns {{risk: string, captureRate: number, totalCompetitiveUnits: number}}

### `getCompetitiveSetLayer(set)`

Build GeoJSON FeatureCollection for competitive set map layer.
@param {Array} [set]
@returns {object}

### `getCompetitiveJustification()`

Export competitive set analysis for ScoreRun audit trail.
@returns {object}
