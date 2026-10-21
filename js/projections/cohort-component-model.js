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
 * Migration can instead follow the ten years before the forecast
 * (migration_from: 'past'): the same residual by age from SDO's estimates,
 * averaged, each year in place of SDO's forecast migration, and the
 * percentage then multiplies that.
 *
 * Households: SDO's households by age of householder, as a rate on people of
 * that age in each year, applied to the scenario's people of that age. With
 * headship 'held' the base year's rates stay as they are every year in place
 * of the way SDO's forecast moves them (constant headship rates by age).
 *
 * Towns: townShares() and townProjection() give a town or CDP its share of
 * its county's people in each age group, from Hamilton-Perry projections of
 * the town and the county (data/hna/place-hamilton-perry.json), in place of
 * one share of the county's growth for every age (town_share:
 * 'hamilton_perry'). project() ignores the setting; it is the builder's.
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
  // What the Scenario Builder's sliders can set; a saved scenario is read
  // within these too, so the builder and the HNA page run the same settings.
  const RANGES = { births_pct: [50, 150], deaths_pct: [80, 120], migration_pct: [0, 200] };

  function _pct(v, fallback) {
    if (v == null || v === '') return fallback;
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

  // People and households in each household age group. A town's
  // Hamilton-Perry share differs by group, so a row carries both by group.
  function _byGroup(pm, pf, groups, rates) {
    const people = [];
    const households = [];
    let hh = 0;
    groups.forEach(function (g, i) {
      let n = 0;
      for (let a = g.minAge; a <= g.maxAge; a++) n += pm[a] + pf[a];
      people.push(n);
      households.push(n * rates[i]);
      hh += n * rates[i];
    });
    return { people: people, households: households, total: hh };
  }

  /**
   * Project one county from its baseline file.
   * @param {Object} baseline - data/hna/scenario-baseline/<county>.json
   * @param {Object} [params] - {births_pct, deaths_pct, migration_pct}; 100 = SDO's forecast;
   *   migration_from 'past' runs the baseline's past migration by age instead;
   *   headship 'held' keeps the base year's households per person by age
   * @returns {Array<{year, population, households, births, deaths, migration,
   *   groupPeople, groupHouseholds}>} one row per year from baseYear to
   *   endYear; the base year has no flows. groupPeople and groupHouseholds
   *   follow baseline.households.groups.
   */
  function project(baseline, params) {
    if (!baseline || !baseline.base || !baseline.steps || !baseline.rates) return [];
    const p = Object.assign({}, DEFAULT_PARAMS, params || {});
    const birthsMult = _pct(p.births_pct, 1);
    const deathsMult = _pct(p.deaths_pct, 1);
    const migMult = _pct(p.migration_pct, 1);
    const steps = baseline.steps;
    const past = p.migration_from === 'past' ? _pastProfile(baseline) : null;
    if (p.migration_from === 'past' && !past) return [];
    const groups = baseline.households.groups;
    const hhRates = baseline.households.ratesByYear;
    const held = p.headship === 'held';

    let pm = baseline.base.male.slice();
    let pf = baseline.base.female.slice();
    const g0 = _byGroup(pm, pf, groups, hhRates[0]);
    const rows = [{
      year: baseline.baseYear,
      population: _sum(pm) + _sum(pf),
      households: g0.total,
      births: null, deaths: null, migration: null,
      groupPeople: g0.people, groupHouseholds: g0.households,
    }];
    for (let i = 0; i < steps.deathScale.length; i++) {
      const s = _step(pm, pf, baseline.rates, steps.deathScale[i], steps.birthScale[i], deathsMult, birthsMult);
      const mm = past ? past.male : steps.migrationMale[i];
      const mf = past ? past.female : steps.migrationFemale[i];
      // Net departures at an age can exceed the people of that age: SDO's
      // above 100%, or the past's on a smaller cohort. No more than everyone
      // can leave, so a cohort stops at zero, and the departures it could not
      // supply come from everyone else in proportion to their numbers. The
      // year's net migration is then the one asked for while anyone is left;
      // clipping departures alone would keep the arrivals and could turn net
      // departures into net arrivals.
      let wanted = 0;
      let migration = 0;
      for (let a = 0; a < N_AGES; a++) {
        const wm = mm[a] * migMult;
        const wf = mf[a] * migMult;
        const m = Math.max(-s.sm[a], wm);
        const f = Math.max(-s.sf[a], wf);
        s.sm[a] += m;
        s.sf[a] += f;
        wanted += wm + wf;
        migration += m + f;
      }
      if (wanted < migration) {
        const left = _sum(s.sm) + _sum(s.sf);
        const keep = left > 0 ? Math.max(0, 1 - (migration - wanted) / left) : 0;
        for (let a = 0; a < N_AGES; a++) {
          s.sm[a] *= keep;
          s.sf[a] *= keep;
        }
        migration -= left * (1 - keep);
      }
      pm = s.sm;
      pf = s.sf;
      const g = _byGroup(pm, pf, groups, held ? hhRates[0] : hhRates[i + 1]);
      rows.push({
        year: baseline.baseYear + i + 1,
        population: _sum(pm) + _sum(pf),
        households: g.total,
        births: s.births,
        deaths: s.deaths,
        migration: migration,
        groupPeople: g.people,
        groupHouseholds: g.households,
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

  // The baseline's average migration by age over the years before the
  // forecast, or null when the file has none (an earlier build).
  function _pastProfile(baseline) {
    const past = baseline && baseline.pastMigration;
    if (!past || !Array.isArray(past.male) || !Array.isArray(past.female) ||
        past.male.length !== N_AGES || past.female.length !== N_AGES || !Array.isArray(past.years) || !past.years.length) return null;
    return past;
  }

  /**
   * Net migration a year the model carries at 100% with migration_from
   * 'past': SDO's estimates for the years before the forecast, averaged.
   * Null when the baseline has none.
   * @returns {{annual: number, from: number, to: number}|null}
   */
  function pastMigration(baseline) {
    const past = _pastProfile(baseline);
    if (!past) return null;
    return { annual: _sum(past.male) + _sum(past.female), from: past.years[0], to: past.years[past.years.length - 1] };
  }

  /**
   * Parameters from a saved scenario. Scenarios saved before 2026-10-20 held
   * multipliers and a flat number of migrants a year, the same for every place.
   * The multipliers carry over as percentages, and the migrants a year become a
   * percentage of SDO's average for the place loaded (sdoAnnualMigration),
   * signed: where SDO expects net departures, a saved 0 is 0% and a saved net
   * departure is a share of SDO's. A count in the opposite direction from SDO's
   * forecast cannot be a share of it, so migration is set to 0%, the nearest
   * setting; where SDO's average is zero or unknown it stays at SDO's forecast.
   * Every setting is held to RANGES, and `migrationNote` says when a saved
   * count could not be loaded as saved.
   */
  function paramsFromSaved(saved, sdoAnnualMigration) {
    const s = saved || {};
    if (s.migration_pct != null || s.births_pct != null || s.deaths_pct != null) {
      const out = {
        births_pct: _inRange('births_pct', _given(s.births_pct)),
        deaths_pct: _inRange('deaths_pct', _given(s.deaths_pct)),
        migration_pct: _inRange('migration_pct', _given(s.migration_pct)),
        migrationNote: null,
      };
      if (s.migration_from === 'past') out.migration_from = 'past';
      if (s.headship === 'held') out.headship = 'held';
      if (s.town_share === 'hamilton_perry') out.town_share = 'hamilton_perry';
      return out;
    }
    const fert = _given(s.fertility_multiplier);
    const mort = _given(s.mortality_multiplier);
    const out = {
      births_pct: _inRange('births_pct', fert == null ? null : Math.round(100 * fert)),
      deaths_pct: _inRange('deaths_pct', mort == null ? null : Math.round(100 * mort)),
      migration_pct: 100,
      migrationNote: null,
    };
    // A record that never set a migrant count keeps SDO's migration.
    const annual = _given(s.net_migration_annual);
    if (annual == null) return out;
    const n = Math.round(Math.abs(annual)).toLocaleString('en-US');
    const asSaved = 'This scenario was saved as ' +
      (annual < 0 ? n + ' more people leaving than arriving each year' : n + ' people moving in a year');
    const sdo = _given(sdoAnnualMigration);
    if (sdo == null || sdo === 0) {
      out.migrationNote = asSaved + '. ' + (sdo == null ? 'SDO’s migration forecast for this place is not available'
        : 'SDO’s forecast for this place has no net migration') + ' to take a share of, so migration is at SDO’s forecast.';
      return out;
    }
    const pct = Math.round(100 * annual / sdo);
    out.migration_pct = _inRange('migration_pct', pct);
    // The direction is read from the signs, not the rounded percentage, so a
    // small count the other way (-50 against 10,000) is not rounded to 0%
    // without a note.
    if (annual * sdo < 0) {
      out.migrationNote = asSaved + ', the opposite of SDO’s forecast for this place (' +
        (sdo < 0 ? 'more people leaving than arriving' : 'more people arriving than leaving') +
        '); migration is set to ' + RANGES.migration_pct[0] + '%, the nearest the builder models.';
    } else if (pct > RANGES.migration_pct[1]) {
      out.migrationNote = asSaved + ', more than ' + RANGES.migration_pct[1] / 100 +
        ' times SDO’s forecast for this place; migration is set to ' + RANGES.migration_pct[1] + '%, the most the builder models.';
    }
    return out;
  }

  /**
   * A town's share of its counties' people in each age group, by year: its
   * Hamilton-Perry projection over theirs, from data/hna/place-hamilton-perry.json
   * (scripts/hna/build_place_hamilton_perry.py). The file has 2020, 2030, 2040
   * and 2050; a year between two takes the straight line between them, and a
   * year after the last holds the last.
   * @param {Object} hp - the file
   * @param {string} geoid - the town's
   * @param {string[]} fipsList - its counties, from countiesFor()
   * @returns {function(number): number[]|null} for a year, the shares of
   *   people under 18 and then of each household group (hp.groups); null
   *   when the file has no projection for the town or one of its counties
   */
  function townShares(hp, geoid, fipsList) {
    const place = hp && hp.places && hp.places[geoid];
    const years = hp && hp.years;
    if (!place || !Array.isArray(years) || !Array.isArray(fipsList) || !fipsList.length) return null;
    const counties = fipsList.map(function (f) { return hp.counties && hp.counties[f]; });
    if (counties.some(function (c) { return !c; })) return null;
    const shares = years.map(function (_, t) {
      return place.people[t].map(function (v, g) {
        let total = 0;
        counties.forEach(function (c) { total += c.people[t][g]; });
        return total > 0 ? Math.min(1, v / total) : 0;
      });
    });
    return function (year) {
      if (year <= years[0]) return shares[0];
      for (let t = 1; t < years.length; t++) {
        if (year <= years[t]) {
          const w = (year - years[t - 1]) / (years[t] - years[t - 1]);
          return shares[t].map(function (s, g) { return shares[t - 1][g] + w * (s - shares[t - 1][g]); });
        }
      }
      return shares[shares.length - 1];
    };
  }

  /**
   * A town's people and households by year with Hamilton-Perry shares. Each
   * county's scenario is held to SDO's totals as the builder holds a county
   * (the scenario's change from the model's run of SDO, added to SDO's
   * figures) and spread over its age groups as the model has them; the town
   * takes its share of each group.
   * @param {Object[]} baselines - one per county, in the order of shareAt's counties
   * @param {Object} params - the scenario, as for project()
   * @param {function} shareAt - from townShares()
   * @returns {Array<{year, population, households: number[], migration}>}
   *   households from each county, in baselines' order; migration is the
   *   town's share of each county's people that year times the county's
   *   net migration, null in the base year
   */
  function townProjection(baselines, params, shareAt) {
    const runs = baselines.map(function (b) {
      return { run: project(b, params), def: project(b, DEFAULT_PARAMS), sdo: b.sdo };
    });
    if (!runs.length || runs.some(function (r) { return !r.run.length || !r.sdo; })) return [];
    const n = Math.min.apply(null, runs.map(function (r) {
      return Math.min(r.run.length, r.def.length, r.sdo.population.length, r.sdo.households.length);
    }));
    const out = [];
    for (let i = 0; i < n; i++) {
      const s = shareAt(runs[0].run[i].year);
      let population = 0;
      let migration = 0;
      const households = [];
      runs.forEach(function (r) {
        const row = r.run[i];
        const kp = row.population > 0 ? (row.population - r.def[i].population + r.sdo.population[i]) / row.population : 1;
        const kh = row.households > 0 ? (row.households - r.def[i].households + r.sdo.households[i]) / row.households : 1;
        let p = s[0] * (row.population - _sum(row.groupPeople));
        let h = 0;
        row.groupPeople.forEach(function (v, g) {
          p += s[g + 1] * v;
          h += s[g + 1] * row.groupHouseholds[g];
        });
        population += p * kp;
        households.push(h * kh);
        if (i > 0 && row.population > 0) migration += row.migration * p / row.population;
      });
      out.push({ year: runs[0].run[i].year, population: population, households: households, migration: i > 0 ? migration : null });
    }
    return out;
  }

  /**
   * The counties whose SDO forecast a geography's scenario runs on. The
   * Scenario Builder and the HNA page's saved-scenario line both use this, so
   * a scenario covers the same counties on both: a county itself; a town or
   * CDP with a place-ledger share, every county it sits in
   * (cross-county-places.json); any other place, its containing county.
   * @param {Object} geo - {type, geoid, containingCounty}
   * @param {Object} [ledgerRec] - the place ledger row, if any
   * @param {Object} [crossRec] - cross-county-places.json places[geoid], if any
   */
  function countiesFor(geo, ledgerRec, crossRec) {
    if (!geo || !geo.geoid) return [];
    if (geo.type === 'county') return [geo.geoid];
    if (ledgerRec && ledgerRec.shares && _given(ledgerRec.shares.blended) != null) {
      if (crossRec && Array.isArray(crossRec.all_counties) && crossRec.all_counties.length) {
        return crossRec.all_counties.map(function (m) { return m.fips; });
      }
      return [ledgerRec.containing_county || geo.containingCounty].filter(Boolean);
    }
    return [geo.containingCounty].filter(Boolean);
  }

  // A saved number, or null when it is absent: Number(null) is 0, and a
  // setting that was never saved is not a setting of zero.
  function _given(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function _inRange(key, v) {
    if (v == null) return DEFAULT_PARAMS[key];
    return Math.min(RANGES[key][1], Math.max(RANGES[key][0], v));
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
    pastMigration: pastMigration,
    paramsFromSaved: paramsFromSaved,
    countiesFor: countiesFor,
    townShares: townShares,
    townProjection: townProjection,
    DEFAULT_PARAMS: Object.freeze(Object.assign({}, DEFAULT_PARAMS)),
    RANGES: Object.freeze(Object.assign({}, RANGES)),
    N_AGES: N_AGES,
  };
})();
