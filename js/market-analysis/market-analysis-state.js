/**
 * js/market-analysis/market-analysis-state.js
 * Global state container for the market analysis report.
 * Exposes window.MAState with get/set/subscribe.
 */
(function () {
  'use strict';

  /* ── Initial state shape ────────────────────────────────────────── */
  var INITIAL_STATE = {
    /** Selected site coordinates and buffer radius. */
    site: {
      lat:         null,
      lon:         null,
      bufferMiles: 5
    },
    /** Aggregated ACS metrics object (null until computed). */
    acs:       null,
    /** Array of LIHTC GeoJSON features inside the buffer. */
    lihtc:     [],
    /** Scoring result returned by SiteSelectionScore.computeScore(). */
    scores:    null,
    /** Per-section data payloads used by MARenderers. */
    sections: {
      demand:       null,
      supply:       null,
      subsidy:      null,
      feasibility:  null,
      access:       null,
      policy:       null,
      opportunities: null
    },
    /** True while any async data operation is in flight. */
    loading:   false,
    /** Non-null error string when the last operation failed. */
    error:     null,
    /** True once all required data has been successfully loaded. */
    dataReady: false
  };

  /* ── Private module state ───────────────────────────────────────── */
  var _state       = _deepClone(INITIAL_STATE);
  var _subscribers = [];

  /* ── Helpers ────────────────────────────────────────────────────── */
  /**
   * Shallow-clone a plain object one level deep.
   * Nested objects (sections, site) are replaced by reference on setState
   * so callers must pass complete sub-objects when updating them.
   * @param {object} obj
   * @returns {object}
   */
  function _deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    var copy = {};
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        var v = obj[k];
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          copy[k] = _deepClone(v);
        } else if (Array.isArray(v)) {
          copy[k] = v.slice();
        } else {
          copy[k] = v;
        }
      }
    }
    return copy;
  }

  /**
   * Merge `partial` into a shallow copy of `target`.
   * @param {object} target
   * @param {object} partial
   * @returns {object}
   */
  function _merge(target, partial) {
    var next = _deepClone(target);
    for (var k in partial) {
      if (Object.prototype.hasOwnProperty.call(partial, k)) {
        next[k] = partial[k];
      }
    }
    return next;
  }

  /* ── Public API ─────────────────────────────────────────────────── */

  /**
   * Return a deep copy of the current state.
   * @returns {object}
   */
  function getState() {
    return _deepClone(_state);
  }

  /**
   * Merge `partial` into the current state and notify all subscribers.
   * @param {object} partial - Keys to update; other keys are preserved.
   */
  function setState(partial) {
    if (!partial || typeof partial !== 'object') return;
    var prev = _deepClone(_state);
    _state = _merge(_state, partial);
    var next = _deepClone(_state);
    for (var i = 0; i < _subscribers.length; i++) {
      try {
        _subscribers[i](next, prev);
      } catch (e) {
        // Individual subscriber errors must not block the rest.
        if (typeof console !== 'undefined') {
          console.error('[MAState] subscriber error:', e);
        }
      }
    }
  }

  /**
   * Register a callback to be invoked whenever state changes.
   * Returns an unsubscribe function.
   * @param {function} fn - Called with (newState, prevState).
   * @returns {function} unsubscribe
   */
  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    _subscribers.push(fn);
    return function unsubscribe() {
      _subscribers = _subscribers.filter(function (s) { return s !== fn; });
    };
  }

  /**
   * Reset state to its initial shape and notify subscribers.
   */
  function reset() {
    setState(_deepClone(INITIAL_STATE));
  }

  /* ── Expose ─────────────────────────────────────────────────────── */
  window.MAState = {
    getState:  getState,
    setState:  setState,
    subscribe: subscribe,
    reset:     reset
  };

}());
