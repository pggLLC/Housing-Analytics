/**
 * hna-renderers.js
 * Responsibility: DOM render functions for Housing Needs Assessment.
 * Dependencies: window.HNAState, window.HNAUtils
 * Exposes: window.HNARenderers
 */
(function () {
  'use strict';

  function S() { return window.HNAState; }
  function U() { return window.HNAUtils; }

  function setBanner(msg, kind='info'){
    if (!msg){
      S().els.banner.classList.remove('show');
      S().els.banner.textContent='';
      S().els.banner.removeAttribute('data-kind');
      return;
    }
    S().els.banner.classList.add('show');
    S().els.banner.textContent = msg;
    S().els.banner.setAttribute('data-kind', kind);
  }

  // Reset all stat cards to placeholder state before fetching new geography data.
  // Prevents stale values from a previous geography persisting while new data loads.

  function clearStats(){
    const DASH = '—';
    const statTextEls = [
      'statPop','statMhi','statHomeValue','statRent','statTenure',
      'statRentBurden','statIncomeNeed','statCommute',
      'statBaseUnits','statTargetVac','statUnitsNeed','statNetMig',
    ];
    statTextEls.forEach(function(id){
      const el = S().els[id];
      if (el) el.textContent = DASH;
    });
    const yoyEls = ['statPopYoy','statMhiYoy','statHomeValueYoy','statRentYoy'];
    yoyEls.forEach(function(id){
      const el = S().els[id];
      if (el){ el.textContent = ''; el.className = 'yoy'; }
    });
    const srcEls = [
      'statPopSrc','statMhiSrc','statHomeValueSrc','statRentSrc',
      'statTenureSrc','statRentBurdenSrc','statCommuteSrc','statBaseUnitsSrc',
    ];
    srcEls.forEach(function(id){
      const el = S().els[id];
      if (el) el.innerHTML = '';
    });
    if (S().els.statIncomeNeedNote) S().els.statIncomeNeedNote.textContent = '';
    if (S().els.execNarrative) S().els.execNarrative.textContent = '';
    if (S().els.needNote) S().els.needNote.textContent = '';
  }


  function chartTheme(){
    const style = getComputedStyle(document.documentElement);
    const text   = style.getPropertyValue('--text').trim()   || '#111';
    const muted  = style.getPropertyValue('--muted').trim()  || '#555';
    const border = style.getPropertyValue('--border').trim() || '#ddd';
    const good   = style.getPropertyValue('--good').trim()   || '#047857';
    const bad    = style.getPropertyValue('--bad').trim()    || '#991b1b';
    const warn   = style.getPropertyValue('--warn').trim()   || '#a84608';
    const accent = style.getPropertyValue('--accent').trim() || '#096e65';
    // Chart palette tokens — resolved via getComputedStyle so canvas 2D context
    // can actually use them (canvas cannot resolve CSS var() strings directly).
    const chartColors = [1,2,3,4,5,6,7].map(n =>
      style.getPropertyValue(`--chart-${n}`).trim() || ['#1e5799','#0369a1','#096e65','#7c3d00','#166534','#92400e','#991b1b'][n-1]
    );
    return { text, muted, border, grid: border, good, bad, warn, accent, chartColors };
  }


  function makeChart(ctx, config){
    // Destroy existing
    const id = ctx.canvas.id;
    if (S().charts[id]) S().charts[id].destroy();
    // Apply consistent font size for legibility
    if (window.Chart && Chart.defaults) {
      Chart.defaults.font = Chart.defaults.font || {};
      Chart.defaults.font.size = 12;
    }
    S().charts[id] = new Chart(ctx, config);
  }


  function renderBoundary(geojson, geoType){
    window.HNAController.ensureMap();
    if (S().boundaryLayer) {
      S().boundaryLayer.remove();
      S().boundaryLayer = null;
    }
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    if (!features.length) return;
    const style = U().BOUNDARY_STYLES[geoType] || U().BOUNDARY_STYLES.county;
    S().boundaryLayer = L.geoJSON(geojson, { style }).addTo(S().map);
    try{
      S().map.fitBounds(S().boundaryLayer.getBounds(), {padding:[16,16]});
    }catch(e){
      // ignore
    }
  }

  // --- LIHTC / QCT / DDA helpers ---

  // Return LIHTC fallback features filtered to a county FIPS (or all if none specified)

  function updateLihtcInfoPanel() {
    if (!S().els.lihtcInfoPanel || !S().allLihtcFeatures.length) return;
    // Use the selected geography's boundary (not the viewport) to filter projects.
    // This ensures the project list reflects the jurisdiction, not the map zoom level.
    const boundaryBounds = S().boundaryLayer && S().boundaryLayer.getBounds ? S().boundaryLayer.getBounds() : null;
    const fallbackBounds = S().map && S().map.getBounds ? S().map.getBounds() : null;
    const bounds = boundaryBounds || fallbackBounds;
    let visible = S().allLihtcFeatures;
    if (bounds) {
      visible = S().allLihtcFeatures.filter(f => {
        if (!f.geometry || f.geometry.type !== 'Point') return false;
        const [lng, lat] = f.geometry.coordinates;
        return bounds.contains([lat, lng]);
      });
    }
    // safeCell: renders 0 correctly (unlike `|| '—'`) while still showing '—' for null/undefined
    const safeCell = v => (v != null && v !== '') ? String(v) : '—';
    const sorted = [...visible].sort((a,b) => (b.properties?.N_UNITS||0) - (a.properties?.N_UNITS||0));
    const rows = sorted.slice(0, 10).map(f => {
      const p = f.properties || {};
      return `<tr>
        <td style="padding:4px 6px">${safeCell(p.PROJECT || p.PROJ_NM)}</td>
        <td style="padding:4px 6px">${safeCell(p.PROJ_CTY || p.STD_CITY)}</td>
        <td style="padding:4px 6px;text-align:right">${safeCell(p.N_UNITS)}</td>
        <td style="padding:4px 6px;text-align:right">${safeCell(p.LI_UNITS)}</td>
        <td style="padding:4px 6px">${safeCell(p.YR_PIS)}</td>
        <td style="padding:4px 6px">${safeCell(p.CREDIT)}</td>
      </tr>`;
    }).join('');
    const sourceBadge = `<span style="display:inline-block;padding:1px 7px;border-radius:9px;font-size:.75rem;font-weight:700;background:${U().lihtcSourceInfo(S().lihtcDataSource).color};color:#fff;margin-left:8px">Source: ${S().lihtcDataSource}</span>`;
    S().els.lihtcInfoPanel.innerHTML = rows ? `
      <p style="margin:8px 0 4px;font-weight:700">LIHTC projects in jurisdiction (top 10 by units):${sourceBadge}</p>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.83rem">
          <thead><tr style="color:var(--muted)">
            <th style="padding:4px 6px;text-align:left">Project</th>
            <th style="padding:4px 6px;text-align:left">City</th>
            <th style="padding:4px 6px;text-align:right">Total units</th>
            <th style="padding:4px 6px;text-align:right">LI units</th>
            <th style="padding:4px 6px">Year</th>
            <th style="padding:4px 6px">Credit</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : '<p>No LIHTC projects visible in current map area.</p>';
  }

  // Render LIHTC project markers on the S().map

  function renderLihtcLayer(geojson){
    window.HNAController.ensureMap();
    if (S().lihtcLayer) { S().lihtcLayer.remove(); S().lihtcLayer = null; }
    if (!geojson || !geojson.features || !geojson.features.length) {
      if (S().els.statLihtcCount) S().els.statLihtcCount.textContent = '0';
      if (S().els.statLihtcUnits) S().els.statLihtcUnits.textContent = '0';
      S().allLihtcFeatures = [];
      return;
    }

    const dataSource = geojson._source || 'HUD';
    S().allLihtcFeatures = geojson.features;
    S().lihtcDataSource = dataSource;

    const lihtcIcon = L.divIcon({
      html: '<div style="width:11px;height:11px;border-radius:50%;background:#e84545;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>',
      className: '',
      iconSize: [11, 11],
      iconAnchor: [5, 5],
    });

    S().lihtcLayer = L.geoJSON(geojson, {
      pointToLayer: (f, latlng) => L.marker(latlng, { icon: lihtcIcon }),
      onEachFeature: (f, layer) => {
        const p = f.properties || {};
        layer.bindPopup(U().lihtcPopupHtml(p, dataSource));
        layer.bindTooltip(p.PROJECT || p.PROJ_NM || 'LIHTC Project');
      },
    }).addTo(S().map);

    // Visibility toggle
    if (S().els.layerLihtc && !S().els.layerLihtc.checked) S().lihtcLayer.remove();

    // Update stats — use boundary-filtered features when a boundary exists,
    // so place/CDP selections show only projects within the jurisdiction.
    const boundaryBounds = S().boundaryLayer && S().boundaryLayer.getBounds ? S().boundaryLayer.getBounds() : null;
    let statsFeatures = geojson.features;
    if (boundaryBounds) {
      statsFeatures = geojson.features.filter(f => {
        if (!f.geometry || f.geometry.type !== 'Point') return false;
        const [lng, lat] = f.geometry.coordinates;
        return boundaryBounds.contains([lat, lng]);
      });
    }
    const count = statsFeatures.length;
    const units = statsFeatures.reduce((s, f) => s + (Number(f.properties?.N_UNITS) || 0), 0);
    if (S().els.statLihtcCount) S().els.statLihtcCount.textContent = count.toLocaleString();
    if (S().els.statLihtcUnits) S().els.statLihtcUnits.textContent = units.toLocaleString();

    // Build the info panel filtered to the jurisdiction boundary
    updateLihtcInfoPanel();
  }

  // Render QCT tract overlay on the S().map

  function renderQctLayer(geojson){
    window.HNAController.ensureMap();
    if (S().qctLayer) { S().qctLayer.remove(); S().qctLayer = null; }
    if (!geojson || !geojson.features || !geojson.features.length) {
      if (S().els.statQctCount) S().els.statQctCount.textContent = '0';
      return;
    }
    S().qctLayer = L.geoJSON(geojson, {
      style: {
        weight: 2,
        color: '#388e3c',
        fillColor: '#4caf50',
        fillOpacity: 0.18,
      },
      onEachFeature: (f, layer) => {
        const p = f.properties || {};
        layer.bindTooltip(`QCT Tract: ${p.NAME || p.GEOID || p.TRACTCE || '—'}`);
      },
    }).addTo(S().map);

    if (S().els.layerQct && !S().els.layerQct.checked) S().qctLayer.remove();
    if (S().els.statQctCount) S().els.statQctCount.textContent = geojson.features.length.toLocaleString();
  }

  // Render DDA overlay on the map (polygon if available) and info badge

  function renderDdaLayer(countyFips5, ddaGeojson){
    window.HNAController.ensureMap();
    if (S().ddaLayer) { S().ddaLayer.remove(); S().ddaLayer = null; }

    const ddaInfo = U().CO_DDA[countyFips5] || null;

    if (ddaGeojson && ddaGeojson.features && ddaGeojson.features.length) {
      S().ddaLayer = L.geoJSON(ddaGeojson, {
        style: {
          weight: 2,
          color: '#ff6f00',
          fillColor: '#ff9800',
          fillOpacity: 0.17,
          dashArray: '6 4',
        },
        onEachFeature: (f, layer) => {
          const p = f.properties || {};
          layer.bindTooltip(`DDA: ${p.DDA_NAME || 'Difficult Development Area'}`);
        },
      }).addTo(S().map);
      if (S().els.layerDda && !S().els.layerDda.checked) S().ddaLayer.remove();
    }

    // Always show DDA status from static lookup or fetched data
    const featureCount = ddaGeojson?.features?.length || 0;
    const isDda = !!(ddaInfo?.status || featureCount);
    const isState = countyFips5 === '08';
    const areaName = isState
      ? `${featureCount} DDA counties`
      : (ddaInfo?.area || (ddaGeojson?.features?.[0]?.properties?.DDA_NAME) || '');
    if (S().els.statDdaStatus) S().els.statDdaStatus.textContent = isState ? `${featureCount} areas` : (isDda ? 'Yes ✓' : 'No');
    if (S().els.statDdaNote) S().els.statDdaNote.textContent = isDda ? (areaName || 'HUD DDA') : 'Not designated';
  }

  // Wire layer visibility toggles

  function renderJobMetrics(container, metrics, geoType) {
    if (!container) return;
    if (!metrics || metrics.jobs === null) {
      container.innerHTML = '<p style="color:var(--muted);font-size:.9rem">LEHD WAC job totals not yet cached. Run the HNA data build workflow to populate.</p>';
      return;
    }
    const fmt   = function(v){ return v !== null && Number.isFinite(v) ? v.toLocaleString() : '—'; };
    const fmtR  = function(v){ return v !== null && Number.isFinite(v) ? v.toFixed(2) : '—'; };
    const isState = geoType === 'state';
    const cards = [
      { label: 'Total Jobs', value: fmt(metrics.jobs),   sub: 'LEHD LODES workplace-based' },
      { label: 'Jobs-to-Workers Ratio', value: fmtR(metrics.jwRatio), sub: 'Jobs ÷ estimated workers' },
      !isState && { label: 'In-Commuters', value: fmt(metrics.inflow > 0 ? metrics.inflow : null),   sub: 'Work here, live elsewhere' },
      !isState && { label: 'Out-Commuters', value: fmt(metrics.outflow > 0 ? metrics.outflow : null), sub: 'Live here, work elsewhere' },
      { label: 'Live & Work Here', value: fmt(metrics.within > 0 ? metrics.within : null), sub: isState ? 'Residents who live and work in CO' : 'Contained workforce' },
    ].filter(Boolean);
    container.innerHTML = cards.map(function(c) {
      return '<div class="metric-card">' +
               '<div class="mc-label">' + c.label + '</div>' +
               '<div class="mc-value">' + c.value + '</div>' +
               '<div class="mc-sub">' + c.sub + '</div>' +
             '</div>';
    }).join('');
  }


  function renderWageChart(container, dist) {
    if (!container) return;
    if (!dist) {
      container.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Wage distribution requires LEHD WAC data (CE01–CE03). Cache not yet populated.</p>';
      return;
    }
    container.innerHTML = '<div class="chart-box"><canvas id="chartWage" role="img" aria-label="Wage distribution by job level chart"></canvas></div>';
    const t = chartTheme();
    makeChart(document.getElementById('chartWage').getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['Low wage\n(≤$1,250/mo)', 'Medium wage\n($1,251–$3,333/mo)', 'High wage\n(>$3,333/mo)'],
        datasets: [{
          label: 'Jobs',
          data: [dist.low, dist.medium, dist.high],
          // Low=bad (chart-7 red), Medium=warn (chart-6 burnt-orange), High=good (chart-3 teal)
          backgroundColor: [t.chartColors[6] + 'B3', t.chartColors[5] + 'B3', t.chartColors[2] + 'B3'],
          borderColor:     [t.chartColors[6],         t.chartColors[5],         t.chartColors[2]        ],
          borderWidth: 1,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: t.muted }, grid: { color: t.border } },
          y: { ticks: { color: t.muted }, grid: { color: t.border } },
        }
      }
    });
  }


  function renderIndustryChart(container, industries) {
    if (!container) return;
    if (!industries || !industries.length) {
      container.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Industry breakdown requires LEHD WAC data (CNS fields). Cache not yet populated.</p>';
      return;
    }
    container.innerHTML = '<div class="chart-box"><canvas id="chartIndustry" role="img" aria-label="Top industries by employment count chart"></canvas></div>';
    const t = chartTheme();
    makeChart(document.getElementById('chartIndustry').getContext('2d'), {
      type: 'bar',
      data: {
        labels: industries.map(function(d){ return d.label; }),
        datasets: [{
          label: 'Jobs',
          data: industries.map(function(d){ return d.count; }),
          backgroundColor: industries.map(function(_, i) { return t.chartColors[i % t.chartColors.length] + 'B3'; }),
          borderColor:     industries.map(function(_, i) { return t.chartColors[i % t.chartColors.length]; }),
          borderWidth: 1,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: t.muted }, grid: { color: t.border } },
          y: { ticks: { color: t.muted, font: { size: 11 } }, grid: { color: t.border } },
        }
      }
    });
  }


  function renderCommutingFlows(container, metrics, geoType) {
    if (!container) return;
    if (geoType === 'state') {
      container.innerHTML = '<p style="color:var(--muted);font-size:.87rem">Statewide inflow/outflow values are omitted here because they aggregate all 64 county OD files and overcount internal (inter-county) commuting. Select a county to see accurate commuting flows.</p>';
      return;
    }
    if (!metrics || (metrics.inflow === 0 && metrics.outflow === 0 && metrics.within === 0)) {
      container.innerHTML = '<p style="color:var(--muted)">No commuting data available.</p>';
      return;
    }
    const fmt = function(v){ return Number.isFinite(v) && v > 0 ? v.toLocaleString() : '—'; };
    container.innerHTML =
      '<table class="commuting-table" aria-label="Commuting flows summary">' +
        '<thead><tr><th>Flow type</th><th>Count</th><th>Description</th></tr></thead>' +
        '<tbody>' +
          '<tr><td>In-commuters</td><td>' + fmt(metrics.inflow) + '</td><td>Jobs located here, filled by residents of other areas</td></tr>' +
          '<tr><td>Out-commuters</td><td>' + fmt(metrics.outflow) + '</td><td>Residents who work in other areas</td></tr>' +
          '<tr><td>Live & work here</td><td>' + fmt(metrics.within) + '</td><td>Both live and work within this geography</td></tr>' +
        '</tbody>' +
      '</table>';
  }

  /**
   * Main Labor Market section renderer.
   * @param {object|null} lehd
   * @param {object|null} profile
   */

  function renderLaborMarketSection(lehd, profile, geoType) {
    const metrics     = U().calculateJobMetrics(lehd, profile);
    const wageDist    = U().calculateWageDistribution(lehd);
    const industries  = U().parseIndustries(lehd, 5);

    renderJobMetrics(document.getElementById('jobMetrics'), metrics, geoType);

    const wageContainer = document.getElementById('wageChartContainer');
    if (wageContainer) renderWageChart(wageContainer, wageDist);

    const industryContainer = document.getElementById('industryChartContainer');
    if (industryContainer) renderIndustryChart(industryContainer, industries);

    const commutingContainer = document.getElementById('commutingFlowsContainer');
    if (commutingContainer) renderCommutingFlows(commutingContainer, metrics, geoType);
  }

  // ---------------------------------------------------------------
  // Economic Indicators — Employment Trend, Wage Trend, Industry
  // Analysis, 4-card Dashboard, Wage Gaps
  // ---------------------------------------------------------------

  /**
   * Render a multi-year employment trend line chart with YoY labels.
   * Reads annualEmployment and yoyGrowth from the cached LEHD file.
   *
   * @param {string|null} geoid - 5-digit county FIPS (used for data lookup); null for state-level
   */

  function renderEmploymentTrend(geoid) {
    var container = document.getElementById('employmentTrendContainer');
    if (!container) return;

    if (!geoid) {
      container.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Employment trend data is available at the county level. Select a county to view this chart.</p>';
      return;
    }

    var lehd = null;
    try {
      var lehdGeoid = (typeof geoid === 'string' && (geoid.length === 5 || geoid === '08')) ? geoid : null;
      lehd = lehdGeoid && window.__HNA_LEHD_CACHE && window.__HNA_LEHD_CACHE[lehdGeoid];
    } catch (_) {}

    if (!lehd || !lehd.annualEmployment) {
      container.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Trend charts require WAC-enriched LEHD county files (including annual employment, wages, and industries). Run the HNA data build workflow to populate the data.</p>';
      return;
    }

    var years  = Object.keys(lehd.annualEmployment).sort();
    var counts = years.map(function(y) { return Number(lehd.annualEmployment[y]) || 0; });
    var yoy    = lehd.yoyGrowth || {};

    container.innerHTML = '<div class="chart-box"><canvas id="chartEmploymentTrend"></canvas></div>';
    var t = chartTheme();
    makeChart(document.getElementById('chartEmploymentTrend').getContext('2d'), {
      type: 'line',
      data: {
        labels: years,
        datasets: [{
          label: 'Total Jobs',
          data: counts,
          borderColor: t.chartColors[0],
          backgroundColor: t.chartColors[0] + '26',
          fill: true,
          tension: 0.3,
          pointRadius: 5,
          pointHoverRadius: 7,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterLabel: function(ctx) {
                var yr = ctx.label;
                var g  = yoy[yr];
                return (g != null) ? 'YoY: ' + (g > 0 ? '+' : '') + g.toFixed(1) + '%' : '';
              }
            }
          },
          datalabels: {
            display: false,
          },
        },
        scales: {
          x: { ticks: { color: t.muted }, grid: { color: t.border } },
          y: {
            ticks: { color: t.muted, callback: function(v) { return v.toLocaleString(); } },
            grid: { color: t.border },
          },
        }
      }
    });

    // Render YoY labels below the chart
    var labelsHtml = years.slice(1).map(function(y) {
      var g = yoy[y];
      if (g == null) return '';
      var cls = g > 0 ? 'color:var(--success,#22a36f)' : (g < 0 ? 'color:var(--danger,#ef4444)' : '');
      return '<span style="margin-right:.75rem;font-size:.8rem;' + cls + '">' + y + ': ' + (g > 0 ? '+' : '') + g.toFixed(1) + '%</span>';
    }).join('');
    if (labelsHtml) {
      var row = document.createElement('div');
      row.style.cssText = 'margin-top:.4rem;line-height:1.6';
      row.innerHTML = labelsHtml;
      container.appendChild(row);
    }
  }

  /**
   * Render a dual-axis line chart: nominal wage trend vs. annual housing cost.
   * Reads data from the LEHD wage bands and ACS profile.
   *
   * @param {string|null} geoid - 5-digit county FIPS; null for state-level
   */

  function renderWageTrend(geoid) {
    var container = document.getElementById('wageTrendContainer');
    if (!container) return;

    if (!geoid) {
      container.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Wage trend data is available at the county level. Select a county to view this chart.</p>';
      return;
    }

    var lehd = null;
    try {
      var lehdGeoid = (typeof geoid === 'string' && (geoid.length === 5 || geoid === '08')) ? geoid : null;
      lehd = lehdGeoid && window.__HNA_LEHD_CACHE && window.__HNA_LEHD_CACHE[lehdGeoid];
    } catch (_) {}

    if (!lehd || !lehd.annualEmployment) {
      container.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Trend charts require WAC-enriched LEHD county files (including annual employment, wages, and industries). Run the HNA data build workflow to populate the data.</p>';
      return;
    }

    var years = Object.keys(lehd.annualEmployment).sort();
    var annualWages = lehd.annualWages || {};

    // Derive proxy median wage: LEHD CE02 (medium wage band midpoint ≈ $27,500 annual)
    var wageSeries = years.map(function(y) {
      var w = annualWages[y];
      if (!w) return null;
      var total = (w.low || 0) + (w.medium || 0) + (w.high || 0);
      if (!total) return null;
      // Weighted average using band midpoints
      var weighted = (
        (w.low    || 0) * U().WAGE_BAND_ANNUAL.low    +
        (w.medium || 0) * U().WAGE_BAND_ANNUAL.medium  +
        (w.high   || 0) * U().WAGE_BAND_ANNUAL.high
      ) / total;
      return Math.round(weighted);
    });

    container.innerHTML = '<div class="chart-box"><canvas id="chartWageTrend"></canvas></div>';
    var t = chartTheme();
    makeChart(document.getElementById('chartWageTrend').getContext('2d'), {
      type: 'line',
      data: {
        labels: years,
        datasets: [{
          label: 'Avg Annual Wage (est.)',
          data: wageSeries,
          borderColor: t.chartColors[2],
          backgroundColor: t.chartColors[2] + '1A',
          fill: true,
          tension: 0.3,
          yAxisID: 'yWage',
          pointRadius: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { color: t.muted } },
        },
        scales: {
          x: { ticks: { color: t.muted }, grid: { color: t.border } },
          yWage: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Est. Annual Wage ($)', color: t.muted },
            ticks: {
              color: t.muted,
              callback: function(v) { return '$' + v.toLocaleString(); },
            },
            grid: { color: t.border },
          },
        }
      }
    });
  }

  /**
   * Render an industry analysis combining a horizontal bar chart and
   * an HHI concentration badge.
   *
   * @param {string|null} geoid - 5-digit county FIPS; null for state-level
   */

  function renderIndustryAnalysis(geoid) {
    var container = document.getElementById('industryAnalysisContainer');
    if (!container) return;

    if (!geoid) {
      container.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Industry analysis data is available at the county level. Select a county to view this chart.</p>';
      return;
    }

    var lehd = null;
    try {
      var lehdGeoid = (typeof geoid === 'string' && (geoid.length === 5 || geoid === '08')) ? geoid : null;
      lehd = lehdGeoid && window.__HNA_LEHD_CACHE && window.__HNA_LEHD_CACHE[lehdGeoid];
    } catch (_) {}

    var industries = (lehd && Array.isArray(lehd.industries)) ? lehd.industries.slice(0, 10) : [];

    if (!industries.length) {
      container.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Trend charts require WAC-enriched LEHD county files (including annual employment, wages, and industries). Run the HNA data build workflow to populate the data.</p>';
      return;
    }

    // Compute HHI from top industries
    var totalEmp = industries.reduce(function(s, d) { return s + (d.count || 0); }, 0);
    var hhi = 0;
    if (totalEmp > 0) {
      industries.forEach(function(d) {
        var share = (d.count || 0) / totalEmp * 100;
        hhi += share * share;
      });
      hhi = Math.round(hhi);
    }
    var hhiLabel = hhi < 1500 ? 'Competitive' : (hhi < 2500 ? 'Moderately Concentrated' : 'Highly Concentrated');
    var hhiColor = hhi < 1500 ? '#22a36f' : (hhi < 2500 ? '#f59e0b' : '#ef4444');

    container.innerHTML =
      '<div style="margin-bottom:.5rem;font-size:.85rem">' +
        'HHI: <strong>' + hhi.toLocaleString() + '</strong> — ' +
        '<span style="color:' + hhiColor + '">' + hhiLabel + '</span>' +
      '</div>' +
      '<div class="chart-box"><canvas id="chartIndustryAnalysis"></canvas></div>';

    var t = chartTheme();
    var colors = industries.map(function(_, i) {
      return t.chartColors[i % t.chartColors.length] + 'BF';
    });
    var borderColors = industries.map(function(_, i) {
      return t.chartColors[i % t.chartColors.length];
    });

    makeChart(document.getElementById('chartIndustryAnalysis').getContext('2d'), {
      type: 'bar',
      data: {
        labels: industries.map(function(d) { return d.label; }),
        datasets: [{
          label: 'Jobs',
          data: industries.map(function(d) { return d.count || 0; }),
          backgroundColor: colors,
          borderColor: borderColors,
          borderWidth: 1,
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
              afterLabel: function(ctx) {
                var d = industries[ctx.dataIndex];
                return d ? d.pct + '% of local jobs' : '';
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: t.muted, callback: function(v) { return v.toLocaleString(); } },
            grid: { color: t.border },
          },
          y: { ticks: { color: t.muted, font: { size: 11 } }, grid: { color: t.border } },
        }
      }
    });
  }

  /**
   * Render a 4-card economic indicator dashboard showing:
   *   1. Total jobs (latest year)
   *   2. YoY employment growth
   *   3. CAGR over available years
   *   4. Industry diversity (HHI)
   *
   * @param {string|null} geoid - 5-digit county FIPS; null for state-level
   */

  function renderEconomicIndicators(geoid) {
    var container = document.getElementById('econIndicatorCards');
    if (!container) return;

    if (!geoid) {
      container.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Economic indicator data is available at the county level. Select a county to view employment metrics.</p>';
      return;
    }

    var lehd = null;
    try {
      var lehdGeoid = (typeof geoid === 'string' && (geoid.length === 5 || geoid === '08')) ? geoid : null;
      lehd = lehdGeoid && window.__HNA_LEHD_CACHE && window.__HNA_LEHD_CACHE[lehdGeoid];
    } catch (_) {}

    var annualEmp  = (lehd && lehd.annualEmployment) ? lehd.annualEmployment : {};
    var yoyGrowth  = (lehd && lehd.yoyGrowth)        ? lehd.yoyGrowth        : {};
    var industries = (lehd && Array.isArray(lehd.industries)) ? lehd.industries : [];

    // If no LEHD data cached, or LEHD exists but lacks WAC-enriched fields,
    // show a descriptive fallback message at the section level.
    var wacMissing = !lehd || (!lehd.annualEmployment && !lehd.annualWages && (!Array.isArray(lehd.industries) || lehd.industries.length === 0));
    if (wacMissing) {
      var sectionEl = document.getElementById('economicIndicatorsContainer');
      var fallbackMsg = '<p class="metric-cards-note" style="padding:.75rem 0">Trend charts require WAC-enriched LEHD county files (including annual employment, wages, and industries). Run the HNA data build workflow to populate the data.</p>';
      if (sectionEl) {
        var existing = sectionEl.querySelector('.metric-cards-note');
        if (!existing) sectionEl.insertAdjacentHTML('beforeend', fallbackMsg);
      }
      container.innerHTML = fallbackMsg;
      return;
    }

    var years     = Object.keys(annualEmp).sort();
    var latestYr  = years[years.length - 1] || null;
    var firstYr   = years[0]               || null;
    var totalJobs = latestYr ? (Number(annualEmp[latestYr]) || null) : null;

    var latestYoy = null;
    if (latestYr && yoyGrowth[latestYr] != null) latestYoy = Number(yoyGrowth[latestYr]);

    var cagr = null;
    if (firstYr && latestYr && firstYr !== latestYr) {
      var v0 = Number(annualEmp[firstYr]);
      var v1 = Number(annualEmp[latestYr]);
      var span = Number(latestYr) - Number(firstYr);
      if (v0 > 0 && v1 > 0 && span > 0) {
        cagr = ((Math.pow(v1 / v0, 1 / span) - 1) * 100).toFixed(2);
      }
    }

    var hhi = 0;
    var totalInd = industries.reduce(function(s, d) { return s + (d.count || 0); }, 0);
    if (totalInd > 0) {
      industries.forEach(function(d) {
        var share = (d.count || 0) / totalInd * 100;
        hhi += share * share;
      });
      hhi = Math.round(hhi);
    }

    function fmt(v) { return (v !== null && Number.isFinite(Number(v))) ? Number(v).toLocaleString() : '—'; }
    function fmtPct(v) {
      if (v === null || !Number.isFinite(Number(v))) return '—';
      var n = Number(v);
      return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
    }

    var cards = [
      {
        label: 'Total Jobs (' + (latestYr || '—') + ')',
        value: fmt(totalJobs),
        sub: 'LEHD WAC workplace-based employment',
        color: '',
      },
      {
        label: 'YoY Growth',
        value: U().fmtPct(latestYoy),
        sub: (latestYr && years[years.length - 2])
          ? years[years.length - 2] + ' → ' + latestYr
          : 'Year-over-year change',
        color: latestYoy !== null ? (latestYoy > 0 ? '#22a36f' : (latestYoy < 0 ? '#ef4444' : '')) : '',
      },
      {
        label: 'CAGR',
        value: U().fmtPct(cagr),
        sub: firstYr && latestYr ? firstYr + ' → ' + latestYr + ' compound annual growth' : 'Compound annual growth rate',
        color: cagr !== null ? (Number(cagr) > 0 ? '#22a36f' : (Number(cagr) < 0 ? '#ef4444' : '')) : '',
      },
      {
        label: 'Industry HHI',
        value: hhi > 0 ? hhi.toLocaleString() : '—',
        sub: hhi < 1500 ? 'Competitive market' : (hhi < 2500 ? 'Moderately concentrated' : 'Highly concentrated'),
        color: hhi < 1500 ? '#22a36f' : (hhi < 2500 ? '#f59e0b' : '#ef4444'),
      },
    ];

    container.innerHTML = cards.map(function(c) {
      return '<div class="metric-card">' +
        '<div class="mc-label">' + c.label + '</div>' +
        '<div class="mc-value"' + (c.color ? ' style="color:' + c.color + '"' : '') + '>' + c.value + '</div>' +
        '<div class="mc-sub">' + c.sub + '</div>' +
        '</div>';
    }).join('');
  }

  /**
   * Render a wage-gap affordability table showing each LEHD wage tier vs.
   * local median rent.
   *
   * @param {string} geoid   - 5-digit county FIPS
   * @param {object} profile - ACS profile (for median rent DP04_0134E)
   */

  function renderWageGaps(geoid, profile) {
    var container = document.getElementById('wageGapsContainer');
    if (!container) return;

    var monthlyRent = null;
    if (profile) {
      var rentVal = Number(profile.DP04_0134E);
      if (Number.isFinite(rentVal) && rentVal > 0) monthlyRent = rentVal;
    }

    var WAGE_TIERS = [
      { label: 'Low wage (CE01)',    annualWage: U().WAGE_BAND_ANNUAL.low,    desc: '≤ $1,250/mo LEHD' },
      { label: 'Medium wage (CE02)', annualWage: U().WAGE_BAND_ANNUAL.medium, desc: '$1,251–$3,333/mo LEHD' },
      { label: 'High wage (CE03)',   annualWage: U().WAGE_BAND_ANNUAL.high,   desc: '> $3,333/mo LEHD' },
    ];

    var rows = WAGE_TIERS.map(function(tier) {
      var maxRent = tier.annualWage * 0.30 / 12;
      var deficit = monthlyRent !== null ? monthlyRent - maxRent : null;
      var canAfford = deficit !== null ? deficit <= 0 : null;
      return {
        tier: tier.label,
        desc: tier.desc,
        annualWage: tier.annualWage,
        maxRent: Math.round(maxRent),
        actualRent: monthlyRent !== null ? Math.round(monthlyRent) : null,
        deficit: deficit !== null ? Math.round(deficit) : null,
        canAfford: canAfford,
      };
    });

    var fmtDollar = function(v) { return v !== null ? '$' + v.toLocaleString() : '—'; };

    container.innerHTML =
      '<table class="commuting-table" aria-label="Wage-rent affordability gap by tier">' +
        '<thead><tr>' +
          '<th>Wage Tier</th>' +
          '<th>Est. Annual Wage</th>' +
          '<th>Max Affordable Rent/mo</th>' +
          '<th>Actual Median Rent/mo</th>' +
          '<th>Monthly Gap</th>' +
          '<th>Can Afford?</th>' +
        '</tr></thead>' +
        '<tbody>' +
        rows.map(function(r) {
          var gapStyle = '';
          if (r.deficit !== null) {
            gapStyle = r.deficit > 0
              ? 'color:#ef4444;font-weight:600'
              : 'color:#22a36f';
          }
          return '<tr>' +
            '<td>' + r.tier + '<br><small style="color:var(--muted)">' + r.desc + '</small></td>' +
            '<td>' + fmtDollar(r.annualWage) + '</td>' +
            '<td>' + fmtDollar(r.maxRent) + '</td>' +
            '<td>' + fmtDollar(r.actualRent) + '</td>' +
            '<td style="' + gapStyle + '">' +
              (r.deficit !== null ? (r.deficit > 0 ? '+$' + r.deficit.toLocaleString() : '—') : '—') +
            '</td>' +
            '<td>' + (r.canAfford === null ? '—' : (r.canAfford ? '✅ Yes' : '❌ No')) + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody>' +
      '</table>' +
      (monthlyRent === null
        ? '<p style="color:var(--muted);font-size:.8rem;margin-top:.4rem">Median rent not available from ACS data; gap column shows estimates only.</p>'
        : '');
  }

  // ---------------------------------------------------------------
  // Prop 123 renderers
  // ---------------------------------------------------------------


  function renderBaselineCard(container, baselineData) {
    if (!container) return;
    if (!baselineData) {
      container.innerHTML = '<p style="color:var(--muted);font-size:.9rem">ACS data needed to calculate baseline.</p>';
      return;
    }
    const { baseline60Ami, totalRentals, pctOfStock, method } = baselineData;
    const fmt    = function(v){ return Number.isFinite(v) ? v.toLocaleString() : '—'; };
    const fmtPct = function(v){ return Number.isFinite(v) ? v.toFixed(1) + '%' : '—'; };

    // Status: if pctOfStock > 15%, consider on-track; <10% below-target
    let statusClass = 'on-track', statusText = '✅ Baseline established (estimate)';
    if (pctOfStock < 10) { statusClass = 'below-target'; statusText = '⚠️ Below typical threshold'; }
    if (!baseline60Ami) { statusClass = 'no-data'; statusText = '❓ No data'; }

    container.innerHTML =
      '<div class="prop123-stat-row">' +
        '<div class="prop123-stat"><strong>' + fmt(baseline60Ami) + '</strong> est. 60% AMI rental units</div>' +
        '<div class="prop123-stat"><strong>' + fmt(totalRentals) + '</strong> total rental units</div>' +
        '<div class="prop123-stat"><strong>' + U().fmtPct(pctOfStock) + '</strong> of rental stock</div>' +
      '</div>' +
      '<div><span class="compliance-status ' + statusClass + '">' + statusText + '</span></div>' +
      '<p style="margin:8px 0 0;color:var(--muted);font-size:.82rem">' +
        'Estimated using ACS GRAPI rent-burden bins as an affordability proxy. ' +
        'For a certified baseline, jurisdictions should conduct a formal housing needs assessment.' +
      '</p>';
  }


  function renderGrowthChart(baselineData) {
    const canvas = document.getElementById('chartProp123Growth');
    const contentDiv = document.getElementById('prop123GrowthContent');
    if (!canvas || !baselineData) return;
    if (!contentDiv) return;

    const currentYear = new Date().getFullYear();
    const years = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2, currentYear + 3];
    const b = baselineData.baseline60Ami;

    const targetData = years.map(function(yr) {
      return U().calculateGrowthTarget(b, yr - currentYear + 1);
    });
    const baselineData_flat = years.map(function() { return b; });

    const t = chartTheme();
    makeChart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: years,
        datasets: [
          {
            label: 'Required target (3% growth)',
            data: targetData,
            borderColor: t.chartColors[2],
            backgroundColor: t.chartColors[2] + '1F',
            borderDash: [],
            tension: 0.3,
            fill: false,
          },
          {
            label: 'Baseline',
            data: baselineData_flat,
            borderColor: t.chartColors[5],
            backgroundColor: t.chartColors[5] + '1A',
            borderDash: [5, 5],
            tension: 0,
            fill: false,
          },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: t.text } } },
        scales: {
          x: { ticks: { color: t.muted }, grid: { color: t.border } },
          y: { ticks: { color: t.muted }, grid: { color: t.border }, beginAtZero: false },
        }
      }
    });

    const nextTarget = U().calculateGrowthTarget(b, 1);
    const p = document.createElement('p');
    p.style.cssText = 'margin:8px 0 0;color:var(--muted);font-size:.82rem';
    p.textContent = 'Baseline: ' + b.toLocaleString() + ' units. ' +
      'One-year target (' + currentYear + '): ' + nextTarget.toLocaleString() + ' units (+3%).';
    contentDiv.appendChild(p);
  }


  function renderFastTrackCard(container, eligibility) {
    if (!container) return;
    if (!eligibility) {
      container.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Population data needed to check eligibility.</p>';
      return;
    }
    let statusClass, statusText;
    if (eligibility.eligible === null) {
      statusClass = 'no-data'; statusText = '❓ Unknown';
    } else if (eligibility.eligible) {
      statusClass = 'eligible'; statusText = '✅ Eligible';
    } else {
      statusClass = 'not-eligible'; statusText = '❌ Not eligible';
    }
    container.innerHTML =
      '<span class="compliance-status ' + statusClass + '">' + statusText + '</span>' +
      '<p style="margin:8px 0 0;color:var(--muted);font-size:.88rem">' + eligibility.reason + '</p>' +
      (eligibility.eligible ? (
        '<p style="margin:6px 0 0;font-size:.88rem">' +
          '<a href="https://cdola.colorado.gov/prop123" target="_blank" rel="noopener">View fast-track application process →</a>' +
        '</p>'
      ) : '');
  }


  function renderChecklist(baselineData, eligibility) {
    const hasBaseline  = !!(baselineData && baselineData.baseline60Ami);
    const hasGrowth    = false; // Growth target adoption is a manual user action, not auto-derived from baseline
    const hasFastTrack = !!(eligibility && eligibility.eligible);

    // If the ComplianceChecklist module is loaded, use it for persistence
    if (window.ComplianceChecklist) {
      const geoType = S().els.geoType ? S().els.geoType.value : 'county';
      let   geoid   = S().els.geoSelect ? S().els.geoSelect.value : '';
      // Use Colorado state FIPS as fallback when no specific geoid is selected
      if (geoType === 'state' && !geoid) geoid = '08';

      // Load saved state for this geography
      const savedState = window.ComplianceChecklist.initComplianceChecklist(geoType, geoid);

      // Determine if any prior state has been saved for this geography.
      // Only auto-check data-driven items on the first visit (no existing state).
      // If a saved state exists (updatedAt differs from createdAt, or items exist),
      // respect the user's manual choices entirely.
      const hasPriorState = !!(
        savedState &&
        savedState.items &&
        savedState.updatedAt &&
        savedState.createdAt &&
        savedState.updatedAt !== savedState.createdAt
      );

      if (!hasPriorState) {
        // First visit for this geography: auto-check data-driven items
        if (hasBaseline) {
          window.ComplianceChecklist.updateChecklistItem('baseline', true, {
            value: baselineData.baseline60Ami,
            date:  new Date().toISOString(),
          });
        }
        if (hasGrowth) {
          window.ComplianceChecklist.updateChecklistItem('growth', true, {
            date: new Date().toISOString(),
          });
        }
        if (hasFastTrack) {
          window.ComplianceChecklist.updateChecklistItem('fasttrack', true, {
            date: new Date().toISOString(),
          });
        }
      }

      // Update visible completion indicator
      const completionEl = document.getElementById('checklistCompletionStatus');
      if (completionEl) {
        const allDone = window.ComplianceChecklist.isChecklistComplete(geoType, geoid);
        completionEl.textContent = allDone ? 'All items complete! ✅' : '';
        completionEl.style.display = allDone ? '' : 'none';
      }

      // Announce the next action to screen readers
      const announcer = document.getElementById('checklistAnnouncer');
      if (announcer) {
        announcer.textContent = window.ComplianceChecklist.getNextAction(geoType, geoid);
      }
      return;
    }

    // Fallback (no module): simple DOM update without persistence
    function setItem(id, checked) {
      const item = document.getElementById(id);
      const chk  = item && item.querySelector('input[type="checkbox"]');
      if (!item || !chk) return;
      chk.checked = checked;
      chk.setAttribute('aria-checked', String(checked));
      item.classList.toggle('done',    checked);
      item.classList.toggle('pending', !checked);
    }
    setItem('checkItemBaseline',  hasBaseline);
    setItem('checkItemGrowth',    hasGrowth);
    setItem('checkItemFastTrack', hasFastTrack);
    // DOLA filing and reporting: user-managed checkboxes (persist if already checked)
  }

  /**
   * Main Prop 123 section renderer.
   * @param {object|null} profile - ACS profile data
   * @param {string} geoType
   */

  function renderProp123Section(profile, geoType) {
    const baselineData = U().calculateBaseline(profile);
    const population   = profile ? Number(profile.DP05_0001E) : null;
    const eligibility  = U().checkFastTrackEligibility(population, geoType);

    renderBaselineCard(document.getElementById('prop123BaselineContent'), baselineData);
    renderFastTrackCard(document.getElementById('prop123FastTrackContent'), eligibility);
    renderChecklist(baselineData, eligibility);

    const contentDiv = document.getElementById('prop123GrowthContent');
    if (contentDiv && baselineData) {
      renderGrowthChart(baselineData);
    } else if (contentDiv) {
      contentDiv.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Baseline required before growth targets can be set.</p>' +
        '<div class="timeline-chart"><canvas id="chartProp123Growth"></canvas></div>';
    }

    // Phase 3: historical compliance + fast-track calculator
    const geoid = (profile && profile._geoid) ? profile._geoid : '';
    renderHistoricalSection(baselineData, geoType, geoid);
    renderFastTrackCalculatorSection();

    // Phase 4: Housing Policy Commitment scorecard
    if (geoid) {
      renderHnaScorecardPanel(geoid);
    }
  }

  // ---------------------------------------------------------------
  // Housing Policy Commitment Scorecard (on HNA page)
  // ---------------------------------------------------------------

  var _hnaScorecardCache = null;

  function renderHnaScorecardPanel(geoid) {
    var panel = document.getElementById('hnaScorecardPanel');
    var content = document.getElementById('hnaScorecardContent');
    if (!panel || !content) return;

    function render(scores) {
      var sc = scores[geoid];
      if (!sc || sc.knownDimensions < 1) {
        panel.style.display = 'none';
        return;
      }
      var labels = {
        has_hna: 'Housing Needs Assessment',
        prop123_committed: 'Proposition 123 Committed',
        has_housing_authority: 'Housing Authority',
        has_housing_nonprofits: 'Housing Nonprofits',
        has_comp_plan: 'Housing in Comprehensive Plan',
        has_iz_ordinance: 'Zoning Incentives / IZ Ordinance',
        has_local_funding: 'Affordable Housing Funding',
      };
      var items = Object.keys(sc.dimensions).map(function (id) {
        var val = sc.dimensions[id];
        var label = labels[id] || id;
        if (val === true)  return '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:.85rem"><span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--good,#16a34a);color:#fff;font-size:.72rem;font-weight:700">&#10003;</span> ' + label + '</div>';
        if (val === false) return '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:.85rem;color:var(--muted)"><span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--bad,#dc2626);color:#fff;font-size:.72rem;font-weight:700">&#10007;</span> ' + label + '</div>';
        return '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:.85rem;color:var(--muted);font-style:italic"><span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--border);color:var(--muted);font-size:.72rem;font-weight:700">?</span> ' + label + '</div>';
      }).join('');
      var cta = sc.knownDimensions < 7
        ? '<p style="margin-top:.5rem;font-size:.78rem;color:var(--muted)">Know more about this jurisdiction\'s housing policies? <a href="https://github.com/pggLLC/Housing-Analytics/issues/new?title=Housing+policy+data+for+' + encodeURIComponent(sc.name || '') + '&labels=data-contribution" target="_blank" rel="noopener" style="color:var(--accent)">Submit data</a></p>'
        : '';
      content.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px">' + items + '</div>' +
        '<div style="margin-top:.6rem;font-size:.82rem;font-weight:600;color:var(--accent)">' + sc.totalScore + ' of ' + sc.knownDimensions + ' commitment dimensions confirmed</div>' + cta;
      panel.style.display = '';
    }

    if (_hnaScorecardCache) {
      render(_hnaScorecardCache);
      return;
    }
    var fetcher = (typeof window.safeFetchJSON === 'function')
      ? window.safeFetchJSON
      : function (u) { return fetch(u).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); }); };
    fetcher('data/policy/housing-policy-scorecard.json')
      .then(function (data) {
        _hnaScorecardCache = (data && data.scores) || {};
        render(_hnaScorecardCache);
      })
      .catch(function () { panel.style.display = 'none'; });
  }

  // ---------------------------------------------------------------
  // Phase 3: Historical compliance tracking + Fast-track timeline
  // ---------------------------------------------------------------

  /**
   * Calculate fast-track approval timeline under HB 22-1093 / Prop 123.
   *
   * @param {number} projectUnits       - Total units in project
   * @param {number} ami_pct            - AMI percentage (e.g. 60 for 60% AMI)
   * @param {string} jurisdiction_type  - 'county' | 'place' | 'cdp'
   * @returns {{
   *   standardDays: number,
   *   fastTrackDays: number,
   *   timelineSavings: string,
   *   eligible: boolean,
   *   conditions: string[]
   * }}
   */

  function renderFastTrackCalculatorSection() {
    const container = document.getElementById('fastTrackCalculator');
    if (!container) return;

    // Read inputs
    const unitsEl = document.getElementById('ftUnits');
    const amiEl   = document.getElementById('ftAmi');
    const geoEl   = document.getElementById('ftGeoType');
    const outEl   = document.getElementById('ftResult');
    if (!outEl) return;

    const units   = unitsEl ? Number(unitsEl.value) : 10;
    const ami     = amiEl   ? Number(amiEl.value)   : 60;
    const geoType = geoEl   ? geoEl.value           : 'place';

    const result  = U().calculateFastTrackTimeline(units, ami, geoType);

    outEl.innerHTML = '';

    const statusP = document.createElement('p');
    statusP.className = 'fast-track-status ' + (result.eligible ? 'eligible' : 'not-eligible');
    statusP.textContent = result.eligible
      ? '✅ Eligible for fast-track approval'
      : '❌ Not eligible for fast-track — see requirements below';
    outEl.appendChild(statusP);

    const timelineDiv = document.createElement('div');
    timelineDiv.className = 'fast-track-timeline-row';
    timelineDiv.innerHTML =
      '<span class="tl-label">Standard approval:</span><span class="tl-value">~' + result.standardDays + ' days (~' + Math.round(result.standardDays / 30) + ' months)</span>' +
      '<span class="tl-label">Fast-track:</span><span class="tl-value">~' + result.fastTrackDays + ' days (~' + Math.round(result.fastTrackDays / 30) + ' months)</span>' +
      '<span class="tl-label">Time saved:</span><span class="tl-value tl-savings">~' + result.timelineSavings + '</span>';
    outEl.appendChild(timelineDiv);

    const ul = document.createElement('ul');
    ul.className = 'fast-track-conditions';
    result.conditions.forEach((c) => {
      const li = document.createElement('li');
      li.textContent = c;
      ul.appendChild(li);
    });
    outEl.appendChild(ul);
  }

  /**
   * Render the historical compliance section using Prop123Tracker (if loaded).
   *
   * @param {object|null} baselineData - from U().calculateBaseline()
   * @param {string}      geoType
   * @param {string}      geoid
   */

  function renderHistoricalSection(baselineData, geoType, geoid) {
    const container = document.getElementById('prop123HistoricalContent');
    if (!container) return;

    const dolaContainer = document.getElementById('prop123DolaFiling');

    if (!baselineData) {
      container.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Select a geography to view historical compliance data.</p>';
      return;
    }

    const baseline    = baselineData.baseline60Ami;
    const currentYear = new Date().getFullYear();
    const tracker     = window.Prop123Tracker;

    // DOLA filing status
    if (dolaContainer && tracker) {
      tracker.renderDolaFilingStatus('prop123DolaFiling');
    }

    // Historical chart
    if (tracker) {
      const histData = tracker.getHistoricalAffordableData(geoType, geoid, baseline);
      const traj     = tracker.calculateComplianceTrajectory(baseline, histData.actuals, currentYear);

      // Check if any actuals beyond the baseline year have been reported
      const hasActuals = histData.actuals.slice(1).some(a => a !== null);

      const statusEl = document.getElementById('prop123HistoricalStatus');
      if (statusEl) {
        if (!hasActuals || traj.onTrack === null) {
          statusEl.textContent = 'Projected baseline only — submit actual unit counts for compliance tracking';
          statusEl.className   = 'compliance-status status-unknown';
        } else if (traj.onTrack) {
          statusEl.textContent = 'On track — meeting 3% annual growth requirement';
          statusEl.className   = 'compliance-status status-on-track';
        } else {
          const gap = Math.abs(traj.gapAtCurrentYear);
          statusEl.textContent = 'Off track — need ' + gap + ' more units to meet ' + currentYear + ' target';
          statusEl.className   = 'compliance-status status-off-track';
        }
      }

      // Render multi-year table
      renderComplianceTable(histData, traj, baseline, container);

      // Render chart on canvas
      const chartCanvas = document.getElementById('chartProp123Historical');
      if (chartCanvas) {
        tracker.renderHistoricalComplianceChart('chartProp123Historical', baseline, histData, currentYear);
      }
    } else {
      container.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Historical tracker not loaded.</p>';
    }
  }

  /**
   * Render the multi-year compliance table.
   */

  function renderComplianceTable(histData, traj, baseline, container) {
    const { years, actuals } = histData;
    const { targets }        = traj;

    const table = document.createElement('table');
    table.className = 'compliance-history-table';
    table.setAttribute('aria-label', 'Prop 123 multi-year compliance');

    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Year</th><th>Required Target</th><th>Actual Units</th><th>Gap</th><th>Status</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    years.forEach((year, i) => {
      const target = targets[i] || Math.round(baseline * Math.pow(1.03, i));
      const actual = actuals[i];
      const gap    = actual !== null ? actual - target : null;
      const status = actual === null ? '—' : (actual >= target ? '🟢 On track' : '🔴 Off track');
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + year + '</td>' +
        '<td>' + target.toLocaleString() + '</td>' +
        '<td>' + (actual !== null ? Number(actual).toLocaleString() : '<em>Not reported</em>') + '</td>' +
        '<td>' + (gap !== null ? (gap >= 0 ? '+' : '') + gap.toLocaleString() : '—') + '</td>' +
        '<td>' + status + '</td>';
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    container.innerHTML = '';
    container.appendChild(table);
  }


  function renderSnapshot(profile, s0801, geoLabel, prevProfile){
    const pop = profile?.DP05_0001E;
    const mhi = profile?.DP03_0062E;
    const homeValue = profile?.DP04_0089E;
    const rent = profile?.DP04_0134E;

    // Metadata for source links (attached by fetch functions or update() for cached data)
    const yr   = profile?._acsYear   || null;
    const sr   = profile?._acsSeries || 'acs5';
    const gt   = profile?._geoType   || null;
    const gid  = profile?._geoid     || null;

    // Helper: render YOY change badge
    function setYoy(el, curr, prev) {
      if (!el) return;
      const c = Number(curr), p = Number(prev);
      if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) { el.textContent = ''; el.className = 'yoy'; return; }
      const pct = ((c - p) / p) * 100;
      const sign = pct >= 0 ? '+' : '';
      el.textContent = `${sign}${pct.toFixed(1)}% YoY`;
      el.className = 'yoy ' + (pct >= 0 ? 'pos' : 'neg');
    }

    if (S().els.statPop) S().els.statPop.textContent = U().fmtNum(pop);
    if (S().els.statPopSrc) S().els.statPopSrc.innerHTML = U().srcLink('DP05', yr, sr, 'DP05', gt, gid);
    setYoy(S().els.statPopYoy, pop, prevProfile?.DP05_0001E);
    if (S().els.statMhi) S().els.statMhi.textContent = U().fmtMoney(mhi);
    if (S().els.statMhiSrc) S().els.statMhiSrc.innerHTML = U().srcLink('DP03', yr, sr, 'DP03', gt, gid);
    setYoy(S().els.statMhiYoy, mhi, prevProfile?.DP03_0062E);
    if (S().els.statHomeValue) S().els.statHomeValue.textContent = U().fmtMoney(homeValue);
    if (S().els.statHomeValueSrc) S().els.statHomeValueSrc.innerHTML = U().srcLink('DP04', yr, sr, 'DP04', gt, gid);
    setYoy(S().els.statHomeValueYoy, homeValue, prevProfile?.DP04_0089E);
    if (S().els.statRent) S().els.statRent.textContent = U().fmtMoney(rent);
    if (S().els.statRentSrc) S().els.statRentSrc.innerHTML = U().srcLink('DP04', yr, sr, 'DP04', gt, gid);
    setYoy(S().els.statRentYoy, rent, prevProfile?.DP04_0134E);

    const owner = Number(profile?.DP04_0046PE);
    const renter = Number(profile?.DP04_0047PE);
    if (S().els.statTenure) S().els.statTenure.textContent = (Number.isFinite(owner) && Number.isFinite(renter)) ? `${owner.toFixed(1)}% / ${renter.toFixed(1)}%` : '—';
    if (S().els.statTenureSrc) S().els.statTenureSrc.innerHTML = U().srcLink('DP04', yr, sr, 'DP04', gt, gid);

    const rb = U().rentBurden30Plus(profile || {});
    if (S().els.statRentBurden) S().els.statRentBurden.textContent = rb === null ? '—' : U().fmtPct(rb);
    if (S().els.statRentBurdenSrc) S().els.statRentBurdenSrc.innerHTML = U().srcLink('DP04', yr, sr, 'DP04', gt, gid);

    const incomeNeed = U().computeIncomeNeeded(homeValue);
    if (S().els.statIncomeNeed) S().els.statIncomeNeed.textContent = incomeNeed ? U().fmtMoney(incomeNeed.annualIncome) : '—';
    if (S().els.statIncomeNeedNote) S().els.statIncomeNeedNote.textContent = incomeNeed ? `Assumes ${Math.round(U().AFFORD.rateAnnual*1000)/10}% rate, ${Math.round(U().AFFORD.downPaymentPct*100)}% down` : '30% of income rule';

    const mean = Number(s0801?.S0801_C01_018E);
    if (S().els.statCommute) S().els.statCommute.textContent = Number.isFinite(mean) ? `${mean.toFixed(1)} min` : '—';
    const commYr = s0801?._acsYear   || yr;
    const commSr = s0801?._acsSeries || sr;
    if (S().els.statCommuteSrc) S().els.statCommuteSrc.innerHTML = U().srcLink('S0801 · mean travel time (min)', commYr, commSr, 'S0801', gt, gid);

    if (S().els.geoContextPill) S().els.geoContextPill.textContent = geoLabel;

    const narrativeParts = [];
    if (pop) narrativeParts.push(`${geoLabel} has an estimated population of ${U().fmtNum(pop)}.`);
    if (mhi) narrativeParts.push(`Median household income is about ${U().fmtMoney(mhi)}.`);
    if (homeValue) narrativeParts.push(`Typical owner-occupied home value is around ${U().fmtMoney(homeValue)}.`);
    if (rent) narrativeParts.push(`Median gross rent is around ${U().fmtMoney(rent)}.`);
    if (rb !== null) narrativeParts.push(`About ${U().fmtPct(rb)} of renter households are cost-burdened (≥30% of income).`);
    if (incomeNeed) narrativeParts.push(`A simple mortgage model suggests roughly ${U().fmtMoney(incomeNeed.annualIncome)} annual income to afford the median home value.`);
    if (S().els.execNarrative) S().els.execNarrative.textContent = narrativeParts.join(' ');

    // Afford assumptions
    if (S().els.affordAssumptions) S().els.affordAssumptions.innerHTML = `
      <ul>
        <li>Interest rate: <strong>${(U().AFFORD.rateAnnual*100).toFixed(2)}%</strong> (fixed), term: <strong>${U().AFFORD.termYears}</strong> years</li>
        <li>Down payment: <strong>${Math.round(U().AFFORD.downPaymentPct*100)}%</strong>; PMI: <strong>${(U().AFFORD.pmiPctAnnual*100).toFixed(2)}%</strong> on loan when down &lt; 20%</li>
        <li>Property tax: <strong>${(U().AFFORD.propertyTaxPctAnnual*100).toFixed(2)}%</strong> of value per year; insurance: <strong>${(U().AFFORD.insurancePctAnnual*100).toFixed(2)}%</strong> of value per year</li>
        <li>Affordability rule: housing costs ≈ <strong>${Math.round(U().AFFORD.paymentToIncome*100)}%</strong> of gross income (rule of thumb)</li>
      </ul>
    `;
  }


  function renderHousingCharts(profile){
    const t = chartTheme();

    // Stock by structure (counts)
    // ACS 2023 confirmed codes (DP04 UNITS IN STRUCTURE starts at DP04_0007E):
    //   DP04_0007E=1-unit detached, DP04_0008E=1-unit attached, DP04_0009E=2 units,
    //   DP04_0010E=3-4 units, DP04_0011E=5-9 units, DP04_0012E=10-19 units,
    //   DP04_0013E=20+ units, DP04_0014E=mobile home
    // Note: in older ACS years this section started at DP04_0003E (now vacancy codes).
    const stock = [
      { k:'1-unit detached', v:Number(profile?.DP04_0007E) },
      { k:'1-unit attached', v:Number(profile?.DP04_0008E) },
      { k:'2 units',         v:Number(profile?.DP04_0009E) },
      { k:'3–4 units',       v:Number(profile?.DP04_0010E) },
      { k:'5–9 units',       v:Number(profile?.DP04_0011E) },
      { k:'10–19 units',     v:Number(profile?.DP04_0012E) },
      { k:'20+ units',       v:Number(profile?.DP04_0013E) },
      { k:'Mobile home',     v:Number(profile?.DP04_0014E) },
    ].filter(d=>Number.isFinite(d.v) && d.v > 0);

    makeChart(document.getElementById('chartStock').getContext('2d'), {
      type:'bar',
      data:{
        labels: stock.map(d=>d.k),
        datasets:[{ label:'Housing units', data: stock.map(d=>d.v) }]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{ labels:{ color:t.text } },
          subtitle:{ display:true, text:'Source: Census ACS DP04', color:t.muted, font:{ size:10 }, padding:{ bottom:4 } }
        },
        scales:{
          x:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
          y:{ ticks:{ color:t.muted }, grid:{ color:t.border },
              title:{ display:true, text:'Housing Units (count)', color:t.muted, font:{ size:11 } } },
        }
      }
    });

    // Tenure donut
    // ACS 2023: DP04_0046PE = owner-occupied %, DP04_0047PE = renter-occupied %
    const owner = Number(profile?.DP04_0046PE);
    const renter = Number(profile?.DP04_0047PE);
    makeChart(document.getElementById('chartTenure').getContext('2d'), {
      type:'doughnut',
      data:{
        labels:['Owner-occupied','Renter-occupied'],
        datasets:[{ data:[owner||0, renter||0] }]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{ legend:{ labels:{ color:t.text } } }
      }
    });
  }


  function renderAffordChart(profile){
    const t = chartTheme();
    const hv = Number(profile?.DP04_0089E);
    const mhi = Number(profile?.DP03_0062E);
    const calc = U().computeIncomeNeeded(hv);

    const needed = calc?.annualIncome ?? null;
    const data = [
      { k:'Median household income', v: Number.isFinite(mhi) ? mhi : null },
      { k:'Income needed to buy (est.)', v: Number.isFinite(needed) ? needed : null },
    ].filter(d=>d.v!==null);

    makeChart(document.getElementById('chartAfford').getContext('2d'), {
      type:'bar',
      data:{ labels:data.map(d=>d.k), datasets:[{ label:'Annual $', data:data.map(d=>d.v) }] },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{ legend:{ labels:{ color:t.text } } },
        scales:{
          x:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
          y:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
        }
      }
    });
  }


  function renderRentBurdenBins(profile){
    const t = chartTheme();
    const bins = [
      { k:'<20%', v:Number(profile?.DP04_0142PE) },
      { k:'20–24.9%', v:Number(profile?.DP04_0143PE) },
      { k:'25–29.9%', v:Number(profile?.DP04_0144PE) },
      { k:'30–34.9%', v:Number(profile?.DP04_0145PE) },
      { k:'35%+', v:Number(profile?.DP04_0146PE) },
    ].filter(d=>Number.isFinite(d.v));

    makeChart(document.getElementById('chartRentBurdenBins').getContext('2d'), {
      type:'bar',
      data:{ labels:bins.map(d=>d.k), datasets:[{ label:'Share of renter households', data:bins.map(d=>d.v) }] },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{ legend:{ labels:{ color:t.text } } },
        scales:{
          x:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
          y:{ ticks:{ color:t.muted, callback:(v)=>v+'%' }, grid:{ color:t.border } },
        }
      }
    });
  }

  /**
   * renderChasAffordabilityGap — render a stacked bar chart showing renter
   * cost burden by AMI tier from HUD CHAS data for the selected county.
   *
   * @param {string} countyFips5 - 5-digit county FIPS (e.g. '08031') or null for statewide
   * @param {object|null} chasData - pre-loaded chas_affordability_gap.json, or null to skip
   */

  function renderChasAffordabilityGap(countyFips5, chasData) {
    const canvas = document.getElementById('chartChasGap');
    const statusEl = document.getElementById('chasGapStatus');
    if (!canvas) return;

    const t = chartTheme();

    const showPlaceholder = (msg) => {
      const box = canvas.parentElement;
      if (box) {
        box.textContent = msg || 'CHAS data unavailable. Run the fetch-chas-data workflow to populate.';
        box.style.cssText = 'display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:.9rem;padding:1rem;min-height:160px';
      }
      if (statusEl) statusEl.textContent = msg || '';
    };

    if (!chasData) { showPlaceholder(); return; }

    // Find the record for the selected geography
    let geoRecord = null;
    if (countyFips5 && chasData.counties) {
      const fips5 = String(countyFips5).padStart(5, '0');
      geoRecord = chasData.counties[fips5] || null;
    }
    if (!geoRecord && chasData.state) {
      geoRecord = chasData.state;  // fall back to statewide
    }
    if (!geoRecord) { showPlaceholder(); return; }

    const tierLabels = (chasData.meta && chasData.meta.tier_labels) || {
      lte30: '\u226430% AMI', '31to50': '31\u201350% AMI',
      '51to80': '51\u201380% AMI', '81to100': '81\u2013100% AMI',
    };
    const AMI_ORDER = ['lte30', '31to50', '51to80', '81to100'];
    const byAmi = geoRecord.renter_hh_by_ami || {};

    const labels = AMI_ORDER.map(k => tierLabels[k] || k);
    const totals           = AMI_ORDER.map(k => (byAmi[k] && byAmi[k].total)              || 0);
    const costBurdened     = AMI_ORDER.map(k => (byAmi[k] && byAmi[k].cost_burdened)       || 0);
    const severelyBurdened = AMI_ORDER.map(k => (byAmi[k] && byAmi[k].severely_burdened)   || 0);
    // Moderately burdened = cost_burdened minus severely_burdened
    const modBurdened      = costBurdened.map((cb, i) => Math.max(0, cb - severelyBurdened[i]));
    const notBurdened      = totals.map((tot, i) => Math.max(0, tot - costBurdened[i]));

    const vintage = (chasData.meta && chasData.meta.vintage) || '';
    const isStub  = !!(chasData.meta && chasData.meta.note && chasData.meta.note.includes('Stub'));
    const geoName = geoRecord.name || 'Selected area';
    if (statusEl) {
      statusEl.textContent = isStub
        ? `Estimated from ACS data (actual CHAS ${vintage} figures load via weekly workflow)`
        : `HUD CHAS ${vintage} data · ${geoName}`;
    }

    const c = t.chartColors;
    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Not burdened',
            data: notBurdened,
            backgroundColor: c[3],
          },
          {
            label: 'Moderately burdened (30\u201350%)',
            data: modBurdened,
            backgroundColor: c[2],
          },
          {
            label: 'Severely burdened (>50%)',
            data: severelyBurdened,
            backgroundColor: c[0],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: t.text } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const val = ctx.parsed.y;
                const tier = AMI_ORDER[ctx.dataIndex];
                const tot  = (byAmi[tier] && byAmi[tier].total) || 0;
                const pct  = tot > 0 ? ((val / tot) * 100).toFixed(1) : '—';
                return `${ctx.dataset.label}: ${U().fmtNum(val)} (${pct}% of tier)`;
              },
            },
          },
        },
        scales: {
          x: { stacked: true, ticks: { color: t.muted }, grid: { color: t.border } },
          y: {
            stacked: true,
            ticks: { color: t.muted, callback: (v) => U().fmtNum(v) },
            grid: { color: t.border },
            title: { display: true, text: 'Renter households', color: t.muted },
          },
        },
      },
    });
  }


  function renderModeShare(s0801){
    const canvas = document.getElementById('chartMode');
    if (!canvas) return;

    const showPlaceholder = (msg) => {
      const box = canvas.parentElement;
      if (box) {
        box.textContent = msg || 'Data unavailable for this geography (ACS S0801 not reported).';
        box.style.cssText = 'display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:.9rem;padding:1rem';
      }
    };

    // Show placeholder when S0801 data is absent or total workers is missing
    if (!s0801 || !s0801.S0801_C01_001E) { showPlaceholder(); return; }

    const t = chartTheme();
    const totalWorkers = Number(s0801.S0801_C01_001E);
    if (!Number.isFinite(totalWorkers) || totalWorkers <= 0) { showPlaceholder(); return; }

    // ACS S0801 C01 column — individual mode shares as percentages of total workers.
    // 002E is the car/truck/van PARENT total (drove-alone + carpooled); it is not
    // displayed as its own bar because 003E and 004E already capture each sub-mode.
    // 008E (worked at home) is present in live Census fetches; gracefully absent from
    // cached files that pre-date this variable being added to the fetch list.
    // Per Rule 10: colors drawn from var(--chart-*) tokens in chartTheme().chartColors
    const c = t.chartColors;
    const items = [
      { k:'Drove alone',    v: Number(s0801.S0801_C01_003E), color: c[0] },
      { k:'Carpool',        v: Number(s0801.S0801_C01_004E), color: c[1] },
      { k:'Transit',        v: Number(s0801.S0801_C01_005E), color: c[2] },
      { k:'Walk',           v: Number(s0801.S0801_C01_006E), color: c[4] },
      { k:'Other',          v: Number(s0801.S0801_C01_007E), color: c[3] },
      { k:'Work from home', v: Number(s0801.S0801_C01_008E), color: c[5] },
    ].filter(d => Number.isFinite(d.v) && d.v > 0);

    if (items.length === 0) { showPlaceholder(); return; }

    const workerLabel = `${U().fmtNum(totalWorkers)} workers 16+`;
    const modeYear   = s0801._acsYear   || ACS_YEAR_PRIMARY;
    const modeSeries = s0801._acsSeries || 'acs1';
    const seriesLabel = modeSeries === 'acs1' ? 'ACS1' : 'ACS5';

    makeChart(canvas.getContext('2d'), {
      type:'bar',
      data:{
        labels: items.map(d=>d.k),
        datasets:[{
          label:'% of workers',
          data: items.map(d=>d.v),
          backgroundColor: items.map(d=>d.color),
        }]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{ labels:{ color:t.text } },
          subtitle:{ display:true, text:`${seriesLabel} ${modeYear} S0801 · mode shares (% of workers 16+) · ${workerLabel}`, color:t.muted, font:{ size:10 }, padding:{ bottom:4 } },
          tooltip:{
            callbacks:{
              label:(ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`,
            },
          },
        },
        scales:{
          x:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
          y:{ ticks:{ color:t.muted, callback:(v)=>v+'%' }, grid:{ color:t.border }, suggestedMax:100,
              title:{ display:true, text:'Mode Share (% of workers)', color:t.muted, font:{ size:11 } } },
        },
      },
    });
  }


  function renderLehd(lehd, geoType, geoid){
    const t = chartTheme();
    const inflow = Number(lehd?.inflow);
    const outflow = Number(lehd?.outflow);
    const within = Number(lehd?.within);

    // For state-level data the inflow/outflow fields are aggregated from county OD files and
    // overcount internal (inter-county) commuting. Only show cross-state commuting note.
    const isState = geoType === 'state';

    const items = isState
      ? [
          { k:'Live & work in Colorado', v: within },
        ].filter(d=>Number.isFinite(d.v))
      : [
          { k:'Inflow (work here, live elsewhere)', v: inflow },
          { k:'Outflow (live here, work elsewhere)', v: outflow },
          { k:'Within (live & work here)', v: within },
        ].filter(d=>Number.isFinite(d.v));

    makeChart(document.getElementById('chartLehd').getContext('2d'), {
      type:'bar',
      data:{ labels:items.map(d=>d.k), datasets:[{ label:'Jobs (count)', data:items.map(d=>d.v) }] },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{ legend:{ labels:{ color:t.text } } },
        scales:{
          x:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
          y:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
        }
      }
    });

    if (isState){
      S().els.lehdNote.textContent = (lehd?.year
        ? `LEHD LODES OD summary (JT00) for Colorado statewide, year ${lehd.year}. `
        : 'LEHD LODES OD summary — Colorado statewide aggregate. ') +
        'At the state level, inflow/outflow figures reflect inter-county commuting aggregated from county files and are not shown here to avoid double-counting. ' +
        'Select a county to see accurate commuting flows.';
    } else if (geoType !== 'county'){
      S().els.lehdNote.textContent = `Note: LEHD inflow/outflow is currently shown at the containing county level (${U().countyFromGeoid(geoType, geoid)}). Place/CDP crosswalk can be added to refine this.`;
    } else {
      S().els.lehdNote.textContent = lehd?.year ? `LEHD LODES OD summary (JT00) for workplaces in ${geoid}, year ${lehd.year}.` : 'LEHD LODES OD summary.';
    }

    // Show prominent vintage banner so users know the data year and publication lag.
    if (S().els.lehdVintageBanner && S().els.lehdVintageYear && lehd?.year) {
      S().els.lehdVintageYear.textContent = lehd.year;
      S().els.lehdVintageBanner.style.display = '';
    }
  }


  function renderDolaPyramid(dola){
    const t = chartTheme();

    const year = dola?.pyramidYear;
    const male = dola?.male || [];
    const female = dola?.female || [];
    const ages = dola?.ages || [];

    // Build pyramid (male negative)
    const maleNeg = male.map(v=>-1*Number(v||0));
    const femalePos = female.map(v=>Number(v||0));

    makeChart(document.getElementById('chartPyramid').getContext('2d'), {
      type:'bar',
      data:{
        labels: ages,
        datasets:[
          { label:'Male', data: maleNeg },
          { label:'Female', data: femalePos },
        ]
      },
      options:{
        indexAxis:'y',
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{ labels:{ color:t.text } },
          tooltip:{ callbacks:{ label:(ctx)=> `${ctx.dataset.label}: ${U().fmtNum(Math.abs(ctx.raw))}` } }
        },
        scales:{
          x:{ ticks:{ color:t.muted, callback:(v)=>U().fmtNum(Math.abs(v)) }, grid:{ color:t.border } },
          y:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
        }
      }
    });

    const s = dola?.seniorPressure;
    if (s){
      makeChart(document.getElementById('chartSenior').getContext('2d'), {
        type:'line',
        data:{
          labels: s.years,
          datasets:[
            {
              label:'Age 65+ (count)',
              data: s.pop65plus,
              yAxisID: 'yCount',
              borderColor: t.chartColors[0] || '#1e5799',
              backgroundColor: 'transparent',
              tension: 0.3,
            },
            {
              label:'Share 65+ (%)',
              data: s.share65plus,
              yAxisID: 'yPct',
              borderColor: t.chartColors[2] || '#096e65',
              backgroundColor: 'transparent',
              borderDash: [4, 3],
              tension: 0.3,
            },
          ]
        },
        options:{
          responsive:true,
          maintainAspectRatio:false,
          plugins:{ legend:{ labels:{ color:t.text } } },
          scales:{
            x:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
            yCount:{
              type:'linear',
              position:'left',
              ticks:{ color:t.muted, callback:(v)=>U().fmtNum(v) },
              grid:{ color:t.border },
              title:{ display:true, text:'Count', color:t.muted },
            },
            yPct:{
              type:'linear',
              position:'right',
              ticks:{ color:t.muted, callback:(v)=>v.toFixed(1)+'%' },
              grid:{ drawOnChartArea:false },
              title:{ display:true, text:'Share (%)', color:t.muted },
            },
          }
        }
      });

      const geoLabel = dola.stateFips ? 'Colorado statewide' : 'county';
      // Calculate the growth in senior share between first and last available years
      const firstShare = Array.isArray(s.share65plus) ? s.share65plus[0] : null;
      const lastShare  = Array.isArray(s.share65plus) ? s.share65plus[s.share65plus.length - 1] : null;
      const shareChangePts = (firstShare !== null && lastShare !== null && Number.isFinite(firstShare) && Number.isFinite(lastShare))
        ? parseFloat((lastShare - firstShare).toFixed(1)) : null;
      let changeNote = '';
      if (shareChangePts !== null && shareChangePts !== 0) {
        changeNote = ` The 65+ share ${shareChangePts > 0 ? 'increased' : 'decreased'} by ${Math.abs(shareChangePts)} percentage points over the projection period.`;
      } else if (shareChangePts === 0) {
        changeNote = ' The 65+ share is projected to remain stable over the projection period.';
      }
      S().els.seniorNote.textContent = `Senior pressure uses ${geoLabel} single-year-of-age totals. Pyramid year: ${year || '—'}.${changeNote}`;
    } else {
      S().els.seniorNote.textContent = 'Senior pressure data not available yet.';
    }
  }

  /**
   * Clear projection stat cards and set an informative note for geography types
   * (such as state-level) where county-based projections do not apply.
   * @returns {{ ok: boolean }}
   */

  function clearProjectionsForStateLevel() {
    S().state.lastProj = null;
    S().els.statBaseUnits.textContent = '—';
    S().els.statTargetVac.textContent = '—';
    S().els.statUnitsNeed.textContent = '—';
    S().els.statNetMig.textContent = '—';
    S().els.needNote.textContent = 'Demographic projections are available at the county level. Select a county to view housing need estimates.';
    return { ok: false };
  }


  function getAssumptions(){
    const horizon = Number(S().els.assumpHorizon?.value || 20);
    const vacPct = Number(S().els.assumpVacancy?.value || 5);
    const targetVac = vacPct/100.0;
    const headshipMode = (document.getElementById('assumpHeadship')?.value || document.querySelector('input[name="assumpHeadship"]:checked')?.value || 'hold');
    return { horizon, targetVac, headshipMode };
  }

  // Returns the currently selected scenario key from the projScenario dropdown.
  function getSelectedScenario(){
    const el = document.getElementById('projScenario');
    return el ? el.value : 'baseline';
  }

  // Returns the current slider override values for the demographic rate assumptions.
  function getScenarioRateOverrides(){
    const fertility = parseFloat((document.getElementById('scenFertility') || {}).value);
    const migration = parseFloat((document.getElementById('scenMigration') || {}).value);
    const mortality = parseFloat((document.getElementById('scenMortality') || {}).value);
    return {
      fertilityMultiplier: Number.isFinite(fertility) ? fertility : 1.0,
      netMigrationAnnual:  Number.isFinite(migration) ? migration : 500,
      mortalityMultiplier: Number.isFinite(mortality) ? mortality : 1.0,
    };
  }

  function _renderScenarioSection(proj, popSel, years, baseYear, geoid, t){
    const SCENARIO_HORIZON = 10; // years forward for the 5–10 year section

    // Find the index of the base year in the years array
    const baseIdx = years.indexOf(baseYear);
    const basePop0 = (baseIdx >= 0 && popSel[baseIdx] !== null) ? popSel[baseIdx]
                   : popSel.find(v => v !== null) || null;

    // Guard: skip all scenario chart rendering if no valid base population exists
    if (basePop0 === null || basePop0 === 0) return;

    // Pre-compute a share factor array so household/demand charts scale with
    // the selected geography when it is a place or CDP (where popSel has already
    // been scaled from the county DOLA baseline by applyAssumptions).
    // For county or state selections, popCounty === popSel so share is always 1.
    const popCounty = (proj?.population_dola || []).map(v => (v !== null && v !== undefined) ? Number(v) : null);
    const shareFactors = years.map((_, i) => {
      const sel = popSel[i];
      const cty = popCounty[i];
      if (sel !== null && cty && Number.isFinite(sel) && Number.isFinite(cty) && cty > 0) {
        // Clamp to [0, 1]: sel should never exceed cty (a place cannot be larger than
        // its containing county), but floating-point rounding in applyAssumptions can
        // produce values marginally above 1. The clamp prevents demand overestimates.
        return Math.min(1, Math.max(0, sel / cty));
      }
      return 1; // fallback: no scaling (county/state)
    });

    // Growth multipliers per scenario: applied to the *delta* from the base year
    // so low/high scenarios diverge progressively from the same starting point.
    const GROWTH_MULT = { baseline: 1.0, low_growth: 0.55, high_growth: 1.5 };

    // Build a synthetic {year, population} series for each scenario using
    // the DOLA baseline as the reference trajectory.
    function buildScenarioSeries(multiplier){
      const out = [];
      let count = 0;
      for (let i = 0; i < years.length; i++){
        if (years[i] < baseYear) continue;
        if (count > SCENARIO_HORIZON) break;
        const baselineVal = popSel[i];
        if (baselineVal === null) continue;
        const delta = baselineVal - basePop0;
        out.push({ year: years[i], population: Math.max(0, Math.round(basePop0 + delta * multiplier)) });
        count++;
      }
      return out;
    }

    const seriesByScenario = {};
    ['baseline', 'low_growth', 'high_growth'].forEach(sc => {
      seriesByScenario[sc] = buildScenarioSeries(GROWTH_MULT[sc]);
    });

    // Include custom scenario if the user has saved one.
    // The effective growth multiplier is a weighted combination of the three
    // demographic rate overrides: migration (60% weight), fertility (30%), mortality (10%).
    // The baseline annual net migration of 500 is the median of the three built-in scenarios.
    if (U().PROJECTION_SCENARIOS['custom']){
      const overrides = getScenarioRateOverrides();
      const BASELINE_NET_MIGRATION = 500; // persons/year — median across the three built-in scenarios
      // Weights: migration dominates CO county growth (60%), fertility secondary (30%), mortality minor (10%)
      const MIG_WEIGHT  = 0.6;
      const FERT_WEIGHT = 0.3;
      const MORT_WEIGHT = 0.1;
      const migMult = Number.isFinite(overrides.netMigrationAnnual / BASELINE_NET_MIGRATION)
        ? overrides.netMigrationAnnual / BASELINE_NET_MIGRATION : 1;
      // Mortality inverts: multiplier > 1 means higher mortality → lower effective growth
      const mortAdjust = 2.0 - overrides.mortalityMultiplier; // 1.0 when mortality = 1.0 (neutral)
      const effectiveMult = migMult * MIG_WEIGHT
                          + overrides.fertilityMultiplier * FERT_WEIGHT
                          + mortAdjust * MORT_WEIGHT;
      seriesByScenario['custom'] = buildScenarioSeries(effectiveMult);
    }

    // chartScenarioComparison — base scenarios + custom if saved
    const scenCompCanvas = document.getElementById('chartScenarioComparison');
    if (scenCompCanvas){
      const compScenarios = ['baseline', 'low_growth', 'high_growth'];
      if (U().PROJECTION_SCENARIOS['custom'] && seriesByScenario['custom']){
        compScenarios.push('custom');
      }
      renderScenarioComparison(geoid || '', compScenarios, {
        canvas: scenCompCanvas,
        seriesByScenario,
        years: SCENARIO_HORIZON,
      });
    }

    // chartProjectionDetail — single selected scenario
    const sc = getSelectedScenario();
    const detailCanvas = document.getElementById('chartProjectionDetail');
    if (detailCanvas){
      renderProjectionChart(geoid || '', sc, SCENARIO_HORIZON, {
        canvas: detailCanvas,
        basePopSeries: seriesByScenario[sc] || seriesByScenario.baseline,
      });
    }

    // chartProjectedHH — household projection.
    // For place/CDP selections the county households_dola series is scaled by
    // the same share factor used for the population series so that the chart
    // represents the selected geography, not the containing county.
    const hhCanvas = document.getElementById('chartProjectedHH');
    if (hhCanvas){
      const hhDola = proj?.housing_need?.households_dola || [];
      const hhSeries = [];
      let hhCount = 0;
      for (let i = 0; i < years.length; i++){
        if (years[i] < baseYear) continue;
        if (hhCount > SCENARIO_HORIZON) break;
        const v = hhDola[i] !== undefined ? Number(hhDola[i]) : null;
        const scaledV = (Number.isFinite(v) && shareFactors[i] !== undefined)
          ? Math.round(v * shareFactors[i])
          : null;
        hhSeries.push({ year: years[i], households: scaledV });
        hhCount++;
      }
      makeChart(hhCanvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: hhSeries.map(d => d.year),
          datasets: [{
            label: 'Households (DOLA forecast)',
            data:  hhSeries.map(d => d.households),
            borderColor: U().PROJECTION_SCENARIOS.baseline.color,
            backgroundColor: U().PROJECTION_SCENARIOS.baseline.color + '22',
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.25,
            fill: true,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: t.text } },
            tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${U().fmtNum(ctx.parsed.y)}` } },
          },
          scales: {
            x: { ticks: { color: t.muted }, grid: { color: t.border } },
            y: { ticks: { color: t.muted }, grid: { color: t.border } },
          },
        },
      });
    }

    // chartHouseholdDemand — housing demand by AMI tier.
    // Synthesise demand series from households * fixed AMI-tier income shares.
    // For place/CDP selections the county households_dola series is scaled
    // using the same share factor computed above.
    // These statewide CO defaults (from ACS CHAS approximations) are used when
    // county-specific ETL data is not available; county-level data from
    // data/hna/derived/geo-derived.json takes precedence when present.
    const demandCanvas = document.getElementById('chartHouseholdDemand');
    if (demandCanvas){
      const hhDola = proj?.housing_need?.households_dola || [];
      // Statewide CO renter share (ACS 5-year): ~35% of households rent
      const RENTER_SHARE = 0.35;
      // Statewide income-tier distribution for renter households (ACS CHAS CO defaults)
      const tierShares = { '30_ami': 0.13, '50_ami': 0.17, '80_ami': 0.25,
                           '100_ami': 0.20, '120_ami': 0.15, 'above_120_ami': 0.10 };
      const demandSeries = [];
      let dsCount = 0;
      for (let i = 0; i < years.length; i++){
        if (years[i] < baseYear) continue;
        if (dsCount > SCENARIO_HORIZON) break;
        const hh = hhDola[i] !== undefined ? Number(hhDola[i]) : null;
        const scaledHH = (Number.isFinite(hh) && shareFactors[i] !== undefined)
          ? hh * shareFactors[i]
          : hh;
        if (!Number.isFinite(scaledHH)){ dsCount++; continue; }
        const renters = scaledHH * RENTER_SHARE;
        const demand_by_ami = { renter: {} };
        Object.keys(tierShares).forEach(tier => {
          demand_by_ami.renter[tier] = Math.round(renters * tierShares[tier]);
        });
        demandSeries.push({ year_offset: dsCount, demand_by_ami });
        dsCount++;
      }
      renderHouseholdDemand(geoid || '', sc, Object.keys(U().AMI_TIER_LABELS), {
        canvas: demandCanvas,
        demandSeries,
        tenure: 'renter',
      });
    }

    // Save seriesByScenario to shared state so the CSV export function can read it.
    if (S().state) {
      S().state.lastScenarioSeries = seriesByScenario;
      S().state.lastBaseYear = baseYear;
    }

    // Update freshness badge with the data vintage year.
    const freshnessBadge = document.getElementById('scenarioFreshnessBadge');
    if (freshnessBadge && baseYear) {
      freshnessBadge.textContent = `${baseYear} vintage`;
      freshnessBadge.hidden = false;
    }

    // Show a data quality notice when the projection is synthesised from DOLA
    // county baselines (i.e. the geography is a place or CDP, not a county).
    const dqEl = document.getElementById('scenarioDataQuality');
    if (dqEl) {
    // Detect synthetic projections: shareFactors < 1 when geography is a place
    // or CDP (where popSel is scaled from the containing county's DOLA baseline).
    // For county/state selections popSel === popCounty so all share factors = 1.
    const isSynthetic = shareFactors.some(sf => sf < 1);
      if (isSynthetic) {
        dqEl.textContent = '⚠ Projections are estimated by scaling county-level DOLA data. Place/CDP-specific data may differ.';
        dqEl.className = 'scenario-data-quality dq-warn';
        dqEl.hidden = false;
      } else {
        dqEl.textContent = '✓ Projections use county-level DOLA SDO cohort-component data directly.';
        dqEl.className = 'scenario-data-quality';
        dqEl.hidden = false;
      }
    }

    // Update the scenario need summary panel with structured comparison data.
    const summaryEl = document.getElementById('scenarioNeedSummary');
    if (summaryEl && seriesByScenario.baseline && seriesByScenario.baseline.length) {
      const endIdx = seriesByScenario.baseline.length - 1;
      const endYear = seriesByScenario.baseline[endIdx].year;
      const baselinePop = seriesByScenario.baseline[endIdx].population;
      const lowPop = (seriesByScenario.low_growth || [])[endIdx]?.population;
      const highPop = (seriesByScenario.high_growth || [])[endIdx]?.population;
      const fmt = U().fmtNum;
      const vintage = baseYear || new Date().getFullYear();

      // Build structured comparison grid (one column per scenario)
      const cols = [
        { sc: 'baseline',    label: 'Baseline',    pop: baselinePop },
        { sc: 'low_growth',  label: 'Low growth',  pop: lowPop },
        { sc: 'high_growth', label: 'High growth', pop: highPop },
      ].filter(c => c.pop !== undefined && c.pop !== null);

      const gridHTML = cols.map(c =>
        `<div class="scenario-summary-col"><p class="sc-label">${c.label}</p><p class="sc-value">${fmt(c.pop)}</p></div>`
      ).join('');

      summaryEl.innerHTML =
        `<strong>By ${endYear} projected population</strong>` +
        `<div class="scenario-summary-grid">${gridHTML}</div>` +
        `<p style="margin:6px 0 0;font-size:.8rem;color:var(--muted)">Source: DOLA SDO ${vintage} vintage, cohort-component model.</p>`;
      summaryEl.style.display = '';
    }
  }


  // ---------------------------------------------------------------------------
  // Demographic / scenario projection visualization helpers
  // ---------------------------------------------------------------------------

  // Scenario metadata loaded once from the embedded JSON (avoids a network request).

  function renderProjectionChart(geoid, scenario, years, opts){
    if (!opts || !opts.canvas) return;
    const ctx = opts.canvas.getContext('2d');
    const scenarioMeta = U().PROJECTION_SCENARIOS[scenario] || U().PROJECTION_SCENARIOS.baseline;
    const t = chartTheme();

    // Build a synthetic forward series from the basePopSeries if provided,
    // or fall back to a placeholder so the chart always renders.
    const basePopSeries = opts.basePopSeries || [];
    const labels  = [];
    const values  = [];

    // Determine the base year from available data or current year
    const nowYear = new Date().getFullYear();
    const baseYear = (basePopSeries.length > 0 && basePopSeries[0].year)
      ? Number(basePopSeries[0].year)
      : nowYear;

    // Use the provided data series where available, then extend to horizon
    const dataByYear = {};
    basePopSeries.forEach(pt => { dataByYear[Number(pt.year)] = Number(pt.population) || null; });

    for (let y = baseYear; y <= baseYear + years; y++){
      labels.push(y);
      values.push(dataByYear[y] !== undefined ? dataByYear[y] : null);
    }

    makeChart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: `Population — ${scenarioMeta.label}`,
          data:   values,
          borderColor: scenarioMeta.color,
          backgroundColor: scenarioMeta.color + '22',
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.25,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: t.text } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${U().fmtNum(ctx.parsed.y)}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: t.muted }, grid: { color: t.border } },
          y: { ticks: { color: t.muted }, grid: { color: t.border } },
        },
      },
    });
  }

  /**
   * renderScenarioComparison — draw a multi-line chart comparing several
   * projection scenarios on a single axis.
   *
   * @param {string}   geoid          - 5-digit county or place FIPS
   * @param {string[]} scenario_names - array of scenario keys to compare
   * @param {Object}   opts
   * @param {Element}  opts.canvas        - <canvas> element
   * @param {Object}   opts.seriesByScenario - {scenarioKey: [{year, population}, ...], ...}
   * @param {number}   [opts.years=10]   - projection horizon
   */

  function renderScenarioComparison(geoid, scenario_names, opts){
    if (!opts || !opts.canvas) return;
    const ctx  = opts.canvas.getContext('2d');
    const t    = chartTheme();
    const years = opts.years || 10;
    const seriesByScenario = opts.seriesByScenario || {};

    const nowYear  = new Date().getFullYear();
    const allYears = new Set();
    scenario_names.forEach(sc => {
      (seriesByScenario[sc] || []).forEach(pt => allYears.add(Number(pt.year)));
    });
    if (!allYears.size){
      for (let y = nowYear; y <= nowYear + years; y++) allYears.add(y);
    }
    const labels = Array.from(allYears).sort((a,b) => a-b);

    const datasets = scenario_names.map(sc => {
      const meta   = U().PROJECTION_SCENARIOS[sc] || U().PROJECTION_SCENARIOS.baseline;
      const series = seriesByScenario[sc] || [];
      const byYear = {};
      series.forEach(pt => { byYear[Number(pt.year)] = Number(pt.population) || null; });
      const data = labels.map(y => byYear[y] !== undefined ? byYear[y] : null);
      return {
        label: meta.label,
        data,
        borderColor: meta.color,
        borderWidth: 2,
        pointRadius: 2,
        tension: 0.25,
        fill: false,
      };
    });

    makeChart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: t.text } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${U().fmtNum(ctx.parsed.y)}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: t.muted }, grid: { color: t.border } },
          y: { ticks: { color: t.muted }, grid: { color: t.border } },
        },
      },
    });
  }

  /**
   * renderHouseholdDemand — draw a stacked bar chart of projected housing demand
   * broken out by affordability tier (AMI bands) for owner and renter segments.
   *
   * @param {string}   geoid               - 5-digit FIPS
   * @param {string}   scenario            - scenario key
   * @param {string[]} affordability_tiers - subset of AMI tier keys to display
   * @param {Object}   opts
   * @param {Element}  opts.canvas          - <canvas> element
   * @param {Array}    opts.demandSeries    - array of demand-projection records:
   *                                          [{year_offset, demand_by_ami: {owner: {...}, renter: {...}}}, ...]
   * @param {string}   [opts.tenure='renter'] - 'owner' | 'renter' | 'both'
   */

  function renderHouseholdDemand(geoid, scenario, affordability_tiers, opts){
    if (!opts || !opts.canvas) return;
    const ctx    = opts.canvas.getContext('2d');
    const t      = chartTheme();
    const tenure = opts.tenure || 'renter';
    const demandSeries = opts.demandSeries || [];

    const tiers  = Array.isArray(affordability_tiers) && affordability_tiers.length
      ? affordability_tiers
      : Object.keys(U().AMI_TIER_LABELS);

    const labels   = demandSeries.map(d => `Year +${d.year_offset}`);
    const datasets = tiers.map(tier => {
      const data = demandSeries.map(d => {
        if (!d.demand_by_ami) return 0;
        if (tenure === 'both'){
          return ((d.demand_by_ami.owner || {})[tier] || 0) +
                 ((d.demand_by_ami.renter || {})[tier] || 0);
        }
        return (d.demand_by_ami[tenure] || {})[tier] || 0;
      });
      return {
        label: U().AMI_TIER_LABELS[tier] || tier,
        data,
        backgroundColor: U().AMI_TIER_COLORS[tier] || '#999',
      };
    });

    makeChart(ctx, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: t.text } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${U().fmtNum(Math.round(ctx.parsed.y))}`,
            },
          },
        },
        scales: {
          x: { stacked: true, ticks: { color: t.muted }, grid: { color: t.border } },
          y: { stacked: true, ticks: { color: t.muted }, grid: { color: t.border } },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Scenario selector and demographic-rate sliders
  // ---------------------------------------------------------------------------

  // Scenario selector state

  function renderLocalResources(geoType, geoid){
    const data = window.__HNA_LOCAL_RESOURCES || {};
    const key = `${geoType}:${geoid}`;
    const r = data[key];

    if (!r){
      S().els.localResources.innerHTML = `
        <p>No curated resources yet for this geography.</p>
        <ul>
          <li><a href="${U().SOURCES.prop123Commitments}" target="_blank" rel="noopener">Prop 123 commitment filings (DOLA)</a></li>
          <li><a href="https://cdola.colorado.gov/prop123" target="_blank" rel="noopener">Proposition 123 overview (DOLA)</a></li>
        </ul>
      `;
      return;
    }

    const parts = [];
    if (r.prop123){
      parts.push(`<p><strong>Proposition 123:</strong> ${r.prop123.status || 'Unknown'} ${r.prop123.link ? `(<a href="${r.prop123.link}" target="_blank" rel="noopener">source</a>)` : ''}</p>`);
    }
    if (r.housingPlans?.length){
      parts.push(`<p><strong>Housing plans &amp; assessments:</strong></p><ul>${r.housingPlans.map(x=>{
        const label = x.year ? `${x.name} (${x.year})` : x.name;
        const typeTag = x.type ? ` <span style="color:var(--muted);font-size:.85em">[${x.type}]</span>` : '';
        return x.url
          ? `<li><a href="${x.url}" target="_blank" rel="noopener">${label}</a>${typeTag}</li>`
          : `<li>${label}${typeTag}</li>`;
      }).join('')}</ul>`);
    }
    if (r.contacts?.length){
      parts.push(`<p><strong>Key contacts:</strong></p><ul>${r.contacts.map(x=>{
        const nameStr = x.url ? `<a href="${x.url}" target="_blank" rel="noopener">${x.name}</a>` : x.name;
        const detail = [x.title, x.jurisdiction].filter(Boolean).join(', ');
        return `<li>${nameStr}${detail ? ` — ${detail}` : ''}</li>`;
      }).join('')}</ul>`);
    }
    if (r.housingAuthority?.length){
      parts.push(`<p><strong>Local housing authority:</strong></p><ul>${r.housingAuthority.map(x=>`<li><a href="${x.url}" target="_blank" rel="noopener">${x.name}</a></li>`).join('')}</ul>`);
    }
    if (r.advocacy?.length){
      parts.push(`<p><strong>Homeless / housing advocacy:</strong></p><ul>${r.advocacy.map(x=>`<li><a href="${x.url}" target="_blank" rel="noopener">${x.name}</a></li>`).join('')}</ul>`);
    }
    if (r.housingLead){
      parts.push(`<p><strong>Housing contact (if published):</strong> <a href="${r.housingLead.url}" target="_blank" rel="noopener">${r.housingLead.name}</a></p>`);
    }

    S().els.localResources.innerHTML = parts.join('\n');
  }


  function renderMethodology(state){
    const { geoType, geoid, geoLabel, usedCountyForContext, cacheFlags, derivedEntry } = state;

    const items = [];

    items.push({
      title: 'Geography & S().map boundary',
      html: `Boundary geometry is retrieved from Census TIGERweb and rendered with Leaflet. ` +
            `<a href="${U().SOURCES.tigerweb}" target="_blank" rel="noopener">TIGERweb docs</a>.`
    });

    items.push({
      title: 'Housing stock, tenure, income, rents',
      html: `Baseline indicators use Census ACS Profile tables (DP03/DP04/DP05). ` +
            `<a href="${U().SOURCES.acsProfile}" target="_blank" rel="noopener">ACS profile groups</a>.`
    });

    items.push({
      title: 'Rent burden',
      html: `Rent burden distribution uses ACS profile gross rent as % of income bins (GRAPI). ` +
            `The page reports renter burden ≥30% as the sum of the 30–34.9% and 35%+ bins.`
    });

    items.push({
      title: 'Affordability model',
      html: `"Income needed to buy" is a transparent mortgage approximation using ACS median home value, ` +
            `a fixed-rate amortization, and simple tax/insurance/PMI assumptions shown on the page. ` +
            `This is a screening metric, not an underwriting decision.`
    });

    items.push({
      title: 'Commuting (ACS)',
      html: `Mode shares and mean commute time use ACS Subject Table S0801. ` +
            `<a href="${U().SOURCES.acsS0801}" target="_blank" rel="noopener">S0801 group</a>.`
    });

    // Helper to generate geography-context note for county-level data sections in methodology.
    function countyContextNote(stateNote, placeNote) {
      if (geoType === 'state') return stateNote;
      if (geoType !== 'county') return placeNote;
      return '';
    }

    items.push({
      title: 'Commuting flows (LEHD)',
      html: `Inflow/outflow/within are derived from LEHD LODES OD (JT00) aggregated to county. ` +
            `<a href="${U().SOURCES.lodesRoot}" target="_blank" rel="noopener">LODES downloads</a> and ` +
            `<a href="${U().SOURCES.lodesTech}" target="_blank" rel="noopener">technical documentation</a>. ` +
            countyContextNote(
              'County-level LEHD data is available after selecting a county.',
              `For this selection, flows are shown at the containing county level (${usedCountyForContext}).`
            )
    });

    items.push({
      title: 'Demographic projections (DOLA/SDO)',
      html: `Age pyramid and senior pressure use Colorado State Demography Office (DOLA) single-year-of-age county files. ` +
            `<a href="${U().SOURCES.sdoDownloads}" target="_blank" rel="noopener">SDO data downloads</a> and ` +
            `<a href="${U().SOURCES.sdoPopulation}" target="_blank" rel="noopener">population resources</a>. ` +
            countyContextNote(
              'Select a county to view county-level age pyramid data.',
              `Shown as county context (${usedCountyForContext}).`
            )
    });

    items.push({
      title: '20-year outlook (population, migration, housing need)',
      html: `Population and net migration use SDO county components-of-change (estimates + forecast), and base-year households/units use SDO county profiles. ` +
            `<a href="${U().SOURCES.sdoDownloads}" target="_blank" rel="noopener">SDO downloads</a>. ` +
            `Housing need is computed by converting population to households using a base-year headship rate, then applying a target vacancy assumption. ` +
            countyContextNote(
              'Select a county to view county-level projection data.',
              `Shown as county context (${usedCountyForContext}).`
            )
    });

    if (derivedEntry && derivedEntry.derived){
      const d = derivedEntry.derived;
      const s = derivedEntry.sources || {};
      const yrs = state.derivedYears || null;

      const rows = [
        ['Population share of county (share0)', (typeof d.share0==='number') ? U().fmtPct(d.share0*100) : '—'],
        ['Pop growth (annual, ACS5)', (typeof d.pop_cagr==='number') ? U().fmtPct(d.pop_cagr*100) : '—'],
        ['County pop growth (annual, ACS5)', (typeof d.county_pop_cagr==='number') ? U().fmtPct(d.county_pop_cagr*100) : '—'],
        ['Relative growth (place − county)', (typeof d.relative_pop_cagr==='number') ? U().fmtPct(d.relative_pop_cagr*100) : '—'],
        ['Headship base (households ÷ pop)', (typeof d.headship_base==='number') ? (d.headship_base.toFixed(4)) : '—'],
        ['Headship slope (per year)', (typeof d.headship_slope_per_year==='number') ? (d.headship_slope_per_year.toFixed(6)) : '—'],
      ];

      const srcHtml = (s.acs5_y0_url && s.acs5_y1_url)
        ? `Source queries: <a href="${s.acs5_y0_url}" target="_blank" rel="noopener">ACS5 y0</a>, `+
          `<a href="${s.acs5_y1_url}" target="_blank" rel="noopener">ACS5 y1</a>.`
        : 'Source queries: —';

      items.push({
        title: 'Projection scaling inputs (precomputed)',
        html: `These inputs are generated by the repo ETL so reviewers can reproduce municipal scaling and headship trend assumptions. ` +
             `${yrs ? `Years: ${yrs.y0}→${yrs.y1}. ` : ''}` +
             `${srcHtml}` +
             `<div style="margin-top:8px; overflow:auto">
                <table class="hna-table" style="width:100%; border-collapse:collapse">
                  <tbody>
                    ${rows.map(r=>`<tr><td style="padding:6px 8px; border-bottom:1px solid var(--border);"><strong>${r[0]}</strong></td><td style="padding:6px 8px; border-bottom:1px solid var(--border);">${r[1]}</td></tr>`).join('')}
                  </tbody>
                </table>
              </div>`
      });
    }

    // Cache status
    const cacheBits = [];
    if (cacheFlags.summary) cacheBits.push('summary cache');
    if (cacheFlags.lehd) cacheBits.push('LEHD cache');
    if (cacheFlags.dola) cacheBits.push('DOLA SDO cache');
    if (cacheFlags.projections) cacheBits.push('projections cache');
    if (cacheFlags.derived) cacheBits.push('derived inputs');

    items.push({
      title: 'LIHTC (Low-Income Housing Tax Credit)',
      html: `For Colorado, LIHTC project data is loaded from the canonical local file ` +
            `<strong>data/chfa-lihtc.json</strong> (kept current by the CI workflow). ` +
            `If that file is absent (HTTP 404), the system falls back to the ` +
            `<strong>CHFA ArcGIS FeatureServer</strong> (Colorado Housing and Finance Authority), ` +
            `then to the HUD LIHTC database via ArcGIS REST service. ` +
            `For all other states, HUD ArcGIS is the live source. ` +
            `An embedded Colorado fallback dataset is used when all other sources are unavailable. ` +
            `The active data source is displayed as a badge on the LIHTC project list and in each project popup. ` +
            `Red circle markers on the S().map indicate LIHTC-funded properties. ` +
            `<a href="${U().SOURCES.lihtcDb}" target="_blank" rel="noopener">HUD LIHTC database</a>.`
    });

    items.push({
      title: 'QCT (Qualified Census Tracts)',
      html: `Qualified Census Tracts are census tracts where ≥50% of households have incomes below 60% of Area ` +
            `Median Income, or the poverty rate is ≥25%. HUD designates QCTs annually; LIHTC projects in QCTs ` +
            `may receive a 30% basis boost. QCT tract boundaries are fetched from the HUD ArcGIS REST service ` +
            `and shown as orange overlays on the S().map. ` +
            `<a href="${U().SOURCES.hudQct}" target="_blank" rel="noopener">HUD QCT dataset</a>.`
    });

    items.push({
      title: 'DDA (Difficult Development Areas)',
      html: `Difficult Development Areas are HUD-designated metro/non-metro areas with high construction, land, ` +
            `and utility costs relative to income. LIHTC projects in DDAs may receive a 30% basis boost. ` +
            `DDA boundaries are fetched from the HUD ArcGIS REST service (purple dashed overlay); county DDA ` +
            `status is also cross-checked against HUD's published 2025 DDA list for Colorado. ` +
            `<a href="${U().SOURCES.hudDda}" target="_blank" rel="noopener">HUD DDA dataset</a>.`
    });

    const cacheHtml = cacheBits.length ?
      `Cached modules loaded: <strong>${cacheBits.join(', ')}</strong>.` :
      `No cached modules detected for this geography; using live Census pulls where available.`;

    const html = `
      <ul>
        <li><strong>Selected geography:</strong> ${geoLabel} (${geoType}:${geoid})</li>
        <li>${cacheHtml}</li>
      </ul>
      <div class="hna-grid" style="margin-top:10px">
        ${items.map(it=>`
          <div class="chart-card span-6" style="margin:0">
            <h2 style="font-size:1rem">${it.title}</h2>
            <p>${it.html}</p>
          </div>
        `).join('')}
      </div>
    `;

    S().els.methodology.innerHTML = html;
  }

  // --- HUD FMR & Income Limits panel ---

  function renderFmrPanel(countyFips5) {
    var areaEl  = document.getElementById('hudFmrAreaName');
    var fmrEl   = document.getElementById('hudFmrTable');
    var ilEl    = document.getElementById('hudIncomeLimitsTable');
    if (!areaEl && !fmrEl && !ilEl) return;  // panel not present on page

    if (!window.HudFmr || !window.HudFmr.isLoaded()) {
      // Attempt a load then re-render; show a loading state in the meantime.
      var loader = window.HudFmr ? window.HudFmr.load() : Promise.resolve();
      loader.then(function () { renderFmrPanel(countyFips5); });
      if (fmrEl)  fmrEl.textContent  = 'Loading…';
      if (ilEl)   ilEl.textContent   = 'Loading…';
      return;
    }

    var fips = countyFips5 && String(countyFips5).padStart(5, '0');
    if (!fips || !fips.startsWith('08')) {
      // Statewide — prompt user to select a county for specific data
      if (areaEl) areaEl.textContent = 'Select a county, municipality, or CDP to view county-specific FMR and income limits.';
      if (fmrEl)  fmrEl.textContent  = '—';
      if (ilEl)   ilEl.textContent   = '—';
      return;
    }

    var summary = window.HudFmr.getSummaryByFips(fips);
    if (!summary) {
      if (areaEl) areaEl.textContent = 'FMR data not available for FIPS ' + fips;
      if (fmrEl)  fmrEl.textContent  = '—';
      if (ilEl)   ilEl.textContent   = '—';
      return;
    }

    var meta = window.HudFmr.getMeta();
    var fy   = (meta && meta.fiscal_year) ? 'FY' + meta.fiscal_year + ' — ' : '';
    if (areaEl) areaEl.textContent = fy + summary.fmr_area_name;
    if (fmrEl)  fmrEl.innerHTML  = window.HudFmr.renderFmrTable(fips);
    if (ilEl)   ilEl.innerHTML   = window.HudFmr.renderIncomeLimitsTable(fips);
  }

  // --- Chart loading state helpers (Recommendation 3.1) ---

  /** Show a loading overlay inside a .chart-box container for the given canvas ID. */

  function showChartLoading(canvasId) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var box = canvas.closest('.chart-box');
    if (!box) return;
    var overlay = box.querySelector('.chart-loading');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'chart-loading';
      overlay.setAttribute('aria-hidden', 'true');
      var spinner = document.createElement('div');
      spinner.className = 'chart-spinner';
      var label = document.createElement('span');
      label.className = 'chart-loading-label';
      label.textContent = 'Loading\u2026';
      overlay.appendChild(spinner);
      overlay.appendChild(label);
      box.appendChild(overlay);
    }
    overlay.removeAttribute('hidden');
  }

  /** Hide the loading overlay for the given canvas ID (or all overlays if no id given). */

  function hideChartLoading(canvasId) {
    if (canvasId) {
      var canvas = document.getElementById(canvasId);
      if (!canvas) return;
      var box = canvas.closest('.chart-box');
      if (!box) return;
      var overlay = box.querySelector('.chart-loading');
      if (overlay) overlay.setAttribute('hidden', '');
    } else {
      document.querySelectorAll('.chart-box .chart-loading').forEach(function(ov) {
        ov.setAttribute('hidden', '');
      });
    }
  }

  /** Show loading overlays on all chart canvases currently in the DOM. */

  function showAllChartsLoading() {
    document.querySelectorAll('.chart-box canvas').forEach(function(canvas) {
      if (canvas.id) showChartLoading(canvas.id);
    });
  }

  // --- Main update ---


  /**
   * renderIncomeDistribution — Household income distribution chart (DP03 income brackets)
   */
  function renderIncomeDistribution(profile) {
    const canvas = document.getElementById('chartIncomeDistribution');
    if (!canvas || !profile) return;
    const t = chartTheme();
    const brackets = [
      { label: '<$15k',     v: Number(profile.DP03_0052E) },
      { label: '$15–25k',   v: Number(profile.DP03_0053E) },
      { label: '$25–35k',   v: Number(profile.DP03_0054E) },
      { label: '$35–50k',   v: Number(profile.DP03_0055E) },
      { label: '$50–75k',   v: Number(profile.DP03_0056E) },
      { label: '$75–100k',  v: Number(profile.DP03_0057E) },
      { label: '$100–150k', v: Number(profile.DP03_0058E) },
      { label: '$150–200k', v: Number(profile.DP03_0059E) },
      { label: '$200k+',    v: Number(profile.DP03_0060E) },
    ].filter(b => b.v > 0);
    if (!brackets.length) return;
    const colors = brackets.map((_, i) => t.chartColors[i % 7]);
    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: brackets.map(b => b.label),
        datasets: [{ label: 'Households', data: brackets.map(b => b.v), backgroundColor: colors }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'Household Income Distribution (ACS DP03)', color: t.text, font: { size: 12 } },
          tooltip: { callbacks: { label: ctx => ctx.parsed.y.toLocaleString() + ' households' } },
        },
        scales: { y: { ticks: { color: t.muted }, grid: { color: t.grid } }, x: { ticks: { color: t.muted } } },
      },
    });
  }

  /**
   * renderHousingAgeChart — Age of housing stock (DP04 year built)
   *
   * ACS 5-year 2023 confirmed variable codes (DP04 YEAR STRUCTURE BUILT):
   *   DP04_0017E = Built 2020 or later
   *   DP04_0018E = Built 2010 to 2019
   *   DP04_0019E = Built 2000 to 2009
   *   DP04_0020E = Built 1990 to 1999
   *   DP04_0021E = Built 1980 to 1989
   *   DP04_0022E = Built 1970 to 1979
   *   DP04_0023E = Built 1960 to 1969
   *   DP04_0024E = Built 1950 to 1959
   *   DP04_0025E = Built 1940 to 1949
   *   DP04_0026E = Built 1939 or earlier
   * Note: DP04_0027E–DP04_0032E are ROOMS variables, not year-built.
   */
  function renderHousingAgeChart(profile) {
    const canvas = document.getElementById('chartHousingAge');
    if (!canvas || !profile) return;
    const t = chartTheme();
    const eras = [
      { label: 'Pre-1940',  v: Number(profile.DP04_0026E) },
      { label: '1940–1959', v: (Number(profile.DP04_0025E) || 0) + (Number(profile.DP04_0024E) || 0) },
      { label: '1960–1979', v: (Number(profile.DP04_0023E) || 0) + (Number(profile.DP04_0022E) || 0) },
      { label: '1980–1999', v: (Number(profile.DP04_0021E) || 0) + (Number(profile.DP04_0020E) || 0) },
      { label: '2000–2009', v: Number(profile.DP04_0019E) },
      { label: '2010–2019', v: Number(profile.DP04_0018E) },
      { label: '2020+',     v: Number(profile.DP04_0017E) },
    ].filter(e => e.v > 0);
    if (!eras.length) return;
    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: eras.map(e => e.label),
        datasets: [{ label: 'Units', data: eras.map(e => e.v), backgroundColor: t.chartColors[2] }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'Age of Housing Stock (ACS DP04)', color: t.text, font: { size: 12 } },
          tooltip: { callbacks: { label: ctx => ctx.parsed.y.toLocaleString() + ' units' } },
        },
        scales: { y: { ticks: { color: t.muted }, grid: { color: t.grid } }, x: { ticks: { color: t.muted } } },
      },
    });
  }

  /**
   * renderBedroomMixChart — Bedroom mix (DP04 bedrooms)
   *
   * ACS 5-year 2023 confirmed variable codes (DP04 BEDROOMS):
   *   DP04_0039E = No bedroom
   *   DP04_0040E = 1 bedroom
   *   DP04_0041E = 2 bedrooms
   *   DP04_0042E = 3 bedrooms
   *   DP04_0043E = 4 bedrooms
   *   DP04_0044E = 5 or more bedrooms
   * Note: DP04_0045E–DP04_0047E are HOUSING TENURE variables, not bedrooms.
   */
  function renderBedroomMixChart(profile) {
    const canvas = document.getElementById('chartBedroomMix');
    if (!canvas || !profile) return;
    const t = chartTheme();
    const mix = [
      { label: 'No bedroom', v: Number(profile.DP04_0039E) },
      { label: '1 bedroom',  v: Number(profile.DP04_0040E) },
      { label: '2 bedrooms', v: Number(profile.DP04_0041E) },
      { label: '3 bedrooms', v: Number(profile.DP04_0042E) },
      { label: '4+ bedrooms',v: (Number(profile.DP04_0043E) || 0) + (Number(profile.DP04_0044E) || 0) },
    ].filter(m => m.v > 0);
    if (!mix.length) return;
    makeChart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: mix.map(m => m.label),
        datasets: [{ data: mix.map(m => m.v), backgroundColor: t.chartColors.slice(0, 5) }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: t.text,
              font: { size: 11 },
              generateLabels: function (chart) {
                var data = chart.data;
                if (!data.labels || !data.labels.length) return [];
                return data.labels.map(function (label, i) {
                  var val = (data.datasets[0] && data.datasets[0].data[i]) || 0;
                  return {
                    text: label + ': ' + Number(val).toLocaleString(),
                    fillStyle: (data.datasets[0].backgroundColor || [])[i] || '#ccc',
                    strokeStyle: 'transparent',
                    lineWidth: 0,
                    hidden: false,
                    index: i
                  };
                });
              }
            }
          },
          title: { display: true, text: 'Housing Units by Bedroom Count (ACS DP04)', color: t.text, font: { size: 12 } },
          tooltip: { callbacks: { label: ctx => ctx.label + ': ' + ctx.parsed.toLocaleString() + ' units' } },
        },
      },
    });
  }

  /**
   * renderOwnerCostBurdenChart — Owner housing cost burden (DP04 selected monthly costs as % of income)
   */
  function renderOwnerCostBurdenChart(profile) {
    const canvas = document.getElementById('chartOwnerCostBurden');
    if (!canvas || !profile) return;
    const t = chartTheme();
    const bins = [
      { label: '<20%',   v: Number(profile.DP04_0111PE) },
      { label: '20–25%', v: Number(profile.DP04_0112PE) },
      { label: '25–30%', v: Number(profile.DP04_0113PE) },
      { label: '30–35%', v: Number(profile.DP04_0114PE) },
      { label: '35%+',   v: Number(profile.DP04_0115PE) },
    ].filter(b => b.v > 0);
    if (!bins.length) return;
    const colors = bins.map(b => (b.label === '30–35%' || b.label === '35%+') ? t.bad : t.good);
    makeChart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: bins.map(b => b.label),
        datasets: [{ label: '% of owner households', data: bins.map(b => b.v), backgroundColor: colors }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'Owner Cost Burden (% of income, ACS DP04)', color: t.text, font: { size: 12 } },
          tooltip: { callbacks: { label: ctx => ctx.parsed.y.toFixed(1) + '% of owners' } },
        },
        scales: {
          y: { ticks: { color: t.muted, callback: v => v + '%' }, grid: { color: t.grid }, max: 100 },
          x: { ticks: { color: t.muted } },
        },
      },
    });
  }

  /**
   * renderHousingGapSummary — Render housing gap stats panel.
   * Shows estimated housing gap at each AMI tier based on profile data.
   */
  function renderHousingGapSummary(profile, geoType) {
    const el = document.getElementById('housingGapSummary');
    if (!el || !profile) return;

    // ACS 2023 DP04: DP04_0005E is the rental vacancy rate (%) in current ACS.
    // Old cached summary files (generated before the 2023 DP04 restructuring) may have
    // stored DP04_0005E as a unit COUNT (2-unit buildings under old code mapping), so
    // any value ≥ 100 is treated as a stale count rather than a valid rate.
    let rentVac = Number(profile.DP04_0005E) || Number(profile.DP04_0005PE) || 0;
    if (rentVac >= 100) rentVac = 0; // guard: vacancy rates are 0–100%; ≥100 = stale count
    // ACS 2023 GRAPI rent burden:
    // DP04_0141PE = 30.0–34.9% of income; DP04_0142PE = 35%+ of income
    // DP04_0136PE = pre-computed ≥30% (stored by B-series fallback in pipeline)
    // For live profile fetches: ≥30% = DP04_0141PE + DP04_0142PE
    const grapi_30_34 = Number(profile.DP04_0141PE) || 0;
    const grapi_35p   = Number(profile.DP04_0142PE) || 0;
    const rentBurden30 = Number(profile.DP04_0136PE) || (grapi_30_34 + grapi_35p) || 0; // ≥30% cost-burdened
    const rentBurden50 = grapi_35p || 0; // ≥35% (best DP04 proxy; ACS DP04 has no 50% bin)
    const renterHH     = Number(profile.DP04_0047E) || 0;

    // Estimate households at each AMI tier using ACS income brackets.
    // These are rough approximations: actual AMI thresholds vary by county and are
    // published by HUD annually. Cross-reference with HUD Income Limits for precise values.
    const hh30ami = Number(profile.DP03_0052E) || 0;
    const hh50ami = (Number(profile.DP03_0053E) || 0) + (Number(profile.DP03_0054E) || 0);
    const hh80ami = (Number(profile.DP03_0055E) || 0) + (Number(profile.DP03_0056E) || 0);

    const sevBurdened = renterHH > 0 ? Math.round(renterHH * (rentBurden50 / 100)) : 0;
    const modRate = Math.max(0, rentBurden30 - rentBurden50);
    const modBurdened = renterHH > 0 ? Math.round(renterHH * (modRate / 100)) : 0;

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">
        <div class="stat">
          <div class="k">Severely burdened renters (≥35%)</div>
          <div class="v" style="color:var(--bad,#ef4444)">${sevBurdened > 0 ? sevBurdened.toLocaleString() : '—'}</div>
          <div class="s">Est. households (ACS GRAPI 35%+ bin)</div>
        </div>
        <div class="stat">
          <div class="k">Cost-burdened renters (≥30%)</div>
          <div class="v" style="color:var(--warn,#d97706)">${modBurdened > 0 ? modBurdened.toLocaleString() : '—'}</div>
          <div class="s">Est. households</div>
        </div>
        <div class="stat">
          <div class="k">HH at ≤30% AMI</div>
          <div class="v">${hh30ami > 0 ? hh30ami.toLocaleString() : '—'}</div>
          <div class="s">Income &lt;$15k (est.)</div>
        </div>
        <div class="stat">
          <div class="k">HH at 31–50% AMI</div>
          <div class="v">${hh50ami > 0 ? hh50ami.toLocaleString() : '—'}</div>
          <div class="s">$15–35k income (est.)</div>
        </div>
        <div class="stat">
          <div class="k">HH at 51–80% AMI</div>
          <div class="v">${hh80ami > 0 ? hh80ami.toLocaleString() : '—'}</div>
          <div class="s">$35–75k income (est.)</div>
        </div>
        <div class="stat">
          <div class="k">Renter vacancy rate</div>
          <div class="v">${rentVac > 0 ? rentVac.toFixed(1) + '%' : '—'}</div>
          <div class="s">ACS DP04</div>
        </div>
      </div>
      <p style="font-size:.82rem;color:var(--muted);margin-top:8px">
        AMI tier estimates based on household income brackets from ACS DP03.
        Cost-burdened = renters spending ≥30% of income on housing (ACS GRAPI DP04_0141+0142).
        Severely burdened = renters spending ≥35% (ACS DP04 finest available bin; HUD standard is 50%).
      </p>
    `;
  }

  /**
   * renderSpecialNeedsPanel — Senior and disability housing analysis
   */
  function renderSpecialNeedsPanel(profile) {
    const el = document.getElementById('specialNeedsPanel');
    if (!el || !profile) return;

    const totalPop    = Number(profile.DP05_0001E) || 0;
    const pop65plus   = Number(profile.DP05_0024E) || Number(profile.DP05_0029E) || 0;
    // 75+ = sum of ACS age bins: DP05_0016E (75–84) + DP05_0017E (85+)
    // DP05_0031E is "65 years and over, Female" — NOT a 75+ aggregate
    const pop75plus   = (Number(profile.DP05_0016E) || 0) + (Number(profile.DP05_0017E) || 0);
    const disabledPop = Number(profile.DP02_0072E) || 0;
    const childrenU18 = Number(profile.DP05_0019E) || 0;
    const familyHH    = Number(profile.DP02_0003E) || 0;
    const totalHH     = Number(profile.DP02_0001E) || 0;
    const singleParent = (Number(profile.DP02_0009E) || 0) + (Number(profile.DP02_0013E) || 0);

    const pct65  = totalPop > 0 && pop65plus  > 0 ? ((pop65plus  / totalPop) * 100).toFixed(1) : '—';
    const pctDis = totalPop > 0 && disabledPop > 0 ? ((disabledPop / totalPop) * 100).toFixed(1) : '—';

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">
        <div class="stat">
          <div class="k">Population 65+</div>
          <div class="v">${pop65plus > 0 ? pop65plus.toLocaleString() : '—'}</div>
          <div class="s">${pct65 !== '—' ? pct65 + '% of total' : 'ACS DP05'}</div>
        </div>
        <div class="stat">
          <div class="k">Population 75+</div>
          <div class="v">${pop75plus > 0 ? pop75plus.toLocaleString() : '—'}</div>
          <div class="s">Highest care needs</div>
        </div>
        <div class="stat">
          <div class="k">With a disability</div>
          <div class="v">${disabledPop > 0 ? disabledPop.toLocaleString() : '—'}</div>
          <div class="s">${pctDis !== '—' ? pctDis + '% of pop.' : 'ACS DP02'}</div>
        </div>
        <div class="stat">
          <div class="k">Children under 18</div>
          <div class="v">${childrenU18 > 0 ? childrenU18.toLocaleString() : '—'}</div>
          <div class="s">Family housing need</div>
        </div>
        <div class="stat">
          <div class="k">Single-parent households</div>
          <div class="v">${singleParent > 0 ? singleParent.toLocaleString() : '—'}</div>
          <div class="s">Affordable housing priority</div>
        </div>
        <div class="stat">
          <div class="k">Family households</div>
          <div class="v">${familyHH > 0 ? familyHH.toLocaleString() : '—'}</div>
          <div class="s">${totalHH > 0 && familyHH > 0 ? ((familyHH / totalHH) * 100).toFixed(0) + '% of HH' : 'ACS DP02'}</div>
        </div>
      </div>
    `;
  }

  /**
   * renderExtendedAnalysis — Orchestrates all extended HNA section renders.
   */
  function renderExtendedAnalysis(profile, geoType) {
    renderIncomeDistribution(profile);
    renderHousingAgeChart(profile);
    renderBedroomMixChart(profile);
    renderOwnerCostBurdenChart(profile);
    renderHousingGapSummary(profile, geoType);
    renderSpecialNeedsPanel(profile);
  }

  /**
   * Render BLS Labour Market KPI cards (unemployment rate + 5-yr job growth)
   * into #blsLabourMarketCards using data from co-county-economic-indicators.json.
   *
   * @param {string|null} countyFips5 - 5-digit county FIPS for the selected geography
   * @param {string} geoType - 'county' | 'place' | 'cdp' | 'state'
   * @param {object|null} econData - parsed co-county-economic-indicators.json
   */
  function renderBlsLabourMarket(countyFips5, geoType, econData) {
    var container = document.getElementById('blsLabourMarketCards');
    if (!container) return;

    // Derive county name from geo-config for lookup in econData.counties (keyed by name)
    var countyName = null;
    if (geoType !== 'state' && countyFips5) {
      var geoConf = window.__HNA_GEO_CONFIG;
      var countyEntry = geoConf && Array.isArray(geoConf.counties)
        ? geoConf.counties.find(function (c) { return c.geoid === countyFips5; })
        : null;
      if (countyEntry && countyEntry.label) {
        // Labels are like "Adams County" — strip " County" suffix for the lookup key
        countyName = countyEntry.label.replace(/\s+County$/i, '').trim();
      }
    }

    var countyData = econData && econData.counties && countyName
      ? (econData.counties[countyName] || null)
      : null;

    // For state-level: compute averages across all counties
    if (geoType === 'state' && econData && econData.counties) {
      var allCounties = Object.values(econData.counties);
      var avg = function (field) {
        var vals = allCounties.map(function (c) { return c[field]; }).filter(function (v) { return v != null; });
        return vals.length ? vals.reduce(function (s, v) { return s + v; }, 0) / vals.length : null;
      };
      countyData = {
        unemployment_rate: avg('unemployment_rate'),
        job_growth_5yr_pct: avg('job_growth_5yr_pct'),
      };
    }

    var ur = countyData ? countyData.unemployment_rate : null;
    var jg = countyData ? countyData.job_growth_5yr_pct : null;

    // Thresholds for unemployment rate (BLS LAUS): <3.8% = low/healthy, ≤5.5% = moderate, >5.5% = elevated.
    // These align with the thresholds used in market-intelligence.js renderEconomicKpis() setBadge() calls.
    var UR_LOW = 3.8;
    var UR_HIGH = 5.5;
    // Thresholds for 5-year job growth (BLS QCEW): ≥8% = strong, ≥2% = moderate, <2% = weak.
    // These align with the market-intelligence.js thresholds for the job-growth badge.
    var JG_STRONG = 8;
    var JG_MODERATE = 2;

    // Helper to build a KPI card
    function kpiCard(label, value, sub, colorVar) {
      return '<div class="metric-card">' +
        '<div class="mc-label">' + label + '</div>' +
        '<div class="mc-value"' + (colorVar ? ' style="color:' + colorVar + '"' : '') + '>' + value + '</div>' +
        '<div class="mc-sub">' + sub + '</div>' +
        '</div>';
    }

    var urValue = ur != null ? ur.toFixed(1) + '%' : '—';
    var urColor = ur != null ? (ur < UR_LOW ? 'var(--success,#22a36f)' : ur <= UR_HIGH ? 'var(--warning,#f59e0b)' : 'var(--danger,#ef4444)') : '';
    var urSub = ur != null ? (ur < UR_LOW ? 'Low — healthy labour market' : ur <= UR_HIGH ? 'Moderate' : 'Elevated') : 'Data not yet available';

    var jgValue = jg != null ? (jg > 0 ? '+' : '') + jg.toFixed(1) + '%' : '—';
    var jgColor = jg != null ? (jg >= JG_STRONG ? 'var(--success,#22a36f)' : jg >= JG_MODERATE ? 'var(--warning,#f59e0b)' : 'var(--danger,#ef4444)') : '';
    var jgSub = jg != null ? (jg >= JG_STRONG ? 'Strong 5-yr growth' : jg >= JG_MODERATE ? 'Moderate 5-yr growth' : 'Weak 5-yr growth') : 'Data not yet available';

    container.innerHTML =
      kpiCard('Unemployment Rate', urValue, urSub + ' · BLS LAUS', urColor) +
      kpiCard('5-Year Job Growth', jgValue, jgSub + ' · BLS QCEW', jgColor);
  }

  /**
   * renderGapCoverageStats — populate the "Affordability Gap by AMI Tier"
   * stat cards in the Executive Snapshot.  Derives gap = cost_burdened
   * households (those paying >30% income on housing) at each AMI tier.
   *
   * @param {string} countyFips5 - 5-digit county FIPS or null for statewide
   * @param {object|null} chasData - pre-loaded chas_affordability_gap.json
   */
  function renderGapCoverageStats(countyFips5, chasData) {
    var panel     = document.getElementById('hnaGapCoveragePanel');
    var gap30El   = document.getElementById('statGap30');
    var gap50El   = document.getElementById('statGap50');
    var gap60El   = document.getElementById('statGap60');
    var gapTotEl  = document.getElementById('statGapTotal');
    var confEl    = document.getElementById('hnaGapConfidence');
    var barEl     = document.getElementById('hnaGapCoverageBar');
    if (!panel) return;

    if (!chasData) { panel.hidden = true; return; }

    var geoRecord = null;
    if (countyFips5 && chasData.counties) {
      var fips5 = String(countyFips5).padStart(5, '0');
      geoRecord = chasData.counties[fips5] || null;
    }
    if (!geoRecord && chasData.state) geoRecord = chasData.state;
    if (!geoRecord) { panel.hidden = true; return; }

    var byAmi = geoRecord.renter_hh_by_ami || {};
    var isStub = !!(chasData.meta && chasData.meta.note && chasData.meta.note.includes('Stub'));

    // Gap = cost_burdened households at each tier
    var g30  = (byAmi.lte30  && byAmi.lte30.cost_burdened)  || 0;
    var g50  = (byAmi['31to50'] && byAmi['31to50'].cost_burdened) || 0;
    var g60  = (byAmi['51to80'] && byAmi['51to80'].cost_burdened) || 0;
    var gTot = g30 + g50 + g60;

    var fmt = U().fmtNum || function (n) { return n.toLocaleString(); };
    if (gap30El)  gap30El.textContent  = fmt(g30);
    if (gap50El)  gap50El.textContent  = fmt(g50);
    if (gap60El)  gap60El.textContent  = fmt(g60);
    if (gapTotEl) gapTotEl.textContent = fmt(gTot);

    // Confidence badge
    if (confEl) {
      if (isStub) {
        confEl.textContent = 'Estimated';
        confEl.className   = 'data-reliability-badge drb--warn';
        confEl.title       = 'Gap derived from ACS cost-burden rates (stub). Actual CHAS data loads via workflow.';
      } else {
        confEl.textContent = 'HUD CHAS';
        confEl.className   = 'data-reliability-badge drb--ok';
        confEl.title       = 'Based on HUD CHAS ' + ((chasData.meta && chasData.meta.vintage) || '') + ' data.';
      }
    }

    // Visual bar showing severity distribution
    if (barEl && gTot > 0) {
      var pct30 = Math.round((g30 / gTot) * 100);
      var pct50 = Math.round((g50 / gTot) * 100);
      var pct60 = 100 - pct30 - pct50;
      barEl.innerHTML =
        '<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--bg2);" ' +
          'role="img" aria-label="Gap distribution: ' + pct30 + '% at 30% AMI, ' + pct50 + '% at 50% AMI, ' + pct60 + '% at 60% AMI">' +
          '<div style="width:' + pct30 + '%;background:var(--bad);"></div>' +
          '<div style="width:' + pct50 + '%;background:var(--warn);"></div>' +
          '<div style="width:' + pct60 + '%;background:var(--accent2);"></div>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--muted);margin-top:2px;">' +
          '<span>30% AMI (' + pct30 + '%)</span>' +
          '<span>50% AMI (' + pct50 + '%)</span>' +
          '<span>60% AMI (' + pct60 + '%)</span>' +
        '</div>';
    }

    // Store gap data on HNAState for downstream use (market bridge, deal predictor)
    if (window.HNAState) {
      window.HNAState.state.affordabilityGap = {
        ami30UnitsNeeded: g30,
        ami50UnitsNeeded: g50,
        ami60UnitsNeeded: g60,
        totalUndersupply: gTot
      };
    }

    panel.hidden = false;
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Housing Type Feasibility Analysis
   * Combines ACS housing stock composition, building era, and market values
   * to project viable construction types for new development.
   * ───────────────────────────────────────────────────────────────────────── */
  function renderHousingTypeFeasibility(profile, geoType) {
    var container = document.getElementById('htfContainer');
    var canvas1   = document.getElementById('chartHousingTypeComposition');
    var canvas2   = document.getElementById('chartConstructionEra');
    var matrix    = document.getElementById('htfFeasibilityMatrix');
    if (!profile) return;

    var t = chartTheme();
    var fmt = U().fmtNum || function (n) { return Number(n).toLocaleString(); };
    var fmtC = U().fmtCurr || function (n) { return '$' + Number(n).toLocaleString(); };

    /* ── 1. Housing stock composition chart ── */
    var stockTypes = [
      { label: 'Single-Family Detached', v: Number(profile.DP04_0007E) || 0 },
      { label: 'Single-Family Attached',  v: Number(profile.DP04_0008E) || 0 },
      { label: 'Duplex (2 units)',         v: Number(profile.DP04_0009E) || 0 },
      { label: 'Triplex/Fourplex',         v: Number(profile.DP04_0010E) || 0 },
      { label: '5–9 Units',               v: Number(profile.DP04_0011E) || 0 },
      { label: '10–19 Units',             v: Number(profile.DP04_0012E) || 0 },
      { label: '20+ Units (Mid/High-Rise)', v: Number(profile.DP04_0013E) || 0 },
      { label: 'Mobile Home / Other',     v: Number(profile.DP04_0014E) || 0 },
    ].filter(function (d) { return d.v > 0; });

    var totalUnits = stockTypes.reduce(function (s, d) { return s + d.v; }, 0);

    if (canvas1 && stockTypes.length) {
      makeChart(canvas1.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: stockTypes.map(function (d) { return d.label; }),
          datasets: [{
            data: stockTypes.map(function (d) { return d.v; }),
            backgroundColor: stockTypes.map(function (_, i) { return t.chartColors[i % t.chartColors.length]; }),
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            title: { display: true, text: 'Housing Units by Structure Type (ACS DP04)', color: t.text, font: { size: 12 } },
            tooltip: { callbacks: { label: function (ctx) {
              var pct = totalUnits ? (ctx.parsed / totalUnits * 100).toFixed(1) : 0;
              return ctx.label + ': ' + fmt(ctx.parsed) + ' (' + pct + '%)';
            }}},
            legend: { position: 'right', labels: { color: t.muted, font: { size: 10 }, boxWidth: 12 } },
          },
        },
      });
    }

    /* ── 2. Construction era stacked chart ── */
    var eras = [
      { label: '2020+',      v: Number(profile.DP04_0017E) || 0 },
      { label: '2010–19',    v: Number(profile.DP04_0018E) || 0 },
      { label: '2000–09',    v: Number(profile.DP04_0019E) || 0 },
      { label: '1980–99',    v: (Number(profile.DP04_0020E) || 0) + (Number(profile.DP04_0021E) || 0) },
      { label: '1960–79',    v: (Number(profile.DP04_0022E) || 0) + (Number(profile.DP04_0023E) || 0) },
      { label: '1940–59',    v: (Number(profile.DP04_0024E) || 0) + (Number(profile.DP04_0025E) || 0) },
      { label: 'Pre-1940',   v: Number(profile.DP04_0026E) || 0 },
    ];
    var eraTotal = eras.reduce(function (s, d) { return s + d.v; }, 0);
    // Identify dominant construction era
    var peakEra = eras.reduce(function (best, d) { return d.v > best.v ? d : best; }, eras[0]);
    var recentPct = eraTotal ? ((eras[0].v + eras[1].v) / eraTotal * 100).toFixed(1) : 0;
    var pre1980Pct = eraTotal ? ((eras[3].v + eras[4].v + eras[5].v + eras[6].v) / eraTotal * 100).toFixed(1) : 0;

    if (canvas2 && eraTotal > 0) {
      makeChart(canvas2.getContext('2d'), {
        type: 'bar',
        data: {
          labels: eras.map(function (d) { return d.label; }),
          datasets: [{
            label: 'Housing Units',
            data: eras.map(function (d) { return d.v; }),
            backgroundColor: eras.map(function (_, i) {
              var colors = [t.accent, t.chartColors[0], t.chartColors[1], t.chartColors[2], t.chartColors[3], t.chartColors[4], t.chartColors[5]];
              return colors[i] || t.chartColors[i % t.chartColors.length];
            }),
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: {
            title: { display: true, text: 'Housing Stock by Construction Era (ACS DP04)', color: t.text, font: { size: 12 } },
            legend: { display: false },
            tooltip: { callbacks: { label: function (ctx) {
              var pct = eraTotal ? (ctx.parsed.x / eraTotal * 100).toFixed(1) : 0;
              return fmt(ctx.parsed.x) + ' units (' + pct + '%)';
            }}},
          },
          scales: {
            x: { ticks: { color: t.muted }, grid: { color: t.grid } },
            y: { ticks: { color: t.muted }, grid: { display: false } },
          },
        },
      });
    }

    /* ── 3. Feasibility matrix — which housing types make sense here ── */
    var medianValue = Number(profile.DP04_0089E) || 0;
    var medianRent  = Number(profile.DP04_0134E) || 0;
    var ownerPct    = Number(profile.DP04_0046PE) || 0;
    var renterPct   = Number(profile.DP04_0047PE) || 0;
    var sfPct = totalUnits ? ((stockTypes[0] ? stockTypes[0].v : 0) / totalUnits * 100) : 0;
    var mfPct = totalUnits ? (stockTypes.filter(function (d) {
      return d.label.indexOf('20+') >= 0 || d.label.indexOf('10–19') >= 0 || d.label.indexOf('5–9') >= 0;
    }).reduce(function (s, d) { return s + d.v; }, 0) / totalUnits * 100) : 0;

    // Simple feasibility scoring based on market characteristics
    var types = [
      {
        type: 'Garden-Style Apartments',
        desc: '2–3 story walk-up, wood-frame construction. Lowest per-unit cost. Typical 4% LIHTC.',
        score: 0, factors: []
      },
      {
        type: 'Townhome / Rowhouse',
        desc: 'Attached units with individual entries. Middle-density. Appeals to families.',
        score: 0, factors: []
      },
      {
        type: 'Mid-Rise (4–6 stories)',
        desc: 'Steel/concrete podium with wood-frame above. Higher density, higher cost per unit.',
        score: 0, factors: []
      },
      {
        type: 'Adaptive Reuse',
        desc: 'Converting existing non-residential or aging buildings. Leverages historic tax credits.',
        score: 0, factors: []
      },
      {
        type: 'Single-Family Infill',
        desc: 'Scattered-site new SFR construction on vacant lots. Community-scale.',
        score: 0, factors: []
      },
    ];

    // Garden-style: viable almost everywhere, especially where land is affordable
    types[0].score = 70;
    if (medianValue > 0 && medianValue < 400000) { types[0].score += 15; types[0].factors.push('Moderate land cost supports low-rise'); }
    if (medianValue >= 400000) { types[0].score += 5; types[0].factors.push('High land cost — density may be needed'); }
    if (renterPct > 40) { types[0].score += 10; types[0].factors.push('Strong rental demand (' + renterPct.toFixed(0) + '% renters)'); }
    if (mfPct > 20) { types[0].score += 5; types[0].factors.push('Multifamily precedent in area'); }

    // Townhome: good where SFR-dominant and moderate values
    types[1].score = 50;
    if (sfPct > 60) { types[1].score += 20; types[1].factors.push('SFR-dominant area — townhomes offer compatible density'); }
    if (medianValue > 300000 && medianValue < 600000) { types[1].score += 15; types[1].factors.push('Mid-range values support attached product'); }
    if (ownerPct > 55) { types[1].score += 10; types[1].factors.push('Ownership-oriented market (' + ownerPct.toFixed(0) + '% owners)'); }

    // Mid-rise: viable in high-cost, dense, urban markets
    types[2].score = 30;
    if (medianValue >= 500000) { types[2].score += 25; types[2].factors.push('High land cost justifies vertical construction'); }
    if (mfPct > 30) { types[2].score += 15; types[2].factors.push('Existing multifamily density precedent'); }
    if (medianRent > 1500) { types[2].score += 10; types[2].factors.push('Rents support higher construction cost'); }
    if (totalUnits > 50000) { types[2].score += 10; types[2].factors.push('Large housing market with absorption capacity'); }

    // Adaptive reuse: good where old stock exists
    types[3].score = 25;
    if (Number(pre1980Pct) > 50) { types[3].score += 30; types[3].factors.push(pre1980Pct + '% of stock built before 1980'); }
    else if (Number(pre1980Pct) > 30) { types[3].score += 15; types[3].factors.push(pre1980Pct + '% pre-1980 stock available'); }
    if (peakEra.label === 'Pre-1940' || peakEra.label === '1940–59') { types[3].score += 15; types[3].factors.push('Historic building stock from ' + peakEra.label + ' era'); }

    // SFR infill: good where SFR-dominant and lower values
    types[4].score = 35;
    if (sfPct > 70) { types[4].score += 20; types[4].factors.push('Predominantly single-family neighborhood character'); }
    if (medianValue < 350000) { types[4].score += 15; types[4].factors.push('Affordable land for individual lot development'); }
    if (totalUnits < 20000) { types[4].score += 10; types[4].factors.push('Smaller market suited to scattered-site approach'); }

    // Cap at 100 and sort
    types.forEach(function (t) { t.score = Math.min(100, t.score); });
    types.sort(function (a, b) { return b.score - a.score; });

    // Render summary container
    if (container) {
      var summaryHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:1rem">';
      summaryHtml += '<div style="background:var(--surface);padding:12px 16px;border-radius:8px;border-left:3px solid var(--accent)">' +
        '<div style="color:var(--muted);font-size:.75rem">Total Housing Units</div>' +
        '<div style="font-size:1.4rem;font-weight:700">' + fmt(totalUnits) + '</div></div>';
      summaryHtml += '<div style="background:var(--surface);padding:12px 16px;border-radius:8px;border-left:3px solid var(--accent)">' +
        '<div style="color:var(--muted);font-size:.75rem">Peak Construction Era</div>' +
        '<div style="font-size:1.4rem;font-weight:700">' + peakEra.label + '</div>' +
        '<div style="color:var(--muted);font-size:.7rem">' + fmt(peakEra.v) + ' units (' + (eraTotal ? (peakEra.v / eraTotal * 100).toFixed(0) : 0) + '%)</div></div>';
      summaryHtml += '<div style="background:var(--surface);padding:12px 16px;border-radius:8px;border-left:3px solid var(--accent)">' +
        '<div style="color:var(--muted);font-size:.75rem">Median Home Value</div>' +
        '<div style="font-size:1.4rem;font-weight:700">' + (medianValue ? fmtC(medianValue) : 'N/A') + '</div></div>';
      summaryHtml += '<div style="background:var(--surface);padding:12px 16px;border-radius:8px;border-left:3px solid var(--accent)">' +
        '<div style="color:var(--muted);font-size:.75rem">Pre-1980 Stock</div>' +
        '<div style="font-size:1.4rem;font-weight:700">' + pre1980Pct + '%</div>' +
        '<div style="color:var(--muted);font-size:.7rem">Potential rehab/adaptive reuse</div></div>';
      summaryHtml += '</div>';
      container.innerHTML = summaryHtml;
    }

    // Render feasibility matrix
    if (matrix) {
      var html = '<h3 style="font-size:1rem;margin:0 0 12px">Projected Housing Type Viability</h3>';
      html += '<p style="color:var(--muted);font-size:.8rem;margin:0 0 12px">Based on current stock composition, market values, tenure mix, and building age. Higher scores indicate stronger market alignment for new development.</p>';
      html += '<div style="display:flex;flex-direction:column;gap:10px">';
      types.forEach(function (item) {
        var barColor = item.score >= 70 ? 'var(--good, #22c55e)' : item.score >= 45 ? 'var(--warn, #eab308)' : 'var(--muted)';
        var label = item.score >= 70 ? 'Strong' : item.score >= 45 ? 'Moderate' : 'Limited';
        html += '<div style="background:var(--surface);padding:14px 16px;border-radius:8px">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
        html += '<strong style="font-size:.9rem">' + item.type + '</strong>';
        html += '<span style="font-size:.8rem;color:' + barColor + ';font-weight:600">' + label + ' (' + item.score + ')</span>';
        html += '</div>';
        html += '<div style="background:var(--bg, #111);border-radius:4px;height:8px;margin-bottom:6px;overflow:hidden">';
        html += '<div style="width:' + item.score + '%;height:100%;background:' + barColor + ';border-radius:4px;transition:width .5s"></div>';
        html += '</div>';
        html += '<div style="color:var(--muted);font-size:.78rem;margin-bottom:4px">' + item.desc + '</div>';
        if (item.factors.length) {
          html += '<div style="font-size:.75rem;color:var(--accent)">';
          item.factors.forEach(function (f) { html += '• ' + f + '<br>'; });
          html += '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
      matrix.innerHTML = html;
    }
  }

  window.HNARenderers = {
    setBanner, clearStats, chartTheme, makeChart, renderBoundary,
    updateLihtcInfoPanel, renderLihtcLayer, renderQctLayer, renderDdaLayer,
    renderJobMetrics, renderWageChart, renderIndustryChart, renderCommutingFlows,
    renderLaborMarketSection, renderEmploymentTrend, renderWageTrend,
    renderIndustryAnalysis, renderEconomicIndicators, renderWageGaps,
    renderBaselineCard, renderGrowthChart, renderFastTrackCard, renderChecklist,
    renderProp123Section, renderFastTrackCalculatorSection, renderHistoricalSection, renderHnaScorecardPanel,
    renderComplianceTable, renderSnapshot, renderHousingCharts, renderAffordChart,
    renderRentBurdenBins, renderChasAffordabilityGap, renderGapCoverageStats, renderModeShare, renderLehd,
    renderDolaPyramid, clearProjectionsForStateLevel, _renderScenarioSection,
    renderProjectionChart, renderScenarioComparison, renderHouseholdDemand,
    renderLocalResources, renderMethodology, renderFmrPanel,
    showChartLoading, hideChartLoading, showAllChartsLoading, getAssumptions,
    renderExtendedAnalysis, renderBlsLabourMarket,
    renderHousingTypeFeasibility,
  };
})();
