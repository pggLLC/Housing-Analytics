/**
 * js/preservation.js
 * NHPD Preservation Dashboard — subsidy tracking for Colorado affordable housing.
 *
 * Loads data/market/nhpd_co.geojson via DataService, caches it with CacheManager,
 * and renders KPI cards, an expiration-timeline chart, a filterable property table,
 * and a CSV export.
 *
 * Exposes window.PreservationDashboard for testing.
 */
(function () {
  'use strict';

  /** @const {number} CacheManager TTL — 6 hours in ms. */
  var CACHE_TTL_MS = 6 * 60 * 60 * 1000;

  /** @const {string} CacheManager namespace. */
  var CACHE_NS = 'nhpd';

  /** @const {string} CacheManager key for GeoJSON payload. */
  var CACHE_KEY = 'geojson';

  /** @const {number} Years ahead to flag a subsidy as "expiring soon". */
  var EXPIRY_HORIZON_YEARS = 3;

  /** @const {string[]} Columns used by the sortable table. */
  var TABLE_COLS = ['property_name', 'city', 'county', 'subsidy_type', 'assisted_units', 'subsidy_expiration', 'owner_type'];

  // ── Module state ──────────────────────────────────────────────────────────

  var _cache   = null;   // CacheManager instance — initialised in init()
  var _allRows = [];     // normalised flat property objects
  var _sortState = { col: 'subsidy_expiration', dir: 'asc' };
  var _chart   = null;  // Chart.js instance

  // ── Data normalisation ───────────────────────────────────────────────────

  /**
   * Extracts and normalises properties from a GeoJSON Feature or flat object.
   * Returns a flat record with standardised field names.
   * @param {Object} feature
   * @returns {Object}
   */
  function normaliseFeature(feature) {
    var props = (feature && feature.properties) ? feature.properties : feature;
    if (!props) { return null; }

    // Inject lat/lon from geometry if available
    var lat = null;
    var lon = null;
    if (feature && feature.geometry && feature.geometry.type === 'Point' &&
        Array.isArray(feature.geometry.coordinates)) {
      lon = feature.geometry.coordinates[0];
      lat = feature.geometry.coordinates[1];
    }

    return {
      nhpd_id:            props.nhpd_id            || props.NHPD_ID            || '',
      property_name:      props.property_name      || props.PROPERTY_NAME      || props.name || '',
      address:            props.address            || props.ADDRESS            || '',
      city:               props.city               || props.CITY               || '',
      county:             props.county             || props.COUNTY             || '',
      county_fips:        props.county_fips        || props.COUNTY_FIPS        || '',
      state:              props.state              || props.STATE              || 'CO',
      zip:                props.zip                || props.ZIP                || '',
      total_units:        toNum(props.total_units  || props.TOTAL_UNITS),
      assisted_units:     toNum(props.assisted_units || props.ASSISTED_UNITS || props.total_units || props.TOTAL_UNITS),
      subsidy_type:       props.subsidy_type       || props.SUBSIDY_TYPE       || 'Unknown',
      subsidy_expiration: props.subsidy_expiration || props.SUBSIDY_EXPIRATION || null,
      owner_type:         props.owner_type         || props.OWNER_TYPE         || 'unknown',
      ami_targeting:      props.ami_targeting      || props.AMI_TARGETING      || '',
      lat:                lat || toNum(props.lat   || props.latitude  || props.LATITUDE),
      lon:                lon || toNum(props.lon   || props.longitude || props.LONGITUDE),
    };
  }

  /**
   * Safely coerces a value to a non-negative finite number; returns 0 on failure.
   * @param {*} v
   * @returns {number}
   */
  function toNum(v) {
    var n = parseFloat(v);
    return (isFinite(n) && n >= 0) ? n : 0;
  }

  /**
   * Returns the expiry year as a number, or null if unparseable.
   * @param {string|number|null} raw
   * @returns {number|null}
   */
  function parseExpiryYear(raw) {
    if (!raw) { return null; }
    if (typeof raw === 'number') {
      return (raw > 1900 && raw < 2200) ? raw : null;
    }
    var d = new Date(String(raw));
    if (isNaN(d.getTime())) { return null; }
    return d.getFullYear();
  }

  /**
   * Returns the expiry date as a ms timestamp, or null.
   * @param {string|number|null} raw
   * @returns {number|null}
   */
  function parseExpiryMs(raw) {
    if (!raw) { return null; }
    if (typeof raw === 'number') {
      return (raw > 1900 && raw < 2200)
        ? new Date(raw, 11, 31).getTime()
        : null;
    }
    var t = new Date(String(raw)).getTime();
    return isNaN(t) ? null : t;
  }

  // ── KPI calculation ───────────────────────────────────────────────────────

  /**
   * Computes summary KPIs from a row array.
   * @param {Array.<Object>} rows
   * @returns {{total: number, totalUnits: number, expiringCount: number, expiringUnits: number}}
   */
  function computeKpis(rows) {
    var now = Date.now();
    var cutoff = new Date(new Date().getFullYear() + EXPIRY_HORIZON_YEARS, 11, 31).getTime();
    var totalUnits = 0;
    var expiringCount = 0;
    var expiringUnits = 0;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      totalUnits += r.assisted_units;
      var expMs = parseExpiryMs(r.subsidy_expiration);
      if (expMs !== null && expMs >= now && expMs <= cutoff) {
        expiringCount++;
        expiringUnits += r.assisted_units;
      }
    }

    return {
      total: rows.length,
      totalUnits: totalUnits,
      expiringCount: expiringCount,
      expiringUnits: expiringUnits,
    };
  }

  // ── Chart ─────────────────────────────────────────────────────────────────

  /**
   * Builds expiration-year bucketed data for the timeline chart.
   * @param {Array.<Object>} rows  All rows (unfiltered).
   * @returns {{ labels: string[], unitCounts: number[], propertyCounts: number[] }}
   */
  function buildChartData(rows) {
    var currentYear = new Date().getFullYear();
    var yearBuckets = {};
    for (var y = currentYear; y <= currentYear + 15; y++) {
      yearBuckets[y] = { units: 0, props: 0 };
    }

    for (var i = 0; i < rows.length; i++) {
      var expYear = parseExpiryYear(rows[i].subsidy_expiration);
      if (expYear !== null && yearBuckets[expYear]) {
        yearBuckets[expYear].units += rows[i].assisted_units;
        yearBuckets[expYear].props++;
      }
    }

    var labels = [];
    var unitCounts = [];
    var propertyCounts = [];
    var keys = Object.keys(yearBuckets).sort();
    for (var k = 0; k < keys.length; k++) {
      labels.push(keys[k]);
      unitCounts.push(yearBuckets[keys[k]].units);
      propertyCounts.push(yearBuckets[keys[k]].props);
    }
    return { labels: labels, unitCounts: unitCounts, propertyCounts: propertyCounts };
  }

  /**
   * Renders or updates the expiration timeline chart on the given canvas.
   * @param {HTMLCanvasElement} canvas
   * @param {Array.<Object>} rows
   */
  function renderChart(canvas, rows) {
    if (!canvas || typeof window.Chart === 'undefined') { return; }
    var cd = buildChartData(rows);

    if (_chart) {
      _chart.data.labels = cd.labels;
      _chart.data.datasets[0].data = cd.unitCounts;
      _chart.data.datasets[1].data = cd.propertyCounts;
      _chart.update();
      return;
    }

    _chart = new window.Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: cd.labels,
        datasets: [
          {
            label: 'Assisted Units Expiring',
            data: cd.unitCounts,
            backgroundColor: 'var(--chart-1)',
            borderColor: 'var(--chart-1)',
            borderWidth: 1,
            yAxisID: 'yUnits',
          },
          {
            label: 'Properties Expiring',
            data: cd.propertyCounts,
            type: 'line',
            backgroundColor: 'transparent',
            borderColor: 'var(--chart-2)',
            borderWidth: 2,
            pointRadius: 4,
            yAxisID: 'yProps',
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.dataset.label + ': ' + ctx.raw.toLocaleString();
              }
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: 'Expiration Year' }
          },
          yUnits: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Assisted Units' },
            beginAtZero: true,
          },
          yProps: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'Properties' },
            beginAtZero: true,
            grid: { drawOnChartArea: false },
          }
        }
      }
    });
  }

  // ── Table ─────────────────────────────────────────────────────────────────

  /**
   * Returns a CSS class indicating expiry urgency.
   * @param {string|number|null} expiry
   * @returns {string}
   */
  function expiryClass(expiry) {
    var ms = parseExpiryMs(expiry);
    if (ms === null) { return 'pres-exp-unknown'; }
    var now  = Date.now();
    var diff = ms - now;
    var oneYearMs = 365 * 24 * 60 * 60 * 1000;
    if (diff < 0)                 { return 'pres-exp-expired'; }
    if (diff < oneYearMs)         { return 'pres-exp-critical'; }
    if (diff < 3 * oneYearMs)     { return 'pres-exp-warning'; }
    return 'pres-exp-ok';
  }

  /**
   * Returns a human-readable expiry label.
   * @param {string|number|null} expiry
   * @returns {string}
   */
  function expiryLabel(expiry) {
    if (!expiry) { return '—' ; }
    var ms = parseExpiryMs(expiry);
    if (ms === null) { return String(expiry); }
    var d  = new Date(ms);
    var now = Date.now();
    if (ms < now) { return d.getFullYear() + ' (Expired)'; }
    return d.getFullYear().toString();
  }

  /**
   * Returns a label for subsidy type that's safe for HTML.
   * @param {string} t
   * @returns {string}
   */
  function subsidyLabel(t) {
    return String(t || 'Unknown').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  /**
   * Renders the property table body.
   * @param {Array.<Object>} rows
   */
  function renderTable(rows) {
    var tbody = document.getElementById('presTableBody');
    if (!tbody) { return; }

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="pres-empty">No properties match the current filters.</td></tr>';
      return;
    }

    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var ec = expiryClass(r.subsidy_expiration);
      html += '<tr class="pres-row ' + ec + '">';
      html += '<td class="pres-name">' + escHtml(r.property_name) + '<br><span class="pres-addr">' + escHtml(r.address) + '</span></td>';
      html += '<td>' + escHtml(r.city) + '</td>';
      html += '<td>' + escHtml(r.county) + '</td>';
      html += '<td><span class="pres-tag pres-tag-' + subsidyTypeSlug(r.subsidy_type) + '">' + subsidyLabel(r.subsidy_type) + '</span></td>';
      html += '<td class="pres-num">' + r.assisted_units.toLocaleString() + '</td>';
      html += '<td class="pres-expiry ' + ec + '">' + expiryLabel(r.subsidy_expiration) + '</td>';
      html += '<td>' + escHtml(r.owner_type) + '</td>';
      html += '</tr>';
    }
    tbody.innerHTML = html;
  }

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
   * Converts a subsidy type string to a CSS-safe slug.
   * @param {string} t
   * @returns {string}
   */
  function subsidyTypeSlug(t) {
    return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'other';
  }

  // ── Filters & sorting ────────────────────────────────────────────────────

  /**
   * Returns the currently filtered and sorted rows.
   * @returns {Array.<Object>}
   */
  function getFilteredSorted() {
    var countyFilter  = getVal('presFilterCounty');
    var typeFilter    = getVal('presFilterType');
    var horizonFilter = parseInt(getVal('presFilterHorizon'), 10) || 0;
    var search        = (getVal('presSearch') || '').toLowerCase().trim();

    var now     = Date.now();
    var cutoffMs = horizonFilter
      ? new Date(new Date().getFullYear() + horizonFilter, 11, 31).getTime()
      : 0;

    var filtered = _allRows.filter(function (r) {
      if (countyFilter  && r.county       !== countyFilter)  { return false; }
      if (typeFilter    && r.subsidy_type !== typeFilter)    { return false; }
      if (horizonFilter) {
        var expMs = parseExpiryMs(r.subsidy_expiration);
        if (expMs === null || expMs < now || expMs > cutoffMs) { return false; }
      }
      if (search && r.property_name.toLowerCase().indexOf(search) === -1 &&
          r.city.toLowerCase().indexOf(search) === -1) { return false; }
      return true;
    });

    var col = _sortState.col;
    var dir = _sortState.dir === 'asc' ? 1 : -1;
    return filtered.slice().sort(function (a, b) {
      var av = a[col];
      var bv = b[col];
      if (av == null) { return 1; }
      if (bv == null) { return -1; }
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
    var rows  = getFilteredSorted();
    var kpis  = computeKpis(rows);

    setText('presKpiTotal',          kpis.total.toLocaleString());
    setText('presKpiUnits',          kpis.totalUnits.toLocaleString());
    setText('presKpiExpiring',       kpis.expiringCount.toLocaleString());
    setText('presKpiExpiringUnits',  kpis.expiringUnits.toLocaleString());

    renderTable(rows);

    if (typeof window.__announceUpdate === 'function') {
      window.__announceUpdate(
        rows.length + ' properties shown, ' +
        kpis.expiringCount + ' expiring within ' + EXPIRY_HORIZON_YEARS + ' years'
      );
    }
  }

  // ── County & type dropdowns ───────────────────────────────────────────────

  /**
   * Populates the county and subsidy-type filter dropdowns from loaded data.
   */
  function populateFilters() {
    var counties = {};
    var types    = {};
    for (var i = 0; i < _allRows.length; i++) {
      var r = _allRows[i];
      if (r.county)       { counties[r.county] = true; }
      if (r.subsidy_type) { types[r.subsidy_type] = true; }
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

    var typeEl = document.getElementById('presFilterType');
    if (typeEl) {
      var sortedT = Object.keys(types).sort();
      for (var t = 0; t < sortedT.length; t++) {
        var optT = document.createElement('option');
        optT.value = sortedT[t];
        optT.textContent = sortedT[t];
        typeEl.appendChild(optT);
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
    var headers = [
      'nhpd_id', 'property_name', 'address', 'city', 'county', 'county_fips',
      'state', 'zip', 'total_units', 'assisted_units', 'subsidy_type',
      'subsidy_expiration', 'owner_type', 'ami_targeting'
    ];
    function escapeCsv(v) {
      var s = String(v == null ? '' : v);
      return (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1)
        ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var lines = [headers.join(',')];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      lines.push(headers.map(function (h) { return escapeCsv(r[h]); }).join(','));
    }
    var csv  = lines.join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = 'nhpd-preservation-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  /**
   * Loads NHPD GeoJSON from cache or DataService and bootstraps the UI.
   */
  function loadData() {
    // Show loading state
    var tbody = document.getElementById('presTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" class="pres-loading">Loading NHPD data…</td></tr>';
    }

    _cache = new CacheManager(CACHE_NS, CACHE_TTL_MS);

    // Check cache first
    var cached = _cache.get(CACHE_KEY);
    if (cached) {
      onDataLoaded(cached);
      return;
    }

    var ds = window.DataService;
    if (!ds || !ds.getGeoJSON) {
      showError('DataService is not available.');
      return;
    }

    var path = ds.baseData('market/nhpd_co.geojson');
    ds.getGeoJSON(path)
      .then(function (geojson) {
        _cache.set(CACHE_KEY, geojson);
        onDataLoaded(geojson);
      })
      .catch(function (err) {
        showError('Could not load NHPD data. ' + (err && err.message ? err.message : ''));
      });
  }

  /**
   * Called once GeoJSON is available (from cache or network).
   * @param {Object} geojson
   */
  function onDataLoaded(geojson) {
    var features = (geojson && Array.isArray(geojson.features)) ? geojson.features : [];

    _allRows = [];
    for (var i = 0; i < features.length; i++) {
      var row = normaliseFeature(features[i]);
      if (row) { _allRows.push(row); }
    }

    // Also load into Nhpd connector if available
    if (window.Nhpd && typeof window.Nhpd.loadFromGeoJSON === 'function') {
      window.Nhpd.loadFromGeoJSON(geojson);
    }

    // Stamp freshness
    var meta = geojson && geojson.meta;
    if (meta && meta.generated) {
      setText('presDataTimestamp', 'Data as of ' + meta.generated.slice(0, 10));
    }

    populateFilters();
    setupSorting();
    refresh();
    renderChart(document.getElementById('presExpiryChart'), _allRows);
  }

  /**
   * Displays an error message in the table body.
   * @param {string} msg
   */
  function showError(msg) {
    var tbody = document.getElementById('presTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" class="pres-error">⚠ ' + escHtml(msg) + '</td></tr>';
    }
    setText('presDataTimestamp', 'Data unavailable');
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  /**
   * Bootstraps the dashboard when the DOM is ready.
   */
  function init() {
    // Wire filter controls
    var filterIds = ['presFilterCounty', 'presFilterType', 'presFilterHorizon', 'presSearch'];
    for (var i = 0; i < filterIds.length; i++) {
      var el = document.getElementById(filterIds[i]);
      if (el) { el.addEventListener('input', refresh); }
    }

    // Wire export button
    var exportBtn = document.getElementById('presExportBtn');
    if (exportBtn) { exportBtn.addEventListener('click', exportCsv); }

    // Announce helper (fallback)
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
    /** @returns {Object} Current KPIs for loaded data. */
    getKpis:           function () { return computeKpis(_allRows); },
    /** Programmatically refresh the view. */
    refresh:           refresh,
    /** Exposes normaliseFeature for unit testing. */
    _normaliseFeature: normaliseFeature,
    /** Exposes parseExpiryYear for unit testing. */
    _parseExpiryYear:  parseExpiryYear,
    /** Exposes computeKpis for unit testing. */
    _computeKpis:      computeKpis,
    /** Exposes buildChartData for unit testing. */
    _buildChartData:   buildChartData,
    /** Exposes expiryClass for unit testing. */
    _expiryClass:      expiryClass,
    /** Exposes subsidyTypeSlug for unit testing. */
    _subsidyTypeSlug:  subsidyTypeSlug,
  };

}());
