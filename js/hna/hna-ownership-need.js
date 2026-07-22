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
  var PRICE_BAND_SCREEN_LABEL = 'potential buyer pool (moderate-income renter households) - not committed demand';
  var OWNER_VALUE_BINS = [
    ['B25075_002E', 0, 9999],
    ['B25075_003E', 10000, 14999],
    ['B25075_004E', 15000, 19999],
    ['B25075_005E', 20000, 24999],
    ['B25075_006E', 25000, 29999],
    ['B25075_007E', 30000, 34999],
    ['B25075_008E', 35000, 39999],
    ['B25075_009E', 40000, 49999],
    ['B25075_010E', 50000, 59999],
    ['B25075_011E', 60000, 69999],
    ['B25075_012E', 70000, 79999],
    ['B25075_013E', 80000, 89999],
    ['B25075_014E', 90000, 99999],
    ['B25075_015E', 100000, 124999],
    ['B25075_016E', 125000, 149999],
    ['B25075_017E', 150000, 174999],
    ['B25075_018E', 175000, 199999],
    ['B25075_019E', 200000, 249999],
    ['B25075_020E', 250000, 299999],
    ['B25075_021E', 300000, 399999],
    ['B25075_022E', 400000, 499999],
    ['B25075_023E', 500000, 749999],
    ['B25075_024E', 750000, 999999],
    ['B25075_025E', 1000000, 1499999],
    ['B25075_026E', 1500000, 1999999],
    ['B25075_027E', 2000000, null],
  ];

  var CONSTANTS = {
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
      lte30RenterCb50CountMin: 150,
      lte30RenterCb50TotalHouseholdShareMin: 0.03,
    },
    affordabilityAssumptions: {
      pmms30YearRate: 0.065,
      pmmsDate: 'shared HNA affordability assumptions',
      pmmsSource: 'HNAUtils.AFFORD',
      termYears: 30,
      frontEndRatio: 0.30,
      downPaymentRate: 0.10,
      propertyTaxRate: 0.0065,
      insuranceRate: 0.0035,
      pmiRate: 0.0050,
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
    if (geoLevel === 'state') return 'state-CHAS';
    if (geoLevel === 'combined') return 'combined-CHAS';
    return geoLevel === 'county' ? 'county-CHAS' : 'place-CHAS';
  }

  function ownerValueBandLabel(lower, upper) {
    function fmt(v) {
      if (v >= 1000000) return '$' + (v / 1000000) + 'M';
      return '$' + Math.round(v / 1000) + 'k';
    }
    return upper == null ? fmt(lower) + '+' : fmt(lower) + '-' + fmt(upper);
  }

  function ownerValueSupplySeries(profile, options) {
    profile = profile && profile.acsProfile ? profile.acsProfile : (profile || {});
    options = options || {};
    var total = num(profile.B25075_001E);
    var bands = [];
    var finiteBins = 0;
    var sum = 0;
    OWNER_VALUE_BINS.forEach(function (bin) {
      var value = num(profile[bin[0]]);
      if (value != null) {
        finiteBins += 1;
        sum += value;
      }
      bands.push({
        code: bin[0],
        lower: bin[1],
        upper: bin[2],
        label: ownerValueBandLabel(bin[1], bin[2]),
        ownerOccupiedUnits: value,
      });
    });
    if ((total == null || total <= 0) && sum > 0) total = sum;
    if (!total || !finiteBins || sum <= 0) return null;
    var dataQuality = finiteBins === OWNER_VALUE_BINS.length ? 'High' : 'Medium';
    if (Math.abs(sum - total) > Math.max(25, total * 0.05)) dataQuality = 'Medium';
    return {
      source: 'ACS B25075',
      sourceLabel: 'ACS B25075 owner-occupied units by value',
      asOf: options.asOf || (profile._acsYear ? 'ACS ' + profile._acsYear + ' 5-year' : 'ACS 2020-2024 5-year'),
      dataQuality: dataQuality,
      totalOwnerOccupiedUnits: round(total, 1),
      summedBandUnits: round(sum, 1),
      bands: bands,
    };
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
    var acsAnchorApplied = chas.entry.acs_anchor === true ||
      !!(chas.entry.acs_anchor && chas.entry.acs_anchor.applied === true);
    if (chas.entry.low_confidence || acsAnchorApplied) quality = quality === 'High' ? 'Medium' : quality;
    if (chas.countyFallback) quality = 'Low';
    if (chas.entry.low_confidence) caveats.push('Place-CHAS coverage is marked low confidence; treat this as a screening estimate.');
    if (acsAnchorApplied) caveats.push('Place household counts were capped to ACS occupied units to avoid apportionment overcount.');
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
    assumptions = Object.assign({}, CONSTANTS.affordabilityAssumptions, assumptions || {});
    var income = cleanNumber(ami4Person) * amiPct;
    if (!income) return null;
    var annualRate = assumptions.pmms30YearRate != null ? assumptions.pmms30YearRate : assumptions.rateAnnual;
    var frontEndRatio = assumptions.frontEndRatio != null ? assumptions.frontEndRatio : assumptions.paymentToIncome;
    var downPaymentRate = assumptions.downPaymentRate != null ? assumptions.downPaymentRate : assumptions.downPaymentPct;
    var propertyTaxRate = assumptions.propertyTaxRate != null ? assumptions.propertyTaxRate : assumptions.propertyTaxPctAnnual;
    var insuranceRate = assumptions.insuranceRate != null ? assumptions.insuranceRate : assumptions.insurancePctAnnual;
    var pmiRate = assumptions.pmiRate != null ? assumptions.pmiRate : assumptions.pmiPctAnnual;
    var monthlyBudget = income * frontEndRatio / 12;
    var loanShare = 1 - downPaymentRate;
    var mortgageFactor = monthlyMortgageFactor(annualRate, assumptions.termYears);
    var monthlyCostPerDollar = (loanShare * mortgageFactor) +
      ((propertyTaxRate + insuranceRate) / 12) +
      (loanShare * pmiRate / 12);
    return round(monthlyBudget / monthlyCostPerDollar, 0);
  }

  function isFlaggedHomeValue(homeValueEntry) {
    if (!homeValueEntry) return false;
    if (homeValueEntry.suppress_income_to_own) return true;
    if (Array.isArray(homeValueEntry.review_flags) && homeValueEntry.review_flags.length) return true;
    if (homeValueEntry.review_flags && typeof homeValueEntry.review_flags === 'object' && Object.keys(homeValueEntry.review_flags).length) return true;
    return false;
  }

  function affordabilityTest(amiGapEntry, homeValueEntry, assumptions) {
    var ami = num(amiGapEntry && amiGapEntry.ami_4person);
    var price = num(homeValueEntry && (homeValueEntry.value != null ? homeValueEntry.value : homeValueEntry.median_home_value));
    if (!ami || !price || isFlaggedHomeValue(homeValueEntry)) return null;
    var max80 = maxAffordablePrice(ami, 0.80, assumptions);
    var max100 = maxAffordablePrice(ami, 1.00, assumptions);
    var classification = price <= max80 ? 'market-attainable'
      : price <= max100 ? 'stretch'
      : 'priced-out';
    return {
      classification: classification,
      medianHomeValue: price,
      maxPriceAt80Ami: max80,
      maxPriceAt100Ami: max100,
      ami4Person: ami,
      assumptions: Object.assign({}, CONSTANTS.affordabilityAssumptions, assumptions || {}),
      source: homeValueEntry.source || homeValueEntry.sourceLabel || 'home-value input',
      method: 'MODELED',
    };
  }

  function supplyUnitsInPriceRange(ownerValueSupply, lowerExclusive, upperInclusive) {
    if (!ownerValueSupply || !Array.isArray(ownerValueSupply.bands)) return null;
    var total = 0;
    var found = false;
    ownerValueSupply.bands.forEach(function (band) {
      var units = num(band.ownerOccupiedUnits);
      if (units == null) return;
      var lower = num(band.lower);
      var upper = num(band.upper);
      var overlapsLower = upper == null || upper > lowerExclusive;
      var overlapsUpper = upperInclusive == null || lower == null || lower <= upperInclusive;
      if (overlapsLower && overlapsUpper) {
        total += units;
        found = true;
      }
    });
    return found ? round(total, 1) : null;
  }

  function priceBandDemandScreen(amiGapEntry, ownerValueSupply, chas, assumptions) {
    var ami = num(amiGapEntry && amiGapEntry.ami_4person);
    if (!ami) return null;
    var max80 = maxAffordablePrice(ami, 0.80, assumptions);
    var max100 = maxAffordablePrice(ami, 1.00, assumptions);
    var max120 = maxAffordablePrice(ami, 1.20, assumptions);
    if (!max80 || !max100 || !max120) return null;
    chas = chas || {};
    var renterBands = chas.renterBands || {};
    function renterDemand(bands) {
      return round(sumBands(renterBands, bands, 'total'), 1);
    }
    var rows = [
      {
        key: 'lte80',
        label: 'Up to 80% AMI affordable price',
        amiCeiling: 80,
        lowerPriceExclusive: 0,
        upperPrice: max80,
        demandBands: ['51to80'],
      },
      {
        key: '81to100',
        label: '81-100% AMI affordable price',
        amiCeiling: 100,
        lowerPriceExclusive: max80,
        upperPrice: max100,
        demandBands: ['81to100'],
      },
      {
        key: '101to120',
        label: '101-120% AMI middle-income price',
        amiCeiling: 120,
        lowerPriceExclusive: max100,
        upperPrice: max120,
        demandBands: [],
      },
    ].map(function (row) {
      var potentialBuyerPoolHouseholds = renterDemand(row.demandBands);
      var ownerValueSupplyUnits = supplyUnitsInPriceRange(ownerValueSupply, row.lowerPriceExclusive, row.upperPrice);
      return Object.assign({}, row, {
        priceRange: {
          lowerExclusive: row.lowerPriceExclusive,
          upperInclusive: row.upperPrice,
        },
        maxAffordablePrice: row.upperPrice,
        potentialBuyerPoolHouseholds: potentialBuyerPoolHouseholds,
        ownerValueSupplyUnits: ownerValueSupplyUnits,
        currentGapHouseholds: potentialBuyerPoolHouseholds == null || ownerValueSupplyUnits == null ? null : Math.max(0, round(potentialBuyerPoolHouseholds - ownerValueSupplyUnits, 1)),
        demandSourceBands: row.demandBands.slice(),
      });
    });
    return {
      label: PRICE_BAND_SCREEN_LABEL,
      method: 'CURRENT_SCREEN',
      screeningOnly: true,
      noConversionMultiplierApplied: true,
      totalPotentialBuyerPoolHouseholds: round(sumBands(renterBands, MODERATE_BANDS, 'total'), 1),
      sourceLabel: chas.source || 'CHAS',
      dataQuality: ownerValueSupply ? ownerValueSupply.dataQuality : 'Unavailable',
      caveat: 'Screening estimate only; 101-120% AMI is shown as a middle-income price/supply band, while the CHAS ownership-fit count isolates 51-100% HAMFI renters.',
      rows: rows,
    };
  }

  function rentalGap(amiGapEntry) {
    var gaps = amiGapEntry && amiGapEntry.gap_units_minus_households_le_ami_pct;
    if (!gaps) return null;
    var raw = num(gaps['80'] != null ? gaps['80'] : gaps[80]);
    if (raw == null) return null;
    var source = amiGapEntry.gapSource || amiGapEntry._gapSource || amiGapEntry.sourceFile || null;
    return source === 'county' ? Math.max(0, -raw) : Math.max(0, raw);
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
    var totalHouseholds = chas.renterHouseholds + chas.ownerHouseholds;
    var lte30SevereCount = cleanNumber(lte30.cost_burdened_50pct);
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
    var homeTest = affordabilityTest(input.amiGapEntry, input.homeValueEntry, input.assumptions);
    var ownerValueSupply = input.ownerValueSupply || ownerValueSupplySeries(input.ownerValueSupplyProfile || input.acsProfile || input.profile, {
      asOf: input.ownerValueSupplyAsOf,
    });
    var priceBandScreen = priceBandDemandScreen(input.amiGapEntry, ownerValueSupply, chas, input.assumptions);
    if (homeTest && homeTest.classification === 'market-attainable') {
      fitTier = capTier(fitTier, 'Moderate');
      caveats.push('Market home values screen near modeled attainability; emphasize down-payment assistance and owner stabilization before below-market construction assumptions.');
    } else if (homeTest && homeTest.classification === 'priced-out') {
      fitTier = tierFromScore(Math.min(3, fitScore + 0.75));
      caveats.push('Modeled prices are above the 100% AMI purchase threshold; any ownership strategy would likely need deed restrictions, subsidy, or shared-equity design.');
    } else if (homeTest && homeTest.classification === 'stretch') {
      caveats.push('Modeled home value falls between the 80% and 100% AMI purchase thresholds; verify current listings and carrying costs locally.');
    } else {
      caveats.push('Usable home-value input was unavailable or flagged for review; affordability classification omitted.');
    }
    caveats.push('Moderate-income renter households are not evidence of purchase readiness; they only screen for whether an ownership-oriented base may exist.');

    var rentalTier = tierFromScore(rentalScore);
    var ownershipTier = tierFromScore(ownershipScore);
    var rentalHigh = tierRank(rentalTier) >= tierRank('High');
    var ownershipHigh = tierRank(ownershipTier) >= tierRank('High');
    var fitLow = tierRank(fitTier) <= tierRank('Low');
    var fitModerateOrUp = tierRank(fitTier) >= tierRank('Moderate');
    var deepAffordabilityHigh =
      deepRenterSevereShare >= CONSTANTS.deepAffordability.lte30RenterCb50ShareHigh &&
      lte30SevereCount >= CONSTANTS.deepAffordability.lte30RenterCb50CountMin &&
      safeDiv(lte30SevereCount, totalHouseholds) >= CONSTANTS.deepAffordability.lte30RenterCb50TotalHouseholdShareMin;

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
      ownerValueSupply: ownerValueSupply,
      priceBandScreen: priceBandScreen,
      tenureMixRecommendation: recommendation,
      recommendationDetail: detail,
      existingRentalGap: rentalGap(input.amiGapEntry),
      dataQuality: quality,
      caveats: caveats,
    };
  }

  window.HNAOwnershipNeed = {
    computeOwnershipNeed: computeOwnershipNeed,
    maxAffordablePrice: maxAffordablePrice,
    monthlyMortgageFactor: monthlyMortgageFactor,
    ownerValueSupplySeries: ownerValueSupplySeries,
    priceBandDemandScreen: priceBandDemandScreen,
    PRICE_BAND_SCREEN_LABEL: PRICE_BAND_SCREEN_LABEL,
    OWNER_VALUE_BINS: OWNER_VALUE_BINS,
    CONSTANTS: CONSTANTS,
  };
}());
