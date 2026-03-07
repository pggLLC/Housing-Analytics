/*
  municipal-analysis.js — Sub-county municipal analysis functions for HNA
  =========================================================================
  Provides calculation helpers for scaling county-level ACS / DOLA data down
  to individual Colorado municipality / Census-Designated-Place (CDP) context.

  All functions are pure (no DOM side-effects) so they can be unit-tested
  in Node.js directly.  The module exposes a single namespace object:
    window.MunicipalAnalysis

  Data confidence levels (returned by getDataConfidence):
    DIRECT       – Direct Census place-level data  (confidence ≈ 100 %)
    INTERPOLATED – County data scaled by municipal characteristics (≈ 80 %)
    ESTIMATED    – Extrapolated from county trends + market indicators (≈ 60 %)
    UNAVAILABLE  – No data available                                   (  0 %)

  References
  ----------
  - ACS 5-year DP04, DP05, DP02, S0801
  - DOLA SDO county components-of-change forecasts
  - LEHD LODES WAC (Workplace Area Characteristics)
  - HB 22-1093 / Prop 123 thresholds (HB22-1093)
*/

(function () {
  'use strict';

  // ── Confidence level constants ────────────────────────────────────────────
  var CONFIDENCE = {
    DIRECT:       { label: 'Direct',       score: 100, cssClass: 'confidence-direct' },
    INTERPOLATED: { label: 'Interpolated', score: 80,  cssClass: 'confidence-interpolated' },
    ESTIMATED:    { label: 'Estimated',    score: 60,  cssClass: 'confidence-estimated' },
    UNAVAILABLE:  { label: 'Unavailable',  score: 0,   cssClass: 'confidence-unavailable' },
  };

  // ── Prop 123 / HB 22-1093 thresholds (mirror housing-needs-assessment.js) ─
  var PROP123_MUNICIPALITY_THRESHOLD = 1000;   // minimum population to opt-in
  var PROP123_GROWTH_RATE            = 0.03;   // 3 % annual growth target

  // ── Utility helpers ───────────────────────────────────────────────────────

  /**
   * Safely coerce a value to a finite number; returns 0 on failure.
   * @param {*} v
   * @returns {number}
   */
  function safeNum(v) {
    var n = Number(v);
    return (isFinite(n) && !isNaN(n)) ? n : 0;
  }

  /**
   * Clamp a number between lo and hi.
   * @param {number} v
   * @param {number} lo
   * @param {number} hi
   * @returns {number}
   */
  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  // ── 1. Municipal Population & Household Scaling ──────────────────────────

  /**
   * Calculate the basic scaling factors that convert county-level metrics to
   * municipal estimates.
   *
   * @param {object} countyData
   *   @param {number} countyData.population       County total population
   *   @param {number} countyData.households        County total households
   *   @param {number} countyData.vacancyRate       County vacancy rate  (0–1)
   *   @param {number} [countyData.populationGrowthRate]  County 5-yr CAGR (0–1)
   * @param {number} municipalPopulation  Census place population (ACS 5-yr)
   * @param {number} [municipalGrowthRate]  Municipal 5-yr CAGR (0–1); optional
   * @returns {{
   *   popShare: number,
   *   adjustedShare: number,
   *   households: number,
   *   headshipRate: number,
   *   confidence: object
   * }}
   */
  function calculateMunicipalScaling(countyData, municipalPopulation, municipalGrowthRate) {
    var countyPop  = safeNum(countyData && countyData.population);
    var countyHH   = safeNum(countyData && countyData.households);
    var countyVac  = safeNum(countyData && countyData.vacancyRate);
    var countyGR   = safeNum(countyData && countyData.populationGrowthRate);
    var muniPop    = safeNum(municipalPopulation);
    var muniGR     = (municipalGrowthRate !== undefined && municipalGrowthRate !== null)
                       ? safeNum(municipalGrowthRate)
                       : null;

    if (!countyPop || !muniPop) {
      return {
        popShare:      0,
        adjustedShare: 0,
        households:    0,
        headshipRate:  0,
        confidence:    CONFIDENCE.UNAVAILABLE,
      };
    }

    var popShare = clamp(muniPop / countyPop, 0.0001, 0.999);

    // Growth-adjusted share: if the municipality has grown faster / slower
    // than the county, adjust the share forward one year.
    var adjustedShare = popShare;
    if (muniGR !== null && Number.isFinite(muniGR) && countyGR) {
      var relativeGR = (1 + muniGR) / (1 + countyGR);
      adjustedShare = clamp(popShare * relativeGR, 0.0001, 0.999);
    }

    var countyHeadshipRate = countyHH && countyPop ? (countyHH / countyPop) : 0.42;
    var households = Math.round(muniPop * countyHeadshipRate);

    var confidence = (muniGR !== null) ? CONFIDENCE.INTERPOLATED : CONFIDENCE.ESTIMATED;

    return {
      popShare:      popShare,
      adjustedShare: adjustedShare,
      households:    households,
      headshipRate:  countyHeadshipRate,
      confidence:    confidence,
    };
  }

  // ── 2. Municipal Housing Stock Decomposition ─────────────────────────────

  /**
   * Estimate the municipal housing stock decomposed by structure type and
   * tenure, using county proportions and vacancy rate.
   *
   * @param {object} countyData
   *   @param {number} countyData.vacancyRate        0–1
   *   @param {number} [countyData.renterRate]       0–1  (fraction of HH that rent)
   *   @param {object} [countyData.structureTypes]   { singleFamily:0–1, multifamily:0–1, mobile:0–1 }
   * @param {object} municipalData
   *   @param {number} municipalData.households  Estimated municipal households
   *   @param {number} [municipalData.directHousingUnits]   Direct Census figure if available
   * @returns {{
   *   totalUnits: number,
   *   ownerUnits: number,
   *   renterUnits: number,
   *   structureBreakdown: object,
   *   confidence: object
   * }}
   */
  function estimateMunicipalHousingStock(countyData, municipalData) {
    var vacancyRate = safeNum(countyData && countyData.vacancyRate);
    var renterRate  = safeNum(countyData && countyData.renterRate) || 0.35;
    var structures  = (countyData && countyData.structureTypes) || {
      singleFamily: 0.65,
      multifamily:  0.28,
      mobile:       0.07,
    };

    var muniHH     = safeNum(municipalData && municipalData.households);
    var directUnits = (municipalData && municipalData.directHousingUnits)
                        ? safeNum(municipalData.directHousingUnits)
                        : 0;

    var effectiveVacancy = clamp(vacancyRate, 0.01, 0.30);
    var totalUnits = directUnits > 0
      ? directUnits
      : (muniHH > 0 ? Math.round(muniHH / (1 - effectiveVacancy)) : 0);

    var renterUnits = Math.round(totalUnits * renterRate);
    var ownerUnits  = totalUnits - renterUnits;

    var structureBreakdown = {};
    Object.keys(structures).forEach(function (k) {
      structureBreakdown[k] = Math.round(totalUnits * safeNum(structures[k]));
    });

    var confidence = directUnits > 0 ? CONFIDENCE.DIRECT : CONFIDENCE.INTERPOLATED;

    return {
      totalUnits:         totalUnits,
      ownerUnits:         ownerUnits,
      renterUnits:        renterUnits,
      structureBreakdown: structureBreakdown,
      confidence:         confidence,
    };
  }

  // ── 3. Municipal Affordability Analysis ──────────────────────────────────

  /**
   * Scale county affordability tier distribution to a municipality based on
   * the municipal median rent / median home value vs. county medians.
   *
   * AMI tier keys: tier_0_30, tier_30_60, tier_60_80, tier_80_120, tier_120_plus
   * Values are fractions (0–1) that sum to 1.
   *
   * @param {object} countyData
   *   @param {number} countyData.medianRent         Monthly gross rent ($)
   *   @param {number} countyData.medianHomeValue     ($)
   *   @param {number} countyData.medianHouseholdIncome ($)
   *   @param {object} countyData.amiTierDistribution  { tier_0_30, tier_30_60, … }
   *   @param {number} [countyData.grapi_30plus]     Fraction of renters w/ GRAPI ≥ 30%
   * @param {number|null} municipalRent   Municipal median gross rent or null
   * @param {number|null} municipalMedianValue  Municipal median home value or null
   * @returns {{
   *   amiTierDistribution: object,
   *   rentBurdenRate: number,
   *   municipalRentAdjFactor: number,
   *   incomeNeededToBuy: number,
   *   confidence: object
   * }}
   */
  function scaleMunicipalAffordability(countyData, municipalRent, municipalMedianValue) {
    var countyRent  = safeNum(countyData && countyData.medianRent);
    var countyValue = safeNum(countyData && countyData.medianHomeValue);
    var countyMHI   = safeNum(countyData && countyData.medianHouseholdIncome);
    var countyTiers = (countyData && countyData.amiTierDistribution) || {
      tier_0_30:    0.12,
      tier_30_60:   0.23,
      tier_60_80:   0.18,
      tier_80_120:  0.24,
      tier_120_plus: 0.23,
    };
    var countyGRAPI = safeNum(countyData && countyData.grapi_30plus) || 0.30;

    var muniRent  = municipalRent  ? safeNum(municipalRent)  : null;
    var muniValue = municipalMedianValue ? safeNum(municipalMedianValue) : null;

    // Rent adjustment factor relative to county
    var rentAdjFactor = (muniRent && countyRent) ? clamp(muniRent / countyRent, 0.50, 2.00) : 1.0;

    // Redistribute tiers based on rent adjustment:
    //   higher municipal rent → shift households toward lower (more cost-burdened) tiers
    var tiers = {};
    var totalFrac = 0;
    var tierKeys  = ['tier_0_30', 'tier_30_60', 'tier_60_80', 'tier_80_120', 'tier_120_plus'];
    var adjustments = [1.10, 1.05, 1.00, 0.95, 0.90]; // weights when rentAdjFactor > 1

    if (rentAdjFactor > 1) {
      // More expensive than county → more cost burden
      tierKeys.forEach(function (k, i) {
        tiers[k] = safeNum(countyTiers[k]) * adjustments[i];
        totalFrac += tiers[k];
      });
    } else if (rentAdjFactor < 1) {
      // Less expensive → shift toward higher tiers
      var reverseAdj = adjustments.slice().reverse();
      tierKeys.forEach(function (k, i) {
        tiers[k] = safeNum(countyTiers[k]) * reverseAdj[i];
        totalFrac += tiers[k];
      });
    } else {
      tierKeys.forEach(function (k) {
        tiers[k] = safeNum(countyTiers[k]);
        totalFrac += tiers[k];
      });
    }

    // Normalise to sum = 1
    if (totalFrac > 0) {
      tierKeys.forEach(function (k) { tiers[k] = tiers[k] / totalFrac; });
    }

    // Adjusted rent burden
    var rentBurdenRate = clamp(countyGRAPI * rentAdjFactor, 0.01, 0.99);

    // Income needed to buy in municipality (30% payment-to-income rule, 30-yr @ 7%)
    var targetValue = (muniValue && muniValue > 0) ? muniValue : countyValue;
    var downPct     = 0.10;
    var rate        = 0.07 / 12;
    var n           = 360;
    var loanAmt     = targetValue * (1 - downPct);
    var monthlyPmt  = (loanAmt * rate * Math.pow(1 + rate, n)) / (Math.pow(1 + rate, n) - 1);
    var incomeNeeded = (monthlyPmt / 0.30) * 12;

    var confidence = (muniRent !== null || muniValue !== null)
      ? CONFIDENCE.INTERPOLATED
      : CONFIDENCE.ESTIMATED;

    return {
      amiTierDistribution:     tiers,
      rentBurdenRate:          rentBurdenRate,
      municipalRentAdjFactor:  rentAdjFactor,
      incomeNeededToBuy:       Math.round(incomeNeeded),
      confidence:              confidence,
    };
  }

  // ── 4. Municipal Demographic Projections ─────────────────────────────────

  /**
   * Project municipal population over a horizon using county DOLA / SDO
   * components-of-change projections scaled by the municipal base share and
   * relative growth rate.
   *
   * @param {object} countyProjections
   *   @param {number[]} countyProjections.years          e.g. [2024,2025,…,2044]
   *   @param {number[]} countyProjections.population     County population each year
   *   @param {number}   countyProjections.baseYear       e.g. 2024
   * @param {number} municipalBasePopulation  Current municipal population
   * @param {number} [municipalGrowthRate]    Annual CAGR relative to county (0–1)
   * @returns {{
   *   years: number[],
   *   population: number[],
   *   households: number[],
   *   unitsNeeded: number[],
   *   confidence: object
   * }}
   */
  function projectMunicipalDemographics(countyProjections, municipalBasePopulation, municipalGrowthRate) {
    var years    = (countyProjections && countyProjections.years)      || [];
    var countyPop = (countyProjections && countyProjections.population) || [];
    var baseYear = (countyProjections && countyProjections.baseYear)   || new Date().getFullYear();

    var muniPop   = safeNum(municipalBasePopulation);
    var relRate   = (municipalGrowthRate !== undefined && municipalGrowthRate !== null)
                      ? safeNum(municipalGrowthRate)
                      : 0;

    if (!muniPop || !countyPop.length) {
      return { years: [], population: [], households: [], unitsNeeded: [], confidence: CONFIDENCE.UNAVAILABLE };
    }

    var countyBase = safeNum(countyPop[0]) || muniPop;
    var share0     = clamp(muniPop / countyBase, 0.0001, 0.999);
    var diffLog    = relRate ? Math.log(1 + relRate) : 0;

    var headship  = 0.42;  // default headship rate
    var vacancy   = 0.08;  // default vacancy buffer

    var projPop  = [];
    var projHH   = [];
    var projUnits = [];

    years.forEach(function (yr, i) {
      var cp = safeNum(countyPop[i]);
      var shareT = clamp(share0 * Math.exp(diffLog * i), 0.0001, 0.999);
      var pop    = Math.round(cp * shareT);
      var hh     = Math.round(pop * headship);
      var units  = Math.round(hh / (1 - vacancy));
      projPop.push(pop);
      projHH.push(hh);
      projUnits.push(units);
    });

    var confidence = relRate ? CONFIDENCE.INTERPOLATED : CONFIDENCE.ESTIMATED;

    return {
      years:       years,
      population:  projPop,
      households:  projHH,
      unitsNeeded: projUnits,
      confidence:  confidence,
    };
  }

  // ── 5. Municipal Employment (LEHD LODES Scaling) ─────────────────────────

  /**
   * Estimate municipal employment and commuting context from county LEHD WAC
   * snapshots by applying the municipal population share.
   *
   * @param {object} countyLEHD
   *   @param {number} countyLEHD.totalJobs
   *   @param {number} countyLEHD.CE01   low-wage jobs (≤ $1,250/mo)
   *   @param {number} countyLEHD.CE02   mid-wage jobs ($1,251–$3,333/mo)
   *   @param {number} countyLEHD.CE03   high-wage jobs (> $3,333/mo)
   * @param {number} municipalPopShare  Municipal share of county population (0–1)
   * @returns {{
   *   estimatedJobs: number,
   *   wageTiers: { low:number, mid:number, high:number },
   *   confidence: object
   * }}
   */
  function estimateMunicipalEmployment(countyLEHD, municipalPopShare) {
    var totalJobs = safeNum(countyLEHD && countyLEHD.totalJobs);
    var ce01      = safeNum(countyLEHD && countyLEHD.CE01);
    var ce02      = safeNum(countyLEHD && countyLEHD.CE02);
    var ce03      = safeNum(countyLEHD && countyLEHD.CE03);
    var share     = clamp(safeNum(municipalPopShare), 0.0001, 0.999);

    if (!totalJobs) {
      return {
        estimatedJobs: 0,
        wageTiers: { low: 0, mid: 0, high: 0 },
        confidence: CONFIDENCE.UNAVAILABLE,
      };
    }

    var estJobs = Math.round(totalJobs * share);
    var wageTiers = {
      low:  Math.round(ce01 * share),
      mid:  Math.round(ce02 * share),
      high: Math.round(ce03 * share),
    };

    return {
      estimatedJobs: estJobs,
      wageTiers:     wageTiers,
      confidence:    CONFIDENCE.ESTIMATED,  // LEHD is county-level; no place-level data
    };
  }

  // ── 6. Prop 123 Compliance Scaling ───────────────────────────────────────

  /**
   * Scale the county Prop 123 (HB 22-1093) baseline to a municipal context.
   *
   * @param {object} countyData
   *   @param {number} countyData.renterHouseholds    County total renter HH
   *   @param {number} countyData.ami60RentalFraction  Fraction of renter HH at ≤ 60% AMI
   *   @param {number} [countyData.population]
   * @param {number} municipalRenterPop  Estimated municipal renter households
   * @param {number} municipalPopulation Municipal total population
   * @returns {{
   *   eligible: boolean,
   *   baseline60AmiRentals: number,
   *   targetY1: number,
   *   targetY5: number,
   *   targetY10: number,
   *   confidence: object
   * }}
   */
  function calculateMunicipalProp123Baseline(countyData, municipalRenterPop, municipalPopulation) {
    var renterHH   = safeNum(countyData && countyData.renterHouseholds);
    var ami60Frac  = safeNum(countyData && countyData.ami60RentalFraction) || 0.40;
    var muniRenters = safeNum(municipalRenterPop);
    var muniPop    = safeNum(municipalPopulation);

    var eligible = muniPop >= PROP123_MUNICIPALITY_THRESHOLD;

    if (!muniRenters || !eligible) {
      return {
        eligible:               eligible,
        baseline60AmiRentals:   0,
        targetY1:               0,
        targetY5:               0,
        targetY10:              0,
        confidence:             CONFIDENCE.ESTIMATED,
      };
    }

    var baseline = Math.round(muniRenters * ami60Frac);
    var targetY1  = Math.round(baseline * Math.pow(1 + PROP123_GROWTH_RATE, 1));
    var targetY5  = Math.round(baseline * Math.pow(1 + PROP123_GROWTH_RATE, 5));
    var targetY10 = Math.round(baseline * Math.pow(1 + PROP123_GROWTH_RATE, 10));

    return {
      eligible:             eligible,
      baseline60AmiRentals: baseline,
      targetY1:             targetY1,
      targetY5:             targetY5,
      targetY10:            targetY10,
      confidence:           CONFIDENCE.INTERPOLATED,
    };
  }

  // ── 7. Data Confidence Scoring ────────────────────────────────────────────

  /**
   * Return the appropriate confidence level descriptor given the data source
   * and the municipality's population size.
   *
   * @param {'direct'|'interpolated'|'estimated'|'unavailable'} dataSource
   * @param {number} municipalSize  Population
   * @returns {object}  One of the CONFIDENCE constants
   */
  function getDataConfidence(dataSource, municipalSize) {
    var pop = safeNum(municipalSize);
    var src = String(dataSource || '').toLowerCase();

    if (src === 'direct')       return CONFIDENCE.DIRECT;
    if (src === 'unavailable')  return CONFIDENCE.UNAVAILABLE;

    // Small places (<1,000) get a lower confidence ceiling
    if (pop < 1000) {
      if (src === 'interpolated') return CONFIDENCE.ESTIMATED;
      return CONFIDENCE.UNAVAILABLE;
    }
    if (pop < 2500) {
      if (src === 'interpolated') return CONFIDENCE.ESTIMATED;
      return CONFIDENCE.ESTIMATED;
    }

    if (src === 'interpolated') return CONFIDENCE.INTERPOLATED;
    if (src === 'estimated')    return CONFIDENCE.ESTIMATED;
    return CONFIDENCE.UNAVAILABLE;
  }

  // ── 8. Convenience: build full municipal analysis bundle ─────────────────

  /**
   * Run all municipal analysis functions and return a combined result bundle
   * suitable for display in the HNA dashboard.
   *
   * @param {object} opts
   *   @param {object} opts.countyData        As described per individual functions above
   *   @param {number} opts.municipalPopulation
   *   @param {number} [opts.municipalGrowthRate]
   *   @param {number|null} [opts.municipalRent]
   *   @param {number|null} [opts.municipalMedianValue]
   *   @param {object} [opts.countyProjections]
   *   @param {object} [opts.countyLEHD]
   * @returns {object}
   */
  function buildMunicipalAnalysis(opts) {
    var cd    = opts.countyData          || {};
    var mPop  = safeNum(opts.municipalPopulation);
    var mGR   = opts.municipalGrowthRate !== undefined ? opts.municipalGrowthRate : null;
    var mRent = opts.municipalRent       !== undefined ? opts.municipalRent       : null;
    var mVal  = opts.municipalMedianValue !== undefined ? opts.municipalMedianValue : null;

    var scaling       = calculateMunicipalScaling(cd, mPop, mGR);
    var housingStock  = estimateMunicipalHousingStock(cd, {
      households:         scaling.households,
      directHousingUnits: opts.directHousingUnits || 0,
    });
    var affordability = scaleMunicipalAffordability(cd, mRent, mVal);
    var projections   = opts.countyProjections
      ? projectMunicipalDemographics(opts.countyProjections, mPop, mGR)
      : null;
    var employment    = opts.countyLEHD
      ? estimateMunicipalEmployment(opts.countyLEHD, scaling.popShare)
      : null;
    var prop123       = calculateMunicipalProp123Baseline(
      cd,
      housingStock.renterUnits,
      mPop
    );

    return {
      scaling:      scaling,
      housingStock: housingStock,
      affordability: affordability,
      projections:  projections,
      employment:   employment,
      prop123:      prop123,
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  var MunicipalAnalysis = {
    CONFIDENCE:                        CONFIDENCE,
    PROP123_MUNICIPALITY_THRESHOLD:    PROP123_MUNICIPALITY_THRESHOLD,
    PROP123_GROWTH_RATE:               PROP123_GROWTH_RATE,

    calculateMunicipalScaling:         calculateMunicipalScaling,
    estimateMunicipalHousingStock:     estimateMunicipalHousingStock,
    scaleMunicipalAffordability:       scaleMunicipalAffordability,
    projectMunicipalDemographics:      projectMunicipalDemographics,
    estimateMunicipalEmployment:       estimateMunicipalEmployment,
    calculateMunicipalProp123Baseline: calculateMunicipalProp123Baseline,
    getDataConfidence:                 getDataConfidence,
    buildMunicipalAnalysis:            buildMunicipalAnalysis,

    // expose internals for testing
    _safeNum: safeNum,
    _clamp:   clamp,
  };

  // Attach to window in browser; export for CommonJS/Node test environment.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MunicipalAnalysis;
  } else {
    window.MunicipalAnalysis = MunicipalAnalysis;
  }
}());
