/**
 * cohort-component-model.js — COHO Analytics
 *
 * Client-side cohort-component demographic projection engine.
 * Mirrors the Python implementation in scripts/hna/demographic_projections.py
 * so that the interactive scenario builder can run projections entirely in-browser
 * without a round-trip to the server.
 *
 * Standard model: Pop(t+1) = Pop(t) × Survival + Births + Net Migration
 * Projections are run in annual steps by interpolating 5-year age-group survival
 * rates. Births use age-specific fertility rates (ASFRs) applied to female cohorts.
 *
 * Exposes: window.CohortComponentModel
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants (match demographic_projections.py)
  // ---------------------------------------------------------------------------

  const AGE_GROUPS = [
    '0-4','5-9','10-14','15-19','20-24','25-29',
    '30-34','35-39','40-44','45-49','50-54','55-59',
    '60-64','65-69','70-74','75-79','80-84','85+',
  ];
  const N_COHORTS = AGE_GROUPS.length; // 18

  // 5-year survival rates (approximate US life-table)
  const DEFAULT_SURVIVAL = [
    0.9985, 0.9990, 0.9989, 0.9985, 0.9978,
    0.9975, 0.9970, 0.9963, 0.9950, 0.9930,
    0.9900, 0.9860, 0.9800, 0.9700, 0.9550,
    0.9300, 0.8900, 0.7500,
  ];

  // Age-specific fertility rates per woman per 5-year period
  const DEFAULT_ASFR = {
    '15-19': 0.040, '20-24': 0.160, '25-29': 0.280,
    '30-34': 0.280, '35-39': 0.160, '40-44': 0.055, '45-49': 0.008,
  };
  const FERTILE_INDICES = [3, 4, 5, 6, 7, 8, 9]; // 15-19 through 45-49
  const SEX_RATIO_AT_BIRTH = 1.05;

  // Migration by age: proportional share (sums to 1.0)
  const MIGRATION_AGE_DIST = [
    0.04, 0.04, 0.04, 0.06, 0.10, 0.12, 0.11, 0.10,
    0.09, 0.08, 0.07, 0.06, 0.05, 0.05, 0.04, 0.03, 0.01, 0.01,
  ];

  // ---------------------------------------------------------------------------
  // CohortComponentModel
  // ---------------------------------------------------------------------------

  /**
   * @param {Object} opts
   * @param {Object}  opts.basePopulation - {male: float[18], female: float[18]}
   * @param {number}  opts.baseYear       - Start year (default 2024)
   * @param {number}  opts.targetYear     - End year (default 2050)
   * @param {Object}  [opts.scenario]     - Scenario parameter overrides
   * @param {number}  [opts.headshipRate] - Fraction of households per person (default 0.38)
   * @param {number}  [opts.vacancyTarget]- Target vacancy rate (default 0.05)
   * @param {number}  [opts.baseUnits]    - Existing housing units in base year
   */
  function CohortComponentModel(opts) {
    this.basePopulation = opts.basePopulation || _emptyPop();
    this.baseYear       = opts.baseYear  || 2024;
    this.targetYear     = opts.targetYear || 2050;
    this.headshipRate   = opts.headshipRate  || 0.38;
    this.vacancyTarget  = opts.vacancyTarget || 0.05;
    this.baseUnits      = opts.baseUnits || 0;

    // Scenario parameters
    const sc = opts.scenario || {};
    this.fertilityMult  = (sc.fertility_multiplier  != null) ? sc.fertility_multiplier  : 1.0;
    this.mortalityMult  = (sc.mortality_multiplier  != null) ? sc.mortality_multiplier  : 1.0;
    this.migrationAnnual= (sc.net_migration_annual  != null) ? sc.net_migration_annual  : 500;
  }

  /** Run the projection and return an array of yearly snapshots. */
  CohortComponentModel.prototype.project = function () {
    const years = this.targetYear - this.baseYear;
    const results = [];

    // Convert 5-year survival to annual (s_annual = s_5yr^(1/5))
    const annualSurvival = DEFAULT_SURVIVAL.map(s => Math.pow(s * this.mortalityMult, 0.2));
    // Clamp to valid range
    const clamp = x => Math.min(0.9999, Math.max(0, x));
    const survival = annualSurvival.map(clamp);

    // Convert 5-year ASFRs to annual (divide by 5)
    const asfr = {};
    FERTILE_INDICES.forEach(i => {
      const ag = AGE_GROUPS[i];
      asfr[i] = (DEFAULT_ASFR[ag] || 0) * this.fertilityMult / 5.0;
    });

    // Deep copy base population
    let pop = {
      male:   this.basePopulation.male.slice(),
      female: this.basePopulation.female.slice(),
    };

    // Add base year snapshot
    results.push(this._snapshot(this.baseYear, pop));

    for (let yr = 1; yr <= years; yr++) {
      pop = this._stepYear(pop, survival, asfr);
      results.push(this._snapshot(this.baseYear + yr, pop));
    }

    return results;
  };

  /** Single annual step: age cohorts, apply mortality, add births, add migration. */
  CohortComponentModel.prototype._stepYear = function (pop, survival, asfr) {
    const newMale   = new Array(N_COHORTS).fill(0);
    const newFemale = new Array(N_COHORTS).fill(0);

    // Age cohorts by 1 year (simplified: treat 5-yr groups as annual steps
    // by proportionally aging 1/5 of each cohort into the next group)
    for (let i = 0; i < N_COHORTS; i++) {
      const survM = pop.male[i]   * survival[i];
      const survF = pop.female[i] * survival[i];
      if (i < N_COHORTS - 1) {
        // Most of cohort stays in same group; 1/5 ages into next
        newMale[i]     += survM * (4 / 5);
        newFemale[i]   += survF * (4 / 5);
        newMale[i + 1] += survM * (1 / 5);
        newFemale[i + 1] += survF * (1 / 5);
      } else {
        // Last cohort (85+) accumulates
        newMale[i]   += survM;
        newFemale[i] += survF;
      }
    }

    // Births: apply ASFRs to female cohorts
    let totalBirths = 0;
    FERTILE_INDICES.forEach(i => {
      totalBirths += newFemale[i] * (asfr[i] || 0);
    });
    const maleBirths   = totalBirths * (SEX_RATIO_AT_BIRTH / (1 + SEX_RATIO_AT_BIRTH));
    const femaleBirths = totalBirths * (1 / (1 + SEX_RATIO_AT_BIRTH));
    newMale[0]   += maleBirths;
    newFemale[0] += femaleBirths;

    // Net migration distributed by age
    const totalMig = this.migrationAnnual;
    MIGRATION_AGE_DIST.forEach((share, i) => {
      const cohortMig = totalMig * share;
      newMale[i]   += cohortMig * 0.48;
      newFemale[i] += cohortMig * 0.52;
    });

    return { male: newMale, female: newFemale };
  };

  /** Build a result snapshot for a given year. */
  CohortComponentModel.prototype._snapshot = function (year, pop) {
    const totalPop = pop.male.reduce((a, b) => a + b, 0)
                   + pop.female.reduce((a, b) => a + b, 0);
    const households    = Math.round(totalPop * this.headshipRate);
    const unitsNeeded   = this._calcUnitsNeeded(households);
    const cumNeed       = Math.max(0, unitsNeeded - this.baseUnits);

    return {
      year,
      totalPopulation: Math.round(totalPop),
      malePop:         Math.round(pop.male.reduce((a, b) => a + b, 0)),
      femalePop:       Math.round(pop.female.reduce((a, b) => a + b, 0)),
      households,
      unitsNeeded,
      cumulativeNeedAboveBase: cumNeed,
      ageDistribution: {
        male:   pop.male.map(Math.round),
        female: pop.female.map(Math.round),
      },
    };
  };

  /**
   * Calculate housing units needed given projected households.
   * Formula: units = HH / (1 - vacancyTarget)
   */
  CohortComponentModel.prototype._calcUnitsNeeded = function (households) {
    return Math.round(households / (1 - this.vacancyTarget));
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function _emptyPop() {
    return { male: new Array(N_COHORTS).fill(0), female: new Array(N_COHORTS).fill(0) };
  }

  /**
   * Build a base population from DOLA SYA data.
   * dolaSyaData should be the object at data/hna/dola_sya/{countyFips}.json
   */
  CohortComponentModel.buildBasePopFromDola = function (dolaSyaData) {
    const pop = _emptyPop();
    if (!dolaSyaData || !dolaSyaData.pyramid) return pop;

    // DOLA SYA pyramid: { age: number, male: number, female: number }[]
    const pyramid = dolaSyaData.pyramid;
    pyramid.forEach(row => {
      const age = row.age;
      // Map single age to 5-year cohort index
      const idx = Math.min(Math.floor(age / 5), N_COHORTS - 1);
      pop.male[idx]   += row.male   || 0;
      pop.female[idx] += row.female || 0;
    });
    return pop;
  };

  // ---------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------

  window.CohortComponentModel = CohortComponentModel;
  window.CohortComponentModel.AGE_GROUPS     = AGE_GROUPS;
  window.CohortComponentModel.DEFAULT_SURVIVAL = DEFAULT_SURVIVAL;
})();
