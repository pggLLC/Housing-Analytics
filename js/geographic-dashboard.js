// js/geographic-dashboard.js
// Geographic coverage visualizations for the Data Sources Dashboard.
// Depends on: js/data-source-inventory.js

(function () {
  'use strict';

  function esc(s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Colorado counties (64)
  var CO_COUNTIES = [
    'Adams','Alamosa','Arapahoe','Archuleta','Baca','Bent','Boulder',
    'Broomfield','Chaffee','Cheyenne','Clear Creek','Conejos','Costilla',
    'Crowley','Custer','Delta','Denver','Dolores','Douglas','Eagle',
    'Elbert','El Paso','Fremont','Garfield','Gilpin','Grand','Gunnison',
    'Hinsdale','Huerfano','Jackson','Jefferson','Kiowa','Kit Carson','La Plata',
    'Lake','Larimer','Las Animas','Lincoln','Logan','Mesa','Mineral',
    'Moffat','Montezuma','Montrose','Morgan','Otero','Ouray','Park',
    'Phillips','Pitkin','Prowers','Pueblo','Rio Blanco','Rio Grande',
    'Routt','Saguache','San Juan','San Miguel','Sedgwick','Summit',
    'Teller','Washington','Weld','Yuma'
  ];

  // Geographic unit options
  var GEO_UNITS = ['County', 'Census Tract', 'Block Group', 'Metro Area', 'Statewide', 'Municipality'];

  // Coverage category for a source
  function getCoverage(source, county) {
    var cov = (source.coverage || '').toLowerCase();
    // County-specific check
    if (county) {
      if (cov.includes('statewide') || cov.includes('64 count') || cov.includes('all count')) return 'full';
      if (cov.includes(county.toLowerCase())) return 'full';
      if (cov.includes('metro') || cov.includes('region')) return 'partial';
      return 'none';
    }
    if (cov.includes('statewide') || cov.includes('64 count') || cov.includes('all count') || cov.includes('national')) return 'full';
    if (cov.includes('county') || cov.includes('metro') || cov.includes('region')) return 'partial';
    if (cov.includes('colorado')) return 'partial';
    return 'none';
  }

  // ── Coverage Matrix ──────────────────────────────────────────────
  function renderCoverageMatrix(containerEl, sources, selectedGeoUnit) {
    if (!containerEl) return;
    selectedGeoUnit = selectedGeoUnit || 'County';

    // Group sources by category
    var cats = {};
    sources.forEach(function (s) {
      if (!cats[s.category]) cats[s.category] = [];
      cats[s.category].push(s);
    });

    var filterSources = sources.filter(function (s) {
      if (selectedGeoUnit === 'All') return true;
      return (s.geoUnit || '').includes(selectedGeoUnit) || s.coverage.toLowerCase().includes('statewide');
    }).slice(0, 20);

    // Limit counties for display
    var displayCounties = CO_COUNTIES.slice(0, 20);

    var html = '<div class="dd-coverage-matrix">' +
      '<div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.75rem;flex-wrap:wrap">' +
        '<label style="font-size:.82rem;font-weight:600">Filter by unit:</label>' +
        '<select id="geoUnitFilter" class="dd-filter-select" aria-label="Geographic unit filter">' +
          GEO_UNITS.map(function (u) {
            return '<option value="' + esc(u) + '"' + (u === selectedGeoUnit ? ' selected' : '') + '>' + esc(u) + '</option>';
          }).join('') +
        '</select>' +
        '<span style="font-size:.75rem;color:var(--text-secondary,#888)">Showing top 20 sources × 20 counties</span>' +
      '</div>' +
      '<table class="dd-matrix-table" aria-label="Geographic coverage matrix">' +
        '<thead><tr><th>Source</th>' +
        displayCounties.map(function (c) { return '<th>' + esc(c.substring(0, 6)) + '</th>'; }).join('') +
        '</tr></thead>' +
        '<tbody>';

    filterSources.forEach(function (s) {
      html += '<tr><td style="text-align:left;white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis" title="' + esc(s.name) + '">' + esc(s.name) + '</td>';
      displayCounties.forEach(function (county) {
        var cov = getCoverage(s, county);
        var cls = cov === 'full' ? 'dd-cell--full' : cov === 'partial' ? 'dd-cell--partial' : 'dd-cell--none';
        var symbol = cov === 'full' ? '●' : cov === 'partial' ? '◐' : '○';
        html += '<td class="' + cls + '" title="' + esc(s.name) + ' — ' + esc(county) + ': ' + cov + '">' + symbol + '</td>';
      });
      html += '</tr>';
    });

    html += '</tbody></table>' +
      '<div style="margin-top:.5rem;font-size:.75rem;color:var(--text-secondary,#888)">' +
        '<span style="margin-right:1rem">● Full coverage</span>' +
        '<span style="margin-right:1rem">◐ Partial coverage</span>' +
        '<span>○ Not covered</span>' +
      '</div>' +
      '</div>';

    containerEl.innerHTML = html;
  }

  // ── Coverage Summary by Category ────────────────────────────────
  function renderCoverageSummary(containerEl, sources) {
    if (!containerEl) return;
    var cats = {};
    sources.forEach(function (s) {
      if (!cats[s.category]) cats[s.category] = { full: 0, partial: 0, none: 0, total: 0 };
      var cov = getCoverage(s);
      cats[s.category][cov]++;
      cats[s.category].total++;
    });

    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.75rem">';
    Object.keys(cats).sort().forEach(function (cat) {
      var c = cats[cat];
      var fullPct = c.total ? Math.round(c.full * 100 / c.total) : 0;
      html += '<div class="dd-stat-card">' +
        '<div class="dd-stat-label">' + esc(cat) + '</div>' +
        '<div style="display:flex;gap:.5rem;margin:.3rem 0;font-size:.8rem">' +
          '<span style="color:#2e7d32">● Full: ' + c.full + '</span>' +
          '<span style="color:#f57c00">◐ Partial: ' + c.partial + '</span>' +
          '<span style="color:#c62828">○ None: ' + c.none + '</span>' +
        '</div>' +
        '<div class="dd-gauge-bar" style="height:6px">' +
          '<div class="dd-gauge-fill fresh" style="width:' + fullPct + '%"></div>' +
        '</div>' +
        '<div class="dd-stat-sub" style="margin-top:.2rem">' + fullPct + '% statewide coverage</div>' +
        '</div>';
    });
    html += '</div>';
    containerEl.innerHTML = html;
  }

  // ── Leaflet Map (if available) ────────────────────────────────────
  function initCoverageMap(mapId, sources) {
    var el = document.getElementById(mapId);
    if (!el) return;
    var L = window.L;
    if (!L) {
      el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-secondary,#888)">' +
        'Interactive map requires Leaflet. Add <code>leaflet.js</code> to enable map view.</div>';
      return;
    }

    var map = L.map(mapId, { zoomControl: true }).setView([39.0, -105.5], 6);
    if (window.addMapHomeButton) { addMapHomeButton(map, { center: [39.0, -105.5], zoom: 6 }); }

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);

    // Add simple rectangle for Colorado coverage
    L.rectangle([[37.0, -109.05], [41.0, -102.05]], {
      color: 'var(--accent, #096e65)',
      weight: 2,
      fill: false,
      dashArray: '6,4'
    }).addTo(map).bindTooltip('Colorado Statewide Coverage Area');

    // Summarize coverage counts
    var fullCount = sources.filter(function (s) { return getCoverage(s) === 'full'; }).length;
    var partialCount = sources.filter(function (s) { return getCoverage(s) === 'partial'; }).length;

    var infoHtml = '<div style="padding:.5rem;font-size:.78rem"><strong>Coverage Summary</strong><br>' +
      'Full: ' + fullCount + ' sources<br>Partial: ' + partialCount + ' sources</div>';
    L.control.attribution({ prefix: false }).addTo(map);

    var info = L.control({ position: 'topright' });
    info.onAdd = function () {
      var div = L.DomUtil.create('div', 'leaflet-control');
      div.style.cssText = 'background:rgba(255,255,255,.92);border-radius:6px;padding:6px 10px;font-size:.78rem;box-shadow:0 1px 4px rgba(0,0,0,.15)';
      div.innerHTML = '<strong>Coverage</strong><br>' +
        '<span style="color:#2e7d32">Full: ' + fullCount + '</span><br>' +
        '<span style="color:#f57c00">Partial: ' + partialCount + '</span>';
      return div;
    };
    info.addTo(map);
  }

  // ── Public API ───────────────────────────────────────────────────
  window.GeographicDashboard = {
    renderCoverageMatrix: renderCoverageMatrix,
    renderCoverageSummary: renderCoverageSummary,
    initCoverageMap: initCoverageMap,
    CO_COUNTIES: CO_COUNTIES,
    GEO_UNITS: GEO_UNITS
  };

})();
