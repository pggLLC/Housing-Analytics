/**
 * js/data-connectors/lodes-commute.js
 * LODES/LEHD job-housing balance accessor for PMA workforce scoring.
 *
 * Data source: data/market/lodes_co.json
 * Real data: https://lehd.ces.census.gov/data/
 *
 * Exposed as window.LodesCommute.
 */
(function () {
  'use strict';

  var _data   = null;  // raw loaded data
  var _idx    = null;  // geoid → record index

  /* ── Build geoid index ─────────────────────────────────────────── */
  function _buildIndex(tracts) {
    var idx = {};
    (tracts || []).forEach(function (t) { idx[t.geoid] = t; });
    return idx;
  }

  /* ── Load data ──────────────────────────────────────────────────── */
  function loadMetrics() {
    var DS = window.DataService;
    if (!DS) return Promise.reject(new Error('DataService not available'));
    return DS.getJSON(DS.baseData('market/lodes_co.json'))
      .then(function (raw) {
        _data  = raw;
        _idx   = _buildIndex((raw && raw.tracts) ? raw.tracts : (Array.isArray(raw) ? raw : []));
        return _data;
      })
      .catch(function (e) {
        console.warn('[lodes-commute] Failed to load lodes_co.json:', e && e.message);
        _data = { tracts: [] };
        _idx  = {};
        return _data;
      });
  }

  /* ── Get metrics for a single tract ────────────────────────────── */
  function getTractMetrics(geoid) {
    return (_idx && _idx[geoid]) || null;
  }

  /* ── Aggregate job-housing metrics for a set of geoids ─────────── */
  function aggregateForBuffer(geoids) {
    if (!_idx) return null;
    var total = { home_workers: 0, work_workers: 0, n: 0 };
    (geoids || []).forEach(function (geoid) {
      var r = _idx[geoid];
      if (!r) return;
      total.home_workers += r.home_workers || 0;
      total.work_workers += r.work_workers || 0;
      total.n++;
    });
    if (!total.n) return null;
    return {
      home_workers:     total.home_workers,
      work_workers:     total.work_workers,
      job_housing_ratio: total.home_workers ? total.work_workers / total.home_workers : 0,
      tract_count:      total.n
    };
  }

  /**
   * Compute a 0–100 job-accessibility score.
   * A ratio near 1.0 indicates balanced job-housing; higher = job centre;
   * lower = bedroom community.  Both extremes can support affordable housing —
   * use a bell curve centred at 0.8 (slight jobs surplus).
   */
  function scoreJobAccessibility(agg) {
    if (!agg) return 50;   // neutral when data unavailable
    var ratio = agg.job_housing_ratio || 0;
    // Ideal: 0.6–1.2.  Below 0.3 or above 2.0 → reduced score.
    var score;
    if (ratio >= 0.6 && ratio <= 1.2) {
      score = 100;
    } else if (ratio < 0.6) {
      score = Math.round((ratio / 0.6) * 100);
    } else {
      // ratio > 1.2 — penalise super-job-dense areas (harder for affordable)
      score = Math.max(40, Math.round(100 - (ratio - 1.2) * 30));
    }
    return Math.min(100, Math.max(0, score));
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  window.LodesCommute = {
    loadMetrics:          loadMetrics,
    getTractMetrics:      getTractMetrics,
    aggregateForBuffer:   aggregateForBuffer,
    scoreJobAccessibility: scoreJobAccessibility,
    /** @returns {object|null} raw loaded data */
    getData: function () { return _data; }
  };

}());
