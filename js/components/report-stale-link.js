/**
 * report-stale-link.js  (F14, 2026-05-26)
 *
 * Renders a small "⚠ report stale" inline link next to any external URL
 * the user might encounter (housing-lead contact, housing-plan PDF,
 * advocacy org website, etc.). Clicking it opens the site's feedback
 * form with the page and link prefilled, so users help keep links fresh.
 *
 * Companion to scripts/audit/url-health-sweep.mjs (the machine-driven
 * weekly monitor) — together they form the "machines monitor + users
 * report" freshness loop.
 *
 * Usage:
 *   ReportStaleLink.build({
 *     url: 'https://www.google.com/search?q=%22Boulder%20Valley%20Comprehensive%20Plan%22%20Colorado',
 *     label: 'Boulder Valley Comprehensive Plan',
 *   })
 *   // → returns HTML string for an inline span. Insert via .innerHTML +=.
 *
 *   ReportStaleLink.verifiedBadge({
 *     url: 'https://...',
 *     healthCache: window.__urlHealth   // optional, see _loadHealthCache
 *   })
 *   // → "verified 2026-05-26" span when the cache says the URL is OK,
 *     null otherwise. Pulls from data/url-health.json fetched on demand.
 */
(function (global) {
  'use strict';

  var FEEDBACK_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfC1m7Y1_b3VL_U9rOg8f0nIE14RVg8qm4gvhQaG2Qw8vVOdw/viewform';
  var _healthPromise = null;
  var _healthCache = null;

  function _asset(p) {
    return (typeof global.resolveAssetUrl === 'function') ? global.resolveAssetUrl(p) : p;
  }

  // Lazy-load data/url-health.json once per session — used by verifiedBadge()
  // to surface "verified YYYY-MM-DD" next to external links.
  function _loadHealthCache() {
    if (_healthCache) return Promise.resolve(_healthCache);
    if (_healthPromise) return _healthPromise;
    _healthPromise = fetch(_asset('data/url-health.json'))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) {
        _healthCache = json || { byUrl: {} };
        return _healthCache;
      })
      .catch(function () {
        _healthCache = { byUrl: {} };
        return _healthCache;
      });
    return _healthPromise;
  }

  function _shortDate(iso) {
    if (!iso) return null;
    try {
      var d = new Date(iso);
      return d.toISOString().slice(0, 10);
    } catch (_) { return null; }
  }

  function _normalizeUrl(url) {
    try {
      var u = new URL(url);
      u.hash = '';
      return u.toString();
    } catch (_) { return url; }
  }

  function _escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Reports go to the site's feedback form. Its "Which page?" field
  // (entry.440415848) is prefilled with the page path and the link label so
  // the report arrives with the link it is about.
  function _buildReportUrl(opts) {
    var label = opts.label || opts.url;
    var page = (typeof window !== 'undefined' && window.location) ? (window.location.pathname || '/') : '/';
    return FEEDBACK_FORM_URL + '?usp=pp_url&entry.440415848=' +
      encodeURIComponent(page + ' · stale link: ' + label + ' (' + opts.url + ')');
  }

  function build(opts) {
    if (!opts || !opts.url) return '';
    var reportUrl = _buildReportUrl(opts);
    return '<a class="rsl-link" href="' + _escHtml(reportUrl) + '" ' +
      'target="_blank" rel="noopener" ' +
      'title="Report this link as stale (opens the feedback form)" ' +
      'aria-label="Report stale link: ' + _escHtml(opts.label || opts.url) + '">' +
      '⚠ report stale</a>';
  }

  // Returns an HTML string with the "verified YYYY-MM-DD" badge for a URL
  // if the health cache says it's OK. Returns '' if the URL isn't in the
  // cache OR is broken (we deliberately don't show a "broken" badge to
  // users — that's noise; the report-stale link is the user-facing
  // affordance for breaks).
  function verifiedBadge(url) {
    if (!url || !_healthCache) return '';
    var entry = _healthCache.byUrl[_normalizeUrl(url)];
    if (!entry || (entry.status !== 'ok' && entry.status !== 'allow')) return '';
    var d = _shortDate(entry.lastOkAt || entry.lastCheckedAt);
    if (!d) return '';
    return '<span class="rsl-verified" title="URL last verified by automated sweep — see data/url-health.json">' +
      'verified ' + d + '</span>';
  }

  // Async version that waits for the cache to load if needed.
  function verifiedBadgeAsync(url) {
    return _loadHealthCache().then(function () { return verifiedBadge(url); });
  }

  // Decorate a container's <a href="http..."> links with inline
  // report-stale buttons. Skips anchors that already have data-no-stale.
  function decorateAnchors(container, opts) {
    if (!container) return;
    var anchors = container.querySelectorAll('a[href^="http"]:not([data-no-stale])');
    anchors.forEach(function (a) {
      if (a.dataset.rslDecorated) return;
      a.dataset.rslDecorated = '1';
      var url = a.href;
      var label = a.textContent.trim() || a.getAttribute('aria-label') || url;
      var span = document.createElement('span');
      span.className = 'rsl-wrap';
      span.innerHTML = ' ' + build({
        url: url,
        label: label,
        context: (opts && opts.context) || ''
      });
      a.parentNode.insertBefore(span, a.nextSibling);
    });
  }

  global.ReportStaleLink = {
    build: build,
    verifiedBadge: verifiedBadge,
    verifiedBadgeAsync: verifiedBadgeAsync,
    loadHealthCache: _loadHealthCache,
    decorateAnchors: decorateAnchors
  };
})(typeof window !== 'undefined' ? window : this);
