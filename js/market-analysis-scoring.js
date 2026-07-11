(function (root, factory) {
  'use strict';

  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PMAMarketScoring = factory();
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var AMI_60_PCT = 0.60;
  var MAX_AFFORDABLE_RENT_PCT = 0.30;

  var WEIGHTS = {
    demand:       0.30,
    captureRisk:  0.25,
    rentPressure: 0.15,
    landSupply:   0.15,
    workforce:    0.15
  };

  var RISK = {
    captureHigh:       0.25,
    costBurdenHigh:    0.45,
    rentPressureElev:  1.10
  };

  function scoreDemand(acs) {
    acs = acs || {};
    var cb = acs.cost_burden_rate || 0;
    var scb = acs.severe_cost_burden_rate;
    var pov = acs.poverty_rate;
    var renterShare = acs.total_hh ? acs.renter_hh / acs.total_hh : 0;

    var cbScore = Math.min(100, (cb / 0.55) * 100);
    var scbScore = scb != null ? Math.min(100, (scb / 0.30) * 100) : null;
    var povScore = pov != null ? Math.min(100, (pov / 0.25) * 100) : null;
    var renterScore = Math.min(100, (renterShare / 0.60) * 100);

    var blend = [
      { score: cbScore, weight: 0.45 },
      { score: scbScore, weight: 0.20 },
      { score: povScore, weight: 0.10 },
      { score: renterScore, weight: 0.25 }
    ];
    var available = blend.filter(function (b) { return b.score != null; });
    var weightSum = available.reduce(function (s, b) { return s + b.weight; }, 0);
    if (weightSum <= 0) return 0;
    var weighted = available.reduce(function (s, b) {
      return s + b.score * (b.weight / weightSum);
    }, 0);
    return Math.round(weighted);
  }

  function scoreCaptureRisk(acs, existingUnits, proposedUnits, chasEligible) {
    acs = acs || {};
    existingUnits = existingUnits || 0;
    proposedUnits = proposedUnits || 0;

    var qualRenters;
    var denominatorSource;
    if (chasEligible && chasEligible.value && chasEligible.value > 0) {
      qualRenters = chasEligible.value;
      denominatorSource = 'chas_lihtc_eligible';
    } else {
      qualRenters = acs.renter_hh || 1;
      denominatorSource = acs.renter_hh ? 'acs_total_renter_hh' : 'fallback_1';
    }

    var capture = (existingUnits + proposedUnits) / qualRenters;
    var score = Math.max(0, Math.min(100, (1 - capture / 0.50) * 100));
    return {
      score: Math.round(score),
      capture: capture,
      qualRenters: qualRenters,
      denominatorSource: denominatorSource,
      chasBreakdown: chasEligible && chasEligible.tier_breakdown || null
    };
  }

  /**
   * Estimate LIHTC-eligible renter households (<=80% AMI) inside a PMA buffer.
   *
   * CHAS income tiers are county-wide, while the PMA buffer is tract-scoped.
   * For each county touched by the buffer, scale that county's CHAS tiers by
   * buffer renter HH / county CHAS renter HH. This keeps the income-qualified
   * denominator narrowed to <=80% AMI without accidentally using a whole
   * county's renter pool for a small urban buffer.
   *
   * @param {Object<string,Object>} chasCounties - chasData.counties
   * @param {Array<Object>} bufTracts - buffer tracts with geoid/_bufferShare
   * @param {Object<string,Object>} acsIdx - tract metrics keyed by geoid
   * @returns {{
   *   value: number|null,
   *   tier_breakdown: Object|null,
   *   source: 'chas'|'unavailable',
   *   counties: Array<{fips:string, share:number, lihtc_eligible:number}>
   * }}
   */
  function chasLihtcEligibleRenters(chasCounties, bufTracts, acsIdx) {
    if (!chasCounties || !bufTracts || !bufTracts.length || !acsIdx) {
      return { value: null, tier_breakdown: null, source: 'unavailable', counties: [] };
    }

    var rentersByCounty = {};
    bufTracts.forEach(function (tract) {
      var gid = String(tract && tract.geoid || '');
      if (gid.length < 5) return;
      var metrics = acsIdx[gid];
      var renterHh = metrics && metrics.renter_hh;
      if (typeof renterHh !== 'number' || renterHh <= 0) return;
      var share = (typeof tract._bufferShare === 'number') ? tract._bufferShare : 1;
      if (share <= 0) return;
      var fips = gid.slice(0, 5);
      rentersByCounty[fips] = (rentersByCounty[fips] || 0) + renterHh * share;
    });

    var lihtcEligible = 0;
    var breakdown = { lte30: 0, '31to50': 0, '51to80': 0 };
    var perCounty = [];

    Object.keys(rentersByCounty).forEach(function (fips) {
      var rec = chasCounties[fips];
      var pop = rec && rec.renter_hh_by_ami;
      if (!pop) return;

      var chasCountyTotalRenters = 0;
      ['lte30', '31to50', '51to80', '81to100', '100plus'].forEach(function (tier) {
        var total = pop[tier] && pop[tier].total;
        if (typeof total === 'number' && total > 0) chasCountyTotalRenters += total;
      });
      if (chasCountyTotalRenters <= 0) return;

      // County CHAS is the only income-tier source currently available, so
      // assume the PMA buffer's income mix matches the county's income mix.
      var countyScale = Math.min(1, rentersByCounty[fips] / chasCountyTotalRenters);
      if (countyScale <= 0) return;

      var countyLihtc = 0;
      ['lte30', '31to50', '51to80'].forEach(function (tier) {
        var total = pop[tier] && pop[tier].total;
        if (typeof total !== 'number' || total <= 0) return;
        var apportioned = total * countyScale;
        countyLihtc += apportioned;
        breakdown[tier] += apportioned;
      });

      if (countyLihtc <= 0) return;
      lihtcEligible += countyLihtc;
      perCounty.push({ fips: fips, share: countyScale, lihtc_eligible: Math.round(countyLihtc) });
    });

    if (lihtcEligible <= 0) {
      return { value: null, tier_breakdown: null, source: 'unavailable', counties: [] };
    }

    Object.keys(breakdown).forEach(function (k) { breakdown[k] = Math.round(breakdown[k]); });

    return {
      value: Math.round(lihtcEligible),
      tier_breakdown: breakdown,
      source: 'chas',
      counties: perCounty.sort(function (a, b) { return b.share - a.share; })
    };
  }

  function scoreRentPressure(acs, countyAmi) {
    acs = acs || {};
    if (!countyAmi || countyAmi <= 0) {
      return { score: null, ratio: null, amiUsed: null, amiSource: 'unavailable', unavailable: true };
    }
    var ami60Rent = (countyAmi * AMI_60_PCT * MAX_AFFORDABLE_RENT_PCT) / 12;
    var ratio = acs.median_gross_rent ? acs.median_gross_rent / ami60Rent : 0;
    var score = Math.min(100, Math.max(0, (ratio - 0.70) / (1.50 - 0.70) * 100));
    return { score: Math.round(score), ratio: ratio, amiUsed: countyAmi, amiSource: 'county', unavailable: false };
  }

  // #1163 — the Land/Supply vacancy signal scores RENTAL vacancy (Census HVS
  // convention) against a single 0.10 ceiling. Total ACS vacancy counts
  // seasonal/second homes as vacant, which scored every Colorado resort
  // county 0 (Summit: 63% median tract "vacancy") — an inverted signal in
  // exactly the markets this platform serves. 0.10 is the underwriting-
  // grounded ceiling (10%+ vacancy materially threatens LIHTC lease-up);
  // the old 0.12 survives only in the legacy fallback below for data files
  // that predate the rental-vacancy fields.
  var RENTAL_VACANCY_CEILING = 0.10;
  var LEGACY_TOTAL_VACANCY_CEILING = 0.12;

  function scoreMarketTightnessDetail(acs) {
    var rental = acs ? Number(acs.rental_vacancy_rate) : NaN;
    if (acs && acs.rental_vacancy_rate != null && isFinite(rental)) {
      var score = Math.max(0, Math.min(100, (1 - rental / RENTAL_VACANCY_CEILING) * 100));
      return { score: Math.round(score), basis: 'rental_vacancy' };
    }
    // Legacy fallback (stale tract file without rental_vacancy_rate, or
    // suppressed rental universe): historical behavior verbatim — total
    // vacancy at 0.12, defaulting suppressed input to a neutral 0.05.
    var vac = (acs && acs.vacancy_rate != null) ? acs.vacancy_rate : 0.05;
    var legacy = Math.max(0, Math.min(100, (1 - vac / LEGACY_TOTAL_VACANCY_CEILING) * 100));
    return { score: Math.round(legacy), basis: 'legacy_total_vacancy' };
  }

  function scoreMarketTightness(acs) {
    return scoreMarketTightnessDetail(acs).score;
  }

  // #1171 — STR-distortion disclosure. ACS B25004_002E counts short-term/
  // vacation rental listings as "for rent", so in STR-saturated resort
  // cores rental vacancy reads far above the long-term market (Summit:
  // ~38% of the county rental universe). Flag a buffer as STR-distorted
  // when BOTH hold:
  //   - rental vacancy >= 0.08 (score <= 20 — materially depressed), AND
  //   - total vacancy >= 0.25 (seasonal-dominated market, the STR tell).
  // Calibrated against 2019-2023 county aggregates: flags Summit, Eagle,
  // Pitkin, Gunnison, San Miguel, Archuleta; does NOT flag Denver/Boulder
  // (low both), La Plata (score 27, mixed), Lake/Leadville (rental tight —
  // score not depressed), or a hypothetical soft metro (high rental, low
  // total — genuine oversupply, not STR). Disclosure only; the score is
  // unchanged. Real refinement options tracked in #1171.
  var STR_FLAG_RENTAL_VACANCY_MIN = 0.08;
  var STR_FLAG_TOTAL_VACANCY_MIN = 0.25;

  function isStrDistorted(acs) {
    if (!acs) return false;
    var rental = Number(acs.rental_vacancy_rate);
    var total = Number(acs.vacancy_rate);
    return acs.rental_vacancy_rate != null && isFinite(rental) &&
           acs.vacancy_rate != null && isFinite(total) &&
           rental >= STR_FLAG_RENTAL_VACANCY_MIN &&
           total >= STR_FLAG_TOTAL_VACANCY_MIN;
  }

  function scoreTier(s) {
    if (s >= 80) return { label: 'Strong', color: 'var(--good)' };
    if (s >= 60) return { label: 'Moderate', color: 'var(--accent)' };
    if (s >= 40) return { label: 'Marginal', color: 'var(--warn)' };
    return { label: 'Weak', color: 'var(--bad)' };
  }

  return {
    AMI_60_PCT: AMI_60_PCT,
    MAX_AFFORDABLE_RENT_PCT: MAX_AFFORDABLE_RENT_PCT,
    RENTAL_VACANCY_CEILING: RENTAL_VACANCY_CEILING,
    LEGACY_TOTAL_VACANCY_CEILING: LEGACY_TOTAL_VACANCY_CEILING,
    WEIGHTS: WEIGHTS,
    RISK: RISK,
    scoreDemand: scoreDemand,
    scoreCaptureRisk: scoreCaptureRisk,
    chasLihtcEligibleRenters: chasLihtcEligibleRenters,
    scoreRentPressure: scoreRentPressure,
    scoreMarketTightness: scoreMarketTightness,
    scoreMarketTightnessDetail: scoreMarketTightnessDetail,
    STR_FLAG_RENTAL_VACANCY_MIN: STR_FLAG_RENTAL_VACANCY_MIN,
    STR_FLAG_TOTAL_VACANCY_MIN: STR_FLAG_TOTAL_VACANCY_MIN,
    isStrDistorted: isStrDistorted,
    scoreTier: scoreTier
  };
}));
