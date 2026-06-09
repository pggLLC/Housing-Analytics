/* F177 — Data section landing banner.
 *
 * Renders a small, consistent cross-link strip at the top of every page
 * under the "Data" nav heading so a visitor lands knowing:
 *   (a) what this page is for,
 *   (b) what the other Data pages cover,
 *   (c) where to start if they want a "10-second overview."
 *
 * Mounts into a <div id="dataSectionBanner"></div> placeholder on each
 * Data page (data-review-hub.html, data-explorer.html,
 * census-dashboard.html, data-status.html, dashboard-data-quality.html).
 * If the placeholder isn't present, no-ops cleanly.
 *
 * Why a shared banner: before F177 the Data section had 5 confusingly
 * similar pages (Data Health / Data Quality / Data Review / Data
 * Explorer / Census Explorer — the last mislabeled) with no entry-point
 * guidance. Users couldn't tell which page they should be on. The
 * banner makes the 3-role structure (Hub / Files / Multifamily Lens)
 * + 2 secondary diagnostics pages explicit on every page.
 */
(function () {
  'use strict';

  // Single source of truth for the section. Mirrors js/navigation.js
  // GROUPS[].items for "Data" minus the isHeader separator.
  var PAGES = [
    { href: 'data-review-hub.html',         label: 'Data Hub',
      role: 'Start here · sources, freshness, quality monitoring, discovery',
      kind: 'primary', icon: '★' },
    { href: 'data-explorer.html',           label: 'File Browser',
      role: 'Inspect every JSON / GeoJSON / CSV in data/ with schema previews',
      kind: 'primary', icon: '📁' },
    // F178 — Multifamily Lens replaced by Data Map. The old page
    // (census-dashboard.html) stays accessible but with a deprecation
    // pointer to the new map browser.
    { href: 'data-map-browser.html',        label: 'Data Map',
      role: 'Interactive map of every geographic dataset — LIHTC, QCT/DDA, OZ, amenities',
      kind: 'primary', icon: '🗺️' },
    { href: 'data-status.html',             label: 'Pipeline Status',
      role: 'Live API freshness + 5-layer validation rollup',
      kind: 'secondary' },
    { href: 'dashboard-data-quality.html',  label: 'Coverage QA',
      role: 'Per-source coverage % + place-CHAS apportionment audit',
      kind: 'secondary' },
  ];

  function _currentSlug() {
    var p = (window.location.pathname || '').split('/').pop();
    if (!p || p === '' || p === '/') return 'index.html';
    return p;
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _render(host) {
    var current = _currentSlug();
    var primary = PAGES.filter(function (p) { return p.kind === 'primary'; });
    var secondary = PAGES.filter(function (p) { return p.kind === 'secondary'; });

    function _card(p) {
      var isActive = p.href === current;
      var border = isActive ? 'var(--accent)' : 'var(--border)';
      var bg = isActive ? 'var(--accent-bg, rgba(3,102,214,0.08))' : 'var(--bg2)';
      var weight = isActive ? '700' : '600';
      var marker = isActive
        ? '<span style="background:var(--accent);color:#fff;padding:0 6px;border-radius:9px;font-size:.62rem;font-weight:700;margin-left:6px;letter-spacing:.04em">YOU ARE HERE</span>'
        : '';
      var inner =
        '<div style="display:flex;align-items:baseline;gap:.4rem">' +
          (p.icon ? '<span aria-hidden="true" style="font-size:.95rem">' + _esc(p.icon) + '</span>' : '') +
          '<strong style="font-weight:' + weight + ';font-size:.92rem">' + _esc(p.label) + '</strong>' +
          marker +
        '</div>' +
        '<div style="margin-top:3px;font-size:.76rem;color:var(--muted);line-height:1.35">' + _esc(p.role) + '</div>';
      if (isActive) {
        return '<div style="border:1px solid ' + border + ';background:' + bg + ';border-radius:8px;padding:.6rem .75rem">' + inner + '</div>';
      }
      return '<a href="' + _esc(p.href) + '" style="display:block;border:1px solid ' + border + ';background:' + bg + ';border-radius:8px;padding:.6rem .75rem;color:var(--text);text-decoration:none;transition:border-color .15s,background .15s" onmouseover="this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.borderColor=\'' + border + '\'">' + inner + '</a>';
    }

    function _secondaryLink(p) {
      var isActive = p.href === current;
      if (isActive) {
        return '<span style="font-size:.78rem;color:var(--accent);font-weight:700">' + _esc(p.label) + ' · <span style="color:var(--muted);font-weight:400">you are here</span></span>';
      }
      return '<a href="' + _esc(p.href) + '" style="font-size:.78rem;color:var(--muted);text-decoration:none;border-bottom:1px dotted var(--muted)">' + _esc(p.label) + '</a>' +
        ' <span style="font-size:.7rem;color:var(--muted);opacity:.7">· ' + _esc(p.role) + '</span>';
    }

    host.innerHTML =
      '<section aria-label="Data section navigation" style="margin:0 0 var(--sp4,1.25rem);padding:.85rem 1rem;background:var(--bg);border:1px solid var(--border);border-radius:10px">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:.5rem;margin-bottom:.65rem">' +
          '<strong style="font-size:.95rem">Data section · 3 places to look</strong>' +
          '<span style="font-size:.72rem;color:var(--muted)">Pick a card to switch views</span>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:.5rem">' +
          primary.map(_card).join('') +
        '</div>' +
        '<div style="margin-top:.75rem;padding-top:.6rem;border-top:1px dashed var(--border);display:flex;flex-wrap:wrap;gap:1rem;align-items:baseline">' +
          '<span style="font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">Pipeline diagnostics:</span>' +
          secondary.map(_secondaryLink).join(' &nbsp;·&nbsp; ') +
        '</div>' +
      '</section>';
  }

  function _init() {
    var host = document.getElementById('dataSectionBanner');
    if (!host) return;
    _render(host);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  // Expose for tests / debugging
  window.DataSectionBanner = { render: _render, pages: PAGES };
})();
