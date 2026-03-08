/* js/municipal-analysis.js — Municipal (sub-county) housing analysis interpolation module
 * Pure functions only — no side effects, no DOM access, no fetch calls.
 */
(function(root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.MunicipalAnalysis = factory();
  }
})(typeof window !== 'undefined' ? window : this, function() {
  'use strict';

  const BASE_YEAR        = 2024;
  const PROP123_HORIZON  = 8;      // years
  const PROP123_PCT      = 0.03;   // 3 % of total stock
  const MUNI_POP_THRESH  = 1000;   // Prop 123 municipality threshold

  /* -------------------------------------------------------------------------
   * Internal helpers
   * ---------------------------------------------------------------------- */

  /** Safely parse a numeric ACS field; returns 0 on null/undefined/NaN. */
  function _num(v) {
    var n = Number(v);
    return (v !== null && v !== undefined && !Number.isNaN(n)) ? n : 0;
  }

  /** Clamp a population share to the valid [0, 1] range. */
  function _share(s) {
    var n = Number(s);
    if (s === null || s === undefined || Number.isNaN(n)) return 0;
    return Math.min(1, Math.max(0, n));
  }

  /* =========================================================================
   * 1. calculateMunicipalScaling
   * ====================================================================== */

  /**
   * Scales county-level ACS metrics to the municipal level using population share.
   *
   * Housing units and population are scaled proportionally; MHI is passed
   * through unchanged because income is not linearly proportional to population.
   *
   * @param  {Object|null} countyData        ACS profile object for the parent county.
   * @param  {number}      municipalPopShare Fraction of county population [0–1].
   * @returns {{
   *   scaledHousingUnits: number,
   *   scaledPopulation:   number,
   *   municipalMhi:       number,
   *   ownerRate:          number,
   *   renterRate:         number
   * }}
   */
  function calculateMunicipalScaling(countyData, municipalPopShare) {
    if (!countyData) {
      return {
        scaledHousingUnits: 0,
        scaledPopulation:   0,
        municipalMhi:       0,
        ownerRate:          0,
        renterRate:         0
      };
    }

    var share = _share(municipalPopShare);

    return {
      scaledHousingUnits: Math.round(_num(countyData.DP04_0001E) * share),
      scaledPopulation:   Math.round(_num(countyData.DP05_0001E) * share),
      municipalMhi:       _num(countyData.DP03_0062E),   // MHI — not scaled
      ownerRate:          _num(countyData.DP04_0047PE),
      renterRate:         _num(countyData.DP04_0046PE)
    };
  }

  /* =========================================================================
   * 2. estimateMunicipalHousingStock
   * ====================================================================== */

  /**
   * Estimates municipal housing stock by scaling county totals by population share.
   *
   * Null countyData entries are skipped; the result carries a 'interpolated'
   * confidence flag to signal that these are derived estimates.
   *
   * @param  {Object|null} countyData ACS profile object for the parent county.
   * @param  {number}      popShare   Fraction of county population [0–1].
   * @returns {{
   *   estimatedUnits: number,
   *   ownerOccupied:  number,
   *   renterOccupied: number,
   *   vacant:         number,
   *   dataConfidence: string
   * }}
   */
  function estimateMunicipalHousingStock(countyData, popShare) {
    if (!countyData) {
      return {
        estimatedUnits: 0,
        ownerOccupied:  0,
        renterOccupied: 0,
        vacant:         0,
        dataConfidence: 'interpolated'
      };
    }

    var share  = _share(popShare);
    var hu     = _num(countyData.DP04_0001E);

    // Prefer absolute counts; fall back to percentage-derived values when
    // the count fields are absent (e.g. smaller-geography ACS releases).
    var owner  = _num(countyData.DP04_0047E)  ||
                 Math.round(hu * (_num(countyData.DP04_0047PE) / 100));
    var renter = _num(countyData.DP04_0046E)  ||
                 Math.round(hu * (_num(countyData.DP04_0046PE) / 100));
    var vacant = _num(countyData.DP04_0003E);

    return {
      estimatedUnits: Math.round(hu     * share),
      ownerOccupied:  Math.round(owner  * share),
      renterOccupied: Math.round(renter * share),
      vacant:         Math.round(vacant * share),
      dataConfidence: 'interpolated'
    };
  }

  /* =========================================================================
   * 3. scaleMunicipalAffordability
   * ====================================================================== */

  /**
   * Scales affordability metrics with an optional local-market adjustment factor.
   *
   * The adjustment factor allows callers to apply a premium or discount relative
   * to county averages (e.g. 1.10 for a higher-cost urban municipality).
   * Rent-burden rate is carried through unscaled because it reflects household
   * income ratios rather than absolute prices.
   *
   * @param  {Object|null} countyData       ACS profile object for the parent county.
   * @param  {number}      [adjustmentFactor=1.0]  Multiplier applied to rent and value.
   * @returns {{
   *   adjustedMedianRent:      number,
   *   adjustedMedianHomeValue: number,
   *   incomeNeedToBuy:         number,
   *   rentBurdenRate:          number,
   *   affordabilityGap:        number,
   *   dataConfidence:          string
   * }}
   */
  function scaleMunicipalAffordability(countyData, adjustmentFactor) {
    var factor = (adjustmentFactor !== null && adjustmentFactor !== undefined &&
                  !Number.isNaN(Number(adjustmentFactor)))
                 ? Number(adjustmentFactor)
                 : 1.0;

    if (!countyData) {
      return {
        adjustedMedianRent:      0,
        adjustedMedianHomeValue: 0,
        incomeNeedToBuy:         0,
        rentBurdenRate:          0,
        affordabilityGap:        0,
        dataConfidence:          'scaled'
      };
    }

    var medRent  = _num(countyData.DP04_0134E) * factor;
    var medValue = _num(countyData.DP04_0089E) * factor;
    var mhi      = _num(countyData.DP03_0062E);

    // Income needed to qualify for a 30-yr mortgage at ~6.5 % on adjusted median value
    // (28 % front-end DTI rule: annual payment ≈ value × 0.065; divide by 0.28).
    var incomeNeedToBuy = medValue > 0 ? (medValue * 0.065) / 0.28 : 0;

    // Rent-burden: 100 % minus the three not-burdened ACS DP04 GRAPI bins (< 30 % of income).
    //   0142PE = <20 %, 0143PE = 20–24.9 %, 0144PE = 25–29.9 % → NOT burdened.
    //   0145PE = 30–34.9 %, 0146PE = 35 %+ → BURDENED.
    var notBurdened = _num(countyData.DP04_0142PE) + _num(countyData.DP04_0143PE) +
                      _num(countyData.DP04_0144PE);
    var rentBurdenRate = notBurdened > 0 ? Math.max(0, 100 - notBurdened) / 100 : 0;

    return {
      adjustedMedianRent:      medRent,
      adjustedMedianHomeValue: medValue,
      incomeNeedToBuy:         incomeNeedToBuy,
      rentBurdenRate:          rentBurdenRate,
      affordabilityGap:        incomeNeedToBuy - mhi,
      dataConfidence:          'scaled'
    };
  }

  /* =========================================================================
   * 4. projectMunicipalDemographics
   * ====================================================================== */

  /**
   * Scales county DOLA population projections to the municipal level using
   * population share.
   *
   * The population share is assumed constant across the projection horizon.
   * `countyFips` is forwarded from the projection object so callers can
   * trace which county was used.
   *
   * @param  {Object|null} countyProjections  Object with { years, population_dola, countyFips }.
   * @param  {number}      popShare           Fraction of county population [0–1].
   * @returns {{
   *   years:          number[],
   *   population:     number[],
   *   baseYear:       number,
   *   countyFips:     string,
   *   dataConfidence: string
   * }}
   */
  function projectMunicipalDemographics(countyProjections, popShare) {
    var defaultYears = [BASE_YEAR, 2025, 2030, 2035, 2040, 2045, 2050];
    var share = _share(popShare);

    if (!countyProjections) {
      return {
        years:          defaultYears,
        population:     defaultYears.map(function() { return 0; }),
        baseYear:       BASE_YEAR,
        countyFips:     '',
        dataConfidence: 'interpolated'
      };
    }

    var years = Array.isArray(countyProjections.years) && countyProjections.years.length > 0
                ? countyProjections.years.slice()
                : defaultYears;

    var srcPop = Array.isArray(countyProjections.population_dola)
                 ? countyProjections.population_dola
                 : [];

    var population = years.map(function(_, idx) {
      return Math.round(_num(srcPop[idx]) * share);
    });

    return {
      years:          years,
      population:     population,
      baseYear:       BASE_YEAR,
      countyFips:     countyProjections.countyFips || '',
      dataConfidence: 'interpolated'
    };
  }

  /* =========================================================================
   * 5. estimateMunicipalEmployment
   * ====================================================================== */

  /**
   * Scales county LEHD commute-flow employment data to the municipal level
   * using population share.
   *
   * @param  {Object|null} countyLEHD  Object with { inflow, outflow, within }.
   * @param  {number}      popShare    Fraction of county population [0–1].
   * @returns {{
   *   estimatedInflow:  number,
   *   estimatedOutflow: number,
   *   estimatedWithin:  number,
   *   estimatedJobs:    number,
   *   dataConfidence:   string
   * }}
   */
  function estimateMunicipalEmployment(countyLEHD, popShare) {
    if (!countyLEHD) {
      return {
        estimatedInflow:  0,
        estimatedOutflow: 0,
        estimatedWithin:  0,
        estimatedJobs:    0,
        dataConfidence:   'scaled'
      };
    }

    var share   = _share(popShare);
    var inflow  = Math.round(_num(countyLEHD.inflow)  * share);
    var outflow = Math.round(_num(countyLEHD.outflow) * share);
    var within  = Math.round(_num(countyLEHD.within)  * share);

    return {
      estimatedInflow:  inflow,
      estimatedOutflow: outflow,
      estimatedWithin:  within,
      estimatedJobs:    inflow + within,
      dataConfidence:   'scaled'
    };
  }

  /* =========================================================================
   * 6. calculateMunicipalProp123Baseline
   * ====================================================================== */

  /**
   * Calculates the Proposition 123 affordable-housing baseline for a municipality
   * by scaling county ACS totals by population share.
   *
   * Prop 123 (2022) requires participating jurisdictions to grow affordable
   * housing by 3 % annually over an 8-year horizon.  Municipalities with an
   * estimated population below 1 000 are below the participation threshold.
   *
   * @param  {Object|null} countyData ACS profile object for the parent county.
   * @param  {number}      popShare   Fraction of county population [0–1].
   * @returns {{
   *   estimatedUnits:          number,
   *   baselineUnits:           number,
   *   annualGrowthTarget:      number,
   *   isMunicipalityThreshold: boolean
   * }}
   */
  function calculateMunicipalProp123Baseline(countyData, popShare) {
    if (!countyData) {
      return {
        estimatedUnits:          0,
        baselineUnits:           0,
        annualGrowthTarget:      0,
        isMunicipalityThreshold: false
      };
    }

    var share          = _share(popShare);
    var estimatedUnits = Math.round(_num(countyData.DP04_0001E) * share);
    var estimatedPop   = Math.round(_num(countyData.DP05_0001E) * share);
    var baselineUnits  = Math.round(estimatedUnits * PROP123_PCT);

    return {
      estimatedUnits:          estimatedUnits,
      baselineUnits:           baselineUnits,
      annualGrowthTarget:      baselineUnits / PROP123_HORIZON,
      isMunicipalityThreshold: estimatedPop >= MUNI_POP_THRESH
    };
  }

  /* =========================================================================
   * 7. getMunicipalDataConfidence
   * ====================================================================== */

  /**
   * Returns a structured confidence descriptor for the given municipal data
   * source type.
   *
   * Municipal data is almost always derived or interpolated from county-level
   * sources, so scores are lower than the equivalent state-level values.
   * ACS 1-Year data at the municipal level is rare; only large cities qualify.
   *
   * @param  {string} dataSource  One of: 'acs1'|'acs5'|'cache'|'derived'|
   *                              'estimate'|'interpolated'|'scaled'
   * @returns {{ level: 'high'|'medium'|'low', description: string, score: number }}
   */
  function getMunicipalDataConfidence(dataSource) {
    var map = {
      acs1: {
        level:       'high',
        description: 'ACS 1-Year estimates — most current; rare at municipal level (pop ≥ 65 000 only).',
        score:       0.85
      },
      acs5: {
        level:       'medium',
        description: 'ACS 5-Year estimates — highest geographic coverage at sub-county level.',
        score:       0.7
      },
      cache: {
        level:       'medium',
        description: 'Locally cached data — may not reflect the latest vintage.',
        score:       0.65
      },
      derived: {
        level:       'medium',
        description: 'Calculated from primary sources — check constituent inputs for currency.',
        score:       0.6
      },
      interpolated: {
        level:       'medium',
        description: 'Interpolated from county-level data using population share — directional estimate.',
        score:       0.6
      },
      scaled: {
        level:       'medium',
        description: 'Scaled from county-level data with an adjustment factor — treat as approximate.',
        score:       0.55
      },
      estimate: {
        level:       'low',
        description: 'Modelled or statistically estimated — treat as directional only.',
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
    calculateMunicipalScaling:         calculateMunicipalScaling,
    estimateMunicipalHousingStock:     estimateMunicipalHousingStock,
    scaleMunicipalAffordability:       scaleMunicipalAffordability,
    projectMunicipalDemographics:      projectMunicipalDemographics,
    estimateMunicipalEmployment:       estimateMunicipalEmployment,
    calculateMunicipalProp123Baseline: calculateMunicipalProp123Baseline,
    getMunicipalDataConfidence:        getMunicipalDataConfidence
  };
});
