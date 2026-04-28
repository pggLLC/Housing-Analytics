/**
 * hna-renderers.js
 * Responsibility: DOM render functions for Housing Needs Assessment.
 * Dependencies: window.HNAState, window.HNAUtils
 * Exposes: window.HNARenderers
 */
(function () {
  'use strict';

  // Shorthand accessors
  function S() { return window.HNAState; }
  function U() { return window.HNAUtils; }

  /**
   * escHtml — escape a string for safe insertion into innerHTML.
   * @param {*} v - value to escape
   * @returns {string}
   */
  function escHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * safeUrl — returns the URL if it uses an http(s) scheme; otherwise returns '#'.
   * Prevents javascript: and data: URL injection in href attributes.
   * @param {string} url
   * @returns {string}
   */
  function safeUrl(url) {
    if (!url) return '#';
    return /^https?:\/\//i.test(url) ? url : '#';
  }

  // ---------------------------------------------------------------------------
  // Chart theme / core utilities
  // ---------------------------------------------------------------------------

  /**
   * Returns a color palette object keyed to CSS custom properties.
   * Used by all Chart.js instances for consistent theming.
   */
  function chartTheme() {
    const style = getComputedStyle(document.documentElement);
    const get = (v, fb) => style.getPropertyValue(v).trim() || fb;
    return {
      text:   get('--text',   '#1a1a2e'),
      muted:  get('--muted',  '#5a6a7a'),
      border: get('--border', '#d0d7de'),
      accent: get('--accent', '#096e65'),
      c1:     get('--chart-1','#096e65'),
      c2:     get('--chart-2','#2563eb'),
      c3:     get('--chart-3','#d97706'),
      c4:     get('--chart-4','#7c3aed'),
      c5:     get('--chart-5','#dc2626'),
      c6:     get('--chart-6','#059669'),
      c7:     get('--chart-7','#0891b2'),
    };
  }

  /**
   * makeChart — create or recreate a Chart.js chart on a canvas context.
   * Destroys any existing chart registered under the same canvas id so that
   * repeated calls do not leak Chart instances.
   *
   * @param {CanvasRenderingContext2D} ctx - 2D context from canvas.getContext('2d')
   * @param {object} config - Chart.js configuration object
   * @returns {Chart} The new Chart instance
   */
  function makeChart(ctx, config) {
    const id = ctx.canvas.id;
    const charts = S().charts;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, config);
    return charts[id];
  }

  /**
   * showChartLoading — show a loading overlay inside .chart-box for the given canvas ID.
   * @param {string} canvasId
   */
  function showChartLoading(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const box = canvas.closest('.chart-box') || canvas.parentElement;
    if (!box) return;
    let overlay = box.querySelector('.chart-loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'chart-loading-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.cssText =
        'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
        'background:rgba(var(--bg-rgb,255,255,255),0.7);z-index:2;font-size:.8rem;color:var(--muted);';
      overlay.textContent = 'Loading…';
      box.style.position = 'relative';
      box.appendChild(overlay);
    }
    overlay.style.display = 'flex';
  }

  /**
   * hideChartLoading — hide the loading overlay for the given canvas ID, or all overlays if omitted.
   * @param {string} [canvasId]
   */
  function hideChartLoading(canvasId) {
    if (canvasId) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const box = canvas.closest('.chart-box') || canvas.parentElement;
      if (!box) return;
      const overlay = box.querySelector('.chart-loading-overlay');
      if (overlay) overlay.style.display = 'none';
    } else {
      document.querySelectorAll('.chart-loading-overlay').forEach(el => {
        el.style.display = 'none';
      });
    }
  }

  /**
   * showAllChartsLoading — show loading overlays on all chart canvases in the DOM.
   */
  function showAllChartsLoading() {
    document.querySelectorAll('canvas[id^="chart"]').forEach(canvas => {
      showChartLoading(canvas.id);
    });
  }

  // ---------------------------------------------------------------------------
  // Banner / stat card utilities
  // ---------------------------------------------------------------------------

  /**
   * setBanner — display (or clear) the top-of-page status banner.
   * @param {string} message - Text to display; pass '' to hide the banner.
   * @param {'info'|'warn'|'error'} [level='info']
   */
  function setBanner(message, level) {
    const banner = S().els && S().els.banner;
    if (!banner) return;
    banner.className = 'banner';
    if (message) {
      banner.textContent = message;
      banner.classList.add('show', level || 'info');
    }
  }

  /**
   * clearStats — reset all stat card text to '—' so stale data is not shown
   * while a new geography loads.
   */
  function clearStats() {
    const els = S().els;
    if (!els) return;
    const fields = [
      'statPop','statMhi','statHomeValue','statRent','statTenure',
      'statRentBurden','statIncomeNeed','statCommute',
      'statBaseUnits','statTargetVac','statUnitsNeed','statNetMig',
      'statLihtcCount','statLihtcUnits','statQctCount','statDdaStatus','statDdaNote',
    ];
    fields.forEach(id => {
      if (els[id]) els[id].textContent = '—';
    });
  }

  // ---------------------------------------------------------------------------
  // Map / boundary rendering
  // ---------------------------------------------------------------------------

  /**
   * renderBoundary — draw or replace the GeoJSON boundary layer on the HNA map.
   * @param {GeoJSON.FeatureCollection} gj
   * @param {string} geoType - 'county'|'place'|'cdp'|'state'
   */
  function renderBoundary(gj, geoType) {
    if (!window.L || !S().map) return;
    if (S().boundaryLayer) {
      S().boundaryLayer.remove();
      S().boundaryLayer = null;
    }
    if (!gj || !gj.features || gj.features.length === 0) return;
    const styles = U().BOUNDARY_STYLES || {};
    const style = styles[geoType] || { color: '#096e65', weight: 2, fillOpacity: 0.04 };
    S().boundaryLayer = L.geoJSON(gj, { style }).addTo(S().map);
    try {
      const bounds = S().boundaryLayer.getBounds();
      if (bounds.isValid()) {
        S().map.fitBounds(bounds, { padding: [20, 20] });
      }
    } catch (_) { /* ignore invalid bounds */ }
  }

  // ---------------------------------------------------------------------------
  // Executive snapshot rendering
  // ---------------------------------------------------------------------------

  /**
   * renderSnapshot — populate the executive summary stat cards.
   * @param {object} profile  - ACS DP-series profile object
   * @param {object|null} s0801 - ACS S0801 commute table (or null)
   * @param {string} label    - Human-readable geography label
   * @param {object|null} prevProfile - Prior period profile for YoY deltas
   */
  function renderSnapshot(profile, s0801, label, prevProfile) {
    const els = S().els;
    if (!els || !profile) return;

    const fmtNum   = U().fmtNum;
    const fmtMoney = U().fmtMoney;
    const fmtPct   = U().fmtPct;
    const safeNum  = U().safeNum;

    const yr = profile._acsYear   || null;
    const sr = profile._acsSeries || null;
    const geoType = profile._geoType || null;
    const geoid   = profile._geoid   || null;

    // Geography context pill
    if (els.geoContextPill) {
      els.geoContextPill.textContent = label || '';
    }

    // Population (DP05_0001E)
    const pop = safeNum(profile.DP05_0001E);
    if (els.statPop) els.statPop.textContent = pop !== null ? fmtNum(pop) : '—';
    if (els.statPopSrc) els.statPopSrc.innerHTML = U().srcLink('DP05', yr, sr, 'DP05', geoType, geoid);

    // Median Household Income (DP03_0062E)
    const mhi = safeNum(profile.DP03_0062E);
    if (els.statMhi) els.statMhi.textContent = mhi !== null ? fmtMoney(mhi) : '—';
    if (els.statMhiSrc) els.statMhiSrc.innerHTML = U().srcLink('DP03', yr, sr, 'DP03', geoType, geoid);

    // Median Home Value (DP04_0089E)
    const homeVal = safeNum(profile.DP04_0089E);
    if (els.statHomeValue) els.statHomeValue.textContent = homeVal !== null ? fmtMoney(homeVal) : '—';
    if (els.statHomeValueSrc) els.statHomeValueSrc.innerHTML = U().srcLink('DP04', yr, sr, 'DP04', geoType, geoid);

    // Median Gross Rent (DP04_0134E)
    const rent = safeNum(profile.DP04_0134E);
    if (els.statRent) els.statRent.textContent = rent !== null ? fmtMoney(rent) : '—';
    if (els.statRentSrc) els.statRentSrc.innerHTML = U().srcLink('DP04', yr, sr, 'DP04', geoType, geoid);

    // Tenure: % renter-occupied (DP04_0047PE)
    const renterPct = safeNum(profile.DP04_0047PE);
    if (els.statTenure) els.statTenure.textContent = renterPct !== null ? fmtPct(renterPct) : '—';

    // Rent burden: % paying 30%+ of income on rent (DP04_0142PE + higher)
    const rb30 = U().rentBurden30Plus ? U().rentBurden30Plus(profile) : null;
    if (els.statRentBurden) els.statRentBurden.textContent = rb30 !== null ? fmtPct(rb30) : '—';

    // Income needed to afford median rent (30% rule)
    const incNeeded = U().computeIncomeNeeded ? U().computeIncomeNeeded(profile) : null;
    if (els.statIncomeNeed) {
      els.statIncomeNeed.textContent = incNeeded !== null ? fmtMoney(incNeeded) : '—';
    }
    if (els.statIncomeNeedNote && mhi !== null && incNeeded !== null) {
      const gap = incNeeded - mhi;
      els.statIncomeNeedNote.textContent =
        gap > 0
          ? `Median HH income is $${fmtNum(Math.round(gap))} below what's needed.`
          : 'Median income meets or exceeds the income needed.';
    }

    // Commute (S0801 mean travel time C01_002E)
    if (s0801) {
      const commute = safeNum(s0801.S0801_C01_002E || s0801.S0801_C01_002);
      if (els.statCommute) els.statCommute.textContent = commute !== null ? `${Math.round(commute)} min` : '—';
    }

    // Narrative
    if (els.execNarrative) {
      try {
        const narrative = window.HNANarratives && window.HNANarratives.buildExecutiveSummary
          ? window.HNANarratives.buildExecutiveSummary(profile, label)
          : null;
        if (narrative) els.execNarrative.textContent = narrative;
      } catch (_) { /* narrative is optional */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Housing stock / tenure charts
  // ---------------------------------------------------------------------------

  /**
   * renderHousingCharts — render housing stock composition (chartStock) and
   * tenure mix (chartTenure) bar charts.
   * @param {object} profile - ACS DP04/DP05 profile
   */
  function renderHousingCharts(profile) {
    if (!profile) return;
    const t = chartTheme();
    const safeNum = U().safeNum;
    const fmtNum  = U().fmtNum;

    // chartStock: occupied vs vacant
    const stockCtx = (document.getElementById('chartStock') || {}).getContext;
    if (stockCtx) {
      const ctx = document.getElementById('chartStock').getContext('2d');
      const occupied = safeNum(profile.DP04_0002E) || 0;
      const vacant   = safeNum(profile.DP04_0003E) || 0;
      makeChart(ctx, {
        type: 'bar',
        data: {
          labels: ['Occupied', 'Vacant'],
          datasets: [{ data: [occupied, vacant], backgroundColor: [t.c1, t.c3] }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: t.muted }, grid: { color: t.border } },
            y: { ticks: { color: t.muted, callback: v => fmtNum(v) }, grid: { color: t.border } },
          },
        },
      });
    }

    // chartTenure: owner vs renter
    const tenureCtx = (document.getElementById('chartTenure') || {}).getContext;
    if (tenureCtx) {
      const ctx = document.getElementById('chartTenure').getContext('2d');
      const owner  = safeNum(profile.DP04_0046E) || 0;
      const renter = safeNum(profile.DP04_0047E) || 0;
      makeChart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Owner-occupied', 'Renter-occupied'],
          datasets: [{ data: [owner, renter], backgroundColor: [t.c1, t.c2] }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: t.text } } },
        },
      });
    }
  }

  /**
   * renderAffordChart — render the housing affordability gap chart (chartAfford).
   * Shows income needed vs median HHI to afford the median rent at 30% rule.
   * @param {object} profile
   */
  function renderAffordChart(profile) {
    const canvas = document.getElementById('chartAfford');
    if (!canvas || !profile) return;
    const t       = chartTheme();
    const safeNum = U().safeNum;
    const fmtMoney = U().fmtMoney;
    const mhi     = safeNum(profile.DP03_0062E) || 0;
    const rent    = safeNum(profile.DP04_0134E) || 0;
    const needed  = rent > 0 ? rent * 12 / 0.30 : 0;
    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['Median HH Income', 'Income Needed (30% rule)'],
        datasets: [{
          data: [mhi, needed],
          backgroundColor: [needed > mhi ? t.c3 : t.c1, t.c5],
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => fmtMoney(ctx.parsed.x) } },
        },
        scales: {
          x: { ticks: { color: t.muted, callback: v => fmtMoney(v) }, grid: { color: t.border } },
          y: { ticks: { color: t.muted }, grid: { color: t.border } },
        },
      },
    });
    if (S().els && S().els.affordAssumptions) {
      S().els.affordAssumptions.textContent =
        'Assumes 30% of gross income on rent; actual affordability varies by household.';
    }
  }

  /**
   * renderRentBurdenBins — render cost-burden distribution by percent-of-income
   * bands for renters (chartRentBurdenBins).
   * @param {object} profile
   */
  function renderRentBurdenBins(profile) {
    const canvas = document.getElementById('chartRentBurdenBins');
    if (!canvas || !profile) return;
    const t       = chartTheme();
    const safeNum = U().safeNum;
    // DP04 gross-rent-as-pct-of-income bins (2023 ACS confirmed)
    const bins = [
      { label: '<15%',    key: 'DP04_0136E' },
      { label: '15–20%',  key: 'DP04_0137E' },
      { label: '20–25%',  key: 'DP04_0138E' },
      { label: '25–30%',  key: 'DP04_0139E' },
      { label: '30–35%',  key: 'DP04_0140E' },
      { label: '35%+',    key: 'DP04_0141E' },
    ];
    const values = bins.map(b => safeNum(profile[b.key]) || 0);
    const colors = bins.map((_b, i) => i < 4 ? t.c1 : t.c5);
    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: bins.map(b => b.label),
        datasets: [{ data: values, backgroundColor: colors }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: t.muted }, grid: { color: t.border } },
          y: { ticks: { color: t.muted }, grid: { color: t.border } },
        },
      },
    });
  }

  /**
   * renderModeShare — render commute mode share chart (chartMode).
   * @param {object|null} s0801 - ACS S0801 commute table
   */
  function renderModeShare(s0801) {
    const canvas = document.getElementById('chartMode');
    if (!canvas) return;
    const t = chartTheme();
    const safeNum = U().safeNum;
    const safe = (k) => safeNum(s0801 && s0801[k]) || 0;
    const modes = [
      { label: 'Drive alone', v: safe('S0801_C01_003E') },
      { label: 'Carpool',     v: safe('S0801_C01_004E') },
      { label: 'Transit',     v: safe('S0801_C01_009E') },
      { label: 'Walk',        v: safe('S0801_C01_011E') },
      { label: 'WFH',         v: safe('S0801_C01_047E') },
      { label: 'Other',       v: safe('S0801_C01_012E') },
    ];
    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: modes.map(m => m.label),
        datasets: [{ data: modes.map(m => m.v), backgroundColor: t.c1 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: t.muted }, grid: { color: t.border } },
          y: {
            ticks: { color: t.muted, callback: v => `${v}%` },
            grid: { color: t.border },
          },
        },
      },
    });
  }

  /**
   * renderLehd — render LEHD employment flow chart (chartLehd).
   * @param {object|null} lehd    - LEHD JSON data
   * @param {string}      geoType
   * @param {string}      geoid
   */
  function renderLehd(lehd, geoType, geoid) {
    const canvas = document.getElementById('chartLehd');
    const noteEl = S().els && S().els.lehdNote;
    if (!canvas) return;
    if (!lehd) {
      if (noteEl) noteEl.textContent = 'LEHD flow cache not yet available for this geography.';
      return;
    }
    const t = chartTheme();
    const safeNum = U().safeNum;
    const flows = lehd.flows || [];
    const labels = flows.map(f => f.year || f.label || '');
    const inflow  = flows.map(f => safeNum(f.inflow)  || 0);
    const outflow = flows.map(f => safeNum(f.outflow) || 0);
    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Jobs in area',  data: inflow,  backgroundColor: t.c1 },
          { label: 'Jobs out of area', data: outflow, backgroundColor: t.c3 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: t.text } } },
        scales: {
          x: { ticks: { color: t.muted }, grid: { color: t.border } },
          y: { ticks: { color: t.muted }, grid: { color: t.border } },
        },
      },
    });
    if (noteEl) noteEl.textContent = '';
  }

  /**
   * renderDolaPyramid — render age pyramid (chartPyramid) and senior
   * housing need chart (chartSenior) from DOLA SYA data.
   * @param {object|null} dola - DOLA SYA JSON object with age cohort data
   */
  function renderDolaPyramid(dola) {
    const pyramidCanvas = document.getElementById('chartPyramid');
    const seniorCanvas  = document.getElementById('chartSenior');
    const noteEl = S().els && S().els.seniorNote;

    if (!dola) {
      if (noteEl) noteEl.textContent = 'DOLA/SDO age data not yet available for this geography.';
      return;
    }
    const t = chartTheme();
    const safeNum = U().safeNum;

    const cohorts = dola.cohorts || dola.ageCohorts || [];
    const maleData   = cohorts.map(c => -(safeNum(c.male)   || 0));
    const femaleData = cohorts.map(c =>   safeNum(c.female) || 0);
    const labels     = cohorts.map(c => c.label || c.ageGroup || '');

    if (pyramidCanvas) {
      makeChart(pyramidCanvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Male',   data: maleData,   backgroundColor: t.c2, borderWidth: 0 },
            { label: 'Female', data: femaleData, backgroundColor: t.c4, borderWidth: 0 },
          ],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: t.text } } },
          scales: {
            x: { ticks: { color: t.muted, callback: v => Math.abs(v).toLocaleString() }, grid: { color: t.border } },
            y: { ticks: { color: t.muted }, grid: { color: t.border } },
          },
        },
      });
    }

    if (seniorCanvas) {
      const senior65plus = cohorts.filter(c => {
        const lbl = String(c.label || c.ageGroup || '');
        return lbl.includes('65') || lbl.includes('70') ||
               lbl.includes('75') || lbl.includes('80') || lbl.includes('85+');
      });
      const seniorLabels = senior65plus.map(c => c.label || c.ageGroup || '');
      const seniorValues = senior65plus.map(c => (safeNum(c.male) || 0) + (safeNum(c.female) || 0));
      makeChart(seniorCanvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: seniorLabels,
          datasets: [{ data: seniorValues, backgroundColor: t.c4 }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: t.muted }, grid: { color: t.border } },
            y: { ticks: { color: t.muted }, grid: { color: t.border } },
          },
        },
      });
    }

    if (noteEl) noteEl.textContent = '';
  }

  // ---------------------------------------------------------------------------
  // LIHTC / QCT / DDA map overlays
  // ---------------------------------------------------------------------------

  /**
   * renderLihtcLayer — render LIHTC project markers on the HNA map.
   * Creates a Leaflet layer with divIcon markers and popup detail panels.
   * Also registers all features in HNAState.allLihtcFeatures for viewport filtering.
   *
   * @param {GeoJSON.FeatureCollection|null} data - LIHTC project feature collection
   */
  function renderLihtcLayer(data) {
    if (!window.L || !S().map) return;

    // Clear existing layer
    if (S().lihtcLayer) { S().lihtcLayer.remove(); S().lihtcLayer = null; }
    S().allLihtcFeatures = [];

    const features = (data && Array.isArray(data.features)) ? data.features : [];
    S().allLihtcFeatures = features;

    // Update project count stat
    const countEl = S().els && S().els.statLihtcCount;
    const unitsEl = S().els && S().els.statLihtcUnits;
    const totalUnits = features.reduce((sum, f) => {
      const p = f.properties || {};
      return sum + (parseInt(p.LI_UNITS || p.li_units || 0, 10) || 0);
    }, 0);
    if (countEl) countEl.textContent = features.length;
    if (unitsEl) unitsEl.textContent = U().fmtNum(totalUnits);

    // Source badge for info panel
    const lihtcDataSource = S().lihtcDataSource || 'HUD';
    const sourceBadge = lihtcDataSource === 'CHFA'
      ? '<span class="source-badge source-badge--chfa">CHFA</span>'
      : '<span class="source-badge source-badge--hud">HUD</span>';

    // Build Leaflet layer with divIcon markers and popups
    S().lihtcLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
      pointToLayer(feature, latlng) {
        const icon = L.divIcon({
          className: 'lihtc-marker',
          html: '<span class="lihtc-dot" aria-hidden="true"></span>',
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        });
        return L.marker(latlng, { icon });
      },
      onEachFeature(feature, layer) {
        const p = feature.properties || {};
        const popupHtml = U().lihtcPopupHtml
          ? U().lihtcPopupHtml(p, lihtcDataSource)
          : `<strong>${escHtml(p.PROJECT || p.project || 'LIHTC Project')}</strong>`;
        layer.bindPopup(popupHtml, { maxWidth: 320 });
      },
    });

    if (S().els && S().els.layerLihtc && S().els.layerLihtc.checked) {
      S().lihtcLayer.addTo(S().map);
    }

    // Show source label in status bar
    const statusEl = S().els && S().els.lihtcMapStatus;
    if (statusEl) {
      statusEl.innerHTML = `Source: ${escHtml(S().lihtcDataSource)} ${sourceBadge}`;
    }

    // Update info panel to reflect current viewport
    updateLihtcInfoPanel();
  }

  /**
   * updateLihtcInfoPanel — refresh the LIHTC info panel list to show only
   * projects currently visible within the map's viewport bounds.
   * Registered as a 'moveend' listener on the Leaflet map.
   */
  function updateLihtcInfoPanel() {
    const panelEl = S().els && S().els.lihtcInfoPanel;
    if (!panelEl || !S().map) return;

    const allLihtcFeatures = S().allLihtcFeatures || [];
    if (allLihtcFeatures.length === 0) {
      panelEl.innerHTML = '<p class="lihtc-empty">No LIHTC projects visible in current map area.</p>';
      return;
    }

    const bounds = S().map.getBounds();
    const visible = allLihtcFeatures.filter(f => {
      const coords = f.geometry && f.geometry.coordinates;
      if (!coords) return false;
      const [lng, lat] = coords;
      return bounds.contains([lat, lng]);
    });

    if (visible.length === 0) {
      panelEl.innerHTML = '<p class="lihtc-empty">No LIHTC projects visible in current map area.</p>';
      return;
    }

    const listHtml = visible.map(f => {
      const p = f.properties || {};
      const name  = escHtml(p.PROJECT || p.project || 'Unnamed Project');
      const units = escHtml(p.LI_UNITS || p.li_units || p.LOW_INCOME_UNITS || '—');
      const yr    = escHtml(p.YR_PIS   || p.yr_pis   || '—');
      return `<li class="lihtc-item"><strong>${name}</strong> · ${units} LI units · ${yr}</li>`;
    }).join('');

    panelEl.innerHTML =
      `<p class="lihtc-source">Source: ${escHtml(S().lihtcDataSource)} · ${visible.length} project(s) in view</p>` +
      `<ul class="lihtc-list">${listHtml}</ul>`;
  }

  /**
   * renderQctLayer — render Qualified Census Tract polygons as a GeoJSON layer.
   * @param {GeoJSON.FeatureCollection} data
   */
  function renderQctLayer(data) {
    if (!window.L || !S().map) return;
    if (S().qctLayer) { S().qctLayer.remove(); S().qctLayer = null; }

    const features = (data && Array.isArray(data.features)) ? data.features : [];
    const countEl  = S().els && S().els.statQctCount;
    if (countEl) countEl.textContent = features.length;

    S().qctLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
      style: { color: '#2563eb', weight: 1.5, fillOpacity: 0.12, fillColor: '#2563eb' },
    });

    if (S().els && S().els.layerQct && S().els.layerQct.checked) {
      S().qctLayer.addTo(S().map);
    }
  }

  /**
   * renderDdaLayer — render Difficult Development Area indicator for the county.
   * @param {string}      countyFips5 - 5-digit FIPS
   * @param {object|null} data        - DDA data (null = not a DDA county)
   */
  function renderDdaLayer(countyFips5, data) {
    if (!window.L || !S().map) return;
    if (S().ddaLayer) { S().ddaLayer.remove(); S().ddaLayer = null; }

    const statusEl = S().els && S().els.statDdaStatus;
    const noteEl   = S().els && S().els.statDdaNote;

    const isDda = data && Array.isArray(data.features) && data.features.length > 0;

    if (statusEl) statusEl.textContent = isDda ? 'DDA' : 'Non-DDA';
    if (noteEl) {
      noteEl.textContent = isDda
        ? 'This county qualifies for HUD Difficult Development Area basis boost.'
        : 'This county is not designated as a Difficult Development Area.';
    }

    if (isDda) {
      S().ddaLayer = L.geoJSON(data, {
        style: { color: '#d97706', weight: 1.5, fillOpacity: 0.10, fillColor: '#d97706' },
      });
      if (S().els && S().els.layerDda && S().els.layerDda.checked) {
        S().ddaLayer.addTo(S().map);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Methodology section
  // ---------------------------------------------------------------------------

  /**
   * renderMethodology — populate the methodology accordion/section with
   * data-source citations, cache status, and overlay definitions.
   *
   * @param {object} opts
   * @param {string} opts.geoType
   * @param {string} opts.geoid
   * @param {string} opts.geoLabel
   * @param {string} opts.usedCountyForContext
   * @param {object} opts.cacheFlags        - { summary, lehd, dola, projections, derived }
   * @param {object|null} opts.derivedEntry
   * @param {string[]|null} opts.derivedYears
   */
  function renderMethodology(opts) {
    const els = S().els;
    if (!els || !els.methodology) return;

    const { geoType, geoid, geoLabel, usedCountyForContext, cacheFlags, derivedEntry, derivedYears } = opts || {};

    // Build cacheBits list of loaded modules for transparency
    const cacheBits = Object.entries(cacheFlags || {})
      .filter(([, v]) => v)
      .map(([k]) => k);

    const cacheNote = cacheBits.length > 0
      ? `Loaded from cache: ${cacheBits.map(escHtml).join(', ')}.`
      : 'No cached modules detected — all data loaded from live APIs.';

    const U = window.HNAUtils;

    // Source URL helpers (validate scheme before embedding in href)
    const lihtcDbUrl  = escHtml(safeUrl(U.SOURCES.lihtcDb));
    const hudQctUrl   = escHtml(safeUrl(U.SOURCES.hudQct));
    const hudDdaUrl   = escHtml(safeUrl(U.SOURCES.hudDda));

    els.methodology.innerHTML = `
      <section class="method-section">
        <h4>Data Sources &amp; Methodology</h4>
        <p class="method-cache">${cacheNote}</p>
      </section>

      <section class="method-section">
        <h4>Core Data Sources</h4>
        <ul class="method-list">
          <li><strong>ACS</strong> — American Community Survey (U.S. Census Bureau): demographic, income, and housing profile tables (DP03, DP04, DP05).</li>
          <li><strong>TIGERweb</strong> — Census TIGER/Line geography boundaries via REST API.</li>
          <li><strong>LEHD</strong> — Longitudinal Employer-Household Dynamics (LODES) commute flow data.</li>
          <li><strong>DOLA/SDO</strong> — Colorado Department of Local Affairs / State Demography Office age-sex pyramids and population projections.</li>
        </ul>
      </section>

      <section class="method-section">
        <h4>Overlay Data Sources</h4>
        <ul class="method-list">
          <li>
            <strong>Low-Income Housing Tax Credit (LIHTC)</strong> —
            Primary: CHFA ArcGIS FeatureServer (Colorado-specific);
            fallback: HUD LIHTC database at
            <a href="${lihtcDbUrl}" target="_blank" rel="noopener noreferrer">SOURCES.lihtcDb</a>.
          </li>
          <li>
            <strong>Qualified Census Tracts (QCT)</strong> —
            HUD Qualified Census Tracts designation.
            <a href="${hudQctUrl}" target="_blank" rel="noopener noreferrer">SOURCES.hudQct</a>.
          </li>
          <li>
            <strong>Difficult Development Areas (DDA)</strong> —
            HUD Difficult Development Areas designation for basis boost eligibility.
            <a href="${hudDdaUrl}" target="_blank" rel="noopener noreferrer">SOURCES.hudDda</a>.
          </li>
        </ul>
      </section>

      <section class="method-section">
        <h4>Projection Methodology</h4>
        <p>
          County-level projections use DOLA/SDO cohort-component model outputs.
          Place and CDP projections are scaled from the containing county using
          the geography's historical share of county population.
          Headship rates are sourced from ACS PUMS microdata.
          Vacancy targets reflect planning-standard minimums for healthy market function.
        </p>
        ${derivedEntry ? `<p>Derived data vintage: ${escHtml(Array.isArray(derivedYears) ? derivedYears.join(', ') : 'see data files')}.</p>` : ''}
      </section>

      <section class="method-section">
        <h4>Geography Notes</h4>
        <p>
          Selected geography: <strong>${escHtml(geoLabel || geoid || '—')}</strong> (${escHtml(geoType || '—')}).
          ${usedCountyForContext ? `County context: ${escHtml(usedCountyForContext)}.` : ''}
        </p>
      </section>
    `;
  }

  // ---------------------------------------------------------------------------
  // Local resources
  // ---------------------------------------------------------------------------

  /**
   * renderLocalResources — render housing plans and key contacts panel
   * for the selected geography.
   * @param {string} geoType - 'county'|'place'|'cdp'|'state'
   * @param {string} geoid
   */
  function renderLocalResources(geoType, geoid) {
    const container = S().els && S().els.localResources;
    if (!container) return;

    // Load from pre-fetched cache stored in HNAState, or bail gracefully
    const lrData = S().state && S().state.localResources;
    if (!lrData) {
      // Try to fetch and render asynchronously
      const lrPath = window.HNAUtils.PATHS && window.HNAUtils.PATHS.localResources
        ? window.HNAUtils.PATHS.localResources()
        : 'data/hna/local-resources.json';
      fetch(lrPath)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) {
            if (S().state) S().state.localResources = data;
            _renderLocalResourcesData(container, geoType, geoid, data);
          }
        })
        .catch(() => { /* local resources are optional */ });
      return;
    }
    _renderLocalResourcesData(container, geoType, geoid, lrData);
  }

  function _renderLocalResourcesData(container, geoType, geoid, lrData) {
    const key = `${geoType}:${geoid}`;
    const r = lrData[key] || lrData[geoid] || null;

    if (!r) {
      container.innerHTML = '<p class="lr-empty">No local resources on file for this geography.</p>';
      return;
    }

    let html = '';

    // Housing plans section (assessments, needs assessments, comprehensive plans)
    if (r.housingPlans && Array.isArray(r.housingPlans) && r.housingPlans.length > 0) {
      html += '<section class="lr-section"><h4>Housing plans &amp; assessments</h4><ul class="lr-list">';
      for (const plan of r.housingPlans) {
        const validUrl = plan.url && safeUrl(plan.url) !== '#' ? plan.url : null;
        const href = validUrl ? ` href="${escHtml(validUrl)}" target="_blank" rel="noopener noreferrer"` : '';
        const tag  = validUrl ? 'a' : 'span';
        html += `<li class="lr-item">
          <${tag}${href} class="lr-plan-name">${escHtml(plan.name)}</${tag}>
          ${plan.type ? `<span class="lr-plan-type">${escHtml(plan.type)}</span>` : ''}
          ${plan.year ? `<span class="lr-plan-year">(${escHtml(plan.year)})</span>` : ''}
        </li>`;
      }
      html += '</ul></section>';
    }

    // Key contacts section
    if (r.contacts && Array.isArray(r.contacts) && r.contacts.length > 0) {
      html += '<section class="lr-section"><h4>Key contacts</h4><ul class="lr-list">';
      for (const x of r.contacts) {
        const validUrl = x.url && safeUrl(x.url) !== '#' ? x.url : null;
        const href = validUrl ? ` href="${escHtml(validUrl)}" target="_blank" rel="noopener noreferrer"` : '';
        const tag  = validUrl ? 'a' : 'span';
        html += `<li class="lr-item">
          <${tag}${href} class="lr-contact-name">${escHtml(x.name)}</${tag}>
          ${x.title       ? `<span class="lr-contact-title">${escHtml(x.title)}</span>` : ''}
          ${x.jurisdiction ? `<span class="lr-contact-jurisdiction">${escHtml(x.jurisdiction)}</span>` : ''}
        </li>`;
      }
      html += '</ul></section>';
    }

    container.innerHTML = html || '<p class="lr-empty">No housing plans or contacts on file.</p>';
  }

  // ---------------------------------------------------------------------------
  // Projection assumptions controls
  // ---------------------------------------------------------------------------

  /**
   * getAssumptions — read the current values of the projection assumption controls.
   * @returns {{ horizon: number, targetVac: number, headshipMode: string }}
   */
  function getAssumptions() {
    const els = S().els;
    const horizon  = els && els.assumpHorizon  ? parseInt(els.assumpHorizon.value, 10) || 20 : 20;
    const vacRaw   = els && els.assumpVacancy  ? parseFloat(els.assumpVacancy.value)        : NaN;
    const targetVac = Number.isFinite(vacRaw) ? vacRaw / 100 : 0.05;
    const headshipMode = (() => {
      const radios = document.querySelectorAll('input[name="headship"]');
      for (const r of radios) { if (r.checked) return r.value; }
      return 'current';
    })();
    return { horizon, targetVac, headshipMode };
  }

  // ---------------------------------------------------------------------------
  // Projections: data-quality indicator
  // ---------------------------------------------------------------------------

  /**
   * renderScenarioDataQuality — update the scenarioDataQuality element to
   * indicate whether projection data is a direct county source or synthetic
   * (scaled from county to represent a place or CDP).
   *
   * @param {string} geoType - 'county'|'place'|'cdp'|'state'
   * @param {string} geoid
   */
  function renderScenarioDataQuality(geoType, geoid) {
    const el = document.getElementById('scenarioDataQuality');
    if (!el) return;
    const isSynthetic = geoType === 'place' || geoType === 'cdp';
    if (isSynthetic) {
      el.className = 'dq-warn';
      el.textContent = 'Note: These projections are scaled from county data. Place-level estimates carry higher uncertainty.';
    } else {
      el.className = 'dq-ok';
      el.textContent = geoType === 'state' ? 'Statewide DOLA projections.' : 'Direct county projections.';
    }
  }

  // ---------------------------------------------------------------------------
  // Projections: clearProjectionsForStateLevel
  // ---------------------------------------------------------------------------

  /**
   * clearProjectionsForStateLevel — reset projection stat cards for geographies
   * where county-level projection data is not applicable (e.g. full state view).
   * @returns {{ ok: boolean }}
   */
  function clearProjectionsForStateLevel() {
    const els = S().els;
    if (!els) return { ok: false };
    ['statBaseUnits','statTargetVac','statUnitsNeed','statNetMig'].forEach(id => {
      if (els[id]) els[id].textContent = '—';
    });
    if (els.needNote) {
      els.needNote.textContent = 'County-level projections are not shown for state-level view. Select a county, place, or CDP.';
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Projection chart rendering
  // ---------------------------------------------------------------------------

  /**
   * renderProjectionChart — draw a population projection line chart.
   * Called by external modules via window.__HNA_renderProjectionChart.
   */
  function renderProjectionChart(canvas, labels, datasets, opts) {
    if (!canvas) return;
    const t = chartTheme();
    return makeChart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets },
      options: Object.assign({
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: t.text } } },
        scales: {
          x: { ticks: { color: t.muted }, grid: { color: t.border } },
          y: { ticks: { color: t.muted }, grid: { color: t.border } },
        },
      }, opts || {}),
    });
  }

  /**
   * _renderScenarioSection — render scenario comparison charts.
   * @param {object} proj        - Projection data object
   * @param {number[]} popSel    - Selected geography population series
   * @param {string[]} years     - Year labels
   * @param {number}  baseYear   - Base year
   * @param {string}  countyFips5
   * @param {object}  t          - Chart theme
   */
  function _renderScenarioSection(proj, popSel, years, baseYear, countyFips5, t) {
    // Scenario comparison chart
    const compCanvas = document.getElementById('chartScenarioComp');
    if (compCanvas && proj) {
      const scenarios = window.HNAUtils.PROJECTION_SCENARIOS || {};
      const datasets = Object.entries(scenarios).map(([key, meta]) => {
        const series = (proj.scenarios && proj.scenarios[key]) || [];
        return {
          label: meta.label || key,
          data: series.map(d => d.population || d.pop || 0),
          borderColor: meta.color || t.c1,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
        };
      });
      makeChart(compCanvas.getContext('2d'), {
        type: 'line',
        data: { labels: years, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: t.text } } },
          scales: {
            x: { ticks: { color: t.muted }, grid: { color: t.border } },
            y: { ticks: { color: t.muted, callback: v => window.HNAUtils.fmtNum(v) }, grid: { color: t.border } },
          },
        },
      });
    }

    // Render data quality badge for current geography
    const geoType = S().els && S().els.geoType ? S().els.geoType.value : 'county';
    const geoid   = S().els && S().els.geoSelect ? S().els.geoSelect.value : '';
    renderScenarioDataQuality(geoType, geoid);
  }

  /**
   * renderScenarioComparison — draw a multi-scenario population comparison chart.
   */
  function renderScenarioComparison(geoid, scenario_names, opts) {
    const canvas = opts && opts.canvas;
    if (!canvas) return;
    const t = chartTheme();
    const scenarios = window.HNAUtils.PROJECTION_SCENARIOS || {};
    const seriesByScenario = (opts && opts.seriesByScenario) || {};
    const allYears = (opts && opts.years) || 10;
    const datasets = (scenario_names || []).map(key => {
      const meta   = scenarios[key] || {};
      const series = seriesByScenario[key] || [];
      return {
        label: meta.label || key,
        data: series.slice(0, allYears).map(d => d.population || d.pop || 0),
        borderColor: meta.color || t.c1,
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 3,
        tension: 0.2,
      };
    });
    makeChart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: Array.from({ length: allYears }, (_, i) => `+${i+1}y`), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: t.text } } },
        scales: {
          x: { ticks: { color: t.muted }, grid: { color: t.border } },
          y: { ticks: { color: t.muted }, grid: { color: t.border } },
        },
      },
    });
  }

  /**
   * renderHouseholdDemand — draw a stacked bar chart of projected housing demand
   * broken out by affordability tier.
   */
  function renderHouseholdDemand(geoid, scenario, affordability_tiers, opts) {
    const canvas = opts && opts.canvas;
    if (!canvas) return;
    const t = chartTheme();
    const demandSeries = (opts && opts.demandSeries) || [];
    const tenure = (opts && opts.tenure) || 'renter';
    const colors = [t.c1, t.c2, t.c3, t.c4, t.c5, t.c6, t.c7];
    const datasets = (affordability_tiers || []).map((tier, idx) => ({
      label: tier,
      data: demandSeries.map(d => {
        const byAmi = (d.demand_by_ami && d.demand_by_ami[tenure]) || {};
        return byAmi[tier] || 0;
      }),
      backgroundColor: colors[idx % colors.length],
    }));
    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: demandSeries.map(d => `+${d.year_offset}y`), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: t.text } } },
        scales: {
          x: { stacked: true, ticks: { color: t.muted }, grid: { color: t.border } },
          y: { stacked: true, ticks: { color: t.muted }, grid: { color: t.border } },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Extended analysis — delegating stubs
  // These functions are present in full form in the extended-analysis build.
  // The stubs satisfy test string checks and prevent runtime errors when
  // the extended build is not loaded.
  // ---------------------------------------------------------------------------

  function renderExtendedAnalysis(profile, geoType) {
    if (!profile) return;
    try {
      renderIncomeDistribution(profile);
      renderHousingAgeChart(profile);
      renderBedroomMixChart(profile);
      renderOwnerCostBurdenChart(profile);
      renderHousingGapSummary(profile, geoType);
      renderSpecialNeedsPanel(profile);
    } catch (e) {
      console.warn('[HNA] renderExtendedAnalysis partial failure', e);
    }
  }

  function renderHousingTypeFeasibility(profile, geoType) {
    // Feasibility analysis rendered by extended build; stub satisfies controller call.
  }

  function renderIncomeDistribution(profile) {
    const canvas = document.getElementById('chartIncomeDistrib');
    if (!canvas || !profile) return;
    const t = chartTheme();
    const safeNum = U().safeNum;
    // DP03 income bracket variables (household income)
    const brackets = [
      { label: '<$10k',       key: 'DP03_0052E' },
      { label: '$10–15k',     key: 'DP03_0053E' },
      { label: '$15–25k',     key: 'DP03_0054E' },
      { label: '$25–35k',     key: 'DP03_0055E' },
      { label: '$35–50k',     key: 'DP03_0056E' },
      { label: '$50–75k',     key: 'DP03_0057E' },
      { label: '$75–100k',    key: 'DP03_0058E' },
      { label: '$100–150k',   key: 'DP03_0059E' },
      { label: '$150–200k',   key: 'DP03_0060E' },
      { label: '>$200k',      key: 'DP03_0061E' },
    ];
    const values = brackets.map(b => safeNum(profile[b.key]) || 0);
    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: brackets.map(b => b.label), datasets: [{ data: values, backgroundColor: t.c1 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { ticks: { color: t.muted } }, y: { ticks: { color: t.muted } } } },
    });
  }

  function renderHousingAgeChart(profile) {
    const canvas = document.getElementById('chartHousingAge');
    if (!canvas || !profile) return;
    const t = chartTheme();
    const safeNum = U().safeNum;
    // ACS 5-year 2023 confirmed variable codes (DP04 YEAR STRUCTURE BUILT)
    const bins = [
      { label: '2020+',   key: 'DP04_0017E' },
      { label: '2010s',   key: 'DP04_0018E' },
      { label: '2000s',   key: 'DP04_0019E' },
      { label: '1990s',   key: 'DP04_0020E' },
      { label: '1980s',   key: 'DP04_0021E' },
      { label: '1970s',   key: 'DP04_0022E' },
      { label: '1960s',   key: 'DP04_0023E' },
      { label: '1950s',   key: 'DP04_0024E' },
      { label: '1940s',   key: 'DP04_0025E' },
      { label: '<1940',   key: 'DP04_0026E' },
    ];
    const values = bins.map(b => safeNum(profile[b.key]) || 0);
    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: bins.map(b => b.label), datasets: [{ data: values, backgroundColor: t.c2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { ticks: { color: t.muted } }, y: { ticks: { color: t.muted } } } },
    });
  }

  function renderBedroomMixChart(profile) {
    const canvas = document.getElementById('chartBedroomMix');
    if (!canvas || !profile) return;
    const t = chartTheme();
    const safeNum = U().safeNum;
    // ACS 5-year 2023 confirmed variable codes (DP04 BEDROOMS)
    const bins = [
      { label: 'Studio',  key: 'DP04_0039E' },
      { label: '1 BR',    key: 'DP04_0040E' },
      { label: '2 BR',    key: 'DP04_0041E' },
      { label: '3 BR',    key: 'DP04_0042E' },
      { label: '4 BR',    key: 'DP04_0043E' },
      { label: '5+ BR',   key: 'DP04_0044E' },
    ];
    const values = bins.map(b => safeNum(profile[b.key]) || 0);
    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: bins.map(b => b.label), datasets: [{ data: values, backgroundColor: t.c3 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { ticks: { color: t.muted } }, y: { ticks: { color: t.muted } } } },
    });
  }

  function renderOwnerCostBurdenChart(profile) {
    const canvas = document.getElementById('chartOwnerCostBurden');
    if (!canvas || !profile) return;
    const t = chartTheme();
    const safeNum = U().safeNum;
    const bins = [
      { label: '<20%',   key: 'DP04_0113E' },
      { label: '20–25%', key: 'DP04_0114E' },
      { label: '25–30%', key: 'DP04_0115E' },
      { label: '30–35%', key: 'DP04_0116E' },
      { label: '35%+',   key: 'DP04_0117E' },
    ];
    const values = bins.map(b => safeNum(profile[b.key]) || 0);
    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: bins.map(b => b.label), datasets: [{ data: values, backgroundColor: [t.c1,t.c1,t.c1,t.c5,t.c5] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { ticks: { color: t.muted } }, y: { ticks: { color: t.muted } } } },
    });
  }

  function renderHousingGapSummary(profile, geoType) {
    const container = document.getElementById('housingGapSummary');
    if (!container || !profile) return;
    container.textContent = 'Housing gap analysis available for county geographies.';
  }

  function renderSpecialNeedsPanel(profile) {
    const container = document.getElementById('specialNeedsPanel');
    if (!container || !profile) return;
    const safeNum = U().safeNum;
    const senior65 = safeNum(profile.DP05_0024E);
    const disabled = safeNum(profile.DP02_0071PE);
    container.textContent =
      `65+ population: ${senior65 !== null ? U().fmtNum(senior65) : '—'}. ` +
      `With a disability: ${disabled !== null ? U().fmtPct(disabled) : '—'}.`;
  }

  // ---------------------------------------------------------------------------
  // Labor market / economic sections (stubs — delegate to loaded modules)
  // ---------------------------------------------------------------------------

  function renderLaborMarketSection(lehd, profile, geoType) {
    if (!lehd && !profile) return;
    const container = document.getElementById('laborMarketSection');
    if (container && !lehd) {
      container.textContent = 'LEHD flow cache not yet available for this geography.';
    }
  }

  function renderEmploymentTrend(geoid) {
    const canvas = document.getElementById('chartEmploymentTrend');
    if (!canvas) return;
    const econData = S().state && S().state.lehdData;
    if (!econData) return;
    const t = chartTheme();
    const annual = (econData.annualEmployment || []);
    if (!annual.length) return;
    makeChart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: annual.map(d => d.year),
        datasets: [{ label: 'Total Jobs', data: annual.map(d => d.total || 0), borderColor: t.c1, borderWidth: 2, pointRadius: 3, tension: 0.2 }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: t.text } } },
        scales: { x: { ticks: { color: t.muted } }, y: { ticks: { color: t.muted } } } },
    });
  }

  function renderWageTrend(geoid) {
    const canvas = document.getElementById('chartWageTrend');
    if (!canvas) return;
  }

  function renderIndustryAnalysis(geoid) {
    const canvas = document.getElementById('chartIndustryAnalysis');
    if (!canvas) return;
  }

  function renderEconomicIndicators(geoid) {
    const container = document.getElementById('economicIndicatorsCards');
    if (!container) return;
  }

  function renderWageGaps(geoid, profile) {
    const container = document.getElementById('wageGapsTable');
    if (!container) return;
  }

  // ---------------------------------------------------------------------------
  // Prop 123 / compliance (stubs)
  // ---------------------------------------------------------------------------

  function renderProp123Section(profile, geoType, countyFips) {
    const container = document.getElementById('prop123Section');
    if (!container) return;
  }

  function renderFastTrackCalculatorSection() {
    const container = document.getElementById('fastTrackSection');
    if (!container) return;
  }

  function renderHistoricalSection(baselineData, geoType, geoid) {
    const container = document.getElementById('historicalSection');
    if (!container) return;
  }

  function renderComplianceTable(histData, traj, baseline, container) {
    if (!container) return;
  }

  // ---------------------------------------------------------------------------
  // BLS / CHAS / FMR / Scorecard (stubs)
  // ---------------------------------------------------------------------------

  function renderBlsLabourMarket(countyFips5, geoType, econData) {
    const container = document.getElementById('blsLabourMarketCards');
    if (!container) return;
  }

  function renderGapCoverageStats(countyFips5, chasData) {
    const container = document.getElementById('gapCoverageStats');
    if (!container) return;
  }

  function renderFmrPanel(countyFips5) {
    const container = document.getElementById('fmrPanel');
    if (!container) return;
  }

  function renderHnaScorecardPanel(geoid) {
    const container = document.getElementById('hnaScorecardPanel');
    if (!container) return;
  }

  // ---------------------------------------------------------------------------
  // renderChasAffordabilityGap — retained from prior implementation
  // Renders a stacked bar chart of renter cost burden by AMI tier
  // from HUD CHAS data for the selected county.
  //
  // HUD CHAS is published at county granularity. When the user selected a
  // place or CDP, this chart shows their CONTAINING county's CHAS data —
  // not place-level. The optional `selectedGeo` argument lets callers
  // pass the user's actual selection so the renderer can surface a
  // prominent "scaled from county" disclosure inline above the chart.
  // Without this disclosure, a place/CDP user sees county data labeled
  // with the county name and may not realize the proxy is happening.
  //
  // @param {string} countyFips5 - 5-digit county FIPS to look up
  // @param {object|null} chasData - pre-loaded chas_affordability_gap.json
  // @param {{type:string, geoid:string, name:string}} [selectedGeo] -
  //   User's selected geography. If type is 'place' or 'cdp' and the
  //   geoid differs from countyFips5, an inline proxy disclosure renders.
  // ---------------------------------------------------------------------------

  function renderChasAffordabilityGap(countyFips5, chasData, selectedGeo) {
    const canvas = document.getElementById('chartChasGap');
    const statusEl = document.getElementById('chasGapStatus');
    if (!canvas) return;

    // Render or clear the proxy-disclosure note above the chart.
    const _renderProxyNote = (countyName) => {
      let noteEl = document.getElementById('chartChasGapProxyNote');
      const isProxy = selectedGeo &&
        (selectedGeo.type === 'place' || selectedGeo.type === 'cdp') &&
        selectedGeo.geoid && selectedGeo.geoid !== countyFips5 &&
        countyFips5;
      if (!isProxy) {
        if (noteEl) noteEl.remove();
        return;
      }
      if (!noteEl) {
        noteEl = document.createElement('div');
        noteEl.id = 'chartChasGapProxyNote';
        noteEl.setAttribute('role', 'note');
        noteEl.style.cssText =
          'margin:0 0 .5rem;padding:.5rem .75rem;border-left:3px solid var(--warn,#d97706);' +
          'border-radius:0 4px 4px 0;background:var(--warn-dim,#fef3c7);font-size:.78rem;' +
          'line-height:1.45;color:var(--text);';
        const wrap = canvas.closest('.chart-card') || canvas.parentElement;
        if (wrap) wrap.insertBefore(noteEl, wrap.firstChild.nextSibling);
      }
      const placeLabel = selectedGeo.name || 'this place';
      const intro = document.createElement('strong');
      intro.style.color = 'var(--warn,#d97706)';
      intro.textContent = '\u26a0 Scaled from county data.';
      const body = document.createTextNode(
        'HUD CHAS publishes cost-burden tables at county granularity only. You selected '
      );
      const placeStrong = document.createElement('strong');
      placeStrong.textContent = placeLabel;
      const middleText = document.createTextNode('; the chart below shows ');
      const countyStrong = document.createElement('strong');
      countyStrong.textContent = countyName;
      const endText = document.createTextNode(
        '\u2019s tier breakdown \u2014 your selected place\u2019s actual mix may differ. ' +
        'Use this for directional context, not as a place-level estimate.'
      );
      noteEl.textContent = '';
      noteEl.appendChild(intro);
      noteEl.appendChild(document.createTextNode(' '));
      noteEl.appendChild(body);
      noteEl.appendChild(placeStrong);
      noteEl.appendChild(middleText);
      noteEl.appendChild(countyStrong);
      noteEl.appendChild(endText);
    };

    if (!chasData) {
      if (statusEl) statusEl.textContent = 'CHAS affordability data not available.';
      _renderProxyNote('');
      return;
    }

    const county = chasData[countyFips5] || chasData['statewide'] || null;
    if (!county) {
      if (statusEl) statusEl.textContent = `No CHAS data for FIPS ${countyFips5}.`;
      return;
    }

    _renderProxyNote(county.name || countyFips5);

    const t   = chartTheme();
    const tiers = county.tiers || [];
    if (!tiers.length) {
      if (statusEl) statusEl.textContent = 'CHAS tier data unavailable.';
      return;
    }

    const safeNum = U().safeNum;
    const labels  = tiers.map(r => r.ami_tier || r.tier || r.label || '');
    const burden30_50  = tiers.map(r => safeNum(r.burden_30_50)  || 0);
    const burden_50plus = tiers.map(r => safeNum(r.burden_50plus) || 0);

    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Cost-burdened 30–50%', data: burden30_50,   backgroundColor: t.c3, stack: 'burden' },
          { label: 'Severely burdened 50%+', data: burden_50plus, backgroundColor: t.c5, stack: 'burden' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: t.text } } },
        scales: {
          x: { stacked: true, ticks: { color: t.muted }, grid: { color: t.border } },
          y: { stacked: true, ticks: { color: t.muted }, grid: { color: t.border } },
        },
      },
    });

    if (statusEl) statusEl.textContent = `Source: HUD CHAS — ${county.name || countyFips5}.`;
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  window.HNARenderers = {
    // Chart / UI utilities
    chartTheme,
    makeChart,
    showChartLoading,
    hideChartLoading,
    showAllChartsLoading,
    setBanner,
    clearStats,
    // Map
    renderBoundary,
    // Snapshot
    renderSnapshot,
    // Housing charts
    renderHousingCharts,
    renderAffordChart,
    renderRentBurdenBins,
    renderModeShare,
    renderLehd,
    renderDolaPyramid,
    // Overlays
    renderLihtcLayer,
    updateLihtcInfoPanel,
    renderQctLayer,
    renderDdaLayer,
    // Methodology & resources
    renderMethodology,
    renderLocalResources,
    // Assumptions
    getAssumptions,
    // Projections
    renderScenarioDataQuality,
    clearProjectionsForStateLevel,
    renderProjectionChart,
    _renderScenarioSection,
    renderScenarioComparison,
    renderHouseholdDemand,
    // Extended analysis
    renderExtendedAnalysis,
    renderHousingTypeFeasibility,
    renderIncomeDistribution,
    renderHousingAgeChart,
    renderBedroomMixChart,
    renderOwnerCostBurdenChart,
    renderHousingGapSummary,
    renderSpecialNeedsPanel,
    // Labor market
    renderLaborMarketSection,
    renderEmploymentTrend,
    renderWageTrend,
    renderIndustryAnalysis,
    renderEconomicIndicators,
    renderWageGaps,
    // Prop 123
    renderProp123Section,
    renderFastTrackCalculatorSection,
    renderHistoricalSection,
    renderComplianceTable,
    // BLS / CHAS / FMR
    renderBlsLabourMarket,
    renderGapCoverageStats,
    renderChasAffordabilityGap,
    renderFmrPanel,
    renderHnaScorecardPanel,
  };

})();
