/**
 * js/components/funding-context-card.js
 * Non-scored jurisdiction funding context for PMA and Deal Calculator.
 */
(function (global) {
  'use strict';

  var ALLOWED_USE_CASES = {
    'multifamily-retrofit': true,
    'multifamily-new-construction': true,
    'owner-occupied': true
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function arr(value) {
    return Array.isArray(value) ? value : [];
  }

  function fmtDollars(value) {
    if (value == null || !Number.isFinite(+value) || +value <= 0) return null;
    var n = +value;
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + 'M';
    if (n >= 1000) return '$' + Math.round(n / 1000).toLocaleString('en-US') + 'K';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function statusLabel(program) {
    if (program.isVolumeCap) return 'PAB capacity';
    if (program.status === 'VERIFY') return 'VERIFY';
    if (program.status === 'active-watch') return 'Active watch';
    if (program.status) return String(program.status).replace(/-/g, ' ');
    if (program.available === 0) return 'Closed';
    if (program.available == null) return 'Verify';
    return 'Tracked';
  }

  function statusClass(program) {
    var status = statusLabel(program).toLowerCase();
    if (status === 'verify' || status.indexOf('watch') >= 0) return 'pill warn';
    if (status === 'closed') return 'pill bad';
    return 'pill accent';
  }

  function matchesCounty(program, countyFips) {
    var county = String(program.county || '');
    if (county === 'All') return true;
    if (!countyFips) return false;
    if (county === countyFips) return true;
    return county === 'Selected' && (program.isVolumeCap || program.isMarketSource);
  }

  function matchesExecution(program, executionType) {
    if (!executionType) return true;
    var eligible = arr(program.eligibleExecution);
    if (!eligible.length) return true;
    return eligible.indexOf(executionType) >= 0;
  }

  function matchesUseCase(program, useCase) {
    if (!useCase) return true;
    var useCases = arr(program.useCases);
    if (!useCases.length) return true;
    return useCases.indexOf(useCase) >= 0;
  }

  function sortPrograms(a, b) {
    if (!!a.isVolumeCap !== !!b.isVolumeCap) return a.isVolumeCap ? -1 : 1;
    var av = +(a.available || 0);
    var bv = +(b.available || 0);
    if (av !== bv) return bv - av;
    return String(a.name || '').localeCompare(String(b.name || ''));
  }

  function normalizeProgram(id, program) {
    var copy = {};
    Object.keys(program || {}).forEach(function (key) { copy[key] = program[key]; });
    copy.id = id;
    return copy;
  }

  function buildContext(doc, opts) {
    opts = opts || {};
    if (!doc || !doc.programs || typeof doc.programs !== 'object') {
      return {
        ok: false,
        programs: [],
        reason: 'Funding context data unavailable.'
      };
    }
    var useCase = ALLOWED_USE_CASES[opts.useCase] ? opts.useCase : null;
    var countyFips = opts.countyFips ? String(opts.countyFips).padStart(5, '0') : null;
    var executionType = opts.executionType || null;
    var programs = Object.keys(doc.programs).map(function (id) {
      return normalizeProgram(id, doc.programs[id]);
    }).filter(function (program) {
      if (program.isMarketSource) return false;
      if (!matchesCounty(program, countyFips)) return false;
      if (!matchesExecution(program, executionType)) return false;
      if (!matchesUseCase(program, useCase)) return false;
      return true;
    }).sort(sortPrograms);

    return {
      ok: programs.length > 0,
      programs: programs,
      reason: programs.length ? null : 'No funding-context rows match this jurisdiction and use case.',
      meta: {
        lastUpdated: doc.lastUpdated || null,
        vintage: doc.vintage || null,
        countyFips: countyFips,
        executionType: executionType,
        useCase: useCase
      }
    };
  }

  function programSummary(program) {
    var amount = fmtDollars(program.available);
    if (amount) return amount + ' currently tracked';
    if (program.isVolumeCap) return 'Volume-cap posture; verify current allocation before closing.';
    if (program.status === 'VERIFY') return 'VERIFY before use; no verified current dollar amount.';
    if (program.maxPerProject) return 'Max per project ' + fmtDollars(program.maxPerProject) + ' listed; verify current availability.';
    return 'Program name and source only; no verified dollar amount in this data file.';
  }

  function renderProgram(program) {
    var url = program.contactUrl || program.source_url || '';
    var link = url
      ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">Source</a>'
      : '<span>No public source link</span>';
    return '<article data-funding-context-program="' + esc(program.id) + '" style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp2);background:var(--card);">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--sp2);">' +
        '<strong style="font-size:var(--small);line-height:1.35;">' + esc(program.name || program.id) + '</strong>' +
        '<span class="' + esc(statusClass(program)) + '" style="font-size:var(--tiny);white-space:nowrap;">' + esc(statusLabel(program)) + '</span>' +
      '</div>' +
      '<p style="margin:.45rem 0 0;color:var(--muted);font-size:var(--tiny);line-height:1.45;">' + esc(programSummary(program)) + '</p>' +
      '<p style="margin:.35rem 0 0;color:var(--muted);font-size:var(--tiny);line-height:1.45;">' + esc(program.description || program.warning || '') + '</p>' +
      '<div style="margin-top:.45rem;font-size:var(--tiny);display:flex;flex-wrap:wrap;gap:.5rem;color:var(--muted);">' +
        '<span>CONTEXT only</span>' +
        link +
      '</div>' +
    '</article>';
  }

  function render(target, doc, opts) {
    if (!target) return buildContext(doc, opts);
    var ctx = buildContext(doc, opts);
    target.hidden = false;
    if (!ctx.ok) {
      target.innerHTML = '<div class="pma-empty" data-funding-context-empty="true">' + esc(ctx.reason) + '</div>';
      return ctx;
    }
    var surface = opts && opts.surface === 'deal-calculator' ? 'Deal Calculator' : 'PMA';
    var mode = ctx.meta.useCase ? ctx.meta.useCase.replace(/-/g, ' ') : 'general';
    target.innerHTML =
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--sp2);flex-wrap:wrap;">' +
        '<div>' +
          '<h2 style="margin:0;">Jurisdiction funding context <span class="pill accent" style="font-size:var(--tiny);vertical-align:middle;">CONTEXT</span></h2>' +
          '<p style="margin:.35rem 0 0;color:var(--muted);font-size:var(--tiny);line-height:1.5;">' +
            esc(surface) + ' disclosure only. Does not change PMA scores, tract selection, Deal Calculator outputs, or underwriting assumptions.' +
          '</p>' +
        '</div>' +
        '<span style="font-size:var(--tiny);color:var(--muted);">Use case: ' + esc(mode) + '</span>' +
      '</div>' +
      '<div data-funding-context-list style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:var(--sp2);margin-top:var(--sp2);">' +
        ctx.programs.slice(0, 8).map(renderProgram).join('') +
      '</div>' +
      '<p style="margin:var(--sp2) 0 0;color:var(--muted);font-size:var(--tiny);line-height:1.45;">' +
        'Source: <code>data/policy/soft-funding-status.json</code>' +
        (ctx.meta.lastUpdated ? ' · verified ' + esc(ctx.meta.lastUpdated) : '') +
        '. Entries without verified dollars render as name/status/link only.' +
      '</p>';
    return ctx;
  }

  global.FundingContextCard = {
    buildContext: buildContext,
    render: render,
    _test: {
      matchesUseCase: matchesUseCase,
      programSummary: programSummary
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.FundingContextCard;
  }
})(typeof window !== 'undefined' ? window : globalThis);
