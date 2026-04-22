# `js/hna/hna-market-bridge.js`

js/hna/hna-market-bridge.js
HNA-PMA Bridge — unified "need profile" combining HNA affordability gap
data with PMA market conditions to inform concept recommendations.

Purpose:
  Creates a single structured object that answers "what does this market
  need?" by integrating HNA affordability gap by AMI band with PMA demand
  signals. The output (NeedProfile) is the canonical input to the LIHTC
  Deal Predictor and can be reused by policy dashboards and strategic
  planning tools.

Usage (browser):
  var profile = HNAMarketBridge.buildNeedProfile(hnaData, pmaResult, options);

Usage (Node/test):
  var bridge = require('./js/hna/hna-market-bridge');
  var profile = bridge.buildNeedProfile(hnaData, pmaResult);

@typedef {Object} NeedProfile
@property {Object}   geography          — geoid, name, type
@property {Object}   pma                — method, score, confidence
@property {Object}   demandSignals      — householdGrowth, projectedUnitsNeeded, etc.
@property {Object}   affordabilityGap   — ami30/50/60 units needed, totalUndersupply, vacancy
@property {Array}    prioritySegments   — ranked AMI tiers with rationale
@property {string}   confidence         — 'high' | 'medium' | 'low'
@property {string[]} caveats            — data limitations

## Symbols

### `buildNeedProfile(hnaData, pmaResult, options)`

Build a unified need profile from HNA and PMA data.

@param {Object} hnaData   — HNA affordability gap data for the county/area
@param {Object} pmaResult — PMA analysis result object (from PMAAnalysisRunner or PMAEngine)
@param {Object} [options] — { geoid, name, type }
@returns {NeedProfile}

### `toDealInputs(needProfile, overrides)`

Convenience: extract DealInputs-compatible fields from a NeedProfile.
Bridges the NeedProfile to the LIHTCDealPredictor.predictConcept() input shape.

@param {NeedProfile} needProfile
@param {Object}      [overrides] — additional fields to merge
@returns {Object} DealInputs-compatible object
