/**
 * Housing Needs Scorecard: the one computation (closeout ledger P04, 2026-11-12).
 *
 * Moved out of js/hna/hna-renderers.js unchanged, so the HNA pages and the
 * place hub rank places with the same code rather than two matching copies.
 * hna-renderers.js draws the panel and calls this module; nothing here reads
 * the page.
 *
 * Exposes: window.HNANeedScorecard (and module.exports under Node)
 *   MIN_RENTER_HH                         fewest renter households for a place's own shares
 *   components(rec, 'place'|'county')     A, B and D inputs from one CHAS record
 *   distributions(chas, econ, placeChas)  the two sorted peer pools (cached by data stamp)
 *   score(placeRec, countyRec, econRec, dist, isPlace)  the scoring policy
 *   percentile(sorted, value)             share below, ties counted half
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HNANeedScorecard = api;
}(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  /**
   * Housing Needs Scorecard — v2 methodology.
   *
   * Replaces the v1 thresholded 45/30/25 blend (which had arbitrary
   * weights, no owner cost burden, and distorted resort markets) with
   * a transparent **percentile-normalised 4-component composite**.
   * Each PRESENT component contributes its own percentile rank (0–100) and
   * the composite is their mean, so an unmeasured component neither adds nor
   * subtracts. It previously summed four `pct * 25 : 0` terms, which capped a
   * three-component geography at 75 and made absence read as low need.
   *
   * The peer pool is the subject's own geography type: places are ranked
   * against places, counties against counties. Components A, B and D come
   * from the place's own CHAS when it has enough renter households to be
   * stable; C (affordability pressure) is county-keyed with no place
   * equivalent and stays the county's, disclosed in the card.
   *
   *   A. Tenure-Blended Cost Burden  (renter+owner CHAS cb30, weighted by HH counts)
   *   B. Deep Affordability Need     (≤30% AMI share of <100% renters)
   *   C. Affordability Pressure       (home price ÷ HHI — resort-aware)
   *   D. Worst-Case Need              (HUD-aligned: renter cb50 share)
   *
   * Every threshold + weight is documented in the inline methodology
   * disclosure rendered alongside the cards.
   */

  // Cached statewide distributions for percentile lookups. Built lazily on
  // first call and stamped with the CHAS file's generated timestamp so a
  // data refresh invalidates the cache automatically.
  // Minimum renter households before a place's own CHAS shares are trusted.
  // Matches _MIN_RATE_DENOMINATOR in build_ranking_index.py, for the same
  // reason: 197 of the 482 places with place-level CHAS have fewer than 50
  // renter households, and at that size a share of exactly 0.000 or 1.000 is
  // noise, not a finding.
  var SCORECARD_MIN_RENTER_HH = 50;

  // One reader for both CHAS shapes, used for the subject AND for the peer
  // pool. The two files name the same quantities differently, and the county
  // file's `pct_` prefix is a misnomer -- both sides are fractions in 0..1
  // (place medians 0.412 vs county 0.415, checked against the committed data).
  // Reading them in two places would be two chances to get that wrong, and
  // the bug this replaces was a like-for-unlike comparison.
  function _scorecardComponents(rec, shape) {
    if (!rec) return null;
    const s = rec.summary || rec;
    const byAmi = rec.renter_hh_by_ami || {};
    const isPlace = shape === 'place';
    const renterHH = Number(isPlace ? s.total_renter_hh : s.total_renter_hh) || 0;
    const ownerHH  = Number(isPlace ? s.total_owner_hh  : s.total_owner_hh)  || 0;
    const totalHH  = renterHH + ownerHH;
    const cb30Renter = isPlace ? s.renter_cb30_share : s.pct_renter_cb30;
    const cb30Owner  = isPlace ? s.owner_cb30_share  : s.pct_owner_cb30;
    const cb50Renter = isPlace ? s.renter_cb50_share : s.pct_renter_cb50;

    // A — tenure-blended cost burden
    let blendedBurden = null;
    if (totalHH > 0 && cb30Renter != null && cb30Owner != null) {
      blendedBurden = (Number(cb30Renter) * renterHH + Number(cb30Owner) * ownerHH) / totalHH;
    }
    // B — deep-need share (lte30 of the <=100% AMI universe)
    // Every band must be measured: a missing band is not a count of 0, or a
    // missing lowest band reads as a measured 0% deep need (2026-11-04 QA, F7).
    // A reported 0 stays 0.
    const bandTotal = (k) => {
      const v = byAmi[k] && byAmi[k].total;
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const bands = ['lte30', '31to50', '51to80', '81to100'].map(bandTotal);
    const denomB = bands.some((n) => n === null) ? null : bands.reduce((a, b) => a + b, 0);
    const deepNeed = denomB > 0 ? bands[0] / denomB : null;
    // D — worst-case need (severely burdened renters)
    const worstCase = (renterHH > 0 && cb50Renter != null) ? Number(cb50Renter) : null;

    return {
      blendedBurden, deepNeed, worstCase, renterHH,
      cb30Renter: cb30Renter != null ? Number(cb30Renter) : null,
      cb30Owner: cb30Owner != null ? Number(cb30Owner) : null,
    };
  }

  // Cached statewide distributions for percentile lookups. Built lazily on
  // first call and stamped with the CHAS file's generated timestamp so a
  // data refresh invalidates the cache automatically.
  /**
   * The scoring policy as a pure function: which geography the score
   * describes, which pool it is ranked in, and how the components combine.
   *
   * It lives here rather than inline in renderHnaScorecardPanel because a
   * guard cannot call a renderer. The first version of
   * test/need-severity-is-place-level.test.mjs reimplemented these three
   * decisions in the test file, so reverting any of them in the renderer left
   * the test green — a guard agreeing with its own copy of the logic rather
   * than with the shipped one. Three sabotage mutations went undetected
   * before this was extracted.
   */
  function _scorecardScore(subjectPlaceRec, countyRec, econRec, dist, isPlaceSubject) {
    const placeParts = _scorecardComponents(subjectPlaceRec, 'place');
    const usePlace = !!(isPlaceSubject && placeParts
      && placeParts.renterHH >= SCORECARD_MIN_RENTER_HH);
    const parts = usePlace ? placeParts : _scorecardComponents(countyRec, 'county');
    const pool = usePlace ? dist.place : dist.county;

    const affordPressure = (econRec && econRec.affordability_index != null)
      ? Number(econRec.affordability_index) : null;

    const pctA = _percentile(pool.blendedBurden,  parts && parts.blendedBurden);
    const pctB = _percentile(pool.deepNeed,       parts && parts.deepNeed);
    const pctC = _percentile(pool.affordPressure, affordPressure);
    const pctD = _percentile(pool.worstCaseShare, parts && parts.worstCase);

    // Each PRESENT component contributes its own percentile and the composite
    // is their mean. The previous form summed `pct != null ? pct * 25 : 0`, so
    // an unmeasured component silently subtracted up to 25 points and the
    // result read as "low need" rather than "not measured".
    const present = [pctA, pctB, pctC, pctD].filter((p) => p != null);
    const composite = present.length >= 3
      ? Math.round(present.reduce((a, p) => a + p, 0) / present.length * 100)
      : null;

    return {
      // placeParts is returned so the renderer can say WHY a place fell back
      // to its county (too few renter households vs. no place CHAS at all).
      composite, usePlace, parts, placeParts, affordPressure, pool,
      pctA, pctB, pctC, pctD,
      present: present.length,
      nMissing: 4 - present.length,
    };
  }

  var _scorecardDistCache = null;
  function _buildScorecardDistributions(chasData, econData, placeChas) {
    const stamp =
      (chasData && chasData.meta && chasData.meta.generated) +
      '|' +
      (econData && econData.updated) +
      '|' +
      (placeChas && placeChas.meta && placeChas.meta.generated);
    if (_scorecardDistCache && _scorecardDistCache._stamp === stamp) {
      return _scorecardDistCache;
    }
    // Two pools, because a place must be ranked against places. The previous
    // version had ONE pool built from the 64 counties and ranked every
    // subject against it. County figures are averages over their own places,
    // so their spread is narrower than the places' -- ranking a place in it
    // is not a like-for-like comparison. Same defect shape as #1731.
    const empty = () => ({ blendedBurden: [], deepNeed: [], worstCaseShare: [], affordPressure: [] });
    const dist = { county: empty(), place: empty(), _stamp: stamp };
    if (!chasData || !chasData.counties) { _scorecardDistCache = dist; return dist; }

    const push = (pool, c) => {
      if (!c) return;
      if (c.blendedBurden != null) pool.blendedBurden.push(c.blendedBurden);
      if (c.deepNeed != null) pool.deepNeed.push(c.deepNeed);
      if (c.worstCase != null) pool.worstCaseShare.push(c.worstCase);
    };

    Object.values(chasData.counties).forEach(rec => push(dist.county, _scorecardComponents(rec, 'county')));

    // Places enter the pool on the same threshold the subject must clear, so
    // a place is never ranked against rows that would themselves have been
    // rejected as too thin to trust.
    if (placeChas && placeChas.places) {
      Object.values(placeChas.places).forEach(rec => {
        const c = _scorecardComponents(rec, 'place');
        if (c && c.renterHH >= SCORECARD_MIN_RENTER_HH) push(dist.place, c);
      });
    }

    // C — affordability pressure is county-keyed and has no place equivalent,
    // so both pools share it and a place's component C is its county's. That
    // is disclosed in the rendered card rather than left for a reader to
    // infer.
    if (econData && econData.counties) {
      Object.values(econData.counties).forEach(c => {
        if (c && c.affordability_index != null) {
          dist.county.affordPressure.push(Number(c.affordability_index));
          dist.place.affordPressure.push(Number(c.affordability_index));
        }
      });
    }

    ['county', 'place'].forEach(pool => {
      ['blendedBurden', 'deepNeed', 'affordPressure', 'worstCaseShare'].forEach(k => {
        dist[pool][k].sort((a, b) => a - b);
      });
    });
    _scorecardDistCache = dist;
    return dist;
  }

  // Percentile rank of `value` within sortedArr (0..1, ties get 0.5
  // weight). Returns null if data unavailable.
  function _percentile(sortedArr, value) {
    if (!sortedArr || !sortedArr.length || value == null || !Number.isFinite(Number(value))) return null;
    const v = Number(value);
    let below = 0, equal = 0;
    for (let i = 0; i < sortedArr.length; i++) {
      if (sortedArr[i] < v) below++;
      else if (sortedArr[i] === v) equal++;
    }
    return (below + 0.5 * equal) / sortedArr.length;
  }

  return {
    MIN_RENTER_HH: SCORECARD_MIN_RENTER_HH,
    components: _scorecardComponents,
    distributions: _buildScorecardDistributions,
    score: _scorecardScore,
    percentile: _percentile
  };
}));
