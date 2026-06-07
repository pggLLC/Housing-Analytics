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

    // F160 — chartHomeValue: owner-occupied home value distribution.
    // ACS DP04_0081E - DP04_0088E. Renders an 8-bin bar chart so the
    // skew that the median DP04_0089E hides (very common in CO resort
    // and exurban markets) is legible at a glance.
    const valueCtx = (document.getElementById('chartHomeValue') || {}).getContext;
    if (valueCtx) {
      const ctx = document.getElementById('chartHomeValue').getContext('2d');
      const bins = [
        { label: '< $50K',     key: 'DP04_0081E' },
        { label: '$50-100K',   key: 'DP04_0082E' },
        { label: '$100-150K',  key: 'DP04_0083E' },
        { label: '$150-200K',  key: 'DP04_0084E' },
        { label: '$200-300K',  key: 'DP04_0085E' },
        { label: '$300-500K',  key: 'DP04_0086E' },
        { label: '$500K-1M',   key: 'DP04_0087E' },
        { label: '$1M+',       key: 'DP04_0088E' }
      ];
      const values = bins.map(b => safeNum(profile[b.key]) || 0);
      const totalForChart = values.reduce((a, b) => a + b, 0);
      // If brackets aren't populated yet (cached summary served before the
      // supplemental fetch resolved), surface an honest empty state rather
      // than a deceptive all-zero bar chart. The supplement re-renders.
      const card = document.getElementById('chartHomeValue').closest('.chart-card');
      if (totalForChart === 0 && card) {
        const existing = card.querySelector('.chart-empty-note');
        if (!existing) {
          const note = document.createElement('p');
          note.className = 'chart-empty-note';
          note.style.cssText = 'font-size:.78rem;color:var(--muted);font-style:italic;margin:.4rem 0 0';
          note.textContent = 'Home-value bracket data is still loading — chart will populate once the ACS supplement returns. ' +
            'Tiny CDPs with no owner-occupied units may render empty by design.';
          card.appendChild(note);
        }
      } else if (card) {
        const existing = card.querySelector('.chart-empty-note');
        if (existing) existing.remove();
      }
      // F254 — Small-town home-value disclaimer. The ACS 5-year sample
      // averages 5 years of responses. For towns under ~500 owner-occupied
      // units (covers Paonia, Crested Butte, Telluride, Aspen, ~200 small CO
      // places), a handful of high-value homes can fall entirely outside the
      // sample, showing $1M+ as zero or under-counting $500K-1M. The chart
      // is correct for its data source but misses recent boom dynamics in
      // amenity-rich small towns (North Fork Valley orchards/wine, ski-town
      // gentrification). The note here tells the user what to cross-check.
      if (totalForChart > 0 && totalForChart < 500 && card) {
        const smallTownNote = card.querySelector('.chart-small-town-note');
        if (!smallTownNote) {
          const note = document.createElement('p');
          note.className = 'chart-small-town-note';
          note.style.cssText = 'font-size:.74rem;color:var(--warn);background:var(--warn-dim);' +
            'padding:.4rem .55rem;border-radius:5px;margin:.4rem 0 0;line-height:1.4;';
          note.innerHTML = '<strong>Small-sample caveat:</strong> Census ACS 2020-2024 averages five years of survey responses. ' +
            'For places under 500 owner-occupied units, a handful of high-value homes can fall outside the sample — the $1M+ ' +
            'and $500K-1M brackets in particular may be under-counted in amenity-rich small towns where home values rose ' +
            'sharply 2022-2024 (Paonia, Crested Butte, Telluride, Aspen, etc.). For current ranges, cross-check Zillow listings ' +
            'or the nearest metro Zillow Home Value Index.';
          card.appendChild(note);
        }
      } else if (card) {
        const stale = card.querySelector('.chart-small-town-note');
        if (stale) stale.remove();
      }
      makeChart(ctx, {
        type: 'bar',
        data: {
          labels: bins.map(b => b.label),
          datasets: [{ data: values, backgroundColor: t.c1 }]
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
                }
              }
            }
          },
          scales: {
            x: { ticks: { color: t.muted, maxRotation: 45, minRotation: 30 }, grid: { display: false } },
            y: { ticks: { color: t.muted, callback: v => fmtNum(v) }, grid: { color: t.border } }
          }
        }
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
   * renderAffordChart — render the homeownership affordability chart
   * (chartAfford). Bar 1 = median household income for the selected
   * geography; Bar 2 = annual income required to afford the typical
   * owner-occupied home under a 30-yr fixed PITI mortgage at AFFORD.*
   * assumptions, computed by U().computeIncomeNeeded(homeValue).
   *
   * Previously this computed rent-based affordability ((rent*12)/0.30)
   * while the surrounding HTML claimed "mortgage model" — fixed.
   *
   * @param {object} profile
   */
  function renderAffordChart(profile) {
    const canvas = document.getElementById('chartAfford');
    if (!canvas || !profile) return;
    const t        = chartTheme();
    const safeNum  = U().safeNum;
    const fmtMoney = U().fmtMoney;
    const mhi       = safeNum(profile.DP03_0062E) || 0;
    const homeValue = safeNum(profile.DP04_0089E) || 0;
    const calc      = (typeof U().computeIncomeNeeded === 'function')
      ? U().computeIncomeNeeded(homeValue)
      : null;
    const needed    = calc && Number.isFinite(calc.annualIncome) ? calc.annualIncome : 0;
    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['Median HH Income', 'Income Needed to Buy (est.)'],
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

    // "Show your work" disclosure — print the inputs, the PITI breakdown,
    // and the income math so the chart bar is fully traceable.
    if (S().els && S().els.affordAssumptions) {
      const A = U().AFFORD;
      const fmtM = (n) => fmtMoney ? fmtMoney(Math.round(n)) : '$' + Math.round(n).toLocaleString();
      const inputsHtml = Number.isFinite(homeValue) && homeValue > 0
        ? '<p style="margin:0 0 6px"><strong>Inputs for this geography:</strong> median owner-occupied home value (ACS DP04_0089E) = <strong>' + fmtM(homeValue) + '</strong>.</p>'
        : '<p style="margin:0 0 6px;color:var(--warn)">Median home value not available for this geography — income figure not computed.</p>';
      let breakdownHtml = '';
      if (calc && calc.components) {
        const c = calc.components;
        breakdownHtml =
          '<p style="margin:8px 0 4px"><strong>Monthly PITI breakdown:</strong></p>' +
          '<ul style="margin:0 0 8px;padding-left:20px">' +
            '<li>Principal &amp; interest: <strong>' + fmtM(c.pAndI) + '</strong> (loan of ' + fmtM(calc.loan) + ' at ' + (A.rateAnnual*100).toFixed(2) + '% over ' + A.termYears + ' yr)</li>' +
            '<li>Property tax: <strong>' + fmtM(c.tax) + '</strong> · home insurance: <strong>' + fmtM(c.ins) + '</strong>' + (c.pmi > 0 ? ' · PMI: <strong>' + fmtM(c.pmi) + '</strong>' : '') + '</li>' +
            '<li>Total monthly housing payment: <strong>' + fmtM(calc.payment) + '</strong></li>' +
            '<li>÷ ' + Math.round(A.paymentToIncome*100) + '% (max share of gross income on housing) × 12 = <strong>' + fmtM(calc.annualIncome) + '</strong> annual income needed</li>' +
          '</ul>';
      }
      S().els.affordAssumptions.innerHTML =
        inputsHtml +
        breakdownHtml +
        '<p style="margin:8px 0 4px"><strong>Mortgage assumptions:</strong></p>' +
        '<ul style="margin:0;padding-left:20px">' +
          '<li>Interest rate: <strong>' + (A.rateAnnual*100).toFixed(2) + '%</strong> (30-yr fixed) · term: <strong>' + A.termYears + ' yr</strong></li>' +
          '<li>Down payment: <strong>' + Math.round(A.downPaymentPct*100) + '%</strong> · PMI: <strong>' + (A.pmiPctAnnual*100).toFixed(2) + '%</strong> of loan/yr when down &lt; 20%</li>' +
          '<li>Property tax: <strong>' + (A.propertyTaxPctAnnual*100).toFixed(2) + '%</strong> of home value/yr · insurance: <strong>' + (A.insurancePctAnnual*100).toFixed(2) + '%</strong> of home value/yr</li>' +
          '<li>Underwriting rule: monthly PITI ≤ <strong>' + Math.round(A.paymentToIncome*100) + '%</strong> of gross household income (lenders typically use 28%; we use the more generous 30% rule-of-thumb)</li>' +
        '</ul>' +
        '<p style="margin:8px 0 0;font-size:.78rem">Reality-check: actual underwriting also looks at total debt-to-income, credit score, reserves, and DSCR. This card is a screening estimate, not a pre-qualification.</p>';
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
    if (noteEl) {
      var isPlace = geoType === 'place' || geoType === 'cdp';
      if (isPlace && lehd.flows_source === 'block-od') {
        noteEl.textContent = 'Place-level flows from BLOCK-classified LEHD LODES OD — every (home block → work block) pair classified against the place boundary; no intra-place double-counting.';
      } else if (isPlace && lehd.flows_source === 'tract-lodes') {
        noteEl.textContent = 'Place-level flows aggregated from tract-level LEHD LODES, weighted by the place’s population share of each tract — directional where a tract extends past the municipal boundary.';
      } else {
        noteEl.textContent = '';
      }
    }
  }

  /**
   * renderDolaPyramid — render age pyramid (chartPyramid) and senior
   * housing need chart (chartSenior) from DOLA SYA + ACS B01001 data.
   *
   * F185 — Accepts EITHER county DOLA data, EITHER place ACS cohorts, or
   * BOTH. When both are present (place geography selected), each chart
   * renders two side-by-side bar groups: the place from ACS B01001
   * 5-year estimates + the containing county from DOLA SYA projections.
   *
   * @param {object|null} dola      - DOLA SYA JSON (county/state) — null on place-only
   * @param {object|null} placeCoh  - ACS B01001 cohort response — null on county/state
   * @param {object|null} ctx       - F186: explicit { geoType, geoid, geoLabel, contextCounty }
   *                                  passed by the controller BEFORE state.current is updated.
   *                                  Without it, labels lagged one selection behind (e.g. user
   *                                  switched Acres Green → Fruita, chart still said Acres Green).
   *                                  Falls back to S().state.current for back-compat.
   */
  function renderDolaPyramid(dola, placeCoh, ctx) {
    const pyramidCanvas = document.getElementById('chartPyramid');
    const seniorCanvas  = document.getElementById('chartSenior');
    const noteEl = S().els && S().els.seniorNote;

    if (!dola && !placeCoh) {
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

    const maleArr   = (dola && Array.isArray(dola.male))   ? dola.male   : [];
    const femaleArr = (dola && Array.isArray(dola.female)) ? dola.female : [];
    const sumRange = (arr, from, to) => {
      let s = 0;
      for (let age = from; age <= to && age < arr.length; age++) s += Number(arr[age]) || 0;
      return s;
    };

    const labels = COHORTS.map(c => c.label);
    const countyMalePos   = COHORTS.map(c => sumRange(maleArr,   c.from, c.to));
    const countyFemalePos = COHORTS.map(c => sumRange(femaleArr, c.from, c.to));
    // Pyramid convention: male bars to the left (negative), female to right.
    const countyMaleData   = countyMalePos.map(v => -v);
    const countyFemaleData = countyFemalePos;

    // F185 — place series from ACS B01001 cohorts (already binned to 5-year)
    // Aligned to the same COHORTS labels so they slot side-by-side cleanly.
    const placeMalePos   = placeCoh && Array.isArray(placeCoh.cohorts)
      ? COHORTS.map(c => {
          const bin = placeCoh.cohorts.find(b => b.label.replace('–','-') === c.label.replace('–','-'));
          return bin ? (Number(bin.male)   || 0) : 0;
        })
      : null;
    const placeFemalePos = placeCoh && Array.isArray(placeCoh.cohorts)
      ? COHORTS.map(c => {
          const bin = placeCoh.cohorts.find(b => b.label.replace('–','-') === c.label.replace('–','-'));
          return bin ? (Number(bin.female) || 0) : 0;
        })
      : null;
    const placeMaleData   = placeMalePos   ? placeMalePos.map(v => -v) : null;
    const placeFemaleData = placeFemalePos ? placeFemalePos.slice()    : null;

    // F186 — Prefer the explicit ctx the controller passes (always reflects the
    // jurisdiction currently being rendered). Fall back to S().state.current if
    // an older caller invokes without ctx — that's stale by one cycle but still
    // mostly works.
    const cur = ctx || ((S().state && S().state.current) || {});
    const _rawPlaceLabel = String(cur.geoLabel || cur.label || cur.name || '').replace(/\s*\((?:town|city|CDP)\)\s*$/i, '').trim();
    const _placeLabel = _rawPlaceLabel || 'place';
    // F135 — `cur.contextCounty` is a 5-digit FIPS code (e.g. "08001"), not a
    // label. The previous code treated it as text and the senior-growth
    // legend rendered "08069" instead of "Larimer County". Resolve FIPS →
    // county name via the geo-config the controller loads, with a hard-coded
    // CO_COUNTY_NAMES fallback so the lookup works even if the registry is
    // mid-load. If both fail we fall back to "Containing county" rather
    // than expose the raw FIPS.
    const _CO_COUNTY_NAMES = {
      '08001':'Adams','08003':'Alamosa','08005':'Arapahoe','08007':'Archuleta','08009':'Baca',
      '08011':'Bent','08013':'Boulder','08014':'Broomfield','08015':'Chaffee','08017':'Cheyenne',
      '08019':'Clear Creek','08021':'Conejos','08023':'Costilla','08025':'Crowley','08027':'Custer',
      '08029':'Delta','08031':'Denver','08033':'Dolores','08035':'Douglas','08037':'Eagle',
      '08039':'Elbert','08041':'El Paso','08043':'Fremont','08045':'Garfield','08047':'Gilpin',
      '08049':'Grand','08051':'Gunnison','08053':'Hinsdale','08055':'Huerfano','08057':'Jackson',
      '08059':'Jefferson','08061':'Kiowa','08063':'Kit Carson','08065':'Lake','08067':'La Plata',
      '08069':'Larimer','08071':'Las Animas','08073':'Lincoln','08075':'Logan','08077':'Mesa',
      '08079':'Mineral','08081':'Moffat','08083':'Montezuma','08085':'Montrose','08087':'Morgan',
      '08089':'Otero','08091':'Ouray','08093':'Park','08095':'Phillips','08097':'Pitkin',
      '08099':'Prowers','08101':'Pueblo','08103':'Rio Blanco','08105':'Rio Grande','08107':'Routt',
      '08109':'Saguache','08111':'San Juan','08113':'San Miguel','08115':'Sedgwick','08117':'Summit',
      '08119':'Teller','08121':'Washington','08123':'Weld','08125':'Yuma',
    };
    function _resolveCountyLabel(raw) {
      var s = String(raw || '').trim();
      if (!s) return '';
      // If it's a 5-digit FIPS, look up the name.
      if (/^\d{5}$/.test(s)) {
        if (_CO_COUNTY_NAMES[s]) return _CO_COUNTY_NAMES[s] + ' County';
        var conf = window.__HNA_GEO_CONFIG;
        if (conf && Array.isArray(conf.counties)) {
          var entry = conf.counties.find(function (c) { return c.geoid === s; });
          if (entry && entry.label) {
            return /county$/i.test(entry.label) ? entry.label : entry.label + ' County';
          }
        }
        return ''; // unresolved
      }
      // Already a label
      return s.replace(/county$/i, 'County');
    }
    const _countyLabel = _resolveCountyLabel(cur.containingCounty || cur.contextCounty) || 'Containing county';

    if (pyramidCanvas) {
      const countyHasData = countyMalePos.some(v => v !== 0) || countyFemaleData.some(v => v !== 0);
      const placeHasData  = placeMalePos && (placeMalePos.some(v => v !== 0) || placeFemalePos.some(v => v !== 0));
      if (!countyHasData && !placeHasData) {
        _placeholderInBox(pyramidCanvas, 'Age data not available for this geography.');
      } else {
        const datasets = [];
        if (placeHasData) {
          datasets.push({ label: _placeLabel + ' · Male',   data: placeMaleData,   backgroundColor: t.c1, borderWidth: 0, stack: 'place' });
          datasets.push({ label: _placeLabel + ' · Female', data: placeFemaleData, backgroundColor: t.c3, borderWidth: 0, stack: 'place' });
        }
        if (countyHasData) {
          datasets.push({ label: _countyLabel + ' · Male',   data: countyMaleData,   backgroundColor: t.c2, borderWidth: 0, stack: 'county' });
          datasets.push({ label: _countyLabel + ' · Female', data: countyFemaleData, backgroundColor: t.c4, borderWidth: 0, stack: 'county' });
        }
        makeChart(pyramidCanvas.getContext('2d'), {
          type: 'bar',
          data: { labels, datasets },
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
      // Senior cohorts are the last entries (65–69, 70–74, 75–79, 80–84, 85+).
      const seniorIdxStart = COHORTS.findIndex(c => c.from === 65);
      const seniorCohorts = seniorIdxStart >= 0 ? COHORTS.slice(seniorIdxStart) : [];
      const seniorLabels = seniorCohorts.map(c => c.label);
      const countySeniors = seniorCohorts.map(c =>
        sumRange(maleArr, c.from, c.to) + sumRange(femaleArr, c.from, c.to)
      );
      const placeSeniors = placeMalePos
        ? seniorCohorts.map(c => {
            const i = COHORTS.findIndex(cc => cc.label === c.label);
            return i >= 0 ? (placeMalePos[i] + placeFemalePos[i]) : 0;
          })
        : null;
      const countyHasData = countySeniors.some(v => v > 0);
      const placeHasData  = placeSeniors && placeSeniors.some(v => v > 0);
      if (!countyHasData && !placeHasData) {
        _placeholderInBox(seniorCanvas, 'Senior age data not available for this geography.');
      } else {
        const datasets = [];
        if (placeHasData) {
          datasets.push({ label: _placeLabel, data: placeSeniors, backgroundColor: t.c1 });
        }
        if (countyHasData) {
          datasets.push({ label: _countyLabel, data: countySeniors, backgroundColor: t.c4 });
        }
        makeChart(seniorCanvas.getContext('2d'), {
          type: 'bar',
          data: { labels: seniorLabels, datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: datasets.length > 1, labels: { color: t.text } },
              tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + fmtNum(c.parsed.y) + ' people'; } } },
            },
            scales: {
              x: { ticks: { color: t.muted }, grid: { color: t.border } },
              y: { ticks: { color: t.muted, callback: function (v) { return fmtNum(v); } }, grid: { color: t.border } },
            },
          },
        });
      }
    }

    // F185 — Disclosure: surface what each series came from.
    if (noteEl) {
      const isPlace = cur.geoType === 'place' || cur.geoType === 'cdp';
      if (isPlace && placeCoh && _rawPlaceLabel) {
        const yr = placeCoh.year || 'ACS 5-year';
        noteEl.innerHTML =
          '<strong>' + escHtml(_placeLabel) + '</strong> bars: ACS 5-year B01001 ' + escHtml(String(yr)) +
          ' (live Census API). <strong>' + escHtml(_countyLabel) +
          '</strong> bars: DOLA SDO single-year-of-age projection. Two sources, two vintages — directional comparison only.';
        noteEl.style.fontSize = '.78rem';
        noteEl.style.color = 'var(--muted)';
        noteEl.style.marginTop = '4px';
        noteEl.style.fontStyle = 'italic';
      } else if (isPlace && _rawPlaceLabel) {
        // ACS fetch failed; only county available — keep the F183 disclosure.
        noteEl.innerHTML =
          '<strong>Data shown: ' + escHtml(_countyLabel) + '</strong> — place-level ACS B01001 fetch failed; ' +
          'falling back to county DOLA SYA. For ' + escHtml(_placeLabel) + '-specific cohorts, retry or check Census API status.';
        noteEl.style.fontSize = '.78rem';
        noteEl.style.color = 'var(--muted)';
        noteEl.style.marginTop = '4px';
        noteEl.style.fontStyle = 'italic';
      } else {
        noteEl.textContent = '';
        noteEl.style.cssText = '';
      }
    }
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
  function renderLihtcLayer(data, placeCtx) {
    if (!window.L || !S().map) return;

    // Clear existing layer
    if (S().lihtcLayer) { S().lihtcLayer.remove(); S().lihtcLayer = null; }
    S().allLihtcFeatures = [];

    const features = (data && Array.isArray(data.features)) ? data.features : [];
    S().allLihtcFeatures = features;

    // Update project + unit stats. When a place/CDP is selected, break out the
    // jurisdiction's OWN projects (matched by project city) from the containing
    // county total — a bare county count shown for a small town overstates the
    // local pipeline (e.g. New Castle has 1 LIHTC project, Garfield County 7).
    const countEl = S().els && S().els.statLihtcCount;
    const unitsEl = S().els && S().els.statLihtcUnits;
    const projCity = (p) => String(p.PROJ_CTY || p.proj_cty || p.PROJ_CITY || p.CITY || '').trim().toUpperCase();
    const liUnits  = (p) => parseInt(p.LI_UNITS || p.li_units || 0, 10) || 0;
    const totalUnits = features.reduce((sum, f) => sum + liUnits(f.properties || {}), 0);
    const subOf = (el, txt) => { if (el && el.parentElement) { const s = el.parentElement.querySelector('.s'); if (s) s.textContent = txt; } };

    const isPlace = placeCtx && (placeCtx.type === 'place' || placeCtx.type === 'cdp') && placeCtx.name;
    if (isPlace) {
      const placeLabel = String(placeCtx.name).replace(/\s*\((?:town|city|CDP)\)\s*$/i, '').trim();
      const target = placeLabel.toUpperCase();
      const inPlace = features.filter(f => projCity(f.properties || {}) === target);
      const placeUnits = inPlace.reduce((sum, f) => sum + liUnits(f.properties || {}), 0);
      const cn = (features.find(f => (f.properties || {}).CNTY_NAME) || {}).properties;
      let countyLabel = (cn && cn.CNTY_NAME) ? cn.CNTY_NAME : 'county';
      if (!/county$/i.test(countyLabel)) countyLabel += ' County';
      if (countEl) countEl.textContent = inPlace.length;
      subOf(countEl, 'in ' + placeLabel + ' · ' + features.length + ' in ' + countyLabel);
      if (unitsEl) unitsEl.textContent = U().fmtNum(placeUnits);
      subOf(unitsEl, 'in ' + placeLabel + ' · ' + U().fmtNum(totalUnits) + ' county-wide');
    } else {
      if (countEl) countEl.textContent = features.length;
      subOf(countEl, 'HUD database');
      if (unitsEl) unitsEl.textContent = U().fmtNum(totalUnits);
      subOf(unitsEl, 'HUD database');
    }

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

  // F126 — kick the affordable-housing properties.json fetch on first
  // load and cache the resolved array for synchronous use inside
  // updateLihtcInfoPanel. Returns immediately (panel re-renders when
  // ready). Shared with the map layer — no double fetch.
  let _affordablePropsSync = null;
  if (typeof window !== 'undefined' && window.AffordableHousingLayer && window.AffordableHousingLayer.loadProperties) {
    window.AffordableHousingLayer.loadProperties().then(props => {
      _affordablePropsSync = Array.isArray(props) ? props : [];
      // Force a panel refresh now that data is here
      try { updateLihtcInfoPanel(); } catch (_) {}
    }).catch(() => { _affordablePropsSync = []; });
  }

  // Best-effort: turn a CHFA credit-type string into a program_type[]
  // array so we can reuse AffordableHousingLayer.categorize() for badge
  // color matching. Mirrors derivePrograms() in scripts/build-affordable-
  // housing-properties.js but client-side.
  function deriveProgramsFromCredit(credit) {
    const t = (credit || '').toUpperCase();
    const out = [];
    if (t.includes('MIHTC') && !t.includes('%'))        out.push('lihtc-mihtc');
    if (t.includes('9%') || t.includes('9 %'))          out.push('lihtc-9pct');
    if (t.includes('4%') || t.includes('4 %'))          out.push('lihtc-4pct');
    if (t.includes('TAX EXEMPT'))                       out.push('lihtc-4pct');
    if (t.includes('STATE'))                            out.push('lihtc-state-paired');
    if (t.includes('TOC'))                              out.push('lihtc-toc-paired');
    if (!out.length) out.push('lihtc-unknown');
    return Array.from(new Set(out));
  }

  /**
   * updateLihtcInfoPanel — refresh the affordable-housing info panel.
   *
   * F126 — lists EVERY affordable property in the current map viewport,
   * not just the CHFA LIHTC records. Pulls from properties.json (shared
   * cache via AffordableHousingLayer) so HUD MF, USDA RD, PBV-local
   * (e.g. Silt Senior Housing), and CHFA preservation records all
   * appear in the same list with color-coded category badges + per-
   * category hover tooltips explaining what each program is.
   *
   * Registered as a 'moveend' listener on the Leaflet map.
   */
  function updateLihtcInfoPanel() {
    const panelEl = S().els && S().els.lihtcInfoPanel;
    if (!panelEl || !S().map) return;

    const bounds = S().map.getBounds();
    const PL  = window.PropertyLookup;
    const AHL = window.AffordableHousingLayer;

    // Current geography context — used for headline jurisdiction name +
    // per-row in/near distance chip (place/cdp only).
    const _cur = (S().state && S().state.current) || {};
    const _curGeoType = _cur.geoType || null;
    const _rawJuris   = _cur.geoLabel || _cur.label || _cur.name || 'this jurisdiction';
    const jurisName   = String(_rawJuris).replace(/\s*\((?:town|city|CDP)\)\s*$/i, '').trim() || 'this jurisdiction';
    // Active centroid is cached on HNAState by renderLihtcMarketArea
    // (HNA controller) after it loads co-place-centroids.json.
    const _activeC = (window.HNAState && window.HNAState._lihtcActiveCentroid) || null;
    const _centroidOk = _activeC && _activeC.geoid === _cur.geoid && Number.isFinite(_activeC.lat) && Number.isFinite(_activeC.lng);
    const _showRowChip = (_curGeoType === 'place' || _curGeoType === 'cdp') && _centroidOk;
    function _milesBetween(lat1, lon1, lat2, lon2) {
      const R = 3958.8;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    }
    // Per-row "in <Juris>" / "near X.Y mi" chip. Inside ~1 mi reads as
    // "in <Juris>" (var(--good)); 1–15 mi reads as "near X.Y mi"
    // (var(--muted)). Beyond 15 mi or county geoType: no chip.
    function _proximityChip(lat, lng) {
      if (!_showRowChip || !Number.isFinite(lat) || !Number.isFinite(lng)) return '';
      const d = _milesBetween(_activeC.lat, _activeC.lng, lat, lng);
      if (!Number.isFinite(d) || d > 15) return '';
      const baseStyle = 'display:inline-block;padding:1px 6px;border-radius:9999px;font-size:.65rem;font-weight:600;margin-left:4px;';
      if (d < 1) {
        return '<span style="' + baseStyle + 'background:var(--good,#107c3f)20;color:var(--good,#107c3f);border:1px solid var(--good,#107c3f)40">in ' + escHtml(jurisName) + '</span>';
      }
      return '<span style="' + baseStyle + 'background:transparent;color:var(--muted)">near ' + d.toFixed(1) + ' mi</span>';
    }

    // ── CHFA LIHTC records (from CHFA ArcGIS, already loaded by HNA) ──
    const allLihtcFeatures = S().allLihtcFeatures || [];
    const chfaInView = allLihtcFeatures.filter(f => {
      const coords = f.geometry && f.geometry.coordinates;
      if (!coords) return false;
      const [lng, lat] = coords;
      return bounds.contains([lat, lng]);
    });

    // ── Non-LIHTC records from properties.json (HUD MF / USDA RD /
    //    PBV-local / CHFA preservation). Skip the CHFA LIHTC duplicates
    //    since those are rendered via the CHFA list above. ──
    const otherProps = Array.isArray(_affordablePropsSync) ? _affordablePropsSync : [];
    const otherInView = otherProps.filter(p => {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
      if (!bounds.contains([p.lat, p.lng])) return false;
      const isLihtcRecord = (p.program_type || []).some(t => typeof t === 'string' && t.startsWith('lihtc-'));
      return !isLihtcRecord; // CHFA LIHTC already covered
    });

    if (chfaInView.length === 0 && otherInView.length === 0) {
      panelEl.innerHTML = '<p class="lihtc-empty">No affordable properties visible in current map area.</p>';
      return;
    }

    // Build a color-coded category badge with a hover tooltip that
    // explains the program (reuses the legend descriptions). The native
    // title= + aria-label keep it accessible to screen readers and
    // assistive tech.
    function categoryBadge(cat) {
      if (!cat) return '';
      const desc  = escHtml(cat.desc || '');
      const descAttr = (cat.desc || '').replace(/"/g, '&quot;');
      const label = escHtml(cat.label);
      // Keep `title=` as the accessibility + no-JS fallback. The custom
      // .hna-cat-tt child renders the rich wrapped tooltip via the shared
      // floating-tooltip CSS+JS in property-lookup-links.js so it escapes
      // the overflow:auto info panel and wraps text properly.
      // F131 — was `color: cat.color` which painted the badge text with the
      // light-mode category hex (#64748b, #dc2626, etc.). On dark navy bg
      // those score ~3:1 contrast — runtime scanner found 622 instances of
      // this single pattern across the HNA dashboard. Now the badge uses
      // `var(--text-strong)` for the text (theme-aware, high contrast in
      // both modes) and reserves `cat.color` for the colored dot swatch +
      // the tinted background — both of which remain visually category-coded.
      return '<span class="hna-cat-badge" tabindex="0" title="' + descAttr + '"' +
             ' aria-label="' + label + ': ' + descAttr + '"' +
             ' style="position:relative;display:inline-flex;align-items:center;gap:4px;' +
             'font-size:10.5px;padding:1px 7px;border-radius:10px;cursor:help;' +
             'background:' + cat.color + '20;color:var(--text-strong);' +
             'border:1px solid ' + cat.color + '60;font-weight:600;white-space:nowrap">' +
               '<span style="width:6px;height:6px;border-radius:50%;background:' + cat.color + '" aria-hidden="true"></span>' +
               label +
               '<span class="hna-cat-tt" role="tooltip">' +
                 '<strong style="display:block;margin-bottom:.2rem">' + label + '</strong>' + desc +
               '</span>' +
             '</span>';
    }

    // ── CHFA LIHTC rows (from ArcGIS feature.properties) ──
    const chfaRows = chfaInView.map(f => {
      const p = f.properties || {};
      const name  = escHtml(p.PROJECT || p.project || 'Unnamed Project');
      const units = escHtml(p.LI_UNITS || p.li_units || p.LOW_INCOME_UNITS || '—');
      const yr    = escHtml(p.YR_PIS   || p.yr_pis   || '—');
      const credit = p.CREDIT || p.TypeOfCredits || p.type_of_credits || '';
      const creditHtml = (PL && credit)
        ? '<span style="opacity:.7;font-size:.78rem;margin-left:.4rem">· ' + PL.creditTypeTagHtml(credit) + '</span>'
        : '';
      const cat = AHL && AHL.categorize
        ? AHL.categorize({ program_type: deriveProgramsFromCredit(credit) })
        : null;
      const badge = categoryBadge(cat);
      const lookupBar = PL ? PL.htmlFor(p, { compact: true, hideLabel: true }) : '';
      // CHFA features carry [lng, lat] in geometry.coordinates
      const coords = f.geometry && f.geometry.coordinates;
      const chip = (coords && coords.length >= 2) ? _proximityChip(coords[1], coords[0]) : '';
      return '<li class="lihtc-item" style="margin-bottom:.55rem">' +
               '<div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:6px">' +
                 badge +
                 '<strong>' + name + '</strong>' +
                 chip +
                 '<span style="opacity:.75">· ' + units + ' LI units · ' + yr + '</span>' +
                 creditHtml +
               '</div>' +
               lookupBar +
             '</li>';
    });

    // ── Non-LIHTC rows (HUD MF / USDA RD / PBV-local / Preservation) ──
    const otherRows = otherInView.map(p => {
      const cat = AHL && AHL.categorize ? AHL.categorize(p) : null;
      const name = escHtml(p.property_name || 'Unnamed property');
      const units = p.total_units || p.assisted_units || 0;
      // Per-program key fact: PBV sunset, USDA expiration urgency,
      // HUD subsidy type, city fallback.
      let factParts = [];
      if (units) factParts.push(units + ' units');
      if (p.pbv_contract_sunset) {
        factParts.push('PBV sunsets ' + escHtml(p.pbv_contract_sunset));
      } else if (Number.isFinite(p.years_to_expiration)) {
        factParts.push(p.years_to_expiration <= 5
          ? '⚠ expires in ' + p.years_to_expiration + 'y'
          : p.years_to_expiration + 'y to expiration');
      } else if (p.subsidy_type && p.subsidy_type !== 'unknown') {
        factParts.push(escHtml(p.subsidy_type));
      } else if (p.city) {
        factParts.push(escHtml(p.city));
      }
      const fact = factParts.join(' · ');
      const badge = categoryBadge(cat);
      const lookupBar = PL ? PL.htmlFor(p, { compact: true, hideLabel: true }) : '';
      // Non-LIHTC rows carry lat/lng directly on the property record.
      const chip = _proximityChip(p.lat, p.lng);
      return '<li class="lihtc-item" style="margin-bottom:.55rem">' +
               '<div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:6px">' +
                 badge +
                 '<strong>' + name + '</strong>' +
                 chip +
                 (fact ? '<span style="opacity:.75">· ' + fact + '</span>' : '') +
               '</div>' +
               (p.pha_administered_by
                 ? '<div style="font-size:11px;opacity:.7;margin-top:1px">Administered by ' + escHtml(p.pha_administered_by) + '</div>'
                 : '') +
               lookupBar +
             '</li>';
    });

    const totalInView = chfaRows.length + otherRows.length;
    // F134 — methodology footer: explicit source provenance + confidence
    // so an underwriter doesn't have to dig through docs to verify
    // where the property list came from.
    const mfHtml = (window.MethodFooter ? window.MethodFooter.html({
      sources: [
        { label: 'CHFA HousingTaxCreditProperties (live ArcGIS)', url: 'https://co.chfainfo.com/find-a-tax-credit-property' },
        { label: 'CHFA Preservation (live ArcGIS)',               url: 'https://co.chfainfo.com/' },
        { label: 'HUD MULTIFAMILY_PROPERTIES_ASSISTED',           url: 'https://hudgis-hud.opendata.arcgis.com/datasets/HUD::multifamily-properties-assisted/' },
        { label: 'USDA Rural Housing Assets',                     url: 'https://www.rd.usda.gov/programs-services/multifamily-housing-programs/' },
        { label: 'Local PHA roster (curated)',                    url: 'https://github.com/pggLLC/Housing-Analytics/tree/main/data/affordable-housing/local-pha-roster' }
      ],
      vintage:    'live CHFA + HUD; curated local-PHA roster vintage 2026-06',
      method:     'Union of 5 feeds, deduped by (lowercased name, city). Map markers grouped by color-coded program category. Records scoped to current map viewport.',
      confidence: 'high'
    }) : '');
    // Two-line headline scoped to the planning/stewardship use case.
    // Bold scope statement + subline counts the visible properties and
    // names the union of programs. Tooltip on the headline distinguishes
    // this panel from the LIHTC-only comparables strip below.
    const _infoTooltip = 'For planning and stewardship. Includes every affordable property in the visible map area across LIHTC, HUD MF, USDA RD, USDA preservation, and local PHA programs.';
    const _tooltipAttr = _infoTooltip.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const headline =
      `<p class="lihtc-source" style="margin:0 0 .35rem 0">` +
        `<strong title="${_tooltipAttr}" style="cursor:help">Affordable housing in and around ${escHtml(jurisName)}</strong>` +
        `<span style="display:block;font-size:.74rem;color:var(--muted);font-weight:400;margin-top:1px">` +
          `${totalInView} propert${totalInView === 1 ? 'y' : 'ies'} visible on the map, all subsidy programs, hover badge for definition` +
        `</span>` +
      `</p>`;
    panelEl.innerHTML =
      headline +
      `<ul class="lihtc-list" style="list-style:none;padding-left:0">${chfaRows.concat(otherRows).join('')}</ul>` +
      mfHtml;
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
  function renderDdaLayer(countyFips5, data, placeCtx) {
    if (!window.L || !S().map) return;
    if (S().ddaLayer) { S().ddaLayer.remove(); S().ddaLayer = null; }

    const statusEl = S().els && S().els.statDdaStatus;
    const noteEl   = S().els && S().els.statDdaNote;

    const isDda = data && Array.isArray(data.features) && data.features.length > 0;
    const props = isDda ? (data.features[0].properties || {}) : {};
    // HUD designates DDAs two ways: NON-METRO (whole county) and METRO Small
    // Area DDAs (by ZIP/ZCTA). A non-metro county DDA covers every place in
    // the county; a metro SDDA is ZIP-specific. Word the note accordingly so a
    // place isn't told "this county qualifies" without explaining why it applies.
    const typeRaw  = String(props.DDA_TYPE || props.DDATYPE || props.DDA_CODE || '').toUpperCase();
    const nonMetro = /\bNM\b|NON.?METRO|NCNTY/.test(typeRaw);
    let countyLabel = props.NAME || props.DDA_NAME || '';
    if (countyLabel && !/county$/i.test(countyLabel)) countyLabel += ' County';
    if (!countyLabel) countyLabel = 'This county';
    const isPlace    = placeCtx && (placeCtx.type === 'place' || placeCtx.type === 'cdp') && placeCtx.name;
    const placeLabel = isPlace ? String(placeCtx.name).replace(/\s*\((?:town|city|CDP)\)\s*$/i, '').trim() : null;

    if (statusEl) statusEl.textContent = isDda ? 'DDA' : 'Non-DDA';
    if (noteEl) {
      if (isDda && nonMetro) {
        noteEl.textContent = countyLabel + ' is a HUD Non-Metropolitan DDA — designated county-wide, so '
          + (placeLabel || 'every community in it') + ' qualifies for the 30% basis boost.';
      } else if (isDda) {
        noteEl.textContent = (placeLabel ? placeLabel + ' is in ' : 'Part of ' + countyLabel + ' is in ')
          + 'a HUD Small Area DDA (designated by ZIP code) — confirm the project ZIP on HUD’s DDA map; eligible ZIPs get the 30% basis boost.';
      } else {
        noteEl.textContent = (placeLabel || countyLabel) + ' is not in a HUD Difficult Development Area.';
      }
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
    let r = lrData[key] || lrData[geoid] || null;

    // Places/CDPs without their own entry fall back to the containing county's
    // resources (mirrors the Opportunity Finder) rather than showing "none".
    let fromCounty = false;
    if (!r && (geoType === 'place' || geoType === 'cdp')) {
      const cc = S().state && S().state.current && S().state.current.contextCounty;
      if (cc) { r = lrData['county:' + cc] || lrData[cc] || null; if (r) fromCounty = true; }
    }

    if (!r) {
      container.innerHTML = '<p class="lr-empty">No local resources on file for this geography.</p>';
      return;
    }

    let html = '';
    if (fromCounty) {
      html += '<p class="lr-fallback" style="margin:0 0 8px;padding:.5rem .7rem;border:1px solid var(--border);border-radius:6px;background:var(--bg2);font-size:.78rem;color:var(--muted)">Showing <strong>county-level</strong> resources — no entry specific to this municipality yet.</p>';
    }

    // Housing lead (the department/authority that owns housing for this geography)
    if (r.housingLead && r.housingLead.name) {
      const lu = r.housingLead.url && safeUrl(r.housingLead.url) !== '#' ? r.housingLead.url : null;
      const nm = lu ? `<a href="${escHtml(lu)}" target="_blank" rel="noopener noreferrer">${escHtml(r.housingLead.name)}</a>` : escHtml(r.housingLead.name);
      html += `<section class="lr-section"><h4>Housing lead</h4><p class="lr-item">${nm}</p></section>`;
    }

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

    // Advocacy / nonprofits section
    if (r.advocacy && Array.isArray(r.advocacy) && r.advocacy.length > 0) {
      html += '<section class="lr-section"><h4>Advocacy &amp; nonprofits</h4><ul class="lr-list">';
      for (const a of r.advocacy) {
        const validUrl = a.url && safeUrl(a.url) !== '#' ? a.url : null;
        const href = validUrl ? ` href="${escHtml(validUrl)}" target="_blank" rel="noopener noreferrer"` : '';
        const tag  = validUrl ? 'a' : 'span';
        html += `<li class="lr-item"><${tag}${href} class="lr-advocacy-name">${escHtml(a.name)}</${tag}></li>`;
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

    // F95 — Housing on the agenda + local boards & advocates.
    //
    // These two sections appear for EVERY jurisdiction (curated or not),
    // because they're built from durable site-scoped Google searches +
    // any direct URLs the curated record has. Matches the F35 pattern:
    // search > deep link, because deep-linked agenda PDFs rot fast.
    //
    // The jurisdiction display name comes from the geo-config-derived
    // label set on S().state.current.geoLabel (HNA controller sets this
    // when a geography is selected); fall back to the lr-record name.
    const jurisName = (S().state && S().state.current && S().state.current.geoLabel)
      || (r.housingLead && r.housingLead.name && r.housingLead.name.replace(/\b(Housing|Authority|Division|Department|City of|Town of|County)\b/g, '').trim())
      || null;
    const govDomain = _deriveGovDomain(r);
    html += _renderAgendaSearchSection(jurisName, govDomain, r);
    // F162 — Targeted Google searches for actual agenda PDFs + minutes.
    // Built via window.AgendaSearchLinks (js/components/agenda-search-links.js).
    // Distinct from the existing generic-Google section above: this one is
    // tightly quoted, OR-grouped, time-bounded, and filetype-filtered, so
    // results land on actual planning/council records, not random press.
    html += _renderTargetedAgendaSearchSection(jurisName, geoType);
    html += _renderBoardsAndAdvocatesSection(jurisName, govDomain, r);
    // F131 — churches, school district, library, rec centers — all local
    // institutions that often own developable land + serve as convening
    // venues for housing conversations.
    html += _renderCommunityInstitutionsSection(jurisName, r);
    // F133 — Major employers + their workforce-housing programs. Its
    // own section because (a) places can have 5+ headline employers
    // and a single search link doesn't convey that, and (b) the
    // workforce-housing angle is the most actionable signal for a
    // developer scoping an AMI mix.
    html += _renderMajorEmployersSection(jurisName, r);

    // F183 — Three reference panels (Capital partners, CHFA QAP cycle,
    // CHFA award history) wrapped in <details> so they default-collapsed.
    // Users scrolling for jurisdiction-specific signals don't want a 200-row
    // capital-partners list expanded by default; opening on click is enough.

    // F138 — Capital partners (lenders, equity syndicators, soft debt).
    // Renders a stub container; CapitalPartners.attach hydrates it
    // async after the HTML lands in the DOM. We don't filter by deal
    // type here — HNA users are scoping ALL options, not one type.
    html += '<details class="lr-section lr-section--collapsible">' +
              '<summary class="lr-section__summary"><h4>Capital partners &amp; lenders</h4>' +
                '<span class="lr-section__hint">Click to expand · statewide directory</span>' +
              '</summary>' +
              '<div id="lr-capital-partners-mount"></div>' +
            '</details>';

    // F141 — Tax abatement / PILOT / fee-waiver inventory
    html += '<section class="lr-section"><h4>Tax abatement, PILOT &amp; fee programs</h4>' +
            '<div id="lr-tax-abatement-mount"></div></section>';

    // F143 — CHFA QAP cycle calendar + upcoming deadlines (collapsible)
    html += '<details class="lr-section lr-section--collapsible">' +
              '<summary class="lr-section__summary"><h4>CHFA QAP cycle &amp; upcoming deadlines</h4>' +
                '<span class="lr-section__hint">Click to expand · 2026 R1/R2 + 2027 R1</span>' +
              '</summary>' +
              '<div id="lr-qap-calendar-mount"></div>' +
            '</details>';

    // F145 — Resort workforce-housing programs (APCHA, Vail InDEED,
    // SCHA, YVHA, etc.). Section stays hidden for non-resort
    // jurisdictions — renderer reveals it when there's a match.
    html += '<section class="lr-section" id="lr-resort-wfh-section" hidden><h4>Resort housing authority &amp; workforce-housing programs</h4>' +
            '<div id="lr-resort-wfh-mount"></div></section>';

    // F151 — CHFA LIHTC award history (per-jurisdiction timeline, collapsible)
    html += '<details class="lr-section lr-section--collapsible">' +
              '<summary class="lr-section__summary"><h4>CHFA LIHTC award history</h4>' +
                '<span class="lr-section__hint">Click to expand · year-by-year award timeline</span>' +
              '</summary>' +
              '<div id="lr-chfa-award-history-mount"></div>' +
            '</details>';

    // F134 — methodology footer covering the entire local-resources panel
    if (window.MethodFooter) {
      html += window.MethodFooter.html({
        sources: [
          { label: 'data/hna/local-resources.json (curated)', url: 'https://github.com/pggLLC/Housing-Analytics/blob/main/data/hna/local-resources.json' },
          { label: 'CHFA + DOLA Prop 123 status',             url: 'https://cdola.colorado.gov/proposition-123' },
          { label: 'Per-jurisdiction durable Google searches', url: '#' }
        ],
        vintage:    'curated entries verified Feb-Jun 2026; search blocks live',
        method:     'Curated housing leads, plans, advocacy, school district, hospital, employers cross-referenced to publicly-stated service areas. Validated by scripts/validate-advocacy-roster.js. Search fallbacks scoped to "[jurisdiction] Colorado" to disambiguate same-named places in other states.',
        confidence: 'med'
      });
    }

    container.innerHTML = html || '<p class="lr-empty">No housing plans or contacts on file.</p>';

    // F138 — hydrate the Capital partners mount async after HTML lands
    if (window.CapitalPartners) {
      const mount = document.getElementById('lr-capital-partners-mount');
      if (mount) {
        window.CapitalPartners.attach(mount, {
          jurisName: jurisName || undefined
        });
      }
    }

    // F141 — hydrate Tax abatement / PILOT / fee mount.
    if (window.TaxAbatement) {
      const taMount = document.getElementById('lr-tax-abatement-mount');
      // Resolve current geoKey from HNA state (S().current carries the
      // selected geography). Use the most specific key available.
      let geoKey = null;
      try {
        const cur = S().state && S().state.current;
        if (cur && cur.geoid) {
          geoKey = (cur.geoType === 'county' ? 'county:' : 'place:') + cur.geoid;
        }
      } catch (_) {}
      if (taMount) {
        window.TaxAbatement.attach(taMount, {
          geoKey:    geoKey,
          jurisName: jurisName || undefined
        });
      }
    }

    // F143 — hydrate the QAP calendar mount async.
    if (window.QapCalendar) {
      const qcMount = document.getElementById('lr-qap-calendar-mount');
      if (qcMount) window.QapCalendar.attach(qcMount, { compact: false, showRolling: true });
    }

    // F145 — Resort housing authority. Resolve placeGeoid + countyFips
    // from current selection; ResortWfh renders nothing (and we keep
    // the section hidden) if no authority covers this jurisdiction.
    if (window.ResortWfh) {
      const rwSection = document.getElementById('lr-resort-wfh-section');
      const rwMount   = document.getElementById('lr-resort-wfh-mount');
      let placeGeoid = null, countyFips = null;
      try {
        const cur = S().state && S().state.current;
        if (cur && cur.geoid) {
          if (cur.geoType === 'county') {
            countyFips = String(cur.geoid).slice(-3);
          } else {
            placeGeoid = cur.geoid;
            // Derive county FIPS from place's containing county. HNAState
            // populates this as `contextCounty`; older code paths used
            // `containingCounty`. Accept either to avoid silent "no data"
            // states for places (recurring place-vs-county masking bug).
            const cc = cur.contextCounty || cur.containingCounty;
            if (cc) countyFips = String(cc).slice(-3);
          }
        }
      } catch (_) {}
      if (rwMount) {
        // Hydrate, then reveal section IF the renderer actually produced HTML
        window.ResortWfh.attach(rwMount, {
          placeGeoid: placeGeoid,
          countyFips: countyFips,
          jurisName:  jurisName
        });
        // Reveal after a microtask so the renderer has injected content
        setTimeout(function () {
          if (rwSection && rwMount.innerHTML.trim().length > 0) {
            rwSection.hidden = false;
          }
        }, 50);
      }
    }

    // F159 — hydrate the MHI vs HUD AMI clarifier. Two distinct income
    // concepts; surfacing both side-by-side prevents the most common
    // housing-data confusion (using HUD AMI when local MHI is wanted
    // or vice versa).
    if (window.MhiAmiClarifier) {
      const maaMount = document.getElementById('hnaMhiAmiMount');
      if (maaMount) {
        const cur = (S().state && S().state.current) || {};
        const isPlace = cur.geoType === 'place';
        let maaPlaceGeoid = null, maaCountyFips = null, maaPlaceName = null, maaCountyName = null;
        let maaMhi = null;
        if (isPlace) {
          maaPlaceGeoid = cur.geoid;
          maaPlaceName  = jurisName;
          const cc = cur.contextCounty || cur.containingCounty;
          if (cc) maaCountyFips = String(cc).slice(-3);
        } else if (cur.geoType === 'county') {
          maaCountyFips = String(cur.geoid).slice(-3);
          maaCountyName = jurisName;
        }
        try {
          const p = cur.profile || {};
          if (p.DP03_0062E) maaMhi = p.DP03_0062E;
        } catch (_) {}
        window.MhiAmiClarifier.attach(maaMount, {
          placeGeoid: maaPlaceGeoid,
          placeName:  maaPlaceName,
          countyFips: maaCountyFips,
          countyName: maaCountyName,
          placeMhi:   maaMhi
        });
      }
    }

    // F158 — hydrate the rent triangulation mount (HUD FMR vs ACS median
    // vs Zillow ZORI). One concise three-row card so the gap between
    // existing-tenant rent and new-lease asking rent is legible at a
    // glance.
    if (window.RentTriangulation) {
      const rtMount = document.getElementById('rentTriangulationMount');
      if (rtMount) {
        const cur = (S().state && S().state.current) || {};
        const isPlace = cur.geoType === 'place';
        let rtPlaceGeoid = null, rtCountyFips = null, rtPlaceName = null, rtCountyName = null;
        if (isPlace) {
          rtPlaceGeoid = cur.geoid;
          rtPlaceName  = jurisName;
          const cc = cur.contextCounty || cur.containingCounty;
          if (cc) rtCountyFips = String(cc).slice(-3);
        } else if (cur.geoType === 'county') {
          rtCountyFips = String(cur.geoid).slice(-3);
          rtCountyName = jurisName;
        }
        window.RentTriangulation.attach(rtMount, {
          placeGeoid: rtPlaceGeoid,
          placeName:  rtPlaceName,
          countyFips: rtCountyFips,
          countyName: rtCountyName
        });
      }
    }

    // F151 — hydrate the CHFA award history mount
    if (window.ChfaAwardHistory) {
      const cahMount = document.getElementById('lr-chfa-award-history-mount');
      let placeGeoid2 = null, countyFips2 = null, cityName2 = null;
      try {
        const cur = S().state && S().state.current;
        if (cur && cur.geoid) {
          if (cur.geoType === 'county') {
            countyFips2 = String(cur.geoid).slice(-3);
          } else {
            placeGeoid2 = cur.geoid;
            // State field is `contextCounty` (HNAState), historically also
            // `containingCounty` — accept either so we don't silently fall
            // back to "no awards" when only one is populated.
            const cc = cur.contextCounty || cur.containingCounty;
            if (cc) countyFips2 = String(cc).slice(-3);
          }
        }
        cityName2 = jurisName;
      } catch (_) {}
      if (cahMount) {
        window.ChfaAwardHistory.attach(cahMount, {
          placeGeoid: placeGeoid2,
          countyFips: countyFips2,
          cityName:   cityName2
        });
      }
    }
  }

  /**
   * F133 — "Major employers & workforce-housing partners" section.
   *
   * For each curated place we keep an array of headline employers
   * (5-8 typical), each with optional notes about their workforce-
   * housing program if they run one (Vail Resorts dorms, Aspen
   * Skiing Co housing, Aspen Valley Hospital staff units, etc.).
   * Each entry links directly to the employer's careers / housing
   * page; an "All top employers" search link is always appended.
   *
   * For uncurated places, falls back to a single Google search
   * "largest employers in [jurisdiction], Colorado" — same durable-
   * search pattern used everywhere else in this panel.
   *
   * Why this section exists separately from Community Institutions:
   *   1. Top employers determine the AMI mix you should be designing
   *      for (resort towns concentrate around 60-100% AMI service
   *      jobs; tech corridors stretch to 120%+).
   *   2. Many large employers have published workforce-housing
   *      programs that a developer can plug into — sometimes via
   *      master-lease, sometimes via direct-build partnership.
   *   3. Several major Colorado employers own surplus / developable
   *      land near their facilities.
   */
  function _renderMajorEmployersSection(jurisName, r) {
    if (!jurisName) return '';
    // F165: route every generic Google call through SearchLinks for
    // housing-targeted queries. Per-employer name searches still use
    // a quoted-phrase Google query (no housing context — employer
    // name is the discriminator).
    const SL = (typeof window !== 'undefined' && window.SearchLinks) ? window.SearchLinks : null;
    const G = 'https://www.google.com/search?q=';
    const enc = encodeURIComponent;
    const employers = Array.isArray(r && r.majorEmployers) ? r.majorEmployers : [];
    const largestUrl = SL
      ? SL.build({ jurisdictionName: jurisName, context: 'largest-employers' }).url
      : (G + enc('"largest employers" "' + jurisName + '" Colorado'));
    const workforceUrl = SL
      ? SL.build({ jurisdictionName: jurisName, context: 'workforce-employers' }).url
      : (G + enc('"' + jurisName + '" Colorado workforce housing employer'));

    let out = '<section class="lr-section"><h4>Major employers &amp; workforce-housing partners</h4>' +
      '<p style="font-size:.82rem;color:var(--muted);margin:.25rem 0 .6rem">' +
      'Headline employers shape the AMI mix you should design for, and several run workforce-housing programs ' +
      'a developer can plug into (master-lease, direct-build partnership, surplus land contributions). ' +
      'Resort employers in particular — Vail Resorts, Aspen Skiing Co, hospital systems — have published housing programs.</p>';

    if (employers.length) {
      out += '<ul class="lr-list">';
      employers.forEach(e => {
        // Per-employer fallback is still a name-quoted Google query —
        // employer name is the discriminator, not housing context.
        const href = e.url ? escHtml(e.url) : (G + enc('"' + e.name + '" Colorado'));
        out += '<li class="lr-item" style="margin-bottom:.4rem">' +
                 '<a href="' + href + '" target="_blank" rel="noopener noreferrer" class="lr-advocacy-name">' +
                   '<span aria-hidden="true" style="margin-right:.35rem">🏢</span>' +
                   escHtml(e.name) +
                 '</a>' +
                 (e.note ? '<div style="font-size:.78rem;color:var(--muted);margin-top:.1rem;padding-left:1.4rem">' +
                            escHtml(e.note) +
                           '</div>' : '') +
                 (e.workforce_housing_url ? '<div style="font-size:.78rem;margin-top:.1rem;padding-left:1.4rem">' +
                            '<a href="' + escHtml(e.workforce_housing_url) + '" target="_blank" rel="noopener noreferrer" ' +
                            'style="font-weight:600">↳ Workforce-housing program</a></div>' : '') +
                 '</li>';
      });
      out += '</ul>';
      // Always append a search link so a developer can dig past the
      // curated headline list.
      out += '<p style="font-size:.82rem;margin:.5rem 0 0">' +
             '<a href="' + escHtml(largestUrl) +
             '" target="_blank" rel="noopener noreferrer">' +
             '🔎 Search: "largest employers in ' + escHtml(jurisName) + ', Colorado"</a></p>';
    } else {
      // No curated data — single durable search.
      out += '<ul class="lr-list">' +
             '<li class="lr-item" style="margin-bottom:.4rem">' +
               '<a href="' + escHtml(largestUrl) +
               '" target="_blank" rel="noopener noreferrer" class="lr-advocacy-name">' +
                 '<span aria-hidden="true" style="margin-right:.35rem">🏢</span>' +
                 'Top employers in ' + escHtml(jurisName) +
               '</a>' +
               '<div style="font-size:.78rem;color:var(--muted);margin-top:.1rem;padding-left:1.4rem">' +
                 'Web search — top employers shape AMI mix + may run workforce-housing programs' +
               '</div>' +
             '</li>' +
             '<li class="lr-item" style="margin-bottom:.4rem">' +
               '<a href="' + escHtml(workforceUrl) +
               '" target="_blank" rel="noopener noreferrer" class="lr-advocacy-name">' +
                 '<span aria-hidden="true" style="margin-right:.35rem">🏠</span>' +
                 'Workforce-housing employer partnerships near ' + escHtml(jurisName) +
               '</a>' +
               '<div style="font-size:.78rem;color:var(--muted);margin-top:.1rem;padding-left:1.4rem">' +
                 'Surfaces published programs (master-lease, direct-build, surplus land partnerships)' +
               '</div>' +
             '</li>' +
             '</ul>';
    }
    out += '</section>';
    return out;
  }

  /**
   * F131 — "Community institutions & faith-based partners" section.
   * Renders durable Google Maps + Google searches for the four most
   * frequently-useful local institutions in any Colorado town:
   *
   *   - Churches in town. Faith-based partners often own developable
   *     parcels (parking lots, surplus lots, old rectories) and are
   *     active in housing ministries. Google Maps "Churches near X"
   *     is the most reliable way to surface them — denominations are
   *     so varied that no curated list scales.
   *
   *   - School district serving the town. Districts increasingly run
   *     workforce-housing programs for teachers (Eagle County, Aspen,
   *     Summit, Telluride have famous ones); also a major employer
   *     informing AMI mix decisions.
   *
   *   - Public library + community / rec centers. The buildings
   *     themselves are where housing town-halls happen and where
   *     organizers post flyers; the institutions sometimes co-fund
   *     affordable-housing programs.
   *
   * Curated school-district data for known places (Roaring Fork + a
   * few others) renders as a direct link; everywhere else falls back
   * to a "find your district" search. All other links are searches —
   * curated content here would rot fast.
   */
  function _renderCommunityInstitutionsSection(jurisName, r) {
    if (!jurisName) return '';
    // F165: route generic Google calls through SearchLinks for
    // targeted phrasing. Maps "near X" searches stay as Maps URLs.
    const SL = (typeof window !== 'undefined' && window.SearchLinks) ? window.SearchLinks : null;
    const G = 'https://www.google.com/search?q=';
    const M = 'https://www.google.com/maps/search/?api=1&query=';
    const enc = encodeURIComponent;
    const items = [];

    // ── School district ──
    if (r && r.schoolDistrict && r.schoolDistrict.name) {
      const sd = r.schoolDistrict;
      // Named entity (the district itself) — keep quoted-name search.
      items.push({
        icon:  '🎓',
        label: 'School district',
        sub:   sd.name,
        href:  sd.url || (G + enc('"' + sd.name + '" Colorado'))
      });
    } else {
      const sdUrl = SL ? SL.build({ jurisdictionName: jurisName, context: 'school-district' }).url
                       : (G + enc('"' + jurisName + '" Colorado school district'));
      items.push({
        icon:  '🎓',
        label: 'Find the school district serving ' + jurisName,
        sub:   'Districts increasingly run workforce-housing programs for teachers',
        href:  sdUrl
      });
    }

    // ── Churches in town ── (Google Maps "near" search is the most
    // reliable; trying to enumerate denominations would rot fast)
    items.push({
      icon:  '⛪',
      label: 'Churches in ' + jurisName,
      sub:   'Faith-based partners often own developable land + run housing ministries',
      href:  M + enc('churches near ' + jurisName + ', Colorado')
    });

    // ── Hospitals + health systems ── (often the largest local employer;
    // many run workforce-housing programs — Vail Health, Aspen Valley
    // Hospital, Valley View, St. Anthony Summit are all known examples)
    if (r && r.hospital && r.hospital.name) {
      const h = r.hospital;
      items.push({
        icon:  '🏥',
        label: 'Hospital: ' + h.name,
        sub:   'Often the largest local employer; many run workforce-housing programs',
        href:  h.url || (G + enc('"' + h.name + '" Colorado'))
      });
    } else {
      items.push({
        icon:  '🏥',
        label: 'Hospitals near ' + jurisName,
        sub:   'Often the largest local employer; many run workforce-housing programs (Vail Health, Aspen Valley, Valley View, St. Anthony Summit)',
        href:  M + enc('hospitals near ' + jurisName + ', Colorado')
      });
    }

    // ── Public library ── (convening venue + housing-info posting)
    const libUrl = SL ? SL.build({ jurisdictionName: jurisName, context: 'public-library' }).url
                      : (G + enc('"' + jurisName + '" Colorado public library'));
    items.push({
      icon:  '📚',
      label: jurisName + ' public library',
      sub:   'Where town-halls happen + housing flyers get posted',
      href:  libUrl
    });

    // ── Community / rec center ──
    const ccUrl = SL ? SL.build({ jurisdictionName: jurisName, context: 'community-center' }).url
                     : (G + enc('"' + jurisName + '" Colorado community center OR rec center'));
    items.push({
      icon:  '🏛️',
      label: 'Community / rec center',
      sub:   'Convening venue for housing conversations',
      href:  ccUrl
    });

    let out = '<section class="lr-section"><h4>Community institutions &amp; faith-based partners</h4>' +
      '<p style="font-size:.82rem;color:var(--muted);margin:.25rem 0 .6rem">' +
      'Local schools, hospitals, churches, libraries, and rec centers often own developable land, serve as convening venues, or run workforce-housing programs. ' +
      'Searches scoped to ' + escHtml(jurisName) + ', Colorado.</p>' +
      '<ul class="lr-list">';
    items.forEach(it => {
      out += '<li class="lr-item" style="margin-bottom:.4rem">' +
             '<a href="' + escHtml(it.href) + '" target="_blank" rel="noopener noreferrer" class="lr-advocacy-name">' +
               '<span aria-hidden="true" style="margin-right:.35rem">' + it.icon + '</span>' +
               escHtml(it.label) +
             '</a>' +
             (it.sub ? '<div style="font-size:.78rem;color:var(--muted);margin-top:.1rem;padding-left:1.4rem">' +
                        escHtml(it.sub) +
                       '</div>' : '') +
             '</li>';
    });
    out += '</ul></section>';
    return out;
  }

  /**
   * F95 — Derive the jurisdiction's official .gov domain from any URL
   * present in the local-resources record. Used to build site-scoped
   * agenda searches. Returns null when no usable URL is found.
   *
   * Returns hostname like "denvergov.org" or "www.bouldercolorado.gov".
   */
  function _deriveGovDomain(r) {
    if (!r) return null;
    const candidates = [];
    if (r.housingLead && r.housingLead.url) candidates.push(r.housingLead.url);
    if (Array.isArray(r.housingPlans)) {
      for (const p of r.housingPlans) {
        if (p && p.url && !/google\.com|huduser\.gov|chfainfo\.com|colorado\.gov|cdola/.test(p.url)) {
          candidates.push(p.url);
        }
      }
    }
    if (Array.isArray(r.housingAuthority)) {
      for (const ha of r.housingAuthority) {
        if (ha && ha.url) candidates.push(ha.url);
      }
    }
    for (const u of candidates) {
      try {
        const host = new URL(u).hostname;
        // Prefer .gov / .co.us / .us city domains over .org authorities
        if (/\.(gov|co\.us|us)(:|$|\/)/.test(host) || /gov\./.test(host)) {
          return host;
        }
      } catch (_) { /* invalid URL — skip */ }
    }
    // Last resort: return the first hostname we found at all
    for (const u of candidates) {
      try { return new URL(u).hostname; } catch (_) { /* skip */ }
    }
    return null;
  }

  /**
   * F95 — "Housing on the agenda" section. Renders durable searches
   * across the jurisdiction's own website (for council/planning-commission
   * agendas + minutes) and across CO housing news (Coloradan, Colorado Sun,
   * Westword) for related coverage. The searches are scoped to the last
   * year by default so users see CURRENT items, not legacy filings.
   *
   * Always rendered, even for jurisdictions without curated entries.
   */
  function _renderAgendaSearchSection(jurisName, govDomain, r) {
    // F165: keep the govDomain-scoped agenda/staff-report queries
    // (they're already site-filtered + time-bound). Route the two
    // jurisdiction-only press queries through SearchLinks so the user
    // gets a multi-press OR-filter with after:YYYY-MM-DD bound rather
    // than just "housing 2026".
    //
    // F167: if the local-resources record has a curated
    // `council_agenda_url` and/or `planning_commission_url`, surface
    // those as the FIRST card(s) — direct links beat Google guessing
    // every time.
    const SL = (typeof window !== 'undefined' && window.SearchLinks) ? window.SearchLinks : null;
    const G = 'https://www.google.com/search?q=';
    const enc = encodeURIComponent;
    const items = [];

    if (govDomain) {
      items.push({
        label: 'Council & planning-commission agendas mentioning housing',
        href: G + enc(`site:${govDomain} (agenda OR "agenda packet" OR minutes) ("affordable housing" OR "workforce housing" OR housing) after:2025`)
      });
      items.push({
        label: 'Housing-specific staff reports & memos',
        href: G + enc(`site:${govDomain} ("staff report" OR "memorandum" OR "memo") housing after:2025`)
      });
    }
    if (jurisName) {
      const newsLink = SL
        ? SL.build({ jurisdictionName: jurisName, context: 'news' })
        : { url: G + enc(`"${jurisName}" Colorado housing 2026`) + '&tbm=nws',
            label: `Recent housing news for "${jurisName}"` };
      items.push({
        label: `Recent housing news for "${jurisName}"`,
        href: newsLink.url
      });
      const pressLink = SL
        ? SL.build({ jurisdictionName: jurisName, context: 'co-press' })
        : { url: G + enc(`"${jurisName}" (site:coloradosun.com OR site:denverite.com OR site:coloradoan.com OR site:westword.com) housing`) };
      items.push({
        label: `"${jurisName}" + Coloradoan / Colorado Sun / Denverite coverage`,
        href: pressLink.url
      });
    }

    // F167: pull curated direct-link URLs from the record. Validate via
    // safeUrl so a bad entry can't escape escaping.
    const directLinks = [];
    if (r && typeof r === 'object') {
      const councilUrl = r.council_agenda_url && safeUrl(r.council_agenda_url) !== '#'
        ? r.council_agenda_url : null;
      const planningUrl = r.planning_commission_url && safeUrl(r.planning_commission_url) !== '#'
        ? r.planning_commission_url : null;
      const labelJuris = jurisName || 'this jurisdiction';
      if (councilUrl) {
        directLinks.push({
          icon:  '\u{1F4CB}', // clipboard
          label: `Open ${labelJuris}'s official council agenda page`,
          href:  councilUrl
        });
      }
      if (planningUrl) {
        directLinks.push({
          icon:  '\u{1F3DB}️', // classical building
          label: `Open ${labelJuris}'s Planning Commission agenda page`,
          href:  planningUrl
        });
      }
    }

    if (items.length === 0 && directLinks.length === 0) {
      return '<section class="lr-section"><h4>Housing on the agenda</h4>' +
        '<p class="lr-item" style="color:var(--muted);font-size:.82rem;">' +
        'No jurisdiction website on file yet — add a Housing Lead URL to populate agenda searches.' +
        '</p></section>';
    }

    // Inline styling so this renders without depending on a CSS update.
    // Green accent + "Direct" badge sets the card visually apart from the
    // bullet-style Google search items below.
    const directCardStyle =
      'display:flex;flex-direction:column;gap:.2rem;padding:.65rem .8rem;' +
      'background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.45);' +
      'border-left:3px solid #16a34a;border-radius:8px;text-decoration:none;' +
      'color:var(--text);transition:background .15s;';
    const badgeStyle =
      'display:inline-block;padding:.05rem .4rem;background:#16a34a;color:#fff;' +
      'border-radius:4px;font-size:.65rem;font-weight:700;letter-spacing:.04em;' +
      'text-transform:uppercase;margin-right:.4rem;vertical-align:middle;';
    const directLabelStyle = 'font-weight:600;font-size:.9rem;line-height:1.3;';
    const directSubStyle   = 'font-size:.74rem;color:var(--muted);font-weight:400;';

    const directHtml = directLinks.length === 0 ? '' :
      '<div style="display:flex;flex-direction:column;gap:.45rem;margin-bottom:.6rem;">' +
      directLinks.map(d =>
        '<a href="' + escHtml(d.href) + '" target="_blank" rel="noopener noreferrer" style="' + directCardStyle + '">' +
          '<span style="' + directLabelStyle + '">' +
            '<span style="' + badgeStyle + '">' + escHtml(d.icon) + ' Direct</span>' +
            escHtml(d.label) + ' &rarr;' +
          '</span>' +
          '<span style="' + directSubStyle + '">Direct link to the town\'s published agenda packet — no Google guessing.</span>' +
        '</a>'
      ).join('') +
      '</div>';

    // Search-list intro adjusts based on whether we already showed a
    // direct link: if we did, frame the searches as supplementary; if
    // not, keep the original "find what's being debated NOW" framing.
    const searchIntro = directLinks.length > 0
      ? `Or search across ${jurisName ? '"' + escHtml(jurisName) + '"' : 'the jurisdiction'}\'s site + Colorado press for housing items.`
      : 'These open Google searches scoped to the jurisdiction\'s own website + Colorado housing press. Use them to find what\'s being debated NOW (zoning amendments, IZ updates, HNA adoption, budget items).';

    const searchHtml = items.length === 0 ? '' :
      '<p class="lr-item" style="color:var(--muted);font-size:.78rem;margin-bottom:.4rem;">' +
      searchIntro + '</p>' +
      '<ul class="lr-list">' +
      items.map(it => '<li class="lr-item">' +
        '<a href="' + escHtml(it.href) + '" target="_blank" rel="noopener noreferrer" class="lr-plan-name" style="font-size:.85rem;">' +
        escHtml(it.label) + ' &rarr;</a></li>').join('') +
      '</ul>';

    return '<section class="lr-section"><h4>Housing on the agenda &mdash; current &amp; past items</h4>' +
      directHtml + searchHtml + '</section>';
  }

  /**
   * F162 — "Search city or county agendas for housing topics" section.
   *
   * Distinct from _renderAgendaSearchSection above (which is the F95
   * generic-Google panel): this calls window.AgendaSearchLinks.build
   * for laser-targeted queries with quoted phrases, OR groups,
   * after:YYYY-MM-DD time bounds, tbs=qdr:m12 / m6 recency filters,
   * filetype:pdf for actual agenda PDFs, and BoCC / County Planning
   * Commission language for county geographies.
   *
   * Rendered as a 2-column grid of pill-style buttons (visually
   * distinct from the bullet-list pattern used by the other sections)
   * so users can spot it as a separate, actionable tool.
   */
  function _renderTargetedAgendaSearchSection(jurisName, geoType) {
    if (!jurisName) return '';
    if (!window.AgendaSearchLinks || typeof window.AgendaSearchLinks.build !== 'function') return '';

    const isCounty = geoType === 'county';
    const links = window.AgendaSearchLinks.build({
      jurisdictionName: jurisName,
      isCounty:         isCounty
    });
    if (!Array.isArray(links) || links.length === 0) return '';

    // Pill grid styled inline so it renders without a CSS dependency.
    // 2 columns on desktop; collapses to 1 on narrow screens via
    // CSS grid auto-fit + minmax.
    const pillStyle =
      'display:flex;flex-direction:column;gap:.15rem;padding:.55rem .8rem;' +
      'background:var(--bg2);border:1px solid var(--border);border-radius:8px;' +
      'text-decoration:none;color:var(--text);font-size:.83rem;line-height:1.3;' +
      'transition:background .15s,border-color .15s;';
    const labelStyle = 'font-weight:600;color:var(--text)';
    const sumStyle   = 'font-size:.74rem;color:var(--muted);font-weight:400';

    let out =
      '<section class="lr-section"><h4>Search city or county agendas for housing topics</h4>' +
      '<p style="font-size:.82rem;color:var(--muted);margin:.25rem 0 .7rem">' +
      'Time-bound Google searches into the actual planning and council records for this jurisdiction. ' +
      'Each pill is a tightly-scoped query (quoted phrases, OR groups, filetype:pdf, last-12-month recency) ' +
      'that lands on real agendas, minutes, and staff reports — not generic press.' +
      '</p>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:.5rem">';

    links.forEach(function (lk) {
      out +=
        '<a href="' + escHtml(lk.url) + '" target="_blank" rel="noopener" ' +
          'style="' + pillStyle + '" class="lr-agenda-pill">' +
          '<span style="' + labelStyle + '">' + escHtml(lk.label) + ' &rarr;</span>' +
          (lk.summary ? '<span style="' + sumStyle + '">' + escHtml(lk.summary) + '</span>' : '') +
        '</a>';
    });

    out += '</div></section>';
    return out;
  }

  /**
   * F95 — "Boards & advocates" section. The curated `r.advocacy` list
   * already covers known orgs; this section adds search fallbacks for
   * jurisdiction-specific boards (Housing Advisory, Housing Authority
   * board) + local advocate orgs that aren't on file yet.
   */
  function _renderBoardsAndAdvocatesSection(jurisName, govDomain, r) {
    // F165: all four queries go through SearchLinks. Boards / housing-
    // authority queries pass govDomain when known so we still get the
    // site-scoped behavior; jurisdiction-only queries use OR-grouped
    // housing vocabulary with quoted-name + no-LinkedIn filtering.
    const SL = (typeof window !== 'undefined' && window.SearchLinks) ? window.SearchLinks : null;
    const G = 'https://www.google.com/search?q=';
    const enc = encodeURIComponent;
    const items = [];

    if (govDomain) {
      const boardsLink = SL
        ? SL.build({ jurisdictionName: jurisName, govDomain: govDomain, context: 'boards' })
        : { url: G + enc(`site:${govDomain} ("housing advisory" OR "housing commission" OR "housing board" OR "housing task force")`) };
      items.push({
        label: 'Housing Advisory Board / Commission (if any)',
        href: boardsLink.url
      });
      const haLink = SL
        ? SL.build({ jurisdictionName: jurisName, govDomain: govDomain, context: 'housing-authority-board' })
        : { url: G + enc(`site:${govDomain} ("housing authority" board OR commissioners)`) };
      items.push({
        label: 'Housing Authority board agendas',
        href: haLink.url
      });
    }
    if (jurisName) {
      const advLink = SL
        ? SL.build({ jurisdictionName: jurisName, context: 'local-advocates' })
        : { url: G + enc(`"${jurisName}" Colorado ("affordable housing" OR "housing equity") (coalition OR alliance OR advocate OR nonprofit) -site:linkedin.com`) };
      items.push({
        label: `Local affordable-housing advocates near "${jurisName}"`,
        href: advLink.url
      });
      const faithLink = SL
        ? SL.build({ jurisdictionName: jurisName, context: 'faith-housing' })
        : { url: G + enc(`"${jurisName}" Colorado housing (Habitat OR "Catholic Charities" OR "Volunteers of America" OR "Mercy Housing" OR YIMBY)`) };
      items.push({
        label: `Faith-based or community housing partners`,
        href: faithLink.url
      });
    }

    // Note: list any existing advocacy entries we already showed above,
    // for context that these searches are supplemental.
    const haveCurated = Array.isArray(r.advocacy) && r.advocacy.length > 0;
    if (items.length === 0 && !haveCurated) {
      return '';
    }

    let out = '<section class="lr-section"><h4>Local boards &amp; advocates — search</h4>' +
      '<p class="lr-item" style="color:var(--muted);font-size:.78rem;margin-bottom:.4rem;">' +
      (haveCurated
        ? 'Use these searches to find boards / advocates not yet on file above:'
        : 'No curated advocates on file yet for this jurisdiction. Use these searches to find local boards and advocates:') +
      '</p>';
    if (items.length > 0) {
      out += '<ul class="lr-list">' +
        items.map(it => '<li class="lr-item">' +
          '<a href="' + escHtml(it.href) + '" target="_blank" rel="noopener noreferrer" class="lr-advocacy-name">' +
          escHtml(it.label) + ' &rarr;</a></li>').join('') +
        '</ul>';
    }
    out += '</section>';
    return out;
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
      const placeName = (window.HNAState && window.HNAState.state && window.HNAState.state.current && window.HNAState.state.current.label) || null;
      el.textContent = 'Note: These projections' + (placeName ? ' for ' + placeName : '')
        + ' are scaled from county data. Place-level estimates carry higher uncertainty.';
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
      tryRenderHousingTypeNeedFromState(profile);
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

    // chartHousingTypeComposition — 4-bucket structure-type breakdown
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

    // Preferred source: ACS DP04 SMOCAPI bins (5-bin breakdown) — pulled
    // by fetchAcsExtended OR populated by the build pipeline. Pre PR-#884
    // and pre next ETL re-run the cache has these as null for every geo,
    // so we fall back to HUD CHAS aggregate (3-bin) which IS in cache
    // for all 64 counties at 100% coverage.
    const acsBins = [
      { label: '<20%',   key: 'DP04_0111PE' },
      { label: '20–25%', key: 'DP04_0112PE' },
      { label: '25–30%', key: 'DP04_0113PE' },
      { label: '30–35%', key: 'DP04_0114PE' },
      { label: '35%+',   key: 'DP04_0115PE' },
    ];
    const acsValues = acsBins.map(b => safeNum(profile[b.key]) || 0);
    const acsAvailable = acsValues.some(v => v > 0);

    if (acsAvailable) {
      // ── ACS SMOCAPI path (preferred — 5-bin granular) ────────────
      _maybeRemoveOwnerCostBurdenFallbackNote();
      makeChart(canvas.getContext('2d'), {
        type: 'bar',
        data: { labels: acsBins.map(b => b.label), datasets: [{ data: acsValues, backgroundColor: [t.c1,t.c1,t.c1,t.c5,t.c5] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: t.muted } },
            y: { ticks: { color: t.muted, callback: function (v) { return v + '%'; } } },
          },
        },
      });
      return;
    }

    // ── CHAS fallback path (3-bin aggregate) ─────────────────────
    // Prefer place-level CHAS (TIGER population-apportioned, F28) for place/CDP
    // selections so a small town doesn't inherit its county's owner-burden
    // distribution; fall back to the county CHAS row otherwise.
    //   place: summary.owner_cb30_share / owner_cb50_share (0-1)
    //   county: summary.pct_owner_cb30 / pct_owner_cb50 (0-1)
    // Both produce a 3-bin distribution: not burdened / moderate (30-50) / severe (>50).
    let cb30 = null, cb50 = null, chasFromPlace = false;
    const _isPlaceProfile = profile && (profile._geoType === 'place' || profile._geoType === 'cdp') && profile._geoid;
    if (_isPlaceProfile && window.PlaceChas && typeof window.PlaceChas.lookup === 'function') {
      const ps = window.PlaceChas.lookup(profile._geoid);
      const psum = ps && ps.summary;
      if (psum && psum.owner_cb30_share != null) {
        cb30 = Number(psum.owner_cb30_share) * 100;
        cb50 = psum.owner_cb50_share != null ? Number(psum.owner_cb50_share) * 100 : null;
        chasFromPlace = true;
      }
    }
    const chasData = S() && S().state && S().state.chasData;
    if (cb30 == null) {
      const countyFips = profile && profile._geoid && String(profile._geoid).length === 5
        ? profile._geoid
        : (S() && S().state && S().state.contextCounty) || null;
      const countyRec = chasData && countyFips ? (chasData.counties || {})[countyFips] : null;
      const chasSummary = countyRec && countyRec.summary;
      cb30 = chasSummary && chasSummary.pct_owner_cb30 != null ? Number(chasSummary.pct_owner_cb30) * 100 : null;
      cb50 = chasSummary && chasSummary.pct_owner_cb50 != null ? Number(chasSummary.pct_owner_cb50) * 100 : null;
    }

    if (cb30 == null) {
      // ChasData may not have loaded yet (it loads later in the update()
      // flow than renderExtendedAnalysis). Don't destroy the canvas with
      // a placeholder — keep it intact so a second call from the CHAS
      // load block in hna-controller.js can populate it. Only when BOTH
      // paths exhaust AND we're confident no data will arrive do we
      // show the placeholder.
      if (!chasData) return;  // CHAS still loading — try again later
      _placeholderInBox(canvas, 'Owner cost-burden data not available for this geography.');
      return;
    }

    const notBurdened = Math.max(0, 100 - cb30);
    const moderate    = Math.max(0, cb30 - (cb50 || 0));
    const severe      = cb50 || 0;
    const chasLabels  = ['Not burdened (<30%)', 'Moderate (30–50%)', 'Severe (>50%)'];
    const chasValues  = [notBurdened, moderate, severe];

    _ensureOwnerCostBurdenFallbackNote(canvas, chasFromPlace);

    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: chasLabels, datasets: [{ data: chasValues, backgroundColor: [t.c1, t.c5, '#dc2626'] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: t.muted } },
          y: { ticks: { color: t.muted, callback: function (v) { return v + '%'; } } },
        },
      },
    });
  }

  // Show a "showing CHAS aggregate (3-bin)" disclosure when the renderer
  // falls back from ACS SMOCAPI to HUD CHAS. Auto-removed when the ACS
  // path becomes available (after the ETL re-runs with PR #884's fix).
  function _ensureOwnerCostBurdenFallbackNote(canvas, fromPlace) {
    if (!canvas) return;
    let note = document.getElementById('ownerCostBurdenFallbackNote');
    if (!note) {
      note = document.createElement('p');
      note.id = 'ownerCostBurdenFallbackNote';
      note.setAttribute('role', 'note');
      note.style.cssText =
        'margin:.45rem 0 0;padding:.45rem .7rem;font-size:.78rem;color:var(--muted);' +
        'border:1px solid color-mix(in srgb,var(--warn) 25%,transparent);' +
        'background:color-mix(in srgb,var(--warn) 5%,transparent);border-radius:6px;';
      const wrap = canvas.closest('.chart-card') || canvas.parentElement;
      if (wrap) wrap.appendChild(note);
    }
    note.innerHTML =
      '<strong style="color:var(--warn)">3-bin aggregate (HUD CHAS).</strong> ' +
      'ACS SMOCAPI 5-bin breakdown (&lt;20% / 20-25% / 25-30% / 30-35% / 35%+) ' +
      'isn\'t in the cache yet for this geography. Showing HUD CHAS aggregate ' +
      'instead: not burdened (&lt;30%) · moderate (30-50%) · severe (&gt;50%). ' +
      'Will switch to the 5-bin ACS view after the next ETL data refresh.' +
      (fromPlace
        ? ' <span style="color:var(--text)">Place-level (TIGER population-apportioned from tract CHAS).</span>'
        : '');
  }
  function _maybeRemoveOwnerCostBurdenFallbackNote() {
    const note = document.getElementById('ownerCostBurdenFallbackNote');
    if (note && note.parentElement) note.parentElement.removeChild(note);
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

    // CHAS aggregates — prefer place-level (TIGER pop-apportioned) for
    // place/CDP selections so the ≤50% AMI bullet reflects the town, not its
    // county. Fall back to the county row otherwise. Both schemas expose
    // `renter_hh_by_ami.lte30 / 31to50 . cost_burdened_30pct`.
    let county = null;
    let _cbFromPlace = false;
    if ((geoType === 'place' || geoType === 'cdp') && profile._geoid
        && window.PlaceChas && typeof window.PlaceChas.lookup === 'function') {
      const _pc = window.PlaceChas.lookup(profile._geoid);
      if (_pc && _pc.renter_hh_by_ami) { county = _pc; _cbFromPlace = true; }
    }
    const chasData = S().state && S().state.chasData;
    const countyFips = U().countyFromGeoid && U().countyFromGeoid(geoType, profile._geoid || '');
    if (!county) {
      county = (chasData && countyFips) ? ((chasData.counties || chasData)[countyFips] || null) : null;
    }

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

    // CHAS-derived ≤50% AMI deficit (county-level only).
    // 2026 vintage ships renter_hh_by_ami keyed by AMI bucket; legacy
    // `tiers` array was removed. Read counts straight off lte30 +
    // 31to50 (the buckets that fully fit under the LIHTC 60% AMI cap).
    const _rba = county && county.renter_hh_by_ami;
    if (_rba) {
      const lte30Cb = (_rba.lte30 && Number(_rba.lte30.cost_burdened_30pct)) || 0;
      const t3150Cb = (_rba['31to50'] && Number(_rba['31to50'].cost_burdened_30pct)) || 0;
      const lte50Total = lte30Cb + t3150Cb;
      if (lte50Total > 0) {
        bullets.push(
          (_cbFromPlace ? 'Place-level HUD CHAS' : 'HUD CHAS county data') +
          ' flags <strong>' + fmtNum(Math.round(lte50Total)) + '</strong> renter households at ≤50% AMI ' +
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
        'Source: ACS 5-year DP03/DP04 (vintage 2020–2024) · HUD CHAS Table 7. ' +
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
  // Need by Housing Type — data-driven 6-category ranking
  //
  // Pulls EXISTING state (ACS profile, CHAS, HUD income limits, LIHTC inventory)
  // and ranks deeply affordable / workforce / family / senior rentals plus
  // missing-middle ownership and detached-SF ownership. Mounts on
  // #hnaHousingTypeNeed. Pure read — no new fetches.
  // ---------------------------------------------------------------------------

  function _htnLevelChipStyle(level) {
    /* F133 — High level chip was #fff on #e23f25 = 3.5:1 borderline.
       Darken the bg to #b91c1c (4.5:1 against white) and add an explicit
       dark-shade for VeryHigh too. */
    switch (level) {
      case 'VeryHigh': return 'background:#7f1416;color:#fff;';
      case 'High':     return 'background:#b91c1c;color:#fff;';
      case 'Moderate': return 'background:#f9a949;color:#1f2937;';
      default:         return 'background:var(--border,#e5e7eb);color:var(--muted,#555);';
    }
  }

  function _htnConfidenceChip(conf) {
    var label = conf === 'high' ? 'High confidence'
              : conf === 'med'  ? 'Medium confidence'
              : 'Low confidence';
    var color = conf === 'high' ? 'var(--good,#15803d)'
              : conf === 'med'  ? 'var(--warn,#b45309)'
              : 'var(--muted,#6b7280)';
    return '<span style="display:inline-block;font-size:.7rem;padding:.15rem .5rem;' +
      'border-radius:999px;border:1px solid ' + color + ';color:' + color + ';' +
      'background:transparent;font-weight:600;">' + label + '</span>';
  }

  function _htnFmtSignalValue(name, raw) {
    if (raw == null || !Number.isFinite(Number(raw))) return '—';
    var v = Number(raw);
    var lower = String(name).toLowerCase();
    if (lower.indexOf('mhi') >= 0 || lower.indexOf('value') >= 0) {
      return '$' + Math.round(v).toLocaleString();
    }
    if (lower.indexOf('ratio') >= 0) {
      return v.toFixed(2) + 'x';
    }
    if (lower.indexOf('count') >= 0 || lower.indexOf('population') >= 0
        || lower.indexOf('scale') >= 0) {
      if (v >= 1000) return Math.round(v).toLocaleString();
      return Math.round(v).toString();
    }
    if (lower.indexOf('size') >= 0) {
      return v.toFixed(2);
    }
    if (Math.abs(v) <= 100 && Math.abs(v) > 1) {
      return v.toFixed(1) + '%';
    }
    if (v <= 1) {
      return (v * 100).toFixed(1) + '%';
    }
    return v.toFixed(1);
  }

  function renderHousingTypeNeed(data) {
    var container = document.getElementById('hnaHousingTypeNeed');
    if (!container) return;

    if (!window.HousingTypeNeed || typeof window.HousingTypeNeed.compute !== 'function') {
      container.innerHTML =
        '<p style="color:var(--muted);font-size:.88rem;font-style:italic;">' +
        'Housing-type need module not loaded.</p>';
      return;
    }

    var results;
    try {
      results = window.HousingTypeNeed.compute(data || {});
    } catch (e) {
      console.warn('[HNA] HousingTypeNeed.compute failed', e);
      container.innerHTML =
        '<p style="color:var(--muted);font-size:.88rem;font-style:italic;">' +
        'Could not compute housing-type need from current data - try selecting another geography.' +
        '</p>';
      return;
    }

    if (!Array.isArray(results) || !results.length) {
      container.innerHTML =
        '<p style="color:var(--muted);font-size:.88rem;font-style:italic;">' +
        'Not enough signals to rank housing types for this geography yet.</p>';
      return;
    }

    var rowsHtml = results.map(function (r) {
      var signals = (r.signals || []).map(function (s) {
        return '<li style="margin:.15rem 0;font-size:.78rem;color:var(--muted);">' +
          '<span style="color:var(--text);font-weight:500;">' + escHtml(s.name) + '</span> &middot; ' +
          escHtml(_htnFmtSignalValue(s.name, s.value)) +
          (s.normalised != null
            ? ' <span style="opacity:.7;">(score ' + s.normalised + ')</span>'
            : '') +
          '</li>';
      }).join('');
      var pe = r.plainEnglish || '';
      var lr = r.lihtcRelevance || '';
      return '' +
        '<div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,3fr);' +
        'gap:1rem;padding:.85rem 0;border-top:1px solid var(--border,#e5e7eb);">' +
          '<div>' +
            '<div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.25rem;">' +
              '<strong style="font-size:.95rem;">' + escHtml(r.label) + '</strong>' +
              '<span style="display:inline-block;font-size:.7rem;font-weight:600;' +
                'padding:.18rem .55rem;border-radius:4px;' + _htnLevelChipStyle(r.level) + '">' +
                escHtml(r.level === 'VeryHigh' ? 'Very High' : r.level) +
                ' &middot; ' + r.score +
              '</span>' +
            '</div>' +
            '<div style="color:var(--muted);font-size:.78rem;margin-bottom:.4rem;">' +
              escHtml(r.meta) +
            '</div>' +
            '<div style="margin-bottom:.4rem;">' + _htnConfidenceChip(r.confidence) + '</div>' +
            '<div style="font-size:.72rem;color:var(--muted);">' +
              escHtml(r.confidenceReason || '') +
            '</div>' +
          '</div>' +
          '<div>' +
            '<div style="font-size:.78rem;color:var(--text);margin-bottom:.4rem;">' +
              escHtml(pe) +
            '</div>' +
            '<div style="font-size:.74rem;color:var(--muted);margin-bottom:.5rem;font-style:italic;">' +
              'LIHTC relevance: ' + escHtml(lr) +
            '</div>' +
            (signals
              ? '<div style="font-size:.74rem;color:var(--muted);margin-bottom:.2rem;">' +
                  'Top signals contributing:' +
                '</div>' +
                '<ul style="margin:0;padding-left:1.05rem;list-style:disc;">' + signals + '</ul>'
              : '<div style="font-size:.74rem;color:var(--muted);font-style:italic;">' +
                  'No populated signals yet for this category at this geography.</div>') +
          '</div>' +
        '</div>';
    }).join('');

    var methHtml = results.map(function (r) {
      return '<li style="margin:.35rem 0;font-size:.82rem;">' +
        '<strong>' + escHtml(r.label) + ':</strong> ' + escHtml(r.methodology || '') +
        '</li>';
    }).join('');

    var ctx = results._context || {};
    var contextLine = '';
    if (ctx.jurisdiction) {
      contextLine = 'For <strong>' + escHtml(ctx.jurisdiction) + '</strong>'
        + (ctx.pop ? ' &middot; pop ' + Number(ctx.pop).toLocaleString() : '')
        + (ctx.lihtcUnitsHere ? ' &middot; ' + ctx.lihtcUnitsHere + ' existing LIHTC units' : '');
    }

    container.innerHTML =
      (contextLine
        ? '<div style="font-size:.8rem;color:var(--muted);margin-bottom:.5rem;">' + contextLine + '</div>'
        : '') +
      '<div role="list" aria-label="Housing type need ranking">' + rowsHtml + '</div>' +
      '<details style="margin-top:1rem;border-top:1px solid var(--border,#e5e7eb);padding-top:.6rem;">' +
        '<summary style="cursor:pointer;font-size:.82rem;color:var(--muted);">' +
          'Methodology &middot; how each category is scored' +
        '</summary>' +
        '<ul style="margin:.5rem 0 0;padding-left:1.15rem;color:var(--text);">' + methHtml + '</ul>' +
        '<p style="margin:.6rem 0 0;font-size:.74rem;color:var(--muted);">' +
          'Inputs: ACS 5-year DP02 / DP03 / DP04 / DP05 (already loaded for the HNA), ' +
          'HUD CHAS Table 7 renter-by-AMI distribution, HUD income limits, and the unified ' +
          'LIHTC inventory. Each indicator is normalised to a 0-100 score via a piecewise ' +
          'ramp, then weighted within its category; missing indicators are skipped and the ' +
          'remaining weights are renormalised so a single missing signal does not artificially ' +
          'depress the score. Levels: Low &lt;30, Moderate 30-49, High 50-69, Very High &ge;70. ' +
          'Confidence is High when at least 4 indicators populate, Medium for 2-3, Low otherwise; ' +
          'tiny-place samples (pop &lt; 5,000) drop one tier. Read this alongside the ' +
          'Recommended AMI Distribution above and the IndiBuild Pipeline LIHTC Readiness ' +
          'assessment - three views of the same data with different jobs.' +
        '</p>' +
      '</details>';
  }

  // Pulls ACS profile, CHAS, LIHTC features, and HUD income limits from
  // existing HNAState and hands them to renderHousingTypeNeed. Mirrors the
  // shape that other panels (Recommended AMI Distribution, Special Needs)
  // use to hydrate from state.
  function tryRenderHousingTypeNeedFromState(profile) {
    try {
      var stateRef = S() && S().state;
      var chasData = stateRef && stateRef.chasData;
      var geoid    = (profile && profile._geoid) || '';
      var geoType  = (profile && profile._geoType) || '';
      var chasRecord = null;
      if ((geoType === 'place' || geoType === 'cdp') && geoid
          && window.PlaceChas && typeof window.PlaceChas.lookup === 'function') {
        chasRecord = window.PlaceChas.lookup(geoid);
      }
      if (!chasRecord && chasData) {
        var countyFips = '';
        if (U() && typeof U().countyFromGeoid === 'function') {
          try { countyFips = U().countyFromGeoid(geoType, geoid) || ''; } catch (_e) {}
        }
        if (!countyFips && geoid && String(geoid).length === 5) countyFips = geoid;
        if (countyFips) {
          chasRecord = (chasData.counties || {})[countyFips] || null;
        }
      }
      var lihtcFeatures = (S() && S().allLihtcFeatures) || [];
      var hud = stateRef && (stateRef.hudIncomeLimits || stateRef.incomeLimits) || null;

      var jurisdictionName = '';
      try {
        var sel = document.getElementById('geoSelect');
        if (sel && sel.options && sel.selectedIndex >= 0) {
          jurisdictionName = sel.options[sel.selectedIndex].text || '';
        }
      } catch (_e2) {}

      renderHousingTypeNeed({
        acsProfile: profile,
        chasRows: chasRecord,
        hudIncomeLimits: hud,
        lihtcInventory: lihtcFeatures,
        jurisdictionName: jurisdictionName
      });
    } catch (e) {
      console.warn('[HNA] tryRenderHousingTypeNeedFromState failed', e);
    }
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

    // Disclose place-level provenance: flows + job/wage totals are tract-derived,
    // industry mix is the county's sector shares scaled to the place job total.
    var scopeNoteEl = document.getElementById('laborScopeNote');
    if (scopeNoteEl) {
      scopeNoteEl.textContent = (lehd && (geoType === 'place' || geoType === 'cdp') && lehd.wac_source === 'tract-scaled')
        ? 'Place-level: job totals, wage split, and commute flows are aggregated from tract-level LEHD LODES; the industry mix uses the county’s sector shares scaled to the place’s job total.'
        : '';
    }

    // ── jobMetrics cards ────────────────────────────────────────────
    // Standardised on the same .metric-card structure + hyperlinked
    // source labels as the Economic Indicators row below. Source URLs
    // point at the canonical LEHD LODES8 docs / Census ACS so readers
    // can verify the underlying series.
    var metricsEl = document.getElementById('jobMetrics');
    if (metricsEl) {
      if (lehd) {
        var metrics = U().calculateJobMetrics
          ? U().calculateJobMetrics(lehd, profile)
          : null;
        if (metrics) {
          var SRC_LODES = 'https://lehd.ces.census.gov/data/lodes/LODES8/';
          var SRC_LODES_TECH = 'https://lehd.ces.census.gov/doc/help/onthemap/LODESTechDoc.pdf';
          var SRC_ACS_DP05 = 'https://data.census.gov/table/ACSDP5Y2024.DP05';
          var srcLink = function (url, text) {
            return '<a href="' + url + '" target="_blank" rel="noopener" class="hna-source-link">' + escHtml(text) + '</a>';
          };
          var WAC_SRC = srcLink(SRC_LODES, 'LEHD LODES8 WAC');
          var OD_SRC  = srcLink(SRC_LODES_TECH, 'LEHD LODES8 OD');
          var JW_SRC  = srcLink(SRC_LODES, 'LEHD') + ' + ' + srcLink(SRC_ACS_DP05, 'ACS DP05') + ' (derived)';
          var cards = [];
          if (metrics.jobs)    cards.push({ label: 'Total Jobs',       value: fmtNum(metrics.jobs),    src: WAC_SRC });
          if (metrics.within)  cards.push({ label: 'Live & Work Here', value: fmtNum(metrics.within),  src: OD_SRC });
          if (metrics.inflow)  cards.push({ label: 'Inflow Workers',   value: fmtNum(metrics.inflow),  src: OD_SRC });
          if (metrics.outflow) cards.push({ label: 'Outflow Workers',  value: fmtNum(metrics.outflow), src: OD_SRC });
          if (metrics.jwRatio) cards.push({
            label: 'Jobs : Workers',
            value: (Math.round(metrics.jwRatio * 100) / 100).toFixed(2),
            src:   JW_SRC,
          });
          metricsEl.innerHTML = cards.map(function (c) {
            return '<div class="metric-card">' +
              '<div class="mc-label">' + escHtml(c.label) + '</div>' +
              '<div class="mc-value">' + escHtml(c.value) + '</div>' +
              '<div class="mc-sub">'   + c.src              + '</div>' +
            '</div>';
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

  /**
   * F198 — Wages vs Housing Affordability panel.
   *
   * Closes the loop between "what do workers earn here?" (LEHD wage tiers)
   * and "what does housing cost here?" (ACS median rent + median home value).
   * Renders:
   *   1. Three required-income rows: rent median, buy median, AMI-60% LIHTC
   *      Each shows: required annual, required hourly (FT 2080hr), what % of
   *      median household income that represents, and the share of workers
   *      earning enough (from LEHD wage tier distribution).
   *   2. Industry table: top 6 NAICS sectors × estimated mean wage from LEHD
   *      wage tier distribution within that sector (LEHD doesn't publish
   *      sector × tier directly at jurisdiction level — we use the same
   *      $7.5K / $27.5K / $60K midpoints as Wage Distribution and weight
   *      by the per-sector share of total jobs).
   *
   * Methodology notes shown inline:
   *   • Rent affordability uses the 30% rule: required annual = monthly × 12 / 0.30.
   *   • Buy affordability reuses U().computeIncomeNeeded() which is already
   *     wired to the same constants the Income-to-Buy stat tile uses
   *     (20% down, 30y mortgage, prevailing rate, prop tax + insurance).
   *   • AMI-60% income limit comes from HUD income-limits cache for the
   *     containing county (4-person, the LIHTC reference unit size).
   *
   * Data sources read:
   *   • profile.DP04_0089E (median home value)
   *   • profile.DP04_0134E (median gross rent)
   *   • profile.DP03_0062E (median household income, for context)
   *   • lehd.annualWages[year].{low, medium, high} via calculateWageDistribution
   *   • parseIndustries(lehd, 6) for top sectors
   *   • HUD income limits via _hudFmrFor(countyFips) if available
   */
  // F243 — Downtown redevelopment panel for HNA pages. Mirrors OF detail
  // panel F236 but tuned for HNA's "is there a path to actually build
  // here?" framing. Surfaces URA presence (TIF + land write-down), OZ
  // overlap (capital-gains deferral), adaptive-reuse pattern menu (hotel-
  // to-housing, office-to-residential, parking-lot infill, underutilized
  // commercial), and acquisition + environmental cleanup tools.
  //
  // Lazy-fetches three reference files. Hides the panel on data failure.
  function _renderHnaRedevPanel(profile, countyFips5) {
    var panel = document.getElementById('hnaRedevPanel');
    if (!panel) return;
    // Normalize county FIPS to 5-digit
    var c5 = countyFips5 || '';
    if (c5 && c5.length === 3) c5 = '08' + c5;

    var jurisName = (profile && (profile.NAME || profile.name || profile.geoName)) || 'this jurisdiction';
    // F244 audit fix — county name was always falling back to "this county"
    // because profile doesn't carry countyName/_countyName. Resolve from
    // an inlined CO county FIPS map (64 entries, ~2KB) so we don't have
    // to fetch chas_affordability_gap.json just for one name lookup.
    var CO_COUNTY_NAMES = {
      '08001':'Adams','08003':'Alamosa','08005':'Arapahoe','08007':'Archuleta','08009':'Baca',
      '08011':'Bent','08013':'Boulder','08014':'Broomfield','08015':'Chaffee','08017':'Cheyenne',
      '08019':'Clear Creek','08021':'Conejos','08023':'Costilla','08025':'Crowley','08027':'Custer',
      '08029':'Delta','08031':'Denver','08033':'Dolores','08035':'Douglas','08037':'Eagle',
      '08039':'Elbert','08041':'El Paso','08043':'Fremont','08045':'Garfield','08047':'Gilpin',
      '08049':'Grand','08051':'Gunnison','08053':'Hinsdale','08055':'Huerfano','08057':'Jackson',
      '08059':'Jefferson','08061':'Kiowa','08063':'Kit Carson','08065':'Lake','08067':'La Plata',
      '08069':'Larimer','08071':'Las Animas','08073':'Lincoln','08075':'Logan','08077':'Mesa',
      '08079':'Mineral','08081':'Moffat','08083':'Montezuma','08085':'Montrose','08087':'Morgan',
      '08089':'Otero','08091':'Ouray','08093':'Park','08095':'Phillips','08097':'Pitkin',
      '08099':'Prowers','08101':'Pueblo','08103':'Rio Blanco','08105':'Rio Grande','08107':'Routt',
      '08109':'Saguache','08111':'San Juan','08113':'San Miguel','08115':'Sedgwick','08117':'Summit',
      '08119':'Teller','08121':'Washington','08123':'Weld','08125':'Yuma'
    };
    var countyName = (profile && (profile.countyName || profile._countyName)) ||
      (c5 && CO_COUNTY_NAMES[c5] ? CO_COUNTY_NAMES[c5] + ' County' : 'this county');

    // Normalize jurisdiction name for URA matching
    function normalizeJurisdName(s) {
      if (!s) return '';
      return String(s).toLowerCase()
        .replace(/^(city|town|city and county) of /, '')
        .replace(/,?\s+(co|colorado).*$/, '')
        .replace(/\s+(city|town|cdp)$/, '')
        .replace(/\s+/g, ' ').trim();
    }
    var target = normalizeJurisdName(jurisName);

    Promise.all([
      fetch('data/market/co-urban-renewal-authorities.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('data/market/co-adaptive-reuse-references.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('data/market/opportunity_zones_co.geojson').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (parts) {
      var uraData = parts[0], reuseData = parts[1], ozData = parts[2];
      if (!uraData && !reuseData && !ozData) {
        panel.hidden = true;
        return;
      }
      // Find URA match by jurisdiction name
      var ura = null;
      if (uraData && uraData.uras) {
        for (var i = 0; i < uraData.uras.length; i++) {
          var u = uraData.uras[i];
          if (normalizeJurisdName(u.jurisdiction) === target) { ura = u; break; }
        }
      }
      // Count OZ tracts in county
      var ozCount = 0;
      if (ozData && ozData.features && c5) {
        ozData.features.forEach(function (f) {
          var p = f && f.properties;
          if (p && p.county_fips === c5 && p.designated !== false) ozCount++;
        });
      }
      var patterns = (reuseData && reuseData.patterns) || {};
      var PATTERN_LABELS = {
        hotel_motel_to_residential: { icon: '🏨', label: 'Hotel / motel → residential' },
        office_to_residential:      { icon: '🏢', label: 'Office → residential' },
        surface_parking_infill:     { icon: '🅿️', label: 'Surface parking infill' },
        underutilized_commercial_parcel: { icon: '🏚️', label: 'Underutilized commercial parcel' }
      };

      var html = '<h2 style="font-size:1rem;">🏗️ Downtown redevelopment opportunities</h2>' +
        '<p style="color:var(--muted);font-size:.88rem;line-height:1.5;margin-bottom:14px;">' +
          'How could affordable housing get built here? Downtown infill — old hotels, vacant offices, ' +
          'surface parking lots, underutilized commercial — stacks 4-5 LIHTC cap-stack tools ' +
          '(basis boost · URA TIF · OZ deferral · Historic Tax Credit · brownfield grants) ' +
          'that greenfield sites can\'t access.' +
        '</p>';

      // 1. URA presence
      html += '<div style="margin:10px 0;padding:10px 12px;border-radius:6px;background:var(--bg2);">' +
        '<div style="font-weight:700;font-size:.95rem;margin-bottom:6px;">Urban Renewal Authority (URA)</div>';
      if (ura) {
        var tifText = ura.annual_tif_revenue_estimate_M
          ? '~$' + ura.annual_tif_revenue_estimate_M + 'M/yr TIF capacity'
          : 'TIF capacity not published';
        var plans = (ura.active_plans && ura.active_plans.length)
          ? ura.active_plans.slice(0, 4).join(' · ')
          : 'plan areas not published';
        html += '<div style="font-size:.85rem;line-height:1.55;">' +
          '<strong><a href="' + ura.url + '" target="_blank" rel="noopener" style="color:var(--accent);">' +
            ura.name + '</a></strong> — ' + tifText + '.<br>' +
          '<span style="color:var(--muted);"><strong>Active plan areas:</strong> ' + plans + '</span>';
        if (ura.lihtc_track_record) {
          html += '<div style="margin-top:6px;font-size:.82rem;color:var(--muted);font-style:italic;">' +
            '<strong style="font-style:normal;color:var(--text);">LIHTC track record:</strong> ' + ura.lihtc_track_record +
          '</div>';
        }
        html += '</div>';
      } else {
        html += '<div style="font-size:.85rem;color:var(--muted);line-height:1.55;">' +
          'No active URA on file for ' + jurisName + '. Smaller cities sometimes operate via a Downtown Development Authority (DDA) or county economic-development arm — worth confirming with the municipality directly. ' +
          '<a href="https://cdola.colorado.gov/funding-programs/urban-renewal" target="_blank" rel="noopener" style="color:var(--accent);">DOLA URA program ↗</a>' +
        '</div>';
      }
      html += '</div>';

      // 2. Opportunity Zone overlap
      html += '<div style="margin:10px 0;padding:10px 12px;border-radius:6px;background:var(--bg2);">' +
        '<div style="font-weight:700;font-size:.95rem;margin-bottom:6px;">Opportunity Zone overlap</div>';
      if (ozCount > 0) {
        html += '<div style="font-size:.85rem;line-height:1.55;">' +
          '<strong>' + ozCount + ' designated OZ tract' + (ozCount === 1 ? '' : 's') + '</strong> in ' +
          countyName + '. Property within these tracts qualifies for federal capital-gains deferral via Qualified Opportunity Fund equity — stacks with LIHTC + state credit.<br>' +
          '<a href="https://www.cdfifund.gov/opportunity-zones" target="_blank" rel="noopener" style="color:var(--accent);">HUD CDFI OZ map ↗</a>' +
        '</div>';
      } else {
        html += '<div style="font-size:.85rem;color:var(--muted);">' +
          'No Opportunity Zones designated in ' + countyName + '. OZ designations are permanent (2018 selections) — no path to add new ones.' +
        '</div>';
      }
      html += '</div>';

      // 3. Adaptive-reuse pattern menu (collapsed by default)
      html += '<details style="margin:10px 0;padding:10px 12px;border-radius:6px;background:var(--bg2);">' +
        '<summary style="cursor:pointer;font-weight:700;font-size:.95rem;">' +
          'Adaptive-reuse patterns to evaluate ' +
          '<span style="color:var(--muted);font-weight:400;font-size:.85rem;">(' +
            Object.keys(patterns).length + ' patterns · cost · timeline · CO examples)</span>' +
        '</summary>' +
        '<div style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:10px;">';
      Object.keys(patterns).forEach(function (key) {
        var p = patterns[key];
        var pmeta = PATTERN_LABELS[key] || { icon: '🏗️', label: key.replace(/_/g, ' ') };
        html += '<div style="padding:10px 12px;border:1px solid var(--border);border-radius:5px;font-size:.84rem;line-height:1.55;">' +
          '<div style="font-weight:700;margin-bottom:4px;">' + pmeta.icon + ' ' + pmeta.label + '</div>' +
          '<div style="color:var(--muted);">' +
            '<strong style="color:var(--text);">Cost:</strong> $' + (p.typical_cost_per_unit_K || '—') + 'K/unit · ' +
            '<strong style="color:var(--text);">Timeline:</strong> ' + (p.typical_timeline_months || '—') + ' months' +
          '</div>' +
          '<div style="margin-top:4px;color:var(--muted);">' + (p.what_it_is || '') + '</div>';
        if (p.colorado_examples && p.colorado_examples.length) {
          html += '<div style="margin-top:4px;color:var(--muted);font-size:.78rem;">' +
            '<strong style="color:var(--text);">CO examples:</strong> ' + p.colorado_examples.slice(0, 2).join(' · ') +
          '</div>';
        }
        html += '</div>';
      });
      html += '</div></details>';

      // 4. Tools
      html += '<div style="margin:10px 0;font-size:.82rem;color:var(--muted);">' +
        '<strong>Environmental + acquisition tools:</strong> ' +
        '<a href="https://www.epa.gov/brownfields" target="_blank" rel="noopener" style="color:var(--accent);">EPA Brownfields ↗</a> · ' +
        '<a href="https://cdphe.colorado.gov/voluntary-cleanup-program" target="_blank" rel="noopener" style="color:var(--accent);">CO Voluntary Cleanup ↗</a> · ' +
        '<a href="https://cdola.colorado.gov/brownfields-revolving-loan-fund" target="_blank" rel="noopener" style="color:var(--accent);">DOLA Brownfields RLF ↗</a> · ' +
        '<a href="https://www.nps.gov/subjects/taxincentives/index.htm" target="_blank" rel="noopener" style="color:var(--accent);">Federal Historic Tax Credit ↗</a>' +
      '</div>';
      html += '<p style="font-size:.74rem;color:var(--muted);font-style:italic;margin:6px 0 0;">' +
        'Source: DOLA URA registry; HUD CDFI Opportunity Zones (2018 designations); COHO adaptive-reuse reference (CHFA + Novogradac case studies). ' +
        'URA active plans + TIF capacity change frequently — confirm with the URA executive director before pitching.' +
      '</p>';

      panel.innerHTML = html;
      panel.hidden = false;
    }).catch(function () { panel.hidden = true; });
  }

  function renderWageAffordability(profile, lehd, countyFips5) {
    var panel = document.getElementById('wagesVsAffordPanel');
    if (!panel) return;
    var u = U();
    var fmtMoney = u.fmtMoney;
    var fmtNum = u.fmtNum;

    var medHomeVal = Number(profile && profile.DP04_0089E);
    var medRent    = Number(profile && profile.DP04_0134E);
    var medHHI     = Number(profile && profile.DP03_0062E);

    // ── Required incomes ──────────────────────────────────────────────
    // Rent: 30%-of-gross convention. Required annual = monthly × 40.
    var rentReqAnnual = Number.isFinite(medRent) && medRent > 0
      ? medRent * 12 / 0.30 : null;
    var rentReqHourly = rentReqAnnual ? rentReqAnnual / 2080 : null;

    // Buy: reuse the same computeIncomeNeeded the Income-to-Buy stat tile
    // uses so the numbers are consistent across the page.
    var buyRes = (typeof u.computeIncomeNeeded === 'function')
      ? u.computeIncomeNeeded(medHomeVal) : null;
    var buyReqAnnual = buyRes && Number.isFinite(buyRes.annualIncome)
      ? buyRes.annualIncome : null;
    var buyReqHourly = buyReqAnnual ? buyReqAnnual / 2080 : null;

    // AMI-60% LIHTC unit: required income to afford = 60% × HUD 4-person AMI
    // for the containing county. The CHFA §42 rent ceiling = 30% × that.
    // If HUD cache hasn't loaded for this geography, fall back to 60% of
    // median HHI as a conservative proxy with a "(approximated)" tag.
    var ami60Annual = null;
    var ami60IsApprox = false;
    try {
      // HudFmr is loaded by data-connectors/hud-fmr.js and exposed globally.
      // getIncomeLimitsByFips returns the per-county record with the AMI
      // 4-person value HUD publishes annually for the LIHTC reference unit.
      var il = (window.HudFmr && typeof window.HudFmr.getIncomeLimitsByFips === 'function')
        ? window.HudFmr.getIncomeLimitsByFips(countyFips5) : null;
      var ami4p = il && (il.ami_4person || il.ami_4 || il.ami || null);
      if (Number.isFinite(Number(ami4p)) && Number(ami4p) > 0) {
        ami60Annual = Number(ami4p) * 0.60;
      }
    } catch (_) { /* no-op */ }
    // F224 — Subscribe to HudFmr:loaded so we re-render when the data finally
    // arrives. Without this, a cold-load that hit the renderer before HudFmr
    // resolved would PERMANENTLY show the `medHHI × 0.60` approximation —
    // never recovering even after the real number was available 50ms later.
    if (!ami60Annual && window.HudFmr && typeof window.HudFmr.load === 'function') {
      // Trigger load (idempotent) + listen once for the resolve event.
      try { window.HudFmr.load(); } catch (_) {}
      var _reRender = function () {
        document.removeEventListener('HudFmr:loaded', _reRender);
        renderWageAffordability(profile, lehd, countyFips5);
      };
      document.addEventListener('HudFmr:loaded', _reRender, { once: true });
    }
    if (!ami60Annual && Number.isFinite(medHHI) && medHHI > 0) {
      ami60Annual = medHHI * 0.60;
      ami60IsApprox = true;
    }
    var ami60Hourly = ami60Annual ? ami60Annual / 2080 : null;

    // ── LEHD wage tier shares for "% workers earning enough" ──────────
    // LEHD WAC wage bins: CE01 ≤ $1,250/mo (~$15K/yr), CE02 $1,251-$3,333/mo
    // (~$15K-$40K/yr), CE03 > $3,333/mo (~$40K+). We approximate the share
    // of workers earning ≥ a target by checking which tier the target falls
    // into + adding the higher tiers in full.
    var dist = lehd && u.calculateWageDistribution
      ? u.calculateWageDistribution(lehd) : null;
    var totalJobs = dist ? (dist.low + dist.medium + dist.high) : 0;
    function _shareEarningAtLeast(annualTarget) {
      if (!dist || !totalJobs) return null;
      // < $15K → all three tiers cover the requirement
      if (annualTarget <= 15000) return 1.0;
      // $15K-$40K → medium + high cover it (rough — we don't know the
      // distribution within medium, so we assume midpoint $27.5K as the
      // medium tier's center; if target > $27.5K, only high covers).
      if (annualTarget < 27500) {
        return (dist.medium + dist.high) / totalJobs;
      }
      if (annualTarget < 40000) {
        // Partial credit within medium: linear from 100% of medium at
        // $15K target → 0% of medium at $40K target. Approximate as 1 -
        // ((target - 15K) / 25K).
        var partial = 1 - ((annualTarget - 15000) / 25000);
        return ((dist.medium * Math.max(0, partial)) + dist.high) / totalJobs;
      }
      // > $40K → only high tier earns enough. Above some reasonable
      // ceiling ($120K) we extrapolate that even high-tier shrinks; for
      // simplicity we treat anything above the threshold as "high" then
      // apply a linear haircut from $40K (100% of high) to $150K (10% of
      // high) since we have no data on the high-tier distribution.
      if (annualTarget < 150000) {
        var highPartial = 1 - ((annualTarget - 40000) / 110000) * 0.9;
        return (dist.high * Math.max(0.1, highPartial)) / totalJobs;
      }
      return (dist.high * 0.1) / totalJobs;
    }

    var rentShare = _shareEarningAtLeast(rentReqAnnual);
    var buyShare = _shareEarningAtLeast(buyReqAnnual);
    var amiShare = _shareEarningAtLeast(ami60Annual);

    // ── Render ────────────────────────────────────────────────────────
    function _row(label, baseAmt, reqAnnual, reqHourly, share, isApprox) {
      var reqAnnStr = reqAnnual ? fmtMoney(reqAnnual) : '—';
      var reqHrStr = reqHourly ? '$' + reqHourly.toFixed(2) + '/hr' : '—';
      var baseStr = baseAmt ? fmtMoney(baseAmt) : '—';
      var shareStr = (share != null) ? (share * 100).toFixed(0) + '%' : '—';
      var shareColor = (share == null) ? 'var(--muted)' :
        share >= 0.60 ? 'var(--good)' :
        share >= 0.30 ? 'var(--warn)' : 'var(--bad)';
      var hhiCmp = (Number.isFinite(medHHI) && medHHI > 0 && reqAnnual)
        ? (reqAnnual / medHHI * 100).toFixed(0) + '% of median HH income'
        : '';
      return '<tr>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);font-weight:600;">' + label + (isApprox ? ' <span style="font-size:.72rem;color:var(--muted);font-weight:400;">(approximated)</span>' : '') + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;">' + baseStr + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;color:var(--text-strong);">' + reqAnnStr + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;color:var(--accent);font-weight:600;">' + reqHrStr + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;color:var(--muted);font-size:.85rem;">' + hhiCmp + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;color:' + shareColor + ';font-weight:700;">' + shareStr + '</td>' +
      '</tr>';
    }

    var rowsHtml = '';
    rowsHtml += _row('Rent the median apartment',  medRent,    rentReqAnnual, rentReqHourly, rentShare, false);
    rowsHtml += _row('Buy the median home',        medHomeVal, buyReqAnnual,  buyReqHourly,  buyShare,  false);
    rowsHtml += _row('Afford an AMI-60% LIHTC unit', null,     ami60Annual,   ami60Hourly,   amiShare,  ami60IsApprox);

    // F231 — NLIHC Out of Reach county-level "housing wage" benchmark.
    // Loaded async; appended to the panel as a new section below the
    // main table when the fetch resolves. The "housing wage" is the
    // hourly wage a full-time renter needs to afford the HUD 2-BR FMR
    // without spending more than 30% of income on housing.
    var panel = document.getElementById('wagesVsAffordPanel');
    if (panel && countyFips5) {
      fetch('data/affordable-housing/nlihc-out-of-reach-co.json').then(function (r) {
        return r.ok ? r.json() : null;
      }).then(function (j) {
        if (!j || !j.by_county) return;
        var rec = j.by_county[countyFips5];
        var state = j.state_summary || {};
        if (!rec) {
          // Fall back to state aggregate
          rec = {
            county_name: 'Colorado (state aggregate)',
            two_br_housing_wage: state.two_br_housing_wage_2025,
            one_br_housing_wage: null,
            renter_median_wage: state.renter_median_hourly_wage_2025,
            gap_2br: state.affordability_gap_per_hour,
            notes: 'No county-specific value cached — using state aggregate.'
          };
        }
        var addendum = document.createElement('div');
        addendum.style.cssText = 'margin-top:14px;padding:.6rem .8rem;background:var(--accent-dim);border-left:3px solid var(--accent);border-radius:0 4px 4px 0;font-size:.85rem;line-height:1.5;';
        addendum.innerHTML =
          '<div style="font-weight:700;color:var(--accent);margin-bottom:.3rem;">🏠 NLIHC Out of Reach — ' + rec.county_name + ' housing wage</div>' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:.4rem .8rem;margin-bottom:.4rem;">' +
            '<div><span style="color:var(--muted);font-size:.78rem;">2-BR housing wage:</span><br><strong>$' + (rec.two_br_housing_wage || '—').toFixed(2) + '/hr</strong></div>' +
            (rec.one_br_housing_wage ? '<div><span style="color:var(--muted);font-size:.78rem;">1-BR housing wage:</span><br><strong>$' + rec.one_br_housing_wage.toFixed(2) + '/hr</strong></div>' : '') +
            '<div><span style="color:var(--muted);font-size:.78rem;">Median renter wage:</span><br><strong>$' + (rec.renter_median_wage || '—').toFixed(2) + '/hr</strong></div>' +
            '<div><span style="color:var(--muted);font-size:.78rem;">Affordability gap:</span><br><strong style="color:' + (rec.gap_2br > 20 ? 'var(--bad)' : rec.gap_2br > 12 ? 'var(--warn)' : 'var(--good)') + ';">$' + (rec.gap_2br || '—').toFixed(2) + '/hr</strong></div>' +
          '</div>' +
          '<p style="margin:.2rem 0 .3rem;color:var(--text);">' + (rec.notes || '') + '</p>' +
          '<p style="margin:.2rem 0 0;font-size:.72rem;color:var(--muted);">' +
            'Source: <a href="https://nlihc.org/oor" target="_blank" rel="noopener" style="color:var(--accent);">NLIHC Out of Reach ' + ((j.meta && j.meta.vintage) || '2025') + '</a> · ' +
            'The "housing wage" = (HUD 2-BR FMR × 12) ÷ (0.30 × 2,080 work hours/year). Hourly wage a full-time renter needs to afford 2-BR FMR without rent burden. ' +
            'Pulls a hard one-line answer to "why does this jurisdiction need affordable housing?" for IC memos.' +
          '</p>';
        panel.appendChild(addendum);
      }).catch(function () { /* silent */ });
    }

    // F243 — Render the downtown-redevelopment panel for this HNA jurisdiction.
    // Same data set as the OF detail panel (F236): URA presence, OZ overlap,
    // adaptive-reuse pattern menu. Lazy-fetches all three files in parallel
    // then renders. Non-blocking; hides on failure.
    _renderHnaRedevPanel(profile, countyFips5);

    var tableHtml = '<div style="overflow-x:auto;">' +
      '<table style="width:100%;border-collapse:collapse;font-size:.9rem;margin-top:8px;">' +
      '<thead><tr style="background:var(--bg2);">' +
        '<th style="padding:8px;text-align:left;font-weight:700;border-bottom:2px solid var(--border);">Housing target</th>' +
        '<th style="padding:8px;text-align:right;font-weight:700;border-bottom:2px solid var(--border);">Cost</th>' +
        '<th style="padding:8px;text-align:right;font-weight:700;border-bottom:2px solid var(--border);">Income needed</th>' +
        '<th style="padding:8px;text-align:right;font-weight:700;border-bottom:2px solid var(--border);">Hourly wage</th>' +
        '<th style="padding:8px;text-align:right;font-weight:700;border-bottom:2px solid var(--border);">vs. median HHI</th>' +
        '<th style="padding:8px;text-align:right;font-weight:700;border-bottom:2px solid var(--border);">Workers who qualify</th>' +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';

    // ── Methodology footer ────────────────────────────────────────────
    var notesHtml = '<details style="margin-top:12px;">' +
      '<summary style="cursor:pointer;font-size:.85rem;color:var(--muted);font-weight:600;">Methodology &amp; sources</summary>' +
      '<ul style="margin:8px 0 0;padding-left:20px;font-size:.82rem;color:var(--muted);line-height:1.55;">' +
        '<li><strong>30% rule:</strong> standard housing affordability convention — gross income × 30% = max housing payment. Required annual = monthly cost × 12 ÷ 0.30; hourly = annual ÷ 2,080 (40hr × 52wk).</li>' +
        '<li><strong>Buy assumptions:</strong> 20% down, 30-year mortgage at prevailing rate, property tax + insurance + (PMI if applicable). Same constants used by the Income Needed to Buy stat tile above.</li>' +
        '<li><strong>AMI-60% LIHTC:</strong> 60% × HUD 4-person Area Median Income for the containing county. Tax-credit units are restricted to ≤60% AMI tenants — this is the income they need.</li>' +
        '<li><strong>"Workers who qualify":</strong> share of local LEHD WAC jobs earning ≥ the required income. Computed from CE01 (≤ $15K), CE02 ($15K-$40K), CE03 ($40K+) tier counts with linear interpolation within tiers.</li>' +
        '<li><strong>Sources:</strong> ' +
          '<a href="https://data.census.gov/table/ACSDP5Y2024.DP04" target="_blank" rel="noopener" class="hna-source-link">ACS DP04</a> (rent + home value), ' +
          '<a href="https://data.census.gov/table/ACSDP5Y2024.DP03" target="_blank" rel="noopener" class="hna-source-link">ACS DP03</a> (median HHI), ' +
          '<a href="https://www.huduser.gov/portal/datasets/il.html" target="_blank" rel="noopener" class="hna-source-link">HUD Income Limits</a> (4-person AMI), ' +
          '<a href="https://lehd.ces.census.gov/data/lodes/LODES8/" target="_blank" rel="noopener" class="hna-source-link">LEHD LODES8 WAC</a> (wage tiers).</li>' +
      '</ul></details>';

    panel.innerHTML = tableHtml + notesHtml;
  }

  // ──────────────────────────────────────────────────────────────────
  // F199 + F200 — County-level historical trends (affordability + permits)
  // ──────────────────────────────────────────────────────────────────
  //
  // Both panels load from data/co-housing-costs/county-trends.json, a 51 KB
  // JSON built by scripts/build_county_trends_json.py from three parquet
  // files:
  //   • acs_county_latest.parquet — 3 ACS 5-yr cohorts (2009, 2014, 2024)
  //   • fhfa_hpi_county_raw.parquet — FHFA HPI annual index
  //   • permits_county.parquet — Census BPS annual permits 2020-2024
  //
  // Shared loader caches the parsed JSON; both renderers tolerate misses.
  var _countyTrendsCache = null;
  function _loadCountyTrends() {
    if (_countyTrendsCache !== null) return Promise.resolve(_countyTrendsCache);
    return fetch('data/co-housing-costs/county-trends.json')
      .then(function (r) { return r.json(); })
      .then(function (j) { _countyTrendsCache = j; return j; })
      .catch(function (e) {
        console.warn('[HNA] county-trends.json load failed', e);
        _countyTrendsCache = { counties: {} };
        return _countyTrendsCache;
      });
  }

  /**
   * F199 — Decade affordability trend. Three ACS cohorts (2009 / 2014 / 2024)
   * × {median rent, median HHI, rent burden 30+} plus FHFA HPI relative to
   * the 15-year baseline (= 2009). Renders:
   *   1. Summary cards: rent change, income change, HPI change, burden change
   *   2. Side-by-side bar chart (2009 vs 2014 vs 2024) for rent + income
   *   3. Affordability ratio table: annual rent / annual income at each cohort
   *      → tells you whether housing got more or less affordable.
   *
   * Falls back to "not available" for non-county geographies (we don't have
   * place-level historical ACS in the parquet) — placeholder with a link to
   * the data.census.gov tables so the user can pull it themselves.
   */
  function renderDecadeAffordTrend(geoType, geoid, contextCounty) {
    var panel = document.getElementById('decadeAffordTrendPanel');
    if (!panel) return;
    var countyFips = (geoType === 'county') ? geoid : contextCounty;
    var u = U();
    var fmtMoney = u.fmtMoney;

    if (!countyFips) {
      panel.innerHTML = '<p style="color:var(--muted);font-size:.88rem;">' +
        'Decade trends are published at the county level only. Pick a county or ' +
        'place inside a county to see the historical comparison.</p>';
      return;
    }

    _loadCountyTrends().then(function (data) {
      var rec = data.counties && data.counties[countyFips];
      if (!rec || !rec.acs_cohorts || rec.acs_cohorts.length < 2) {
        panel.innerHTML = '<p style="color:var(--muted);font-size:.88rem;">' +
          'Historical trend data not cached for this county.</p>';
        return;
      }
      // F223 — Explicit county-scope label when called from a place selection.
      // The decade trend chart (ACS cohorts + FHFA HPI) is published at the
      // county level only; this banner makes that obvious instead of letting
      // the user assume the numbers are place-specific.
      var scopeBanner = (geoType === 'place')
        ? '<div style="margin:0 0 .75rem;padding:.5rem .75rem;border-left:3px solid var(--warn);background:var(--warn-dim);border-radius:0 4px 4px 0;font-size:.78rem;line-height:1.4;color:var(--text);">' +
            '<strong style="color:var(--warn);">📍 ' + (rec.county_name || 'County') + ' figures.</strong> ' +
            'ACS 5-yr cohorts (B25064/B19013) and FHFA HPI publish at the county level only; ' +
            'your selected place inherits these county-wide trends.' +
          '</div>'
        : '';
      var cohorts = rec.acs_cohorts.slice().sort(function (a, b) { return a.year - b.year; });
      var first = cohorts[0];
      var last  = cohorts[cohorts.length - 1];
      var hpi = rec.hpi || {};

      function _pctChange(a, b) {
        if (!a || !b || a <= 0) return null;
        return (b - a) / a;
      }
      function _fmtPctChange(p) {
        if (p == null) return '—';
        var s = (p * 100).toFixed(0);
        return (p >= 0 ? '+' : '') + s + '%';
      }
      function _fmtSpread(p, isGood) {
        // isGood = positive change is favorable (e.g. income growth).
        // For rent + HPI + burden, positive change is unfavorable.
        if (p == null) return 'var(--muted)';
        if (isGood) return p >= 0 ? 'var(--good)' : 'var(--bad)';
        return p <= 0 ? 'var(--good)' : (p < 0.3 ? 'var(--warn)' : 'var(--bad)');
      }

      var rentChange = _pctChange(first.median_gross_rent, last.median_gross_rent);
      var incomeChange = _pctChange(first.median_hh_income, last.median_hh_income);
      var hpiChange = hpi.change_15y_pct != null ? hpi.change_15y_pct : null;
      var burdenChange = _pctChange(first.rent_burden_30_plus, last.rent_burden_30_plus);

      // Affordability ratio: annual rent / annual income (lower = more affordable).
      function _affordRatio(c) {
        if (!c.median_gross_rent || !c.median_hh_income) return null;
        return (c.median_gross_rent * 12) / c.median_hh_income;
      }

      // ── Summary cards ──────────────────────────────────────────────
      var cardsHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:14px;">' +
        '<div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);">' +
          '<div style="font-size:.78rem;color:var(--muted);">Median rent change</div>' +
          '<div style="font-size:1.4rem;font-weight:800;color:' + _fmtSpread(rentChange, false) + ';">' + _fmtPctChange(rentChange) + '</div>' +
          '<div style="font-size:.72rem;color:var(--muted);">' + fmtMoney(first.median_gross_rent) + ' → ' + fmtMoney(last.median_gross_rent) + ' (' + first.year + '→' + last.year + ')</div>' +
        '</div>' +
        '<div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);">' +
          '<div style="font-size:.78rem;color:var(--muted);">Median income change</div>' +
          '<div style="font-size:1.4rem;font-weight:800;color:' + _fmtSpread(incomeChange, true) + ';">' + _fmtPctChange(incomeChange) + '</div>' +
          '<div style="font-size:.72rem;color:var(--muted);">' + fmtMoney(first.median_hh_income) + ' → ' + fmtMoney(last.median_hh_income) + '</div>' +
        '</div>' +
        '<div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);">' +
          '<div style="font-size:.78rem;color:var(--muted);">FHFA home price index (15y)</div>' +
          '<div style="font-size:1.4rem;font-weight:800;color:' + _fmtSpread(hpiChange, false) + ';">' + _fmtPctChange(hpiChange) + '</div>' +
          '<div style="font-size:.72rem;color:var(--muted);">' + (hpi.base_15y != null ? hpi.base_15y.toFixed(0) : '—') + ' → ' + (hpi.latest != null ? hpi.latest.toFixed(0) : '—') + ' (FHFA index)</div>' +
        '</div>' +
        '<div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);">' +
          '<div style="font-size:.78rem;color:var(--muted);">Rent burden 30%+ change</div>' +
          '<div style="font-size:1.4rem;font-weight:800;color:' + _fmtSpread(burdenChange, false) + ';">' + _fmtPctChange(burdenChange) + '</div>' +
          '<div style="font-size:.72rem;color:var(--muted);">' + (first.rent_burden_30_plus != null ? (first.rent_burden_30_plus * 100).toFixed(0) + '%' : '—') + ' → ' + (last.rent_burden_30_plus != null ? (last.rent_burden_30_plus * 100).toFixed(0) + '%' : '—') + ' of renters</div>' +
        '</div>' +
      '</div>';

      // ── Comparison chart canvas + affordability ratio table ────────
      var canvasId = 'chartDecadeAffordTrend';
      var tableId = 'decadeAffordRatioTable';
      var chartHtml = '<div class="chart-box" style="position:relative;height:280px;"><canvas id="' + canvasId + '" role="img" aria-label="Rent and income trend over time"></canvas></div>';

      var ratioRows = cohorts.map(function (c) {
        var r = _affordRatio(c);
        var rStr = r != null ? (r * 100).toFixed(1) + '%' : '—';
        var rColor = r == null ? 'var(--muted)' : (r < 0.20 ? 'var(--good)' : r < 0.30 ? 'var(--warn)' : 'var(--bad)');
        return '<tr>' +
          '<td style="padding:5px 8px;border-bottom:1px solid var(--border);font-weight:600;">' + c.year + '</td>' +
          '<td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right;">' + (c.median_gross_rent ? fmtMoney(c.median_gross_rent) + '/mo' : '—') + '</td>' +
          '<td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right;">' + (c.median_hh_income ? fmtMoney(c.median_hh_income) : '—') + '</td>' +
          '<td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right;color:' + rColor + ';font-weight:700;">' + rStr + '</td>' +
          '<td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right;">' + (c.rent_burden_30_plus != null ? (c.rent_burden_30_plus * 100).toFixed(1) + '%' : '—') + '</td>' +
        '</tr>';
      }).join('');
      var tableHtml = '<div style="overflow-x:auto;margin-top:14px;"><table id="' + tableId + '" style="width:100%;border-collapse:collapse;font-size:.88rem;">' +
        '<thead><tr style="background:var(--bg2);">' +
          '<th style="padding:8px;text-align:left;border-bottom:2px solid var(--border);">ACS vintage</th>' +
          '<th style="padding:8px;text-align:right;border-bottom:2px solid var(--border);">Median rent</th>' +
          '<th style="padding:8px;text-align:right;border-bottom:2px solid var(--border);">Median HH income</th>' +
          '<th style="padding:8px;text-align:right;border-bottom:2px solid var(--border);">Rent ÷ income</th>' +
          '<th style="padding:8px;text-align:right;border-bottom:2px solid var(--border);">Renters burdened (30%+)</th>' +
        '</tr></thead><tbody>' + ratioRows + '</tbody></table></div>' +
        '<p style="margin:8px 0 0;font-size:.78rem;color:var(--muted);line-height:1.5;">' +
          '<strong>Reading this:</strong> "Rent ÷ income" is the share of pretax median income spent on the median rent. ' +
          'The 30% rule says housing should stay below 30%. Above 30% = the median renter is cost-burdened on the median apartment. ' +
          '<a href="https://data.census.gov/table/ACSDP5Y2024.DP04" target="_blank" rel="noopener" class="hna-source-link">ACS DP04</a>, ' +
          '<a href="https://www.fhfa.gov/data/hpi" target="_blank" rel="noopener" class="hna-source-link">FHFA HPI</a>.' +
        '</p>';

      panel.innerHTML = scopeBanner + cardsHtml + chartHtml + tableHtml;

      // Draw the chart (Chart.js is already loaded for the page)
      var canvas = document.getElementById(canvasId);
      if (!canvas) return;
      var t = chartTheme();
      var fmtNum = u.fmtNum;
      makeChart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: cohorts.map(function (c) { return String(c.year); }),
          datasets: [
            { label: 'Median rent ($/mo)',     data: cohorts.map(function (c) { return c.median_gross_rent; }), backgroundColor: t.c1, yAxisID: 'yRent' },
            { label: 'Median HH income ($/yr)', data: cohorts.map(function (c) { return c.median_hh_income; }),  backgroundColor: t.c3, yAxisID: 'yIncome' }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: t.text } },
            tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + fmtMoney(c.parsed.y); } } }
          },
          scales: {
            x:        { ticks: { color: t.muted }, grid: { color: t.border } },
            yRent:    { position: 'left',  title: { display: true, text: 'Rent ($/mo)', color: t.muted }, ticks: { color: t.muted, callback: function (v) { return '$' + fmtNum(v); } }, grid: { color: t.border } },
            yIncome:  { position: 'right', title: { display: true, text: 'Income ($/yr)', color: t.muted }, ticks: { color: t.muted, callback: function (v) { return '$' + fmtNum(v); } }, grid: { drawOnChartArea: false } }
          }
        }
      });
    });
  }

  /**
   * F200 — Housing type pace (Census BPS annual permits).
   *
   * Bar chart of annual permitted units for the active county over the
   * Census Building Permits Survey vintage range (2020-2024 in the current
   * parquet). Surfaces the relationship between permitting pace and the
   * jurisdiction's housing-gap need.
   *
   * Caveat shown inline: Census BPS publishes total units only at the
   * county-by-year level — structure-type breakdown (1-unit / 2-4 / 5+) is
   * not exposed in the current parquet. To get structure breakdown you'd
   * need to ingest the raw BPS file (cf. https://www.census.gov/construction/bps/).
   * The summary table is the most accurate slice available now.
   */
  function renderHousingTypePace(geoType, geoid, contextCounty) {
    var panel = document.getElementById('housingTypePacePanel');
    if (!panel) return;
    var countyFips = (geoType === 'county') ? geoid : contextCounty;
    var u = U();
    var fmtNum = u.fmtNum;

    if (!countyFips) {
      panel.innerHTML = '<p style="color:var(--muted);font-size:.88rem;">' +
        'BPS permits are published at the county level. Pick a county or ' +
        'place inside a county to see permitting pace.</p>';
      return;
    }

    _loadCountyTrends().then(function (data) {
      var rec = data.counties && data.counties[countyFips];
      var permits = rec && rec.permits;
      // F223 — Explicit county-scope label when called from a place selection.
      var scopeBanner = (geoType === 'place' && rec)
        ? '<div style="margin:0 0 .75rem;padding:.5rem .75rem;border-left:3px solid var(--warn);background:var(--warn-dim);border-radius:0 4px 4px 0;font-size:.78rem;line-height:1.4;color:var(--text);">' +
            '<strong style="color:var(--warn);">📍 ' + (rec.county_name || 'County') + ' figures.</strong> ' +
            'Census Building Permits Survey publishes at the county level only; place-level permit counts must be pulled from the local building department.' +
          '</div>'
        : '';
      if (!permits || !permits.length) {
        panel.innerHTML = '<p style="color:var(--muted);font-size:.88rem;">' +
          'BPS permits not cached for this county.</p>';
        return;
      }
      var years = permits.map(function (p) { return p.year; });
      var units = permits.map(function (p) { return p.total_units; });
      var total = units.reduce(function (s, n) { return s + n; }, 0);
      var avgPerYear = total / units.length;
      var lastYr = years[years.length - 1];
      var firstYr = years[0];

      // ── Headline cards ────────────────────────────────────────────
      var cardsHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:14px;">' +
        '<div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);">' +
          '<div style="font-size:.78rem;color:var(--muted);">Total permits ' + firstYr + '–' + lastYr + '</div>' +
          '<div style="font-size:1.4rem;font-weight:800;color:var(--accent);">' + fmtNum(total) + '</div>' +
          '<div style="font-size:.72rem;color:var(--muted);">units across ' + years.length + ' years</div>' +
        '</div>' +
        '<div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);">' +
          '<div style="font-size:.78rem;color:var(--muted);">Average pace</div>' +
          '<div style="font-size:1.4rem;font-weight:800;">' + fmtNum(Math.round(avgPerYear)) + '</div>' +
          '<div style="font-size:.72rem;color:var(--muted);">units/year average</div>' +
        '</div>' +
        '<div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);">' +
          '<div style="font-size:.78rem;color:var(--muted);">Most recent year (' + lastYr + ')</div>' +
          '<div style="font-size:1.4rem;font-weight:800;">' + fmtNum(units[units.length - 1]) + '</div>' +
          '<div style="font-size:.72rem;color:var(--muted);">vs. ' + fmtNum(units[0]) + ' in ' + firstYr + '</div>' +
        '</div>' +
      '</div>';

      var canvasId = 'chartHousingTypePace';
      var chartHtml = '<div class="chart-box" style="position:relative;height:240px;"><canvas id="' + canvasId + '" role="img" aria-label="Annual housing unit permits over time"></canvas></div>';

      var noteHtml = '<details style="margin-top:14px;">' +
        '<summary style="cursor:pointer;font-size:.85rem;color:var(--muted);font-weight:600;">Methodology &amp; gap analysis</summary>' +
        '<div style="margin-top:8px;font-size:.82rem;color:var(--muted);line-height:1.55;">' +
          '<p style="margin:0 0 .5rem;"><strong>Source:</strong> ' +
            '<a href="https://www.census.gov/construction/bps/" target="_blank" rel="noopener" class="hna-source-link">Census Building Permits Survey (BPS)</a>. ' +
            'Annual total units permitted at the county level. Vintages 2020-2024 cached in <code>data/co-housing-costs/permits_county.parquet</code>.</p>' +
          '<p style="margin:0 0 .5rem;"><strong>Caveat:</strong> The current cached BPS slice publishes total units only — structure-type breakdown (1-unit / 2-4 / 5+) is not included. ' +
            'To get the structure breakdown, ingest the raw monthly BPS files (the Census API publishes by structure type at jurisdiction level).</p>' +
          '<p style="margin:0;"><strong>Compare to need:</strong> if the jurisdiction has a 1,000-unit housing gap (see the Housing Gap Summary panel below) ' +
            'and is permitting only 200 units/year, that\'s ~5 years just to catch up — assuming everything permitted is affordable, which it isn\'t. ' +
            'For affordable LIHTC permitting specifically, see the Prop 123 compliance section.</p>' +
        '</div></details>';

      panel.innerHTML = scopeBanner + cardsHtml + chartHtml + noteHtml;

      var canvas = document.getElementById(canvasId);
      if (!canvas) return;
      var t = chartTheme();
      makeChart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: years.map(String),
          datasets: [{
            label: 'Permits (all unit types)',
            data: units,
            backgroundColor: t.c1
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: function (c) { return fmtNum(c.parsed.y) + ' units permitted'; } } }
          },
          scales: {
            x: { ticks: { color: t.muted }, grid: { color: t.border } },
            y: { ticks: { color: t.muted, callback: function (v) { return fmtNum(v); } }, grid: { color: t.border }, title: { display: true, text: 'Units permitted', color: t.muted } }
          }
        }
      });
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

    // Source attribution: every card here is derived from LEHD WAC
    // (annualEmployment / industries[]). YoY + cumulative are derived
    // from the annualEmployment dict via simple arithmetic. Source
    // labels are rendered as hyperlinks to the canonical public source
    // so readers can verify the underlying series.
    var SRC_LODES = 'https://lehd.ces.census.gov/data/lodes/LODES8/';
    var SRC_WAC   = 'https://lehd.ces.census.gov/data/lodes/LODES8/co/wac/';
    function srcLink(url, label) {
      return '<a href="' + url + '" target="_blank" rel="noopener" class="hna-source-link">' + escHtml(label) + '</a>';
    }
    var WAC_SRC     = srcLink(SRC_LODES, 'LEHD LODES8 WAC');
    var DERIVED_SRC = srcLink(SRC_WAC,   'LEHD WAC (derived)');
    var CNS_SRC     = srcLink(SRC_WAC,   'LEHD WAC CNS sectors');
    var cards = [];
    if (latestJobs) {
      cards.push({
        label: 'Total Jobs (' + (latestYear || '') + ')',
        value: fmtNum(latestJobs),
        src:   WAC_SRC,
      });
    }
    if (typeof latestYoy === 'number') {
      cards.push({
        label: 'YoY Change',
        value: (latestYoy > 0 ? '+' : '') + latestYoy.toFixed(2) + '%',
        src:   DERIVED_SRC,
      });
    }
    if (cumulative !== null) {
      cards.push({
        label: years[0] + '–' + latestYear + ' Cumulative',
        value: (cumulative > 0 ? '+' : '') + cumulative.toFixed(1) + '%',
        src:   DERIVED_SRC,
      });
    }
    if (lehd.industries && lehd.industries.length) {
      var topInd = lehd.industries[0];
      var topCount = (topInd.count != null)
        ? Number(topInd.count).toLocaleString('en-US')
        : null;
      var topPct = (topInd.pct != null) ? (+topInd.pct).toFixed(1) + '%' : null;
      var topStats = [topCount && (topCount + ' jobs'), topPct].filter(Boolean).join(' · ');
      cards.push({
        label: 'Top Industry',
        value: topInd.label + (topStats ? ' (' + topStats + ')' : ''),
        src:   CNS_SRC,
      });
    }
    container.innerHTML = cards.map(function (c) {
      return '<div class="metric-card">' +
        '<div class="mc-label">' + escHtml(c.label) + '</div>' +
        '<div class="mc-value">' + escHtml(c.value) + '</div>' +
        '<div class="mc-sub">'   + c.src              + '</div>' +
      '</div>';
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
    // county NAME — resolved from FIPS via window.__HNA_GEO_CONFIG).
    const container = document.getElementById('blsLabourMarketCards');
    if (!container) return;
    if (!econData || !econData.counties) {
      container.innerHTML = '<p style="color:var(--muted);font-size:.85rem;">Labor-market data unavailable.</p>';
      return;
    }

    // Resolve FIPS → county name from the geo-config (loaded by the
    // controller into window.__HNA_GEO_CONFIG). The previous lookup
    // (U().CO_COUNTY_NAMES) referenced a constant that doesn't exist on
    // this codebase, so the panel always fell back to statewide median.
    let countyName = null;
    if (countyFips5 && countyFips5 !== '08') {
      const geoConf = window.__HNA_GEO_CONFIG;
      const entry = geoConf && Array.isArray(geoConf.counties)
        ? geoConf.counties.find(c => c.geoid === String(countyFips5).padStart(5, '0'))
        : null;
      if (entry && entry.label) {
        // Labels are like "Adams County" — strip " County" suffix for the data lookup
        countyName = entry.label.replace(/\s+County$/i, '').trim();
      }
    }

    if (!countyName) {
      // State or unknown — show CO statewide aggregate (median across counties)
      const allMetrics = Object.values(econData.counties);
      const median = arr => {
        const sorted = arr.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
        return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
      };
      const rec = {
        unemployment_rate: median(allMetrics.map(m => m.unemployment_rate)),
        job_growth_5yr_pct: median(allMetrics.map(m => m.job_growth_5yr_pct)),
        population_growth_5yr_pct: median(allMetrics.map(m => m.population_growth_5yr_pct)),
        affordability_index: median(allMetrics.map(m => m.affordability_index)),
      };
      container.innerHTML = _renderBlsCards(rec, 'Colorado (statewide median)');
      return;
    }
    const rec = econData.counties[countyName] || econData.counties[countyName + ' County'];
    if (!rec) {
      container.innerHTML = '<p style="color:var(--muted);font-size:.85rem;">No labor-market data for ' + escHtml(countyName) + '.</p>';
      return;
    }
    container.innerHTML = _renderBlsCards(rec, countyName + ' County');
  }

  function _renderBlsCards(rec, label) {
    const fmt = (v, suffix) => v == null || !Number.isFinite(v) ? '—' : v.toFixed(1) + (suffix || '');
    // Source URLs for inline attribution links. BLS migrated this dashboard
    // off the deprecated QCEW endpoint to LAUS in PR #621 / commit 2c0b06fa
    // (job_growth_5yr_pct is now a 5-yr LAUS residential-employment delta).
    const SRC_LAUS = 'https://www.bls.gov/lau/';
    const SRC_ACS  = 'https://www.census.gov/programs-surveys/acs';
    const srcLink = (url, text) =>
      '<a href="' + url + '" target="_blank" rel="noopener" class="hna-source-link">' + escHtml(text) + '</a>';
    const cards = [
      { title: 'Unemployment',       value: fmt(rec.unemployment_rate, '%'),         note: srcLink(SRC_LAUS, 'BLS LAUS (current)') },
      { title: 'Job growth (5y)',    value: fmt(rec.job_growth_5yr_pct, '%'),        note: srcLink(SRC_LAUS, 'BLS LAUS (residential)') },
      { title: 'Pop growth (5y)',    value: fmt(rec.population_growth_5yr_pct, '%'), note: srcLink(SRC_ACS,  'ACS 5-year') },
      { title: 'Affordability idx',  value: fmt(rec.affordability_index, ''),        note: 'home price ÷ HHI · ' + srcLink(SRC_ACS, 'ACS 5-year') },
    ];
    // Render cards directly as children of the outer .metric-cards-4 grid
    // (no nested wrapper grid) so the box geometry matches the Economic
    // Indicators row directly above. Geography label spans the full row
    // via grid-column:1/-1.
    let html = '<div style="grid-column:1/-1;font-size:.78rem;color:var(--muted);margin-bottom:2px;">' + escHtml(label) + '</div>';
    cards.forEach(c => {
      html += '<div class="metric-card">' +
        '<div class="mc-label">' + escHtml(c.title) + '</div>' +
        '<div class="mc-value">' + escHtml(c.value) + '</div>' +
        '<div class="mc-sub">'   + c.note               + '</div>' +
      '</div>';
    });
    return html;
  }

  /**
   * renderGapCoverageStats — populate the "Affordability Gap by AMI Tier"
   * stat cards in the Executive Snapshot (#hnaGapCoveragePanel). Primary
   * source is HUD CHAS cost-burdened renter HHs at each AMI tier; falls
   * back to ACS-derived gap (households at AMI band minus units priced
   * affordable at that band) when CHAS data looks corrupted for the
   * selected county. The CHAS Table 9 ETL is known to misread the
   * income-vs-burden axis on ~25 rural CO counties, producing implausibly
   * small "≤30% AMI total" rows or 0 cost-burden where burden should be
   * near-universal — the ACS fallback catches those cases.
   *
   * @param {string} countyFips5 - 5-digit county FIPS or null for statewide
   * @param {object|null} chasData - pre-loaded chas_affordability_gap.json
   * @param {object|null} acsAmiData - pre-loaded co_ami_gap_by_county.json
   */
  /**
   * renderGapCoverageStats — populate the "Affordability Gap by AMI Tier"
   * panel with 7 cumulative AMI bands (30/40/50/60/70/80/100). Primary
   * source is the ACS-derived gap file (co_ami_gap_by_county.json), which
   * is the only feed with 7-band granularity. Falls back to a 4-band HUD
   * CHAS estimate when ACS is unavailable for a geography.
   *
   * "Gap" semantics: the shortfall is computed PER BAND — within each AMI
   * band, households minus affordable units, clamped at zero (surplus supply
   * in one band can't backfill another). The cumulative row is the running
   * sum of those per-band shortfalls, so it is monotonic and the ≤100% AMI
   * figure is the total cumulative gap (not a sum across bands).
   *
   * @param {string} countyFips5 - 5-digit county FIPS or null for statewide
   * @param {object|null} chasData - parsed chas_affordability_gap.json
   * @param {object|null} acsAmiData - parsed co_ami_gap_by_county.json
   */
  function renderGapCoverageStats(countyFips5, chasData, acsAmiData, selectedGeo, placeAmiData, profile) {
    const panel  = document.getElementById('hnaGapCoveragePanel');
    const confEl = document.getElementById('hnaGapConfidence');
    const barEl  = document.getElementById('hnaGapCoverageBar');
    if (!panel) return;
    if (!chasData && !acsAmiData && !placeAmiData) { panel.hidden = true; return; }

    // The 7 ACS-derived bands match both card rows in the HTML.
    // - cumulativeCardEls: shows ≤band totals (each tier includes the lower ones)
    // - tierCardEls: shows non-overlapping per-tier cohorts (sum to total)
    const BANDS = [30, 40, 50, 60, 70, 80, 100];
    const cumulativeCardEls = BANDS.reduce((acc, b) => {
      acc[b] = document.getElementById('statGap' + b);
      return acc;
    }, {});
    const tierCardEls = BANDS.reduce((acc, b) => {
      acc[b] = document.getElementById('statTierGap' + b);
      return acc;
    }, {});

    // ── Source 1: ACS-derived (7 bands) ────────────────────────────
    // F30: prefer PLACE-level data when a place/CDP is selected — otherwise
    // a place (e.g. New Castle, ~1,800 HH) showed its COUNTY's gap (Garfield,
    // 7,831 — more "households" than the town has people). The place file
    // (co_ami_gap_by_place.json) has the same schema keyed by GEOID.
    let acsRecord = null;
    let acsIsPlace = false;
    const wantPlace = selectedGeo && (selectedGeo.type === 'place' || selectedGeo.type === 'cdp') && selectedGeo.geoid;
    if (wantPlace && placeAmiData && placeAmiData.places) {
      acsRecord = placeAmiData.places[selectedGeo.geoid] || null;
      if (acsRecord) acsIsPlace = true;
    }
    if (!acsRecord && acsAmiData && Array.isArray(acsAmiData.counties) && countyFips5) {
      const fipsTarget = String(countyFips5).padStart(5, '0');
      for (let i = 0; i < acsAmiData.counties.length; i++) {
        if (acsAmiData.counties[i].fips === fipsTarget) {
          acsRecord = acsAmiData.counties[i];
          break;
        }
      }
    }
    // Read cumulative households-at-or-below and units-affordable-at-or-below
    // straight from the file (both county and place files carry these two
    // fields — using them avoids the files' opposite sign conventions on the
    // precomputed `gap_*` field: county stores units−households, place stores
    // households−units). We then derive the per-band gap by DIFFERENCING these
    // in the computation loop rather than netting the cumulative totals
    // directly: netting cumulative supply against cumulative demand wrongly
    // assumes a unit affordable at a higher AMI can absorb a lower-AMI
    // household, which produced a non-monotonic "cumulative shortfall" (New
    // Castle ≤30% = 190 but ≤40% = 111). Per-band matching + clamping ≥0 keeps
    // it monotonic.
    const acsHhAt = (band) => {
      if (!acsRecord) return null;
      const hh = acsRecord.households_le_ami_pct;
      if (!hh || hh[String(band)] == null) return null;
      const v = Number(hh[String(band)]);
      return Number.isFinite(v) ? v : null;
    };
    const acsUnitsAt = (band) => {
      if (!acsRecord) return 0;
      const un = acsRecord.units_priced_affordable_le_ami_pct;
      if (!un || un[String(band)] == null) return 0;
      const v = Number(un[String(band)]);
      return Number.isFinite(v) ? v : 0;
    };

    // ── Source 2: CHAS fallback (4 tiers, mapped to 4 of 7 bands) ──
    let chasRecord = null;
    if (chasData && countyFips5 && chasData.counties) {
      const fips5 = String(countyFips5).padStart(5, '0');
      chasRecord = chasData.counties[fips5] || null;
    }
    if (!chasRecord && chasData && chasData.state) chasRecord = chasData.state;
    const chasByAmi = (chasRecord && chasRecord.renter_hh_by_ami) || {};
    const isStub = !!(chasData && chasData.meta && chasData.meta.note && chasData.meta.note.includes('Stub'));
    // CHAS only has 4 bands; we expose them at 30/50/80/100 and leave
    // 40/60/70 blank in the CHAS path. The chasLooksSuspect heuristic is
    // identical to the one introduced in PR #881.
    const chasGap = {
      30:  (chasByAmi.lte30    && chasByAmi.lte30.cost_burdened)     || null,
      50:  (chasByAmi['31to50'] && chasByAmi['31to50'].cost_burdened) || null,
      80:  (chasByAmi['51to80'] && chasByAmi['51to80'].cost_burdened) || null,
      100: (chasByAmi['81to100'] && chasByAmi['81to100'].cost_burdened) || null,
    };
    const lte30Total = (chasByAmi.lte30 && Number(chasByAmi.lte30.total)) || 0;
    // Defense-in-depth against ETL drift; the real gate is the statewide
    // assertion at the bottom of scripts/fetch_chas.py. Two adjustments
    // from the original heuristic so genuine tiny rural counties (e.g.
    // Jackson 08057, ~1,400 pop) stop tripping false positives:
    //   - cond #2: lte30Total > 25 (was > 0). Census privacy-suppresses
    //     cost-burden sub-cells when the lte30 cohort is in the single
    //     digits, so cb30 = 0 there is a real artifact, not an ETL bug.
    //   - cond #3: add `> 100` absolute floor on the mid-AMI burden sum.
    //     Without it, lte30Total = 4 makes the * 5 threshold = 20 and
    //     trivially fires on real Census data. The original Table 9
    //     misread produced thousands-scale mid-AMI counts that easily
    //     clear a 100 floor.
    const midAmiBurdenSum = (chasGap[50] || 0) + (chasGap[80] || 0);
    const chasLooksSuspect = (
      !chasRecord ||
      (lte30Total > 25 && chasGap[30] === 0) ||
      (lte30Total > 0 && lte30Total < 100 && midAmiBurdenSum > 100 && midAmiBurdenSum > lte30Total * 5)
    );

    // ── Source pick ───────────────────────────────────────────────
    // ACS is preferred when populated (7-band granularity); CHAS fills
    // in only when ACS is unavailable AND CHAS doesn't trip the sanity
    // check.
    const acsAvailable = acsRecord && BANDS.some(b => acsHhAt(b) != null);
    const usingAcs = acsAvailable;
    const usingChasFallback = !acsAvailable && chasRecord && !chasLooksSuspect;

    const fmt = (U().fmtNum) || ((n) => n.toLocaleString());

    // Compute TWO complementary measures per band ("show both"):
    //   DEMAND  — households needing affordable units at each tier. The
    //     headline rows. Always monotonic, never zero where households exist,
    //     and doesn't depend on the (rougher) supply estimate.
    //       demandCum[band]  = households earning ≤band% AMI (cumulative)
    //       demandTier[band] = households within that single band (cohort)
    //   NET GAP — demand minus the units already priced affordable to it,
    //     matched PER BAND and clamped ≥0 (a surplus of higher-rent units
    //     can't house a lower-income family), then cumulated → monotonic.
    //     Shown as a secondary line, and mirrored to downstream consumers as
    //     "units needed" (what actually has to be built).
    const demandCum = {}, demandTier = {}, gapCum = {}, gapTier = {};
    let prevDemand = 0, prevGapCum = 0, prevHh = 0, prevUn = 0;
    BANDS.forEach((band) => {
      // ── DEMAND (headline) ──
      let dCum = null, dTier = null;
      if (usingAcs) {
        const hh = acsHhAt(band);
        if (hh != null) { dCum = hh; dTier = Math.max(0, hh - prevDemand); prevDemand = hh; }
      } else if (usingChasFallback) {
        // CHAS cohorts are cost-burdened households — a demand measure.
        const cohort = chasGap[band];
        if (cohort != null) { dTier = Math.max(0, cohort); prevDemand += dTier; dCum = prevDemand; }
        else if (prevDemand > 0) { dCum = prevDemand; }  // 40/60/70 carry the running total
      }
      demandCum[band]  = (dCum  != null && Number.isFinite(dCum))  ? dCum  : null;
      demandTier[band] = (dTier != null && Number.isFinite(dTier)) ? dTier : null;

      // ── NET GAP (secondary / downstream) ──
      let gTier = null;
      if (usingAcs) {
        const hh = acsHhAt(band);
        if (hh != null) {
          const un = acsUnitsAt(band);
          gTier = Math.max(0, (hh - prevHh) - (un - prevUn));
          prevHh = hh; prevUn = un;
        }
      } else if (usingChasFallback) {
        // No supply data at CHAS granularity → gap equals the demand cohort.
        gTier = chasGap[band] != null ? Math.max(0, chasGap[band]) : null;
      }
      gapTier[band] = (gTier != null && Number.isFinite(gTier)) ? gTier : null;
      let gCum = null;
      if (gapTier[band] != null) { prevGapCum += gapTier[band]; gCum = prevGapCum; }
      else if (usingChasFallback && prevGapCum > 0) { gCum = prevGapCum; }
      gapCum[band] = gCum;

      // Populate the two HEADLINE rows with DEMAND.
      const cumEl = cumulativeCardEls[band];
      if (cumEl) cumEl.textContent = (demandCum[band] != null) ? fmt(demandCum[band]) : '—';
      const tierEl = tierCardEls[band];
      if (tierEl) tierEl.textContent = (demandTier[band] != null) ? fmt(demandTier[band]) : '—';
    });

    // Secondary "net of existing affordable supply" line.
    const netLineEl = document.getElementById('hnaGapNetLine');
    if (netLineEl) {
      const lastNonNull = (obj) => { const vals = BANDS.map(b => obj[b]).filter(v => v != null); return vals.length ? vals[vals.length - 1] : null; };
      const totalGap    = gapCum[100]    != null ? gapCum[100]    : lastNonNull(gapCum);
      const totalDemand = demandCum[100] != null ? demandCum[100] : lastNonNull(demandCum);
      if (usingAcs && totalGap != null && totalDemand != null) {
        const parts = BANDS.filter(b => gapTier[b] != null && gapTier[b] > 0)
          .map(b => '≤' + b + '% +' + fmt(gapTier[b]));
        netLineEl.innerHTML =
          '<strong>Net of existing affordable supply:</strong> ~' + fmt(totalGap) +
          ' of these ' + fmt(totalDemand) + ' households remain unserved at ≤100% AMI' +
          (parts.length ? ' <span style="color:var(--muted)">— shortfall concentrated at ' + parts.join(', ') + '</span>' : '') +
          '. <span style="color:var(--muted)">Supply estimated from ACS B25063 gross-rent distribution; treat as directional.</span>';
      } else if (usingChasFallback) {
        netLineEl.innerHTML =
          '<span style="color:var(--muted)">Existing-supply data isn’t published at CHAS granularity, so the figures above are cost-burdened households (demand). A net-of-supply gap needs ACS place/county data.</span>';
      } else {
        netLineEl.innerHTML = '';
      }
    }

    // Cost-burdened renter COUNT — a complementary "current pressure" measure
    // alongside the income-based demand. The cards above size who NEEDS
    // affordable units by income tier; this line sizes who is currently HURT
    // by cost (renters paying >30% of income on rent), so the two counts can
    // be read together as demand-side vs cost-side.
    const burdenEl = document.getElementById('hnaGapBurdenContext');
    if (burdenEl) {
      // Profile is passed in from the controller (the call site has it loaded);
      // fall back to state.current.profile for callers that don't pass it.
      const prof = profile || (window.HNAState && window.HNAState.state && window.HNAState.state.current && window.HNAState.state.current.profile) || null;
      const renterHHs = prof && Number.isFinite(Number(prof.DP04_0047E)) ? Number(prof.DP04_0047E) : null;
      const burdenPct = (prof && U().rentBurden30Plus) ? U().rentBurden30Plus(prof) : null;
      if (renterHHs != null && renterHHs > 0 && burdenPct != null && Number.isFinite(burdenPct)) {
        const burdened = Math.round(renterHHs * burdenPct / 100);
        burdenEl.innerHTML =
          '<strong>Current cost pressure:</strong> ~' + fmt(burdened) + ' of ' + fmt(renterHHs) +
          ' renter households (' + burdenPct.toFixed(1) + '%) are rent-burdened today (paying &gt;30% of income on rent). ' +
          '<span style="color:var(--muted)">Cost-side complement to the income-side demand above — different lens on the same housing-need story.</span>';
      } else {
        burdenEl.innerHTML = '';
      }
    }

    // Heatmap bar segments use the per-tier DEMAND cohorts (the second card
    // row) so widths sum to 100% and every populated band shows.
    const cardValues = demandTier;

    // Confidence badge
    if (confEl) {
      if (usingAcs) {
        // F30: flag place-level vs county-fallback so a place that lacks
        // place-level data (and thus shows its county's gap) is honest.
        const placeFellBackToCounty = wantPlace && !acsIsPlace;
        confEl.textContent = acsIsPlace ? 'ACS-derived (place)'
                            : placeFellBackToCounty ? 'County (no place data)'
                            : 'ACS-derived';
        confEl.className   = 'data-reliability-badge ' + (placeFellBackToCounty ? 'drb--warn' : 'drb--ok');
        confEl.title       = (acsIsPlace
            ? 'Place-level shortfall for the selected jurisdiction (Census ACS B19001 + B25063 at place geography vs HUD 2025 income limits). '
            : placeFellBackToCounty
            ? 'No place-level AMI-gap data for this jurisdiction — showing its CONTAINING COUNTY’s shortfall as a fallback. Place totals will be smaller. '
            : 'Cumulative shortfall computed from ACS B19001 household income + B25063 gross rent against HUD 2025 income limits. ')
          + '7-band granularity (30/40/50/60/70/80/100% AMI).';
      } else if (usingChasFallback) {
        confEl.textContent = 'HUD CHAS';
        confEl.className   = 'data-reliability-badge drb--ok';
        confEl.title       = 'HUD CHAS ' + ((chasData && chasData.meta && chasData.meta.vintage) || '') + '. CHAS bands are coarser than ACS: ≤30, 31-50, 51-80, 81-100 — intermediate bands (40, 60, 70%) shown as "—".';
      } else if (chasLooksSuspect) {
        confEl.textContent = 'Review CHAS';
        confEl.className   = 'data-reliability-badge drb--warn';
        confEl.title       = '≤30% AMI row looks unreliable (known fetch_chas.py ETL bug) and no ACS-derived fallback is available for this geography.';
      } else if (isStub) {
        confEl.textContent = 'Estimated';
        confEl.className   = 'data-reliability-badge drb--warn';
        confEl.title       = 'Gap derived from ACS cost-burden rates (stub). Actual CHAS data loads via workflow.';
      } else {
        confEl.textContent = '—';
        confEl.className   = 'data-reliability-badge drb--warn';
      }
    }

    // ── Severity bar (heatmap legend across the 7 bands) ───────────
    // Single horizontal gradient with the 7 cumulative shortfall bands
    // shown as a high-contrast heatmap (deep red at ≤30% — most severe —
    // to muted blue at ≤100% — least severe / total cumulative). Previous
    // 3-color bar used --bad / --warn / --accent2 which rendered too
    // close in saturation; replaced with explicit hex codes from a
    // sequential heatmap palette (ColorBrewer YlOrRd / OrRd).
    const HEATMAP = {
      30:  '#7f1416',   // crimson — extremely low
      40:  '#b32024',   // deep red — deeply affordable
      50:  '#e23f25',   // red-orange — very low
      60:  '#f57a30',   // orange — low (LIHTC threshold)
      70:  '#f9a949',   // amber — moderate
      80:  '#fad96a',   // yellow — workforce
      100: '#4a90d9',   // muted blue — total cumulative (visually distinct from the gradient)
    };
    if (barEl) {
      // Build segments using the SAME incremental cohort values shown in
      // the cards. Bar widths are proportional to each tier's share of
      // the total cumulative gap (sum of cohorts = total), so the stacked
      // bar sums to 100% by construction.
      const segments = BANDS.map(band => {
        const val = cardValues[band];
        return { band, val, color: HEATMAP[band], hasData: val != null && Number.isFinite(val) && val > 0 };
      });
      const total = segments.reduce((s, seg) => s + (seg.hasData ? seg.val : 0), 0);
      if (total > 0) {
        const blocks = segments.map(s => {
          if (!s.hasData) return '';
          const widthPct = Math.max(1, Math.round((s.val / total) * 100));
          return '<div style="flex:0 0 ' + widthPct + '%;background:' + s.color + ';min-width:1px;" ' +
            'title="' + s.band + '% AMI band: ' + fmt(s.val) + ' households need units at this tier"></div>';
        }).join('');
        const labels = segments.map(s =>
          '<span style="display:inline-flex;align-items:center;gap:4px;">' +
            '<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + s.color + ';"></span>' +
            s.band + '% (' + (s.hasData ? fmt(s.val) : '—') + ')' +
          '</span>'
        ).join('');
        const sourceNote = usingAcs
          ? 'ACS-derived (B19001 × B25063 vs. HUD 2025 limits) · per-tier cohorts'
          : usingChasFallback
            ? 'HUD CHAS · only 30/50/80/100% tiers have data (40/60/70 blank)'
            : '';
        barEl.innerHTML =
          '<div style="display:flex;height:10px;border-radius:4px;overflow:hidden;background:var(--bg2);border:1px solid var(--border);" ' +
            'role="img" aria-label="AMI gap heatmap — per-tier cohorts across 7 income bands">' + blocks + '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px 14px;font-size:.72rem;color:var(--muted);margin-top:6px;">' +
            labels +
          '</div>' +
          '<div style="font-size:.78rem;color:var(--text);margin-top:8px;padding-top:6px;border-top:1px solid var(--border);">' +
            '<strong>Total households needing affordable units ≤100% AMI:</strong> ' + fmt(total) +
          '</div>' +
          (sourceNote
            ? '<div style="font-size:.72rem;color:var(--muted);margin-top:2px;font-style:italic;">' + sourceNote + '</div>'
            : '');
      } else if (chasLooksSuspect) {
        barEl.innerHTML =
          '<p style="margin:.5rem 0 0;padding:.55rem .7rem;border:1px solid color-mix(in srgb,var(--warn) 30%,transparent);' +
          'background:color-mix(in srgb,var(--warn) 6%,transparent);border-radius:6px;font-size:.78rem;color:var(--muted)">' +
          '<strong style="color:var(--warn)">⚠ Data quality note:</strong> ' +
          'no ACS-derived gap available for this geography, and the cached HUD CHAS row for this county didn\'t pass the ≤30% AMI sanity check ' +
          '(known fetch_chas.py ETL bug — being repaired). Cross-check with the ' +
          '<a href="https://www.huduser.gov/portal/datasets/cp.html" target="_blank" rel="noopener" style="color:var(--accent)">HUD CHAS Query Tool</a>.' +
          '</p>';
      } else {
        barEl.innerHTML = '';
      }
    }

    // Mirror values onto HNAState for downstream consumers.
    //
    // Backward-compatibility contract — lihtc-deal-predictor.js,
    // pma-ui-controller.js, and hna-market-bridge.js treat
    // ami{30,50,60}UnitsNeeded as the NON-OVERLAPPING cohorts ≤30 / 31-50
    // / 51-60 (the original CHAS Table 9 buckets) and sum them. ACS data
    // is cumulative (≤band includes lower bands), so we derive the
    // cohorts by differencing to keep that contract intact. New bands
    // (40/70/80/100) are exposed only as Cumulative — no UnitsNeeded
    // alias — to avoid ambiguity with the original 30/50/60 contract.
    //
    //   ami30UnitsNeeded   = HHs in 0-30% AMI cohort                  (= cum(30))
    //   ami50UnitsNeeded   = HHs in 31-50% cohort                     (= cum(50) - cum(30))
    //   ami60UnitsNeeded   = HHs in 51-60% cohort                     (= cum(60) - cum(50))
    //   ami{N}Cumulative   = raw cumulative ≤N% AMI gap (all 7 bands)
    //   totalUndersupply   = ami100Cumulative
    if (window.HNAState) {
      const mirror = { sourceKind: usingAcs ? 'acs-derived' : (usingChasFallback ? 'chas' : 'unavailable') };
      // Downstream "units needed" = the NET GAP (what must be built), i.e. the
      // monotonic per-band-matched cumulative — not raw demand.
      const cum = (band) => (gapCum[band] != null && Number.isFinite(gapCum[band])) ? gapCum[band] : 0;
      BANDS.forEach(band => { mirror['ami' + band + 'Cumulative'] = cum(band); });
      // Backward-compat 30/50/60 cohorts (non-overlapping) for existing consumers
      mirror.ami30UnitsNeeded = cum(30);
      mirror.ami50UnitsNeeded = Math.max(0, cum(50) - cum(30));
      mirror.ami60UnitsNeeded = Math.max(0, cum(60) - cum(50));
      // Total = cumulative gap at the highest band (≤100% AMI)
      mirror.totalUndersupply = cum(100);
      window.HNAState.state.affordabilityGap = mirror;
    }

    panel.hidden = false;
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

  /**
   * Housing Needs Scorecard — v2 methodology.
   *
   * Replaces the v1 thresholded 45/30/25 blend (which had arbitrary
   * weights, no owner cost burden, and distorted resort markets) with
   * a transparent **percentile-normalised 4-component composite**.
   * Each component contributes 0–25 points based on its statewide
   * percentile rank, so the composite is 0–100 = "Colorado housing-need
   * percentile":
   *
   *   A. Tenure-Blended Cost Burden  (renter+owner CHAS cb30, weighted by HH counts)
   *   B. Deep Affordability Need     (≤30% AMI share of <100% renters)
   *   C. Affordability Pressure       (home price ÷ HHI — resort-aware)
   *   D. Worst-Case Need              (HUD-aligned: renter cb50 share)
   *
   * Every threshold + weight is documented in the inline methodology
   * disclosure rendered alongside the cards.
   */

  // Cached statewide distributions for percentile lookups. Built lazily on
  // first call and stamped with the CHAS file's generated timestamp so a
  // data refresh invalidates the cache automatically.
  var _scorecardDistCache = null;
  function _buildScorecardDistributions(chasData, econData) {
    const stamp =
      (chasData && chasData.meta && chasData.meta.generated) +
      '|' +
      (econData && econData.updated);
    if (_scorecardDistCache && _scorecardDistCache._stamp === stamp) {
      return _scorecardDistCache;
    }
    const dist = { blendedBurden: [], deepNeed: [], affordPressure: [], worstCaseShare: [], _stamp: stamp };
    if (!chasData || !chasData.counties) { _scorecardDistCache = dist; return dist; }

    Object.values(chasData.counties).forEach(rec => {
      const s = rec.summary || {};
      const byAmi = rec.renter_hh_by_ami || {};
      const renterHH = Number(s.total_renter_hh) || 0;
      const ownerHH  = Number(s.total_owner_hh)  || 0;
      const totalHH  = renterHH + ownerHH;
      // A — tenure-blended burden
      if (totalHH > 0 && s.pct_renter_cb30 != null && s.pct_owner_cb30 != null) {
        const blended = (Number(s.pct_renter_cb30) * renterHH + Number(s.pct_owner_cb30) * ownerHH) / totalHH;
        dist.blendedBurden.push(blended);
      }
      // B — deep-need share (lte30 of ≤100% AMI universe, dropping 100plus)
      const lte30Tot = (byAmi.lte30 && Number(byAmi.lte30.total)) || 0;
      const denom = ['lte30','31to50','51to80','81to100']
        .reduce((sum, k) => sum + ((byAmi[k] && Number(byAmi[k].total)) || 0), 0);
      if (denom > 0) dist.deepNeed.push(lte30Tot / denom);
      // D — worst-case need (HUD-aligned: severely-burdened renter share)
      if (renterHH > 0 && s.pct_renter_cb50 != null) {
        dist.worstCaseShare.push(Number(s.pct_renter_cb50));
      }
    });
    // C — affordability pressure (keyed by county name in econData)
    if (econData && econData.counties) {
      Object.values(econData.counties).forEach(c => {
        if (c && c.affordability_index != null) {
          dist.affordPressure.push(Number(c.affordability_index));
        }
      });
    }
    // Sort each distribution for percentile lookup
    ['blendedBurden','deepNeed','affordPressure','worstCaseShare'].forEach(k => {
      dist[k].sort((a, b) => a - b);
    });
    _scorecardDistCache = dist;
    return dist;
  }

  // Percentile rank of `value` within sortedArr (0..1, ties get 0.5
  // weight). Returns null if data unavailable.
  function _percentile(sortedArr, value) {
    if (!sortedArr || !sortedArr.length || value == null || !Number.isFinite(Number(value))) return null;
    const v = Number(value);
    let below = 0, equal = 0;
    for (let i = 0; i < sortedArr.length; i++) {
      if (sortedArr[i] < v) below++;
      else if (sortedArr[i] === v) equal++;
    }
    return (below + 0.5 * equal) / sortedArr.length;
  }

  function _scorecardCard(label, rawValueText, percentile, points, helperText) {
    // Severity tied to the component's contribution (0..25). The same
    // 4-band scheme used for the composite below.
    let sev = '';
    if (points >= 17.5) sev = 'var(--bad,#dc2626)';
    else if (points >= 12.5) sev = 'var(--warn,#d97706)';
    else if (points >= 7.5) sev = 'var(--accent,#1d4ed8)';
    else sev = 'var(--good,#16a34a)';

    const pctText = percentile != null
      ? 'CO p' + Math.round(percentile * 100) + ' · ' + Math.round(points) + '/25 pts'
      : 'No CO peer data';

    return '<div style="padding:.65rem;border:1px solid var(--border);border-radius:8px;background:var(--bg2);">' +
      '<div style="font-size:.74rem;color:var(--muted);font-weight:600">' + escHtml(label) + '</div>' +
      '<div style="font-size:1.3rem;font-weight:800;color:' + sev + ';font-variant-numeric:tabular-nums;line-height:1.1;margin-top:2px">' + escHtml(rawValueText) + '</div>' +
      '<div style="font-size:.7rem;color:var(--muted);margin-top:3px">' + escHtml(pctText) + '</div>' +
      (helperText ? '<div style="font-size:.66rem;color:var(--muted);margin-top:4px;line-height:1.35;font-style:italic">' + escHtml(helperText) + '</div>' : '') +
    '</div>';
  }

  function renderHnaScorecardPanel(geoid) {
    const container = document.getElementById('hnaScorecardPanel');
    if (!container) return;
    if (!geoid) { container.style.display = 'none'; return; }

    const state = S() && S().state;
    const chasData = state && state.chasData;
    const econData = state && state.blsEconData;
    const profile  = state && state.lastProfile;
    if (!chasData) { container.style.display = 'none'; return; }

    // County FIPS resolution — for state-level we want the statewide row;
    // for places/CDPs we use the containing county per existing behaviour.
    const countyFips = String(geoid).length === 5 ? geoid : (state.contextCounty || null);
    if (!countyFips) { container.style.display = 'none'; return; }
    const countyRec = (chasData.counties || {})[countyFips];
    if (!countyRec || !countyRec.summary) { container.style.display = 'none'; return; }

    const dist = _buildScorecardDistributions(chasData, econData);
    const s = countyRec.summary;
    const byAmi = countyRec.renter_hh_by_ami || {};
    const countyName = countyRec.name || '';

    // ── Component A — Tenure-Blended Cost Burden ────────────────────
    const renterHH = Number(s.total_renter_hh) || 0;
    const ownerHH  = Number(s.total_owner_hh)  || 0;
    const totalHH  = renterHH + ownerHH;
    const renterCb30 = s.pct_renter_cb30 != null ? Number(s.pct_renter_cb30) : null;
    const ownerCb30  = s.pct_owner_cb30  != null ? Number(s.pct_owner_cb30)  : null;
    const blendedBurden = (totalHH > 0 && renterCb30 != null && ownerCb30 != null)
      ? (renterCb30 * renterHH + ownerCb30 * ownerHH) / totalHH
      : null;

    // ── Component B — Deep Affordability Need ───────────────────────
    const lte30Tot = (byAmi.lte30 && Number(byAmi.lte30.total)) || 0;
    const denomB = ['lte30','31to50','51to80','81to100']
      .reduce((sum, k) => sum + ((byAmi[k] && Number(byAmi[k].total)) || 0), 0);
    const deepNeed = denomB > 0 ? lte30Tot / denomB : null;

    // ── Component C — Affordability Pressure (resort-aware) ─────────
    // co-county-economic-indicators.json is keyed by county NAME (no FIPS).
    let affordPressure = null;
    if (econData && econData.counties) {
      const rec = econData.counties[countyName] ||
                  econData.counties[countyName.replace(/\s+County$/i, '')] ||
                  econData.counties[countyName + ' County'];
      if (rec && rec.affordability_index != null) {
        affordPressure = Number(rec.affordability_index);
      }
    }

    // ── Component D — Worst-Case Need (HUD-aligned) ─────────────────
    const worstCase = s.pct_renter_cb50 != null ? Number(s.pct_renter_cb50) : null;

    // ── Percentile ranks within Colorado ────────────────────────────
    const pctA = _percentile(dist.blendedBurden,   blendedBurden);
    const pctB = _percentile(dist.deepNeed,         deepNeed);
    const pctC = _percentile(dist.affordPressure,  affordPressure);
    const pctD = _percentile(dist.worstCaseShare,  worstCase);

    // Each component contributes 0–25 points by percentile rank.
    const scoreA = pctA != null ? pctA * 25 : 0;
    const scoreB = pctB != null ? pctB * 25 : 0;
    const scoreC = pctC != null ? pctC * 25 : 0;
    const scoreD = pctD != null ? pctD * 25 : 0;
    const composite = Math.round(scoreA + scoreB + scoreC + scoreD);
    const nMissing = [pctA, pctB, pctC, pctD].filter(p => p == null).length;

    // Composite severity bands (peer-normalised, percentile-style)
    let compSev, compLabel;
    if (composite >= 70)      { compSev = 'var(--bad,#dc2626)';  compLabel = 'Highest need'; }
    else if (composite >= 50) { compSev = 'var(--warn,#d97706)'; compLabel = 'Elevated';     }
    else if (composite >= 30) { compSev = 'var(--accent,#1d4ed8)'; compLabel = 'Moderate';   }
    else                       { compSev = 'var(--good,#16a34a)'; compLabel = 'Lower';       }

    // Format helpers
    const pctStr = (v, digits) => v != null && Number.isFinite(v) ? (v * 100).toFixed(digits != null ? digits : 1) + '%' : '—';
    const numStr = (v, digits) => v != null && Number.isFinite(v) ? Number(v).toFixed(digits != null ? digits : 1) : '—';

    container.style.display = 'block';
    container.innerHTML =
      '<h2 style="font-size:1.05rem;margin:0 0 .35rem">Housing Needs Scorecard <span style="font-weight:400;color:var(--muted);font-size:.78rem">— v2 methodology</span></h2>' +
      '<p style="font-size:.78rem;color:var(--muted);margin:0 0 .75rem">' +
        'Each county is scored against the rest of Colorado on four signals. Composite is 0–100 = ' +
        '<strong>where this county sits in CO\'s distribution</strong> (100 = top of every measure). ' +
        'Includes both renter and owner cost burden, and surfaces resort-area pressure honestly via percentile rank.' +
      '</p>' +

      // Composite headline
      '<div style="display:flex;align-items:center;gap:14px;padding:10px 14px;margin-bottom:10px;border:1px solid var(--border);border-radius:10px;background:color-mix(in oklab,var(--card) 92%,var(--bg2) 8%);">' +
        '<div style="flex:0 0 auto"><div style="font-size:.72rem;color:var(--muted);font-weight:600">Overall need</div>' +
          '<div style="font-size:1.9rem;font-weight:900;color:' + compSev + ';font-variant-numeric:tabular-nums;line-height:1">' + composite + '<span style="font-size:1rem;font-weight:700;color:var(--muted)">/100</span></div></div>' +
        '<div style="flex:1 1 auto"><div style="font-size:.9rem;font-weight:700;color:' + compSev + '">' + compLabel + '</div>' +
          '<div style="font-size:.74rem;color:var(--muted);margin-top:2px">' +
            'Percentile rank across 4 components vs. all 64 CO counties' +
            (nMissing > 0 ? ' · ' + nMissing + ' of 4 components unavailable for this geography' : '') +
          '</div></div>' +
      '</div>' +

      // 4 component cards
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.6rem;">' +
        _scorecardCard(
          'A · Cost burden (blended)',
          pctStr(blendedBurden),
          pctA, scoreA,
          (renterCb30 != null ? 'Renter ' + pctStr(renterCb30) : '—') +
          ' · ' +
          (ownerCb30 != null ? 'Owner ' + pctStr(ownerCb30) : '—') +
          ' (weighted by HH counts)'
        ) +
        _scorecardCard(
          'B · Deep-need share',
          pctStr(deepNeed),
          pctB, scoreB,
          'Renters at ≤30% AMI as share of all ≤100% AMI renters'
        ) +
        _scorecardCard(
          'C · Affordability pressure',
          numStr(affordPressure) + 'x',
          pctC, scoreC,
          'Median home price ÷ median household income · resort-aware'
        ) +
        _scorecardCard(
          'D · Worst-case need',
          pctStr(worstCase),
          pctD, scoreD,
          'Renters severely burdened (>50% income on housing) — HUD WCN signal'
        ) +
      '</div>' +

      // F184 — Methodology disclosure default-collapsed per site-wide policy.
      '<details style="margin-top:12px;border:1px solid var(--border);border-radius:8px;padding:0">' +
        '<summary style="cursor:pointer;font-weight:700;padding:.55rem .75rem;font-size:.85rem">How is this calculated?</summary>' +
        '<div style="padding:.5rem .85rem .75rem;font-size:.8rem;line-height:1.55;color:var(--text)">' +
          '<p style="margin:.25rem 0"><strong>Four components, each scored 0–25 by percentile rank within Colorado.</strong> Higher percentile = closer to CO\'s most-need-acute counties. Composite = sum of the four scores (0–100).</p>' +
          '<ul style="margin:.4rem 0 .5rem;padding-left:18px">' +
            '<li><strong>A · Cost burden (blended).</strong> <code>(renter_cb30 × renter_HH + owner_cb30 × owner_HH) ÷ total_HH</code>. Single % reflecting ALL households\' cost burden, weighted by tenure mix. <em>Why blend?</em> Pure renter burden misses owner-heavy markets; this version doesn\'t. Source: <a href="https://www.huduser.gov/portal/datasets/cp.html" target="_blank" rel="noopener" class="hna-source-link">HUD CHAS 2018-2022</a> Table 7.</li>' +
            '<li><strong>B · Deep-need share.</strong> <code>renters_at_≤30%_AMI ÷ renters_at_≤100%_AMI</code>. Drops the 100+ tier (high-income cohort) from the denominator so the signal isn\'t diluted by wealthy renters. Source: <a href="https://www.huduser.gov/portal/datasets/cp.html" target="_blank" rel="noopener" class="hna-source-link">HUD CHAS</a> Table 9.</li>' +
            '<li><strong>C · Affordability pressure.</strong> <code>median_home_price ÷ median_household_income</code>. Resort and high-cost markets (Pitkin 11.1x, Summit 8.6x) score high — appropriately — because they ARE expensive relative to local incomes. This is the lever percentile-normalisation pulls so resort distress surfaces without dwarfing urban distress. Source: <a href="https://data.census.gov/" target="_blank" rel="noopener" class="hna-source-link">ACS B19013 + B25077</a>.</li>' +
            '<li><strong>D · Worst-case need.</strong> Share of renters paying &gt;50% of income on housing — directly maps to <a href="https://www.huduser.gov/portal/publications/affhsg/wc_HsgNeeds25.html" target="_blank" rel="noopener" class="hna-source-link">HUD\'s Worst Case Housing Needs</a> framework. Source: HUD CHAS Table 7 (renter_cb50 share).</li>' +
          '</ul>' +
          '<p style="margin:.4rem 0 .25rem"><strong>Severity bands:</strong> Highest need ≥70 · Elevated ≥50 · Moderate ≥30 · Lower &lt;30. Each card color matches its 0–25 contribution.</p>' +
          '<p style="margin:.25rem 0;color:var(--muted);font-size:.74rem"><strong>What this is NOT:</strong> a state-of-the-art econometric model. It\'s a transparent screening composite designed for early-stage LIHTC/HNA work. The four components are documented above; cross-check with primary HUD CHAS and Census ACS data before citing in formal needs assessments.</p>' +
        '</div>' +
      '</details>';
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

  // F28-2: lazily-loaded context for the income-band "resort distortion" note.
  //   _amiCtx.place[geoid]  → { ami_4person, place_name }  (county AMI applied)
  //   _amiCtx.median[geoid] → place median household income
  // Both files are small + cached after first load; the note enriches
  // asynchronously and is a no-op if either fetch fails.
  let _amiCtxCache = null;
  function _loadAmiCtx() {
    if (_amiCtxCache) return _amiCtxCache;
    _amiCtxCache = Promise.all([
      fetch('data/co_ami_gap_by_place.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('data/hna/ranking-index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([gap, rank]) => {
      const place = (gap && gap.places) || {};
      const median = {};
      if (rank) {
        const rows = Array.isArray(rank.rankings) ? rank.rankings : Object.values(rank.rankings || {});
        rows.forEach((r) => {
          const m = r && r.metrics && r.metrics.median_hh_income;
          if (r && r.geoid && m) median[r.geoid] = m;
        });
      }
      return { place, median };
    });
    return _amiCtxCache;
  }

  function _appendAmiContextNote(noteEl, geoid, placeLabel) {
    _loadAmiCtx().then((ctx) => {
      if (!ctx || !noteEl || !noteEl.isConnected) return;
      const rec = ctx.place[geoid];
      const ami = rec && rec.ami_4person;
      const median = ctx.median[geoid];
      if (!ami) return;
      // Guard against duplicate appends: renderChasAffordabilityGap can fire
      // twice (extended-analysis pre-pass + CHAS-loaded pass), and both kick
      // off this async enrichment. Remove any prior instance first.
      const prior = noteEl.querySelector('.f28-ami-ctx');
      if (prior) prior.remove();
      const line = document.createElement('div');
      line.className = 'f28-ami-ctx';
      line.style.cssText = 'margin-top:.35rem;font-size:.74rem;color:var(--muted);';
      let txt = 'Income-band gaps are measured against the county’s HUD 4-person AMI of $' +
        Math.round(ami).toLocaleString() + ' (HUD publishes AMI only at county level). ';
      // Resort-distortion flag: when local median is well below the county AMI
      // ceiling, the band counts overstate local-wage need even though they're
      // LIHTC-correct (a deal here uses the county AMI).
      if (median) {
        txt += placeLabel + '’s median household income is $' + Math.round(median).toLocaleString() + '. ';
        if (median < 0.9 * ami) {
          txt += 'Because local median sits well below the county AMI (typical in resort-adjacent ' +
                 'counties), the gap reflects the regional AMI ceiling and reads needier than local ' +
                 'wages alone would imply — correct for LIHTC eligibility, but worth this context.';
        }
      }
      line.textContent = txt;
      noteEl.appendChild(line);
    }).catch(() => { /* non-fatal */ });
  }

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
          // F28: was "area-weighted" — now population-weighted so small towns
          // in large rural tracts aren't collapsed (New Castle was 24 HH).
          ' Computed by population-weighted apportionment of the census tracts inside ' + placeLabel + '. '
          + 'Accurate even for jurisdictions that span county lines (Aurora, Erie, etc.) '
          + 'where the primary-county fallback would mis-state burden rates.'
        ));
        // F28-3: small-sample (wide ACS margin-of-error) flag for tiny places.
        try {
          const _pc = (window.PlaceChas && window.PlaceChas.lookup) ? window.PlaceChas.lookup(selectedGeo.geoid) : null;
          const _hh = _pc && _pc.summary ? (_pc.summary.total_renter_hh + _pc.summary.total_owner_hh) : null;
          if (_hh != null && _hh < 1000) {
            const moe = document.createElement('div');
            moe.style.cssText = 'margin-top:.35rem;font-size:.74rem;color:var(--muted);';
            moe.textContent = '⚠ Small sample (~' + Math.round(_hh).toLocaleString() +
              ' households): 5-year ACS estimates for places this size carry wide margins of error — read tiers as directional, not precise.';
            noteEl.appendChild(moe);
          }
        } catch (_) { /* non-fatal */ }
        // F28-2: place-median-vs-county-AMI context (resort-distortion flag).
        try { _appendAmiContextNote(noteEl, selectedGeo.geoid, placeLabel); } catch (_) { /* non-fatal */ }
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

    const _chasIndex = (chasData && chasData.counties) || chasData;
    const county = _chasIndex[countyFips5] || _chasIndex['statewide'] || null;
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
    // Adapter: 2026 CHAS data ships renter_hh_by_ami keyed by AMI bucket;
    // legacy `tiers` array is no longer emitted. Derive it on the fly so
    // the existing chart code keeps working.
    let tiers = county.tiers;
    if ((!tiers || !tiers.length) && county.renter_hh_by_ami) {
      const TIER_ORDER = ['lte30','31to50','51to80','81to100','100plus'];
      const TIER_LABEL = {
        lte30:    '≤30% AMI',
        '31to50': '31–50% AMI',
        '51to80': '51–80% AMI',
        '81to100':'81–100% AMI',
        '100plus':'>100% AMI',
      };
      tiers = TIER_ORDER
        .map(k => {
          const row = county.renter_hh_by_ami[k];
          if (!row) return null;
          const p30 = (row.pct_cost_burdened_30 || 0) * 100;
          const p50 = (row.pct_cost_burdened_50 || 0) * 100;
          return {
            ami_tier:     TIER_LABEL[k] || k,
            burden_30_50: Math.max(0, p30 - p50),
            burden_50plus: p50,
          };
        })
        .filter(Boolean);
    }
    _renderTiers(tiers || [], county.name || countyFips5, /* tigerSource */ false);
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

  /**
   * F188 — Renter need by bedroom count.
   *
   * Reads ACS B25009 renter HH counts by household size, translates each
   * size class to a needed bedroom count using the HUD "max 2 people per
   * bedroom" standard, and renders a horizontal bar chart of
   * needed-bedroom-count → renter HH count.
   *
   * Translation rule (HUD min-bedroom guidance, max 2 ppl/BR):
   *   1-person HH → 50% studio, 50% 1BR  (singles split between the two)
   *   2-person HH → 1BR
   *   3-person HH → 2BR
   *   4-person HH → 2BR
   *   5-person HH → 3BR
   *   6-person HH → 3BR
   *   7+-person HH → 4BR+
   *
   * Also writes the resulting shares to S().state.bedroomNeed so the
   * Market Analysis concept recommender can blend them with its
   * concept-type defaults instead of using the defaults alone (F188-b).
   *
   * @param {object|null} b25009 - { renterTotal, renterBySize: {1..7+} } or null
   */
  function renderBedroomNeed(b25009) {
    const canvas = document.getElementById('chartBedroomNeed');
    const noteEl = document.getElementById('bedroomNeedNote');
    if (!canvas) return;
    if (!b25009 || !b25009.renterBySize) {
      _placeholderInBox(canvas, 'ACS B25009 renter household-size data not yet loaded.');
      if (noteEl) noteEl.textContent = '';
      return;
    }
    const t = chartTheme();
    const fmtNum = U().fmtNum;
    const s = b25009.renterBySize;
    // Translate HH-size buckets → bedroom-need buckets.
    const bins = {
      studio:  Math.round((s[1] || 0) * 0.5),
      '1BR':   Math.round((s[1] || 0) * 0.5) + (s[2] || 0),
      '2BR':   (s[3] || 0) + (s[4] || 0),
      '3BR':   (s[5] || 0) + (s[6] || 0),
      '4BR+':  (s['7+'] || 0)
    };
    const total = Object.values(bins).reduce((a, b) => a + b, 0);
    const shares = total > 0
      ? Object.fromEntries(Object.entries(bins).map(([k, v]) => [k, v / total]))
      : null;
    // Persist shares for cross-page consumers (F188-b reads from here)
    try {
      const st = (window.HNAState && window.HNAState.state) || null;
      if (st) st.bedroomNeed = { bins, shares, source: 'ACS B25009 5-year', updated: new Date().toISOString() };
    } catch (_) {}
    const labels = ['Studio', '1BR', '2BR', '3BR', '4BR+'];
    const values = ['studio', '1BR', '2BR', '3BR', '4BR+'].map(k => bins[k]);
    if (values.every(v => v === 0)) {
      _placeholderInBox(canvas, 'No renter households reported for this geography.');
      if (noteEl) noteEl.textContent = '';
      return;
    }
    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Renter households',
          data: values,
          backgroundColor: t.c1,
          borderWidth: 0
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (c) {
                const pct = total > 0 ? (c.parsed.x / total * 100).toFixed(1) : '0';
                return fmtNum(c.parsed.x) + ' HH (' + pct + '%)';
              }
            }
          }
        },
        scales: {
          x: { ticks: { color: t.muted, callback: v => fmtNum(v) }, grid: { color: t.border } },
          y: { ticks: { color: t.muted }, grid: { color: t.border } }
        }
      }
    });
    if (noteEl) {
      const shareStr = shares
        ? Object.entries(shares).map(([k, v]) => k + ' ' + Math.round(v * 100) + '%').join(' · ')
        : '';
      noteEl.textContent =
        'Total renter households: ' + fmtNum(total) + '. ' +
        'Distribution: ' + shareStr + '. ' +
        'Bedroom need derived using HUD\'s "max 2 people per bedroom" occupancy standard.';
    }
  }

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
    renderBedroomNeed,
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
    renderHousingTypeNeed,
    tryRenderHousingTypeNeedFromState,
    // Labor market
    renderLaborMarketSection,
    renderEmploymentTrend,
    renderWageTrend,
    renderIndustryAnalysis,
    renderEconomicIndicators,
    renderWageGaps,
    renderWageAffordability,  // F198 — income needed to afford rent + buy + LIHTC, vs LEHD wage tiers
    // F199 + F200 — Decade trends (county-level)
    renderDecadeAffordTrend,
    renderHousingTypePace,
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
