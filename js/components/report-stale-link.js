/**
 * report-stale-link.js  (F14, 2026-05-26)
 *
 * Renders a small "⚠ report stale" inline link next to any external URL
 * the user might encounter (housing-lead contact, housing-plan PDF,
 * advocacy org website, etc.). Clicking it opens a pre-filled GitHub
 * issue so users help maintain freshness without leaving the site.
 *
 * Companion to scripts/audit/url-health-sweep.mjs (the machine-driven
 * weekly monitor) — together they form the "machines monitor + users
 * report" freshness loop.
 *
 * Usage:
 *   ReportStaleLink.build({
 *     url: 'https://bouldercolorado.gov/planning/...',
 *     label: 'Boulder Valley Comprehensive Plan',
 *     context: 'place:0807850 housingPlans[0]'   // optional, included in issue body
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

  var REPO = 'pggLLC/Housing-Analytics';
  var ISSUE_BASE = 'https://github.com/' + REPO + '/issues/new';
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

  function _buildIssueUrl(opts) {
    var url = opts.url;
    var label = opts.label || '(no label)';
    var context = opts.context || '';
    var pageUrl = (typeof window !== 'undefined' && window.location)
      ? window.location.href.split('#')[0]
      : '';
    var title = 'Stale link reported: ' + label;
    var body = [
      '**URL:** `' + url + '`',
      '**Resource label:** ' + label,
      context ? '**Source context:** `' + context + '`' : '',
      '**Page reported from:** ' + pageUrl,
      '',
      '## What\'s wrong',
      'Describe what you saw (404, redirect to wrong page, content changed, no longer the right doc, etc.):',
      '',
      '<!-- Replace this comment with what happened -->',
      '',
      '## Replacement URL (if you have one)',
      '',
      '<!-- Paste the new URL here if you found it; we\'ll re-link -->',
      '',
      '---',
      '_Auto-filed via Report Stale Link button (F14)._',
      '_Sweep history for this URL: see `data/url-health.json`._'
    ].filter(Boolean).join('\n');
    return ISSUE_BASE +
      '?title=' + encodeURIComponent(title) +
      '&body='  + encodeURIComponent(body) +
      '&labels=' + encodeURIComponent('url-health,user-report');
  }

  function build(opts) {
    if (!opts || !opts.url) return '';
    var issueUrl = _buildIssueUrl(opts);
    return '<a class="rsl-link" href="' + _escHtml(issueUrl) + '" ' +
      'target="_blank" rel="noopener" ' +
      'title="Report this link as stale (opens GitHub issue, pre-filled)" ' +
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
