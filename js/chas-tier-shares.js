/**
 * chas-tier-shares.js
 *
 * Browser-side helper that produces RENTER-side AMI tier shares for a
 * given county or place GEOID. Used by chartHouseholdDemand on the
 * Housing Needs Assessment page to apportion projected household growth
 * across AMI tiers using real CHAS Table 7 distributions instead of
 * the statewide heuristics shipped in PR #798.
 *
 * Data sources (in priority order)
 * --------------------------------
 *   1. data/hna/place-chas.json       (TIGER place-level CHAS, PR-C3)
 *      — used when the selection is a place/CDP and TIGER coverage exists
 *   2. data/market/chas_co.json       (county-level CHAS Table 7)
 *      — used when selection is a county OR for places falling back
 *
 * Output shape
 * ------------
 *   {
 *     source: 'place-chas' | 'county-chas' | 'statewide-heuristic',
 *     geoid: '0824950',
 *     name: 'Erie',
 *     totalRenter: 2156,
 *     tiers: [
 *       { key: 'lte30',   label: '≤30% AMI',   share: 0.183, count: 395 },
 *       { key: '31to50',  label: '31-50% AMI', share: 0.142, count: 306 },
 *       { key: '51to80',  label: '51-80% AMI', share: 0.205, count: 442 },
 *       { key: '81to100', label: '81-100% AMI',share: 0.108, count: 233 },
 *       { key: '100plus', label: '>100% AMI',  share: 0.362, count: 780 }
 *     ]
 *   }
 *
 * Public API
 * ----------
 *   window.ChasTierShares.init()
 *   window.ChasTierShares.getRenterShares(geoid, geoType)
 *     — geoType: 'county' | 'place' | 'cdp' | 'state'
 *     — returns the shape above; uses statewide fallback if nothing
 *       else resolves
 */
(function () {
  'use strict';

  var PLACE_CHAS_PATH  = 'hna/place-chas.json';
  var COUNTY_CHAS_PATH = 'market/chas_co.json';
  var TIER_ORDER = [
    { key: 'lte30',   label: '≤30% AMI' },
    { key: '31to50',  label: '31-50% AMI' },
    { key: '51to80',  label: '51-80% AMI' },
    { key: '81to100', label: '81-100% AMI' },
    { key: '100plus', label: '>100% AMI' },
  ];

  // Statewide-CO fallback shares (computed once from chas_co.json
  // statewide totals; safe baseline when no other data resolves).
  var STATEWIDE_HEURISTIC = {
    source: 'statewide-heuristic',
    geoid: '08',
    name: 'Colorado',
    totalRenter: 0,
    tiers: [
      { key: 'lte30',   label: '≤30% AMI',   share: 0.20, count: 0 },
      { key: '31to50',  label: '31-50% AMI',     share: 0.16, count: 0 },
      { key: '51to80',  label: '51-80% AMI',     share: 0.20, count: 0 },
      { key: '81to100', label: '81-100% AMI',    share: 0.11, count: 0 },
      { key: '100plus', label: '>100% AMI',      share: 0.33, count: 0 },
    ],
  };

  var _placeData = null;
  var _countyData = null;
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
    if (_placeData && _countyData) return Promise.resolve();
    if (_loadPromise) return _loadPromise;
    _loadPromise = Promise.all([
      _fetchJson(_resolveDataUrl(PLACE_CHAS_PATH)).catch(function () { return { places: {} }; }),
      _fetchJson(_resolveDataUrl(COUNTY_CHAS_PATH)).catch(function () { return { records: [] }; }),
    ]).then(function (results) {
      _placeData = results[0] || { places: {} };
      _countyData = results[1] || { records: [] };
    });
    return _loadPromise;
  }

  function _normGeoid(geoid) {
    return String(geoid || '').replace(/[^0-9]/g, '');
  }

  function _placeRenterShares(geoid) {
    var rec = _placeData && _placeData.places && _placeData.places[geoid];
    if (!rec || !rec.renter_hh_by_ami) return null;
    var total = 0;
    var tiers = TIER_ORDER.map(function (tier) {
      var td = rec.renter_hh_by_ami[tier.key] || {};
      var count = Number(td.total) || 0;
      total += count;
      return { key: tier.key, label: tier.label, count: count };
    });
    if (!total) return null;
    tiers.forEach(function (t) { t.share = t.count / total; });
    return {
      source: 'place-chas',
      geoid: geoid,
      name: rec.name || geoid,
      totalRenter: total,
      tiers: tiers,
    };
  }

  function _countyRenterShares(countyFips5) {
    var rec = (_countyData && _countyData.records || []).find(function (r) {
      return r.fips === countyFips5;
    });
    if (!rec || !rec.renter_hh_by_ami) return null;
    var total = 0;
    var tiers = TIER_ORDER.map(function (tier) {
      var td = rec.renter_hh_by_ami[tier.key] || {};
      var count = Number(td.total) || 0;
      total += count;
      return { key: tier.key, label: tier.label, count: count };
    });
    if (!total) return null;
    tiers.forEach(function (t) { t.share = t.count / total; });
    return {
      source: 'county-chas',
      geoid: countyFips5,
      name: rec.name || countyFips5,
      totalRenter: total,
      tiers: tiers,
    };
  }

  /** Return renter-side AMI tier shares for a geography.
   *  Tries place CHAS first, falls back to county CHAS, then statewide. */
  function getRenterShares(geoid, geoType) {
    if (!_placeData || !_countyData) return STATEWIDE_HEURISTIC;
    var g = _normGeoid(geoid);
    // place / cdp → try place-CHAS first (TIGER-aggregated)
    if (g.length === 7 && (geoType === 'place' || geoType === 'cdp')) {
      var placeRec = _placeRenterShares(g);
      if (placeRec) return placeRec;
      // Fall back to containing county (first 5 digits could be place FIPS;
      // need the county-FIPS lookup. Place GEOID format is state(2)+place(5),
      // not county-prefixed, so we can't derive county from geoid alone.
      // Caller should pass countyFips5 separately via geoType extension; for
      // now, fall back to statewide.)
    }
    // county → 5-digit FIPS
    if (g.length === 5 || geoType === 'county') {
      var countyFips = g.length === 5 ? g : g.slice(0, 5);
      var countyRec = _countyRenterShares(countyFips);
      if (countyRec) return countyRec;
    }
    return STATEWIDE_HEURISTIC;
  }

  /** Variant that accepts an explicit containing-county FIPS to use as
   *  fallback when the primary geoid resolution fails (useful for places
   *  whose TIGER aggregate is missing). */
  function getRenterSharesWithFallback(geoid, geoType, containingCountyFips5) {
    var primary = getRenterShares(geoid, geoType);
    if (primary.source !== 'statewide-heuristic') return primary;
    if (containingCountyFips5) {
      var countyRec = _countyRenterShares(containingCountyFips5);
      if (countyRec) return countyRec;
    }
    return primary;
  }

  window.ChasTierShares = {
    init: init,
    getRenterShares: getRenterShares,
    getRenterSharesWithFallback: getRenterSharesWithFallback,
    TIER_ORDER: TIER_ORDER,
    STATEWIDE_HEURISTIC: STATEWIDE_HEURISTIC,
  };
})();
