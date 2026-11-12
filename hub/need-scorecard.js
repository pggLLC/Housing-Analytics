// The live HNA's Housing Needs Scorecard (v2): four need measures, each ranked against Colorado's places or
// counties, and their mean as a 0-100 composite. The scoring lives inside js/hna/hna-renderers.js in
// Housing-Analytics with no module of its own, so it is copied here as pure functions, line for line in
// what it decides. qa/need-scorecard.test.js runs both copies on every place and county and fails on any
// difference; qa/hna-live-figures.js checks the printed scores against the live page.
(function (global) {
  'use strict';

  // Fewest renter households before a place's own CHAS shares are used (the ranking index's threshold too).
  var MIN_RENTER_HH = 50;

  // A, B and D from one CHAS record. The place and county files name the same shares differently.
  function components(rec, shape) {
    if (!rec) return null;
    var s = rec.summary || rec, byAmi = rec.renter_hh_by_ami || {}, isPlace = shape === 'place';
    var renterHH = Number(s.total_renter_hh) || 0, ownerHH = Number(s.total_owner_hh) || 0, totalHH = renterHH + ownerHH;
    var cb30Renter = isPlace ? s.renter_cb30_share : s.pct_renter_cb30;
    var cb30Owner = isPlace ? s.owner_cb30_share : s.pct_owner_cb30;
    var cb50Renter = isPlace ? s.renter_cb50_share : s.pct_renter_cb50;
    var blendedBurden = null;
    if (totalHH > 0 && cb30Renter != null && cb30Owner != null) blendedBurden = (Number(cb30Renter) * renterHH + Number(cb30Owner) * ownerHH) / totalHH;
    // Every band must be measured: a missing band is not a count of 0, or a missing lowest band reads as a
    // measured 0% deep need (HA #2668, 2026-11-04 QA F7). A reported 0 stays 0.
    var bandTotal = function (k) {
      var v = byAmi[k] && byAmi[k].total;
      if (v === null || v === undefined || v === '') return null;
      var n = Number(v);
      return isFinite(n) && n >= 0 ? n : null;
    };
    var bands = ['lte30', '31to50', '51to80', '81to100'].map(bandTotal);
    var denomB = bands.some(function (n) { return n === null; }) ? null : bands.reduce(function (a, b) { return a + b; }, 0);
    return {
      blendedBurden: blendedBurden,
      deepNeed: denomB > 0 ? bands[0] / denomB : null,
      worstCase: renterHH > 0 && cb50Renter != null ? Number(cb50Renter) : null,
      renterHH: renterHH,
      cb30Renter: cb30Renter != null ? Number(cb30Renter) : null,
      cb30Owner: cb30Owner != null ? Number(cb30Owner) : null
    };
  }

  // Share of the sorted pool below the value, ties counted half. Null without data.
  function percentile(sorted, value) {
    if (!sorted || !sorted.length || value == null || !isFinite(Number(value))) return null;
    var v = Number(value), below = 0, equal = 0;
    for (var i = 0; i < sorted.length; i++) { if (sorted[i] < v) below++; else if (sorted[i] === v) equal++; }
    return (below + 0.5 * equal) / sorted.length;
  }

  // Two pools: places ranked against places, counties against counties. Affordability pressure is county-only.
  function distributions(chasData, econData, placeChas) {
    var empty = function () { return { blendedBurden: [], deepNeed: [], worstCaseShare: [], affordPressure: [] }; };
    var dist = { county: empty(), place: empty() };
    if (!chasData || !chasData.counties) return dist;
    var push = function (pool, c) {
      if (!c) return;
      if (c.blendedBurden != null) pool.blendedBurden.push(c.blendedBurden);
      if (c.deepNeed != null) pool.deepNeed.push(c.deepNeed);
      if (c.worstCase != null) pool.worstCaseShare.push(c.worstCase);
    };
    Object.keys(chasData.counties).forEach(function (k) { push(dist.county, components(chasData.counties[k], 'county')); });
    if (placeChas && placeChas.places) Object.keys(placeChas.places).forEach(function (k) {
      var c = components(placeChas.places[k], 'place');
      if (c && c.renterHH >= MIN_RENTER_HH) push(dist.place, c);
    });
    if (econData && econData.counties) Object.keys(econData.counties).forEach(function (k) {
      var c = econData.counties[k];
      if (c && c.affordability_index != null) { dist.county.affordPressure.push(Number(c.affordability_index)); dist.place.affordPressure.push(Number(c.affordability_index)); }
    });
    ['county', 'place'].forEach(function (p) {
      ['blendedBurden', 'deepNeed', 'affordPressure', 'worstCaseShare'].forEach(function (k) { dist[p][k].sort(function (a, b) { return a - b; }); });
    });
    return dist;
  }

  // The composite is the mean of the components present, and needs at least three.
  function score(placeRec, countyRec, econRec, dist, isPlace) {
    var placeParts = components(placeRec, 'place');
    var usePlace = !!(isPlace && placeParts && placeParts.renterHH >= MIN_RENTER_HH);
    var parts = usePlace ? placeParts : components(countyRec, 'county');
    var pool = usePlace ? dist.place : dist.county;
    var afford = econRec && econRec.affordability_index != null ? Number(econRec.affordability_index) : null;
    var pctA = percentile(pool.blendedBurden, parts && parts.blendedBurden);
    var pctB = percentile(pool.deepNeed, parts && parts.deepNeed);
    var pctC = percentile(pool.affordPressure, afford);
    var pctD = percentile(pool.worstCaseShare, parts && parts.worstCase);
    var present = [pctA, pctB, pctC, pctD].filter(function (p) { return p != null; });
    return {
      composite: present.length >= 3 ? Math.round(present.reduce(function (a, p) { return a + p; }, 0) / present.length * 100) : null,
      usePlace: usePlace, parts: parts, placeParts: placeParts, affordPressure: afford, pool: pool,
      pctA: pctA, pctB: pctB, pctC: pctC, pctD: pctD, present: present.length, nMissing: 4 - present.length
    };
  }

  // The live page's bands, for the composite and each measure's own percentile.
  function band(p100) { return p100 >= 70 ? 'Highest need' : p100 >= 50 ? 'Elevated' : p100 >= 30 ? 'Moderate' : 'Lower'; }

  // Where the public site's own module is loaded (Housing-Analytics js/hna/need-scorecard.js, which the port
  // loads), the hub scores with it, so there is one scorecard; the copy above serves the lab's older pin.
  var HA = global.HNANeedScorecard;
  global.LabNeedScorecard = HA && typeof HA.score === 'function'
    ? { MIN_RENTER_HH: HA.MIN_RENTER_HH, components: HA.components, percentile: HA.percentile, distributions: HA.distributions, score: HA.score, band: band, source: 'js/hna/need-scorecard.js' }
    : { MIN_RENTER_HH: MIN_RENTER_HH, components: components, percentile: percentile, distributions: distributions, score: score, band: band, source: 'lab copy' };
})(typeof window !== 'undefined' ? window : this);
