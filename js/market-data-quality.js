/**
 * js/market-data-quality.js
 * Data validation, freshness checking, and confidence scoring for the PMA tool.
 *
 * Responsibilities:
 *  - validateMarketData(acs, lihtc, centroids) — completeness check
 *  - calculateDataQuality(acs, lihtc, centroids) — coverage metrics object
 *  - calculateConfidenceScore(coverage) — 0–1 confidence value
 *  - checkDataFreshness(generatedDate) — freshness status & color coding
 *
 * Exposed as window.PMADataQuality.
 * Data loaded externally and passed in — no fetch() calls.
 */
(function () {
  'use strict';

  /* ── Coverage thresholds ──────────────────────────────────────────── */
  var THRESHOLDS = {
    acs:      { minimum: 500,  target: 1000 },
    lihtc:    { minimum: 100,  target: 500  },
    centroids:{ minimum: 500,  target: 1000 }
  };

  var FRESHNESS = {
    green:  30,   // days — good
    yellow: 90    // days — stale (>90 = red)
  };

  /* ── Validate market data completeness ───────────────────────────── */
  function validateMarketData(acsMetrics, lihtcFeatures, tractCentroids) {
    var warnings = [];
    var errors   = [];

    var acsCount      = (acsMetrics && acsMetrics.tracts) ? acsMetrics.tracts.length : 0;
    var lihtcCount    = Array.isArray(lihtcFeatures) ? lihtcFeatures.length : 0;
    var centroidCount = (tractCentroids && tractCentroids.tracts) ? tractCentroids.tracts.length : 0;

    if (acsCount === 0) {
      errors.push('ACS tract metrics are missing — score cannot be computed.');
    } else if (acsCount < THRESHOLDS.acs.minimum) {
      warnings.push('ACS tracts below minimum (' + acsCount + ' of ' + THRESHOLDS.acs.minimum + ' expected).');
    }

    if (lihtcCount === 0) {
      errors.push('LIHTC project data is missing — capture risk score unreliable.');
    } else if (lihtcCount < THRESHOLDS.lihtc.minimum) {
      warnings.push('LIHTC projects below minimum (' + lihtcCount + ' of ' + THRESHOLDS.lihtc.minimum + ' expected).');
    }

    if (centroidCount === 0) {
      errors.push('Tract centroid data is missing — buffer analysis impossible.');
    } else if (centroidCount < THRESHOLDS.centroids.minimum) {
      warnings.push('Tract centroids below minimum (' + centroidCount + ' of ' + THRESHOLDS.centroids.minimum + ' expected).');
    }

    return {
      valid:    errors.length === 0,
      errors:   errors,
      warnings: warnings,
      counts: {
        acs:       acsCount,
        lihtc:     lihtcCount,
        centroids: centroidCount
      }
    };
  }

  /* ── Calculate coverage percentages ─────────────────────────────── */
  function calculateDataQuality(acsMetrics, lihtcFeatures, tractCentroids) {
    var counts = {
      acs:       (acsMetrics && acsMetrics.tracts) ? acsMetrics.tracts.length : 0,
      lihtc:     Array.isArray(lihtcFeatures) ? lihtcFeatures.length : 0,
      centroids: (tractCentroids && tractCentroids.tracts) ? tractCentroids.tracts.length : 0
    };

    function coverage(actual, target) {
      return Math.min(1.0, actual / target);
    }

    var acsCov      = coverage(counts.acs,       THRESHOLDS.acs.target);
    var lihtcCov    = coverage(counts.lihtc,      THRESHOLDS.lihtc.target);
    var centroidCov = coverage(counts.centroids,  THRESHOLDS.centroids.target);

    var confidence = calculateConfidenceScore({ acs: acsCov, lihtc: lihtcCov, centroids: centroidCov });

    return {
      counts:     counts,
      thresholds: THRESHOLDS,
      coverage: {
        acs:       Math.round(acsCov * 100),
        lihtc:     Math.round(lihtcCov * 100),
        centroids: Math.round(centroidCov * 100)
      },
      confidence: confidence,
      label: confidenceLabel(confidence)
    };
  }

  /* ── Confidence score (0–1) weighted average ─────────────────────── */
  function calculateConfidenceScore(coverage) {
    // ACS has the most impact on scoring; LIHTC next; centroids last
    var weighted = (
      (coverage.acs       || 0) * 0.40 +
      (coverage.lihtc     || 0) * 0.35 +
      (coverage.centroids || 0) * 0.25
    );
    return Math.round(weighted * 100) / 100;
  }

  function confidenceLabel(conf) {
    if (conf >= 0.80) return { text: 'High',     color: 'var(--good)' };
    if (conf >= 0.50) return { text: 'Moderate', color: 'var(--warn)' };
    return                    { text: 'Low',      color: 'var(--bad)'  };
  }

  /* ── Data freshness check ─────────────────────────────────────────── */
  function checkDataFreshness(generatedDate) {
    if (!generatedDate) {
      return { status: 'unknown', days: null, color: 'var(--faint)', text: 'Unknown age' };
    }

    var generated = new Date(generatedDate);
    var now       = new Date();
    var diffMs    = now - generated;
    var days      = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (isNaN(days) || days < 0) {
      return { status: 'unknown', days: null, color: 'var(--faint)', text: 'Unknown age' };
    }

    if (days <= FRESHNESS.green) {
      return { status: 'fresh',  days: days, color: 'var(--good)', text: days + ' days ago' };
    }
    if (days <= FRESHNESS.yellow) {
      return { status: 'stale',  days: days, color: 'var(--warn)', text: days + ' days ago — consider refreshing' };
    }
    return { status: 'old',    days: days, color: 'var(--bad)',  text: days + ' days ago — data refresh recommended' };
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  window.PMADataQuality = {
    validateMarketData:     validateMarketData,
    calculateDataQuality:   calculateDataQuality,
    calculateConfidenceScore: calculateConfidenceScore,
    checkDataFreshness:     checkDataFreshness,
    THRESHOLDS:             THRESHOLDS,
    FRESHNESS:              FRESHNESS
  };

}());
