/**
 * js/market-intelligence.js
 * Market Intelligence page controller.
 *
 * Data sources (all public — no proprietary API keys required):
 *  - Census ACS 5-year estimates (api.census.gov, public)
 *  - FRED economic series via data/fred-data.json (fetched by CI)
 *  - CHFA / HUD LIHTC data via data/chfa-lihtc.json (fetched by CI)
 *  - Prop 123 jurisdictions via data/prop123_jurisdictions.json (local)
 *  - Census Building Permits via FRED proxy series
 */
(function () {
  'use strict';

  /* ── State ─────────────────────────────────────────────────────── */
  var selectedCounty = '';
  var currentData = {};

  /* ── Colorado counties list ────────────────────────────────────── */
  var CO_COUNTIES = [
    'Adams','Alamosa','Arapahoe','Archuleta','Baca','Bent','Boulder',
    'Broomfield','Chaffee','Cheyenne','Clear Creek','Conejos','Costilla',
    'Crowley','Custer','Delta','Denver','Dolores','Douglas','Eagle',
    'El Paso','Elbert','Fremont','Garfield','Gilpin','Grand','Gunnison',
    'Hinsdale','Huerfano','Jackson','Jefferson','Kiowa','Kit Carson',
    'La Plata','Lake','Larimer','Las Animas','Lincoln','Logan','Mesa',
    'Mineral','Moffat','Montezuma','Montrose','Morgan','Otero','Ouray',
    'Park','Phillips','Pitkin','Prowers','Pueblo','Rio Blanco',
    'Rio Grande','Routt','Saguache','San Juan','San Miguel','Sedgwick',
    'Summit','Teller','Washington','Weld','Yuma'
  ];

  /* ── Helpers ───────────────────────────────────────────────────── */
  function fmt(n, decimals) {
    if (n == null || n === '' || isNaN(n)) return '—';
    var d = decimals != null ? decimals : 0;
    try { return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); } catch (e) { return String(n); }
  }

  function fmtPct(n) {
    if (n == null || n === '' || isNaN(n)) return '—';
    return (Number(n) * 100).toFixed(1) + '%';
  }

  function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function setStatus(msg, isError) {
    var el = document.getElementById('miLoadingStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'mi-status' + (isError ? ' error' : '');
  }

  function resolveData(key) {
    if (typeof DataService !== 'undefined' && DataService.baseData) {
      return DataService.baseData(key);
    }
    return 'data/' + key;
  }

  function fetchJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.json();
    });
  }

  /* ── County selector ───────────────────────────────────────────── */
  function buildCountySelector() {
    var sel = document.getElementById('countySelect');
    if (!sel) return;
    CO_COUNTIES.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c + ' County';
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () {
      selectedCounty = sel.value;
      applyCountyFilter();
    });
  }

  /* ── Load all data sources ─────────────────────────────────────── */
  function loadAll() {
    setStatus('Loading data…');

    var tasks = [
      loadDemographics(),
      loadLihtcInventory(),
      loadProp123(),
      loadFredData()
    ];

    Promise.allSettled(tasks).then(function (results) {
      var errors = results.filter(function (r) { return r.status === 'rejected'; });
      if (errors.length === tasks.length) {
        setStatus('Some data sources unavailable. Showing cached or partial data.', true);
      } else if (errors.length > 0) {
        setStatus('Loaded with ' + errors.length + ' source(s) unavailable.');
      } else {
        setStatus('All data loaded.');
      }
      buildCharts();
    });
  }

  /* ── Load ACS demographic data ─────────────────────────────────── */
  function loadDemographics() {
    return fetchJSON(resolveData('co-demographics.json')).then(function (data) {
      currentData.demographics = data;
      renderDemandKpis(data, selectedCounty);
    }).catch(function () {
      // Attempt Census ACS API directly (public, no key required for some series)
      return fetchJSON(
        'https://api.census.gov/data/2022/acs/acs5?get=B25070_007E,B25070_008E,B25070_009E,B25070_010E,B25070_001E,B11001_001E,B25014_008E,B25014_001E&for=state:08'
      ).then(function (rows) {
        if (!Array.isArray(rows) || rows.length < 2) return;
        var headers = rows[0];
        var vals = rows[1];
        function get(name) { var i = headers.indexOf(name); return i >= 0 ? Number(vals[i]) : null; }
        var totalRenter = get('B25070_001E');
        // Sum of ≥30% burden buckets (30-34.9, 35-39.9, 40-44.9, 45-49.9, ≥50%)
        var burdened30 = [get('B25070_007E'), get('B25070_008E'), get('B25070_009E'), get('B25070_010E')].reduce(function (a, b) { return a + (b || 0); }, 0);
        var severe50 = get('B25070_010E');
        var hh = get('B11001_001E');
        var overcrowded = get('B25014_008E');
        var totalUnits = get('B25014_001E');
        var derived = {
          cost_burden_share: totalRenter > 0 ? burdened30 / totalRenter : null,
          severe_burden_share: totalRenter > 0 ? severe50 / totalRenter : null,
          household_count: hh,
          overcrowding_rate: totalUnits > 0 ? overcrowded / totalUnits : null
        };
        currentData.demographics = derived;
        renderDemandKpis(derived, selectedCounty);
      });
    });
  }

  function renderDemandKpis(data, county) {
    if (!data) return;
    var d = county ? (data[county] || data) : data;
    setText('kpiCostBurden', fmtPct(d.cost_burden_share));
    setText('kpiSevereBurden', fmtPct(d.severe_burden_share));
    setText('kpiHHGrowth', d.household_growth_rate_5yr != null ? (Number(d.household_growth_rate_5yr) * 100).toFixed(1) + '%' : '—');
    setText('kpiOvercrowding', fmtPct(d.overcrowding_rate));
  }

  /* ── Load LIHTC inventory ──────────────────────────────────────── */
  function loadLihtcInventory() {
    return fetchJSON(resolveData('chfa-lihtc.json')).then(function (raw) {
      var features = [];
      if (Array.isArray(raw)) features = raw;
      else if (raw && Array.isArray(raw.features)) features = raw.features.map(function (f) { return f.properties || f; });
      else if (raw && Array.isArray(raw.items)) features = raw.items;
      currentData.lihtc = features;
      renderInventoryKpis(features, selectedCounty);
    });
  }

  function renderInventoryKpis(features, county) {
    var filtered = county
      ? features.filter(function (f) { return (f.CNTY_NAME || f.county || '').toString().toLowerCase().includes(county.toLowerCase()); })
      : features;

    var projects = filtered.length;
    var totalUnits = filtered.reduce(function (a, f) { return a + (Number(f.N_UNITS || f.total_units || 0) || 0); }, 0);
    var liUnits = filtered.reduce(function (a, f) { return a + (Number(f.LI_UNITS || f.lihtc_units || 0) || 0); }, 0);

    setText('kpiLihtcProjects', fmt(projects));
    setText('kpiLihtcUnits', fmt(totalUnits));
    setText('kpiLihtcLowIncome', fmt(liUnits));

    // Per-1k-HH ratio (using demographics if available)
    var hh = currentData.demographics && currentData.demographics.household_count;
    if (hh && hh > 0) {
      setText('kpiLihtcPer1k', (liUnits / (hh / 1000)).toFixed(1));
    } else {
      setText('kpiLihtcPer1k', '—');
    }

    var statusEl = document.getElementById('inventoryStatus');
    if (statusEl) {
      statusEl.textContent = projects
        ? ('Showing ' + projects + ' LIHTC project(s) with ' + fmt(liUnits) + ' affordable units' + (county ? ' in ' + county + ' County' : ' statewide') + '.')
        : 'No LIHTC records found for the selected area.';
    }
  }

  /* ── Load Prop 123 ─────────────────────────────────────────────── */
  function loadProp123() {
    return fetchJSON(resolveData('prop123_jurisdictions.json')).then(function (data) {
      var list = (data && data.jurisdictions) ? data.jurisdictions : (Array.isArray(data) ? data : []);
      currentData.prop123 = list;
      renderPolicyKpis(list, selectedCounty);
    });
  }

  function renderPolicyKpis(list, county) {
    var filtered = county
      ? list.filter(function (j) { return (j.name || '').toLowerCase().includes(county.toLowerCase()); })
      : list;
    var counties = filtered.filter(function (j) { return (j.kind || j.type || '').toLowerCase().includes('county'); });
    var munis = filtered.filter(function (j) { return !(j.kind || j.type || '').toLowerCase().includes('county'); });
    setText('kpiProp123Count', fmt(filtered.length));
    setText('kpiProp123Counties', fmt(counties.length));
    setText('kpiProp123Munis', fmt(munis.length));
  }

  /* ── Load FRED data ────────────────────────────────────────────── */
  function loadFredData() {
    return fetchJSON(resolveData('fred-data.json')).then(function (data) {
      currentData.fred = data;
      renderSupplyKpis(data);
      renderRiskKpis(data);
    });
  }

  function renderSupplyKpis(data) {
    if (!data) return;
    // FRED series: COBPPRIV = Colorado total building permits, COBPPRIV5F = 5+ units
    var permits = data.COBPPRIV5F || data.COBPPRIV || null;
    var latestPermit = permits && Array.isArray(permits.observations)
      ? permits.observations[permits.observations.length - 1] : null;
    var prevPermit = permits && Array.isArray(permits.observations) && permits.observations.length > 1
      ? permits.observations[permits.observations.length - 13] : null; // 12 months prior

    setText('kpiPermits', latestPermit ? fmt(latestPermit.value) : '—');
    setText('kpiCompletions', '—'); // Completions not in FRED — placeholder
    setText('kpiUnderConst', '—'); // Under construction — placeholder

    if (latestPermit && prevPermit && prevPermit.value) {
      var yoy = ((latestPermit.value - prevPermit.value) / prevPermit.value * 100).toFixed(1);
      setText('kpiYoyPermits', yoy + '%');
    } else {
      setText('kpiYoyPermits', '—');
    }
  }

  function renderRiskKpis(data) {
    if (!data) return;
    // Vacancy: FRED CORVAC or use ACS estimate
    var demo = currentData.demographics;
    if (demo) {
      var vac = demo.vacancy_rate;
      var el = document.getElementById('riskVacancy');
      if (el) {
        el.textContent = vac != null ? fmtPct(vac) : '—';
        el.className = 'risk-value ' + (vac > 0.07 ? 'risk-low' : vac > 0.04 ? 'risk-med' : 'risk-high');
      }
    }
    // Rent trend proxy from median gross rent
    if (demo && demo.median_gross_rent_current && demo.median_gross_rent_prior) {
      var rentYoy = ((demo.median_gross_rent_current - demo.median_gross_rent_prior) / demo.median_gross_rent_prior * 100).toFixed(1);
      var rentEl = document.getElementById('riskRentTrend');
      if (rentEl) {
        rentEl.textContent = rentYoy + '%/yr';
        rentEl.className = 'risk-value ' + (Number(rentYoy) > 5 ? 'risk-high' : Number(rentYoy) > 2 ? 'risk-med' : 'risk-low');
      }
    }
    // Pipeline pressure
    var lihtc = currentData.lihtc;
    var hh = demo && demo.household_count;
    if (lihtc && hh) {
      var pipelineRate = (lihtc.length / (hh / 1000)).toFixed(2);
      var ppEl = document.getElementById('riskPipeline');
      if (ppEl) {
        ppEl.textContent = pipelineRate + ' projects/1k HH';
        ppEl.className = 'risk-value risk-med';
      }
    }
    // Affordability gap placeholder
    setText('riskAffordGap', '—');
  }

  /* ── Apply county filter ───────────────────────────────────────── */
  function applyCountyFilter() {
    if (currentData.demographics) renderDemandKpis(currentData.demographics, selectedCounty);
    if (currentData.lihtc) renderInventoryKpis(currentData.lihtc, selectedCounty);
    if (currentData.prop123) renderPolicyKpis(currentData.prop123, selectedCounty);
  }

  /* ── Charts ────────────────────────────────────────────────────── */
  var demandChartInst = null;
  var supplyChartInst = null;

  function buildCharts() {
    buildDemandChart();
    buildSupplyChart();
  }

  function buildDemandChart() {
    var ctx = document.getElementById('demandChart');
    if (!ctx || typeof Chart === 'undefined') return;
    if (demandChartInst) { demandChartInst.destroy(); }

    var demo = currentData.demographics;
    var labels = ['Cost-Burdened (≥30%)', 'Severely Burdened (≥50%)', 'Overcrowded'];
    var values = [
      demo ? (Number(demo.cost_burden_share || 0) * 100) : 0,
      demo ? (Number(demo.severe_burden_share || 0) * 100) : 0,
      demo ? (Number(demo.overcrowding_rate || 0) * 100) : 0
    ];

    demandChartInst = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Share of Households (%)',
          data: values,
          backgroundColor: ['rgba(14,165,160,0.65)', 'rgba(220,38,38,0.65)', 'rgba(217,119,6,0.65)'],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { callback: function (v) { return v + '%'; } } }
        }
      }
    });
  }

  function buildSupplyChart() {
    var ctx = document.getElementById('supplyChart');
    if (!ctx || typeof Chart === 'undefined') return;
    if (supplyChartInst) { supplyChartInst.destroy(); }

    var fred = currentData.fred;
    var obs = fred && (fred.COBPPRIV5F || fred.COBPPRIV);
    var observations = obs && Array.isArray(obs.observations) ? obs.observations.slice(-24) : [];
    var labels = observations.map(function (o) { return o.date ? o.date.slice(0, 7) : ''; });
    var values = observations.map(function (o) { return Number(o.value) || 0; });

    if (!labels.length) {
      labels = ['No permit data'];
      values = [0];
    }

    supplyChartInst = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Multifamily Permits (5+ units)',
          data: values,
          borderColor: 'rgba(14,165,160,1)',
          backgroundColor: 'rgba(14,165,160,0.12)',
          fill: true,
          tension: 0.3,
          pointRadius: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  /* ── Export ────────────────────────────────────────────────────── */
  function exportJson() {
    var payload = {
      exported_at: new Date().toISOString(),
      county: selectedCounty || 'Statewide',
      demographics: currentData.demographics || null,
      lihtc_summary: currentData.lihtc ? {
        count: currentData.lihtc.length,
        total_units: currentData.lihtc.reduce(function (a, f) { return a + (Number(f.N_UNITS || f.total_units || 0) || 0); }, 0)
      } : null,
      prop123_count: currentData.prop123 ? currentData.prop123.length : null
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'market-intelligence-' + (selectedCounty || 'statewide') + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportCsv() {
    var rows = [
      ['Metric', 'Value', 'County', 'Source'],
      ['Cost-Burdened Renters', document.getElementById('kpiCostBurden') ? document.getElementById('kpiCostBurden').textContent : '—', selectedCounty || 'Statewide', 'ACS B25070'],
      ['Severely Cost-Burdened', document.getElementById('kpiSevereBurden') ? document.getElementById('kpiSevereBurden').textContent : '—', selectedCounty || 'Statewide', 'ACS B25070'],
      ['Household Growth (5yr)', document.getElementById('kpiHHGrowth') ? document.getElementById('kpiHHGrowth').textContent : '—', selectedCounty || 'Statewide', 'ACS B11001'],
      ['Overcrowded Units', document.getElementById('kpiOvercrowding') ? document.getElementById('kpiOvercrowding').textContent : '—', selectedCounty || 'Statewide', 'ACS B25014'],
      ['LIHTC Projects', document.getElementById('kpiLihtcProjects') ? document.getElementById('kpiLihtcProjects').textContent : '—', selectedCounty || 'Statewide', 'CHFA/HUD'],
      ['LIHTC Total Units', document.getElementById('kpiLihtcUnits') ? document.getElementById('kpiLihtcUnits').textContent : '—', selectedCounty || 'Statewide', 'CHFA/HUD'],
      ['Prop 123 Committed', document.getElementById('kpiProp123Count') ? document.getElementById('kpiProp123Count').textContent : '—', selectedCounty || 'Statewide', 'DOLA'],
    ];
    var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'market-intelligence-' + (selectedCounty || 'statewide') + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ── Init ──────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    buildCountySelector();
    loadAll();

    var btnJson = document.getElementById('exportJson');
    if (btnJson) btnJson.addEventListener('click', exportJson);

    var btnCsv = document.getElementById('exportCsv');
    if (btnCsv) btnCsv.addEventListener('click', exportCsv);
  });

  /* ── Public API ────────────────────────────────────────────────── */
  window.MarketIntelligence = {
    reload: loadAll,
    exportJson: exportJson,
    exportCsv: exportCsv
  };

}());
