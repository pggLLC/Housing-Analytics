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

    // Income needed to buy the median home at the 30%-rule front-end
    // ratio. computeIncomeNeeded takes a scalar home value and returns
    // an object { annualIncome, ... } — earlier we were passing the
    // whole profile and then formatting the object, which rendered as
    // "—" (the function returned null on NaN input).
    const incRes = U().computeIncomeNeeded
      ? U().computeIncomeNeeded(homeVal)
      : null;
    const incNeeded = incRes && Number.isFinite(incRes.annualIncome)
      ? incRes.annualIncome
      : null;
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

    // chartStock — Housing stock by STRUCTURE TYPE (HTML chart title is
    // "Housing stock by structure type", not "occupied vs vacant").
    //
    // ACS 2023 5-year DP04 codes (verified against the Census variables.json):
    //   DP04_0007E = 1-unit detached
    //   DP04_0008E = 1-unit attached
    //   DP04_0009E = 2 units
    //   DP04_0010E = 3 or 4 units
    //   DP04_0011E = 5 to 9 units
    //   DP04_0012E = 10 to 19 units
    //   DP04_0013E = 20 or more units
    //   DP04_0014E = Mobile home
    //
    // Pre-2026-05-10 build had a long-standing drift: the controller
    // mislabeled DP04_0003E-0010E as structure types (they aren't —
    // 0003E is "Vacant", 0007E is "1-unit detached"), and the renderer
    // showed occupied-vs-vacant under a "structure type" title. Both
    // halves are now aligned to canonical ACS codes.
    const stockCtx = (document.getElementById('chartStock') || {}).getContext;
    if (stockCtx) {
      const ctx = document.getElementById('chartStock').getContext('2d');
      const bins = [
        { label: '1-unit detached', key: 'DP04_0007E' },
        { label: '1-unit attached', key: 'DP04_0008E' },
        { label: '2 units',         key: 'DP04_0009E' },
        { label: '3-4 units',       key: 'DP04_0010E' },
        { label: '5-9 units',       key: 'DP04_0011E' },
        { label: '10-19 units',     key: 'DP04_0012E' },
        { label: '20+ units',       key: 'DP04_0013E' },
        { label: 'Mobile home',     key: 'DP04_0014E' },
      ];
      const values = bins.map(b => safeNum(profile[b.key]) || 0);
      const totalForChart = values.reduce((a, b) => a + b, 0);
      makeChart(ctx, {
        type: 'bar',
        data: {
          labels: bins.map(b => b.label),
          datasets: [{ data: values, backgroundColor: t.c1 }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  const v = ctx.parsed.y;
                  const pct = totalForChart > 0 ? (v / totalForChart * 100).toFixed(1) : '0';
                  return fmtNum(v) + ' units (' + pct + '%)';
                },
              },
            },
          },
          scales: {
            x: { ticks: { color: t.muted, maxRotation: 45, minRotation: 30 }, grid: { display: false } },
            y: { ticks: { color: t.muted, callback: v => fmtNum(v) }, grid: { color: t.border } },
          },
        },
      });
    }

    // chartTenure — Owner vs Renter doughnut.
    //
    // ACS 2023 codes:
    //   DP04_0046E  = Owner-occupied (count, prefer)
    //   DP04_0047E  = Renter-occupied (count, prefer)
    //   DP04_0046PE = Owner-occupied (%) — fallback
    //   DP04_0047PE = Renter-occupied (%) — fallback
    //
    // Pre-fix: renderer read only the count fields, but the B-series
    // fallback path produced only the percent fields, so place/CDP
    // selections that hit the fallback rendered an empty doughnut.
    // Now we try counts first, then derive from percents × occupied.
    const tenureCtx = (document.getElementById('chartTenure') || {}).getContext;
    if (tenureCtx) {
      const ctx = document.getElementById('chartTenure').getContext('2d');
      let owner  = safeNum(profile.DP04_0046E);
      let renter = safeNum(profile.DP04_0047E);
      // Fallback: derive counts from percentages if counts are missing.
      // Total occupied housing units = DP04_0002E (correct in ACS 2023).
      if ((!owner || !renter) && (profile.DP04_0046PE || profile.DP04_0047PE)) {
        const occupied = safeNum(profile.DP04_0002E) || safeNum(profile.DP04_0001E) || 0;
        const ownerPct  = safeNum(profile.DP04_0046PE) || 0;
        const renterPct = safeNum(profile.DP04_0047PE) || 0;
        if (occupied > 0) {
          owner  = owner  || Math.round(occupied * ownerPct  / 100);
          renter = renter || Math.round(occupied * renterPct / 100);
        }
      }
      owner  = owner  || 0;
      renter = renter || 0;
      makeChart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Owner-occupied', 'Renter-occupied'],
          // Use theme palette tokens (c1 + c4). c1 is navy/sky-blue
          // and c4 is brown/amber in both light + dark CSS — high
          // contrast against each other and consistent with every
          // other chart's color story on the page.
          datasets: [{
            data: [owner, renter],
            backgroundColor: [t.c1, t.c4],
            borderColor: [t.c1, t.c4],
            borderWidth: 1,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: t.text } },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  const v = ctx.parsed;
                  const total = owner + renter;
                  const pct = total > 0 ? (v / total * 100).toFixed(1) : '0';
                  return ctx.label + ': ' + fmtNum(v) + ' (' + pct + '%)';
                },
              },
            },
          },
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
    // DP04 gross-rent-as-pct-of-income bins (ACS 2023). The cached
    // summary files and fetchAcsExtended both populate the *PE
    // (percent-of-renters) fields, not the *E (count) fields.
    const bins = [
      { label: '<15%',    key: 'DP04_0137PE' },
      { label: '15–20%',  key: 'DP04_0138PE' },
      { label: '20–25%',  key: 'DP04_0139PE' },
      { label: '25–30%',  key: 'DP04_0140PE' },
      { label: '30–35%',  key: 'DP04_0141PE' },
      { label: '35%+',    key: 'DP04_0142PE' },
    ];
    const values = bins.map(b => safeNum(profile[b.key]) || 0);
    if (values.every(v => v === 0)) return;
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
          y: {
            ticks: { color: t.muted, callback: v => `${v}%` },
            grid: { color: t.border },
          },
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
    const fmtNum  = U().fmtNum;
    // The cache files publish scalar `within`, `inflow`, `outflow` —
    // not a yearly `flows[]` array. Render the current snapshot as
    // three grouped bars so the commuter-flow story is readable at a
    // glance. (A future enhancement could plot history if the cache
    // ever starts shipping flows[].)
    const within  = safeNum(lehd.within)  || 0;
    const inflow  = safeNum(lehd.inflow)  || 0;
    const outflow = safeNum(lehd.outflow) || 0;
    if (within === 0 && inflow === 0 && outflow === 0) {
      _placeholderInBox(canvas, 'LEHD flow data not available for this geography.');
      return;
    }
    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['Live & work in area', 'Inflow (commute in)', 'Outflow (commute out)'],
        datasets: [{
          data: [within, inflow, outflow],
          backgroundColor: [t.c3, t.c1, t.c5],
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (c) { return fmtNum(c.parsed.y) + ' workers'; } } },
        },
        scales: {
          x: { ticks: { color: t.muted }, grid: { color: t.border } },
          y: { ticks: { color: t.muted, callback: function (v) { return fmtNum(v); } }, grid: { color: t.border } },
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
    const fmtNum = U().fmtNum;

    // DOLA SYA cache files store age data as three parallel arrays:
    //   ages   = [0, 1, 2, …, 100]   (single year of age)
    //   male   = [count_age_0, count_age_1, …]
    //   female = [count_age_0, count_age_1, …]
    // Earlier code assumed a `cohorts[]` shape that this file format
    // doesn't have — so both charts rendered empty. Bin into standard
    // 5-year cohorts here.
    const COHORTS = [
      { label: '0–4',   from: 0,  to: 4  },
      { label: '5–9',   from: 5,  to: 9  },
      { label: '10–14', from: 10, to: 14 },
      { label: '15–19', from: 15, to: 19 },
      { label: '20–24', from: 20, to: 24 },
      { label: '25–29', from: 25, to: 29 },
      { label: '30–34', from: 30, to: 34 },
      { label: '35–39', from: 35, to: 39 },
      { label: '40–44', from: 40, to: 44 },
      { label: '45–49', from: 45, to: 49 },
      { label: '50–54', from: 50, to: 54 },
      { label: '55–59', from: 55, to: 59 },
      { label: '60–64', from: 60, to: 64 },
      { label: '65–69', from: 65, to: 69 },
      { label: '70–74', from: 70, to: 74 },
      { label: '75–79', from: 75, to: 79 },
      { label: '80–84', from: 80, to: 84 },
      { label: '85+',   from: 85, to: 200 },
    ];

    const maleArr   = Array.isArray(dola.male)   ? dola.male   : [];
    const femaleArr = Array.isArray(dola.female) ? dola.female : [];
    const sumRange = (arr, from, to) => {
      let s = 0;
      for (let age = from; age <= to && age < arr.length; age++) s += Number(arr[age]) || 0;
      return s;
    };

    const labels = COHORTS.map(c => c.label);
    const malePos   = COHORTS.map(c => sumRange(maleArr,   c.from, c.to));
    const femalePos = COHORTS.map(c => sumRange(femaleArr, c.from, c.to));
    // Pyramid convention: male bars to the left (negative), female to right.
    const maleData = malePos.map(v => -v);
    const femaleData = femalePos;

    if (pyramidCanvas) {
      if (malePos.every(v => v === 0) && femaleData.every(v => v === 0)) {
        _placeholderInBox(pyramidCanvas, 'DOLA age data not available for this geography.');
      } else {
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
            plugins: {
              legend: { labels: { color: t.text } },
              tooltip: { callbacks: { label: function (c) {
                return c.dataset.label + ': ' + fmtNum(Math.abs(c.parsed.x));
              } } },
            },
            scales: {
              x: { stacked: false, ticks: { color: t.muted, callback: v => fmtNum(Math.abs(v)) }, grid: { color: t.border } },
              y: { ticks: { color: t.muted }, grid: { color: t.border } },
            },
          },
        });
      }
    }

    if (seniorCanvas) {
      // Senior cohorts are the last 4 entries (65–69, 70–74, 75–79, 80–84, 85+).
      const seniorIdxStart = COHORTS.findIndex(c => c.from === 65);
      const seniorCohorts = seniorIdxStart >= 0 ? COHORTS.slice(seniorIdxStart) : [];
      const seniorLabels = seniorCohorts.map(c => c.label);
      const seniorValues = seniorCohorts.map(c =>
        sumRange(maleArr, c.from, c.to) + sumRange(femaleArr, c.from, c.to)
      );
      if (seniorValues.every(v => v === 0)) {
        _placeholderInBox(seniorCanvas, 'DOLA senior age data not available for this geography.');
      } else {
        makeChart(seniorCanvas.getContext('2d'), {
          type: 'bar',
          data: {
            labels: seniorLabels,
            datasets: [{ data: seniorValues, backgroundColor: t.c4 }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: function (c) { return fmtNum(c.parsed.y) + ' people'; } } },
            },
            scales: {
              x: { ticks: { color: t.muted }, grid: { color: t.border } },
              y: { ticks: { color: t.muted, callback: function (v) { return fmtNum(v); } }, grid: { color: t.border } },
            },
          },
        });
      }
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
      const lrPath = (window.HNAUtils && window.HNAUtils.PATHS && window.HNAUtils.PATHS.localResources)
        ? window.HNAUtils.PATHS.localResources
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
    const fmtNum = window.HNAUtils.fmtNum;

    // ── Chart 1: chartScenarioComparison — multi-scenario population trends ──
    // ID drift fix: HTML canvas is "chartScenarioComparison"; this code
    // previously looked for the truncated "chartScenarioComp" and the
    // chart never rendered. Audit pass 2026-05-10.
    const compCanvas = document.getElementById('chartScenarioComparison');
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
      // Fallback when proj.scenarios is missing: synthesise three lines
      // from popSel (DOLA forecast) + popSelTrend-style ±15% sensitivity.
      // This makes the chart render for ALL geographies, not just those
      // with explicit scenario series in the projection JSON.
      if (!datasets.some(d => d.data && d.data.length)) {
        const baseline = popSel || proj.population_dola || [];
        datasets.length = 0;
        datasets.push(
          { label: 'Baseline (DOLA)',  data: baseline,                           borderColor: t.c1, borderWidth: 2, pointRadius: 0, tension: 0.25 },
          { label: 'Low growth (-15%)', data: baseline.map(p => p ? p * 0.85 : null), borderColor: t.c5, borderWidth: 2, borderDash: [4,4], pointRadius: 0, tension: 0.25 },
          { label: 'High growth (+15%)',data: baseline.map(p => p ? p * 1.15 : null), borderColor: t.c6, borderWidth: 2, borderDash: [4,4], pointRadius: 0, tension: 0.25 }
        );
      }
      makeChart(compCanvas.getContext('2d'), {
        type: 'line',
        data: { labels: years, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: t.text } } },
          scales: {
            x: { ticks: { color: t.muted }, grid: { color: t.border } },
            y: { ticks: { color: t.muted, callback: v => fmtNum(v) }, grid: { color: t.border } },
          },
        },
      });
    }

    // ── Chart 2: chartProjectionDetail — single-scenario zoom ────────────────
    // Shows the currently-selected scenario's population trajectory. Default
    // is "baseline" (DOLA forecast); changes when the scenario dropdown
    // updates. Same data as chartScenarioComparison but isolated for clarity.
    const detailCanvas = document.getElementById('chartProjectionDetail');
    if (detailCanvas && popSel && popSel.length) {
      const scenarioSel = (document.getElementById('projScenario') || {}).value || 'baseline';
      const scenarios = window.HNAUtils.PROJECTION_SCENARIOS || {};
      const meta = scenarios[scenarioSel] || { label: 'Baseline (DOLA)', color: t.c1 };
      let series = popSel;
      if (proj.scenarios && proj.scenarios[scenarioSel]) {
        series = proj.scenarios[scenarioSel].map(d => d.population || d.pop || 0);
      } else if (scenarioSel === 'low') {
        series = popSel.map(p => p ? p * 0.85 : null);
      } else if (scenarioSel === 'high') {
        series = popSel.map(p => p ? p * 1.15 : null);
      }
      makeChart(detailCanvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: years,
          datasets: [{
            label: meta.label || scenarioSel,
            data: series,
            borderColor: meta.color || t.c1,
            backgroundColor: (meta.color || t.c1) + '22',
            fill: true,
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.25,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: t.text } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y)}` } },
          },
          scales: {
            x: { ticks: { color: t.muted }, grid: { color: t.border } },
            y: { ticks: { color: t.muted, callback: v => fmtNum(v) }, grid: { color: t.border } },
          },
        },
      });
    }

    // ── Chart 3: chartProjectedHH — household formation forecast ────────────
    // DOLA HH series from projection.housing_need.households_dola. Drives
    // the unit-need calculation per DLG methodology.
    const hhCanvas = document.getElementById('chartProjectedHH');
    if (hhCanvas && proj && proj.housing_need && Array.isArray(proj.housing_need.households_dola)) {
      let hhSeries = proj.housing_need.households_dola;
      // For places/CDPs, scale by the same share that drove popSel
      if (popSel && popSel.length === hhSeries.length && proj.population_dola) {
        const baseScale = popSel[0] && proj.population_dola[0] ? popSel[0] / proj.population_dola[0] : 1;
        if (baseScale > 0 && baseScale < 1.0) {
          // Apply share scaling — households scale ~proportionally to population
          hhSeries = hhSeries.map((h, i) => {
            const popScale = popSel[i] && proj.population_dola[i] ? popSel[i] / proj.population_dola[i] : baseScale;
            return h * popScale;
          });
        }
      }
      makeChart(hhCanvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: years,
          datasets: [{
            label: 'Households (DOLA forecast)',
            data: hhSeries,
            borderColor: t.c2,
            backgroundColor: t.c2 + '22',
            fill: true,
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.25,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: t.text } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtNum(Math.round(ctx.parsed.y))}` } },
          },
          scales: {
            x: { ticks: { color: t.muted }, grid: { color: t.border } },
            y: { ticks: { color: t.muted, callback: v => fmtNum(v) }, grid: { color: t.border } },
          },
        },
      });
    }

    // ── Chart 4: chartHouseholdDemand — projected demand by AMI tier ─────────
    // Apportions household growth across CHAS-derived AMI tier shares so
    // analysts can see "X new ≤30% AMI HHs needed by 2030".
    //
    // Pre-fix (PR #798): used statewide heuristic shares.
    // Now (Phase 1 / PR #799): pulls real per-county CHAS Table 7 shares
    // via window.ChasTierShares — preferring TIGER place-CHAS when the
    // selection is a sub-county place/CDP, falling back to county-level
    // CHAS, then to statewide as a last resort.
    const dmdCanvas = document.getElementById('chartHouseholdDemand');
    if (dmdCanvas && proj && proj.housing_need && proj.housing_need.households_dola) {
      const hhSeries = proj.housing_need.households_dola;
      const geoType = S().els && S().els.geoType ? S().els.geoType.value : 'county';
      const geoid   = S().els && S().els.geoSelect ? S().els.geoSelect.value : '';
      const tierColors = [t.c5, t.c3, t.c4, t.c7, t.c6];
      const tierMeta = (window.ChasTierShares
        ? window.ChasTierShares.getRenterSharesWithFallback(geoid, geoType, countyFips5)
        : { source: 'statewide-heuristic', tiers: [
            { label: '≤30% AMI', share: 0.20 }, { label: '31-50% AMI', share: 0.16 },
            { label: '51-80% AMI', share: 0.20 }, { label: '81-100% AMI', share: 0.11 },
            { label: '>100% AMI', share: 0.33 } ] });
      const datasets = tierMeta.tiers.map((tier, idx) => ({
        label: tier.label,
        data: hhSeries.map(h => Math.round(h * tier.share)),
        backgroundColor: tierColors[idx % tierColors.length],
      }));
      makeChart(dmdCanvas.getContext('2d'), {
        type: 'bar',
        data: { labels: years, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: t.text } },
            tooltip: {
              callbacks: {
                label: ctx => `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y)}`,
                footer: () => 'Source: ' + (tierMeta.source === 'place-chas' ? 'TIGER place-CHAS' :
                                              tierMeta.source === 'county-chas' ? 'County CHAS Table 7' :
                                              'CO statewide baseline'),
              },
            },
          },
          scales: {
            x: { stacked: true, ticks: { color: t.muted }, grid: { color: t.border } },
            y: { stacked: true, ticks: { color: t.muted, callback: v => fmtNum(v) }, grid: { color: t.border } },
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
    // Renders the two charts inside the Housing Type Feasibility section:
    //   chartHousingTypeComposition — same data shape as chartStock
    //     (Single-family detached / attached / 2-19 / 20+ / Mobile)
    //   chartConstructionEra        — same data shape as chartHousingAge
    //     (decade-by-decade housing stock build year)
    //
    // Pre-fix: this function was a stub. Both canvases existed in the
    // HTML but no JS rendered them. Audit pass 2026-05-10 wired them
    // to the same ACS 2023 DP04 fields the sibling charts already use.
    if (!profile) return;
    const t = chartTheme();
    const safeNum = U().safeNum;
    const fmtNum  = U().fmtNum;

    // chartHousingTypeComposition — 5-bucket structure-type breakdown
    // (collapsed from chartStock's 8-bucket view for compactness:
    //  single-family combines detached + attached, multi-family
    //  rolls 2-19 and 20+ separately, mobile home stays distinct).
    const compCanvas = document.getElementById('chartHousingTypeComposition');
    if (compCanvas) {
      const sf = (safeNum(profile.DP04_0007E) || 0) + (safeNum(profile.DP04_0008E) || 0);
      const mf2_19 = (safeNum(profile.DP04_0009E) || 0) + (safeNum(profile.DP04_0010E) || 0)
                   + (safeNum(profile.DP04_0011E) || 0) + (safeNum(profile.DP04_0012E) || 0);
      const mf20p  = safeNum(profile.DP04_0013E) || 0;
      const mobile = safeNum(profile.DP04_0014E) || 0;
      const buckets = [
        { label: 'Single-family',    value: sf,      color: t.c1 },
        { label: 'Multi-family 2-19',value: mf2_19,  color: t.c4 },
        { label: 'Multi-family 20+', value: mf20p,   color: t.c5 },
        { label: 'Mobile home',      value: mobile,  color: t.c3 },
      ];
      const total = buckets.reduce((s, b) => s + b.value, 0);
      makeChart(compCanvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: buckets.map(b => b.label),
          datasets: [{
            data: buckets.map(b => b.value),
            backgroundColor: buckets.map(b => b.color),
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: t.text } },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const v = ctx.parsed;
                  const pct = total > 0 ? (v / total * 100).toFixed(1) : '0';
                  return `${ctx.label}: ${fmtNum(v)} (${pct}%)`;
                },
              },
            },
          },
        },
      });
    }

    // chartConstructionEra — same decade bins as chartHousingAge.
    const eraCanvas = document.getElementById('chartConstructionEra');
    if (eraCanvas) {
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
      const total = values.reduce((a, b) => a + b, 0);
      makeChart(eraCanvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: bins.map(b => b.label),
          datasets: [{ data: values, backgroundColor: t.c2 }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const v = ctx.parsed.y;
                  const pct = total > 0 ? (v / total * 100).toFixed(1) : '0';
                  return `${fmtNum(v)} units (${pct}% of stock)`;
                },
              },
            },
          },
          scales: {
            x: { ticks: { color: t.muted }, grid: { display: false } },
            y: { ticks: { color: t.muted, callback: v => fmtNum(v) }, grid: { color: t.border } },
          },
        },
      });
    }
  }

  function renderIncomeDistribution(profile) {
    // ID drift fix: HTML canvas is "chartIncomeDistribution" (full name);
    // this code previously looked for the truncated "chartIncomeDistrib"
    // and the chart never rendered. Audit pass 2026-05-10.
    const canvas = document.getElementById('chartIncomeDistribution');
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
    // ACS 2023 SMOCAPI (selected monthly owner costs as % of income)
    // bins are published as percent fields, not counts. fetchAcsExtended
    // pulls these PE codes; the cache also stores them.
    const bins = [
      { label: '<20%',   key: 'DP04_0111PE' },
      { label: '20–25%', key: 'DP04_0112PE' },
      { label: '25–30%', key: 'DP04_0113PE' },
      { label: '30–35%', key: 'DP04_0114PE' },
      { label: '35%+',   key: 'DP04_0115PE' },
    ];
    const values = bins.map(b => safeNum(profile[b.key]) || 0);
    if (values.every(v => v === 0)) {
      _placeholderInBox(canvas, 'Owner cost-burden data not available for this geography.');
      return;
    }
    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: bins.map(b => b.label), datasets: [{ data: values, backgroundColor: [t.c1,t.c1,t.c1,t.c5,t.c5] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: t.muted } },
          y: { ticks: { color: t.muted, callback: function (v) { return v + '%'; } } },
        },
      },
    });
  }

  function renderHousingGapSummary(profile, geoType) {
    const container = document.getElementById('housingGapSummary');
    if (!container || !profile) return;
    // Pre-fix: this was a one-line stub. Compute a plain-English
    // interpretation of the housing gap from the cached ACS profile +
    // CHAS county data when available, so the section earns its name.
    const safeNum = U().safeNum;
    const fmtNum  = U().fmtNum;
    const fmtPct  = U().fmtPct;

    const totalUnits   = safeNum(profile.DP04_0001E) || 0;
    const renterTotal  = safeNum(profile.DP04_0047E);
    const renterPct    = safeNum(profile.DP04_0047PE);
    const burden30_35  = safeNum(profile.DP04_0141PE) || 0;  // 30-34.9%
    const burden35plus = safeNum(profile.DP04_0142PE) || 0;  // 35%+
    const burden30plus = burden30_35 + burden35plus;          // cost-burdened
    const burden50plus = burden35plus * 0.65;                  // rough severe estimate
    const medianRent   = safeNum(profile.DP04_0134E);
    const medianHomeVal = safeNum(profile.DP04_0089E);

    // CHAS county aggregates, if loaded.
    const chasData = S().state && S().state.chasData;
    const countyFips = U().countyFromGeoid && U().countyFromGeoid(geoType, profile._geoid || '');
    const county = (chasData && countyFips) ? chasData[countyFips] : null;

    const bullets = [];

    // Renter cost-burden — from ACS GRAPI bins.
    if (Number.isFinite(burden30plus) && burden30plus > 0 && Number.isFinite(renterTotal) && renterTotal > 0) {
      const burdenedHH = Math.round(renterTotal * burden30plus / 100);
      bullets.push(
        '<strong>' + fmtPct(burden30plus) + '</strong> of renter households are <strong>cost-burdened</strong> ' +
        '(paying ≥30% of income on rent) — roughly <strong>' + fmtNum(burdenedHH) + '</strong> households. ' +
        (burden35plus >= 20
          ? 'A meaningful share (' + fmtPct(burden35plus) + ') are severely burdened (≥35%), which signals immediate rental-affordability stress.'
          : 'Severe burden (≥35%) is moderate at ' + fmtPct(burden35plus) + '.')
      );
    } else if (geoType === 'state') {
      bullets.push('Statewide ACS GRAPI bins suppress at this granularity — pick a county or place for cost-burden detail.');
    }

    // Affordability gap from rent vs income.
    if (medianRent && profile.DP03_0062E) {
      const mhi = safeNum(profile.DP03_0062E);
      const incomeNeededRent = (medianRent * 12) / 0.30;
      const gapDollars = incomeNeededRent - mhi;
      if (gapDollars > 0) {
        bullets.push(
          'Median rent of <strong>$' + fmtNum(medianRent) + '/mo</strong> needs ' +
          '<strong>$' + fmtNum(Math.round(incomeNeededRent)) + '/yr</strong> at the 30%-of-income rule — ' +
          '<strong>$' + fmtNum(Math.round(gapDollars)) + '</strong> above the median household income (' +
          '$' + fmtNum(mhi) + '). Median renters cannot comfortably afford the median rent here.'
        );
      } else {
        bullets.push(
          'Median rent ($' + fmtNum(medianRent) + '/mo) is within the 30%-of-income window for the median household ' +
          '(income $' + fmtNum(mhi) + ' vs $' + fmtNum(Math.round(incomeNeededRent)) + ' needed). ' +
          'Affordability stress is concentrated below the median income.'
        );
      }
    }

    // CHAS-derived ≤60% AMI deficit (county-level only).
    if (county && county.tiers && Array.isArray(county.tiers)) {
      const lte60Tiers = county.tiers.filter(t => t.ami_tier && /≤30|31[-–]50|51[-–]60/.test(t.ami_tier));
      const totalLte60 = lte60Tiers.reduce((sum, t) => sum + (Number(t.burden_30_50) || 0) + (Number(t.burden_50plus) || 0), 0);
      if (totalLte60 > 0) {
        bullets.push(
          'HUD CHAS county data flags <strong>' + fmtNum(Math.round(totalLte60)) + '</strong> renter households at ≤60% AMI ' +
          'paying ≥30% of income on housing — the cohort LIHTC at 60% AMI rents most directly serves. ' +
          'Use the AMI tier chart below for the per-tier breakdown.'
        );
      }
    }

    // Tenure context closer.
    if (renterPct != null) {
      bullets.push(
        'Renters make up <strong>' + fmtPct(renterPct) + '</strong> of occupied housing ' +
        (renterPct >= 40
          ? '— a meaningful renter base, so rental supply expansion has direct demand.'
          : '— a smaller renter base; affordable rental projects may face longer absorption timelines.')
      );
    }

    if (!bullets.length) {
      container.innerHTML = '<p style="color:var(--muted);">' +
        'Housing gap analysis becomes available once ACS profile + CHAS data load. ' +
        'Try selecting a county.</p>';
      return;
    }

    container.innerHTML =
      '<ul style="margin:0 0 .5rem;padding-left:1.25rem;font-size:.9rem;line-height:1.55;color:var(--text);">' +
        bullets.map(b => '<li style="margin:.35rem 0;">' + b + '</li>').join('') +
      '</ul>' +
      '<p style="margin:.5rem 0 0;font-size:.78rem;color:var(--muted);">' +
        'Source: ACS 5-year DP03/DP04 (vintage 2019–2023) · HUD CHAS Table 7. ' +
        'See the AMI Tier and Rent Burden charts below for the underlying numbers.' +
      '</p>';
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

  // ─────────────────────────────────────────────────────────────────────
  // Labor Market + Economic Indicators
  // ─────────────────────────────────────────────────────────────────────
  //
  // These renderers consume the LEHD cache loaded by the controller into
  // `window.__HNA_LEHD_CACHE[geoid]`. They were stubs until 2026-05-16
  // (the Labor Market section had no implementation, and the Economic
  // Indicators trend charts read from a `state.lehdData` slot that was
  // never populated). The data is rich — annualEmployment, annualWages,
  // industries[], CNS01..CNS20, CE01–CE03, yoyGrowth — so the renderers
  // are straightforward Chart.js wrappers over the existing utility
  // helpers (calculateWageDistribution / parseIndustries).

  /**
   * Get the LEHD blob for a given geoid out of the controller's cache.
   * Returns null if the cache hasn't been populated yet (e.g. state-level
   * selection that didn't fetch a county file).
   */
  function _lehdFor(geoid) {
    var cache = (typeof window !== 'undefined') && window.__HNA_LEHD_CACHE;
    if (!cache) return null;
    return cache[geoid] || cache['08'] || null;
  }

  /**
   * Render an inline "no data" placeholder inside a chart container so
   * an empty canvas doesn't pretend to be a working chart. Used by the
   * stubs-now-implemented Labor Market + Economic Indicators panels.
   */
  function _placeholderInBox(canvas, message) {
    if (!canvas) return;
    var box = canvas.parentElement;
    if (!box) return;
    box.innerHTML = '<p style="margin:0;padding:1rem;color:var(--muted);font-size:.85rem;text-align:center">'
      + escHtml(message) + '</p>';
  }

  /**
   * Look up a Colorado county's display label from a 5-digit FIPS,
   * consulting the in-memory geography config first then the canonical
   * registry. Returns the geoid if neither config has a hit so callers
   * never paste raw FIPS into user-facing copy.
   */
  function _countyLabel(fips) {
    if (!fips) return '';
    var conf = window.__HNA_GEO_CONFIG;
    if (conf && Array.isArray(conf.counties)) {
      var hit = conf.counties.find(function (c) { return c.geoid === fips; });
      if (hit && hit.label) return hit.label;
    }
    var reg = window.__HNA_GEOGRAPHY_REGISTRY;
    if (reg && Array.isArray(reg.geographies)) {
      var match = reg.geographies.find(function (g) { return g.geoid === fips; });
      if (match && match.label) return match.label;
    }
    return fips;
  }

  /**
   * Inject (or update) a "county-scope" disclosure note inside a section
   * when the user has picked a place/cdp but the section's data only
   * exists at county granularity (LEHD, DOLA SYA, BLS QCEW). Hides
   * itself for county / state selections.
   *
   * Two modes:
   *   - 'county' (default) — amber "County-level data" warning. Shown
   *     when the renderer is consuming the raw county blob.
   *   - 'place-apportioned' — green confirmation. Shown when a TIGER
   *     spatial-join place blob (e.g. place-LEHD from
   *     scripts/hna/build_place_lehd.py) replaced the county data.
   *     Optional `confidence` field surfaces the coverage_share
   *     bucket so the user can spot low-confidence apportionments.
   *
   * Matches the visual pattern of chartChasGap's proxy note: colored
   * left-border, muted background, role="note" for screen-reader
   * announcement.
   *
   * @param {string} sectionId  ID of the parent <section>.
   * @param {string} geoType    'state' | 'county' | 'place' | 'cdp'.
   * @param {string} countyFips Containing-county 5-digit FIPS.
   * @param {string} dataKind   Short label for the data source, e.g.
   *                            "LEHD employment data", "DOLA age pyramid".
   * @param {object} [opts]
   * @param {string} [opts.mode]       'county' | 'place-apportioned'
   * @param {string} [opts.confidence] 'high' | 'medium' | 'low'
   */
  function _renderCountyScopeNote(sectionId, geoType, countyFips, dataKind, opts) {
    var section = document.getElementById(sectionId);
    if (!section) return;
    var noteId = sectionId + '__countyScopeNote';
    var existing = document.getElementById(noteId);

    // Hide / remove for non-place selections.
    if (geoType !== 'place' && geoType !== 'cdp') {
      if (existing) existing.remove();
      return;
    }

    var mode = (opts && opts.mode) || 'county';
    var countyLabel = _countyLabel(countyFips);
    var html;
    var noteClass;

    if (mode === 'place-apportioned') {
      var conf = (opts && opts.confidence) || 'high';
      var confLabel = conf === 'high' ? '' :
        (' Coverage confidence: <strong>' + escHtml(conf) + '</strong>.');
      html =
        '<strong>✓ Place-apportioned.</strong> ' +
        escHtml(dataKind) +
        ' is published only at county granularity. Numbers below were ' +
        'apportioned from <strong>' + escHtml(countyLabel) +
        '</strong> using the TIGER 2024 place→tract spatial join and ' +
        'population-weighted shares.' + confLabel;
      noteClass = 'hna-county-scope-note hna-county-scope-note--place';
    } else {
      html =
        '<strong>County-level data.</strong> ' +
        escHtml(dataKind) +
        ' is published only at county granularity. The chart' +
        ' below shows <strong>' + escHtml(countyLabel) +
        '</strong>; your selected place may differ.';
      noteClass = 'hna-county-scope-note';
    }

    if (existing) {
      existing.className = noteClass;
      existing.innerHTML = html;
      return;
    }
    var note = document.createElement('div');
    note.id = noteId;
    note.className = noteClass;
    note.setAttribute('role', 'note');
    note.innerHTML = html;
    // Insert after the first h2 so it sits between the section title
    // and the chart grid below.
    var anchor = section.querySelector('h2') || section.firstElementChild;
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(note, anchor.nextSibling);
    } else {
      section.insertBefore(note, section.firstChild);
    }
  }

  function renderLaborMarketSection(lehd, profile, geoType) {
    var t       = chartTheme();
    var fmtNum  = U().fmtNum;
    var fmtMoney = U().fmtMoney;

    // ── jobMetrics cards ────────────────────────────────────────────
    var metricsEl = document.getElementById('jobMetrics');
    if (metricsEl) {
      if (lehd) {
        var metrics = U().calculateJobMetrics
          ? U().calculateJobMetrics(lehd, profile)
          : null;
        if (metrics) {
          var cards = [];
          if (metrics.jobs)    cards.push({ label: 'Total Jobs',   value: fmtNum(metrics.jobs) });
          if (metrics.within)  cards.push({ label: 'Live & Work Here', value: fmtNum(metrics.within) });
          if (metrics.inflow)  cards.push({ label: 'Inflow Workers',   value: fmtNum(metrics.inflow) });
          if (metrics.outflow) cards.push({ label: 'Outflow Workers',  value: fmtNum(metrics.outflow) });
          if (metrics.jwRatio) cards.push({
            label: 'Jobs : Workers',
            value: (Math.round(metrics.jwRatio * 100) / 100).toFixed(2),
          });
          metricsEl.innerHTML = cards.map(function (c) {
            return '<div class="metric-card"><div class="mc-label">' + escHtml(c.label)
              + '</div><div class="mc-value">' + escHtml(c.value) + '</div></div>';
          }).join('');
        } else {
          metricsEl.innerHTML = '';
        }
      } else {
        metricsEl.innerHTML = '<p style="margin:0;padding:.5rem;color:var(--muted);font-size:.85rem">'
          + 'LEHD cache not yet available for this geography.</p>';
      }
    }

    // ── chartWage — wage distribution snapshot ─────────────────────
    var wageCanvas = document.getElementById('chartWage');
    if (wageCanvas) {
      var dist = lehd && U().calculateWageDistribution
        ? U().calculateWageDistribution(lehd)
        : null;
      if (dist) {
        makeChart(wageCanvas.getContext('2d'), {
          type: 'bar',
          data: {
            labels: ['Low (≤$15k/yr)', 'Medium ($15–40k)', 'High ($40k+)'],
            datasets: [{
              data: [dist.low, dist.medium, dist.high],
              backgroundColor: [t.c5, t.c3, t.c1],
            }],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: function (c) { return fmtNum(c.parsed.y) + ' jobs'; } } },
            },
            scales: {
              x: { ticks: { color: t.muted }, grid: { color: t.border } },
              y: { ticks: { color: t.muted, callback: function (v) { return fmtNum(v); } }, grid: { color: t.border } },
            },
          },
        });
      } else {
        _placeholderInBox(wageCanvas, 'LEHD wage data not available for this geography.');
      }
    }

    // ── chartIndustry — top industries by employment ───────────────
    var indCanvas = document.getElementById('chartIndustry');
    if (indCanvas) {
      var industries = lehd && U().parseIndustries
        ? U().parseIndustries(lehd, 6)
        : [];
      if (industries.length) {
        makeChart(indCanvas.getContext('2d'), {
          type: 'bar',
          data: {
            labels: industries.map(function (i) { return i.label; }),
            datasets: [{ data: industries.map(function (i) { return i.count; }), backgroundColor: t.c1 }],
          },
          options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: function (c) { return fmtNum(c.parsed.x) + ' jobs'; } } },
            },
            scales: {
              x: { ticks: { color: t.muted, callback: function (v) { return fmtNum(v); } }, grid: { color: t.border } },
              y: { ticks: { color: t.muted }, grid: { color: t.border } },
            },
          },
        });
      } else {
        _placeholderInBox(indCanvas, 'LEHD industry data not available for this geography.');
      }
    }
  }

  function renderEmploymentTrend(geoid) {
    var canvas = document.getElementById('chartEmploymentTrend');
    if (!canvas) return;
    var lehd = _lehdFor(geoid);
    var ae = lehd && lehd.annualEmployment;
    // annualEmployment is a dict { year → totalJobs } in cache files.
    var years = ae && typeof ae === 'object'
      ? Object.keys(ae).sort()
      : [];
    if (!years.length) {
      _placeholderInBox(canvas, 'Employment trend data not yet cached for this geography.');
      return;
    }
    var t = chartTheme();
    var fmtNum = U().fmtNum;
    makeChart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: years,
        datasets: [{
          label: 'Total Jobs',
          data: years.map(function (y) { return Number(ae[y]) || 0; }),
          borderColor: t.c1, backgroundColor: 'rgba(9,110,101,.12)',
          borderWidth: 2, pointRadius: 3, tension: 0.2, fill: true,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: t.text } },
          tooltip: { callbacks: { label: function (c) { return fmtNum(c.parsed.y) + ' jobs'; } } },
        },
        scales: {
          x: { ticks: { color: t.muted }, grid: { color: t.border } },
          y: { ticks: { color: t.muted, callback: function (v) { return fmtNum(v); } }, grid: { color: t.border } },
        },
      },
    });
  }

  function renderWageTrend(geoid) {
    var canvas = document.getElementById('chartWageTrend');
    if (!canvas) return;
    var lehd = _lehdFor(geoid);
    var aw = lehd && lehd.annualWages;
    var years = aw && typeof aw === 'object'
      ? Object.keys(aw).sort()
      : [];
    if (!years.length) {
      _placeholderInBox(canvas, 'Wage trend data not yet cached for this geography.');
      return;
    }
    var t = chartTheme();
    var fmtNum = U().fmtNum;
    // Each year's wage record has {low, medium, high} job counts at the
    // three LEHD WAC wage bands. Render three lines so the band-by-band
    // year-over-year shift is glance-able.
    var lowVals    = years.map(function (y) { return Number(aw[y] && aw[y].low)    || 0; });
    var mediumVals = years.map(function (y) { return Number(aw[y] && aw[y].medium) || 0; });
    var highVals   = years.map(function (y) { return Number(aw[y] && aw[y].high)   || 0; });
    makeChart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: years,
        datasets: [
          { label: 'Low (≤$15k)',    data: lowVals,    borderColor: t.c5, backgroundColor: t.c5, borderWidth: 2, pointRadius: 3, tension: 0.2 },
          { label: 'Medium ($15–40k)', data: mediumVals, borderColor: t.c3, backgroundColor: t.c3, borderWidth: 2, pointRadius: 3, tension: 0.2 },
          { label: 'High ($40k+)',   data: highVals,   borderColor: t.c1, backgroundColor: t.c1, borderWidth: 2, pointRadius: 3, tension: 0.2 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: t.text } },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + fmtNum(c.parsed.y) + ' jobs'; } } },
        },
        scales: {
          x: { ticks: { color: t.muted }, grid: { color: t.border } },
          y: { ticks: { color: t.muted, callback: function (v) { return fmtNum(v); } }, grid: { color: t.border } },
        },
      },
    });
  }

  function renderIndustryAnalysis(geoid) {
    var canvas = document.getElementById('chartIndustryAnalysis');
    if (!canvas) return;
    var lehd = _lehdFor(geoid);
    var industries = lehd && U().parseIndustries
      ? U().parseIndustries(lehd, 8)
      : [];
    if (!industries.length) {
      _placeholderInBox(canvas, 'Industry analysis data not yet cached for this geography.');
      return;
    }
    var t = chartTheme();
    var fmtNum = U().fmtNum;
    // Compute share-of-total for the share-axis label. Falls back to
    // raw count when the pct field is absent (state-aggregate files
    // already populate pct; per-county files don't always).
    var total = industries.reduce(function (s, i) { return s + (i.count || 0); }, 0);
    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: industries.map(function (i) { return i.label; }),
        datasets: [{
          data: industries.map(function (i) { return i.count; }),
          backgroundColor: t.c2,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (c) {
            var pct = total > 0 ? ' (' + ((c.parsed.x / total) * 100).toFixed(1) + '%)' : '';
            return fmtNum(c.parsed.x) + ' jobs' + pct;
          } } },
        },
        scales: {
          x: { ticks: { color: t.muted, callback: function (v) { return fmtNum(v); } }, grid: { color: t.border } },
          y: { ticks: { color: t.muted }, grid: { color: t.border } },
        },
      },
    });
  }

  function renderEconomicIndicators(geoid) {
    // Cards container — the HTML has #econIndicatorCards (lower section)
    // and the legacy #economicIndicatorsCards is unused. Prefer the
    // current one; fall back so the old ID keeps working if anything
    // out-of-tree references it.
    var container = document.getElementById('econIndicatorCards') ||
      document.getElementById('economicIndicatorsCards');
    if (!container) return;
    var lehd = _lehdFor(geoid);
    if (!lehd) {
      container.innerHTML = '<p style="margin:0;padding:.5rem;color:var(--muted);font-size:.85rem">'
        + 'Economic indicators not yet cached for this geography.</p>';
      return;
    }
    var fmtNum = U().fmtNum;
    var ae    = lehd.annualEmployment || {};
    var yoy   = lehd.yoyGrowth || {};
    var years = Object.keys(ae).sort();
    var latestYear  = years[years.length - 1];
    var prevYear    = years[years.length - 2];
    var latestJobs  = latestYear ? Number(ae[latestYear]) : null;
    var prevJobs    = prevYear   ? Number(ae[prevYear])   : null;
    var latestYoy   = yoy[latestYear];
    var cumulative  = (latestJobs && prevJobs && years.length >= 5)
      ? (((latestJobs - Number(ae[years[0]])) / Number(ae[years[0]])) * 100)
      : null;

    var cards = [];
    if (latestJobs) {
      cards.push({
        label: 'Total Jobs (' + (latestYear || '') + ')',
        value: fmtNum(latestJobs),
      });
    }
    if (typeof latestYoy === 'number') {
      cards.push({
        label: 'YoY Change',
        value: (latestYoy > 0 ? '+' : '') + latestYoy.toFixed(2) + '%',
      });
    }
    if (cumulative !== null) {
      cards.push({
        label: years[0] + '–' + latestYear + ' Cumulative',
        value: (cumulative > 0 ? '+' : '') + cumulative.toFixed(1) + '%',
      });
    }
    if (lehd.industries && lehd.industries.length) {
      cards.push({
        label: 'Top Industry',
        value: lehd.industries[0].label,
      });
    }
    container.innerHTML = cards.map(function (c) {
      return '<div class="metric-card"><div class="mc-label">' + escHtml(c.label)
        + '</div><div class="mc-value">' + escHtml(c.value) + '</div></div>';
    }).join('');
  }

  function renderWageGaps(geoid, profile) {
    // Find the empty .chart-container--bar div the HTML reserves
    // and inject a canvas for the wage-gap bar chart. The container
    // is empty by design (HTML doesn't ship a canvas — the renderer
    // owns the chart instance lifecycle).
    var wrap = document.getElementById('wageGapsContainer');
    if (!wrap) return;
    var box = wrap.querySelector('.chart-container');
    if (!box) return;

    var lehd = _lehdFor(geoid);
    var dist = lehd && U().calculateWageDistribution
      ? U().calculateWageDistribution(lehd)
      : null;
    if (!dist || !dist.total) {
      box.innerHTML = '<p style="margin:0;padding:1rem;color:var(--muted);font-size:.85rem;text-align:center">'
        + 'Wage gap data not yet cached for this geography.</p>';
      return;
    }

    // Ensure a canvas exists inside the box (idempotent on re-render).
    var canvasId = 'chartWageGaps';
    var canvas = document.getElementById(canvasId);
    if (!canvas) {
      box.innerHTML = '';
      canvas = document.createElement('canvas');
      canvas.id = canvasId;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'Wage gap distribution: high vs medium vs low');
      box.appendChild(canvas);
    }

    var t = chartTheme();
    var fmtNum = U().fmtNum;
    var lowPct    = (dist.low    / dist.total) * 100;
    var mediumPct = (dist.medium / dist.total) * 100;
    var highPct   = (dist.high   / dist.total) * 100;

    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['Low (≤$15k/yr)', 'Medium ($15–40k)', 'High ($40k+)'],
        datasets: [{
          data: [lowPct, mediumPct, highPct],
          backgroundColor: [t.c5, t.c3, t.c1],
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (c) {
            var counts = [dist.low, dist.medium, dist.high][c.dataIndex];
            return c.parsed.y.toFixed(1) + '% (' + fmtNum(counts) + ' jobs)';
          } } },
        },
        scales: {
          x: { ticks: { color: t.muted }, grid: { color: t.border } },
          y: {
            beginAtZero: true,
            ticks: { color: t.muted, callback: function (v) { return v + '%'; } },
            grid: { color: t.border },
          },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Prop 123 / compliance (stubs)
  // ---------------------------------------------------------------------------

  function renderProp123Section(profile, geoType, countyFips) {
    // Renders the two Prop 123 charts:
    //   chartProp123Growth      — required 3% annual affordable-unit growth
    //                              trajectory from a baseline derived from
    //                              the current housing stock (DP04_0001E)
    //   chartProp123Historical  — placeholder when historical compliance
    //                              data isn't yet available; shows the
    //                              jurisdiction's commitment status from
    //                              data/policy/prop123_jurisdictions.json
    //
    // Pre-fix: this function was a stub. Both canvases existed in the HTML
    // but no JS rendered them. Audit pass 2026-05-10 wired them.
    if (!profile) return;
    const t = chartTheme();
    const safeNum = U().safeNum;
    const fmtNum  = U().fmtNum;

    // ── chartProp123Growth — 10-year 3% annual growth target ────────────
    // Prop 123 requires participating jurisdictions to commit to a 3%
    // annual increase in affordable housing units. The "baseline" is the
    // jurisdiction's current affordable-housing inventory; we estimate
    // it from total occupied housing units × LIHTC participation share.
    // Real baselines come from CDOLA jurisdictional filings — until those
    // are wired in, we show the REQUIRED-GROWTH trajectory at the assumed
    // baseline so analysts can see the magnitude of the commitment.
    const growthCanvas = document.getElementById('chartProp123Growth');
    if (growthCanvas) {
      const totalUnits  = safeNum(profile.DP04_0001E) || 0;
      // Heuristic: assume ~6% of total housing stock is currently the
      // "affordable" baseline (mix of LIHTC, HOME, vouchers, NHTF). Real
      // jurisdiction-specific baselines come from CDOLA filings.
      const baseline = Math.round(totalUnits * 0.06);
      const years = [];
      const required = [];
      const baseYear = 2025;
      for (let i = 0; i <= 10; i++) {
        years.push(String(baseYear + i));
        required.push(Math.round(baseline * Math.pow(1.03, i)));
      }
      makeChart(growthCanvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: years,
          datasets: [{
            label: '3% Annual Growth (Prop 123 commitment)',
            data: required,
            borderColor: t.c1,
            backgroundColor: t.c1 + '22',
            fill: true,
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.25,
          }, {
            label: 'Baseline (assumed 6% of stock)',
            data: years.map(() => baseline),
            borderColor: t.muted,
            borderWidth: 1,
            borderDash: [4, 4],
            pointRadius: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: t.text } },
            tooltip: {
              callbacks: {
                label: ctx => `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y)} units`,
              },
            },
          },
          scales: {
            x: { ticks: { color: t.muted }, grid: { display: false } },
            y: { ticks: { color: t.muted, callback: v => fmtNum(v) }, grid: { color: t.border } },
          },
        },
      });
    }

    // ── chartProp123Historical — compliance tracking placeholder ───────
    // Prop 123 went into effect in 2023. Annual compliance reporting is
    // due via CDOLA filings. Until those filings are aggregated into a
    // historical timeseries, we show a 3-year sparse view with the
    // baseline year + a forward-looking growth band.
    const histCanvas = document.getElementById('chartProp123Historical');
    if (histCanvas) {
      const totalUnits  = safeNum(profile.DP04_0001E) || 0;
      const baseline = Math.round(totalUnits * 0.06);
      const years = ['2023', '2024', '2025', '2026', '2027', '2028'];
      // Show baseline (2023) + required-growth trajectory + an "actual"
      // line that's null until real reporting data lands.
      const required = years.map((_, i) => Math.round(baseline * Math.pow(1.03, i)));
      makeChart(histCanvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: years,
          datasets: [{
            label: 'Required (3% growth)',
            data: required,
            borderColor: t.c1,
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.25,
          }, {
            label: 'Actual (CDOLA filings — not yet aggregated)',
            data: years.map(() => null),
            borderColor: t.c5,
            borderWidth: 2,
            pointRadius: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: t.text } },
            tooltip: {
              callbacks: {
                label: ctx => ctx.parsed.y == null ? `${ctx.dataset.label}: pending` : `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y)}`,
              },
            },
          },
          scales: {
            x: { ticks: { color: t.muted }, grid: { display: false } },
            y: { ticks: { color: t.muted, callback: v => fmtNum(v) }, grid: { color: t.border } },
          },
        },
      });

      // Update the inline status text above the chart
      const statusEl = document.getElementById('prop123HistoricalStatus');
      if (statusEl) {
        statusEl.textContent = `Estimated baseline: ${fmtNum(baseline)} affordable units. ` +
          `Required by 2028 at 3% annual growth: ${fmtNum(required[5])} units. ` +
          `Annual CDOLA compliance filings will populate the "Actual" series once aggregated.`;
      }
    }
  }

  /**
   * Populate the Prop 123 baseline / fast-track cards on HNA. The HTML
   * ships these with "Select a geography…" placeholders that never
   * cleared because no renderer touched them. With a profile in hand
   * we can derive a directional baseline (6% of housing stock) and
   * surface the fast-track eligibility check the utility already
   * computes (population threshold per HB 22-1093).
   *
   * The baseline is intentionally a directional estimate — the
   * jurisdiction-specific number comes from CDOLA Prop 123
   * commitment filings. Labelled so the user knows it's an estimate.
   */
  function renderProp123BaselineAndFastTrack(profile, geoType, geoLabel) {
    var safeNum = U().safeNum;
    var fmtNum  = U().fmtNum;

    // ── Baseline: 60% AMI rentals (directional) ─────────────────────
    var baselineEl = document.getElementById('prop123BaselineContent');
    if (baselineEl) {
      var totalUnits = safeNum(profile && profile.DP04_0001E) || 0;
      if (totalUnits > 0) {
        // Heuristic: ~6% of total housing stock is the directional
        // affordable baseline (mix of LIHTC, HOME, vouchers, NHTF).
        // Jurisdiction-specific numbers come from CDOLA filings;
        // matches the estimator used by chartProp123Growth.
        var baseline = Math.round(totalUnits * 0.06);
        var required3yr = Math.round(baseline * Math.pow(1.03, 3));
        baselineEl.innerHTML =
          '<div style="font-size:1.5rem;font-weight:800;color:var(--text);margin:0 0 .25rem">'
            + fmtNum(baseline) + ' units</div>'
          + '<p style="margin:0;color:var(--muted);font-size:.85rem;line-height:1.45">'
            + '<strong>Directional estimate</strong> (~6% of '
            + fmtNum(totalUnits) + ' total housing units in '
            + escHtml(geoLabel || 'this area')
            + '). 3-yr target at 3% growth: <strong style="color:var(--text)">'
            + fmtNum(required3yr) + ' units</strong>.<br>'
            + 'Jurisdiction-specific baselines come from CDOLA Prop 123 '
            + 'commitment filings.</p>';
      } else {
        baselineEl.innerHTML =
          '<p style="margin:0;color:var(--muted);font-size:.9rem">'
          + 'Housing-stock data not available for this geography.</p>';
      }
    }

    // ── Fast-track approval eligibility (HB 22-1093) ────────────────
    var fastTrackEl = document.getElementById('prop123FastTrackContent');
    if (fastTrackEl) {
      var pop = safeNum(profile && profile.DP05_0001E);
      var check = (U().checkFastTrackEligibility && pop != null)
        ? U().checkFastTrackEligibility(pop, geoType)
        : null;
      if (check && check.eligible !== null) {
        var iconColor = check.eligible ? 'var(--good,#16a34a)' : 'var(--warn,#d97706)';
        var icon = check.eligible ? '✓' : '⚠';
        var label = check.eligible ? 'Eligible' : 'Not Eligible';
        fastTrackEl.innerHTML =
          '<div style="font-size:1.5rem;font-weight:800;color:' + iconColor + ';margin:0 0 .25rem">'
            + icon + ' ' + label + '</div>'
          + '<p style="margin:0;color:var(--muted);font-size:.85rem;line-height:1.45">'
            + escHtml(check.reason)
            + '. Per HB 22-1093 fast-track (60-day) permitting requires the '
            + 'jurisdiction to be at or above the population threshold and '
            + 'to have filed a Prop 123 commitment.</p>';
      } else {
        fastTrackEl.innerHTML =
          '<p style="margin:0;color:var(--muted);font-size:.9rem">'
          + 'Population data not available for this geography.</p>';
      }
    }
  }

  function renderFastTrackCalculatorSection() {
    // Renders the Prop 123 / HB 22-1093 fast-track timeline calculator
    // output. Reads the form values, computes a permitting-duration
    // estimate, and writes the result into #ftResult. Pre-fix: this
    // function was an empty stub and targeted a non-existent
    // 'fastTrackSection' container. Phase 2 wires it to the real DOM.
    const resultEl = document.getElementById('ftResult');
    if (!resultEl) return;
    const sizeEl  = document.getElementById('ftDealSize');
    const typeEl  = document.getElementById('ftType');
    const trackEl = document.getElementById('ftTrack');
    const dealSize = sizeEl ? Number(sizeEl.value) || 50 : 50;
    const dealType = typeEl ? (typeEl.value || 'multifamily') : 'multifamily';
    const track    = trackEl ? (trackEl.value || 'fast') : 'fast';
    // Heuristic timeline (months) — HB 22-1093 fast-track requires local
    // approval within 90 days for compliant deals; standard is 6-12 mo.
    const baseMonths = track === 'fast' ? 3 : (dealType === 'multifamily' ? 8 : 6);
    const sizeAdjust = dealSize > 100 ? 1 : dealSize > 50 ? 0.5 : 0;
    const estMonths = baseMonths + sizeAdjust;
    const fmtNum = U().fmtNum;
    resultEl.innerHTML =
      '<div style="margin-top:10px;padding:10px;background:var(--bg2);border-left:3px solid var(--accent);border-radius:4px;font-size:.9rem;">' +
        '<strong>Estimated approval timeline: ' + estMonths.toFixed(1) + ' months</strong><br>' +
        '<span style="color:var(--muted);font-size:.85rem;">Track: ' + (track === 'fast' ? 'Fast-track (HB 22-1093)' : 'Standard') +
          ' · Type: ' + dealType + ' · Size: ' + fmtNum(dealSize) + ' units</span>' +
        (track === 'fast'
          ? '<br><span style="color:var(--good,#16a34a);font-size:.8rem;">⚡ ~' +
            Math.round((1 - estMonths / 8) * 100) + '% time savings vs. standard process.</span>'
          : '') +
      '</div>';
  }

  function renderHistoricalSection(baselineData, geoType, geoid) {
    // Delegates to window.Prop123Tracker (loaded from
    // js/prop123-historical-tracker.js) which already provides the
    // historical-compliance chart renderer and DOLA filing-status
    // builder. Pre-fix: stub. Phase 2 wires the delegation.
    if (!window.Prop123Tracker) return;
    // The Prop 123 historical chart lives at #chartProp123Historical
    // and is rendered by renderProp123Section (PR #798). This function
    // additionally populates the historical-content table beneath the
    // chart with a year-by-year breakdown.
    const contentEl = document.getElementById('prop123HistoricalContent');
    if (!contentEl) return;
    // baselineData may be null when no commitment filing exists; in
    // that case we show explanatory copy + the DOLA filing schedule.
    const baseline = (baselineData && baselineData.baseline) || null;
    if (!baseline) {
      contentEl.innerHTML =
        '<p style="color:var(--muted);font-size:.88rem;">' +
        'No Prop 123 commitment filing on record for this geography yet. ' +
        'Once CDOLA receives the annual filing, the historical-compliance ' +
        'table will populate with year-by-year delta data.</p>';
      return;
    }
    const traj = window.Prop123Tracker.calculateComplianceTrajectory(
      baseline, baselineData.actuals || [], new Date().getFullYear()
    );
    if (!traj) return;
    let html = '<table style="width:100%;border-collapse:collapse;font-size:.85rem;">' +
      '<thead><tr>' +
        '<th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border);">Year</th>' +
        '<th style="text-align:right;padding:4px 8px;border-bottom:1px solid var(--border);">Required</th>' +
        '<th style="text-align:right;padding:4px 8px;border-bottom:1px solid var(--border);">Actual</th>' +
        '<th style="text-align:right;padding:4px 8px;border-bottom:1px solid var(--border);">Δ</th>' +
      '</tr></thead><tbody>';
    (traj.rows || []).forEach(r => {
      const delta = r.actual != null ? (r.actual - r.required) : null;
      const deltaColor = delta == null ? 'var(--muted)' : (delta >= 0 ? 'var(--good,#16a34a)' : 'var(--bad,#dc2626)');
      html += '<tr>' +
        '<td style="padding:4px 8px;">' + r.year + '</td>' +
        '<td style="text-align:right;padding:4px 8px;font-variant-numeric:tabular-nums;">' + (r.required || '—') + '</td>' +
        '<td style="text-align:right;padding:4px 8px;font-variant-numeric:tabular-nums;">' + (r.actual != null ? r.actual : 'pending') + '</td>' +
        '<td style="text-align:right;padding:4px 8px;color:' + deltaColor + ';">' + (delta != null ? (delta >= 0 ? '+' : '') + delta : '—') + '</td>' +
      '</tr>';
    });
    html += '</tbody></table>';
    contentEl.innerHTML = html;
  }

  function renderComplianceTable(histData, traj, baseline, container) {
    // Used by renderHistoricalSection. With the new inline rendering
    // there, this helper is no longer required, but the export stays
    // for backwards compat with any external callers.
    if (!container) return;
    if (!traj || !traj.rows) {
      container.innerHTML = '<p style="color:var(--muted);">No compliance data yet.</p>';
      return;
    }
    let html = '<table style="width:100%;border-collapse:collapse;font-size:.85rem;">' +
      '<thead><tr><th>Year</th><th>Required</th><th>Actual</th></tr></thead><tbody>';
    traj.rows.forEach(r => {
      html += '<tr><td>' + r.year + '</td><td>' + (r.required || '—') + '</td><td>' + (r.actual != null ? r.actual : 'pending') + '</td></tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // BLS / CHAS / FMR / Scorecard (stubs)
  // ---------------------------------------------------------------------------

  function renderBlsLabourMarket(countyFips5, geoType, econData) {
    // Renders 4 KPI cards (unemployment, job growth, population growth,
    // affordability index) for the chosen county into #blsLabourMarketCards.
    // Data source: data/co-county-economic-indicators.json (keyed by
    // county NAME — convert from FIPS via U().CO_COUNTY_NAMES).
    //
    // Pre-fix: empty stub. Phase 2 wires it to the real DOM with
    // graceful degradation for state/place selections.
    const container = document.getElementById('blsLabourMarketCards');
    if (!container) return;
    if (!econData || !econData.counties) {
      container.innerHTML = '<p style="color:var(--muted);font-size:.85rem;">Labor-market data unavailable.</p>';
      return;
    }
    const countyNames = (U() && U().CO_COUNTY_NAMES) || {};
    let countyName = null;
    if (countyFips5) {
      countyName = countyNames[countyFips5] || countyNames[String(countyFips5).padStart(5, '0')];
    }
    if (!countyName) {
      // State or unknown — show CO statewide aggregate (median across counties)
      const allMetrics = Object.values(econData.counties);
      const median = arr => {
        const sorted = arr.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
        return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
      };
      countyName = 'Colorado (statewide median)';
      const rec = {
        unemployment_rate: median(allMetrics.map(m => m.unemployment_rate)),
        job_growth_5yr_pct: median(allMetrics.map(m => m.job_growth_5yr_pct)),
        population_growth_5yr_pct: median(allMetrics.map(m => m.population_growth_5yr_pct)),
        affordability_index: median(allMetrics.map(m => m.affordability_index)),
      };
      container.innerHTML = _renderBlsCards(rec, countyName);
      return;
    }
    const rec = econData.counties[countyName] || econData.counties[countyName.replace(' County', '')];
    if (!rec) {
      container.innerHTML = '<p style="color:var(--muted);font-size:.85rem;">No labor-market data for ' + countyName + '.</p>';
      return;
    }
    container.innerHTML = _renderBlsCards(rec, countyName);
  }

  function _renderBlsCards(rec, label) {
    const fmt = (v, suffix) => v == null || !Number.isFinite(v) ? '—' : v.toFixed(1) + (suffix || '');
    const cards = [
      { title: 'Unemployment',       value: fmt(rec.unemployment_rate, '%'),         note: 'BLS LAUS (current)' },
      { title: 'Job growth (5y)',    value: fmt(rec.job_growth_5yr_pct, '%'),        note: 'BLS QCEW' },
      { title: 'Pop growth (5y)',    value: fmt(rec.population_growth_5yr_pct, '%'), note: 'ACS / DOLA' },
      { title: 'Affordability idx',  value: fmt(rec.affordability_index, ''),        note: 'Home price / median HHI' },
    ];
    let html = '<div style="font-size:.78rem;color:var(--muted);margin-bottom:6px;">' + escHtml(label) + '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.5rem;">';
    cards.forEach(c => {
      html += '<div style="padding:.5rem;border:1px solid var(--border);border-radius:4px;background:var(--bg2);">' +
        '<div style="font-size:.72rem;color:var(--muted);">' + escHtml(c.title) + '</div>' +
        '<div style="font-size:1.15rem;font-weight:700;font-variant-numeric:tabular-nums;">' + escHtml(c.value) + '</div>' +
        '<div style="font-size:.68rem;color:var(--muted);margin-top:2px;">' + escHtml(c.note) + '</div>' +
      '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderGapCoverageStats(countyFips5, chasData) {
    // Renders gap-coverage summary card. Pre-fix: stub targeting
    // 'gapCoverageStats' container which doesn't exist in current HTML.
    // We INJECT the card into the existing CHAS section so the data
    // surfaces somewhere useful. Idempotent — only injects once.
    if (!chasData || !countyFips5) return;
    let container = document.getElementById('gapCoverageStats');
    if (!container) {
      // Find an anchor near the CHAS chart and inject ourselves
      const chartAnchor = document.getElementById('chasGapStatus');
      if (!chartAnchor) return;
      container = document.createElement('div');
      container.id = 'gapCoverageStats';
      container.style.cssText = 'margin-top:.5rem;font-size:.78rem;color:var(--muted);line-height:1.5;';
      chartAnchor.parentNode.insertBefore(container, chartAnchor.nextSibling);
    }
    const counties = (chasData && chasData.counties) || chasData || {};
    const rec = counties[countyFips5];
    if (!rec || !rec.summary) {
      container.innerHTML = '';
      return;
    }
    const s = rec.summary;
    const cb30Renter = s.pct_renter_cb30 != null ? (s.pct_renter_cb30 * 100).toFixed(1) + '%' : '—';
    const cb50Renter = s.pct_renter_cb50 != null ? (s.pct_renter_cb50 * 100).toFixed(1) + '%' : '—';
    container.innerHTML =
      '<strong>Coverage summary:</strong> ' +
      'Renter cost-burden (≥30% income): <strong>' + cb30Renter + '</strong>. ' +
      'Severe (≥50%): <strong>' + cb50Renter + '</strong>. ' +
      'Source: HUD CHAS 2018-2022.';
  }

  function renderFmrPanel(countyFips5) {
    // Renders FY2025 HUD Fair Market Rents + Income Limits tables for
    // the chosen county. Pre-fix: this function was an empty stub and
    // targeted the wrong container id ('fmrPanel'). The actual HTML has
    // three containers:
    //   #hudFmrAreaName        — area name label
    //   #hudFmrTable           — FMR by bedroom size table
    //   #hudIncomeLimitsTable  — Income Limits by HH size table
    //
    // Real rendering work is done by window.HudFmr (data-connectors/
    // hud-fmr.js) which already builds the HTML tables. We just have
    // to wait for HudFmr to load and mount the output.
    if (!countyFips5) return;
    const areaEl    = document.getElementById('hudFmrAreaName');
    const fmrEl     = document.getElementById('hudFmrTable');
    const incomeEl  = document.getElementById('hudIncomeLimitsTable');
    if (!fmrEl && !incomeEl) return;

    function _doRender() {
      if (!window.HudFmr || !window.HudFmr.isLoaded()) return false;
      const summary = window.HudFmr.getSummaryByFips(countyFips5);
      if (areaEl && summary) {
        areaEl.textContent = (summary.fmr_area_name || summary.county_name || 'Unknown area') +
          (summary.ami_4person ? ' · 4-person AMI: $' + Number(summary.ami_4person).toLocaleString() : '');
      }
      if (fmrEl) {
        const html = window.HudFmr.renderFmrTable(countyFips5);
        fmrEl.innerHTML = html || '<span style="color:var(--muted)">FMR data unavailable.</span>';
      }
      if (incomeEl) {
        const html = window.HudFmr.renderIncomeLimitsTable(countyFips5);
        incomeEl.innerHTML = html || '<span style="color:var(--muted)">Income limits data unavailable.</span>';
      }
      return true;
    }

    if (_doRender()) return;
    // HudFmr not loaded yet — wait for the loaded event then re-render.
    if (window.HudFmr && typeof window.HudFmr.load === 'function') {
      window.HudFmr.load().then(_doRender).catch(function () {
        if (fmrEl) fmrEl.innerHTML = '<span style="color:var(--muted)">FMR data failed to load.</span>';
      });
    } else {
      // Fall back to polling once for the connector script to land.
      document.addEventListener('HudFmr:loaded', _doRender, { once: true });
    }
  }

  function renderHnaScorecardPanel(geoid) {
    // Renders a composite Housing Needs Assessment scorecard for the
    // selected geography. Reads from the unified ranking-index +
    // chas_affordability_gap data already on disk, surfaces a 4-card
    // grid:  Housing Burden · Income Tier Mix · Supply Pressure ·
    //        Overall Rank (percentile).
    //
    // Pre-fix: empty stub. Phase 2 implements minimal scorecard with
    // graceful degradation. The container is display:none by default;
    // we toggle to display:block when rendering succeeds.
    const container = document.getElementById('hnaScorecardPanel');
    if (!container) return;
    if (!geoid) { container.style.display = 'none'; return; }

    const state = S() && S().state;
    const chasData = state && state.chasData;
    const profile  = state && state.lastProfile;
    if (!chasData || !profile) {
      container.style.display = 'none';
      return;
    }
    const countyFips = String(geoid).length === 5 ? geoid : (state.contextCounty || (String(geoid).length === 7 ? null : geoid));
    if (!countyFips) { container.style.display = 'none'; return; }
    const countyRec = (chasData.counties || chasData)[countyFips];
    if (!countyRec || !countyRec.summary) {
      container.style.display = 'none';
      return;
    }
    const safeNum = U().safeNum;
    const fmtNum  = U().fmtNum;

    // Card 1 — Housing Burden (% renter cost-burdened >30%)
    const burdenPct = (countyRec.summary.pct_renter_cb30 || 0) * 100;
    // Card 2 — Income Tier Mix (% lte30 share of renters)
    const lte30 = countyRec.renter_hh_by_ami && countyRec.renter_hh_by_ami.lte30 || {};
    const allTiers = ['lte30','31to50','51to80','81to100','100plus']
      .reduce((s, k) => s + ((countyRec.renter_hh_by_ami && countyRec.renter_hh_by_ami[k] && countyRec.renter_hh_by_ami[k].total) || 0), 0);
    const lte30Share = allTiers > 0 ? (lte30.total || 0) / allTiers * 100 : 0;
    // Card 3 — Supply Pressure (renter share of total occupied)
    const renterPct = safeNum(profile.DP04_0047PE) || 0;
    // Card 4 — Overall (composite z-score-ish blend → percentile-like 0-100)
    // Higher = more housing need. Burden + low-income share + renter share blend.
    const composite = Math.min(100, Math.round((burdenPct * 0.45) + (lte30Share * 0.30) + (renterPct * 0.25)));

    container.style.display = 'block';
    container.innerHTML =
      '<h2 style="font-size:1.05rem;margin:0 0 .5rem">Housing Needs Scorecard</h2>' +
      '<p style="font-size:.78rem;color:var(--muted);margin:0 0 .75rem">' +
        'Composite of CHAS cost-burden, income-tier mix, and renter-share signals. Higher = more acute housing need.' +
      '</p>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.6rem;">' +
        _scorecardCard('Renter burden', burdenPct.toFixed(1) + '%', 'paying ≥30% of income on rent', burdenPct >= 50 ? 'bad' : burdenPct >= 35 ? 'warn' : 'good') +
        _scorecardCard('≤30% AMI share', lte30Share.toFixed(1) + '%', 'of renter households', lte30Share >= 25 ? 'bad' : lte30Share >= 18 ? 'warn' : 'good') +
        _scorecardCard('Renter share', renterPct.toFixed(1) + '%', 'of occupied units', null) +
        _scorecardCard('Overall need', composite + '/100', 'composite (45/30/25 blend)', composite >= 60 ? 'bad' : composite >= 45 ? 'warn' : 'good') +
      '</div>';
  }

  function _scorecardCard(title, value, note, severity) {
    const sev = severity === 'bad' ? 'var(--bad,#dc2626)' :
                severity === 'warn' ? 'var(--warn,#d97706)' :
                severity === 'good' ? 'var(--good,#16a34a)' : 'var(--text)';
    return '<div style="padding:.6rem;border:1px solid var(--border);border-radius:6px;background:var(--bg2);">' +
      '<div style="font-size:.72rem;color:var(--muted);">' + escHtml(title) + '</div>' +
      '<div style="font-size:1.25rem;font-weight:700;color:' + sev + ';font-variant-numeric:tabular-nums;">' + escHtml(value) + '</div>' +
      '<div style="font-size:.68rem;color:var(--muted);margin-top:2px;">' + escHtml(note) + '</div>' +
    '</div>';
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

    // ── TIGER place-level CHAS path (PR-C3) ────────────────────────────
    // When the user selected a place/cdp AND the TIGER spatial-join data
    // is loaded for that geoid, prefer the place-level CHAS over the
    // county fallback. The TIGER computation aggregates underlying tracts
    // weighted by area, so cross-county jurisdictions (Aurora, Erie,
    // Longmont) get accurate place-level rates instead of inheriting
    // their primary county's average.
    const _tigerPlaceTiers = () => {
      if (!selectedGeo || (selectedGeo.type !== 'place' && selectedGeo.type !== 'cdp')) return null;
      if (!window.PlaceChas || typeof window.PlaceChas.lookup !== 'function') return null;
      const place = window.PlaceChas.lookup(selectedGeo.geoid);
      if (!place || !place.renter_hh_by_ami) return null;
      const tierOrder = ['lte30', '31to50', '51to80', '81to100', '100plus'];
      const tierLabels = {
        lte30:    '≤30% AMI',
        '31to50': '31–50% AMI',
        '51to80': '51–80% AMI',
        '81to100':'81–100% AMI',
        '100plus':'>100% AMI',
      };
      return tierOrder.map((key) => {
        const td = place.renter_hh_by_ami[key] || {};
        // burden_30_50 = moderate cost burden (cb30 - cb50)
        // burden_50plus = severe cost burden (cb50)
        const cb30 = td.cost_burdened_30pct || 0;
        const cb50 = td.cost_burdened_50pct || 0;
        return {
          ami_tier: tierLabels[key],
          tier: key,
          burden_30_50: Math.max(0, cb30 - cb50),
          burden_50plus: cb50,
        };
      });
    };

    // Render or clear the proxy-disclosure note above the chart.
    // PR-C3: when the chart is being driven by TIGER place-CHAS, render
    // a green "TIGER 2024 place-level" attribution instead of the
    // amber "scaled from county" warning.
    const _renderProxyNote = (countyName, isTigerPlace) => {
      let noteEl = document.getElementById('chartChasGapProxyNote');
      if (isTigerPlace) {
        if (!noteEl) {
          noteEl = document.createElement('div');
          noteEl.id = 'chartChasGapProxyNote';
          noteEl.setAttribute('role', 'note');
          const wrap = canvas.closest('.chart-card') || canvas.parentElement;
          if (wrap) wrap.insertBefore(noteEl, wrap.firstChild.nextSibling);
        }
        noteEl.style.cssText =
          'margin:0 0 .5rem;padding:.5rem .75rem;border-left:3px solid var(--good,#16a34a);' +
          'border-radius:0 4px 4px 0;background:rgba(34,197,94,.08);font-size:.78rem;' +
          'line-height:1.45;color:var(--text);';
        const placeLabel = (selectedGeo && selectedGeo.name) || 'this place';
        noteEl.textContent = '';
        const intro = document.createElement('strong');
        intro.style.color = 'var(--good,#16a34a)';
        intro.textContent = '✓ Place-level CHAS (TIGER 2024).';
        noteEl.appendChild(intro);
        noteEl.appendChild(document.createTextNode(
          ' Computed by area-weighted apportionment of underlying census tracts inside ' + placeLabel + '. '
          + 'Accurate even for jurisdictions that span county lines (Aurora, Erie, etc.) '
          + 'where the primary-county fallback would mis-state burden rates.'
        ));
        return;
      }
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

    // PR-C3: try TIGER place-level CHAS first
    const tigerTiers = _tigerPlaceTiers();
    if (tigerTiers && tigerTiers.length) {
      _renderProxyNote(null, /* isTigerPlace */ true);
      _setProvenanceBadge('tiger');
      _renderTiers(tigerTiers, /* sourceLabel */ (selectedGeo && selectedGeo.name) || 'place', /* tigerSource */ true);
      return;
    }

    if (!chasData) {
      if (statusEl) statusEl.textContent = 'CHAS affordability data not available.';
      _renderProxyNote('');
      _setProvenanceBadge('none');
      return;
    }

    const county = chasData[countyFips5] || chasData['statewide'] || null;
    if (!county) {
      if (statusEl) statusEl.textContent = `No CHAS data for FIPS ${countyFips5}.`;
      _setProvenanceBadge('none');
      return;
    }

    _renderProxyNote(county.name || countyFips5);
    // Distinguish "user picked a county directly" (clean) from "user picked
    // a place/cdp but TIGER didn't have it, so we're showing county fallback"
    // (less clean — flag with amber badge).
    const isPlaceProxy = selectedGeo &&
      (selectedGeo.type === 'place' || selectedGeo.type === 'cdp') &&
      selectedGeo.geoid && selectedGeo.geoid !== countyFips5 && countyFips5;
    _setProvenanceBadge(isPlaceProxy ? 'county-approx' : 'county');
    _renderTiers(county.tiers || [], county.name || countyFips5, /* tigerSource */ false);
  }

  /**
   * Set the provenance badge next to the CHAS chart title to make the
   * methodology stamp glance-able. Three states:
   *   'tiger'         → green "TIGER 2024 place-level"
   *   'county'        → blue "County" (clean — user picked a county directly)
   *   'county-approx' → amber "County-approx" (user picked a place/cdp not in
   *                     TIGER coverage; chart shows containing county data)
   *   'none'          → hidden
   */
  function _setProvenanceBadge(state) {
    const badge = document.getElementById('chasProvenanceBadge');
    if (!badge) return;
    if (state === 'none' || !state) {
      badge.hidden = true;
      badge.textContent = '';
      return;
    }
    const states = {
      'tiger': {
        text:   '✓ TIGER 2024 place-level',
        bg:     'rgba(22,163,74,.12)',
        border: 'rgba(22,163,74,.5)',
        color:  'var(--good,#16a34a)',
        title:  'CHAS rates computed by area-weighted apportionment of underlying tracts inside the place. Accurate for cross-county jurisdictions.',
      },
      'county': {
        text:   'County',
        bg:     'rgba(37,99,235,.10)',
        border: 'rgba(37,99,235,.5)',
        color:  '#2563eb',
        title:  'CHAS rates from HUD’s county-level publication. You selected a county directly.',
      },
      'county-approx': {
        text:   '⚠ County-approx',
        bg:     'rgba(217,119,6,.10)',
        border: 'rgba(217,119,6,.5)',
        color:  'var(--warn,#d97706)',
        title:  'You selected a place/CDP not covered by TIGER 2024 place-CHAS — the chart shows the containing county’s rates as a proxy. See data-quality dashboard for coverage stats.',
      },
    };
    const s = states[state];
    if (!s) {
      badge.hidden = true;
      return;
    }
    badge.textContent = s.text;
    badge.style.background = s.bg;
    badge.style.border = '1px solid ' + s.border;
    badge.style.color = s.color;
    badge.title = s.title;
    badge.hidden = false;
  }

  // Shared chart-rendering helper used by both the TIGER place-CHAS path
  // (PR-C3) and the legacy county fallback. Pulled out of the original
  // function so the TIGER path can call it without duplicating the chart
  // setup. `sourceLabel` is shown in the status footer.
  function _renderTiers(tiers, sourceLabel, tigerSource) {
    const canvas = document.getElementById('chartChasGap');
    const statusEl = document.getElementById('chasGapStatus');
    if (!canvas) return;
    if (!tiers || !tiers.length) {
      if (statusEl) statusEl.textContent = 'CHAS tier data unavailable.';
      return;
    }
    const t = chartTheme();
    const safeNum = U().safeNum;
    const labels  = tiers.map(r => r.ami_tier || r.tier || r.label || '');
    const burden30_50   = tiers.map(r => safeNum(r.burden_30_50)  || 0);
    const burden_50plus = tiers.map(r => safeNum(r.burden_50plus) || 0);
    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Cost-burdened 30–50%', data: burden30_50,    backgroundColor: t.c3, stack: 'burden' },
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
    if (statusEl) {
      statusEl.textContent = tigerSource
        ? `Source: HUD CHAS 2018-2022 + TIGER 2024 spatial join — ${sourceLabel} (place-level).`
        : `Source: HUD CHAS — ${sourceLabel}.`;
    }
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
    // County-scope disclosure (place/cdp selections)
    renderCountyScopeNote: _renderCountyScopeNote,
    // Prop 123
    renderProp123Section,
    renderProp123BaselineAndFastTrack,
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
