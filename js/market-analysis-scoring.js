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

  function scoreMarketTightness(acs) {
    var vac = (acs && acs.vacancy_rate != null) ? acs.vacancy_rate : 0.05;
    var score = Math.max(0, Math.min(100, (1 - vac / 0.12) * 100));
    return Math.round(score);
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
    WEIGHTS: WEIGHTS,
    RISK: RISK,
    scoreDemand: scoreDemand,
    scoreCaptureRisk: scoreCaptureRisk,
    scoreRentPressure: scoreRentPressure,
    scoreMarketTightness: scoreMarketTightness,
    scoreTier: scoreTier
  };
}));
