/**
 * NO DATA SOURCE — this connector is dormant.
 *
 * It previously read a synthetic fixture that was never a real Colorado Department of Labor and Employment
 * extract. That fixture carried part of the PMA workforce composite until
 * #1562 excluded it, and was deleted on 2026-09-09.
 *
 * loadMetrics() resolves to the empty shape WITHOUT a network request. Do not
 * restore a fetch until a real source exists — requesting a file that cannot
 * exist produces console errors that fail the rendered site-audit gate.
 *
 * Real source when someone wires it up: CDLE Labor Market Information.
 */
/**
 * js/data-connectors/cdle-jobs.js
 * Colorado Department of Labor and Employment (CDLE) job vacancy accessor.
 *
 * Data source: (no committed data file — the synthetic fixture was deleted 2026-09-09)
 * Real data: https://www.colmigateway.com/
 *
 * Exposed as window.CdleJobs.
 */
(function () {
  'use strict';

  var _data = null;  // raw loaded data
  var _idx  = null;  // county_fips → record index

  /* ── Build county index ──────────────────────────────────────── */
  function _buildIndex(counties) {
    var idx = {};
    (counties || []).forEach(function (c) { idx[c.county_fips] = c; });
    return idx;
  }

  /* ── Load data ──────────────────────────────────────────────── */
  function loadMetrics() {
    // No committed source. The synthetic fixture was deleted on 2026-09-09 and
    // this sub-score is excluded from PMA scoring, so do NOT attempt a fetch —
    // a request for a file that cannot exist produces console errors that fail
    // the rendered site-audit gate. Resolve to the empty shape the consumers
    // already handle. Restore the fetch when a real CDLE labor-market source is wired in.
    _data     = { counties: [] };
    _idx      = {};
    return Promise.resolve(_data);

  }

  /* ── Get county record ─────────────────────────────────────── */
  function getCountyMetrics(countyFips) {
    return (_idx && _idx[countyFips]) || null;
  }

  /* ── Aggregate vacancy for a set of county FIPS codes ─────── */
  function aggregateForCounties(countyFipsList) {
    if (!_idx) return null;
    var totals = { labor_force: 0, total_postings: 0, n: 0 };
    (countyFipsList || []).forEach(function (fips) {
      var r = _idx[fips];
      if (!r) return;
      totals.labor_force    += r.labor_force    || 0;
      totals.total_postings += r.total_job_postings || 0;
      totals.n++;
    });
    if (!totals.n) return null;
    return {
      labor_force:    totals.labor_force,
      total_postings: totals.total_postings,
      vacancy_rate:   totals.labor_force ? totals.total_postings / totals.labor_force : 0,
      county_count:   totals.n
    };
  }

  /**
   * Score vacancy rate 0–100 for PMA workforce dimension.
   * CDLE interpretation: low vacancy = tight labour market → harder to fill
   * affordable-housing-eligible jobs → moderate workforce risk.
   * Moderate vacancy (2–5%) = sweet spot.  Very high vacancy = weak demand.
   *
   * Scoring: vacancy_rate as a ratio (e.g. 0.03 = 3%).
   *   <1%  → 40  (extremely tight — risk of no workers)
   *   1–2% → 70
   *   2–4% → 100  (ideal moderate vacancy)
   *   4–6% → 80
   *   6–9% → 60
   *   >9%  → 30  (slack market / economic weakness)
   */
  function scoreVacancyRate(agg) {
    if (!agg) return 50;
    var v = (agg.vacancy_rate || 0) * 100;  // convert to percentage
    if (v < 1)           return 40;
    if (v < 2)           return 70;
    if (v < 4)           return 100;
    if (v < 6)           return 80;
    if (v < 9)           return 60;
    return 30;
  }

  /* ── Public API ─────────────────────────────────────────────── */
  window.CdleJobs = {
    loadMetrics:         loadMetrics,
    getCountyMetrics:    getCountyMetrics,
    aggregateForCounties: aggregateForCounties,
    scoreVacancyRate:    scoreVacancyRate,
    /** @returns {object|null} raw loaded data */
    getData: function () { return _data; }
  };

}());
