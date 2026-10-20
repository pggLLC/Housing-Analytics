/**
 * js/preservation.js
 * Preservation inventory — Colorado affordable rental properties on the
 * Colorado Housing and Finance Authority (CHFA) preservation map.
 *
 * Loads data/affordable-housing/preservation/chfa-preservation.json via
 * DataService, caches it with CacheManager, assigns each property a county
 * from its mapped location (js/county-from-coords.js), and renders KPI cards,
 * a units-by-county chart, a filterable property table and a CSV export.
 *
 * The CHFA layer carries property identity only (name, address, city, ZIP,
 * total units, location). It has no subsidy type or expiration date, so this
 * dashboard shows neither and never infers risk from the listing.
 *
 * Exposes window.PreservationDashboard for testing.
 */
(function () {
  'use strict';

  /** @const {number} CacheManager TTL — 6 hours in ms. */
  var CACHE_TTL_MS = 6 * 60 * 60 * 1000;

  /** @const {string} CacheManager namespace. */
  var CACHE_NS = 'chfa-preservation';

  /** @const {string} CacheManager key for GeoJSON payload. */
  var CACHE_KEY = 'geojson';

  /** @const {string} Data path relative to data/. */
  var DATA_PATH = 'affordable-housing/preservation/chfa-preservation.json';

  /** @const {number} Counties shown in the chart. */
  var CHART_TOP_N = 12;

  /** @const {string} Source label carried on every exported row. */
  var SOURCE_LABEL = 'Colorado Housing and Finance Authority (CHFA) preservation map';

  /** @const {string} Limitation carried on every exported row. */
  var LIMITATION = 'Property identity and total units only; the CHFA layer lists no subsidy type or expiration date. ' +
    'County is assigned from the mapped location. Verify current affordability restrictions with CHFA or the property owner.';

  /** @const {Object} Unit-size bands for the size filter. */
  var SIZE_BANDS = {
    '1-24':   [1, 24],
    '25-49':  [25, 49],
    '50-99':  [50, 99],
    '100+':   [100, Infinity],
    unknown:  null,
  };

  // ── Module state ──────────────────────────────────────────────────────────

  var _cache   = null;   // CacheManager instance — initialised in loadData()
  var _allRows = [];     // normalised flat property objects
  var _sortState = { col: 'property_name', dir: 'asc' };
  var _chart   = null;   // Chart.js instance
  var _loaded  = false;  // true once a valid inventory is on screen

  // ── Data normalisation ───────────────────────────────────────────────────

  /**
   * Safely coerces a value to a positive finite number; returns null when the
   * source gives no usable count (a missing count is unknown, not zero).
   * @param {*} v
   * @returns {number|null}
   */
  function toCount(v) {
    if (v === null || v === undefined || v === '') { return null; }
    var n = parseFloat(v);
    return (isFinite(n) && n > 0) ? n : null;
  }

  /**
   * Title-cases a city string ("COLORADO SPRINGS" → "Colorado Springs").
   * @param {string} s
   * @returns {string}
   */
  function cityCase(s) {
    var t = String(s || '').trim();
    if (!t) { return ''; }
    if (t !== t.toUpperCase()) { return t; }
    return t.toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
  }

  /**
   * Extracts and normalises one CHFA preservation feature (or a flat object).
   * @param {Object} feature
   * @returns {Object|null}
   */
  function normaliseFeature(feature) {
    var props = (feature && feature.properties) ? feature.properties : feature;
    if (!props) { return null; }

    var lat = null;
    var lon = null;
    if (feature && feature.geometry && feature.geometry.type === 'Point' &&
        Array.isArray(feature.geometry.coordinates)) {
      lon = parseFloat(feature.geometry.coordinates[0]);
      lat = parseFloat(feature.geometry.coordinates[1]);
    }

    return {
      record_id:     props.UniqueProjID || props.record_id || (props.RecordID != null ? String(props.RecordID) : ''),
      property_name: String(props.PROJECT || props.property_name || '').trim(),
      address:       String(props.PROJ_ADD || props.address || '').trim(),
      city:          cityCase(props.PROJ_CTY || props.city),
      zip:           props.Zip != null ? String(props.Zip) : String(props.zip || ''),
      units:         toCount(props.N_UNITS != null ? props.N_UNITS : props.units),
      county:        props.county || '',
      lat:           isFinite(lat) ? lat : null,
      lon:           isFinite(lon) ? lon : null,
    };
  }

  /**
   * Assigns a county name to each row from its mapped point, when the
   * county lookup is available. Rows outside every boundary keep ''.
   * @param {Array.<Object>} rows
   * @param {Function} lookup  (lat, lon) → {name} | null
   */
  function assignCounties(rows, lookup) {
    if (typeof lookup !== 'function') { return; }
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.county || r.lat === null || r.lon === null) { continue; }
      var hit = lookup(r.lat, r.lon);
      if (hit && hit.name) { r.county = hit.name; }
    }
  }

  // ── KPI calculation ───────────────────────────────────────────────────────

  /**
   * Computes summary KPIs from a row array.
   * @param {Array.<Object>} rows
   * @returns {{total: number, totalUnits: number, counties: number, unknownUnits: number}}
   */
  function computeKpis(rows) {
    var totalUnits = 0;
    var unknownUnits = 0;
    var counties = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.units === null) { unknownUnits++; } else { totalUnits += r.units; }
      if (r.county) { counties[r.county] = true; }
    }
    return {
      total: rows.length,
      totalUnits: totalUnits,
      counties: Object.keys(counties).length,
      unknownUnits: unknownUnits,
    };
  }

  // ── Chart ─────────────────────────────────────────────────────────────────

  /**
   * Sums listed units and properties by county, largest first.
   * @param {Array.<Object>} rows
   * @param {number} [topN]
   * @returns {{ labels: string[], unitCounts: number[], propertyCounts: number[] }}
   */
  function buildChartData(rows, topN) {
    var buckets = {};
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i].county;
      if (!c) { continue; }
      if (!buckets[c]) { buckets[c] = { units: 0, props: 0 }; }
      buckets[c].units += rows[i].units || 0;
      buckets[c].props++;
    }
    var keys = Object.keys(buckets).sort(function (a, b) {
      return (buckets[b].units - buckets[a].units) || a.localeCompare(b);
    }).slice(0, topN || CHART_TOP_N);
    return {
      labels: keys,
      unitCounts: keys.map(function (k) { return buckets[k].units; }),
      propertyCounts: keys.map(function (k) { return buckets[k].props; }),
    };
  }

  /**
   * Renders the units-by-county chart on the given canvas.
   * @param {HTMLCanvasElement} canvas
   * @param {Array.<Object>} rows
   */
  function renderChart(canvas, rows) {
    if (!canvas || typeof window.Chart === 'undefined') { return; }
    var cd = buildChartData(rows);
    if (!cd.labels.length) { return; }

    if (_chart) {
      _chart.data.labels = cd.labels;
      _chart.data.datasets[0].data = cd.unitCounts;
      _chart.update();
      return;
    }

    // The canvas cannot draw var(--chart-1), so resolve the theme token.
    var css = getComputedStyle(document.documentElement);
    var unitsColor = css.getPropertyValue('--chart-1').trim() || '#1e5799';
    _chart = new window.Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: cd.labels,
        datasets: [
          {
            label: 'Units listed on the CHFA preservation map',
            data: cd.unitCounts,
            backgroundColor: unitsColor,
            borderColor: unitsColor,
            borderWidth: 1,
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.raw.toLocaleString() + ' units in ' + cd.propertyCounts[ctx.dataIndex].toLocaleString() + ' properties';
              }
            }
          }
        },
        scales: {
          x: { title: { display: true, text: 'Units listed' }, beginAtZero: true },
          y: { title: { display: false }, ticks: { autoSkip: false } }
        }
      }
    });
  }

  // ── Table ─────────────────────────────────────────────────────────────────

  /**
   * Escapes a string for HTML attribute/text content.
   * @param {string} s
   * @returns {string}
   */
  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Renders the property table body.
   * @param {Array.<Object>} rows
   */
  function renderTable(rows) {
    var tbody = document.getElementById('presTableBody');
    if (!tbody) { return; }

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="pres-empty">No listed properties match the current filters. A property missing here may still carry affordability restrictions.</td></tr>';
      return;
    }

    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      html += '<tr class="pres-row">';
      html += '<td class="pres-name">' + escHtml(r.property_name) + '</td>';
      html += '<td>' + escHtml(r.address) + '</td>';
      html += '<td>' + escHtml(r.city) + '</td>';
      html += '<td>' + (r.county ? escHtml(r.county) : '<span class="pres-addr">Not assigned</span>') + '</td>';
      html += '<td>' + escHtml(r.zip) + '</td>';
      html += '<td class="pres-num">' + (r.units === null ? '<span class="pres-addr">Not listed</span>' : r.units.toLocaleString()) + '</td>';
      html += '</tr>';
    }
    tbody.innerHTML = html;
  }

  // ── Filters & sorting ────────────────────────────────────────────────────

  /**
   * True when a row falls in the named unit-size band.
   * @param {Object} r
   * @param {string} band
   * @returns {boolean}
   */
  function inSizeBand(r, band) {
    if (!band) { return true; }
    if (band === 'unknown') { return r.units === null; }
    var range = SIZE_BANDS[band];
    return !!range && r.units !== null && r.units >= range[0] && r.units <= range[1];
  }

  /**
   * Returns the currently filtered and sorted rows.
   * @returns {Array.<Object>}
   */
  function getFilteredSorted() {
    var countyFilter = getVal('presFilterCounty');
    var sizeFilter   = getVal('presFilterSize');
    var search       = (getVal('presSearch') || '').toLowerCase().trim();

    var filtered = _allRows.filter(function (r) {
      if (countyFilter && r.county !== countyFilter) { return false; }
      if (!inSizeBand(r, sizeFilter)) { return false; }
      if (search && r.property_name.toLowerCase().indexOf(search) === -1 &&
          r.city.toLowerCase().indexOf(search) === -1 &&
          r.address.toLowerCase().indexOf(search) === -1) { return false; }
      return true;
    });

    var col = _sortState.col;
    var dir = _sortState.dir === 'asc' ? 1 : -1;
    return filtered.slice().sort(function (a, b) {
      var av = a[col];
      var bv = b[col];
      if (av == null || av === '') { return 1; }
      if (bv == null || bv === '') { return -1; }
      if (typeof av === 'number') { return dir * (av - bv); }
      return dir * String(av).localeCompare(String(bv));
    });
  }

  /**
   * Reads the value of a form element by id.
   * @param {string} id
   * @returns {string}
   */
  function getVal(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  /**
   * Sets the text content of an element by id.
   * @param {string} id
   * @param {string|number} v
   */
  function setText(id, v) {
    var el = document.getElementById(id);
    if (el) { el.textContent = String(v); }
  }

  // ── Refresh ───────────────────────────────────────────────────────────────

  /**
   * Re-renders KPIs and table from current filter state.
   * Also announces update to screen readers.
   */
  function refresh() {
    if (!_loaded) {
      showError('The CHFA preservation inventory could not be loaded.');
      return;
    }
    var rows = getFilteredSorted();
    var kpis = computeKpis(rows);

    setText('presKpiTotal',   kpis.total.toLocaleString());
    setText('presKpiUnits',   kpis.totalUnits.toLocaleString());
    setText('presKpiCounties', kpis.counties.toLocaleString());
    setText('presKpiUnknownUnits', kpis.unknownUnits.toLocaleString());

    renderTable(rows);
    var exportBtn = document.getElementById('presExportBtn');
    if (exportBtn) exportBtn.disabled = !rows.length;

    if (typeof window.__announceUpdate === 'function') {
      window.__announceUpdate(
        rows.length + ' listed properties shown with ' + kpis.totalUnits.toLocaleString() + ' units.'
      );
    }
  }

  // ── County dropdown ───────────────────────────────────────────────────────

  /**
   * Populates the county filter dropdown from loaded data.
   */
  function populateFilters() {
    var counties = {};
    for (var i = 0; i < _allRows.length; i++) {
      if (_allRows[i].county) { counties[_allRows[i].county] = true; }
    }
    var countyEl = document.getElementById('presFilterCounty');
    if (countyEl) {
      var sorted = Object.keys(counties).sort();
      for (var c = 0; c < sorted.length; c++) {
        var opt = document.createElement('option');
        opt.value = sorted[c];
        opt.textContent = sorted[c];
        countyEl.appendChild(opt);
      }
    }
  }

  // ── Sorting ───────────────────────────────────────────────────────────────

  /**
   * Wires sort-click and keydown listeners to sortable table headers.
   */
  function setupSorting() {
    var headers = document.querySelectorAll('.pres-th.sortable');
    for (var i = 0; i < headers.length; i++) {
      (function (th) {
        th.addEventListener('click', function () {
          var col = th.getAttribute('data-col');
          if (_sortState.col === col) {
            _sortState.dir = _sortState.dir === 'asc' ? 'desc' : 'asc';
          } else {
            _sortState.col = col;
            _sortState.dir = 'asc';
          }
          var allTh = document.querySelectorAll('.pres-th.sortable');
          for (var j = 0; j < allTh.length; j++) {
            allTh[j].setAttribute('aria-sort', 'none');
            var icon = allTh[j].querySelector('.sort-icon');
            if (icon) { icon.textContent = '↕'; }
          }
          th.setAttribute('aria-sort', _sortState.dir === 'asc' ? 'ascending' : 'descending');
          var ownIcon = th.querySelector('.sort-icon');
          if (ownIcon) { ownIcon.textContent = _sortState.dir === 'asc' ? '↑' : '↓'; }
          refresh();
        });
        th.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); }
        });
      }(headers[i]));
    }
  }

  // ── CSV export ────────────────────────────────────────────────────────────

  /**
   * Downloads the current filtered rows as a CSV file.
   */
  function exportCsv() {
    var rows = getFilteredSorted();
    if (!rows.length || !_loaded) return;
    var headers = [
      'record_id', 'property_name', 'address', 'city', 'county', 'zip', 'units',
      'lat', 'lon', 'source', 'limitation'
    ];
    function escapeCsv(v) {
      var s = String(v == null ? '' : v);
      return (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1)
        ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var lines = [headers.join(',')];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var extra = { source: SOURCE_LABEL, limitation: LIMITATION };
      lines.push(headers.map(function (h) {
        return escapeCsv(Object.prototype.hasOwnProperty.call(extra, h) ? extra[h] : r[h]);
      }).join(','));
    }
    var csv  = lines.join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = 'chfa-preservation-inventory.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  /**
   * Loads the CHFA preservation GeoJSON from cache or DataService.
   */
  function loadData() {
    var tbody = document.getElementById('presTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" class="pres-loading">Loading the CHFA preservation inventory…</td></tr>';
    }

    _cache = new CacheManager(CACHE_NS, CACHE_TTL_MS);

    var cached = _cache.get(CACHE_KEY);
    if (cached) {
      onDataLoaded(cached);
      return;
    }

    var ds = window.DataService;
    if (!ds || !ds.getGeoJSON) {
      showError('The CHFA preservation inventory could not be loaded.');
      return;
    }

    ds.getGeoJSON(ds.baseData(DATA_PATH))
      .then(function (geojson) {
        _cache.set(CACHE_KEY, geojson);
        onDataLoaded(geojson);
      })
      .catch(function () {
        showError('The CHFA preservation inventory could not be loaded.');
      });
  }

  /**
   * Resolves once county boundaries are ready (or immediately when the
   * helper is absent), then returns a lookup function or null.
   * @returns {Promise<Function|null>}
   */
  function countyLookup() {
    var cfc = window.CountyFromCoords;
    if (!cfc || typeof cfc.init !== 'function') { return Promise.resolve(null); }
    return Promise.resolve(cfc.init()).then(function () {
      return cfc.isReady() ? cfc.lookupSync : null;
    }, function () { return null; });
  }

  /**
   * Called once GeoJSON is available (from cache or network).
   * @param {Object} geojson
   * @returns {Promise|undefined}
   */
  function onDataLoaded(geojson) {
    if (!geojson || !Array.isArray(geojson.features) || !geojson.features.length) {
      showError('The CHFA preservation inventory is empty or invalid.');
      return;
    }

    _allRows = [];
    for (var i = 0; i < geojson.features.length; i++) {
      var row = normaliseFeature(geojson.features[i]);
      if (row && row.property_name) { _allRows.push(row); }
    }
    _loaded = true;

    return countyLookup().then(function (lookup) {
      assignCounties(_allRows, lookup);
      var assigned = _allRows.filter(function (r) { return r.county; }).length;
      setText('presCoverage', _allRows.length.toLocaleString() + ' properties listed on the CHFA preservation map. ' +
        (assigned === _allRows.length
          ? 'Every property was placed in a county from its mapped location.'
          : assigned.toLocaleString() + ' were placed in a county from their mapped location; the rest show "Not assigned".'));
      populateFilters();
      setupSorting();
      refresh();
      renderChart(document.getElementById('presCountyChart'), _allRows);
    });
  }

  /**
   * Displays an error message in place of the inventory.
   * @param {string} msg
   */
  function showError(msg) {
    _allRows = [];
    _loaded = false;
    if (_chart) { _chart.destroy(); _chart = null; }
    ['presKpiTotal', 'presKpiUnits', 'presKpiCounties', 'presKpiUnknownUnits'].forEach(function (id) { setText(id, 'Unavailable'); });
    setText('presCoverage', msg + ' Check the CHFA preservation map directly.');
    var exportBtn = document.getElementById('presExportBtn');
    if (exportBtn) exportBtn.disabled = true;
    var tbody = document.getElementById('presTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" class="pres-error">⚠ ' + escHtml(msg) + '</td></tr>';
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  /**
   * Bootstraps the dashboard when the DOM is ready.
   */
  function init() {
    var selectFilterIds = ['presFilterCounty', 'presFilterSize'];
    for (var i = 0; i < selectFilterIds.length; i++) {
      var el = document.getElementById(selectFilterIds[i]);
      if (el) { el.addEventListener('change', refresh); }
    }
    var textEl = document.getElementById('presSearch');
    if (textEl) { textEl.addEventListener('input', refresh); }

    var exportBtn = document.getElementById('presExportBtn');
    if (exportBtn) { exportBtn.addEventListener('click', exportCsv); }

    if (typeof window.__announceUpdate !== 'function') {
      window.__announceUpdate = function (msg) {
        var region = document.getElementById('aria-live-region');
        if (!region) { return; }
        region.textContent = '';
        requestAnimationFrame(function () { region.textContent = msg; });
      };
    }

    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  window.PreservationDashboard = {
    /** @returns {Array.<Object>} All loaded property rows (normalised). */
    getRows:           function () { return _allRows.slice(); },
    /** @returns {Object} Current KPIs for loaded data; nulls when unavailable. */
    getKpis:           function () {
      return _loaded
        ? computeKpis(_allRows)
        : { total: null, totalUnits: null, counties: null, unknownUnits: null };
    },
    /** Programmatically refresh the view. */
    refresh:           refresh,
    /** Exposes normaliseFeature for unit testing. */
    _normaliseFeature: normaliseFeature,
    /** Exposes assignCounties for unit testing. */
    _assignCounties:   assignCounties,
    /** Exposes computeKpis for unit testing. */
    _computeKpis:      computeKpis,
    /** Exposes buildChartData for unit testing. */
    _buildChartData:   buildChartData,
    /** Exposes inSizeBand for unit testing. */
    _inSizeBand:       inSizeBand,
    /** Exposes onDataLoaded for unit testing. */
    _onDataLoaded:     onDataLoaded,
  };

}());
