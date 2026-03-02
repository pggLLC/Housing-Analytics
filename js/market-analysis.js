/**
 * js/market-analysis.js
 * Public Market Analysis (PMA) — Market Analysis page controller.
 *
 * Responsibilities:
 *  - Leaflet map initialization & site-marker placement
 *  - PMA circular buffer using Census TIGERweb tract centroids
 *  - ACS metric aggregation within buffer
 *  - HUD LIHTC filtering & counting
 *  - PMA scoring algorithm (5 weighted dimensions)
 *  - CHFA-style capture-rate simulator
 *  - Export to JSON & CSV
 *
 * Data sources (all public, no paid API key required):
 *  - data/market/tract_centroids_co.json   (TIGERweb CENTLAT/CENTLON)
 *  - data/market/acs_tract_metrics_co.json (pre-computed ACS tract metrics)
 *  - data/market/hud_lihtc_co.geojson      (HUD LIHTC Colorado subset)
 *
 * Scoring weights:
 *  Demand (30%) | Capture Risk (25%) | Rent Pressure (15%) | Land/Supply (15%) | Workforce (15%)
 */
(function () {
  'use strict';

  /* ── Constants ──────────────────────────────────────────────────── */
  var EARTH_RADIUS_MILES = 3958.8;

  var SCORE_WEIGHTS = {
    demand:       0.30,
    captureRisk:  0.25,
    rentPressure: 0.15,
    landSupply:   0.15,
    workforce:    0.15
  };

  // CHFA capture-rate guideline maximum
  var CHFA_MAX_CAPTURE = 0.25;

  /* ── State ──────────────────────────────────────────────────────── */
  var map = null;
  var siteMarker = null;
  var bufferCircle = null;
  var lastResult = null;

  var tractCentroids = null;
  var acsMetrics = null;
  var lihtcData = null;

  /* ── DOM refs ───────────────────────────────────────────────────── */
  function el(id) { return document.getElementById(id); }

  /* ── Haversine distance (miles) ──────────────────────────────────── */
  function haversineMiles(lat1, lon1, lat2, lon2) {
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ── Data loading ────────────────────────────────────────────────── */
  function resolveUrl(path) {
    if (typeof window.resolveAssetUrl === 'function') return window.resolveAssetUrl(path);
    return path;
  }

  function fetchJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.json();
    });
  }

  function loadAllData() {
    var base = resolveUrl('data/market/');
    return Promise.all([
      fetchJSON(base + 'tract_centroids_co.json').catch(function () { return []; }),
      fetchJSON(base + 'acs_tract_metrics_co.json').catch(function () { return []; }),
      fetchJSON(base + 'hud_lihtc_co.geojson').catch(function () { return { type: 'FeatureCollection', features: [] }; })
    ]).then(function (results) {
      tractCentroids = results[0];
      acsMetrics = results[1];
      lihtcData = results[2];
    });
  }

  /* ── Buffer tract filtering ──────────────────────────────────────── */
  function tractsInBuffer(lat, lon, radiusMiles) {
    if (!tractCentroids || !tractCentroids.length) return [];
    return tractCentroids.filter(function (t) {
      return haversineMiles(lat, lon, t.lat, t.lon) <= radiusMiles;
    });
  }

  function metricsForTracts(tractIds) {
    if (!acsMetrics || !acsMetrics.length) return [];
    var idSet = new Set(tractIds.map(function (t) { return t.geoid; }));
    return acsMetrics.filter(function (m) { return idSet.has(m.geoid); });
  }

  /* ── Aggregate ACS metrics ────────────────────────────────────────── */
  function aggregateMetrics(metrics) {
    if (!metrics.length) {
      return {
        totalHouseholds: 0,
        renterHouseholds: 0,
        costBurdenedPct: 0,
        vacancyPct: 0,
        overcrowdingPct: 0,
        medianGrossRent: 0,
        laborForceParticipation: 0
      };
    }

    var totalHH = 0, renterHH = 0, costBurdened = 0, vacant = 0;
    var totalOccupied = 0, overcrowded = 0, rentSum = 0, rentCount = 0;
    var lfpSum = 0, lfpCount = 0;

    metrics.forEach(function (m) {
      totalHH      += (m.total_households || 0);
      renterHH     += (m.renter_households || 0);
      costBurdened += (m.cost_burdened || 0);
      vacant       += (m.vacant_units || 0);
      totalOccupied += (m.total_households || 0);
      overcrowded  += (m.overcrowded_units || 0);
      if (m.median_gross_rent > 0) { rentSum += m.median_gross_rent; rentCount++; }
      if (m.labor_force_participation > 0) { lfpSum += m.labor_force_participation; lfpCount++; }
    });

    return {
      totalHouseholds: totalHH,
      renterHouseholds: renterHH,
      costBurdenedPct: totalHH > 0 ? costBurdened / totalHH : 0,
      vacancyPct: totalOccupied > 0 ? vacant / totalOccupied : 0,
      overcrowdingPct: renterHH > 0 ? overcrowded / renterHH : 0,
      medianGrossRent: rentCount > 0 ? rentSum / rentCount : 0,
      laborForceParticipation: lfpCount > 0 ? lfpSum / lfpCount : 0
    };
  }

  /* ── LIHTC filtering ──────────────────────────────────────────────── */
  function lihtcInBuffer(lat, lon, radiusMiles) {
    if (!lihtcData || !lihtcData.features) return [];
    return lihtcData.features.filter(function (f) {
      if (!f.geometry || f.geometry.type !== 'Point') return false;
      var c = f.geometry.coordinates;
      return haversineMiles(lat, lon, c[1], c[0]) <= radiusMiles;
    });
  }

  /* ── Scoring algorithm ────────────────────────────────────────────── */
  /**
   * Score each dimension 0–100 based on ACS metrics.
   * Higher = more favorable (stronger demand, lower risk).
   */
  function scoreDimensions(agg, lihtcCount) {
    // Demand: cost burden % and renter share — higher = more need = higher demand
    var renterShare = agg.totalHouseholds > 0
      ? agg.renterHouseholds / agg.totalHouseholds : 0;
    var demand = Math.min(100, Math.round(
      (agg.costBurdenedPct / 0.40) * 55 +   // up to 55 pts from cost burden (benchmark 40%)
      (renterShare / 0.60) * 45              // up to 45 pts from renter share (benchmark 60%)
    ));

    // Capture Risk: existing LIHTC supply — higher supply = higher risk = lower score
    // Penalize above 5 projects; 0 projects = 100
    var captureRisk = Math.max(0, Math.round(100 - (lihtcCount / 10) * 100));

    // Rent Pressure: median gross rent relative to Colorado median (~$1,400)
    var CO_MEDIAN_RENT = 1400;
    var rentPressure = agg.medianGrossRent > 0
      ? Math.min(100, Math.round((agg.medianGrossRent / CO_MEDIAN_RENT) * 70))
      : 40; // default mid-range if no data

    // Land/Supply: vacancy rate — lower vacancy = higher pressure = higher score
    var landSupply = Math.max(0, Math.round((1 - Math.min(agg.vacancyPct / 0.08, 1)) * 100));

    // Workforce: labor force participation — higher = stronger workforce = higher score
    var workforce = agg.laborForceParticipation > 0
      ? Math.min(100, Math.round((agg.laborForceParticipation / 0.70) * 100))
      : 55; // default mid-range

    return {
      demand:       Math.min(100, Math.max(0, demand)),
      captureRisk:  Math.min(100, Math.max(0, captureRisk)),
      rentPressure: Math.min(100, Math.max(0, rentPressure)),
      landSupply:   Math.min(100, Math.max(0, landSupply)),
      workforce:    Math.min(100, Math.max(0, workforce))
    };
  }

  function overallScore(dims) {
    return Math.round(
      dims.demand       * SCORE_WEIGHTS.demand +
      dims.captureRisk  * SCORE_WEIGHTS.captureRisk +
      dims.rentPressure * SCORE_WEIGHTS.rentPressure +
      dims.landSupply   * SCORE_WEIGHTS.landSupply +
      dims.workforce    * SCORE_WEIGHTS.workforce
    );
  }

  function topDrivers(dims) {
    var entries = Object.keys(dims).map(function (k) { return { key: k, val: dims[k] }; });
    entries.sort(function (a, b) { return b.val - a.val; });
    var labels = {
      demand: 'High cost-burden / renter demand',
      captureRisk: 'Low competing supply',
      rentPressure: 'Elevated rent pressure',
      landSupply: 'Tight vacancy / limited supply',
      workforce: 'Strong labor-force participation'
    };
    return entries.slice(0, 3).map(function (e) {
      return { label: labels[e.key] || e.key, score: e.val };
    });
  }

  function riskFlags(dims, agg, captureRate) {
    var flags = [];
    if (dims.captureRisk < 40) flags.push('High existing LIHTC supply — elevated capture risk.');
    if (agg.vacancyPct > 0.10) flags.push('Vacancy rate above 10% — soft rental market.');
    if (captureRate > CHFA_MAX_CAPTURE) flags.push('Capture rate exceeds CHFA 25% guideline.');
    if (agg.costBurdenedPct < 0.20) flags.push('Cost-burden rate below 20% — limited unmet need signal.');
    return flags;
  }

  /* ── Capture rate simulator ───────────────────────────────────────── */
  function calcCaptureRate(agg) {
    var units30 = parseInt(el('sim30pct').value, 10) || 0;
    var units50 = parseInt(el('sim50pct').value, 10) || 0;
    var units60 = parseInt(el('sim60pct').value, 10) || 0;
    var units80 = parseInt(el('sim80pct').value, 10) || 0;
    var totalUnits = units30 + units50 + units60 + units80 ||
                     parseInt(el('simUnits').value, 10) || 80;

    // Qualified households: renters earning ≤ 80% AMI (approximated from ACS cost-burden data)
    // We use renter households × cost-burdened pct as a conservative lower bound.
    var qualifiedHH = Math.round(agg.renterHouseholds * (agg.costBurdenedPct + 0.10));
    qualifiedHH = Math.max(qualifiedHH, 50); // floor to avoid division issues

    var rate = totalUnits / qualifiedHH;
    return { rate: rate, qualifiedHH: qualifiedHH, totalUnits: totalUnits };
  }

  function renderCaptureRate(agg) {
    var sim = calcCaptureRate(agg);
    el('pmaCaptureRate').textContent = (sim.rate * 100).toFixed(1) + '%';
    el('pmaQualifiedHH').textContent = sim.qualifiedHH.toLocaleString();
    var ok = sim.rate <= CHFA_MAX_CAPTURE;
    var chfaEl = el('pmaChfaFlag');
    chfaEl.textContent = ok ? '✅ Within guideline' : '⚠️ Exceeds guideline';
    chfaEl.style.color = ok ? 'var(--good)' : 'var(--warn)';
    return sim.rate;
  }

  /* ── Radar chart ──────────────────────────────────────────────────── */
  var radarChart = null;

  function renderRadar(dims) {
    var ctx = el('pmaRadarChart');
    if (!ctx || typeof Chart === 'undefined') return;

    var labels = ['Demand', 'Capture Risk', 'Rent Pressure', 'Land/Supply', 'Workforce'];
    var values = [dims.demand, dims.captureRisk, dims.rentPressure, dims.landSupply, dims.workforce];

    var isDark = document.documentElement.classList.contains('dark') ||
                 document.body.classList.contains('dark-mode');
    var gridColor = isDark ? 'rgba(130,180,240,.20)' : 'rgba(13,31,53,.10)';
    var textColor = isDark ? 'rgba(215,232,248,.85)' : '#476080';
    var accentColor = 'rgba(14,165,160,.7)';
    var accentFill  = 'rgba(14,165,160,.18)';

    if (radarChart) {
      radarChart.data.datasets[0].data = values;
      radarChart.update();
      return;
    }

    radarChart = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: labels,
        datasets: [{
          label: 'PMA Score',
          data: values,
          borderColor: accentColor,
          backgroundColor: accentFill,
          pointBackgroundColor: accentColor,
          pointRadius: 4,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          r: {
            min: 0,
            max: 100,
            ticks: {
              stepSize: 25,
              color: textColor,
              backdropColor: 'transparent',
              font: { size: 10 }
            },
            grid: { color: gridColor },
            angleLines: { color: gridColor },
            pointLabels: { color: textColor, font: { size: 11, weight: '600' } }
          }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  }

  /* ── UI rendering ─────────────────────────────────────────────────── */
  function renderResults(lat, lon, radiusMiles) {
    var tractsInBuf = tractsInBuffer(lat, lon, radiusMiles);
    var tractMetrics = metricsForTracts(tractsInBuf);
    var agg = aggregateMetrics(tractMetrics);
    var lihtcProjects = lihtcInBuffer(lat, lon, radiusMiles);
    var lihtcCount = lihtcProjects.length;
    var lihtcUnits = lihtcProjects.reduce(function (s, f) {
      return s + (parseInt((f.properties || {}).N_UNITS, 10) || 0);
    }, 0);

    var dims = scoreDimensions(agg, lihtcCount);
    var score = overallScore(dims);
    var drivers = topDrivers(dims);
    var captureRate = renderCaptureRate(agg);
    var flags = riskFlags(dims, agg, captureRate);

    // Store for export
    lastResult = {
      site: { lat: lat, lon: lon },
      radiusMiles: radiusMiles,
      score: score,
      dimensions: dims,
      aggregated: agg,
      lihtcCount: lihtcCount,
      lihtcUnits: lihtcUnits,
      drivers: drivers,
      flags: flags,
      captureRate: captureRate
    };

    // Score card
    var scoreCard = el('pmaScoreCard');
    var scoreClass = score >= 70 ? 'score-high' : score >= 45 ? 'score-medium' : 'score-low';
    scoreCard.innerHTML =
      '<div class="pma-score-number ' + scoreClass + '">' + score + '<small style="font-size:1rem;font-weight:600;opacity:.7">/100</small></div>' +
      '<div class="pma-score-label">Overall Site Score</div>' +
      '<div class="pma-score-sub">' + radiusMiles + '-mile PMA · ' + tractsInBuf.length + ' tracts · ' + agg.totalHouseholds.toLocaleString() + ' households</div>' +
      '<div class="pma-score-location">' + lat.toFixed(5) + ', ' + lon.toFixed(5) + '</div>';

    // Radar
    renderRadar(dims);
    show('pmaChartCard');

    // Drivers
    var driversList = el('pmaDriversList');
    driversList.innerHTML = '';
    drivers.forEach(function (d) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="pma-driver-icon">✅</span><span><strong>' + d.label + '</strong> (' + d.score + '/100)</span>';
      driversList.appendChild(li);
    });

    var flagsList = el('pmaFlagsList');
    flagsList.innerHTML = '';
    flags.forEach(function (f) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="pma-flag-icon">⚠️</span><span>' + f + '</span>';
      flagsList.appendChild(li);
    });
    show('pmaDriversCard');

    // Supply
    el('pmaLihtcCount').textContent = lihtcCount.toLocaleString();
    el('pmaLihtcUnits').textContent = lihtcUnits.toLocaleString();
    show('pmaSupplyCard');

    // Simulator
    show('pmaSimCard');

    // Export
    show('pmaExportCard');
  }

  function show(id) {
    var e = el(id);
    if (e) e.removeAttribute('hidden');
  }

  /* ── Export utilities ─────────────────────────────────────────────── */
  function downloadFile(content, filename, type) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportJson() {
    if (!lastResult) return;
    downloadFile(
      JSON.stringify(lastResult, null, 2),
      'pma-result-' + Date.now() + '.json',
      'application/json'
    );
  }

  function exportCsv() {
    if (!lastResult) return;
    var r = lastResult;
    var rows = [
      ['field', 'value'],
      ['site_lat', r.site.lat],
      ['site_lon', r.site.lon],
      ['radius_miles', r.radiusMiles],
      ['overall_score', r.score],
      ['demand_score', r.dimensions.demand],
      ['capture_risk_score', r.dimensions.captureRisk],
      ['rent_pressure_score', r.dimensions.rentPressure],
      ['land_supply_score', r.dimensions.landSupply],
      ['workforce_score', r.dimensions.workforce],
      ['lihtc_projects', r.lihtcCount],
      ['lihtc_units', r.lihtcUnits],
      ['capture_rate_pct', (r.captureRate * 100).toFixed(2)],
      ['total_households', r.aggregated.totalHouseholds],
      ['renter_households', r.aggregated.renterHouseholds],
      ['cost_burdened_pct', (r.aggregated.costBurdenedPct * 100).toFixed(1)],
      ['vacancy_pct', (r.aggregated.vacancyPct * 100).toFixed(1)],
      ['median_gross_rent', Math.round(r.aggregated.medianGrossRent)]
    ];
    var csv = rows.map(function (row) { return row.join(','); }).join('\n');
    downloadFile(csv, 'pma-result-' + Date.now() + '.csv', 'text/csv');
  }

  /* ── Map initialization ───────────────────────────────────────────── */
  function initMap() {
    if (!window.L) {
      console.warn('[market-analysis] Leaflet not loaded.');
      return;
    }

    map = L.map('pmaMap', { center: [39.5501, -105.7821], zoom: 7 });

    var isDark = document.documentElement.classList.contains('dark') ||
                 document.body.classList.contains('dark-mode');
    var tileUrl = isDark
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    var attr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>';

    var tileLayer = L.tileLayer(tileUrl, { maxZoom: 18, attribution: attr });
    tileLayer.addTo(map);

    // Switch tile layer on theme change
    document.addEventListener('theme:changed', function () {
      var dark = document.documentElement.classList.contains('dark') ||
                 document.body.classList.contains('dark-mode');
      var url = dark
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
      map.removeLayer(tileLayer);
      tileLayer = L.tileLayer(url, { maxZoom: 18, attribution: attr });
      tileLayer.addTo(map);
    });

    // Click to place marker
    map.on('click', function (e) {
      placeSiteMarker(e.latlng.lat, e.latlng.lng);
    });
  }

  function placeSiteMarker(lat, lon) {
    if (siteMarker) map.removeLayer(siteMarker);
    siteMarker = L.marker([lat, lon], {
      title: 'Site location',
      alt: 'Site location marker'
    }).addTo(map);
    siteMarker.bindTooltip('Site: ' + lat.toFixed(4) + ', ' + lon.toFixed(4));

    el('pmaMapHint').textContent = 'Site set at ' + lat.toFixed(4) + ', ' + lon.toFixed(4) + '. Click "Run Analysis" or click map to move.';
    el('pmaRunBtn').disabled = false;
  }

  function updateBuffer(lat, lon, radiusMiles) {
    if (bufferCircle) map.removeLayer(bufferCircle);
    var radiusMeters = radiusMiles * 1609.344;
    bufferCircle = L.circle([lat, lon], {
      radius: radiusMeters,
      color: 'var(--accent, #0ea5a0)',
      weight: 2,
      opacity: 0.7,
      fillColor: 'var(--accent, #0ea5a0)',
      fillOpacity: 0.07,
      dashArray: '6 4'
    }).addTo(map);
  }

  /* ── Wire up UI ───────────────────────────────────────────────────── */
  function wireUI() {
    el('pmaRunBtn').disabled = true;

    el('pmaRunBtn').addEventListener('click', function () {
      if (!siteMarker) return;
      var latlng = siteMarker.getLatLng();
      var radius = parseInt(el('pmaRadius').value, 10) || 5;
      updateBuffer(latlng.lat, latlng.lng, radius);
      renderResults(latlng.lat, latlng.lng, radius);
    });

    el('pmaClearBtn').addEventListener('click', function () {
      if (siteMarker) { map.removeLayer(siteMarker); siteMarker = null; }
      if (bufferCircle) { map.removeLayer(bufferCircle); bufferCircle = null; }
      lastResult = null;
      el('pmaScoreCard').innerHTML = '<div class="pma-score-empty"><p>Set a site location on the map and click <strong>Run Analysis</strong> to see results.</p></div>';
      ['pmaChartCard','pmaDriversCard','pmaSupplyCard','pmaSimCard','pmaExportCard'].forEach(function (id) {
        var e = el(id);
        if (e) e.setAttribute('hidden', '');
      });
      el('pmaMapHint').textContent = 'Click anywhere on the map to drop a site marker.';
      el('pmaRunBtn').disabled = true;
      if (radarChart) { radarChart.destroy(); radarChart = null; }
    });

    el('simRunBtn').addEventListener('click', function () {
      if (!lastResult) return;
      var captureRate = renderCaptureRate(lastResult.aggregated);
      lastResult.captureRate = captureRate;
      var flags = riskFlags(lastResult.dimensions, lastResult.aggregated, captureRate);
      var flagsList = el('pmaFlagsList');
      flagsList.innerHTML = '';
      flags.forEach(function (f) {
        var li = document.createElement('li');
        li.innerHTML = '<span class="pma-flag-icon">⚠️</span><span>' + f + '</span>';
        flagsList.appendChild(li);
      });
    });

    el('pmaExportJson').addEventListener('click', exportJson);
    el('pmaExportCsv').addEventListener('click', exportCsv);
  }

  /* ── Init ─────────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    if (!el('pmaMap')) return;

    initMap();
    wireUI();

    // Load data in background; if it fails we use empty defaults
    loadAllData().catch(function (e) {
      console.warn('[market-analysis] Data load error (analysis will use empty defaults):', e);
    });
  });

  /* ── Public API (for testing) ─────────────────────────────────────── */
  window.MarketAnalysis = {
    haversineMiles: haversineMiles,
    scoreDimensions: scoreDimensions,
    overallScore: overallScore,
    topDrivers: topDrivers,
    riskFlags: riskFlags
  };

}());
