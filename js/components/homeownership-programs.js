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
      VERIFY: 'Not yet verified'
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
    return 'Amount not yet verified';
  }

  // Review-date warning (js/components/review-status.js). Absent helper: no
  // warning rather than a broken card.
  function reviewHtml(record) {
    return global.ReviewStatus ? global.ReviewStatus.html(record) : '';
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
        global.ProvenanceLabel.html(program) +
        (program.sunset_date ? '<span>Sunset ' + esc(program.sunset_date) + '</span>' : '') +
        '<a href="' + esc(program.source_url) + '" target="_blank" rel="noopener">Official source</a>' +
      '</div>' +
      reviewHtml(program) +
    '</article>';
  }

  // Local nonprofits and agencies: homebuyer classes, counseling, down payment help and Habitat.
  var REGION_LABELS = {
    statewide: 'Statewide',
    western: 'Western Slope',
    southwest: 'Southwest',
    south: 'Southern Colorado and the San Luis Valley',
    mountains: 'Mountains and Upper Arkansas',
    'front-range': 'Front Range'
  };

  function renderLocalHelp(doc) {
    var list = doc && Array.isArray(doc.local_help) ? doc.local_help : [];
    if (!list.length) return '';
    var meta = doc.local_help_meta || {};
    return '<section aria-labelledby="homebuyer-local-heading" style="margin:var(--sp4) 0;">' +
      '<h2 id="homebuyer-local-heading">Local help</h2>' +
      '<p style="margin-top:0;">Nonprofits and local agencies that teach homebuyer classes, counsel buyers, and in some places lend down payment help or build Habitat homes. ' +
        esc(meta.note || '') +
        (meta.source_page ? ' <a href="' + esc(meta.source_page) + '" target="_blank" rel="noopener">Find a class by county (CHFA)</a>' : '') + '</p>' +
      Object.keys(REGION_LABELS).map(function (region) {
        var group = list.filter(function (org) { return org.region === region; });
        if (!group.length) return '';
        return '<h3 style="margin:var(--sp3) 0 var(--sp2);">' + esc(REGION_LABELS[region]) + '</h3>' +
          '<ul style="list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px, 100%),1fr));gap:var(--sp2);">' +
          group.map(function (org) {
            return '<li class="chart-card" data-local-help-id="' + esc(org.id) + '" style="padding:var(--sp2) var(--sp3);margin:0;">' +
              '<p style="margin:0;"><a href="' + esc(org.url) + '" target="_blank" rel="noopener"><strong>' + esc(org.name) + '</strong></a></p>' +
              '<p style="margin:.2rem 0;color:var(--muted);font-size:var(--small);">' + esc(org.area) + (org.phone ? ' · ' + esc(org.phone) : '') + '</p>' +
              '<p style="margin:.2rem 0 .4rem;">' + esc(org.offers) + '</p>' +
              '<p style="margin:0;font-size:var(--tiny);color:var(--muted);"><a href="' + esc(org.source_url) + '" target="_blank" rel="noopener" title="' + esc(org.source_note) + '">Source</a>, checked ' + esc(org.last_verified) + '</p>' +
            '</li>';
          }).join('') +
          '</ul>';
      }).join('') +
    '</section>';
  }

  function renderPrograms(target, doc) {
    if (!target) return;
    var programs = doc && Array.isArray(doc.programs) ? doc.programs : [];
    if (!programs.length) {
      target.innerHTML = '<p style="color:var(--bad);">No homebuyer programs loaded.</p>';
      return;
    }

    var summary = global.ReviewStatus ? global.ReviewStatus.summaryHtml(programs, null, 'programs') : '';
    target.innerHTML = summary + ['federal', 'colorado', 'metro'].map(function (level) {
      var group = programs.filter(function (program) { return program.level === level; });
      if (!group.length) return '';
      return '<section aria-labelledby="homebuyer-' + esc(level) + '-heading" style="margin:var(--sp4) 0;">' +
        '<h2 id="homebuyer-' + esc(level) + '-heading">' + esc(LEVEL_LABELS[level]) + '</h2>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px, 100%),1fr));gap:var(--sp3);">' +
          group.map(renderProgramCard).join('') +
        '</div>' +
      '</section>';
    }).join('') + renderLocalHelp(doc);
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
    renderLocalHelp: renderLocalHelp,
    renderProgramCard: renderProgramCard
  };
})(typeof window !== 'undefined' ? window : this);
