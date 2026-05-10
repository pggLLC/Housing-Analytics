/**
 * hmda-lookup.js
 *
 * Browser-side helper for the CFPB HMDA (Home Mortgage Disclosure Act)
 * data shipped in PR #786. Two source files are bundled:
 *
 *   data/hmda/co-state-trends.json       — statewide YoY (3.6 KB)
 *   data/hmda/co-county-aggregates.json  — 64 CO counties × 7 years (~250 KB)
 *
 * The Deal Calculator and PMA simulator use this helper to surface
 * mortgage-credit-access context next to a deal: per-county origination
 * count, denial rate, mean loan amount, multifamily originations
 * (LIHTC-adjacent subset), plus a state benchmark.
 *
 * Why mortgage credit access matters for LIHTC analysts
 * -----------------------------------------------------
 *   - Rising county denial rate / falling origination count signals
 *     tightening credit, which precedes slowdown in multifamily starts
 *     and reduced demand for LIHTC bond execution.
 *   - Multifamily-only subset (HMDA dwelling_categories=Multifamily:
 *     Site-Built) is directly LIHTC-adjacent — quick read on the
 *     county's competitive lending environment.
 *   - Per-county denial-rate variance (Adams 27.8% vs Denver 20.1% in
 *     2024) exposes underserved markets that LIHTC deals can target.
 *
 * Public API
 * ----------
 *   window.HmdaLookup.init() — fetch + cache both data files
 *   window.HmdaLookup.getCounty(countyFips) — return latest-year metrics
 *     for a county, or null if not found
 *   window.HmdaLookup.getCountyTrend(countyFips)
 *     — return all years for a county, sorted ascending, or [] if not found
 *   window.HmdaLookup.getStateLatest() — latest-year statewide metrics
 *   window.HmdaLookup.getCountyVsState(countyFips)
 *     — { county, state, delta: { denial_rate_pp, mean_loan_pct,
 *         originations_pct } } — useful for "this county is X
 *         relative to the CO statewide picture" callouts.
 */
