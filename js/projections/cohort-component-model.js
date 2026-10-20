/**
 * cohort-component-model.js — COHO Analytics
 *
 * The Scenario Builder's population projection: single year of age and sex,
 * one year at a time, the cohort-component method the State Demography Office
 * (SDO) uses for Colorado's county forecast.
 *
 * It starts from SDO's forecast. data/hna/scenario-baseline/<county>.json
 * (scripts/hna/build_scenario_baseline.py) carries SDO's base population, the
 * scale factors that make Colorado's death and birth rates by age give SDO's
 * deaths and births each year, and SDO's migration by age, which is what its
 * forecast leaves after births and deaths. So with births, deaths and migration
 * all at 100% the model reproduces SDO's population by age, and its household
 * forecast. A scenario multiplies one or more of those three.
 *
 * Households: SDO's households by age of householder, as a rate on people of
 * that age in each year, applied to the scenario's people of that age.
 *
 * _step below is build_scenario_baseline.py step(); keep the two the same.
 *
 * Exposes: window.CohortComponentModel
 */
(function () {
  'use strict';

  const N_AGES = 101; // 0..99 and 100+
  const FIRST_FERTILE = 10;
  const LAST_FERTILE = 49;
  const DEFAULT_PARAMS = { births_pct: 100, deaths_pct: 100, migration_pct: 100 };

  function _pct(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n / 100 : fallback;
  }

  // One year: deaths from the population at the start of the year, survivors
  // one year older, births to women 10-49. Returns survivors and newborns.
  function _step(pm, pf, rates, kd, kb, deathsMult, birthsMult) {
    const sm = new Array(N_AGES).fill(0);
    const sf = new Array(N_AGES).fill(0);
    let deaths = 0;
    for (let a = 0; a < N_AGES; a++) {
      const rm = Math.min(1, rates.deathMale[a] * kd * deathsMult);
      const rf = Math.min(1, rates.deathFemale[a] * kd * deathsMult);
      deaths += pm[a] * rm + pf[a] * rf;
      const to = a < N_AGES - 1 ? a + 1 : a;
      sm[to] += pm[a] * (1 - rm);
      sf[to] += pf[a] * (1 - rf);
    }
    let births = 0;
    for (let a = FIRST_FERTILE; a <= LAST_FERTILE; a++) births += pf[a] * rates.birthByAge[a];
    births *= kb * birthsMult;
    const ratio = rates.sexRatioAtBirth;
    sm[0] += births * ratio / (1 + ratio);
    sf[0] += births / (1 + ratio);
    return { sm, sf, births, deaths };
  }

  function _households(pm, pf, groups, rates) {
    let hh = 0;
    groups.forEach(function (g, i) {
      let people = 0;
      for (let a = g.minAge; a <= g.maxAge; a++) people += pm[a] + pf[a];
      hh += people * rates[i];
    });
    return hh;
  }

  /**
   * Project one county from its baseline file.
   * @param {Object} baseline - data/hna/scenario-baseline/<county>.json
   * @param {Object} [params] - {births_pct, deaths_pct, migration_pct}; 100 = SDO's forecast
   * @returns {Array<{year, population, households, births, deaths, migration}>}
   *   one row per year from baseYear to endYear; the base year has no flows.
   */
  function project(baseline, params) {
    if (!baseline || !baseline.base || !baseline.steps || !baseline.rates) return [];
    const p = Object.assign({}, DEFAULT_PARAMS, params || {});
    const birthsMult = _pct(p.births_pct, 1);
    const deathsMult = _pct(p.deaths_pct, 1);
    const migMult = _pct(p.migration_pct, 1);
    const steps = baseline.steps;
    const groups = baseline.households.groups;
    const hhRates = baseline.households.ratesByYear;

    let pm = baseline.base.male.slice();
    let pf = baseline.base.female.slice();
    const rows = [{
      year: baseline.baseYear,
      population: _sum(pm) + _sum(pf),
      households: _households(pm, pf, groups, hhRates[0]),
      births: null, deaths: null, migration: null,
    }];
    for (let i = 0; i < steps.deathScale.length; i++) {
      const s = _step(pm, pf, baseline.rates, steps.deathScale[i], steps.birthScale[i], deathsMult, birthsMult);
      const mm = steps.migrationMale[i];
      const mf = steps.migrationFemale[i];
      let migration = 0;
      for (let a = 0; a < N_AGES; a++) {
        s.sm[a] += mm[a] * migMult;
        s.sf[a] += mf[a] * migMult;
        migration += (mm[a] + mf[a]) * migMult;
      }
      pm = s.sm;
      pf = s.sf;
      rows.push({
        year: baseline.baseYear + i + 1,
        population: _sum(pm) + _sum(pf),
        households: _households(pm, pf, groups, hhRates[i + 1]),
        births: s.births,
        deaths: s.deaths,
        migration: migration,
      });
    }
    return rows;
  }

  /**
   * The scenario's change from SDO's forecast, by year: what the scenario adds
   * to (or takes from) SDO's population and households. Zero at 100% on all
   * three, so a line drawn as SDO's figures plus this change is SDO's line
   * exactly when nothing is changed.
   */
  function changeFromSdo(baseline, params) {
    const run = project(baseline, params);
    const def = project(baseline, DEFAULT_PARAMS);
    return run.map(function (r, i) {
      return {
        year: r.year,
        population: r.population - def[i].population,
        households: r.households - def[i].households,
      };
    });
  }

  /**
   * SDO's net migration a year, averaged over the first `years` years of the
   * forecast (all of it when omitted): the migration the model carries at
   * 100%, so a slider label and the projection agree.
   */
  function averageAnnualMigration(baseline, years) {
    const steps = baseline && baseline.steps;
    if (!steps || !Array.isArray(steps.migrationMale) || !steps.migrationMale.length) return null;
    const n = Math.min(steps.migrationMale.length, Number.isFinite(years) && years > 0 ? years : Infinity);
    let total = 0;
    for (let i = 0; i < n; i++) total += _sum(steps.migrationMale[i]) + _sum(steps.migrationFemale[i]);
    return total / n;
  }

  /**
   * Parameters from a saved scenario. Scenarios saved before 2026-10-20 held
   * multipliers and a flat number of migrants a year, the same for every place.
   * The multipliers carry over as percentages, and the migrants a year become a
   * percentage of SDO's average for the place loaded (sdoAnnualMigration).
   * Where SDO expects no net arrivals, a number of migrants cannot be read as a
   * percentage, so migration stays at SDO's forecast and `migrationNote` says so.
   */
  function paramsFromSaved(saved, sdoAnnualMigration) {
    const s = saved || {};
    if (s.migration_pct != null || s.births_pct != null || s.deaths_pct != null) {
      return {
        births_pct: Number.isFinite(Number(s.births_pct)) ? Number(s.births_pct) : 100,
        deaths_pct: Number.isFinite(Number(s.deaths_pct)) ? Number(s.deaths_pct) : 100,
        migration_pct: Number.isFinite(Number(s.migration_pct)) ? Number(s.migration_pct) : 100,
        migrationNote: null,
      };
    }
    const out = {
      births_pct: Math.round(100 * (Number.isFinite(Number(s.fertility_multiplier)) ? Number(s.fertility_multiplier) : 1)),
      deaths_pct: Math.round(100 * (Number.isFinite(Number(s.mortality_multiplier)) ? Number(s.mortality_multiplier) : 1)),
      migration_pct: 100,
      migrationNote: null,
    };
    const annual = Number(s.net_migration_annual);
    if (!Number.isFinite(annual)) return out;
    if (Number.isFinite(sdoAnnualMigration) && sdoAnnualMigration > 0) {
      out.migration_pct = Math.max(0, Math.round(100 * annual / sdoAnnualMigration));
    } else {
      out.migrationNote = 'This scenario was saved as ' + Math.round(annual).toLocaleString('en-US') +
        ' people moving in a year. SDO expects more people to leave this place than arrive, so that number cannot be set as a share of its forecast; migration is at SDO’s forecast.';
    }
    return out;
  }

  function _sum(arr) {
    let t = 0;
    for (let i = 0; i < arr.length; i++) t += arr[i];
    return t;
  }

  window.CohortComponentModel = {
    project: project,
    changeFromSdo: changeFromSdo,
    averageAnnualMigration: averageAnnualMigration,
    paramsFromSaved: paramsFromSaved,
    DEFAULT_PARAMS: Object.freeze(Object.assign({}, DEFAULT_PARAMS)),
    N_AGES: N_AGES,
  };
})();
