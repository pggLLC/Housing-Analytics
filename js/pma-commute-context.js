/**
 * js/pma-commute-context.js
 * Display-only LODES 2023 commute context overlay for the PMA map.
 *
 * D-lite contract: committed data only, default off, no PMA score or tract
 * selection changes, and no synthetic commute fallback.
 */
(function () {
  'use strict';

  var LEGEND_TEXT = 'LODES 2023 commute context \u2014 does not change PMA scores or tract selection';
  var LODES_URL = 'market/lodes_co.json';
  var ARCS_URL = 'market/lodes_od_arcs_co.geojson';
  var _layer = null;
  var _legend = null;
  var _lastResultRef = null;
  var _state = {
    enabled: false,
    mode_label: 'Commute context overlay off',
    legend: LEGEND_TEXT,
    warning: null,
    tract_count: 0,
    rendered_tract_jobs: 0,
    rendered_od_arcs: 0
  };

  function _tractKey(v) {
    return v == null ? null : String(v);
  }

  function _selectedTracts(result) {
    var out = [];
    var seen = {};
    function add(v) {
      var key = _tractKey(v);
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(key);
    }
    (result && result._tractIds || []).forEach(add);
    (result && result.tractGeoids || []).forEach(add);
    (result && result.bufferTractsDetail || []).forEach(function (t) { add(t && t.geoid); });
    return out;
  }

  function _tractIndex(lodesData) {
    var idx = {};
    var tracts = (lodesData && lodesData.tracts) ? lodesData.tracts : (Array.isArray(lodesData) ? lodesData : []);
    tracts.forEach(function (t) {
      if (t && t.geoid) idx[String(t.geoid)] = t;
    });
    return idx;
  }

  function _arcTouchesSet(feature, selected) {
    var p = feature && feature.properties || {};
    return !!(selected[String(p.home_tract)] || selected[String(p.work_tract)]);
  }

  function _filterArcs(arcsData, tractGeoids) {
    var selected = {};
    (tractGeoids || []).forEach(function (g) { selected[String(g)] = true; });
    return ((arcsData && arcsData.features) || []).filter(function (feature) {
      return _arcTouchesSet(feature, selected);
    });
  }

  function buildOverlayData(result, lodesData, arcsData, opts) {
    opts = opts || {};
    var tractGeoids = _selectedTracts(result);
    if (opts.lastDataCoverage === 'fallback') {
      return {
        blocked: true,
        warning: 'LODES 2023 commute context unavailable: fallback commute data was detected, so the overlay is blocked.',
        legend: LEGEND_TEXT,
        tractGeoids: tractGeoids,
        tractJobs: [],
        arcs: []
      };
    }
    if (!tractGeoids.length) {
      return {
        blocked: true,
        warning: 'Run a PMA analysis before enabling commute context.',
        legend: LEGEND_TEXT,
        tractGeoids: [],
        tractJobs: [],
        arcs: []
      };
    }
    var idx = _tractIndex(lodesData);
    if (!Object.keys(idx).length) {
      return {
        blocked: true,
        warning: 'LODES 2023 commute context unavailable: committed tract job data did not load, so no synthetic commute content is rendered.',
        legend: LEGEND_TEXT,
        tractGeoids: tractGeoids,
        tractJobs: [],
        arcs: []
      };
    }
    var maxJobs = 0;
    var tractJobs = tractGeoids.map(function (geoid) {
      var row = idx[geoid] || {};
      var jobs = Number(row.work_workers != null ? row.work_workers : row.totalJobs);
      if (!isFinite(jobs)) jobs = 0;
      if (jobs > maxJobs) maxJobs = jobs;
      return {
        geoid: geoid,
        work_workers: jobs,
        vintage: row.vintage || (lodesData && lodesData.meta && lodesData.meta.vintage) || 2023
      };
    }).filter(function (row) { return row.work_workers > 0; });
    tractJobs.forEach(function (row) {
      row.relative_intensity = maxJobs > 0 ? row.work_workers / maxJobs : 0;
    });
    return {
      blocked: false,
      warning: null,
      legend: LEGEND_TEXT,
      tractGeoids: tractGeoids,
      tractJobs: tractJobs,
      arcs: _filterArcs(arcsData, tractGeoids)
    };
  }

  function _fetchJSON(path) {
    var DS = window.DataService;
    var url = DS && typeof DS.baseData === 'function' ? DS.baseData(path) : 'data/' + path;
    if (DS && typeof DS.getJSON === 'function') return DS.getJSON(url);
    return window.fetch(url).then(function (res) {
      if (!res || !res.ok) throw new Error('fetch failed: ' + url);
      return res.json();
    });
  }

  function _lodesData() {
    if (window.LodesCommute && typeof window.LodesCommute.getData === 'function') {
      var data = window.LodesCommute.getData();
      if (data && ((data.tracts && data.tracts.length) || Array.isArray(data))) {
        return Promise.resolve(data);
      }
    }
    if (window.LodesCommute && typeof window.LodesCommute.loadMetrics === 'function') {
      return window.LodesCommute.loadMetrics();
    }
    return _fetchJSON(LODES_URL);
  }

  function _geometryIndex() {
    var fc = window.PMADelineation && typeof window.PMADelineation.getLastPmaPolygon === 'function'
      ? window.PMADelineation.getLastPmaPolygon()
      : null;
    var idx = {};
    ((fc && fc.features) || []).forEach(function (feature) {
      var p = feature.properties || {};
      var geoid = p.GEOID || p.geoid || p.GEOID20 || p.tract_geoid;
      if (geoid) idx[String(geoid)] = feature;
    });
    return idx;
  }

  function _setLegend(map, text, isWarning) {
    var L = window.L;
    if (_legend && map) {
      try { map.removeControl(_legend); } catch (e) {}
    }
    _legend = null;
    if (!L || !map || (!text && !isWarning)) return;
    _legend = L.control({ position: 'bottomright' });
    _legend.onAdd = function () {
      var div = L.DomUtil.create('div', 'pma-commute-context-legend');
      div.setAttribute('role', isWarning ? 'alert' : 'note');
      div.style.cssText = 'max-width:260px;background:var(--card,#fff);color:var(--text,#111);' +
        'border:1px solid var(--border,#d1d5db);border-left:4px solid ' + (isWarning ? '#d97706' : '#2563eb') + ';' +
        'border-radius:6px;padding:.5rem .6rem;font-size:.75rem;line-height:1.35;box-shadow:0 2px 10px rgba(0,0,0,.16);';
      div.textContent = text || LEGEND_TEXT;
      if (L.DomEvent) {
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
      }
      return div;
    };
    _legend.addTo(map);
  }

  function clear(map) {
    if (_layer && map) {
      try { map.removeLayer(_layer); } catch (e) {}
    }
    _layer = null;
    _setLegend(map, '', false);
    _state = {
      enabled: false,
      mode_label: 'Commute context overlay off',
      legend: LEGEND_TEXT,
      warning: null,
      tract_count: 0,
      rendered_tract_jobs: 0,
      rendered_od_arcs: 0
    };
    _syncResult();
  }

  function _syncResult(result) {
    if (result) _lastResultRef = result;
    if (_lastResultRef) {
      _lastResultRef.commuteContextOverlay = Object.assign({}, _state);
    }
    if (typeof document !== 'undefined') {
      var summary = document.getElementById('pmaSumCommuteContext');
      if (summary) {
        summary.textContent = _state.enabled
          ? _state.mode_label + ' — does not change PMA scores or tract selection'
          : (_state.warning || 'Off — does not change PMA scores or tract selection');
      }
    }
  }

  function _styleForJob(row) {
    var intensity = Math.max(0, Math.min(1, Number(row.relative_intensity) || 0));
    return {
      color: '#1d4ed8',
      weight: 1,
      opacity: 0.75,
      fillColor: '#2563eb',
      fillOpacity: 0.05 + intensity * 0.25
    };
  }

  function render(map, result, opts) {
    opts = opts || {};
    _lastResultRef = result || _lastResultRef;
    if (!map || typeof window === 'undefined' || !window.L) {
      return Promise.resolve(buildOverlayData(result, null, null, opts));
    }
    return Promise.all([
      opts.lodesData ? Promise.resolve(opts.lodesData) : _lodesData(),
      opts.arcsData ? Promise.resolve(opts.arcsData) : _fetchJSON(ARCS_URL)
    ]).then(function (loaded) {
      var data = buildOverlayData(result, loaded[0], loaded[1], opts);
      clear(map);
      if (data.blocked) {
        _state = {
          enabled: false,
          mode_label: 'Commute context overlay blocked',
          legend: LEGEND_TEXT,
          warning: data.warning,
          tract_count: data.tractGeoids.length,
          rendered_tract_jobs: 0,
          rendered_od_arcs: 0
        };
        _setLegend(map, data.warning, true);
        _syncResult();
        return data;
      }

      var L = window.L;
      var geometry = _geometryIndex();
      var jobByTract = {};
      data.tractJobs.forEach(function (row) { jobByTract[row.geoid] = row; });
      var layers = [];
      data.tractGeoids.forEach(function (geoid) {
        var feature = geometry[geoid];
        var row = jobByTract[geoid];
        if (!feature || !row) return;
        var lyr = L.geoJSON(feature, { style: _styleForJob(row), interactive: true });
        lyr.bindTooltip(
          '<strong>LODES 2023 WAC jobs</strong><br>Tract ' + geoid + ': ' +
          Math.round(row.work_workers).toLocaleString() + ' workplace jobs<br>' +
          'Context only; does not change PMA scores.',
          { sticky: true, className: 'pma-tooltip' }
        );
        layers.push(lyr);
      });
      data.arcs.forEach(function (feature) {
        var p = feature.properties || {};
        var jobs = Number(p.jobs) || 0;
        var weight = Math.max(1.5, Math.min(5, 1 + Math.log10(Math.max(jobs, 1)) * 1.25));
        var line = L.geoJSON(feature, {
          style: { color: '#0f766e', weight: weight, opacity: 0.55, dashArray: '6 4' },
          interactive: true
        });
        line.bindTooltip(
          '<strong>' + jobs.toLocaleString() + ' LODES OD jobs</strong><br>' +
          'Home: ' + (p.home_tract || '') + ' \u2192 Work: ' + (p.work_tract || '') + '<br>' +
          'Top-500 statewide OD arc sample; no capture percentage implied.',
          { sticky: true, className: 'pma-tooltip' }
        );
        layers.push(line);
      });
      _layer = L.layerGroup(layers).addTo(map);
      _state = {
        enabled: true,
        mode_label: 'Commute context overlay on (LODES 2023, display-only)',
        legend: LEGEND_TEXT,
        warning: null,
        tract_count: data.tractGeoids.length,
        rendered_tract_jobs: data.tractJobs.length,
        rendered_od_arcs: data.arcs.length
      };
      _setLegend(map, LEGEND_TEXT + ' · ' + data.tractJobs.length + ' tract job layers · ' + data.arcs.length + ' OD arcs', false);
      _syncResult();
      return data;
    }).catch(function (err) {
      clear(map);
      var msg = 'LODES 2023 commute context unavailable: committed data failed to load; no synthetic commute content is rendered.';
      _state = {
        enabled: false,
        mode_label: 'Commute context overlay blocked',
        legend: LEGEND_TEXT,
        warning: msg,
        tract_count: _selectedTracts(result).length,
        rendered_tract_jobs: 0,
        rendered_od_arcs: 0
      };
      _setLegend(map, msg, true);
      _syncResult();
      if (window.console && console.warn) console.warn('[PMACommuteContext] blocked:', err && err.message ? err.message : err);
      return buildOverlayData(result, null, null, { lastDataCoverage: 'fallback' });
    });
  }

  function getState() {
    return Object.assign({}, _state);
  }

  var api = {
    LEGEND_TEXT: LEGEND_TEXT,
    buildOverlayData: buildOverlayData,
    clear: clear,
    render: render,
    attachResult: _syncResult,
    getState: getState,
    _filterArcs: _filterArcs,
    _selectedTracts: _selectedTracts
  };

  if (typeof window !== 'undefined') {
    window.PMACommuteContext = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}());
