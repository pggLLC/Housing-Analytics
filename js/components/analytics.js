/**
 * analytics.js
 * ES5 IIFE module — window.CohoAnalytics
 *
 * Lightweight, privacy-preserving analytics layer.
 * Tracks workflow step visits and key interactions using localStorage only.
 * No external requests, no PII, no cookies.
 *
 * Public API:
 *   track(eventName, properties)   → void   — record a named event
 *   trackPageview(stepNum, label)  → void   — record a workflow step visit
 *   getSummary()                   → object — aggregated counts for debugging
 *   clearAll()                     → void   — wipe all analytics data
 */

(function (window) {
  'use strict';

  var _KEY_PREFIX  = 'coho_analytics_';
  var _EVENTS_KEY  = _KEY_PREFIX + 'events';   // array of event records (last 200)
  var _COUNTS_KEY  = _KEY_PREFIX + 'counts';   // aggregate event counts
  var _MAX_EVENTS  = 200;                       // rolling buffer size

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function _now() {
    return new Date().toISOString();
  }

  function _readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function _writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      // Storage quota exceeded or private mode — fail silently
    }
  }

  function _getSessionId() {
    var k = _KEY_PREFIX + 'session';
    var existing = null;
    try { existing = localStorage.getItem(k); } catch (_) {}
    if (!existing) {
      existing = Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem(k, existing); } catch (_) {}
    }
    return existing;
  }

  // ─── Core event recording ────────────────────────────────────────────────────

  /**
   * Record a named event with optional properties.
   *
   * @param {string} eventName  Short event name, e.g. 'workflow_step_visit'
   * @param {object} [props]    Key→value properties merged into the event record
   */
  function track(eventName, props) {
    if (!eventName) return;

    var event = {
      t:    _now(),
      sid:  _getSessionId(),
      evt:  String(eventName),
    };

    if (props && typeof props === 'object') {
      var keys = Object.keys(props);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i] !== 't' && keys[i] !== 'sid' && keys[i] !== 'evt') {
          event[keys[i]] = props[keys[i]];
        }
      }
    }

    // Rolling event buffer
    var events = _readJSON(_EVENTS_KEY, []);
    events.push(event);
    if (events.length > _MAX_EVENTS) {
      events = events.slice(events.length - _MAX_EVENTS);
    }
    _writeJSON(_EVENTS_KEY, events);

    // Aggregate counter
    var counts = _readJSON(_COUNTS_KEY, {});
    counts[eventName] = (counts[eventName] || 0) + 1;
    _writeJSON(_COUNTS_KEY, counts);
  }

  /**
   * Record a workflow page visit.
   * Called automatically when the module is loaded with `data-step` attributes.
   *
   * @param {number} stepNum  1–5 workflow step number
   * @param {string} label    Human-readable step name, e.g. 'market_analysis'
   */
  function trackPageview(stepNum, label) {
    track('workflow_step_visit', {
      step:  stepNum,
      label: label || ('step_' + stepNum),
      url:   (window.location && window.location.pathname) || '',
      ref:   (document.referrer && document.referrer.replace(/^https?:\/\/[^/]+/, '')) || '',
    });
  }

  /**
   * Return a summary object with aggregate event counts and the 10 most recent
   * events — useful for debugging in the browser console.
   *
   * @returns {{counts: object, recent: Array}}
   */
  function getSummary() {
    var counts = _readJSON(_COUNTS_KEY, {});
    var events = _readJSON(_EVENTS_KEY, []);
    return {
      counts: counts,
      recent: events.slice(-10),
      session: _getSessionId(),
    };
  }

  /**
   * Erase all locally stored analytics data.
   */
  function clearAll() {
    try { localStorage.removeItem(_EVENTS_KEY); } catch (_) {}
    try { localStorage.removeItem(_COUNTS_KEY); } catch (_) {}
    try { localStorage.removeItem(_KEY_PREFIX + 'session'); } catch (_) {}
  }

  // ─── Auto-fire pageview on DOMContentLoaded ──────────────────────────────────
  // Pages include this script with data-step and data-step-label attributes on
  // the <script> tag itself so no extra JS plumbing is required per-page:
  //
  //   <script src="js/components/analytics.js"
  //           data-step="3" data-step-label="market_analysis"></script>

  (function () {
    var scripts = document.getElementsByTagName('script');
    var thisScript = null;
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.indexOf('analytics.js') !== -1) {
        thisScript = scripts[i];
        break;
      }
    }
    if (thisScript) {
      var step  = parseInt(thisScript.getAttribute('data-step'),  10) || 0;
      var label = thisScript.getAttribute('data-step-label') || '';
      if (step) {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function () {
            trackPageview(step, label);
          });
        } else {
          trackPageview(step, label);
        }
      }
    }
  }());

  // ─── Expose module ───────────────────────────────────────────────────────────

  window.CohoAnalytics = {
    track:         track,
    trackPageview: trackPageview,
    getSummary:    getSummary,
    clearAll:      clearAll,
  };

}(window));