(function () {
  'use strict';

  // Paths are RELATIVE to data/. DataService.baseData() prepends 'data/';
  // the standalone fallback below also prepends 'data/'. Passing a path
  // that already starts with 'data/' produces 'data/data/...' (the bug
  // fixed in PR #791). Keep these without the prefix.
  var COUNTY_PATH = 'hmda/co-county-aggregates.json';
  var STATE_PATH  = 'hmda/co-state-trends.json';
  var _county = null;
  var _state = null;
  var _loadPromise = null;

  function _resolveDataUrl(rel) {
    if (typeof window !== 'undefined' && window.DataService
        && typeof window.DataService.baseData === 'function') {
      return window.DataService.baseData(rel);
    }
    return 'data/' + rel;
  }

  function _fetchJson(url) {
    if (typeof window !== 'undefined' && window.DataService && window.DataService.getJSON) {
      return window.DataService.getJSON(url);
    }
    return fetch(url).then(function (r) { return r.json(); });
  }

  function init() {
    if (_county && _state) return Promise.resolve({ county: _county, state: _state });
    if (_loadPromise) return _loadPromise;
    _loadPromise = Promise.all([
      _fetchJson(_resolveDataUrl(COUNTY_PATH)).catch(function (err) {
        console.warn('[hmda-lookup] Could not load ' + COUNTY_PATH + ':', err);
        return { counties: {}, meta: {} };
      }),
      _fetchJson(_resolveDataUrl(STATE_PATH)).catch(function (err) {
        console.warn('[hmda-lookup] Could not load ' + STATE_PATH + ':', err);
        return { years: {}, meta: {} };
      }),
    ]).then(function (results) {
      _county = results[0];
      _state = results[1];
      return { county: _county, state: _state };
    });
    return _loadPromise;
  }

  function _latestYear(yearMap) {
    if (!yearMap) return null;
    var years = Object.keys(yearMap).sort();
    return years.length ? years[years.length - 1] : null;
  }

  /** Return latest-year HMDA metrics for a county FIPS (5-digit), or null. */
  function getCounty(countyFips) {
    if (!_county) return null;
    var fips = String(countyFips).padStart(5, '0');
    var rec = (_county.counties || {})[fips];
    if (!rec) return null;
    var latest = _latestYear(rec.years);
    if (!latest) return null;
    return Object.assign({ year: latest, fips: fips, name: rec.name }, rec.years[latest]);
  }

  /** Return [{year, originations, denial_rate, ...}] across all years for
   *  a county, sorted by year ascending. */
  function getCountyTrend(countyFips) {
    if (!_county) return [];
    var fips = String(countyFips).padStart(5, '0');
    var rec = (_county.counties || {})[fips];
    if (!rec) return [];
    var out = [];
    Object.keys(rec.years).sort().forEach(function (year) {
      out.push(Object.assign({ year: year }, rec.years[year]));
    });
    return out;
  }

  /** Return latest-year statewide metrics, or null. */
  function getStateLatest() {
    if (!_state) return null;
    var latest = _latestYear(_state.years);
    if (!latest) return null;
    return Object.assign({ year: latest, state: 'CO' }, _state.years[latest]);
  }

  /** Return a county-vs-state comparison for the latest year:
   *    {
   *      county: {originations, denial_rate, mean_loan_amount_usd, ...},
   *      state:  {...},
   *      delta:  {
   *        denial_rate_pp:    (county - state) * 100,
   *        mean_loan_pct:     (county - state) / state * 100,
   *        originations_pct:  per-100K-pop normalized? — for now skip.
   *      }
   *    }
   *  Returns null if either side is unavailable. */
  function getCountyVsState(countyFips) {
    var county = getCounty(countyFips);
    var state = getStateLatest();
    if (!county || !state) return null;
    return {
      county: county,
      state: state,
      delta: {
        denial_rate_pp: ((county.denial_rate || 0) - (state.denial_rate || 0)) * 100,
        mean_loan_pct: state.mean_loan_amount_usd
          ? ((county.mean_loan_amount_usd - state.mean_loan_amount_usd) / state.mean_loan_amount_usd) * 100
          : 0,
        multifamily_share_county: county.originations
          ? (county.multifamily.originations / county.originations) * 100
          : 0,
        multifamily_share_state: state.originations
          ? (state.multifamily.originations / state.originations) * 100
          : 0,
      },
    };
  }

  /** Build ready-to-render HTML for a county HMDA context callout.
   *  Returns '' when data is unavailable. */
  function formatCountyCallout(comparison, countyName) {
    if (!comparison || !comparison.county) return '';
    var c = comparison.county;
    var s = comparison.state;
    var d = comparison.delta;
    var name = countyName || c.name || ('FIPS ' + c.fips);
    var denialDir = d.denial_rate_pp > 0 ? 'higher' : 'lower';
    var loanDir = d.mean_loan_pct > 0 ? 'higher' : 'lower';
    return (
      '<strong>Mortgage credit (' + c.year + '):</strong> ' +
      name + ' had ' + c.originations.toLocaleString() + ' originations ' +
      'at a ' + (c.denial_rate * 100).toFixed(1) + '% denial rate ' +
      '(' + Math.abs(d.denial_rate_pp).toFixed(1) + 'pp ' + denialDir + ' than CO statewide ' +
      (s.denial_rate * 100).toFixed(1) + '%). ' +
      'Mean loan: $' + (c.mean_loan_amount_usd || 0).toLocaleString() + ' ' +
      '(' + Math.abs(d.mean_loan_pct).toFixed(0) + '% ' + loanDir + ' than state). ' +
      'Multifamily originations: ' + (c.multifamily.originations || 0).toLocaleString() +
      ' (LIHTC-adjacent).'
    );
  }

  window.HmdaLookup = {
    init: init,
    getCounty: getCounty,
    getCountyTrend: getCountyTrend,
    getStateLatest: getStateLatest,
    getCountyVsState: getCountyVsState,
    formatCountyCallout: formatCountyCallout,
  };
})();
