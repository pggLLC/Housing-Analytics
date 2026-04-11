/**
 * js/components/data-quality-summary.js
 * Page-level data quality disclosure panel.
 *
 * Renders a collapsible summary showing:
 *  - Which data sources power this page
 *  - Whether each source is primary, cached, or fallback
 *  - Data freshness (age from last update)
 *  - Geographic extent / coverage
 *  - Known limitations
 *
 * Usage (declarative):
 *   <div id="dataQualitySummary"
 *        data-dqs-sources='[
 *          {"name":"ACS 5-Year","status":"primary","vintage":"2024","coverage":"All CO tracts"},
 *          {"name":"HUD CHAS","status":"degraded","vintage":"2017-2021","note":"51/64 counties have clamped values"}
 *        ]'
 *        data-dqs-limitations="Circular buffer PMA, not a professional market delineation. Statewide AMI used for rent pressure.">
 *   </div>
 *
 * Or imperative:
 *   DataQualitySummary.render('dataQualitySummary', {
 *     sources: [...],
 *     limitations: '...',
 *     lastUpdated: '2026-03-27'
 *   });
 *
 * Exposes window.DataQualitySummary.
 */
(function () {
  'use strict';

  /* ── Status definitions ─────────────────────────────────────────── */
  var STATUS = {
    primary:     { label: 'Primary',     icon: '●', cls: 'dqs-ok' },
    cached:      { label: 'Cached',      icon: '●', cls: 'dqs-ok' },
    degraded:    { label: 'Degraded',    icon: '▲', cls: 'dqs-warn' },
    fallback:    { label: 'Fallback',    icon: '◆', cls: 'dqs-warn' },
    unavailable: { label: 'Unavailable', icon: '✕', cls: 'dqs-error' },
    stub:        { label: 'Stub Data',   icon: '◇', cls: 'dqs-warn' }
  };

  /* ── HTML escaping helper ───────────────────────────────────────── */
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ── Freshness helper ───────────────────────────────────────────── */
  function ageBadge(vintage) {
    if (!vintage) return '';
    // If it looks like a year (e.g. "2024")
    var yr = parseInt(vintage, 10);
    if (yr > 2000 && yr < 2100) {
      var age = new Date().getFullYear() - yr;
      if (age <= 1) return '<span class="dqs-fresh">Current</span>';
      if (age <= 2) return '<span class="dqs-recent">' + age + 'yr old</span>';
      return '<span class="dqs-stale">' + age + 'yr old</span>';
    }
    return '<span class="dqs-recent">' + esc(vintage) + '</span>';
  }

  /* ── Render ─────────────────────────────────────────────────────── */
  function render(containerId, opts) {
    var el = document.getElementById(containerId);
    if (!el) return;

    var sources = opts.sources || [];
    var limitations = opts.limitations || '';
    var lastUpdated = opts.lastUpdated || '';

    if (!sources.length && !limitations) return;

    // Count statuses
    var counts = { ok: 0, warn: 0, error: 0 };
    sources.forEach(function (s) {
      var st = STATUS[s.status] || STATUS.primary;
      if (st.cls === 'dqs-ok') counts.ok++;
      else if (st.cls === 'dqs-warn') counts.warn++;
      else counts.error++;
    });

    var overallCls = counts.error > 0 ? 'dqs-error'
      : counts.warn > 0 ? 'dqs-warn' : 'dqs-ok';
    var overallLabel = counts.error > 0 ? 'Some data unavailable'
      : counts.warn > 0 ? 'Some data degraded or using fallbacks'
      : 'All data sources current';

    // Source rows
    var rows = sources.map(function (s) {
      var st = STATUS[s.status] || STATUS.primary;
      var note = s.note ? '<span class="dqs-note">' + esc(s.note) + '</span>' : '';
      var cov = s.coverage ? '<span class="dqs-coverage">' + esc(s.coverage) + '</span>' : '';
      return '<tr class="' + st.cls + '">' +
        '<td><span class="dqs-icon">' + st.icon + '</span> ' + esc(s.name || '—') + '</td>' +
        '<td>' + st.label + '</td>' +
        '<td>' + ageBadge(s.vintage) + '</td>' +
        '<td>' + cov + '</td>' +
        '<td>' + note + '</td>' +
        '</tr>';
    }).join('');

    var limHtml = limitations
      ? '<div class="dqs-limitations"><strong>Known limitations:</strong> ' + esc(limitations) + '</div>'
      : '';

    var updatedHtml = lastUpdated
      ? '<span class="dqs-updated">Page data as of ' + esc(lastUpdated) + '</span>'
      : '';

    el.innerHTML =
      '<details class="dqs-panel">' +
        '<summary class="dqs-summary ' + overallCls + '">' +
          '<span class="dqs-status-dot ' + overallCls + '"></span> ' +
          'Data Quality: ' + overallLabel +
          ' <span class="dqs-source-count">(' + sources.length + ' source' + (sources.length === 1 ? '' : 's') + ')</span>' +
          updatedHtml +
        '</summary>' +
        '<div class="dqs-body">' +
          '<table class="dqs-table">' +
            '<thead><tr>' +
              '<th>Source</th><th>Status</th><th>Vintage</th><th>Coverage</th><th>Notes</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
          limHtml +
        '</div>' +
      '</details>';
  }

  /* ── Auto-scan for declarative usage ────────────────────────────── */
  function scan() {
    var els = document.querySelectorAll('[data-dqs-sources]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      try {
        var sources = JSON.parse(el.getAttribute('data-dqs-sources'));
        var limitations = el.getAttribute('data-dqs-limitations') || '';
        render(el.id, { sources: sources, limitations: limitations });
      } catch (e) {
        console.warn('[DataQualitySummary] Failed to parse sources:', e);
      }
    }
  }

  function init() {
    scan();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.DataQualitySummary = { render: render, scan: scan, STATUS: STATUS };
})();
