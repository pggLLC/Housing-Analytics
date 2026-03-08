/* js/state-analysis.js — State-level HNA aggregation module (pure functions, no side effects) */
(function(root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.StateAnalysis = factory();
  }
})(typeof window !== 'undefined' ? window : this, function() {
  'use strict';

  const STATE_FIPS        = '08';
  const BASE_YEAR         = 2024;
  const TOTAL_CO_COUNTIES = 64;
  const PROP123_HORIZON   = 8;     // years
  const PROP123_PCT       = 0.03;  // 3 % of total stock

  /* -------------------------------------------------------------------------
   * Internal helpers
   * ---------------------------------------------------------------------- */

  /** Safely parse a numeric ACS field; returns 0 on null/undefined/NaN. */
  function _num(v) {
    const n = Number(v);
    return (v !== null && v !== undefined && !Number.isNaN(n)) ? n : 0;
  }

  /** Filter out null/undefined entries from an array (or return []). */
  function _valid(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(function(x) { return x !== null && x !== undefined; });
  }

  /* =========================================================================
   * 1. calculateStateScaling
   * ====================================================================== */

  /**
   * Aggregates county-level ACS metrics into Colorado state totals.
   *
   * @param  {Array<Object|null>} allCountyData  Array of county ACS profile objects.
   * @returns {{
   *   totalHousingUnits: number,
   *   totalPopulation: number,
   *   weightedMhi: number,
   *   weightedOwnerRate: number,
   *   weightedRenterRate: number,
   *   weightedVacancyRate: number,
   *   countyCount: number
   * }}
   */
  function calculateStateScaling(allCountyData) {
    var counties = _valid(allCountyData);
    if (counties.length === 0) {
      return {
        totalHousingUnits: 0,
        totalPopulation: 0,
        weightedMhi: 0,
        weightedOwnerRate: 0,
        weightedRenterRate: 0,
        weightedVacancyRate: 0,
        countyCount: 0
      };
    }

    var totalHousingUnits = 0;
    var totalPopulation   = 0;
    var mhiNumer          = 0;
    var ownerNumer        = 0;
    var renterNumer       = 0;
    var vacancyNumer      = 0;

    for (var i = 0; i < counties.length; i++) {
      var c   = counties[i];
      var pop = _num(c.DP05_0001E);
      var hu  = _num(c.DP04_0001E);

      totalPopulation   += pop;
      totalHousingUnits += hu;

      var weight = pop > 0 ? pop : 1;  // fall back to equal weighting
      mhiNumer     += _num(c.DP03_0062E)  * weight;
      ownerNumer   += _num(c.DP04_0047PE) * weight;
      renterNumer  += _num(c.DP04_0046PE) * weight;
      vacancyNumer += _num(c.DP04_0003PE) * weight;
    }

    var totalWeight = totalPopulation > 0 ? totalPopulation : counties.length;

    return {
      totalHousingUnits: totalHousingUnits,
      totalPopulation:   totalPopulation,
      weightedMhi:          totalWeight > 0 ? mhiNumer     / totalWeight : 0,
      weightedOwnerRate:    totalWeight > 0 ? ownerNumer   / totalWeight : 0,
      weightedRenterRate:   totalWeight > 0 ? renterNumer  / totalWeight : 0,
      weightedVacancyRate:  totalWeight > 0 ? vacancyNumer / totalWeight : 0,
      countyCount: counties.length
    };
  }

  /* =========================================================================
   * 2. estimateStateHousingStock
   * ====================================================================== */

  /**
   * Sums housing units across all counties and breaks them into tenure/vacancy
   * components plus structure-type subtotals.
   *
   * @param  {Array<Object|null>} allCountyData
   * @returns {{
   *   totalUnits: number,
   *   ownerOccupied: number,
   *   renterOccupied: number,
   *   vacant: number,
   *   structureTypes: Object
   * }}
   */
  function estimateStateHousingStock(allCountyData) {
    var counties = _valid(allCountyData);

    var totals = {
      totalUnits:    0,
      ownerOccupied: 0,
      renterOccupied: 0,
      vacant: 0,
      structureTypes: {
        singleFamily:     0,   // DP04_0007E  — 1-unit detached
        singleAttached:   0,   // DP04_0008E  — 1-unit attached
        units2:           0,   // DP04_0009E  — 2 units
        units3to4:        0,   // DP04_0010E  — 3–4 units
        units5to9:        0,   // DP04_0011E  — 5–9 units
        units10to19:      0,   // DP04_0012E  — 10–19 units
        units20plus:      0,   // DP04_0013E  — 20+ units
        mobileMfg:        0    // DP04_0014E  — Mobile home / other
      }
    };

    for (var i = 0; i < counties.length; i++) {
      var c = counties[i];
      var hu = _num(c.DP04_0001E);

      totals.totalUnits    += hu;
      totals.ownerOccupied += _num(c.DP04_0047E)  || Math.round(hu * (_num(c.DP04_0047PE) / 100));
      totals.renterOccupied+= _num(c.DP04_0046E)  || Math.round(hu * (_num(c.DP04_0046PE) / 100));
      totals.vacant        += _num(c.DP04_0003E);

      totals.structureTypes.singleFamily   += _num(c.DP04_0007E);
      totals.structureTypes.singleAttached += _num(c.DP04_0008E);
      totals.structureTypes.units2         += _num(c.DP04_0009E);
      totals.structureTypes.units3to4      += _num(c.DP04_0010E);
      totals.structureTypes.units5to9      += _num(c.DP04_0011E);
      totals.structureTypes.units10to19    += _num(c.DP04_0012E);
      totals.structureTypes.units20plus    += _num(c.DP04_0013E);
      totals.structureTypes.mobileMfg      += _num(c.DP04_0014E);
    }

    return totals;
  }

  /* =========================================================================
   * 3. scaleStateAffordability
   * ====================================================================== */

  /**
   * Computes population-weighted affordability metrics for the state.
   *
   * Rent-burden rate is derived from the DP04_0142PE–DP04_0146PE bins:
   *   bins 0142–0144 cover < 30 % (not burdened);
   *   bins 0145–0146 cover ≥ 30 % (burdened).
   * We approximate burden as 100 % minus the not-burdened share.
   *
   * @param  {Array<Object|null>} allCountyData
   * @returns {{
   *   weightedMedianRent: number,
   *   weightedMedianHomeValue: number,
   *   weightedIncomeNeedToBuy: number,
   *   weightedRentBurdenRate: number,
   *   stateAffordabilityGap: number
   * }}
   */
  function scaleStateAffordability(allCountyData) {
    var counties = _valid(allCountyData);
    if (counties.length === 0) {
      return {
        weightedMedianRent: 0,
        weightedMedianHomeValue: 0,
        weightedIncomeNeedToBuy: 0,
        weightedRentBurdenRate: 0,
        stateAffordabilityGap: 0
      };
    }

    var rentNumer        = 0;
    var valueNumer       = 0;
    var incomeNeedNumer  = 0;
    var burdenNumer      = 0;
    var mhiNumer         = 0;
    var totalWeight      = 0;

    for (var i = 0; i < counties.length; i++) {
      var c      = counties[i];
      var pop    = _num(c.DP05_0001E);
      var weight = pop > 0 ? pop : 1;
      totalWeight += weight;

      var medRent  = _num(c.DP04_0134E);
      var medValue = _num(c.DP04_0089E);
      var mhi      = _num(c.DP03_0062E);

      // Income needed to qualify for a 30-yr mortgage at ~6.5 % on median value
      // (28 % front-end DTI rule: annual interest ≈ value × 0.065; divide by 0.28)
      var incomeNeeded = medValue > 0 ? (medValue * 0.065) / 0.28 : 0;

      // Rent-burden: ACS DP04 GRAPI bins (as used throughout this codebase):
      //   0142PE = <20 %, 0143PE = 20–24.9 %, 0144PE = 25–29.9 % → NOT burdened.
      //   0145PE = 30–34.9 %, 0146PE = 35 %+ → BURDENED (≥ 30 % of income on rent).
      // 100 % minus the three not-burdened shares gives the ≥ 30 % burdened rate.
      var notBurdened = _num(c.DP04_0142PE) + _num(c.DP04_0143PE) +
                        _num(c.DP04_0144PE);
      var burdenRate  = notBurdened > 0 ? Math.max(0, 100 - notBurdened) / 100 : 0;

      rentNumer       += medRent      * weight;
      valueNumer      += medValue     * weight;
      incomeNeedNumer += incomeNeeded * weight;
      burdenNumer     += burdenRate   * weight;
      mhiNumer        += mhi          * weight;
    }

    var w = totalWeight > 0 ? totalWeight : 1;
    var wIncomeNeed = incomeNeedNumer / w;
    var wMhi        = mhiNumer        / w;

    return {
      weightedMedianRent:       rentNumer   / w,
      weightedMedianHomeValue:  valueNumer  / w,
      weightedIncomeNeedToBuy:  wIncomeNeed,
      weightedRentBurdenRate:   burdenNumer / w,
      stateAffordabilityGap:    wIncomeNeed - wMhi
    };
  }

  /* =========================================================================
   * 4. projectStateDemographics
   * ====================================================================== */

  /**
   * Aggregates DOLA county population projections into a single statewide series.
   *
   * Each entry in allCountyProjections should have:
   *   { years: number[], population_dola: number[] }
   *
   * @param  {Array<Object|null>} allCountyProjections
   * @returns {{ years: number[], population: number[], baseYear: number }}
   */
  function projectStateDemographics(allCountyProjections) {
    var entries = _valid(allCountyProjections);
    var defaultYears = [BASE_YEAR, 2025, 2030, 2035, 2040, 2045, 2050];

    if (entries.length === 0) {
      return {
        years:      defaultYears,
        population: defaultYears.map(function() { return 0; }),
        baseYear:   BASE_YEAR
      };
    }

    // Use the years array from the first entry that has one
    var refYears = null;
    for (var i = 0; i < entries.length; i++) {
      if (Array.isArray(entries[i].years) && entries[i].years.length > 0) {
        refYears = entries[i].years.slice();
        break;
      }
    }
    if (!refYears) {
      refYears = defaultYears;
    }

    // Sum population_dola across counties for each year index
    var totals = refYears.map(function() { return 0; });

    for (var j = 0; j < entries.length; j++) {
      var entry = entries[j];
      var pops  = Array.isArray(entry.population_dola) ? entry.population_dola : [];
      for (var k = 0; k < refYears.length; k++) {
        totals[k] += _num(pops[k]);
      }
    }

    return {
      years:      refYears,
      population: totals,
      baseYear:   BASE_YEAR
    };
  }

  /* =========================================================================
   * 5. estimateStateEmployment
   * ====================================================================== */

  /**
   * Totals LEHD commute-flow fields across all Colorado counties.
   *
   * Each entry should have: { inflow: number, outflow: number, within: number }
   *
   * @param  {Array<Object|null>} allCountyLEHD
   * @returns {{
   *   totalInflow: number,
   *   totalOutflow: number,
   *   totalWithin: number,
   *   totalJobs: number
   * }}
   */
  function estimateStateEmployment(allCountyLEHD) {
    var entries = _valid(allCountyLEHD);

    var totalInflow  = 0;
    var totalOutflow = 0;
    var totalWithin  = 0;

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      totalInflow  += _num(e.inflow);
      totalOutflow += _num(e.outflow);
      totalWithin  += _num(e.within);
    }

    return {
      totalInflow:  totalInflow,
      totalOutflow: totalOutflow,
      totalWithin:  totalWithin,
      // Jobs located in the state = workers commuting in + workers who live-and-work locally.
      // (outflow counts residents who work elsewhere, so it must not be added to the state total.)
      totalJobs:    totalInflow + totalWithin
    };
  }

  /* =========================================================================
   * 6. calculateStateProp123Baseline
   * ====================================================================== */

  /**
   * Aggregates Proposition 123 affordable-housing baseline metrics.
   *
   * Prop 123 (2022) requires participating jurisdictions to increase affordable
   * housing by 3 % annually; the 8-year horizon reflects the programme window.
   *
   * @param  {Array<Object|null>} allCountyData  Array of county ACS profile objects.
   * @returns {{
   *   totalUnits: number,
   *   baselineUnits: number,
   *   annualGrowthTarget: number,
   *   eligibleCounties: number
   * }}
   */
  function calculateStateProp123Baseline(allCountyData) {
    var counties = _valid(allCountyData);
    if (counties.length === 0) {
      return {
        totalUnits:          0,
        baselineUnits:       0,
        annualGrowthTarget:  0,
        eligibleCounties:    0
      };
    }

    var totalUnits      = 0;
    var eligibleCounties = 0;

    for (var i = 0; i < counties.length; i++) {
      var c  = counties[i];
      var hu = _num(c.DP04_0001E);
      var pop= _num(c.DP05_0001E);

      totalUnits += hu;
      if (pop >= 1000) {
        eligibleCounties++;
      }
    }

    var baselineUnits      = Math.round(totalUnits * PROP123_PCT);
    var annualGrowthTarget = baselineUnits / PROP123_HORIZON;

    return {
      totalUnits:          totalUnits,
      baselineUnits:       baselineUnits,
      annualGrowthTarget:  annualGrowthTarget,
      eligibleCounties:    eligibleCounties
    };
  }

  /* =========================================================================
   * 7. getStateDataConfidence
   * ====================================================================== */

  /**
   * Returns a structured confidence descriptor for the given data source type.
   *
   * @param  {string} dataSource  One of: 'acs1'|'acs5'|'cache'|'derived'|'estimate'
   * @returns {{ level: 'high'|'medium'|'low', description: string, score: number }}
   */
  function getStateDataConfidence(dataSource) {
    var map = {
      acs1: {
        level:       'high',
        description: 'ACS 1-Year estimates — most current, narrower geographic coverage.',
        score:       0.9
      },
      acs5: {
        level:       'high',
        description: 'ACS 5-Year estimates — highest precision, covers all geographies.',
        score:       0.85
      },
      cache: {
        level:       'medium',
        description: 'Locally cached data — may not reflect the latest vintage.',
        score:       0.7
      },
      derived: {
        level:       'medium',
        description: 'Calculated from primary sources — check constituent inputs for currency.',
        score:       0.65
      },
      estimate: {
        level:       'low',
        description: 'Modelled or interpolated estimate — treat as directional only.',
        score:       0.4
      }
    };

    var src = typeof dataSource === 'string' ? dataSource.toLowerCase().trim() : '';
    return map[src] || {
      level:       'low',
      description: 'Unknown data source — confidence cannot be assessed.',
      score:       0.3
    };
  }

  /* -------------------------------------------------------------------------
   * Public API
   * ---------------------------------------------------------------------- */
  return {
    calculateStateScaling:       calculateStateScaling,
    estimateStateHousingStock:   estimateStateHousingStock,
    scaleStateAffordability:     scaleStateAffordability,
    projectStateDemographics:    projectStateDemographics,
    estimateStateEmployment:     estimateStateEmployment,
    calculateStateProp123Baseline: calculateStateProp123Baseline,
    getStateDataConfidence:      getStateDataConfidence
  };
});
