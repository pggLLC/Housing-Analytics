/**
 * analytics.js
 * ES5 IIFE module — window.CohoAnalytics
 *
 * Two-tier analytics layer:
 *
 *   Tier 1 — LOCAL (always on)
 *     localStorage rolling buffer of 200 events + aggregate counts.
 *     Useful for debugging a single session: CohoAnalytics.getSummary().
 *     Cannot answer cross-session questions on its own.
 *
 *   Tier 2 — REMOTE (opt-in, zero external dependency by default)
 *     When APP_CONFIG.ANALYTICS_ENDPOINT is set, every event is sent via
 *     navigator.sendBeacon() as a JSON payload. This enables server-side
 *     aggregation without blocking page navigation.
 *
 *     Supported back-ends (configure in js/config.js):
 *       A) Plausible Analytics (recommended for GitHub Pages — privacy-first,
 *          no cookies, GDPR-compliant):
 *            APP_CONFIG.ANALYTICS_PROVIDER  = 'plausible'
 *            APP_CONFIG.ANALYTICS_DOMAIN    = 'yoursite.github.io'
 *          → loads Plausible's lightweight script dynamically.
 *
 *       B) Custom beacon endpoint (any server / Cloudflare Worker / Lambda):
 *            APP_CONFIG.ANALYTICS_ENDPOINT  = 'https://your-endpoint/collect'
 *          → sends { event, step, label, url, sid, t } via sendBeacon().
 *
 *       Neither: module works as a local-only debug helper (original behaviour).
 *
 * Public API:
 *   track(eventName, properties)   → void   — record a named event
 *   trackPageview(stepNum, label)  → void   — record a workflow step visit
 *   getSummary()                   → object — local debug data for this device
 *   clearAll()                     → void   — wipe all local analytics data
 */

