/*
  municipal-analysis.js — Municipal sub-county analysis framework for the Housing Needs Assessment.

  Pure-function IIFE implementing county-to-municipal scaling.
  Supports both browser (window.__MunicipalAnalysis) and CommonJS (module.exports).

  Public API:
    __MunicipalAnalysis.calculateMunicipalScaling(countyData, municipalPop, municipalGrowthRate)
    __MunicipalAnalysis.estimateMunicipalHousingStock(countyData, { households, directHousingUnits })
    __MunicipalAnalysis.scaleMunicipalAffordability(countyData, municipalRent, municipalMedianValue)
    __MunicipalAnalysis.projectMunicipalDemographics(countyProjections, municipalBasePop, municipalGrowthRate)
    __MunicipalAnalysis.estimateMunicipalEmployment(countyLEHD, municipalPopShare)
    __MunicipalAnalysis.calculateMunicipalProp123Baseline(countyData, municipalRenterPop, municipalPop)
    __MunicipalAnalysis.getDataConfidence(dataSource, municipalSize)
*/

(function (root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.__MunicipalAnalysis = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Internal constants
  // ---------------------------------------------------------------------------

  /** Minimum population below which INTERPOLATED confidence is downgraded to ESTIMATED. */
  var SMALL_PLACE_THRESHOLD = 2500;

  /** Clamp bounds for the rent adjustment factor. */
  var RENT_ADJ_MIN = 0.5;
  var RENT_ADJ_MAX = 2.0;

  /**
   * AMI tier rent thresholds as fractions of county median rent.
   * Tiers: ≤30%, 31–50%, 51–80%, 81–100%, >100% AMI.
   */
  var AMI_TIER_LABELS = ['≤30% AMI', '31–50% AMI', '51–80% AMI', '81–100% AMI', '>100% AMI'];

  /**
   * Default county-level AMI tier share distribution (share of renter households
   * by tier) when the county data object does not supply explicit tier shares.
   * Derived from Colorado statewide ACS 2022 GRAPI estimates.
   */
  var DEFAULT_AMI_TIER_SHARES = [0.14, 0.19, 0.26, 0.18, 0.23];

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Guard that a value is a finite number, returning a fallback if not.
   * @param {*} v
   * @param {number} fallback
   * @returns {number}
   */
  function _num(v, fallback) {
    var n = Number(v);
    return Number.isFinite(n) ? n : (Number.isFinite(fallback) ? fallback : 0);
  }

  /**
   * Clamp a value between min and max.
   * @param {number} v
   * @param {number} lo
   * @param {number} hi
   * @returns {number}
   */
  function _clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // ---------------------------------------------------------------------------
  // 1. calculateMunicipalScaling
  // ---------------------------------------------------------------------------

  /**
   * Calculates the growth-adjusted population share for a municipality relative
   * to its containing county.
   *
   * Population share at time t:
   *   share(t) = share₀ × exp(relativeLogGrowth × t)
   *
   * where:
   *   share₀           = municipalPop / countyPop
   *   relativeLogGrowth = ln(1 + municipalGrowthRate) − ln(1 + countyGrowthRate)
   *
   * @param {object} countyData         — Must contain { population, growthRate }
   * @param {number} municipalPop       — Municipal base-year population
   * @param {number} municipalGrowthRate — Municipal annualised CAGR (decimal, e.g. 0.02)
   * @returns {{
   *   popShare: number,
   *   relativeLogGrowth: number,
   *   projectedShareAtYear: function(t: number): number,
   *   municipalPop: number,
   *   countyPop: number,
   *   municipalGrowthRate: number,
   *   countyGrowthRate: number
   * }}
   */
  function calculateMunicipalScaling(countyData, municipalPop, municipalGrowthRate) {
    var countyPop  = _num(countyData && countyData.population, 0);
    var countyRate = _num(countyData && countyData.growthRate,  0);
    var mPop       = _num(municipalPop,       0);
    var mRate      = _num(municipalGrowthRate, 0);

    if (countyPop <= 0 || mPop <= 0) {
      return {
        popShare:          0,
        relativeLogGrowth: 0,
        projectedShareAtYear: function () { return 0; },
        municipalPop:       mPop,
        countyPop:          countyPop,
        municipalGrowthRate: mRate,
        countyGrowthRate:   countyRate,
      };
    }

    var share0           = mPop / countyPop;
    var relativeLogGrowth = Math.log(1 + mRate) - Math.log(1 + countyRate);

    function projectedShareAtYear(t) {
      var years = _num(t, 0);
      return share0 * Math.exp(relativeLogGrowth * years);
    }

    return {
      popShare:             share0,
      relativeLogGrowth:    relativeLogGrowth,
      projectedShareAtYear: projectedShareAtYear,
      municipalPop:         mPop,
      countyPop:            countyPop,
      municipalGrowthRate:  mRate,
      countyGrowthRate:     countyRate,
    };
  }

  // ---------------------------------------------------------------------------
  // 2. estimateMunicipalHousingStock
  // ---------------------------------------------------------------------------

  /**
   * Estimates the municipal housing stock by combining the best available inputs.
   *
   * Priority:
   *   1. directHousingUnits (census or local permit record — most reliable)
   *   2. Household-based estimate: households × countyVacancyMultiplier
   *   3. Population share of county stock (fallback)
   *
   * @param {object} countyData                          — Must contain { totalUnits, households, population }
   * @param {{ households?: number, directHousingUnits?: number }} municipalInputs
   * @returns {{
   *   estimatedUnits: number,
   *   vacancyAdjustedUnits: number,
   *   method: 'direct'|'household-ratio'|'population-share',
   *   countyVacancyRate: number
   * }}
   */
  function estimateMunicipalHousingStock(countyData, municipalInputs) {
    var inputs = municipalInputs || {};

    var countyUnits = _num(countyData && countyData.totalUnits,  0);
    var countyHH    = _num(countyData && countyData.households,  0);
    var countyPop   = _num(countyData && countyData.population,  0);

    var direct    = inputs.directHousingUnits != null ? _num(inputs.directHousingUnits, 0) : null;
    var mHH       = inputs.households         != null ? _num(inputs.households, 0)         : null;

    // County-level vacancy rate (units / households − 1), minimum 1.0 multiplier
    var countyVacancyMultiplier = (countyHH > 0 && countyUnits > countyHH)
      ? countyUnits / countyHH
      : 1.05; // default 5 % vacancy buffer
    var countyVacancyRate = countyVacancyMultiplier - 1;

    var estimatedUnits;
    var method;

    if (direct !== null && direct > 0) {
      estimatedUnits = direct;
      method = 'direct';
    } else if (mHH !== null && mHH > 0) {
      estimatedUnits = Math.round(mHH * countyVacancyMultiplier);
      method = 'household-ratio';
    } else {
      // Population share fallback
      var popShare = (countyPop > 0 && countyData && countyData.population > 0 &&
                      countyUnits > 0 && countyPop > 0)
        ? 0
        : 0;
      // Use explicit scaling from countyData if passed via scaling result
      var mPop = _num(inputs.population, 0);
      popShare = (countyPop > 0 && mPop > 0) ? mPop / countyPop : 0;
      estimatedUnits = popShare > 0 ? Math.round(countyUnits * popShare) : 0;
      method = 'population-share';
    }

    // Vacancy-adjusted: units a municipality needs including structural vacancy
    var vacancyAdjustedUnits = Math.round(estimatedUnits * countyVacancyMultiplier);

    return {
      estimatedUnits:      estimatedUnits,
      vacancyAdjustedUnits: vacancyAdjustedUnits,
      method:              method,
      countyVacancyRate:   countyVacancyRate,
    };
  }

  // ---------------------------------------------------------------------------
  // 3. scaleMunicipalAffordability
  // ---------------------------------------------------------------------------

  /**
   * Scales county AMI-tier distribution to a municipality using a rent adjustment
   * factor derived from the ratio of municipal to county median rent.
   *
   * Rent adjustment factor = municipalRent / countyRent, clamped to [0.5, 2.0].
   *
   * Higher-rent municipalities shift households toward higher AMI tiers (fewer
   * cost-burdened); lower-rent municipalities shift toward lower tiers.
   *
   * @param {object} countyData         — Must contain { medianRent, amiTierShares? }
   * @param {number} municipalRent      — Municipal median gross rent ($)
   * @param {number} municipalMedianValue — Municipal median home value ($); used for owner-side notes
   * @returns {{
   *   rentAdjustmentFactor: number,
   *   amiTierShares: number[],
   *   amiTierLabels: string[],
   *   adjustedCountyRent: number,
   *   municipalRent: number,
   *   municipalMedianValue: number
   * }}
   */
  function scaleMunicipalAffordability(countyData, municipalRent, municipalMedianValue) {
    var countyRent   = _num(countyData && countyData.medianRent, 0);
    var mRent        = _num(municipalRent, 0);
    var mValue       = _num(municipalMedianValue, 0);

    // Derive base tier shares from countyData or use defaults
    var baseTierShares = (countyData && Array.isArray(countyData.amiTierShares) &&
                          countyData.amiTierShares.length === 5)
      ? countyData.amiTierShares.slice()
      : DEFAULT_AMI_TIER_SHARES.slice();

    if (countyRent <= 0 || mRent <= 0) {
      return {
        rentAdjustmentFactor: 1,
        amiTierShares:        baseTierShares,
        amiTierLabels:        AMI_TIER_LABELS.slice(),
        adjustedCountyRent:   countyRent,
        municipalRent:        mRent,
        municipalMedianValue: mValue,
      };
    }

    var rawFactor = mRent / countyRent;
    var raf = _clamp(rawFactor, RENT_ADJ_MIN, RENT_ADJ_MAX);

    // Redistribute AMI tiers.
    // When raf > 1 (higher-rent area), shift probability mass toward higher tiers
    // (fewer households qualify at ≤30% AMI, more at >100% AMI).
    // When raf < 1 (lower-rent area), reverse.
    //
    // Method: apply a linear shift weighted by (raf − 1), then re-normalise.
    var weights = [0, 0, 0, 0, 0];
    var n = baseTierShares.length;
    for (var i = 0; i < n; i++) {
      // Tier index i=0 is lowest, i=4 is highest.
      // Shift factor: higher raf means higher tiers gain share.
      var tierWeight = 1 + (raf - 1) * ((i - (n - 1) / 2) / ((n - 1) / 2));
      weights[i] = Math.max(0.01, baseTierShares[i] * tierWeight);
    }
    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var adjustedShares = weights.map(function (w) { return w / total; });

    return {
      rentAdjustmentFactor: raf,
      amiTierShares:        adjustedShares,
      amiTierLabels:        AMI_TIER_LABELS.slice(),
      adjustedCountyRent:   countyRent,
      municipalRent:        mRent,
      municipalMedianValue: mValue,
    };
  }

  // ---------------------------------------------------------------------------
  // 4. projectMunicipalDemographics
  // ---------------------------------------------------------------------------

  /**
   * Projects municipal population and household counts for a series of years by
   * applying the municipality's own growth trajectory while anchoring to the
   * county projection totals via the growth-adjusted population share formula.
   *
   * share(t) = share₀ × exp(relativeLogGrowth × t)
   *
   * @param {Array<{year: number, population: number, households: number}>} countyProjections
   * @param {number} municipalBasePop    — Municipal population at the projection base year
   * @param {number} municipalGrowthRate — Municipal annualised CAGR (decimal)
   * @returns {Array<{
   *   year: number,
   *   population: number,
   *   households: number,
   *   popShare: number
   * }>}
   */
  function projectMunicipalDemographics(countyProjections, municipalBasePop, municipalGrowthRate) {
    if (!Array.isArray(countyProjections) || countyProjections.length === 0) {
      return [];
    }

    var mBasePop  = _num(municipalBasePop,       0);
    var mRate     = _num(municipalGrowthRate,     0);

    if (mBasePop <= 0) return [];

    // Base year is the first entry in the county projections array
    var baseYear    = _num(countyProjections[0].year, 0);
    var baseCoPop   = _num(countyProjections[0].population, 1); // avoid div-by-zero
    var baseCoHH    = _num(countyProjections[0].households, 0);

    var share0           = mBasePop / baseCoPop;
    var countyBaseRate   = 0;
    if (countyProjections.length > 1) {
      var lastYear = _num(countyProjections[countyProjections.length - 1].year, baseYear);
      var lastPop  = _num(countyProjections[countyProjections.length - 1].population, baseCoPop);
      var span     = lastYear - baseYear;
      countyBaseRate = span > 0 ? (Math.pow(lastPop / baseCoPop, 1 / span) - 1) : 0;
    }
    var relativeLogGrowth = Math.log(1 + mRate) - Math.log(1 + countyBaseRate);

    return countyProjections.map(function (entry) {
      var yr     = _num(entry.year, baseYear);
      var t      = yr - baseYear;
      var coPopT = _num(entry.population, baseCoPop);
      var coHHT  = _num(entry.households, baseCoHH);

      var shareT = share0 * Math.exp(relativeLogGrowth * t);
      var mPopT  = Math.round(coPopT * shareT);

      // Scale households proportionally to the county HH/pop ratio
      var coHHRatio = baseCoPop > 0 ? baseCoHH / baseCoPop : 0;
      var mHHT      = Math.round(mPopT * coHHRatio);

      return {
        year:       yr,
        population: mPopT,
        households: mHHT,
        popShare:   shareT,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // 5. estimateMunicipalEmployment
  // ---------------------------------------------------------------------------

  /**
   * Estimates municipal employment totals and industry breakdown by scaling
   * the county LEHD WAC (Workplace Area Characteristics) data by the municipal
   * population share.
   *
   * @param {object} countyLEHD         — LEHD WAC object: { totalJobs, industries }
   * @param {number} municipalPopShare  — Municipality's share of county population (0–1)
   * @returns {{
   *   totalJobs: number,
   *   jobsByIndustry: Array<{ label: string, jobs: number }>,
   *   popShare: number
   * }}
   */
  function estimateMunicipalEmployment(countyLEHD, municipalPopShare) {
    var share      = _clamp(_num(municipalPopShare, 0), 0, 1);
    var countyJobs = _num(countyLEHD && countyLEHD.totalJobs, 0);
    var industries = (countyLEHD && Array.isArray(countyLEHD.industries))
      ? countyLEHD.industries
      : [];

    var totalJobs = Math.round(countyJobs * share);

    var jobsByIndustry = industries.map(function (ind) {
      return {
        label: ind.label || ind.naics || '',
        jobs:  Math.round(_num(ind.jobs || ind.count, 0) * share),
      };
    });

    return {
      totalJobs:      totalJobs,
      jobsByIndustry: jobsByIndustry,
      popShare:       share,
    };
  }

  // ---------------------------------------------------------------------------
  // 6. calculateMunicipalProp123Baseline
  // ---------------------------------------------------------------------------

  /**
   * Calculates a municipality's Prop 123 / HB 22-1093 baseline using the
   * county-level 60% AMI renter-household count scaled by the municipality's
   * share of county renter population.
   *
   * @param {object} countyData       — Must contain { rentals60AMI, totalRenterHH }
   * @param {number} municipalRenterPop — Municipal renter-household population
   * @param {number} municipalPop       — Municipal total population
   * @returns {{
   *   baseline60AMIRentals: number,
   *   renterShare: number,
   *   growthTarget3pct: number,
   *   amiShare: number,
   *   countyRentals60AMI: number
   * }}
   */
  function calculateMunicipalProp123Baseline(countyData, municipalRenterPop, municipalPop) {
    var countyRentals  = _num(countyData && countyData.rentals60AMI,  0);
    var countyRenterHH = _num(countyData && countyData.totalRenterHH, 0);
    var mRenterPop     = _num(municipalRenterPop, 0);
    var mPop           = _num(municipalPop, 0);

    var renterShare = (countyRenterHH > 0 && mRenterPop > 0)
      ? mRenterPop / countyRenterHH
      : 0;

    var baseline60AMIRentals = Math.round(countyRentals * renterShare);

    // 3% annual growth target per Prop 123 requirements
    var growthTarget3pct = Math.round(baseline60AMIRentals * 0.03);

    // Municipal AMI share: fraction of municipal population in 60% AMI renter households
    var amiShare = (mPop > 0 && baseline60AMIRentals > 0)
      ? baseline60AMIRentals / mPop
      : 0;

    return {
      baseline60AMIRentals: baseline60AMIRentals,
      renterShare:          renterShare,
      growthTarget3pct:     growthTarget3pct,
      amiShare:             amiShare,
      countyRentals60AMI:   countyRentals,
    };
  }

  // ---------------------------------------------------------------------------
  // 7. getDataConfidence
  // ---------------------------------------------------------------------------

  /**
   * Returns the data confidence level for a given data source and municipal size.
   *
   * Confidence levels (in order of reliability):
   *   DIRECT      — directly observed data (ACS 5-year, local permit records)
   *   INTERPOLATED — scaled from county data with known scaling factors
   *   ESTIMATED   — derived via general statistical assumptions
   *   UNAVAILABLE — no usable data source
   *
   * Confidence ceiling rule:
   *   If dataSource is 'interpolated' and municipalSize < 2,500, downgrade to ESTIMATED.
   *
   * @param {'direct'|'interpolated'|'estimated'|'unavailable'} dataSource
   * @param {number} municipalSize — Municipal population
   * @returns {'DIRECT'|'INTERPOLATED'|'ESTIMATED'|'UNAVAILABLE'}
   */
  function getDataConfidence(dataSource, municipalSize) {
    var src  = typeof dataSource === 'string' ? dataSource.toLowerCase().trim() : '';
    var size = _num(municipalSize, 0);

    if (src === 'direct') {
      return 'DIRECT';
    }
    if (src === 'interpolated') {
      // Downgrade to ESTIMATED for small places
      return (size < SMALL_PLACE_THRESHOLD) ? 'ESTIMATED' : 'INTERPOLATED';
    }
    if (src === 'estimated') {
      return 'ESTIMATED';
    }
    return 'UNAVAILABLE';
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    calculateMunicipalScaling:        calculateMunicipalScaling,
    estimateMunicipalHousingStock:    estimateMunicipalHousingStock,
    scaleMunicipalAffordability:      scaleMunicipalAffordability,
    projectMunicipalDemographics:     projectMunicipalDemographics,
    estimateMunicipalEmployment:      estimateMunicipalEmployment,
    calculateMunicipalProp123Baseline: calculateMunicipalProp123Baseline,
    getDataConfidence:                getDataConfidence,
  };
}));
