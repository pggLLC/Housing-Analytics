# `js/chfa-award-predictor.js`

js/chfa-award-predictor.js
CHFA QAP Competitiveness Predictor — Phase 2.1

Estimates award likelihood and competitive score for a LIHTC concept
based on historical CHFA QAP award patterns (2015–2025).

⚠ DATA SOURCE DISCLOSURE:
  The underlying dataset (`data/policy/chfa-awards-historical.json`) is
  a **synthesized sample** assembled from CHFA's public award
  announcements — see `meta.note` in that file. It is suitable for
  directional calibration but is NOT CHFA's authoritative award record.
  UI surfaces that consume this predictor (see qap-competitiveness-panel.js
  and lihtc-concept-card-renderer.js) render a visible banner above any
  predicted score. Verify specific figures against CHFA's current award
  history before citing them: https://www.chfainfo.com/rental-housing/housing-credit

Non-goals:
  - Does NOT predict the actual CHFA score (CHFA is the sole arbiter)
  - Does NOT guarantee an award — estimates only
  - Does NOT replace professional pre-application consultation with CHFA
  - Estimates are based on historical patterns; current QAP may differ

Usage:
  CHFAAwardPredictor.load(historicalData).then(function () {
    var result = CHFAAwardPredictor.predict(concept, siteContext);
  });

Exposed as window.CHFAAwardPredictor (browser) and module.exports (Node).

@typedef {Object} AwardPrediction
@property {number}   awardLikelihood   — 0–1 probability estimate
@property {string}   competitiveBand   — 'strong'|'moderate'|'weak'
@property {number}   scoreEstimate     — rough 0–100 score estimate
@property {Object}   factors           — factor-level breakdown
@property {Object}   competitiveContext — applications/funded context
@property {string}   narrative         — human-readable summary
@property {string[]} caveats           — important disclaimers

## Symbols

### `_estimateFactors(concept, siteContext)`

Estimate individual factor scores from concept and site context.
@param {Object} concept     - DealRecommendation from LIHTCDealPredictor
@param {Object} siteContext - Site-level context signals
@returns {Object} factorScores

### `_sumScore(factors)`

Sum all factor scores.

### `_scoreToProbability(score)`

Estimate award likelihood from score.

### `_likelihoodToBand(p)`

Map likelihood to competitive band.

### `_computePercentile(score)`

Compute percentile vs historical winners.

### `load(historicalData)`

Load historical award data.
@param {Object} historicalData — parsed chfa-awards-historical.json
@returns {Promise<void>}

### `predict(concept, siteContext)`

Predict CHFA award competitiveness for a concept.

@param {Object} concept      - DealRecommendation from LIHTCDealPredictor (or minimal obj)
@param {Object} siteContext  - Site signals: { pmaScore, isQct, isDda, isRural, totalUndersupply,
                                 ami30UnitsNeeded, localSoftFunding, hasGovernmentSupport,
                                 publicLandOpportunity, hasHnaData, greenBuilding, isPreservation }
@returns {AwardPrediction}

### `isLoaded()`

Returns true if historical data has been loaded.
@returns {boolean}

### `getAwardsByType(type)`

Return awards filtered by concept type.
@param {string} type - 'family'|'seniors'|'supportive'|'mixed-use'
@returns {Array<Object>}
