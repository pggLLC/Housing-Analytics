/**
 * js/components/map-layer-status.js
 * Shows the integration depth of each data layer on the PMA page.
 *
 * Each data connector on the market-analysis page can participate at
 * up to three levels:
 *   1. Map — visible as a toggleable map layer
 *   2. Report — data appears in a report section
 *   3. Scoring — data feeds into the site-selection score
 *
 * This component renders a compact legend showing which level each
 * source reaches, so users understand what's informing the analysis
 * vs. what's display-only vs. what's unavailable.
 *
 * Usage:
 *   MapLayerStatus.render('mapLayerStatusPanel', [
 *     { name: 'LIHTC Projects', map: true, report: true, scoring: true },
 *     { name: 'NHPD Properties', map: false, report: false, scoring: false },
 *   ]);
 *
 * Exposes window.MapLayerStatus.
 */
(function () {
  'use strict';

  var SCOPE_LABELS = {
    full:    'Map + Report + Scoring',
    report:  'Report + Scoring',
    map:     'Map only',
    off:     'Not loaded'
  };

  function getScope(layer) {
    if (layer.scoring) return 'full';
    if (layer.report) return 'report';
    if (layer.map) return 'map';
    return 'off';
  }

  function render(containerId, layers) {
    var el = document.getElementById(containerId);
    if (!el || !layers || !layers.length) return;

    var rows = layers.map(function (l) {
      var scope = getScope(l);
      var dotCls = scope === 'full' ? 'mls-dot--full'
        : scope === 'report' ? 'mls-dot--partial'
        : scope === 'map' ? 'mls-dot--map'
        : 'mls-dot--off';
      var note = l.note ? ' <span class="dqs-note">' + l.note + '</span>' : '';
      return '<div class="mls-row">' +
        '<span class="mls-dot ' + dotCls + '"></span>' +
        '<span class="mls-label">' + l.name + note + '</span>' +
        '<span class="mls-scope">' + SCOPE_LABELS[scope] + '</span>' +
        '</div>';
    }).join('');

    el.innerHTML =
      '<div class="mls-panel">' +
        '<div style="font-weight:600;margin-bottom:.3rem;font-size:.78rem;">Data Layer Integration</div>' +
        rows +
        '<div style="margin-top:.4rem;font-size:.68rem;color:var(--faint);">' +
          '● Map + Report + Scoring &nbsp; ▲ Report + Scoring &nbsp; ◆ Map only &nbsp; ○ Not loaded' +
        '</div>' +
      '</div>';
  }

  /**
   * Build the PMA layer status from the current connector state.
   * Reads window globals to determine what's actually loaded.
   */
  function buildPMALayers() {
    return [
      { name: 'Census ACS (tracts)',      map: false, report: true,  scoring: true },
      { name: 'LIHTC Projects (CHFA)',    map: true,  report: true,  scoring: true },
      { name: 'QCT Overlay (HUD)',        map: true,  report: true,  scoring: true },
      { name: 'DDA Overlay (HUD)',        map: true,  report: true,  scoring: true },
      { name: 'HUD FMR / Income Limits',  map: false, report: true,  scoring: true },
      { name: 'FEMA Flood Zones',         map: true,  report: true,  scoring: true },
      { name: 'EPA EJI / Cleanup',        map: false, report: true,  scoring: true },
      { name: 'OSM Amenities',            map: false, report: true,  scoring: true },
      { name: 'EPA Walkability',          map: false, report: true,  scoring: true },
      { name: 'LEHD LODES Commuting',     map: false, report: false, scoring: true,  note: 'workforce sub-score' },
      { name: 'CDLE Job Vacancies',       map: false, report: false, scoring: true,  note: 'workforce sub-score' },
      { name: 'CDE School Quality',       map: false, report: false, scoring: true,  note: 'workforce sub-score' },
      { name: 'CDOT Traffic',             map: false, report: false, scoring: true,  note: 'workforce sub-score' },
      { name: 'NHPD Preservation',        map: false, report: false, scoring: false, note: 'loaded but not integrated' },
    ];
  }

  window.MapLayerStatus = { render: render, buildPMALayers: buildPMALayers, SCOPE_LABELS: SCOPE_LABELS };
})();
