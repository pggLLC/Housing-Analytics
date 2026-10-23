/**
 * scenario-builder.js — COHO Analytics
 *
 * Interactive UI controller for the projection scenario builder page.
 * Wires slider inputs → CohortComponentModel → Chart.js results chart.
 *
 * The projection starts from the State Demography Office's (SDO) forecast for
 * the county (data/hna/scenario-baseline/<county>.json). Each slider is a
 * percentage of SDO's births, deaths or migration, so 100% on all three is
 * SDO's forecast. Homes needed take the same form as the HNA page's 20-year
 * figure: the rise in homes the projected households need at the county's
 * target vacancy, plus homes for a quarter of today's in-commuter households
 * at or below 120% AMI. A town or CDP takes its share of the county's growth, the
 * share the HNA page uses (data/hna/projections/places.json), so with the
 * sliders at 100% the builder and the HNA page give the same number. It can
 * instead take a share of each age group from Hamilton-Perry projections of
 * the town and its county (data/hna/place-hamilton-perry.json).
 *
 * Dependencies (must be loaded before this script):
 *   - js/projections/cohort-component-model.js
 *   - js/projections/scenario-presets.js
 *   - js/projections/scenario-storage.js
 *   - Chart.js (CDN)
 *   - js/fetch-helper.js
 *
 * Exposes: window.ScenarioBuilder
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const HORIZON_YEARS = 20;

  const BUILT_IN_SCENARIOS = ((window.ScenarioPresets && window.ScenarioPresets.list) || []).map(function (preset) {
    return {
      id: preset.key,
      label: preset.label,
      params: Object.assign({}, preset.params),
    };
  });

  /* F156 — Was storing literal "var(--accent)" strings here and handing them
     straight to Chart.js as borderColor. Chart.js's color parser doesn't
     resolve CSS variables — it silently falls back to Chart.defaults
     .borderColor (#374151 muted-gray) for every dataset, so the legend
     swatches looked correct (they're rendered with the rgba bg) while the
     actual lines were all the SAME gray drawn on top of each other. On
     dark-mode mobile the gray dropped to ~1.4:1 against the navy chart bg
     and the lines disappeared. _resolveColors() reads the CSS vars at
     build time so the chart gets actual RGB strings and re-render on
     theme change picks up the brighter dark-mode variants. */
  const SCENARIO_CSS_VARS = {
    'baseline':    { borderVar: '--accent',  bgFallback: 'rgba(9,110,101,0.15)' },
    'low_growth':  { borderVar: '--warn',    bgFallback: 'rgba(168,70,8,0.15)'  },
    'high_growth': { borderVar: '--info',    bgFallback: 'rgba(29,78,216,0.15)' },
    'custom':      { borderVar: '--accent2', bgFallback: 'rgba(200,111,13,0.15)'},
    // The shaded range around SDO's forecast, in its line's colour.
    'band':        { borderVar: '--accent',  bgFallback: 'rgba(9,110,101,0.15)' },
  };

  function _resolveColors() {
    var cs = window.getComputedStyle(document.documentElement);
    function pick(name, fallback) {
      var v = (cs.getPropertyValue(name) || '').trim();
      return v || fallback;
    }
    function withAlpha(color, alpha) {
      // Hex → rgba
      var m = color.match(/^#([0-9a-f]{6})$/i);
      if (m) {
        var r = parseInt(m[1].slice(0, 2), 16);
        var g = parseInt(m[1].slice(2, 4), 16);
        var b = parseInt(m[1].slice(4, 6), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
      }
      var rgb = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
      if (rgb) return 'rgba(' + rgb[1] + ',' + rgb[2] + ',' + rgb[3] + ',' + alpha + ')';
      return color;
    }
    var out = {};
    Object.keys(SCENARIO_CSS_VARS).forEach(function (id) {
      var def = SCENARIO_CSS_VARS[id];
      var border = pick(def.borderVar, null) || def.bgFallback;
      out[id] = {
        border: border,
        bg:     withAlpha(border, 0.15),
      };
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let _chart = null;
  let _ctx = null;                // contextFor(): counties, share, vacancy, in-commuters
  let _geography = null;          // { geoid, displayName } of the loaded base population
  let _unavailableReason = null;  // why no projection is shown, when one is not
  // What the reader chose migration's 100% to be. It outlasts the moment
  // between choosing a new place and loading it, when there is no past to
  // offer; only a loaded place without one turns it back to SDO's forecast.
  let _migrationChoice = 'sdo';
  let _bound = false;
  let _activeResults = {}; // scenarioId → homesSeries rows
  let _forecastError = null; // data/hna/forecast-error.json, once the page has it

  // ---------------------------------------------------------------------------
  // Projection → homes
  // ---------------------------------------------------------------------------

  const _defaultRuns = new WeakMap();
  function _defaultRun(baseline) {
    let run = _defaultRuns.get(baseline);
    if (!run) {
      run = window.CohortComponentModel.project(baseline, window.CohortComponentModel.DEFAULT_PARAMS);
      _defaultRuns.set(baseline, run);
    }
    return run;
  }

  function _num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * The counties whose forecasts a geography draws on: CohortComponentModel's
   * countiesFor, which the HNA page's saved-scenario line uses too. `data`
   * needs only { ledger, cross } (see contextFor).
   */
  function countiesFor(geo, data) {
    if (!geo || !geo.geoid) return [];
    const d = data || {};
    return window.CohortComponentModel.countiesFor(geo, (d.ledger || {})[geo.geoid], (d.cross || {})[geo.geoid]);
  }

  function _pctText(v) {
    const p = Math.round(v * 1000) / 10;
    return (p % 1 === 0 ? p.toFixed(0) : p.toFixed(1)) + '%';
  }

  // "Mesa County", or "Jefferson and Adams counties".
  function _countiesText(ctx) {
    const names = ctx.counties.map(c => c.name);
    return names.length === 1 ? names[0]
      : names.map(n => n.replace(/ County$/, '')).slice(0, -1).join(', ') + ' and ' +
        names[names.length - 1].replace(/ County$/, '') + ' counties';
  }

  /** One sentence on where the loaded figures come from, for the status line. */
  function describeContext(ctx) {
    if (!ctx || !ctx.counties || !ctx.counties.length) return (ctx && ctx.unavailableReason) || '';
    const vintage = String(ctx.counties[0].baseline.vintage || '').replace(/\s+Prepared\s+/i, ', prepared ');
    const names = ctx.counties.map(c => c.name);
    const where = _countiesText(ctx);
    const vac = ctx.counties.every(c => c.vacancy == null) ? null
      : (ctx.counties.length === 1
        ? 'Homes use the county\u2019s target vacancy, ' + _pctText(ctx.counties[0].vacancy) + ', as on the HNA page.'
        : 'Homes use each county\u2019s target vacancy, as on the HNA page.');
    let lead;
    if (ctx.isCounty) {
      lead = 'Loaded the State Demography Office\u2019s forecast for ' + where + (vintage ? ' (' + vintage + ')' : '') + '.';
    } else if (ctx.basis === 'ledger') {
      const permits = ctx.shares && _num(ctx.shares.permit) != null;
      lead = ctx.displayName + ' takes ' + _pctText(ctx.share) + ' of the forecast growth of ' + where +
        ', the share the HNA page uses: from its share of ' +
        (names.length === 1 ? 'the county\u2019s' : 'their') + ' households' +
        (permits ? ' and of ' + (names.length === 1 ? 'its' : 'their') + ' building permits in ' + (ctx.shares.permit_window || '2020-2024').replace('-', '\u2013') : '') + '.';
    } else {
      lead = ctx.displayName + ' takes ' + _pctText(ctx.share) + ' of the forecast growth of ' + where +
        ', its share of the county\u2019s people. It has no row in the HNA page\u2019s place ledger, so the HNA page uses the same share.';
    }
    return vac ? lead + ' ' + vac : lead;
  }

  /**
   * What the builder needs for one geography, from the files the page loads.
   *   geo:  { geoid, name, type, containingCounty, population, inCommuters, inCommutersHigh }
   *   data: { baselines: {fips: scenario-baseline file}, projections: {fips: projections file},
   *           ledger: places.json `places`, cross: cross-county-places.json `places`,
   *           hamiltonPerry: place-hamilton-perry.json, for a town }
   * A town or CDP takes the share of county growth the HNA page uses: its
   * blended share in the place ledger, applied to all the counties it sits in,
   * or, for the few places the ledger lacks, its share of the county's people.
   * Returns { unavailableReason } when a part is missing.
   */
  function contextFor(geo, data) {
    const d = data || {};
    const name = (geo && geo.name) || (geo && geo.geoid) || 'This place';
    if (!geo || !geo.geoid) return { unavailableReason: 'No geography was chosen.' };
    const isCounty = geo.type === 'county';
    const fipsList = countiesFor(geo, d);
    let share = 1;
    let shares = null;
    let published = null;
    let basis;
    if (isCounty) {
      const p = (d.projections || {})[geo.geoid];
      const hn = p && p.housing_need;
      published = hn && Array.isArray(hn.incremental_units_needed_dola)
        ? { years: p.years, homes: hn.incremental_units_needed_dola } : null;
      basis = 'county';
    } else {
      const rec = (d.ledger || {})[geo.geoid];
      const blended = rec && rec.shares ? _num(rec.shares.blended) : null;
      if (blended != null) {
        share = blended;
        shares = rec.shares;
        published = Array.isArray(rec.incremental_units_needed)
          ? { years: rec.years, homes: rec.incremental_units_needed } : null;
        basis = 'ledger';
      } else {
        const c = geo.containingCounty;
        const p = (d.projections || {})[c];
        const base = p && Array.isArray(p.population_dola) ? _num(p.population_dola[0]) : null;
        const pop = _num(geo.population);
        if (!c || pop == null || pop <= 0 || base == null || base <= 0) {
          return { unavailableReason: name + ' has no population on file to take a share of its county\u2019s growth, so no projection is shown.' };
        }
        share = Math.min(pop / base, 1);
        const hn = p.housing_need;
        published = hn && Array.isArray(hn.incremental_units_needed_dola)
          ? { years: p.years, homes: hn.incremental_units_needed_dola.map(v => (_num(v) == null ? null : _num(v) * share)) } : null;
        basis = 'population_share';
      }
    }
    // Hamilton-Perry shares by age, when the town has them; otherwise why not.
    let townShares = null;
    let townSharesReason = null;
    if (!isCounty) {
      const hp = d.hamiltonPerry;
      townShares = hp ? window.CohortComponentModel.townShares(hp, geo.geoid, fipsList) : null;
      if (!townShares) townSharesReason = _hamiltonPerryReason(hp, geo.geoid, name);
    }
    const counties = [];
    for (const fips of fipsList) {
      const baseline = (d.baselines || {})[fips];
      if (!baseline) {
        return { unavailableReason: 'The State Demography Office forecast for ' + name + ' could not be loaded, so no projection is shown. Try Load Geography Data again.' };
      }
      const p = (d.projections || {})[fips];
      const v = p && p.housing_need ? _num(p.housing_need.target_vacancy) : null;
      counties.push({ geoid: fips, name: baseline.name || fips, baseline, vacancy: v != null && v >= 0 && v < 1 ? v : null });
    }
    return {
      geoid: geo.geoid,
      displayName: geo.name || geo.geoid,
      type: geo.type,
      isCounty,
      share,
      shares,
      basis,
      placePop: isCounty ? null : _num(geo.population),
      counties,
      published,
      townShares,
      townSharesReason,
      inCommuters: _num(geo.inCommuters),
      inCommutersHigh: _num(geo.inCommutersHigh),
    };
  }

  function _hamiltonPerryReason(hp, geoid, name) {
    if (!hp) return 'The Census counts by age did not load, so shares by age are not available. Try Load Geography Data again.';
    const out = hp.leftOut && hp.leftOut[geoid];
    if (out && out.reason === 'new_in_2020') {
      return name + ' was first counted in the 2020 Census, so there is no 2010 count by age to carry forward.';
    }
    if (out && out.reason === 'changed_too_much') {
      const n = (v) => Number(v).toLocaleString('en-US');
      return name + (out.population2020 >= out.population2010 ? ' grew' : ' fell') + ' from ' + n(out.population2010) +
        ' people in 2010 to ' + n(out.population2020) + ' in 2020. Hamilton-Perry would repeat that every ten years, ' +
        'so shares by age are offered only where the 2020 count was between two-thirds and one and a half times the 2010 count.';
    }
    return 'There are no Census counts by age on file for ' + name + ', so shares by age are not available.';
  }

  /**
   * Population, households added and homes needed by year for one scenario.
   *
   * Each county runs the cohort-component model with the scenario's
   * percentages. The scenario's change from the model's own run of SDO's
   * forecast is added to SDO's published figures, so with every slider at
   * 100% the builder shows SDO's households and the HNA page's homes exactly,
   * not the model's copy of them to within rounding.
   *
   * Homes needed are the rise from the base year in households ÷ (1 − the
   * county's target vacancy); no count of today's homes enters, as on the HNA
   * page. A town takes its share of every county it sits in, or, with
   * town_share 'hamilton_perry', its share of each age group.
   */
  function homesSeries(ctx, params) {
    if (!ctx || !Array.isArray(ctx.counties) || !ctx.counties.length || !window.CohortComponentModel) return [];
    const M = window.CohortComponentModel;
    if (params && params.town_share === 'hamilton_perry' && !ctx.isCounty && ctx.townShares) {
      return _hamiltonPerrySeries(ctx, params);
    }
    const share = Number.isFinite(ctx.share) ? ctx.share : 1;
    const runs = ctx.counties.map(c => ({
      run: M.project(c.baseline, params),
      def: _defaultRun(c.baseline),
      sdo: c.baseline.sdo,
      vacancy: c.vacancy,
    }));
    const n = Math.min.apply(null, runs.map(r => Math.min(r.run.length, r.def.length, r.sdo.population.length, r.sdo.households.length)));
    if (!n) return [];
    const noVacancy = runs.some(r => r.vacancy == null);
    const published = {};
    if (ctx.published && Array.isArray(ctx.published.years)) {
      ctx.published.years.forEach((y, i) => {
        const h = _num(ctx.published.homes[i]);
        if (h != null) published[Number(y)] = h;
      });
    }
    const basePop = ctx.isCounty
      ? runs.reduce((t, r) => t + r.sdo.population[0], 0)
      : (Number.isFinite(ctx.placePop) ? ctx.placePop : null);

    const out = [];
    let offset = 0;
    for (let i = 0; i < n; i++) {
      let pop = 0, hh = 0, homes = 0, homesSdo = 0, mig = 0;
      runs.forEach(r => {
        const run = r.run, def = r.def, sdo = r.sdo;
        const dPop = (run[i].population - run[0].population) - (def[i].population - def[0].population) + (sdo.population[i] - sdo.population[0]);
        const dHH = (run[i].households - run[0].households) - (def[i].households - def[0].households) + (sdo.households[i] - sdo.households[0]);
        pop += dPop;
        hh += dHH;
        if (r.vacancy != null) {
          homes += dHH / (1 - r.vacancy);
          homesSdo += (sdo.households[i] - sdo.households[0]) / (1 - r.vacancy);
        }
        if (i > 0) mig += run[i].migration;
      });
      const year = runs[0].run[i].year;
      // The published series carries the HNA page's rounding; after its last
      // year the last difference carries on.
      if (published[year] != null) offset = published[year] - share * homesSdo;
      out.push({
        year,
        population: basePop == null ? null : basePop + share * pop,
        householdsAdded: share * hh,
        homesNeeded: noVacancy ? null : share * homes + offset,
        migration: i > 0 ? share * mig : null,
      });
    }
    return out;
  }

  // A town by age: its people and households from townProjection(), each
  // county's households at that county's vacancy. Nothing ties it to the HNA
  // page's published series, which uses one share for every age.
  function _hamiltonPerrySeries(ctx, params) {
    const rows = window.CohortComponentModel.townProjection(ctx.counties.map(c => c.baseline), params, ctx.townShares);
    if (!rows.length) return [];
    const noVacancy = ctx.counties.some(c => c.vacancy == null);
    const basePop = Number.isFinite(ctx.placePop) ? ctx.placePop : null;
    const first = rows[0];
    const total = (r) => r.households.reduce((t, v) => t + v, 0);
    return rows.map(r => ({
      year: r.year,
      population: basePop == null ? null : basePop + r.population - first.population,
      householdsAdded: total(r) - total(first),
      homesNeeded: noVacancy ? null
        : r.households.reduce((t, v, c) => t + (v - first.households[c]) / (1 - ctx.counties[c].vacancy), 0),
      migration: r.migration,
    }));
  }

  /** The 20-year figure: resident growth plus today's in-commuters, as on the HNA page. */
  function twentyYearFigure(series, ctx) {
    if (!series || !series.length) return null;
    const end = series.find(r => r.year === series[0].year + HORIZON_YEARS);
    if (!end || end.homesNeeded == null) return null;
    const growth = Math.round(end.homesNeeded);
    const inc = ctx && Number.isFinite(ctx.inCommuters) ? Math.round(ctx.inCommuters) : null;
    return { year: end.year, growth, inCommuters: inc, total: inc == null ? growth : growth + inc };
  }

  /**
   * Where 2 in 3 past forecasts for a place of this size landed, around SDO's
   * line. data/hna/forecast-error.json (scripts/hna/build_forecast_error.py)
   * gives the population error by years out for each size of county; here it
   * is that share of the place's population each year, in homes at SDO's
   * households per person and the county's target vacancy. The record runs
   * 20 years out, so the range stops there. Empty without the error file, the
   * place's population or a county's vacancy.
   */
  function bandSeries(rows, ctx, fe) {
    if (fe === undefined) fe = _forecastError;
    if (!ctx || !rows || !rows.length || !fe || !Array.isArray(fe.errorPct) || !Array.isArray(fe.sizeClasses)) return [];
    const pop0 = _num(rows[0].population);
    if (pop0 == null || pop0 <= 0 || ctx.counties.some(c => c.vacancy == null)) return [];
    const k = fe.sizeClasses.findIndex(s => pop0 >= s.min && (s.max == null || pop0 < s.max));
    const errs = k < 0 ? null : fe.errorPct[k];
    if (!Array.isArray(errs)) return [];
    return rows.map((r, i) => {
      const e = i === 0 ? 0 : _num(errs[i - 1]);
      if (e == null || r.homesNeeded == null || r.population == null) return null;
      let homes = 0, people = 0;
      ctx.counties.forEach(c => {
        homes += c.baseline.sdo.households[i] / (1 - c.vacancy);
        people += c.baseline.sdo.population[i];
      });
      const w = (e / 100) * r.population * homes / people;
      return { year: r.year, low: r.homesNeeded - w, high: r.homesNeeded + w, errorPct: e, sizeClass: fe.sizeClasses[k] };
    });
  }

  // SDO's net migration a year for the loaded place, averaged over the 20
  // years the key numbers cover, so the slider's 100% reads as people.
  function _sdoAnnualMigration() {
    if (!_ctx || !_ctx.counties) return null;
    let total = 0;
    for (const c of _ctx.counties) {
      const avg = window.CohortComponentModel.averageAnnualMigration(c.baseline, HORIZON_YEARS);
      if (avg == null) return null;
      total += avg;
    }
    return total * (Number.isFinite(_ctx.share) ? _ctx.share : 1);
  }

  // The same for the years before SDO's forecast, at the same share, and those
  // years; null when a county's file has none.
  function _pastMigration() {
    if (!_ctx || !_ctx.counties) return null;
    let total = 0;
    let span = null;
    for (const c of _ctx.counties) {
      const past = window.CohortComponentModel.pastMigration(c.baseline);
      if (!past) return null;
      total += past.annual;
      span = span || past;
    }
    return { annual: total * (Number.isFinite(_ctx.share) ? _ctx.share : 1), from: span.from, to: span.to };
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  /**
   * opts: a context from contextFor() (counties, share, ...), or
   * { unavailableReason } to clear the page with that explanation.
   */
  function init(opts) {
    opts = opts || {};

    // init() runs again on every geography load; bind controls only once so
    // one click does not fire once per earlier load.
    if (!_bound) {
      _bindSliders();
      _bindMigrationFrom();
      _bindHeadship();
      _bindTownShare();
      _bindScenarioButtons();
      _bindSaveLoad();
      _listenI18n();
      _bound = true;
    }
    _renderSavedList();

    // Each call replaces the projection outright. A call without county data
    // (first arrival, or a failed load) clears the previous geography instead
    // of leaving it in place under a new name. There is no placeholder
    // population: until a geography's own data loads, no projection is shown.
    const ok = Array.isArray(opts.counties) && opts.counties.length > 0;
    _ctx = ok ? opts : null;
    _geography = ok ? { geoid: opts.geoid || null, displayName: opts.displayName || null } : null;
    _unavailableReason = ok ? null : (opts.unavailableReason || null);
    _activeResults = {};

    _updateMigrationHelp();
    _updateHeadshipHelp();
    _updateTownShareHelp();
    _runAllBuiltIn();
    _dispatchState();
  }

  // The page fetches the error file on its own, so a slow or failed fetch never
  // holds up a projection; the range appears when the file does.
  function setForecastError(fe) {
    _forecastError = fe && Array.isArray(fe.errorPct) && Array.isArray(fe.sizeClasses) ? fe : null;
    if (_ctx) _updateChart();
  }

  function _dispatchState() {
    try {
      document.dispatchEvent(new CustomEvent('scenario-builder:state', {
        detail: { geography: _geography, unavailableReason: _unavailableReason }
      }));
    } catch (_) { /* old browsers: the page still renders the unavailable state */ }
  }

  function _hasBase() {
    return !!(_ctx && window.CohortComponentModel);
  }

  // ---------------------------------------------------------------------------
  // Slider bindings
  // ---------------------------------------------------------------------------

  const SLIDERS = [
    { id: 'sbBirthsPct', key: 'births_pct' },
    { id: 'sbDeathsPct', key: 'deaths_pct' },
    { id: 'sbMigrationPct', key: 'migration_pct' },
  ];

  function _bindSliders() {
    SLIDERS.forEach(function (def) {
      const slider = document.getElementById(def.id);
      const display = document.getElementById(def.id + 'Val');
      if (!slider) return;
      slider.addEventListener('input', () => {
        if (display) display.textContent = Number(slider.value).toFixed(0) + '%';
        _clearActiveBtn();
        _debouncedRunAndAnnounce();
      });
    });
  }

  // Which migration the percentage scales: SDO's forecast, or the years
  // before it ('past'), when the loaded place's files have them.
  function _migrationFrom() {
    const el = document.querySelector('input[name="sbMigrationFrom"][value="past"]');
    return el && el.checked && !el.disabled ? 'past' : 'sdo';
  }

  function _bindMigrationFrom() {
    document.querySelectorAll('input[name="sbMigrationFrom"]').forEach(el => {
      el.addEventListener('change', () => {
        if (el.checked) _migrationChoice = el.value === 'past' ? 'past' : 'sdo';
        _clearActiveBtn();
        _updateMigrationHelp();
        _runCustom();
        _announceResult();
      });
    });
  }

  function _getSliderParams() {
    const out = {};
    SLIDERS.forEach(function (def) {
      const el = document.getElementById(def.id);
      const v = el ? Number(el.value) : NaN;
      out[def.key] = Number.isFinite(v) ? v : 100;
    });
    if (_migrationFrom() === 'past') out.migration_from = 'past';
    if (_headshipChoice() === 'held') out.headship = 'held';
    if (_townShareChoice() === 'hamilton_perry') out.town_share = 'hamilton_perry';
    return out;
  }

  function _applyScenarioToSliders(params) {
    SLIDERS.forEach(function (def) {
      const el = document.getElementById(def.id);
      const display = document.getElementById(def.id + 'Val');
      const v = Number(params[def.key]);
      const value = Number.isFinite(v) ? v : 100;
      if (el) el.value = value;
      if (display) display.textContent = value.toFixed(0) + '%';
    });
    _migrationChoice = params.migration_from === 'past' ? 'past' : 'sdo';
    _updateMigrationHelp();
    const headship = document.querySelector('input[name="sbHeadship"][value="' +
      (params.headship === 'held' ? 'held' : 'sdo') + '"]');
    if (headship) headship.checked = true;
    _updateHeadshipHelp();
    _townShareWanted = params.town_share === 'hamilton_perry';
    _updateTownShareHelp();
  }

  // What 100% means for the place loaded, in people a year: SDO's forecast,
  // and the years before it, whichever the percentage scales first.
  function _updateMigrationHelp() {
    const el = document.getElementById('sbMigrationSdo');
    const basis = document.getElementById('sbMigrationBasis');
    const pastRadio = document.querySelector('input[name="sbMigrationFrom"][value="past"]');
    const pastLabel = document.getElementById('sbMigrationFromPast');
    const past = _geography ? _pastMigration() : null;
    if (_geography && !past) _migrationChoice = 'sdo';
    if (pastRadio) pastRadio.disabled = !past;
    const shown = document.querySelector('input[name="sbMigrationFrom"][value="' +
      (past && _migrationChoice === 'past' ? 'past' : 'sdo') + '"]');
    if (shown) shown.checked = true;
    const span = past ? past.from + '\u2013' + past.to : null;
    if (pastLabel && span) pastLabel.textContent = span + ', as SDO estimated it';
    const fromPast = _migrationFrom() === 'past';
    const slider = document.getElementById('sbMigrationPct');
    if (slider) {
      slider.setAttribute('aria-label', 'People moving in minus people moving out, as a percentage of ' +
        (fromPast ? 'the ' + span + ' average' : 'SDO\u2019s forecast'));
    }
    if (basis) {
      basis.textContent = fromPast
        ? '100% = the ' + span + ' average, by age, from SDO\u2019s estimates.'
        : '100% = SDO\'s forecast of people moving in minus people moving out.';
    }
    if (!el) return;
    const avg = _sdoAnnualMigration();
    if (avg == null || !_geography) {
      el.textContent = '';
      return;
    }
    const count = (v) => 'about ' + Math.round(Math.abs(v)).toLocaleString('en-US');
    const where = _geography.displayName || 'this place';
    const atShare = _ctx && !_ctx.isCounty ? ', at the same share of the county\u2019s estimates' : '';
    const sdoText = avg >= 0
      ? 'SDO’s forecast for ' + where + ': ' + count(avg) + ' more people arrive than leave each year'
      : 'SDO’s forecast for ' + where + ': ' + count(avg) + ' more people leave than arrive each year';
    const pastText = past ? 'In ' + span + atShare + ', ' + count(past.annual) +
      (past.annual >= 0 ? ' more people arrived than left each year' : ' more people left than arrived each year') : null;
    // A higher percentage means more leave where the migration it scales is
    // a net departure.
    const leaving = (fromPast ? past.annual : avg) < 0 ? ', so a higher percentage means more leave' : '';
    el.textContent = fromPast
      ? pastText + leaving + '. ' + sdoText + '.'
      : sdoText + leaving + '.' + (pastText ? ' ' + pastText + '.' : '');
  }

  // Households per person by age: as SDO's forecast moves them, or held at
  // the base year's ('held'), the constant-headship alternative.
  function _headshipChoice() {
    const el = document.querySelector('input[name="sbHeadship"][value="held"]');
    return el && el.checked ? 'held' : 'sdo';
  }

  function _bindHeadship() {
    document.querySelectorAll('input[name="sbHeadship"]').forEach(el => {
      el.addEventListener('change', () => {
        _clearActiveBtn();
        _updateHeadshipHelp();
        _runCustom();
        _announceResult();
      });
    });
  }

  // The rates for the place loaded, in the base year and twenty years on in
  // SDO's forecast. A town takes its share of its county's households, so its
  // county's rates are the ones that apply; a place in several counties runs
  // each county's own, too many to list here.
  function _updateHeadshipHelp() {
    const el = document.getElementById('sbHeadshipHelp');
    const label = document.getElementById('sbHeadshipHeldLabel');
    const c = _ctx && _ctx.counties && _ctx.counties.length === 1 ? _ctx.counties[0].baseline : null;
    const base = _ctx && _ctx.counties ? _ctx.counties[0].baseline.baseYear : null;
    if (label && base) label.textContent = 'Held at ' + base + '\u2019s';
    if (!el) return;
    if (!_ctx) {
      el.textContent = '';
      return;
    }
    const held = _headshipChoice() === 'held';
    const hh = c && c.households;
    const end = hh && hh.ratesByYear[HORIZON_YEARS];
    if (!end) {
      el.textContent = held
        ? 'Each county\u2019s ' + base + ' households per person in each age group stay the same every year.'
        : 'SDO\u2019s forecast moves each county\u2019s households per person in each age group over time.';
      return;
    }
    const r = (v) => v.toFixed(2);
    const ages = hh.groups.map(g => g.maxAge >= 100 ? g.minAge + ' and over' : g.minAge + '\u2013' + g.maxAge);
    const year = base + HORIZON_YEARS;
    const where = c.name || 'this county';
    el.textContent = held
      ? where + '\u2019s ' + base + ' households per person stay the same every year: ' +
        ages.map((a, i) => a + ' ' + r(hh.ratesByYear[0][i])).join(', ') + '. SDO\u2019s forecast moves them to ' +
        end.slice(0, -1).map(r).join(', ') + ' and ' + r(end[end.length - 1]) + ' by ' + year + '.'
      : 'SDO\u2019s forecast moves households per person in each age group. ' + where + ', ' + base + ' to ' + year + ': ' +
        ages.map((a, i) => a + ' from ' + r(hh.ratesByYear[0][i]) + ' to ' + r(end[i])).join(', ') + '.';
  }

  // A town's share of its county: the HNA page's, one share of growth for
  // every age, or Hamilton-Perry's for each age group. Only for a town that
  // has Hamilton-Perry shares; the choice is remembered across a load that
  // cannot use it, as the migration choice is.
  let _townShareWanted = false;

  function _townShareChoice() {
    const el = document.querySelector('input[name="sbTownShare"][value="hamilton_perry"]');
    return el && el.checked && !el.disabled ? 'hamilton_perry' : 'hna';
  }

  function _bindTownShare() {
    document.querySelectorAll('input[name="sbTownShare"]').forEach(el => {
      el.addEventListener('change', () => {
        if (el.checked) _townShareWanted = el.value === 'hamilton_perry';
        _clearActiveBtn();
        _updateTownShareHelp();
        _runCustom();
        _announceResult();
      });
    });
  }

  // The town's share of its county's people in each age group, now and
  // twenty years on, beside the one share the HNA page uses.
  function _updateTownShareHelp() {
    const group = document.getElementById('sbTownShareGroup');
    const el = document.getElementById('sbTownShareHelp');
    const hpRadio = document.querySelector('input[name="sbTownShare"][value="hamilton_perry"]');
    const town = _ctx && !_ctx.isCounty;
    if (group) group.hidden = !town;
    if (hpRadio) hpRadio.disabled = !(town && _ctx.townShares);
    const shown = document.querySelector('input[name="sbTownShare"][value="' +
      (town && _ctx.townShares && _townShareWanted ? 'hamilton_perry' : 'hna') + '"]');
    if (shown) shown.checked = true;
    if (!el) return;
    if (!town) {
      el.textContent = '';
      return;
    }
    const where = _countiesText(_ctx);
    const whose = where + (/s$/.test(where) ? '’' : '’s');
    const hna = 'The HNA page gives ' + _ctx.displayName + ' ' + _pctText(_ctx.share) + ' of ' + whose + ' growth at every age.';
    if (!_ctx.townShares) {
      el.textContent = hna + ' ' + _ctx.townSharesReason;
      return;
    }
    const base = _ctx.counties[0].baseline.baseYear;
    const end = base + HORIZON_YEARS;
    const now = _ctx.townShares(base);
    const later = _ctx.townShares(end);
    const groups = _ctx.counties[0].baseline.households.groups;
    const ages = ['under 18'].concat(groups.map(g => g.maxAge >= 100 ? g.minAge + ' and over' : g.minAge + '–' + g.maxAge));
    const byAge = ages.map((a, i) => a + ' ' + _pctText(now[i]) + ' to ' + _pctText(later[i])).join(', ');
    el.textContent = (_townShareChoice() === 'hamilton_perry'
      ? 'By age, carrying each age group’s change from the 2010 to the 2020 Census forward (Hamilton-Perry), ' +
        'the share of ' + whose + ' people in ' + _ctx.displayName + ', ' + base + ' to ' + end + ': ' + byAge + '. ' + hna
      : hna + ' By age, from the 2010 and 2020 Census (Hamilton-Perry), its share of the people, ' + base + ' to ' + end + ': ' + byAge + '.');
  }

  // ---------------------------------------------------------------------------
  // Scenario selection buttons
  // ---------------------------------------------------------------------------

  function _bindScenarioButtons() {
    const container = document.getElementById('sbScenarioButtons');
    if (!container) return;
    container.querySelectorAll('[data-scenario]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sc = BUILT_IN_SCENARIOS.find(s => s.id === btn.dataset.scenario);
        if (!sc) return;
        _applyScenarioToSliders(sc.params);
        _setActiveBtn(btn);
        _runCustom();
        _announceResult();
      });
    });
  }

  function _setActiveBtn(activeBtn) {
    _clearActiveBtn();
    activeBtn.classList.add('active');
  }

  function _clearActiveBtn() {
    const container = document.getElementById('sbScenarioButtons');
    if (!container) return;
    container.querySelectorAll('[data-scenario]').forEach(b => b.classList.remove('active'));
  }

  // ---------------------------------------------------------------------------
  // Run projections
  // ---------------------------------------------------------------------------

  function _runProjection(scenarioId, params) {
    if (!_hasBase()) return null;
    return homesSeries(_ctx, params);
  }

  function _runAllBuiltIn() {
    _activeResults = {};
    if (_hasBase()) {
      BUILT_IN_SCENARIOS.forEach(sc => {
        _activeResults[sc.id] = _runProjection(sc.id, sc.params);
      });
      _activeResults['custom'] = _runProjection('custom', _getSliderParams());
    }
    _render();
  }

  function _runCustom() {
    if (!_hasBase()) return;
    _activeResults['custom'] = _runProjection('custom', _getSliderParams());
    _render();
  }

  function _render() {
    _updateKeyNumbers();
    _updateChart();
    _updateResultsTable();
  }

  const _debouncedRunAndAnnounce = _debounce(function () { _runCustom(); _announceResult(); }, 300);

  // A screen reader hears the new figures when a control changes them.
  function _announceResult() {
    const wrap = document.getElementById('sbKeyNumbers');
    const text = (id) => { const el = document.getElementById(id); return el ? el.textContent : ''; };
    if (!wrap || wrap.hidden) return;
    _announce('Scenario updated. ' + text('sbKeyHomesLabel') + ': ' + text('sbKeyHomes') + '. ' +
      text('sbKeyPopLabel') + ': ' + text('sbKeyPop') + '.');
  }

  // ---------------------------------------------------------------------------
  // Key numbers
  // ---------------------------------------------------------------------------

  function _homesText(n) {
    const r = Math.round(n);
    return r < 0 ? 'A surplus of ' + Math.abs(r).toLocaleString('en-US') : r.toLocaleString('en-US');
  }

  function _updateKeyNumbers() {
    const wrap = document.getElementById('sbKeyNumbers');
    if (!wrap) return;
    const custom = _activeResults['custom'];
    const sdo = _activeResults['baseline'];
    if (!custom || !custom.length) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const fig = twentyYearFigure(custom, _ctx);
    const sdoFig = sdo ? twentyYearFigure(sdo, _ctx) : null;
    const endRow = custom.find(r => r.year === custom[0].year + HORIZON_YEARS) || custom[custom.length - 1];
    const sameAsSdo = fig && sdoFig && Math.round(fig.total) === Math.round(sdoFig.total);

    set('sbKeysHeading', 'Your scenario for ' + ((_geography && _geography.displayName) || 'this place'));
    set('sbKeyHomesLabel', 'Homes needed by ' + (fig ? fig.year : endRow.year));
    set('sbKeyHomes', fig ? _homesText(fig.total) : 'Not available');
    let homesNote;
    if (!fig) {
      homesNote = 'This county has no target vacancy on file, so homes cannot be computed.';
    } else {
      homesNote = (fig.growth < 0
        ? 'Projected households fall, by ' + Math.abs(Math.round(fig.growth)).toLocaleString('en-US') + ' homes’ worth'
        : Math.round(fig.growth).toLocaleString('en-US') + ' for resident growth') +
        (fig.inCommuters != null
          ? ', plus ' + Math.round(fig.inCommuters).toLocaleString('en-US') + ' for a quarter of today’s in-commuter households at or below 120% AMI.'
          : '. No in-commuter record for this place, so resident growth alone.') +
        (sameAsSdo ? ' The same as the HNA page.' : (sdoFig ? ' SDO’s forecast gives ' + _homesText(sdoFig.total).toLowerCase() + '.' : ''));
    }
    // Fewer arrivals usually mean fewer homes, but not where the people SDO
    // has moving in form fewer households than those moving out (a college
    // town's students arriving and graduates leaving). Say so when it happens.
    const avgOf = (rows) => {
      const f = (rows || []).slice(1, HORIZON_YEARS + 1).map(r => r.migration).filter(Number.isFinite);
      return f.length ? f.reduce((x, y) => x + y, 0) / f.length : null;
    };
    const migDelta = (avgOf(custom) != null && avgOf(sdo) != null) ? avgOf(custom) - avgOf(sdo) : 0;
    if (fig && sdoFig && Math.abs(fig.growth - sdoFig.growth) >= 1 && Math.abs(migDelta) >= 0.5 &&
        (fig.growth - sdoFig.growth) * migDelta < 0) {
      homesNote += migDelta < 0
        ? ' Here less migration means more homes: in SDO\u2019s forecast for this place, the people who move in form fewer households than those who move out.'
        : ' Here more migration means fewer homes: in SDO\u2019s forecast for this place, the people who move in form fewer households than those who move out.';
    }
    set('sbKeyHomesNote', homesNote);
    set('sbKeyPopLabel', 'Population in ' + endRow.year);
    set('sbKeyPop', Math.round(endRow.population).toLocaleString('en-US'));
    set('sbKeyPopNote', 'From ' + Math.round(custom[0].population).toLocaleString('en-US') + ' in ' + custom[0].year + '.');
    const flows = custom.slice(1, HORIZON_YEARS + 1).map(r => r.migration).filter(Number.isFinite);
    const avgMig = flows.length ? flows.reduce((a, b) => a + b, 0) / flows.length : null;
    set('sbKeyMigration', avgMig == null ? 'Not available' : (avgMig < 0 ? '−' : '') + Math.round(Math.abs(avgMig)).toLocaleString('en-US'));
    set('sbKeyMigrationNote', avgMig == null ? '' : (avgMig < 0
      ? 'More people leave than arrive, on average each year to ' + endRow.year + '.'
      : 'More people arrive than leave, on average each year to ' + endRow.year + '.'));
  }

  // ---------------------------------------------------------------------------
  // Chart
  // ---------------------------------------------------------------------------

  function _scenarioLabel(id) {
    if (id === 'custom') return 'Your scenario';
    const sc = BUILT_IN_SCENARIOS.find(s => s.id === id);
    return sc ? sc.label : id;
  }

  function _updateChart() {
    const canvas = document.getElementById('sbProjectionChart');
    if (!canvas || typeof Chart === 'undefined') return;

    // F156 — Resolve CSS vars on every call so theme-toggle re-renders pick
    // up the brighter dark-mode accent / warn / info variants.
    const resolved = _resolveColors();
    const allIds = [...BUILT_IN_SCENARIOS.map(s => s.id), 'custom'];
    const datasets = allIds
      .filter(id => _activeResults[id] && _activeResults[id].some(r => r.homesNeeded != null))
      .map(id => {
        const results = _activeResults[id];
        const colors  = resolved[id] || resolved['custom'];
        return {
          label: _scenarioLabel(id),
          scenarioId: id,
          data:              results.map(r => r.homesNeeded == null ? null : Math.round(r.homesNeeded)),
          borderColor:       colors.border,
          backgroundColor:   colors.bg,
          // F156 — Bumped from 2 → 2.5px so lines stay readable on dense
          // mobile renderings where 2px sub-pixels onto the canvas grid.
          borderWidth:       2.5,
          borderDash:        id === 'custom' ? [6, 4] : [],
          pointRadius:       0,
          fill:              false,
          tension:           0.3,
        };
      });

    const labels = (_activeResults['baseline'] || []).map(r => r.year);
    const band = datasets.length ? bandSeries(_activeResults['baseline'], _ctx) : [];
    if (band.some(Boolean)) {
      const edge = (key) => ({
        label: key === 'high' ? BAND_LABEL : BAND_LABEL + ' (low end)',
        scenarioId: 'band',
        bandEdge: key,
        data: band.map(b => (b ? Math.round(b[key]) : null)),
        // No edge line: the range is its shading, and its legend key the same
        // shade, apart from SDO's line in the same colour.
        borderColor: resolved.band.bg,
        backgroundColor: resolved.band.bg,
        borderWidth: 0,
        pointRadius: 0,
        tension: 0.3,
        // Under the lines; the high edge fills down to the low one.
        order: 10,
        fill: key === 'high' ? '-1' : false,
      });
      datasets.push(edge('low'), edge('high'));
    }
    _updateBandNote(band);

    // No place loaded: show the explanation instead of an empty 0-1 grid.
    const empty = document.getElementById('sbChartEmpty');
    canvas.hidden = !datasets.length;
    if (empty) empty.hidden = !!datasets.length;
    if (!datasets.length) {
      if (_chart) { _chart.destroy(); _chart = null; }
      return;
    }

    if (_chart) {
      _chart.data.labels   = labels;
      _chart.data.datasets = datasets;
      _chart.update();
      return;
    }

    _chart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        // Square on a phone: at the default 2:1 the five-entry legend and the
        // axis labels leave the lines a sliver of a 390px screen.
        aspectRatio: _aspectFor(canvas.parentElement ? canvas.parentElement.clientWidth : 0),
        onResize: (chart, size) => {
          const want = _aspectFor(size.width);
          if (chart.options.aspectRatio !== want) { chart.options.aspectRatio = want; chart.resize(); }
        },
        plugins: {
          legend: {
            position: 'top',
            // One legend entry for the range: its high edge. Lines show as
            // lines and the range as a shaded square, so SDO's line and the
            // range around it, in one colour, still read as two keys.
            labels: {
              usePointStyle: true,
              // With point styles Chart.js takes a key's style from a point,
              // which has no dash; the dash comes from the line itself.
              generateLabels: (chart) => Chart.defaults.plugins.legend.labels.generateLabels(chart).map((item) => {
                const ds = chart.data.datasets[item.datasetIndex];
                return Object.assign(item, { pointStyle: ds.bandEdge ? 'rect' : 'line', lineDash: ds.borderDash || [] });
              }),
              filter: (item, data) => data.datasets[item.datasetIndex].bandEdge !== 'low',
            },
          },
          tooltip: {
            callbacks: {
              label: ctx => ctx.dataset.bandEdge
                ? `${ctx.dataset.bandEdge === 'low' ? 'Low' : 'High'} end of where 2 in 3 past forecasts landed: ${ctx.parsed.y.toLocaleString()} homes`
                : `${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()} homes`,
            },
          },
        },
        scales: {
          x: { title: { display: true, text: 'Year' } },
          y: { title: { display: true, text: 'Homes needed since 2024' },
               ticks: { callback: v => v.toLocaleString() } },
        },
      },
    });

    _wireThemeRefresh();
  }

  const _aspectFor = (width) => (width && width < 600 ? 1 : 2);

  const BAND_LABEL = 'Where 2 in 3 past forecasts landed';

  function _sizeText(s) {
    const n = v => v.toLocaleString('en-US');
    if (!s.min) return 'under ' + n(s.max) + ' people';
    if (s.max == null) return 'over ' + n(s.min) + ' people';
    return n(s.min) + ' to ' + n(s.max) + ' people';
  }

  /** The sentence under the chart: the range at 20 years, in percent and homes. */
  function _updateBandNote(band) {
    const el = document.getElementById('sbBandNote');
    if (!el) return;
    const end = band && band[HORIZON_YEARS];
    if (!end) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    const n = v => Math.abs(Math.round(v)).toLocaleString('en-US');
    const range = Math.round(end.low) < 0
      ? 'from a surplus of ' + n(end.low) + ' homes to ' + n(end.high) + ' needed'
      : n(end.low) + ' to ' + n(end.high) + ' homes needed';
    el.hidden = false;
    el.textContent = 'Shaded: where 2 in 3 past forecasts landed for Colorado counties of ' + _sizeText(end.sizeClass) +
      '. By ' + end.year + ' that is a population ' + Math.round(end.errorPct) + '% above or below SDO\u2019s forecast, or ' +
      range + '.';
  }

  /* F156 — Re-resolve colors and re-render the chart when the user toggles
     themes. Without this the chart locks in light-mode #096e65 dark-teal
     lines that drop to <2:1 contrast on the dark-mode navy canvas. Wired
     once (idempotent via _themeRefreshWired) on first chart creation; both
     OS-level prefers-color-scheme changes and manual html.dark-mode toggles
     are observed. */
  let _themeRefreshWired = false;
  function _wireThemeRefresh() {
    if (_themeRefreshWired) return;
    _themeRefreshWired = true;
    var refresh = function () {
      if (!_chart) return;
      var resolved = _resolveColors();
      _chart.data.datasets.forEach(function (ds) {
        var colors = resolved[ds.scenarioId] || resolved['custom'];
        ds.borderColor     = colors.border;
        ds.backgroundColor = colors.bg;
      });
      _chart.update('none');
    };
    if (window.matchMedia) {
      try {
        var mq = window.matchMedia('(prefers-color-scheme: dark)');
        if (mq.addEventListener) mq.addEventListener('change', refresh);
        else if (mq.addListener) mq.addListener(refresh);
      } catch (_) {}
    }
    if (window.MutationObserver) {
      try {
        var mo = new MutationObserver(function (records) {
          for (var i = 0; i < records.length; i++) {
            if (records[i].attributeName === 'class') { refresh(); return; }
          }
        });
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      } catch (_) {}
    }
  }

  // ---------------------------------------------------------------------------
  // Results table
  // ---------------------------------------------------------------------------

  function _fmtSigned(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    const r = Math.round(n);
    return (r < 0 ? '−' : '') + Math.abs(r).toLocaleString('en-US');
  }

  function _updateResultsTable() {
    const tbody = document.getElementById('sbResultsBody');
    if (!tbody) return;

    const custom = _activeResults['custom'] || [];
    tbody.innerHTML = '';

    if (!custom.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.className = 'sb-unavailable';
      td.style.cssText = 'color:var(--muted);padding:var(--sp3);';
      // Sticky and width-capped so the whole message stays readable inside
      // the horizontally scrolling 7-column table on a phone.
      const msg = document.createElement('div');
      msg.style.cssText = 'position:sticky;left:0;max-width:min(560px, calc(100vw - 72px));white-space:normal;';
      msg.textContent = _unavailableReason ||
        'No projection yet. Choose a geography above and select Load Geography Data; the table and chart fill in from that place\'s own population.';
      td.appendChild(msg);
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    custom.forEach(row => {
      const tr = document.createElement('tr');
      const cells = [
        row.year,
        Math.round(row.population).toLocaleString('en-US'),
        _fmtSigned(row.householdsAdded),
        _fmtSigned(row.homesNeeded),
      ];
      ['baseline', 'low_growth', 'high_growth'].forEach(id => {
        const r = (_activeResults[id] || []).find(x => x.year === row.year);
        cells.push(r ? _fmtSigned(r.homesNeeded) : '—');
      });
      cells.forEach(val => {
        const td = document.createElement('td');
        td.textContent = val;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  // ---------------------------------------------------------------------------
  // Save / Load
  // ---------------------------------------------------------------------------

  function _bindSaveLoad() {
    const btnSave = document.getElementById('sbSaveScenario');
    if (btnSave) btnSave.addEventListener('click', _saveCurrentScenario);

    const btnExport = document.getElementById('sbExportScenarios');
    if (btnExport) btnExport.addEventListener('click', _exportScenarios);

    const btnClear = document.getElementById('sbClearResults');
    if (btnClear) btnClear.addEventListener('click', () => {
      _applyScenarioToSliders(window.CohortComponentModel.DEFAULT_PARAMS);
      const first = document.querySelector('#sbScenarioButtons [data-scenario="baseline"]');
      if (first) _setActiveBtn(first);
      _activeResults = {};
      _runAllBuiltIn();
    });
  }

  function _paramsText(p) {
    if (p && (p.births_pct != null || p.deaths_pct != null || p.migration_pct != null)) {
      // The settings the scenario loads with, so the list never names one the
      // projection does not use (a missing setting loads as SDO's 100%).
      const q = window.CohortComponentModel.paramsFromSaved(p);
      return `Births ${q.births_pct}% | Deaths ${q.deaths_pct}% | Moving in (net) ${q.migration_pct}% of ${q.migration_from === 'past' ? 'the years before SDO\'s forecast' : "SDO's forecast"}` +
        (q.headship === 'held' ? ' | Households per person held' : '') +
        (q.town_share === 'hamilton_perry' ? ' | Towns by age (Hamilton-Perry)' : '');
    }
    // A value the record never set is shown as unset, not as 0.
    const given = (v) => (v == null || v === '' ? NaN : Number(v));
    const fm = given(p && p.fertility_multiplier);
    const mm = given(p && p.mortality_multiplier);
    const mig = given(p && p.net_migration_annual);
    return 'Saved with the earlier model: births ×' + (Number.isFinite(fm) ? fm.toFixed(2) : '1.00') +
      ' | deaths ×' + (Number.isFinite(mm) ? mm.toFixed(2) : '1.00') +
      (Number.isFinite(mig) ? ' | ' + Math.round(mig).toLocaleString('en-US') + ' people moving in a year' : '');
  }

  function _saveCurrentScenario() {
    const nameInput = document.getElementById('sbScenarioName');
    const name = (nameInput ? nameInput.value.trim() : '') || 'Custom Scenario';
    const params = _getSliderParams();

    const saved = window.ScenarioStorage.save({
      name,
      parameters: params,
      assumptions: {
        births: `${params.births_pct}% of SDO's forecast`,
        deaths: `${params.deaths_pct}% of SDO's forecast`,
        migration: params.migration_from === 'past'
          ? `${params.migration_pct}% of net migration by age in SDO's estimates for the years before its forecast`
          : `${params.migration_pct}% of SDO's forecast net migration`,
        households: params.headship === 'held'
          ? "SDO's base-year households per person by age, held"
          : "SDO's household forecast by age",
        townShare: params.town_share === 'hamilton_perry'
          ? "Town's share of the county by age, Hamilton-Perry from the 2010 and 2020 Census"
          : "The HNA page's share of the county's growth",
      },
      baselineSource: (_ctx && _ctx.counties[0].baseline.vintage) ? 'SDO ' + _ctx.counties[0].baseline.vintage : 'SDO forecast',
      // Parameters are not tied to a place; record the loaded geography (or
      // none) so a saved scenario is never read as another place's result.
      geography: _geography ? { geoid: _geography.geoid, name: _geography.displayName } : null,
    });

    _announce(`Scenario "${saved.name}" saved.`);
    _renderSavedList();
  }

  function _renderSavedList() {
    const container = document.getElementById('sbSavedScenarios');
    if (!container) return;

    const scenarios = window.ScenarioStorage.list();
    if (scenarios.length === 0) {
      container.innerHTML = '<p class="sb-no-scenarios" data-i18n="scenarios.noSavedScenarios">No saved scenarios yet.</p>';
      return;
    }

    container.innerHTML = scenarios.map(s => `
      <div class="sb-saved-item" data-id="${_escHtml(s.id)}">
        <div class="sb-saved-name">${_escHtml(s.name)}</div>
        <div class="sb-saved-meta">${_escHtml(_paramsText(s.parameters || {}))}</div>
        <div class="sb-saved-actions">
          <button class="btn btn-sm sb-load-btn" data-id="${_escHtml(s.id)}" type="button">Load</button>
          <button class="btn btn-sm btn-danger sb-delete-btn" data-id="${_escHtml(s.id)}" type="button">Delete</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.sb-load-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sc = window.ScenarioStorage.get(btn.dataset.id);
        if (!sc) return;
        const p = window.CohortComponentModel.paramsFromSaved(sc.parameters, _sdoAnnualMigration());
        _applyScenarioToSliders(p);
        _clearActiveBtn();
        if (p.migrationNote) _announce(p.migrationNote);
        _runCustom();
      });
    });

    container.querySelectorAll('.sb-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        window.ScenarioStorage.delete(btn.dataset.id);
        _renderSavedList();
        _announce('Scenario deleted.');
      });
    });
  }

  function _exportScenarios() {
    const blob = window.ScenarioStorage.exportAll();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `coho-scenarios-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------------------
  // i18n
  // ---------------------------------------------------------------------------

  function _listenI18n() {
    document.addEventListener('i18nchange', () => {
      if (window.i18n) window.i18n._applyToDOM();
    });
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function _announce(msg) {
    const el = document.getElementById('sbLiveRegion') || document.getElementById('hnaLiveRegion');
    if (el) el.textContent = msg;
  }

  function _capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function _escHtml(str) {
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[m]));
  }

  function _debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  window.ScenarioBuilder = {
    init,
    loadedGeography: function () { return _geography ? Object.assign({}, _geography) : null; },
    hasProjection: function () { return !!(_activeResults.baseline && _activeResults.baseline.length); },
    runProjection: _runProjection,
    countiesFor,
    contextFor,
    describeContext,
    homesSeries,
    bandSeries,
    setForecastError,
    twentyYearFigure,
    getResults: () => ({ ..._activeResults }),
    BUILT_IN_SCENARIOS,
    HORIZON_YEARS,
  };
})();
