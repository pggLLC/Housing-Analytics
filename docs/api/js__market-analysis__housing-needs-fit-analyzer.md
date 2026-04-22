# `js/market-analysis/housing-needs-fit-analyzer.js`

js/market-analysis/housing-needs-fit-analyzer.js
Bridges Housing Needs Assessment (HNA) data with LIHTC concept recommendations.

Given a NeedProfile (from HNAMarketBridge.buildNeedProfile()) and a
DealRecommendation (from LIHTCDealPredictor.predictConcept()), this module
computes how well the proposed concept addresses the county or municipal
housing need:

  - Which AMI priority segments this concept targets
  - % of identified unmet need covered by the proposed AMI mix
  - Alignment rating: "strong" | "partial" | "weak"
  - Narrative bullets grounded in local HNA data
  - Un-addressed gaps (tiers with significant need but no allocation)

Usage (browser):  window.HousingNeedsFitAnalyzer.analyzeHousingNeedsFit(...)
Usage (Node/test): const hna = require('./js/market-analysis/housing-needs-fit-analyzer');

## Symbols

### `analyzeHousingNeedsFit(needProfile, rec, opts)`

@typedef {Object} HNSFit
@property {string}   geography        - County or municipality name.
@property {string[]} prioritySegments - AMI tiers addressed by this concept.
@property {{ami30:number, ami50:number, ami60:number, total:number}} needCoverage
@property {string}   alignment        - "strong" | "partial" | "weak".
@property {string[]} alignmentPoints  - 2–5 narrative bullet statements.
@property {string[]} gaps             - Unaddressed tiers with significant need.
@property {number}   coveragePct      - Overall coverage score 0–100.

@param {Object|null} needProfile - Output of HNAMarketBridge.buildNeedProfile().
@param {Object|null} rec         - Output of LIHTCDealPredictor.predictConcept().
@param {Object}      [opts]      - Optional overrides.
@param {number}      [opts.proposedUnits] - Override total unit count.
@returns {HNSFit}
