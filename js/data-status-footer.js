/**
 * data-status-footer.js — COHO Analytics
 * Injects a "Data last updated" status bar beneath the page hero section
 * and adds source attribution below chart/table regions.
 *
 * Usage: include <script src="js/data-status-footer.js"></script> and add
 * data attributes to configure the page:
 *
 *   <body data-page-source="FRED · Federal Reserve Bank of St. Louis"
 *         data-page-update-key="fred">
 *
 * Update keys map to sentinel timestamps in the data files:
 *   fred        → data/fred-data.json  → .updated
 *   lihtc       → data/chfa-lihtc.json → .fetchedAt
 *   manifest    → data/manifest.json   → .generated
 *
 * A static fallback date can also be supplied:
 *   <body data-page-last-updated="2026-03-01">
 */
(function () {
  'use strict';

  /* ── Config: map update keys → file paths + JSON field ───── */
  var UPDATE_SOURCES = {
    fred:     { file: 'data/fred-data.json',   field: 'updated' },
    lihtc:    { file: 'data/chfa-lihtc.json',  field: 'fetchedAt' },
    manifest: { file: 'data/manifest.json',    field: 'generated' },
    ami:      { file: 'data/co_ami_gap_by_county.json', field: ['meta', 'generated'] }
  };

  var PREFIX = typeof __PATH_PREFIX !== 'undefined' ? __PATH_PREFIX : '';

  /* ── Inject styles ────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('dsf-styles')) return;
    var s = document.createElement('style');
    s.id = 'dsf-styles';
    s.textContent = [
      '.data-status-bar{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .85rem;padding:.55rem 1rem;border-radius:var(--radius);background:var(--bg2,#f5f7fa);border:1px solid var(--border);font-size:.8rem;color:var(--muted);margin-bottom:var(--sp3,1rem)}',
      '.data-status-bar .dsb-item{display:flex;align-items:center;gap:.35rem}',
      '.data-status-bar .dsb-icon{font-size:.95rem}',
      '.data-status-bar .dsb-label{font-weight:600}',
      '.data-status-bar .dsb-value{color:var(--text)}',
      '.data-status-bar a{color:var(--link,var(--accent));font-size:.78rem;margin-left:.25rem}',
      '.data-source-attr{font-size:.73rem;color:var(--faint,var(--muted));margin-top:.35rem;font-style:italic}',
      '.data-source-attr a{color:var(--link,var(--accent))}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ── Format ISO date as human-readable ───────────────────── */
  function formatDate(iso) {
    if (!iso) return null;
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (_) {
      return null;
    }
  }

  /* ── Fetch timestamp from a data file ─────────────────────── */
  function fetchTimestamp(key, callback) {
    var src = UPDATE_SOURCES[key];
    if (!src) { callback(null); return; }

    fetch(PREFIX + src.file)
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (data) {
        var val;
        if (Array.isArray(src.field)) {
          // Nested field path
          val = data;
          src.field.forEach(function (k) { val = val && val[k]; });
        } else {
          val = data[src.field];
        }
        callback(formatDate(val));
      })
      .catch(function () { callback(null); });
  }

  /* ── Build and inject the status bar ─────────────────────── */
  function buildStatusBar(dateStr, sourceStr) {
    var bar = document.createElement('div');
    bar.className = 'data-status-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Data currency information');

    var html = '';

    if (dateStr) {
      html += '<div class="dsb-item">' +
        '<span class="dsb-icon" aria-hidden="true">🗓</span>' +
        '<span class="dsb-label">Data last updated:</span>' +
        '<span class="dsb-value">' + escHtml(dateStr) + '</span>' +
        '</div>';
    }

    if (sourceStr) {
      html += '<div class="dsb-item">' +
        '<span class="dsb-icon" aria-hidden="true">📊</span>' +
        '<span class="dsb-label">Source:</span>' +
        '<span class="dsb-value">' + escHtml(sourceStr) + '</span>' +
        '</div>';
    }

    html += '<a href="' + PREFIX + 'data-status.html" aria-label="View full data health report">View data health ›</a>';

    bar.innerHTML = html;
    return bar;
  }

  /* ── HTML escape ─────────────────────────────────────────── */
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Inject bar after hero / page intro ──────────────────── */
  function insertBar(bar) {
    // Try to insert after the hero section or h1 in main
    var main = document.querySelector('main, #main-content');
    if (!main) return;

    var hero = main.querySelector('.hero, .page-hero, section.hero');
    if (hero && hero.parentNode) {
      hero.parentNode.insertBefore(bar, hero.nextSibling);
      return;
    }

    var h1 = main.querySelector('h1');
    if (h1 && h1.parentNode) {
      h1.parentNode.insertBefore(bar, h1.nextSibling);
      return;
    }

    // Fallback: prepend to main
    main.insertBefore(bar, main.firstChild);
  }

  /* ── Main init ───────────────────────────────────────────── */
  function init() {
    injectStyles();

    var body = document.body;
    if (!body) return;

    var updateKey    = body.getAttribute('data-page-update-key');
    var staticDate   = body.getAttribute('data-page-last-updated');
    var sourceStr    = body.getAttribute('data-page-source');

    // If neither key nor static date is provided, skip
    if (!updateKey && !staticDate) return;

    function render(dateStr) {
      var bar = buildStatusBar(dateStr, sourceStr);

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { insertBar(bar); });
      } else {
        // Wait for nav injection
        setTimeout(function () { insertBar(bar); }, 50);
      }
    }

    if (updateKey) {
      fetchTimestamp(updateKey, function (dateStr) {
        render(dateStr || (staticDate ? formatDate(staticDate) : null));
      });
    } else {
      render(formatDate(staticDate));
    }
  }

  init();
})();