(function (window) {
  'use strict';

  var _KEY_PREFIX  = 'coho_analytics_';
  var _EVENTS_KEY  = _KEY_PREFIX + 'events';   // rolling event buffer
  var _COUNTS_KEY  = _KEY_PREFIX + 'counts';   // aggregate counts
  var _MAX_EVENTS  = 200;

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
    } catch (_) {}
  }

  function _getSessionId() {
    var k = _KEY_PREFIX + 'session';
    var id = null;
    try { id = localStorage.getItem(k); } catch (_) {}
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem(k, id); } catch (_) {}
    }
    return id;
  }

  // ─── Remote beacon ───────────────────────────────────────────────────────────

  /**
   * Send event to a custom HTTP endpoint via navigator.sendBeacon().
   * Fire-and-forget: does not block navigation and does not throw.
   */
  function _sendBeacon(endpoint, payload) {
    try {
      if (!navigator.sendBeacon) return;
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon(endpoint, blob);
    } catch (_) {}
  }

  /**
   * Track a pageview via Plausible's event API (if provider = 'plausible').
   * Uses Plausible's standard /api/event endpoint.
   * https://plausible.io/docs/events-api
   */
  function _plausibleEvent(domain, eventName, props) {
    try {
      var payload = {
        name:   eventName === 'workflow_step_visit' ? 'pageview' : eventName,
        url:    (window.location && window.location.href) || '',
        domain: domain,
        props:  props || {}
      };
      _sendBeacon('https://plausible.io/api/event', payload);
    } catch (_) {}
  }

  /**
   * Load Plausible's tracking script once (idempotent).
   */
  var _plausibleLoaded = false;
  function _loadPlausible(domain) {
    if (_plausibleLoaded || !domain) return;
    _plausibleLoaded = true;
    try {
      var s = document.createElement('script');
      s.defer = true;
      s.setAttribute('data-domain', domain);
      s.src = 'https://plausible.io/js/script.js';
      document.head.appendChild(s);
    } catch (_) {}
  }

  /**
   * Route an event to whichever remote back-end (if any) is configured.
   */
  function _remoteTrack(eventName, payload) {
    var cfg = (window.APP_CONFIG) || {};
    var provider = cfg.ANALYTICS_PROVIDER || '';
    var endpoint = cfg.ANALYTICS_ENDPOINT || '';
    var domain   = cfg.ANALYTICS_DOMAIN   || '';

    if (provider === 'plausible' && domain) {
      _loadPlausible(domain);
      _plausibleEvent(domain, eventName, payload);
    } else if (endpoint) {
      _sendBeacon(endpoint, payload);
    }
    // If neither is configured: local-only, no network request.
  }

  // ─── Core event recording ────────────────────────────────────────────────────

  /**
   * Record a named event locally and optionally forward to remote backend.
   *
   * @param {string} eventName  Short event name, e.g. 'workflow_step_visit'
   * @param {object} [props]    Key→value properties merged into the event record
   */
  function track(eventName, props) {
    if (!eventName) return;

    var event = {
      t:   _now(),
      sid: _getSessionId(),
      evt: String(eventName)
    };

    if (props && typeof props === 'object') {
      var keys = Object.keys(props);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i] !== 't' && keys[i] !== 'sid' && keys[i] !== 'evt') {
          event[keys[i]] = props[keys[i]];
        }
      }
    }

    // Tier 1: local storage
    var events = _readJSON(_EVENTS_KEY, []);
    events.push(event);
    if (events.length > _MAX_EVENTS) {
      events = events.slice(events.length - _MAX_EVENTS);
    }
    _writeJSON(_EVENTS_KEY, events);

    var counts = _readJSON(_COUNTS_KEY, {});
    counts[eventName] = (counts[eventName] || 0) + 1;
    _writeJSON(_COUNTS_KEY, counts);

    // Tier 2: remote (no-op unless APP_CONFIG has a provider/endpoint)
    _remoteTrack(eventName, event);
  }

  /**
   * Record a workflow page visit.
   *
   * @param {number} stepNum  1–5 workflow step number
   * @param {string} label    Human-readable step name, e.g. 'market_analysis'
   */
  function trackPageview(stepNum, label) {
    track('workflow_step_visit', {
      step:  stepNum,
      label: label || ('step_' + stepNum),
      url:   (window.location && window.location.pathname) || '',
      ref:   (document.referrer && document.referrer.replace(/^https?:\/\/[^/]+/, '')) || ''
    });
  }

  /**
   * Return a local debug summary (this device/session only).
   * To see population-level data, configure APP_CONFIG.ANALYTICS_PROVIDER.
   *
   * @returns {{ counts: object, recent: Array, session: string, note: string }}
   */
  function getSummary() {
    var cfg      = (window.APP_CONFIG) || {};
    var provider = cfg.ANALYTICS_PROVIDER || '';
    var endpoint = cfg.ANALYTICS_ENDPOINT || '';
    var note     = provider === 'plausible'
      ? 'Remote: Plausible (' + (cfg.ANALYTICS_DOMAIN || '?') + ')'
      : endpoint
        ? 'Remote: custom endpoint (' + endpoint + ')'
        : 'Remote: not configured — data is local-only. ' +
          'Set APP_CONFIG.ANALYTICS_PROVIDER="plausible" + APP_CONFIG.ANALYTICS_DOMAIN ' +
          'or APP_CONFIG.ANALYTICS_ENDPOINT to enable cross-session aggregation.';

    return {
      counts:  _readJSON(_COUNTS_KEY, {}),
      recent:  _readJSON(_EVENTS_KEY, []).slice(-10),
      session: _getSessionId(),
      note:    note
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

  // ─── Auto-fire pageview via data-step attribute ──────────────────────────────
  // Pages load this script with data-step and data-step-label on the tag:
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
    if (!thisScript) return;
    var step  = parseInt(thisScript.getAttribute('data-step'),  10) || 0;
    var label = thisScript.getAttribute('data-step-label') || '';
    if (!step) return;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { trackPageview(step, label); });
    } else {
      trackPageview(step, label);
    }
  }());

  // ─── Expose module ───────────────────────────────────────────────────────────

  window.CohoAnalytics = {
    track:         track,
    trackPageview: trackPageview,
    getSummary:    getSummary,
    clearAll:      clearAll
  };

}(window));
