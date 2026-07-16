/**
 * js/components/homeownership-programs.js
 * Data-backed cards for the consumer-facing Help for Homebuyers insight page.
 */
(function (global) {
  'use strict';

  var DATA_URL = 'data/policy/homeownership-programs.json';

  var LEVEL_LABELS = {
    federal: 'Federal',
    colorado: 'Colorado',
    metro: 'Metro'
  };

  var KIND_LABELS = {
    'tax-credit': 'Tax credit',
    grant: 'Grant',
    'dpa-loan': 'DPA loan',
    'property-tax-relief': 'Property-tax relief'
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function statusLabel(status) {
    return {
      active: 'Active',
      expired: 'Expired',
      proposed: 'Proposed',
      VERIFY: 'VERIFY'
    }[status] || 'Watch';
  }

  // Site-theme pill classes: token pairs are asserted >= 4.5:1 in BOTH
  // modes by test/wcag-pill-contrast.test.js (F181).
  function statusClass(status) {
    if (status === 'active') return 'pill good';
    if (status === 'proposed' || status === 'VERIFY') return 'pill warn';
    return 'pill bad';
  }

  function fetchJson(url) {
    var resolved = global.resolveAssetUrl ? global.resolveAssetUrl(url) : url;
    return fetch(resolved, { cache: 'no-cache' }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    });
  }

  function formatWorth(program) {
    if (program.what_its_worth) return program.what_its_worth;
    if (typeof program.benefit_amount === 'number') return '$' + program.benefit_amount.toLocaleString();
    return 'VERIFY';
  }

  function renderProgramCard(program) {
    return '<article class="chart-card" data-homeownership-program-id="' + esc(program.id) + '" style="padding:var(--sp3);">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--sp2);">' +
        '<div>' +
          '<p style="margin:0 0 .35rem;color:var(--muted);font-size:var(--tiny);text-transform:uppercase;letter-spacing:.04em;">' +
            esc(KIND_LABELS[program.kind] || program.kind) +
          '</p>' +
          '<h3 style="margin:0 0 var(--sp1);font-size:1.08rem;">' + esc(program.name) + '</h3>' +
        '</div>' +
        '<span class="' + statusClass(program.status) + '" style="font-size:var(--tiny);white-space:nowrap;">' + esc(statusLabel(program.status)) + '</span>' +
      '</div>' +
      '<p style="line-height:1.65;margin:var(--sp2) 0;">' + esc(program.plain_summary) + '</p>' +
      '<dl style="display:grid;gap:.65rem;margin:0;">' +
        '<div><dt style="font-weight:700;">Who it is for</dt><dd style="margin:0;color:var(--muted);">' + esc(program.who_its_for) + '</dd></div>' +
        '<div><dt style="font-weight:700;">What it is worth</dt><dd style="margin:0;color:var(--muted);">' + esc(formatWorth(program)) + '</dd></div>' +
        '<div><dt style="font-weight:700;">How to start</dt><dd style="margin:0;color:var(--muted);">' + esc(program.how_to_start) + '</dd></div>' +
      '</dl>' +
      '<div style="font-size:var(--tiny);color:var(--muted);margin-top:var(--sp2);display:flex;flex-wrap:wrap;gap:.5rem;">' +
        '<span>Verified ' + esc(program.last_verified || 'VERIFY') + '</span>' +
        (program.sunset_date ? '<span>Sunset ' + esc(program.sunset_date) + '</span>' : '') +
        '<a href="' + esc(program.source_url) + '" target="_blank" rel="noopener">Official source</a>' +
      '</div>' +
    '</article>';
  }

  function renderPrograms(target, doc) {
    if (!target) return;
    var programs = doc && Array.isArray(doc.programs) ? doc.programs : [];
    if (!programs.length) {
      target.innerHTML = '<p style="color:var(--bad);">No homebuyer programs loaded.</p>';
      return;
    }

    target.innerHTML = ['federal', 'colorado', 'metro'].map(function (level) {
      var group = programs.filter(function (program) { return program.level === level; });
      if (!group.length) return '';
      return '<section aria-labelledby="homebuyer-' + esc(level) + '-heading" style="margin:var(--sp4) 0;">' +
        '<h2 id="homebuyer-' + esc(level) + '-heading">' + esc(LEVEL_LABELS[level]) + '</h2>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:var(--sp3);">' +
          group.map(renderProgramCard).join('') +
        '</div>' +
      '</section>';
    }).join('');
  }

  function init() {
    var target = document.querySelector('[data-homeownership-programs]');
    if (!target) return;
    fetchJson(DATA_URL).then(function (doc) {
      renderPrograms(target, doc);
    }).catch(function (err) {
      target.innerHTML = '<p style="color:var(--bad);">Homebuyer program data could not be loaded: ' + esc(err.message) + '</p>';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.HomeownershipPrograms = {
    DATA_URL: DATA_URL,
    renderPrograms: renderPrograms,
    renderProgramCard: renderProgramCard
  };
})(typeof window !== 'undefined' ? window : this);
