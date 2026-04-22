# `js/site-state.js`

site-state.js — Shared site state manager for COHO Analytics

Provides persistent county / geography / PMA context across pages via
localStorage, with a subscribe/event pattern for reactive updates and
automatic DOM wiring through [data-state-key] attributes.

Usage:
  SiteState.setCounty('08013', 'Boulder County');
  const { fips, name } = SiteState.getCounty();
  SiteState.subscribe('county', ({ fips, name }) => { … });

See docs/SITE_STATE_USAGE.md for full documentation.

## Symbols

### `PERSISTENT_KEYS`

Set the active county.
@param {string} fips  5-digit FIPS code (e.g. "08013")
@param {string} name  Human-readable name (e.g. "Boulder County")
/
    setCounty: function (fips, name) {
      if (fips && typeof fips === 'string') {
        fips = fips.padStart(5, '0');   // Rule 1: always 5-digit
      }
      var value = { fips: fips || null, name: name || null };
      _set('county', value);
      _updateContextBanner();
    },

    /**
Return the active county as { fips, name } or null.
/
    getCounty: function () {
      return _get('county') || null;
    },

    /**
Clear the active county selection.
/
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
Subscribe to changes for a given key.
@param {string}   key  State key to watch (e.g. "county")
@param {Function} cb   Callback receives the new value
@returns {Function}    Unsubscribe function
/
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
Clear all persisted state.  Useful for logout / reset flows.
/
    clearAll: function () {
      Object.keys(_state).forEach(function (k) {
        storageClear(k);
        _state[k] = null;
        _notify(k, null);
      });
      _updateContextBanner();
    },
  };

  /* ── Bootstrap: load persisted state and wire DOM on DOMContentLoaded ──
