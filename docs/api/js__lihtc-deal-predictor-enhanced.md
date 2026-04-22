# `js/lihtc-deal-predictor-enhanced.js`

js/lihtc-deal-predictor-enhanced.js
Enhanced LIHTC Deal Prediction Module — Phase 3 (Epic #445)

Extends the base LIHTCDealPredictor with additional data integration points:
  - PMA demand score pipeline integration
  - Affordability gap data (county-level 30%/50%/60% AMI gaps)
  - HUD FMR/AMI data connectors (via window.HudFmr or module.exports)
  - QCT/DDA basis boost logic (enhanced)
  - Legislative context from LegislativeTracker (AHCIA / HR6644 impact)
  - Risk scenario sensitivity (equity pricing, demand, market saturation)

This module wraps the base predictor and layers in Phase 3 data sources.
All base predictConcept() logic is preserved and extended — not replaced.

Exposed as window.LIHTCDealPredictorEnhanced (browser) and
module.exports (Node/test).

Usage:
  var result = LIHTCDealPredictorEnhanced.predictEnhanced(inputs);
  // result.base         → base DealRecommendation from LIHTCDealPredictor
  // result.enhanced     → Phase 3 extensions (legislativeContext, pmaSignals, etc.)
  // result.summary      → plain-text summary for UI rendering

## Symbols

### `LEGISLATIVE_EQUITY_BOOST`

Legislative impact multipliers for equity pricing forecasts.
Based on Novogradac analysis of AHCIA/H.R.6644 provisions.

### `PMA_THRESHOLDS`

Minimum PMA score thresholds by confidence tier.

### `_computePmaSignals(inputs)`

Derive demand-tier signals from PMA score + confidence.
@param {Object} inputs
@returns {Object} pmaSignals

### `_computeAffordabilityGapSignals(inputs)`

Interpret affordability gap data for AMI mix targeting.
@param {Object} inputs
@returns {Object} gapSignals

### `_loadFmrData(inputs)`

Load and normalise FMR data for the given county FIPS.
Falls back to inputs.fmrData if the HudFmr connector is unavailable.
@param {Object} inputs
@returns {Object|null} fmrRecord

### `_computeLegislativeContext()`

Pull legislative market impact signals from LegislativeTracker.
@returns {Object} legislativeContext

### `_buildSummary(base, enhanced)`

Build a plain-text summary from base + enhanced outputs.
@param {Object} base  - DealRecommendation from base predictor
@param {Object} enhanced - Phase 3 extensions
@returns {string}

### `predictEnhanced(inputs)`

Generate a Phase 3 enhanced LIHTC deal recommendation.

@param {Object} inputs — same as LIHTCDealPredictor.predictConcept() inputs,
  plus optional Phase 3 fields (geoid, pmaScore, pmaConfidence, etc.)
@returns {{base: DealRecommendation, enhanced: Object, summary: string}}

### `evaluateScenarios(scenarioList)`

Batch-evaluate multiple scenarios and return side-by-side comparisons.
@param {Object[]} scenarioList  — array of input objects
@returns {Object[]}
