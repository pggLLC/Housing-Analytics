/**
 * js/source-attribution.js — COHO Analytics
 * Injects lightweight source-attribution badges on consuming dashboard pages.
 *
 * Usage: Include this script on any page that uses data from the registry.
 * It reads [data-source-id] attributes on chart wrappers and injects
 * a "Data: [Source Name] · Freshness · View Hub →" badge below each chart.
 *
 * Attribute API:
 *   data-source-id="fred-data"          — single source id
 *   data-source-ids="fred-data,acs-state" — multiple comma-separated ids
 */

(function () {
  'use strict';

  var HUB_URL = 'data-review-hub.html';

  /* ── Helpers ──────────────────────────────────────────────────── */
  function esc(s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function relToRoot() {
    if (location.pathname.includes('/private/weekly-brief/')) return '../../';
    if (location.pathname.includes('/docs/')) return '../';
    return '';
  }

  function hubUrl() {
    return relToRoot() + HUB_URL;
  }

  function statusClass(status) {
    if (status === 'current') return 'sa-badge--ok';
    if (status === 'aging')   return 'sa-badge--warn';
    if (status === 'stale')   return 'sa-badge--error';
    return 'sa-badge--unknown';
  }

  function statusLabel(status) {
    if (status === 'current') return '✅ Current';
    if (status === 'aging')   return '⚠️ Aging';
    if (status === 'stale')   return '🔴 Stale';
    return '❓ Unknown';
  }

  /* ── CSS injection (done once) ────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('sa-styles')) return;
    var style = document.createElement('style');
    style.id = 'sa-styles';
    style.textContent = [
      '.sa-attribution{display:flex;flex-wrap:wrap;align-items:center;gap:.35rem;',
      'margin-top:.4rem;font-size:.72rem;color:var(--muted,#476080);',
      'border-top:1px dashed var(--border,#dde3ec);padding-top:.3rem;}',
      '.sa-attribution__label{font-weight:600;color:var(--text,#1a1a2e);}',
      '.sa-badge{display:inline-flex;align-items:center;gap:.2rem;padding:.1rem .45rem;',
      'border-radius:1rem;font-size:.7rem;font-weight:700;text-decoration:none;}',
      '.sa-badge--ok{background:var(--good-dim,#e8f5e9);color:var(--good,#2e7d32);}',
      '.sa-badge--warn{background:var(--warn-dim,#fff8e1);color:var(--warn,#f57c00);}',
      '.sa-badge--error{background:var(--bad-dim,#fce4ec);color:var(--bad,#c62828);}',
      '.sa-badge--unknown{background:var(--bg2,#f5f5f5);color:var(--muted,#476080);}',
      '.sa-hub-link{color:var(--accent,#096e65);text-decoration:none;font-size:.7rem;}',
      '.sa-hub-link:hover{text-decoration:underline;}',
      '.sa-sep{color:var(--border-strong,#c0cad8);}',
    ].join('');
    document.head.appendChild(style);
  }

  /* ── Badge builder ───────────────────────────────────────────── */
  function buildBadge(source) {
    var statusCls = statusClass(source.status);
    var statusLbl = statusLabel(source.status);
    var lastUpd   = source.lastUpdated || '—';
    var hub       = hubUrl();
    return (
      '<span class="sa-attribution__label">Data:</span>' +
      '<a href="' + esc(hub) + '#sources" class="sa-hub-link" title="View source details in Data Hub">' +
        esc(source.name) +
      '</a>' +
      '<span class="sa-sep">·</span>' +
      '<span class="sa-badge ' + statusCls + '" title="Freshness status">' + statusLbl + '</span>' +
      '<span class="sa-sep">·</span>' +
      '<span title="Last updated">Updated ' + esc(lastUpd) + '</span>' +
      (source.features ? '<span class="sa-sep">·</span><span>' + Number(source.features).toLocaleString() + ' records</span>' : '') +
      '<span class="sa-sep">·</span>' +
      '<a href="' + esc(hub) + '" class="sa-hub-link">View Hub →</a>'
    );
  }

  function buildMultiBadge(sources) {
    var hub = hubUrl();
    var names = sources.map(function (s) {
      return '<a href="' + esc(hub) + '#sources" class="sa-hub-link">' + esc(s.name) + '</a>';
    }).join(', ');
    var anyStale   = sources.some(function (s) { return s.status === 'stale'; });
    var anyAging   = sources.some(function (s) { return s.status === 'aging'; });
    var overallCls = anyStale ? 'sa-badge--error' : (anyAging ? 'sa-badge--warn' : 'sa-badge--ok');
    var overallLbl = anyStale ? '🔴 Data issue' : (anyAging ? '⚠️ Aging' : '✅ Current');
    return (
      '<span class="sa-attribution__label">Sources:</span>' +
      names +
      '<span class="sa-sep">·</span>' +
      '<span class="sa-badge ' + overallCls + '">' + overallLbl + '</span>' +
      '<span class="sa-sep">·</span>' +
      '<a href="' + esc(hub) + '" class="sa-hub-link">View Hub →</a>'
    );
  }

  /* ── Core injection ──────────────────────────────────────────── */
  function injectAttributions() {
    var inv = window.DataSourceInventory;
    if (!inv) return;
    var sources = inv.getSources();

    function findById(id) {
      return sources.find(function (s) { return s.id === id; }) || null;
    }

    var targets = document.querySelectorAll('[data-source-id],[data-source-ids]');
    targets.forEach(function (el) {
      // Skip if already attributed
      if (el.querySelector('.sa-attribution')) return;

      var idsStr = el.getAttribute('data-source-ids') || el.getAttribute('data-source-id') || '';
      var ids = idsStr.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!ids.length) return;

      var matched = ids.map(findById).filter(Boolean);
      if (!matched.length) return;

      var attr = document.createElement('div');
      attr.className = 'sa-attribution';
      attr.setAttribute('role', 'note');
      attr.setAttribute('aria-label', 'Data source attribution');

      if (matched.length === 1) {
        attr.innerHTML = buildBadge(matched[0]);
      } else {
        attr.innerHTML = buildMultiBadge(matched);
      }

      el.appendChild(attr);
    });
  }

  /* ── "View Data Sources" nav link ────────────────────────────── */
  function injectNavLink() {
    var hub = hubUrl();
    var existing = document.querySelector('[data-sa-nav]');
    if (existing) return;

    // Look for a natural anchor point near the page title or nav
    var heroSection = document.querySelector('.hero, .page-header, main > section:first-child');
    if (!heroSection) return;

    var link = document.createElement('a');
    link.setAttribute('data-sa-nav', '1');
    link.href = hub;
    link.className = 'sa-hub-link';
    link.style.cssText = 'display:inline-flex;align-items:center;gap:.25rem;font-size:.78rem;margin-top:.35rem;';
    link.setAttribute('aria-label', 'View data sources and freshness information');
    link.innerHTML = '🔍 Data sources &amp; freshness →';

    heroSection.appendChild(link);
  }

  /* ── Entry point ─────────────────────────────────────────────── */
  function init() {
    injectStyles();
    injectAttributions();
    injectNavLink();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-run if DataSourceInventory loads late
  if (!window.DataSourceInventory) {
    window.addEventListener('load', function () {
      if (window.DataSourceInventory) init();
    });
  }

  // Expose for manual invocation
  window.SourceAttribution = { inject: init };

}());
