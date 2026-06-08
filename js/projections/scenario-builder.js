/**
 * scenario-builder.js — COHO Analytics
 *
 * Interactive UI controller for the projection scenario builder page.
 * Wires slider inputs → CohortComponentModel → Chart.js results chart.
 * Reads DOLA SYA data for the selected county/municipality as the base population.
 *
 * Dependencies (must be loaded before this script):
 *   - js/projections/cohort-component-model.js
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

  const BUILT_IN_SCENARIOS = [
    { id: 'baseline',   label: 'Baseline (Moderate Growth)', params: { fertility_multiplier: 1.0,  mortality_multiplier: 1.0,  net_migration_annual: 500  } },
    { id: 'low-growth', label: 'Low Growth',                 params: { fertility_multiplier: 0.90, mortality_multiplier: 1.02, net_migration_annual: 250  } },
    { id: 'high-growth',label: 'High Growth',                params: { fertility_multiplier: 1.05, mortality_multiplier: 0.98, net_migration_annual: 1000 } },
  ];

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
    'low-growth':  { borderVar: '--warn',    bgFallback: 'rgba(168,70,8,0.15)'  },
    'high-growth': { borderVar: '--info',    bgFallback: 'rgba(29,78,216,0.15)' },
    'custom':      { borderVar: '--accent2', bgFallback: 'rgba(200,111,13,0.15)'},
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
  let _dolaData = null;
  let _baseUnits = 0;
  let _activeResults = {}; // scenarioId → results[]

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  function init(opts) {
    opts = opts || {};

    _bindSliders();
    _bindScenarioButtons();
    _bindSaveLoad();
    _renderSavedList();
    _listenI18n();

    // Run baseline projection immediately if DOLA data is available
    if (opts.dolaData) {
      _dolaData = opts.dolaData;
    }
    if (opts.baseUnits) {
      _baseUnits = opts.baseUnits;
    }

    _runAllBuiltIn();
  }

  // ---------------------------------------------------------------------------
  // Slider bindings
  // ---------------------------------------------------------------------------

  function _bindSliders() {
    const sliders = ['fertMult', 'migAnnual', 'mortMult'];
    sliders.forEach(id => {
      const slider = document.getElementById('sb' + _capitalize(id));
      const display = document.getElementById('sb' + _capitalize(id) + 'Val');
      if (!slider) return;
      slider.addEventListener('input', () => {
        if (display) display.textContent = Number(slider.value).toFixed(
          id === 'migAnnual' ? 0 : 2
        );
        _debouncedRunCustom();
      });
    });
  }

  function _getSliderParams() {
    const fert = document.getElementById('sbFertMult');
    const mig  = document.getElementById('sbMigAnnual');
    const mort = document.getElementById('sbMortMult');
    return {
      fertility_multiplier:  fert ? parseFloat(fert.value) : 1.0,
      mortality_multiplier:  mort ? parseFloat(mort.value) : 1.0,
      net_migration_annual:  mig  ? parseInt(mig.value, 10)  : 500,
    };
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
      });
    });
  }

  function _setActiveBtn(activeBtn) {
    const container = document.getElementById('sbScenarioButtons');
    if (!container) return;
    container.querySelectorAll('[data-scenario]').forEach(b => b.classList.remove('active'));
    activeBtn.classList.add('active');
  }

  function _applyScenarioToSliders(params) {
    const fert = document.getElementById('sbFertMult');
    const mig  = document.getElementById('sbMigAnnual');
    const mort = document.getElementById('sbMortMult');
    const fertVal = document.getElementById('sbFertMultVal');
    const migVal  = document.getElementById('sbMigAnnualVal');
    const mortVal = document.getElementById('sbMortMultVal');

    if (fert) { fert.value = params.fertility_multiplier; if (fertVal) fertVal.textContent = params.fertility_multiplier.toFixed(2); }
    if (mig)  { mig.value  = params.net_migration_annual;  if (migVal)  migVal.textContent  = params.net_migration_annual; }
    if (mort) { mort.value = params.mortality_multiplier;  if (mortVal) mortVal.textContent = params.mortality_multiplier.toFixed(2); }
  }

  // ---------------------------------------------------------------------------
  // Run projections
  // ---------------------------------------------------------------------------

  function _runProjection(scenarioId, params) {
    const basePop = _dolaData
      ? window.CohortComponentModel.buildBasePopFromDola(_dolaData)
      : { male: new Array(18).fill(1000), female: new Array(18).fill(1000) };

    const model = new window.CohortComponentModel({
      basePopulation: basePop,
      baseYear:       2024,
      targetYear:     2050,
      scenario:       params,
      headshipRate:   0.38,
      vacancyTarget:  0.05,
      baseUnits:      _baseUnits,
    });

    return model.project();
  }

  function _runAllBuiltIn() {
    BUILT_IN_SCENARIOS.forEach(sc => {
      _activeResults[sc.id] = _runProjection(sc.id, sc.params);
    });
    _updateChart();
    _updateResultsTable();
  }

  function _runCustom() {
    const params = _getSliderParams();
    _activeResults['custom'] = _runProjection('custom', params);
    _updateChart();
    _updateResultsTable();
  }

  const _debouncedRunCustom = _debounce(_runCustom, 300);

  // ---------------------------------------------------------------------------
  // Chart
  // ---------------------------------------------------------------------------

  function _updateChart() {
    const canvas = document.getElementById('sbProjectionChart');
    if (!canvas || typeof Chart === 'undefined') return;

    // F156 — Resolve CSS vars on every call so theme-toggle re-renders pick
    // up the brighter dark-mode accent / warn / info variants.
    const resolved = _resolveColors();
    const allIds = [...BUILT_IN_SCENARIOS.map(s => s.id), 'custom'];
    const datasets = allIds
      .filter(id => _activeResults[id])
      .map(id => {
        const results = _activeResults[id];
        const colors  = resolved[id] || resolved['custom'];
        const label   = BUILT_IN_SCENARIOS.find(s => s.id === id)?.label || 'Custom Scenario';
        return {
          label,
          data:              results.map(r => r.unitsNeeded),
          borderColor:       colors.border,
          backgroundColor:   colors.bg,
          // F156 — Bumped from 2 → 2.5px so lines stay readable on dense
          // mobile renderings where 2px sub-pixels onto the canvas grid.
          borderWidth:       2.5,
          pointRadius:       3,
          fill:              false,
          tension:           0.3,
        };
      });

    const labels = (_activeResults['baseline'] || []).map(r => r.year);

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
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()} units`,
            },
          },
        },
        scales: {
          x: { title: { display: true, text: 'Year' } },
          y: { title: { display: true, text: 'Housing Units Needed' },
               ticks: { callback: v => v.toLocaleString() } },
        },
      },
    });

    _wireThemeRefresh();
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
      _chart.data.datasets.forEach(function (ds, i) {
        var id = (BUILT_IN_SCENARIOS[i] && BUILT_IN_SCENARIOS[i].id) || 'custom';
        var colors = resolved[id] || resolved['custom'];
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

  function _updateResultsTable() {
    const tbody = document.getElementById('sbResultsBody');
    if (!tbody) return;

    const baseline = _activeResults['baseline'] || [];
    tbody.innerHTML = '';

    baseline.forEach(row => {
      const tr = document.createElement('tr');

      const cells = [
        row.year,
        row.totalPopulation.toLocaleString(),
        row.households.toLocaleString(),
        row.unitsNeeded.toLocaleString(),
      ];

      cells.forEach(val => {
        const td = document.createElement('td');
        td.textContent = val;
        tr.appendChild(td);
      });

      // Also show low/high if available
      ['low-growth', 'high-growth', 'custom'].forEach(id => {
        const r = (_activeResults[id] || []).find(x => x.year === row.year);
        const td = document.createElement('td');
        td.textContent = r ? r.unitsNeeded.toLocaleString() : '—';
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
      _activeResults = {};
      _runAllBuiltIn();
    });
  }

  function _saveCurrentScenario() {
    const nameInput = document.getElementById('sbScenarioName');
    const name = (nameInput ? nameInput.value.trim() : '') || 'Custom Scenario';
    const params = _getSliderParams();

    const saved = window.ScenarioStorage.save({
      name,
      parameters: params,
      assumptions: {
        fertility: `${(params.fertility_multiplier * 100).toFixed(0)}% of baseline`,
        migration: `${params.net_migration_annual} persons/year net`,
        mortality: `${(params.mortality_multiplier * 100).toFixed(0)}% of baseline`,
      },
      baselineSource: 'DOLA 2024',
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
        <div class="sb-saved-meta">
          Fertility ×${s.parameters.fertility_multiplier.toFixed(2)} |
          Migration ${s.parameters.net_migration_annual}/yr |
          Mortality ×${s.parameters.mortality_multiplier.toFixed(2)}
        </div>
        <div class="sb-saved-actions">
          <button class="btn btn-sm sb-load-btn" data-id="${_escHtml(s.id)}" type="button">Load</button>
          <button class="btn btn-sm btn-danger sb-delete-btn" data-id="${_escHtml(s.id)}" type="button">Delete</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.sb-load-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sc = window.ScenarioStorage.get(btn.dataset.id);
        if (sc) { _applyScenarioToSliders(sc.parameters); _runCustom(); }
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
    runProjection: _runProjection,
    getResults: () => ({ ..._activeResults }),
    BUILT_IN_SCENARIOS,
  };
})();
