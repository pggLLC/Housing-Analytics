/**
 * js/market-analysis.js
 * Market Analysis page controller (Locate Projects / PMA Site Selection).
 * Depends on: Leaflet, Chart.js, js/pma-site-selection.js, js/data-service-portable.js
 */
(function () {
  'use strict';

  var map = null;
  var marker = null;
  var circleLayer = null;
  var radarChart = null;
  var lastResult = null;

  function fmt(n, d) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toFixed(d != null ? d : 0);
  }

  function fmtPct(n) {
    if (n == null || isNaN(n)) return '—';
    return (Number(n) * 100).toFixed(1) + '%';
  }

  function setStatus(msg, isError) {
    var el = document.getElementById('maStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = isError ? 'error' : '';
  }

  function initMap() {
    var L = window.L;
    if (!L) { setStatus('Leaflet not loaded.', true); return; }

    map = L.map('ma-map', { center: [39.55, -105.78], zoom: 7 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18
    }).addTo(map);

    map.on('click', function (e) {
      runAnalysis(e.latlng.lat, e.latlng.lng);
    });
  }

  function getRadius() { return parseFloat(document.getElementById('maRadius').value) || 5; }
  function getProposedUnits() { return parseInt(document.getElementById('maProposedUnits').value) || 0; }
  function getAmiBand() { return parseInt(document.getElementById('maAmiBand').value) || 60; }

  function runAnalysis(lat, lng) {
    var radius = getRadius();
    setStatus('Analyzing… (' + radius + '-mile PMA around ' + lat.toFixed(4) + ', ' + lng.toFixed(4) + ')');

    // Update map marker + circle
    var L = window.L;
    if (marker) map.removeLayer(marker);
    if (circleLayer) map.removeLayer(circleLayer);
    marker = L.marker([lat, lng]).addTo(map);
    circleLayer = L.circle([lat, lng], { radius: radius * 1609.34, color: 'var(--accent, #0ea5e9)', fillOpacity: 0.05, weight: 2 }).addTo(map);

    window.PmaSiteSelection.analyze({
      lat: lat, lng: lng,
      radiusMiles: radius,
      proposedUnits: getProposedUnits(),
      amiBand: getAmiBand()
    }).then(function (result) {
      lastResult = result;
      renderResults(result);
      setStatus('Analysis complete. ' + result.tractCount + ' census tract(s) in PMA.');
      if (result.tractCount === 0) {
        document.getElementById('maNoData').style.display = '';
      } else {
        document.getElementById('maNoData').style.display = 'none';
      }
    }).catch(function (e) {
      setStatus('Analysis failed: ' + e.message, true);
    });
  }

  function renderResults(r) {
    document.getElementById('maResults').style.display = '';

    // Total score
    document.getElementById('maTotalScore').textContent = r.siteScore;
    var ctx = r.siteScore >= 70 ? 'Strong site' : r.siteScore >= 50 ? 'Moderate site' : 'Marginal site';
    document.getElementById('maScoreContext').textContent = ctx + ' — ' + r.tractCount + ' tract(s) in ' + r.params.radiusMiles + '-mile PMA';

    // Sub-scores
    var names = { demand: 'Demand', capture: 'Capture Risk', rentPressure: 'Rent Pressure', landSupply: 'Land/Supply', workforce: 'Workforce' };
    var list = document.getElementById('maSubscoreList');
    list.innerHTML = '';
    Object.keys(r.subscores).forEach(function (k) {
      var v = r.subscores[k];
      var li = document.createElement('li');
      li.innerHTML = '<span class="ma-subscore-name">' + (names[k] || k) + '</span>' +
        '<div class="ma-subscore-bar"><div class="ma-subscore-fill" style="width:' + v + '%"></div></div>' +
        '<span class="ma-subscore-val">' + v + '</span>';
      list.appendChild(li);
    });

    // Radar chart
    renderRadar(r);

    // Risk flags
    var flagsEl = document.getElementById('maRiskFlags');
    if (r.riskFlags.length) {
      flagsEl.innerHTML = r.riskFlags.map(function (f) {
        var cls = f.flag === 'high_capture_risk' ? 'ma-flag-high' : 'ma-flag-med';
        return '<span class="ma-flag ' + cls + '" title="' + escapeAttr(f.detail) + '">⚠ ' + escapeHtml(f.label) + '</span>';
      }).join('');
    } else {
      flagsEl.innerHTML = '<span style="color:var(--muted);font-size:.9rem">✓ No risk flags for this site.</span>';
    }

    // Comps
    document.getElementById('maComps').textContent =
      r.comps.count + ' LIHTC project(s) found within PMA with ~' + r.comps.estimatedUnits + ' affordable unit(s).';

    // Simulator
    var sim = r.captureSimulator;
    var simGrid = document.getElementById('maSimGrid');
    simGrid.innerHTML = [
      { val: fmtPct(sim.bandCaptureRate), lbl: 'Band Capture Rate (' + sim.amiBand + '% AMI)' },
      { val: fmtPct(sim.overallPenetrationProxy), lbl: 'Overall Penetration Proxy' },
      { val: fmt(sim.qualifiedRenterHH), lbl: 'Qualified Renter HH in PMA' },
      { val: fmt(sim.existingAffordableUnits), lbl: 'Existing Affordable Units' }
    ].map(function (item) {
      return '<div class="ma-sim-kpi"><div class="val">' + item.val + '</div><div class="lbl">' + item.lbl + '</div></div>';
    }).join('');
  }

  function renderRadar(r) {
    var ctx = document.getElementById('maRadarChart');
    if (!ctx || typeof Chart === 'undefined') return;
    if (radarChart) radarChart.destroy();
    var s = r.subscores;
    radarChart = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: ['Demand', 'Capture', 'Rent Pressure', 'Land/Supply', 'Workforce'],
        datasets: [{
          label: 'Site Score',
          data: [s.demand, s.capture, s.rentPressure, s.landSupply, s.workforce],
          backgroundColor: 'rgba(14,165,233,0.15)',
          borderColor: 'rgba(14,165,233,0.8)',
          pointBackgroundColor: 'rgba(14,165,233,1)',
          borderWidth: 2
        }]
      },
      options: {
        scales: { r: { min: 0, max: 100, ticks: { stepSize: 25, font: { size: 10 } }, pointLabels: { font: { size: 11 } } } },
        plugins: { legend: { display: false } },
        animation: { duration: 400 }
      }
    });
  }

  function escapeHtml(s) {
    return (s || '').toString()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function exportJson() {
    if (!lastResult) return;
    var blob = new Blob([JSON.stringify(lastResult, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'pma-analysis.json'; a.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    if (!lastResult) return;
    var r = lastResult;
    var rows = [
      ['metric', 'value'],
      ['site_score', r.siteScore],
      ['radius_miles', r.params.radiusMiles],
      ['lat', r.params.lat],
      ['lng', r.params.lng],
      ['tract_count', r.tractCount],
      ['demand_score', r.subscores.demand],
      ['capture_score', r.subscores.capture],
      ['rent_pressure_score', r.subscores.rentPressure],
      ['land_supply_score', r.subscores.landSupply],
      ['workforce_score', r.subscores.workforce],
      ['lihtc_comps_count', r.comps.count],
      ['lihtc_comps_units', r.comps.estimatedUnits],
      ['band_capture_rate', r.captureSimulator.bandCaptureRate.toFixed(4)],
      ['overall_penetration', r.captureSimulator.overallPenetrationProxy.toFixed(4)],
      ['proposed_units', r.params.proposedUnits],
      ['ami_band', r.params.amiBand],
      ['risk_flags', r.riskFlags.map(function (f) { return f.flag; }).join('|')]
    ];
    var csv = rows.map(function (r) { return r.join(','); }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'pma-analysis.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  document.addEventListener('DOMContentLoaded', function () {
    initMap();
    document.getElementById('maExportJson').addEventListener('click', exportJson);
    document.getElementById('maExportCsv').addEventListener('click', exportCsv);
    // Re-run analysis when controls change (if marker exists)
    ['maRadius', 'maProposedUnits', 'maAmiBand'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', function () {
        if (marker) {
          var ll = marker.getLatLng();
          runAnalysis(ll.lat, ll.lng);
        }
      });
    });
  });
})();
