/**
 * js/data-quality-monitor.js
 * Real-Time Data Quality Monitor — Phase 3 (Epic #447)
 *
 * Provides live health indicators for all critical data sources.
 * Complements data-quality-check.js (batch validation) with:
 *   - Continuous interval-based polling
 *   - Per-dataset health state machine (healthy / degraded / stale / error)
 *   - UI health-bar and status-dot rendering
 *   - CustomEvent bus for dashboard integration
 *   - Metric history for sparkline rendering
 *
 * Public API (window.DataQualityMonitor):
 *   DataQualityMonitor.start([intervalMs])  — begin polling (default: 5 min)
 *   DataQualityMonitor.stop()               — stop polling
 *   DataQualityMonitor.getStatus()          — current health snapshot
 *   DataQualityMonitor.getHistory(key)      — metric history array for sparkline
 *   DataQualityMonitor.renderDashboard(el)  — render health panel into element
 *
 * Events emitted on document:
 *   'dqm:update'   — { detail: { snapshot, allHealthy } }  — on each poll cycle
 *   'dqm:degraded' — { detail: { key, state, message } }   — on status change to degraded/stale/error
 *
 * Exposed as window.DataQualityMonitor (browser) and module.exports (Node/test).
 */

(function (root, factory) {
  'use strict';
  /* istanbul ignore next */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.DataQualityMonitor = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────────── */

  var DEFAULT_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes
  var HISTORY_MAX         = 24;              // keep last 24 readings

  var STATE = {
    HEALTHY:  'healthy',
    DEGRADED: 'degraded',
    STALE:    'stale',
    ERROR:    'error',
    UNKNOWN:  'unknown'
  };

  var STATE_ICON = {
    healthy:  '✅',
    degraded: '⚠️',
    stale:    '🕐',
    error:    '❌',
    unknown:  '❓'
  };

  /** Age thresholds in milliseconds. */
  var AGE_FRESH  = 2  * 60 * 60 * 1000;   //  2 h  → healthy
  var AGE_RECENT = 48 * 60 * 60 * 1000;   // 48 h  → degraded
  // > 48 h → stale

  /** Critical data sources monitored on every poll cycle. */
  var MONITORED_DATASETS = [
    {
      key:         'county-boundaries',
      label:       'County boundaries',
      path:        'data/co-county-boundaries.json',
      minFeatures: 60,
      critical:    true,
      arrayKey:    'features'
    },
    {
      key:         'chfa-lihtc',
      label:       'CHFA LIHTC',
      path:        'data/chfa-lihtc.json',
      minFeatures: 1,
      critical:    true,
      arrayKey:    'features'
    },
    {
      key:         'ami-gap',
      label:       'AMI Gap (county)',
      path:        'data/co_ami_gap_by_county.json',
      minFeatures: 64,
      critical:    false,
      arrayKey:    'counties',
      isObject:    true   // counties is a dict, not array
    },
    {
      key:         'fred-data',
      label:       'FRED economic series',
      path:        'data/fred-data.json',
      minFeatures: 1,
      critical:    false,
      arrayKey:    'series',
      isObject:    true   // series may be dict
    },
    {
      key:         'manifest',
      label:       'Data manifest',
      path:        'data/manifest.json',
      minFeatures: 100,
      critical:    true,
      arrayKey:    'files',
      isObject:    true   // files is a dict
    }
  ];

  /* ── Internal state ────────────────────────────────────────────── */

  var _running    = false;
  var _intervalId = null;
  var _snapshot   = {};
  var _history    = {};   // key → [{ts, state, count}]

  MONITORED_DATASETS.forEach(function (ds) {
    _snapshot[ds.key] = { state: STATE.UNKNOWN, message: 'Not yet checked', count: 0, ts: null };
    _history[ds.key]  = [];
  });

  /* ── Fetch helper ──────────────────────────────────────────────── */

  function _fetchJSON(path) {
    if (typeof fetch === 'undefined') {
      return Promise.reject(new Error('fetch not available in this environment'));
    }
    return fetch(path + '?_=' + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + path);
        return res.json();
      });
  }

  /* ── Feature count helper ──────────────────────────────────────── */

  function _countFeatures(data, cfg) {
    var raw = data[cfg.arrayKey];
    if (!raw) return 0;
    if (Array.isArray(raw)) return raw.length;
    if (cfg.isObject && typeof raw === 'object') return Object.keys(raw).length;
    return 0;
  }

  /* ── Staleness helper ──────────────────────────────────────────── */

  function _detectAge(data) {
    var ts = data.updated || data.fetchedAt || (data.meta && data.meta.generated) || data.generated || null;
    if (!ts) return null;
    return Date.now() - new Date(ts).getTime();
  }

  /* ── Check a single dataset ────────────────────────────────────── */

  function _checkDataset(cfg) {
    return _fetchJSON(cfg.path)
      .then(function (data) {
        var count  = _countFeatures(data, cfg);
        var ageMs  = _detectAge(data);
        var prevState = (_snapshot[cfg.key] || {}).state;

        var state, message;

        if (count < cfg.minFeatures) {
          state   = cfg.critical ? STATE.ERROR : STATE.DEGRADED;
          message = cfg.label + ': only ' + count + ' ' + cfg.arrayKey + ' (expected ' + cfg.minFeatures + '+)';
        } else if (ageMs !== null && ageMs > AGE_RECENT) {
          state   = STATE.STALE;
          message = cfg.label + ': data is ' + Math.round(ageMs / 3600000) + 'h old (stale)';
        } else if (ageMs !== null && ageMs > AGE_FRESH) {
          state   = STATE.DEGRADED;
          message = cfg.label + ': data is aging (' + Math.round(ageMs / 3600000) + 'h old)';
        } else {
          state   = STATE.HEALTHY;
          message = null;
        }

        var entry = { state: state, message: message, count: count, ts: Date.now() };
        _snapshot[cfg.key] = entry;
        _pushHistory(cfg.key, entry);

        // Emit degradation event on status change to non-healthy
        if (state !== STATE.HEALTHY && state !== prevState) {
          _dispatch('dqm:degraded', { key: cfg.key, state: state, message: message });
        }

        return entry;
      })
      .catch(function (err) {
        var entry = { state: STATE.ERROR, message: cfg.label + ': ' + err.message, count: 0, ts: Date.now() };
        _snapshot[cfg.key] = entry;
        _pushHistory(cfg.key, entry);
        _dispatch('dqm:degraded', { key: cfg.key, state: STATE.ERROR, message: entry.message });
        return entry;
      });
  }

  /* ── History management ────────────────────────────────────────── */

  function _pushHistory(key, entry) {
    if (!_history[key]) _history[key] = [];
    _history[key].push({ ts: entry.ts, state: entry.state, count: entry.count });
    if (_history[key].length > HISTORY_MAX) _history[key].shift();
  }

  /* ── Event dispatch ────────────────────────────────────────────── */

  function _dispatch(name, detail) {
    if (typeof document === 'undefined' || typeof CustomEvent === 'undefined') return;
    try {
      document.dispatchEvent(new CustomEvent(name, { detail: detail }));
    } catch (_) { /* non-browser environment */ }
  }

  /* ── Poll cycle ────────────────────────────────────────────────── */

  function _poll() {
    var checks = MONITORED_DATASETS.map(_checkDataset);
    return Promise.all(checks).then(function () {
      var allHealthy = Object.keys(_snapshot).every(function (k) {
        return _snapshot[k].state === STATE.HEALTHY || _snapshot[k].state === STATE.UNKNOWN;
      });
      _dispatch('dqm:update', { snapshot: getStatus(), allHealthy: allHealthy });
      return _snapshot;
    });
  }

  /* ── UI rendering ──────────────────────────────────────────────── */

  /**
   * Render a health dashboard panel into the given DOM element.
   * @param {HTMLElement} el
   */
  function renderDashboard(el) {
    if (!el || typeof el.innerHTML === 'undefined') return;

    var rows = MONITORED_DATASETS.map(function (cfg) {
      var entry = _snapshot[cfg.key] || { state: STATE.UNKNOWN, count: 0, message: '' };
      var icon  = STATE_ICON[entry.state] || '❓';
      var msg   = entry.message || (cfg.label + ': ' + entry.state);
      var ts    = entry.ts ? new Date(entry.ts).toLocaleTimeString() : '—';
      return '<tr>' +
        '<td>' + icon + '</td>' +
        '<td>' + cfg.label + '</td>' +
        '<td>' + entry.count + '</td>' +
        '<td>' + entry.state + '</td>' +
        '<td>' + ts + '</td>' +
        '<td>' + (entry.message ? entry.message : '') + '</td>' +
        '</tr>';
    });

    el.innerHTML =
      '<table class="dqm-table" role="table" aria-label="Data quality health dashboard">' +
      '<caption class="sr-only">Live data quality health indicators for critical datasets</caption>' +
      '<thead><tr><th></th><th>Dataset</th><th>Records</th><th>State</th><th>Last checked</th><th>Note</th></tr></thead>' +
      '<tbody>' + rows.join('') + '</tbody>' +
      '</table>';
  }

  /* ── Public API ────────────────────────────────────────────────── */

  /**
   * Start the monitor polling loop.
   * @param {number} [intervalMs=300000] — polling interval in milliseconds
   */
  function start(intervalMs) {
    if (_running) return;
    _running = true;
    var ms = typeof intervalMs === 'number' && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS;
    _poll();
    _intervalId = setInterval(_poll, ms);
  }

  /** Stop the monitor polling loop. */
  function stop() {
    _running = false;
    if (_intervalId !== null) {
      clearInterval(_intervalId);
      _intervalId = null;
    }
  }

  /**
   * Return a copy of the current health snapshot.
   * @returns {Object} key → { state, message, count, ts }
   */
  function getStatus() {
    var result = {};
    Object.keys(_snapshot).forEach(function (k) {
      result[k] = Object.assign({}, _snapshot[k]);
    });
    return result;
  }

  /**
   * Return metric history array for sparkline rendering.
   * @param {string} key — dataset key
   * @returns {Array<{ts: number, state: string, count: number}>}
   */
  function getHistory(key) {
    return (_history[key] || []).slice();
  }

  return {
    STATE:           STATE,
    STATE_ICON:      STATE_ICON,
    MONITORED_DATASETS: MONITORED_DATASETS,
    start:           start,
    stop:            stop,
    getStatus:       getStatus,
    getHistory:      getHistory,
    renderDashboard: renderDashboard,
    /* Exposed for testing */
    _poll:           _poll,
    _checkDataset:   _checkDataset
  };
}));
