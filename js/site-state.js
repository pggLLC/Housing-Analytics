/**
 * site-state.js — Shared site state manager for COHO Analytics
 *
 * Provides persistent county / geography / PMA context across pages via
 * localStorage, with a subscribe/event pattern for reactive updates and
 * automatic DOM wiring through [data-state-key] attributes.
 *
 * Usage:
 *   SiteState.setCounty('08013', 'Boulder County');
 *   const { fips, name } = SiteState.getCounty();
 *   SiteState.subscribe('county', ({ fips, name }) => { … });
 *
 * See docs/SITE_STATE_USAGE.md for full documentation.
 */
(function (global) {
  'use strict';

  /* ── Storage helpers (graceful degradation when localStorage unavailable) ── */
  const STORAGE_PREFIX = 'coho_state_';

  function storageGet(key) {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_PREFIX + key));
    } catch (_) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    } catch (_) {
      /* storage unavailable — operate in-memory only */
    }
  }

  function storageClear(key) {
    try {
      localStorage.removeItem(STORAGE_PREFIX + key);
    } catch (_) { /* noop */ }
  }

  /* ── In-memory state cache ── */
  const _state = {};
  const _listeners = {};   // key → [callback, …]

  /* ── Internal helpers ── */
  function _get(key) {
    if (key in _state) return _state[key];
    const persisted = storageGet(key);
    _state[key] = persisted;
    return persisted;
  }

  function _set(key, value, persist) {
    _state[key] = value;
    if (persist !== false) storageSet(key, value);
    _notify(key, value);
    _wireDOM(key, value);
  }

  function _notify(key, value) {
    (_listeners[key] || []).forEach(function (cb) {
      try { cb(value); } catch (e) {
        console.warn('[SiteState] listener error for key "' + key + '":', e);
      }
    });
  }

  /* ── DOM auto-wiring ─────────────────────────────────────────────────────
   * Elements with [data-state-key="county"] will be populated automatically.
   * For <select> / <input> elements the value is set; for other elements
   * textContent is updated.
   */
  function _wireDOM(key, value) {
    if (!value) return;
    var els = document.querySelectorAll('[data-state-key="' + key + '"]');
    els.forEach(function (el) {
      var display = _displayValue(key, value);
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT') {
        if (el.value !== display) el.value = display;
      } else {
        el.textContent = display;
      }
    });
  }

  function _displayValue(key, value) {
    if (key === 'county' && value && typeof value === 'object') {
      return value.name || value.fips || '';
    }
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function _wireAllDOM() {
    Object.keys(_state).forEach(function (key) {
      if (_state[key] != null) _wireDOM(key, _state[key]);
    });
  }

  /* ── Context banner ──────────────────────────────────────────────────────
   * Pages that include an element with id="siteStateContextBanner" will
   * receive an auto-populated county / geography breadcrumb.
   */
  function _updateContextBanner() {
    var banner = document.getElementById('siteStateContextBanner');
    if (!banner) return;
    var county = _get('county');
    var geo    = _get('geography');
    var parts  = [];
    if (county && county.name) parts.push(county.name);
    if (geo    && geo.name)    parts.push(geo.name);
    if (parts.length === 0) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    var span = banner.querySelector('[data-state-label]') || banner;
    span.textContent = parts.join(' › ');
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * Public API
   * ══════════════════════════════════════════════════════════════════════════ */
  var SiteState = {

    /* ── County ─────────────────────────────────────────────────────────── */

    /**
     * Set the active county.
     * @param {string} fips  5-digit FIPS code (e.g. "08013")
     * @param {string} name  Human-readable name (e.g. "Boulder County")
     */
    setCounty: function (fips, name) {
      if (fips && typeof fips === 'string') {
        fips = fips.padStart(5, '0');   // Rule 1: always 5-digit
      }
      var value = { fips: fips || null, name: name || null };
      _set('county', value);
      _updateContextBanner();
    },

    /**
     * Return the active county as { fips, name } or null.
     */
    getCounty: function () {
      return _get('county') || null;
    },

    /**
     * Clear the active county selection.
     */
    clearCounty: function () {
      storageClear('county');
      _state.county = null;
      _notify('county', null);
      _updateContextBanner();
    },

    /* ── Geography (sub-county: place / CDP / tract) ─────────────────────── */

    setGeography: function (geoid, name, geoType) {
      var value = { geoid: geoid || null, name: name || null, type: geoType || null };
      _set('geography', value);
      _updateContextBanner();
    },

    getGeography: function () {
      return _get('geography') || null;
    },

    clearGeography: function () {
      storageClear('geography');
      _state.geography = null;
      _notify('geography', null);
      _updateContextBanner();
    },

    /* ── PMA Results ─────────────────────────────────────────────────────── */

    setPmaResults: function (results) {
      _set('pmaResults', results);
    },

    getPmaResults: function () {
      return _get('pmaResults') || null;
    },

    clearPmaResults: function () {
      storageClear('pmaResults');
      _state.pmaResults = null;
      _notify('pmaResults', null);
    },

    /* ── Award / Scoring Context ──────────────────────────────────────────── */

    setAwardContext: function (context) {
      _set('awardContext', context);
    },

    getAwardContext: function () {
      return _get('awardContext') || null;
    },

    /* ── Generic key/value ──────────────────────────────────────────────── */

    set: function (key, value, persist) {
      _set(key, value, persist);
    },

    get: function (key) {
      return _get(key);
    },

    /* ── Subscribe / unsubscribe ─────────────────────────────────────────── */

    /**
     * Subscribe to changes for a given key.
     * @param {string}   key  State key to watch (e.g. "county")
     * @param {Function} cb   Callback receives the new value
     * @returns {Function}    Unsubscribe function
     */
    subscribe: function (key, cb) {
      if (!_listeners[key]) _listeners[key] = [];
      _listeners[key].push(cb);
      return function unsubscribe() {
        _listeners[key] = (_listeners[key] || []).filter(function (fn) {
          return fn !== cb;
        });
      };
    },

    /* ── Snapshot / restore ─────────────────────────────────────────────── */

    getSnapshot: function () {
      return JSON.parse(JSON.stringify(_state));
    },

    /**
     * Clear all persisted state.  Useful for logout / reset flows.
     */
    clearAll: function () {
      Object.keys(_state).forEach(function (k) {
        storageClear(k);
        _state[k] = null;
        _notify(k, null);
      });
      _updateContextBanner();
    },
  };

  /* ── Bootstrap: load persisted state and wire DOM on DOMContentLoaded ── */
  var PERSISTENT_KEYS = ['county', 'geography', 'pmaResults', 'awardContext'];
  PERSISTENT_KEYS.forEach(function (k) { _get(k); });

  function _bootstrap() {
    _wireAllDOM();
    _updateContextBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bootstrap);
  } else {
    _bootstrap();
  }

  /* ── Expose globally ── */
  global.SiteState = SiteState;

}(typeof window !== 'undefined' ? window : this));
