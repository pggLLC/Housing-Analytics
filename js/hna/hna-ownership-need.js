/**
 * js/hna/hna-ownership-need.js
 * Affordable Ownership Need screening calculations.
 *
 * Pure functions only: no DOM reads, no fetches. Callers pass parsed CHAS,
 * AMI-gap, and home-value records.
 */
(function () {
  'use strict';

  var BANDS = ['lte30', '31to50', '51to80', '81to100', '100plus'];
  var MODERATE_BANDS = ['51to80', '81to100'];

  var CONSTANTS = {
    thresholdEvidence: {
      source: 'data/hna/chas_affordability_gap.json county distribution, computed 2026-07-06',
      renterCb30Quartiles: [0.3451, 0.4152, 0.4726],
      renterCb50Quartiles: [0.1511, 0.2108, 0.2442],
      renterShareQuartiles: [0.2353, 0.2829, 0.3194],
      ownerCb30Quartiles: [0.1875, 0.2129, 0.2459],
      ownerCb50Quartiles: [0.0777, 0.0874, 0.1],
      moderateOwnerCbShareQuartiles: [0.1782, 0.2875, 0.3634],
      moderateRenterCountQuartiles: [190, 525.5, 1415],
      moderateRenterShareQuartiles: [0.2965, 0.3298, 0.3551],
      deepRenterSevereQuartiles: [0.442, 0.5691, 0.7369],
    },
    rentalPressure: {
      renterCb30Share: [0.35, 0.42, 0.47],
      renterCb50Share: [0.15, 0.21, 0.24],
      renterShare: [0.24, 0.28, 0.32],
    },
    ownershipPressure: {
      ownerCb30Share: [0.19, 0.21, 0.25],
      ownerCb50Share: [0.08, 0.09, 0.10],
      moderateOwnerCbShare: [0.18, 0.29, 0.36],
    },
    ownershipFit: {
      moderateRenterHouseholds: [200, 500, 1400],
      moderateRenterShare: [0.30, 0.33, 0.36],
    },
    deepAffordability: {
      lte30RenterCb50ShareHigh: 0.57,
    },
    affordabilityAssumptions: {
      pmms30YearRate: 0.0643,
      pmmsDate: '2026-07-02',
      pmmsSource: 'Freddie Mac PMMS 30-year fixed-rate mortgage',
      termYears: 30,
      frontEndRatio: 0.30,
      downPaymentRate: 0.05,
      propertyTaxRate: 0.0055,
      insuranceRate: 0.0040,
      pmiRate: 0.0060,
    },
  };

  var SCREENING_CAVEAT = 'Screening estimate only; verify local prices, financing assumptions, assistance programs, household size, and local deed-restriction policy before using this for a project decision.';

  function num(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function cleanNumber(value) {
    var n = num(value);
    return n == null ? 0 : n;
  }

  function safeDiv(n, d) {
    n = num(n);
    d = num(d);
    if (n == null || d == null || d === 0) return 0;
    return n / d;
  }

  function round(value, digits) {
    var n = num(value);
    if (n == null) return null;
    var m = Math.pow(10, digits == null ? 1 : digits);
    return Math.round(n * m) / m;
  }

  function sumBands(map, bands, field) {
    map = map || {};
    return (bands || BANDS).reduce(function (sum, band) {
      return sum + cleanNumber(map[band] && map[band][field]);
    }, 0);
  }

  function hasAllBands(map) {
    return !!map && BANDS.every(function (band) {
      return map[band] && num(map[band].total) != null;
    });
  }

  function componentLevel(value, cuts) {
    value = num(value);
    if (value == null) return 0;
    if (value >= cuts[2]) return 3;
    if (value >= cuts[1]) return 2;
    if (value >= cuts[0]) return 1;
    return 0;
  }

  function tierFromScore(score) {
    score = num(score);
    if (score == null) return null;
    if (score >= 2.5) return 'Very High';
    if (score >= 1.75) return 'High';
    if (score >= 0.75) return 'Moderate';
    return 'Low';
  }

  function tierRank(tier) {
    return { Low: 0, Moderate: 1, High: 2, 'Very High': 3 }[tier] == null
      ? -1
      : { Low: 0, Moderate: 1, High: 2, 'Very High': 3 }[tier];
  }

  function capTier(tier, maxTier) {
    return tierRank(tier) > tierRank(maxTier) ? maxTier : tier;
  }

  function sourceLabel(geoLevel, countyFallback) {
    if (countyFallback) return 'county-CHAS fallback';
    return geoLevel === 'county' ? 'county-CHAS' : 'place-CHAS';
  }

  function normalizeChas(input) {
    input = input || {};
    var entry = input.placeChasEntry || input.countyChasEntry || input.chasEntry || null;
    var geoLevel = input.geoLevel || (input.placeChasEntry ? 'place' : input.countyChasEntry ? 'county' : null);
    if (!entry) return null;
    var summary = entry.summary || {};
    var renterBands = entry.renter_hh_by_ami || {};
    var ownerBands = entry.owner_hh_by_ami || {};
    var renterHouseholds = num(summary.total_renter_hh);
    var ownerHouseholds = num(summary.total_owner_hh);
    if (renterHouseholds == null) renterHouseholds = num(entry.total_renter_hh);
    if (ownerHouseholds == null) ownerHouseholds = num(entry.total_owner_hh);
    if (renterHouseholds == null) renterHouseholds = sumBands(renterBands, BANDS, 'total');
    if (ownerHouseholds == null) ownerHouseholds = sumBands(ownerBands, BANDS, 'total');

    var renterCostBurdened = num(summary.renter_cb30_count);
    var ownerCostBurdened = num(summary.owner_cb30_count);
    var severeRenterCostBurdened = num(summary.renter_cb50_count);
    var severeOwnerCostBurdened = num(summary.owner_cb50_count);
    if (renterCostBurdened == null) renterCostBurdened = num(entry.renter_cb30_count);
    if (ownerCostBurdened == null) ownerCostBurdened = num(entry.owner_cb30_count);
    if (severeRenterCostBurdened == null) severeRenterCostBurdened = num(entry.renter_cb50_count);
    if (severeOwnerCostBurdened == null) severeOwnerCostBurdened = num(entry.owner_cb50_count);
    if (renterCostBurdened == null) renterCostBurdened = sumBands(renterBands, BANDS, 'cost_burdened_30pct');
    if (ownerCostBurdened == null) ownerCostBurdened = sumBands(ownerBands, BANDS, 'cost_burdened_30pct');
    if (severeRenterCostBurdened == null) severeRenterCostBurdened = sumBands(renterBands, BANDS, 'cost_burdened_50pct');
    if (severeOwnerCostBurdened == null) severeOwnerCostBurdened = sumBands(ownerBands, BANDS, 'cost_burdened_50pct');

    return {
      entry: entry,
      geographyId: input.geographyId || entry.geoid || entry.fips || entry.place_geoid || null,
      geographyName: input.geographyName || entry.name || entry.place_name || entry.county_name || '',
      geoLevel: geoLevel || 'place',
      countyFallback: !!input.countyFallback,
      source: sourceLabel(geoLevel || 'place', !!input.countyFallback),
      renterBands: renterBands,
      ownerBands: ownerBands,
      renterHouseholds: renterHouseholds || 0,
      ownerHouseholds: ownerHouseholds || 0,
      renterCostBurdened: renterCostBurdened || 0,
      ownerCostBurdened: ownerCostBurdened || 0,
      severeRenterCostBurdened: severeRenterCostBurdened || 0,
      severeOwnerCostBurdened: severeOwnerCostBurdened || 0,
    };
  }

  function dataQuality(chas, caveats) {
    if (!chas) return 'Unavailable';
    var hasSummary = !!(chas.entry.summary || chas.entry.total_owner_hh != null || chas.entry.total_renter_hh != null);
    var hasRenterBands = hasAllBands(chas.renterBands);
    var hasOwnerBands = hasAllBands(chas.ownerBands);
    var quality = hasSummary && hasRenterBands && hasOwnerBands ? 'High'
      : hasSummary ? 'Medium'
      : 'Low';
    if (chas.entry.low_confidence || chas.entry.acs_anchor) quality = quality === 'High' ? 'Medium' : quality;
    if (chas.countyFallback) quality = 'Low';
    if (chas.entry.low_confidence) caveats.push('Place-CHAS coverage is marked low confidence; treat this as a screening estimate.');
    if (chas.entry.acs_anchor) caveats.push('Place household counts were capped to ACS occupied units to avoid apportionment overcount.');
    if (!hasOwnerBands || !hasRenterBands) caveats.push('AMI band detail is partial; ownership-fit indicators are less complete.');
    return quality;
  }

  function monthlyMortgageFactor(annualRate, years) {
    var r = annualRate / 12;
    var n = years * 12;
    if (!r) return 1 / n;
    return r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  }

  function maxAffordablePrice(ami4Person, amiPct, assumptions) {
    assumptions = assumptions || CONSTANTS.affordabilityAssumptions;
    var income = cleanNumber(ami4Person) * amiPct;
    if (!income) return null;
    var monthlyBudget = income * assumptions.frontEndRatio / 12;
    var loanShare = 1 - assumptions.downPaymentRate;
    var mortgageFactor = monthlyMortgageFactor(assumptions.pmms30YearRate, assumptions.termYears);
    var monthlyCostPerDollar = (loanShare * mortgageFactor) +
      ((assumptions.propertyTaxRate + assumptions.insuranceRate) / 12) +
      (loanShare * assumptions.pmiRate / 12);
    return round(monthlyBudget / monthlyCostPerDollar, 0);
  }

  function isFlaggedHomeValue(homeValueEntry) {
    if (!homeValueEntry) return false;
    if (homeValueEntry.suppress_income_to_own) return true;
    if (Array.isArray(homeValueEntry.review_flags) && homeValueEntry.review_flags.length) return true;
    if (homeValueEntry.review_flags && typeof homeValueEntry.review_flags === 'object' && Object.keys(homeValueEntry.review_flags).length) return true;
    return false;
  }

  function affordabilityTest(amiGapEntry, homeValueEntry) {
    var ami = num(amiGapEntry && amiGapEntry.ami_4person);
    var price = num(homeValueEntry && (homeValueEntry.value != null ? homeValueEntry.value : homeValueEntry.median_home_value));
    if (!ami || !price || isFlaggedHomeValue(homeValueEntry)) return null;
    var max80 = maxAffordablePrice(ami, 0.80);
    var max100 = maxAffordablePrice(ami, 1.00);
    var classification = price <= max80 ? 'market-attainable'
      : price <= max100 ? 'stretch'
      : 'priced-out';
    return {
      classification: classification,
      medianHomeValue: price,
      maxPriceAt80Ami: max80,
      maxPriceAt100Ami: max100,
      ami4Person: ami,
      assumptions: Object.assign({}, CONSTANTS.affordabilityAssumptions),
      source: homeValueEntry.source || homeValueEntry.sourceLabel || 'home-value input',
      method: 'MODELED',
    };
  }

  function rentalGap(amiGapEntry, geoLevel) {
    var gaps = amiGapEntry && amiGapEntry.gap_units_minus_households_le_ami_pct;
    if (!gaps) return null;
    var raw = num(gaps['80'] != null ? gaps['80'] : gaps[80]);
    if (raw == null) return null;
    return geoLevel === 'county' ? Math.max(0, -raw) : Math.max(0, raw);
  }

  function unavailable(input) {
    var name = input && (input.geographyName || (input.placeChasEntry && input.placeChasEntry.name) || (input.countyChasEntry && input.countyChasEntry.name)) || '';
    return {
      geographyId: input && input.geographyId || null,
      geographyName: name,
      geoLevel: input && input.geoLevel || null,
      renterHouseholds: 0,
      ownerHouseholds: 0,
      renterCostBurdened: 0,
      ownerCostBurdened: 0,
      severeRenterCostBurdened: 0,
      severeOwnerCostBurdened: 0,
      moderateIncomeRenterHouseholds: 0,
      moderateIncomeOwnerCostBurdened: 0,
      rentalPressure: { tier: null, inputs: {} },
      ownershipPressure: { tier: null, inputs: {} },
      ownershipFit: { tier: null, inputs: {} },
      affordabilityTest: null,
      tenureMixRecommendation: 'Insufficient data - verify locally',
      recommendationDetail: 'Ownership data unavailable for this geography.',
      existingRentalGap: null,
      dataQuality: 'Unavailable',
      caveats: [SCREENING_CAVEAT, 'Ownership data unavailable for this geography.'],
    };
  }

  function computeOwnershipNeed(input) {
    input = input || {};
    var caveats = [SCREENING_CAVEAT];
    var chas = normalizeChas(input);
    if (!chas || (!chas.renterHouseholds && !chas.ownerHouseholds)) return unavailable(input);

    var renterShare = safeDiv(chas.renterHouseholds, chas.renterHouseholds + chas.ownerHouseholds);
    var renterCb30Share = safeDiv(chas.renterCostBurdened, chas.renterHouseholds);
    var renterCb50Share = safeDiv(chas.severeRenterCostBurdened, chas.renterHouseholds);
    var ownerCb30Share = safeDiv(chas.ownerCostBurdened, chas.ownerHouseholds);
    var ownerCb50Share = safeDiv(chas.severeOwnerCostBurdened, chas.ownerHouseholds);
    var moderateIncomeRenterHouseholds = sumBands(chas.renterBands, MODERATE_BANDS, 'total');
    var moderateIncomeOwnerCostBurdened = sumBands(chas.ownerBands, MODERATE_BANDS, 'cost_burdened_30pct');
    var moderateOwnerTotal = sumBands(chas.ownerBands, MODERATE_BANDS, 'total');
    var moderateOwnerCbShare = safeDiv(moderateIncomeOwnerCostBurdened, moderateOwnerTotal);
    var moderateRenterShare = safeDiv(moderateIncomeRenterHouseholds, chas.renterHouseholds);
    var lte30 = chas.renterBands.lte30 || {};
    var deepRenterSevereShare = num(lte30.pct_cost_burdened_50);
    if (deepRenterSevereShare == null) deepRenterSevereShare = safeDiv(lte30.cost_burdened_50pct, lte30.total);

    var rentalInputs = {
      renterCostBurdenedShare: round(renterCb30Share, 4),
      severeRenterCostBurdenedShare: round(renterCb50Share, 4),
      renterShareOfHouseholds: round(renterShare, 4),
      renterCostBurdenedCount: round(chas.renterCostBurdened, 1),
      severeRenterCostBurdenedCount: round(chas.severeRenterCostBurdened, 1),
      source: chas.source,
    };
    var rentalScore = (
      componentLevel(renterCb30Share, CONSTANTS.rentalPressure.renterCb30Share) +
      componentLevel(renterCb50Share, CONSTANTS.rentalPressure.renterCb50Share) +
      componentLevel(renterShare, CONSTANTS.rentalPressure.renterShare)
    ) / 3;

    var ownershipInputs = {
      ownerCostBurdenedShare: round(ownerCb30Share, 4),
      severeOwnerCostBurdenedShare: round(ownerCb50Share, 4),
      moderateIncomeOwnerCostBurdenedShare: round(moderateOwnerCbShare, 4),
      ownerCostBurdenedCount: round(chas.ownerCostBurdened, 1),
      severeOwnerCostBurdenedCount: round(chas.severeOwnerCostBurdened, 1),
      moderateIncomeOwnerCostBurdened: round(moderateIncomeOwnerCostBurdened, 1),
      source: chas.source,
    };
    var ownershipScore = (
      componentLevel(ownerCb30Share, CONSTANTS.ownershipPressure.ownerCb30Share) +
      componentLevel(ownerCb50Share, CONSTANTS.ownershipPressure.ownerCb50Share) +
      componentLevel(moderateOwnerCbShare, CONSTANTS.ownershipPressure.moderateOwnerCbShare)
    ) / 3;

    var fitScore = (
      componentLevel(moderateIncomeRenterHouseholds, CONSTANTS.ownershipFit.moderateRenterHouseholds) +
      componentLevel(moderateRenterShare, CONSTANTS.ownershipFit.moderateRenterShare)
    ) / 2;
    var fitTier = tierFromScore(fitScore);
    var homeTest = affordabilityTest(input.amiGapEntry, input.homeValueEntry);
    if (homeTest && homeTest.classification === 'market-attainable') {
      fitTier = capTier(fitTier, 'Moderate');
      caveats.push('Market home values screen near modeled attainability; emphasize down-payment assistance and owner stabilization before below-market construction assumptions.');
    } else if (homeTest && homeTest.classification === 'priced-out') {
      fitTier = tierFromScore(Math.min(3, fitScore + 0.75));
      caveats.push('Modeled prices are above the 100% AMI purchase threshold; any ownership strategy would likely need deed restrictions, subsidy, or shared-equity design.');
    } else if (homeTest && homeTest.classification === 'stretch') {
      caveats.push('Modeled home value falls between the 80% and 100% AMI purchase thresholds; verify current listings and carrying costs locally.');
    } else {
      fitTier = capTier(fitTier, 'Moderate');
      caveats.push('Usable home-value input was unavailable or flagged for review; affordability classification omitted.');
    }
    caveats.push('Moderate-income renter households are not evidence of purchase readiness; they only screen for whether an ownership-oriented base may exist.');

    var rentalTier = tierFromScore(rentalScore);
    var ownershipTier = tierFromScore(ownershipScore);
    var rentalHigh = tierRank(rentalTier) >= tierRank('High');
    var ownershipHigh = tierRank(ownershipTier) >= tierRank('High');
    var fitLow = tierRank(fitTier) <= tierRank('Low');
    var fitModerateOrUp = tierRank(fitTier) >= tierRank('Moderate');
    var deepAffordabilityHigh = deepRenterSevereShare >= CONSTANTS.deepAffordability.lte30RenterCb50ShareHigh;

    var recommendation = 'Verify locally';
    if (rentalHigh && ownershipHigh) recommendation = 'Rental + ownership mix';
    else if (rentalHigh && fitLow) recommendation = 'Rental priority';
    else if (ownershipHigh && fitModerateOrUp) recommendation = 'Ownership-supportive strategy';
    else if (deepAffordabilityHigh) recommendation = 'Deep affordability priority';

    var detail = 'Use this as a screening estimate and verify local sales prices, HOA costs, assistance programs, and deed-restriction policy.';
    if (recommendation === 'Rental + ownership mix') {
      detail = 'This may support a mixed strategy: LIHTC rental for lower-income and rent-burdened households, paired with deed-restricted or shared-equity homes for moderate-income households that cannot access market ownership.';
    } else if (recommendation === 'Rental priority') {
      detail = 'Rental pressure is the clearest signal; ownership-oriented strategies should be secondary unless local verification shows a specific moderate-income path.';
    } else if (recommendation === 'Ownership-supportive strategy') {
      detail = 'Owner cost burden and a moderate-income renter base suggest ownership tools may complement rental strategies after local price and assistance checks.';
    } else if (recommendation === 'Deep affordability priority') {
      detail = 'Severe burden among the lowest-income renter households points first to deep rental affordability and supportive subsidy tools.';
    }

    var quality = dataQuality(chas, caveats);
    if (!homeTest && quality === 'High') quality = 'Medium';

    return {
      geographyId: chas.geographyId,
      geographyName: chas.geographyName,
      geoLevel: chas.geoLevel,
      renterHouseholds: round(chas.renterHouseholds, 1),
      ownerHouseholds: round(chas.ownerHouseholds, 1),
      renterCostBurdened: round(chas.renterCostBurdened, 1),
      ownerCostBurdened: round(chas.ownerCostBurdened, 1),
      severeRenterCostBurdened: round(chas.severeRenterCostBurdened, 1),
      severeOwnerCostBurdened: round(chas.severeOwnerCostBurdened, 1),
      moderateIncomeRenterHouseholds: round(moderateIncomeRenterHouseholds, 1),
      moderateIncomeOwnerCostBurdened: round(moderateIncomeOwnerCostBurdened, 1),
      rentalPressure: { tier: rentalTier, inputs: rentalInputs },
      ownershipPressure: { tier: ownershipTier, inputs: ownershipInputs },
      ownershipFit: {
        tier: fitTier,
        inputs: {
          moderateIncomeRenterHouseholds: round(moderateIncomeRenterHouseholds, 1),
          moderateIncomeRenterShare: round(moderateRenterShare, 4),
          affordabilityClassification: homeTest ? homeTest.classification : null,
          source: chas.source,
        },
      },
      affordabilityTest: homeTest,
      tenureMixRecommendation: recommendation,
      recommendationDetail: detail,
      existingRentalGap: rentalGap(input.amiGapEntry, chas.geoLevel),
      dataQuality: quality,
      caveats: caveats,
    };
  }

  window.HNAOwnershipNeed = {
    computeOwnershipNeed: computeOwnershipNeed,
    maxAffordablePrice: maxAffordablePrice,
    monthlyMortgageFactor: monthlyMortgageFactor,
    CONSTANTS: CONSTANTS,
  };
}());
