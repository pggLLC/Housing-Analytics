/**
 * js/deal-comparison.js
 * Phase 3: Two-deal comparison workspace
 *
 * Captures deal calculator snapshots as Scenario A/B, renders a
 * side-by-side comparison panel, and cross-references the deal's
 * AMI mix against community need data from HNARanking (if available).
 *
 * Depends on: js/site-state.js (optional, for persistence)
 *             js/workflow-state.js (optional, for jurisdiction context)
 */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────
  var _dealA = null;   // deal snapshot { name, creditType, tdc, units, ... outputs }
  var _dealB = null;
  var _communityNeed = null; // { geoid, name, metrics } from ranking data

  // ── Persistence ────────────────────────────────────────────────────

  function _persist() {
    try {
      if (window.SiteState) {
        SiteState.set('dealScenarioA', _dealA, true);
        SiteState.set('dealScenarioB', _dealB, true);
      }
    } catch (_) {}
  }

  function _restore() {
    try {
      if (window.SiteState) {
        _dealA = SiteState.get('dealScenarioA') || null;
        _dealB = SiteState.get('dealScenarioB') || null;
      }
    } catch (_) {}
  }

  // ── Formatting helpers ─────────────────────────────────────────────

  function _parseCurrency(s) {
    if (typeof s === 'number') return s;
    if (!s) return null;
    var n = parseFloat(String(s).replace(/[$,%\s]/g, ''));
    return isNaN(n) ? null : n;
  }

  function _fmtDollars(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return '$' + (+n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function _fmtPct(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return (+n).toFixed(1) + '%';
  }

  function _fmtInt(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Math.round(+n).toLocaleString('en-US');
  }

  // ── Setup bar rendering ────────────────────────────────────────────

  function _renderSetupBar() {
    var mount = document.getElementById('dcComparisonBar');
    if (!mount) return;

    var slotA = _dealA
      ? '<span class="dc-comp-slot__label">A:</span> <strong class="dc-comp-slot__name">' + (_dealA.name || _dealA.creditType + ' deal') + '</strong>' +
        '<button type="button" class="dc-comp-slot__clear" data-clear="A" title="Clear A">✕</button>'
      : '<span class="dc-comp-slot__empty">A: click "Save as A" above</span>';

    var slotB = _dealB
      ? '<span class="dc-comp-slot__label">B:</span> <strong class="dc-comp-slot__name">' + (_dealB.name || _dealB.creditType + ' deal') + '</strong>' +
        '<button type="button" class="dc-comp-slot__clear" data-clear="B" title="Clear B">✕</button>'
      : '<span class="dc-comp-slot__empty">B: click "Save as B" above</span>';

    mount.innerHTML =
      '<div class="dc-comp-bar">' +
        '<h3 class="dc-comp-bar__title">Deal Scenario Comparison</h3>' +
        '<div class="dc-comp-bar__slots">' +
          '<div class="dc-comp-slot" id="dcSlotA">' + slotA + '</div>' +
          '<span class="dc-comp-vs">vs</span>' +
          '<div class="dc-comp-slot" id="dcSlotB">' + slotB + '</div>' +
        '</div>' +
        '<div class="dc-comp-bar__actions">' +
          '<button type="button" class="dc-comp-action" id="dcSwapBtn" title="Swap A and B"' +
            (!_dealA || !_dealB ? ' disabled' : '') + '>Swap</button>' +
          '<button type="button" class="dc-comp-action dc-comp-action--reset" id="dcResetBtn" title="Clear both"' +
            (!_dealA && !_dealB ? ' disabled' : '') + '>Reset</button>' +
        '</div>' +
      '</div>';

    // Wire events
    var swapBtn = document.getElementById('dcSwapBtn');
    if (swapBtn) {
      swapBtn.addEventListener('click', function () {
        var tmp = _dealA; _dealA = _dealB; _dealB = tmp;
        _persist(); _renderSetupBar(); _renderPanel();
      });
    }
    var resetBtn = document.getElementById('dcResetBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        _dealA = null; _dealB = null;
        _persist(); _renderSetupBar(); _renderPanel();
      });
    }
  }

  // ── Comparison panel ───────────────────────────────────────────────

  var DEAL_METRICS = [
    { key: 'creditType',  label: 'Credit Type',       fmt: function (v) { return v || '—'; } },
    { key: 'tdc',         label: 'Total Dev. Cost',    fmt: function (v) { return _fmtDollars(_parseCurrency(v)); } },
    { key: 'units',       label: 'Total Units',        fmt: function (v) { return _fmtInt(v); } },
    { key: 'basisPct',    label: 'Eligible Basis %',   fmt: function (v) { return _fmtPct(v); } },
    { key: 'equityPrice', label: 'Equity Price ($/cr)',fmt: function (v) { return v ? '$' + (+v).toFixed(2) : '—'; } },
    { key: 'noi',         label: 'Net Operating Income',fmt: function (v) { return _fmtDollars(_parseCurrency(v)); } },
    { key: 'dcr',         label: 'Debt Coverage Ratio', fmt: function (v) { return v ? (+v).toFixed(2) + 'x' : '—'; } },
    { key: 'interestRate',label: 'Interest Rate',       fmt: function (v) { return _fmtPct(v); } },
    { key: 'loanTerm',    label: 'Loan Term',           fmt: function (v) { return v ? v + ' yr' : '—'; } },
  ];

  var DEAL_OUTPUT_METRICS = [
    { key: 'eligibleBasis',  label: 'Eligible Basis',      fmt: function (v) { return _fmtDollars(_parseCurrency(v)); } },
    { key: 'annualCredits',  label: 'Annual Tax Credits',   fmt: function (v) { return _fmtDollars(_parseCurrency(v)); } },
    { key: 'creditEquity',   label: 'Tax Credit Equity',    fmt: function (v) { return _fmtDollars(_parseCurrency(v)); } },
    { key: 'annualRents',    label: 'Annual Gross Rents',   fmt: function (v) { return _fmtDollars(_parseCurrency(v)); } },
    { key: 'firstMortgage',  label: 'Supportable Mortgage', fmt: function (v) { return _fmtDollars(_parseCurrency(v)); } },
    { key: 'gap',            label: 'Funding Gap',          fmt: function (v) { return _fmtDollars(_parseCurrency(v)); },
      lowerBetter: true },
  ];

  function _renderPanel() {
    var panel = document.getElementById('dcComparisonPanel');
    if (!panel) return;

    if (!_dealA || !_dealB) {
      panel.style.display = 'none';
      return;
    }

    var html = '<div class="dc-cp-header">' +
      '<h3 class="dc-cp-title">Side-by-Side Deal Comparison</h3>' +
      '<button type="button" class="dc-cp-close" id="dcCpClose" title="Close">✕</button>' +
    '</div>';

    // Names
    var nameA = _dealA.name || (_dealA.creditType + ' Scenario');
    var nameB = _dealB.name || (_dealB.creditType + ' Scenario');
    html += '<div class="dc-cp-names">' +
      '<div class="dc-cp-names__label"></div>' +
      '<div class="dc-cp-names__a">' + nameA + '</div>' +
      '<div class="dc-cp-names__vs">vs</div>' +
      '<div class="dc-cp-names__b">' + nameB + '</div>' +
    '</div>';

    // Input assumptions
    html += '<div class="dc-cp-section-title">Deal Assumptions</div>';
    html += '<div class="dc-cp-metrics">';
    DEAL_METRICS.forEach(function (m) {
      var vA = _dealA[m.key];
      var vB = _dealB[m.key];
      html += '<div class="dc-cp-row">' +
        '<div class="dc-cp-row__label">' + m.label + '</div>' +
        '<div class="dc-cp-row__val"><span class="dc-cp-row__num">' + m.fmt(vA) + '</span></div>' +
        '<div class="dc-cp-row__delta"></div>' +
        '<div class="dc-cp-row__val"><span class="dc-cp-row__num">' + m.fmt(vB) + '</span></div>' +
      '</div>';
    });
    html += '</div>';

    // AMI unit mix comparison
    html += _buildUnitMixComparison(_dealA, _dealB);

    // Outputs
    html += '<div class="dc-cp-section-title" style="margin-top:16px;">Pro Forma Outputs</div>';
    html += '<div class="dc-cp-metrics">';
    DEAL_OUTPUT_METRICS.forEach(function (m) {
      var vA = _dealA.outputs ? _dealA.outputs[m.key] : null;
      var vB = _dealB.outputs ? _dealB.outputs[m.key] : null;
      var numA = _parseCurrency(vA);
      var numB = _parseCurrency(vB);

      var deltaHtml = '';
      if (numA !== null && numB !== null && Math.abs(numA - numB) > 0.5) {
        var diff = numA - numB;
        var arrow = diff > 0 ? '▲' : '▼';
        var better = m.lowerBetter ? (numA < numB) : (numA > numB);
        var cls = better ? 'dc-cp-row__delta--better' : 'dc-cp-row__delta--worse';
        deltaHtml = '<span class="' + cls + '">' + arrow + ' ' + _fmtDollars(Math.abs(diff)) + '</span>';
      } else if (numA !== null && numB !== null) {
        deltaHtml = '=';
      }

      // Bar widths
      var maxVal = Math.max(Math.abs(numA || 0), Math.abs(numB || 0));
      var pctA = maxVal > 0 && numA !== null ? (Math.abs(numA) / maxVal * 100) : 0;
      var pctB = maxVal > 0 && numB !== null ? (Math.abs(numB) / maxVal * 100) : 0;

      html += '<div class="dc-cp-row">' +
        '<div class="dc-cp-row__label">' + m.label + '</div>' +
        '<div class="dc-cp-row__val">' +
          '<span class="dc-cp-row__num">' + m.fmt(vA) + '</span>' +
          '<div class="dc-cp-row__bar-wrap"><div class="dc-cp-row__bar dc-cp-row__bar--a" style="width:' + pctA.toFixed(1) + '%"></div></div>' +
        '</div>' +
        '<div class="dc-cp-row__delta">' + deltaHtml + '</div>' +
        '<div class="dc-cp-row__val">' +
          '<span class="dc-cp-row__num">' + m.fmt(vB) + '</span>' +
          '<div class="dc-cp-row__bar-wrap"><div class="dc-cp-row__bar dc-cp-row__bar--b" style="width:' + pctB.toFixed(1) + '%"></div></div>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';

    // Need alignment section (if community data available)
    html += _buildNeedAlignment(_dealA, _dealB);

    panel.innerHTML = html;
    panel.style.display = 'block';

    var closeBtn = document.getElementById('dcCpClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () { panel.style.display = 'none'; });
    }
  }

  // ── Unit mix comparison ────────────────────────────────────────────

  function _buildUnitMixComparison(dealA, dealB) {
    if (!dealA.unitMix && !dealB.unitMix) return '';

    var tiers = [30, 40, 50, 60];
    var html = '<div class="dc-cp-section-title" style="margin-top:16px;">AMI Unit Mix</div>';
    html += '<div class="dc-cp-metrics">';

    tiers.forEach(function (pct) {
      var mixA = dealA.unitMix ? dealA.unitMix[pct] : null;
      var mixB = dealB.unitMix ? dealB.unitMix[pct] : null;
      var unitsA = mixA && mixA.enabled ? (mixA.units || 0) : 0;
      var unitsB = mixB && mixB.enabled ? (mixB.units || 0) : 0;
      var enabledA = mixA ? mixA.enabled : false;
      var enabledB = mixB ? mixB.enabled : false;
      var maxU = Math.max(+unitsA || 0, +unitsB || 0, 1);

      html += '<div class="dc-cp-row">' +
        '<div class="dc-cp-row__label">' + pct + '% AMI</div>' +
        '<div class="dc-cp-row__val">' +
          '<span class="dc-cp-row__num">' + (enabledA ? _fmtInt(unitsA) + ' units' : 'Off') + '</span>' +
          '<div class="dc-cp-row__bar-wrap"><div class="dc-cp-row__bar dc-cp-row__bar--a" style="width:' + ((+unitsA || 0) / maxU * 100).toFixed(1) + '%"></div></div>' +
        '</div>' +
        '<div class="dc-cp-row__delta"></div>' +
        '<div class="dc-cp-row__val">' +
          '<span class="dc-cp-row__num">' + (enabledB ? _fmtInt(unitsB) + ' units' : 'Off') + '</span>' +
          '<div class="dc-cp-row__bar-wrap"><div class="dc-cp-row__bar dc-cp-row__bar--b" style="width:' + ((+unitsB || 0) / maxU * 100).toFixed(1) + '%"></div></div>' +
        '</div>' +
      '</div>';
    });

    html += '</div>';
    return html;
  }

  // ── Need alignment ─────────────────────────────────────────────────
  // Compares the deal's AMI mix against community AMI gaps from HNA data

  function _loadCommunityNeed() {
    _communityNeed = null;
    try {
      // Try to get active jurisdiction from WorkflowState
      var proj = window.WorkflowState && WorkflowState.getActiveProject();
      var fips = null;
      if (proj && proj.jurisdiction && proj.jurisdiction.countyFips) {
        fips = proj.jurisdiction.countyFips;
      }
      if (!fips && window.SiteState) {
        var sc = SiteState.getCounty();
        if (sc && sc.fips) fips = sc.fips;
      }
      if (!fips) return;

      // Try to get ranking data from HNARanking (if loaded)
      if (window.HNARanking) {
        var state = HNARanking._get();
        if (state && state.allEntries) {
          for (var i = 0; i < state.allEntries.length; i++) {
            if (state.allEntries[i].geoid === fips) {
              _communityNeed = {
                geoid: fips,
                name: state.allEntries[i].name,
                metrics: state.allEntries[i].metrics
              };
              break;
            }
          }
        }
      }
    } catch (_) {}
  }

  function _buildNeedAlignment(dealA, dealB) {
    if (!_communityNeed) return '';
    var m = _communityNeed.metrics;
    if (!m.ami_gap_30pct) return '';

    var html = '<div class="dc-cp-need-align">';
    html += '<div class="dc-cp-section-title">Need Alignment: ' + _communityNeed.name + '</div>';
    html += '<p class="dc-cp-need-desc">How each deal\'s unit mix addresses the community\'s identified housing gaps.</p>';

    var tiers = [
      { pct: 30, gap: m.ami_gap_30pct || 0, label: '≤30% AMI' },
      { pct: 50, gap: Math.max((m.ami_gap_50pct || 0) - (m.ami_gap_30pct || 0), 0), label: '31–50% AMI' },
      { pct: 60, gap: Math.max((m.ami_gap_60pct || 0) - (m.ami_gap_50pct || 0), 0), label: '51–60% AMI' },
    ];

    // Map deal tiers to community gap tiers
    // 30% AMI deal tier → ≤30% AMI community gap
    // 40% + 50% deal tiers → 31-50% AMI community gap
    // 60% deal tier → 51-60% AMI community gap
    function getDealUnits(deal, amiPcts) {
      var total = 0;
      if (!deal || !deal.unitMix) return 0;
      amiPcts.forEach(function (p) {
        var mix = deal.unitMix[p];
        if (mix && mix.enabled) total += (+mix.units || 0);
      });
      return total;
    }

    var alignRows = [
      { label: '≤30% AMI', gap: tiers[0].gap, unitsA: getDealUnits(dealA, [30]), unitsB: getDealUnits(dealB, [30]) },
      { label: '31–50% AMI', gap: tiers[1].gap, unitsA: getDealUnits(dealA, [40, 50]), unitsB: getDealUnits(dealB, [40, 50]) },
      { label: '51–60% AMI', gap: tiers[2].gap, unitsA: getDealUnits(dealA, [60]), unitsB: getDealUnits(dealB, [60]) },
    ];

    html += '<div class="dc-cp-metrics">';
    alignRows.forEach(function (row) {
      var pctA = row.gap > 0 ? (row.unitsA / row.gap * 100) : 0;
      var pctB = row.gap > 0 ? (row.unitsB / row.gap * 100) : 0;

      html += '<div class="dc-cp-row">' +
        '<div class="dc-cp-row__label">' + row.label +
          '<div style="font-size:.72rem;color:var(--muted);font-weight:400">Gap: ' + _fmtInt(row.gap) + ' units</div>' +
        '</div>' +
        '<div class="dc-cp-row__val">' +
          '<span class="dc-cp-row__num">' + _fmtInt(row.unitsA) + ' <small style="color:var(--muted);font-weight:400">(' + pctA.toFixed(1) + '% of gap)</small></span>' +
          '<div class="dc-cp-row__bar-wrap"><div class="dc-cp-row__bar dc-cp-row__bar--a" style="width:' + Math.min(pctA, 100).toFixed(1) + '%"></div></div>' +
        '</div>' +
        '<div class="dc-cp-row__delta"></div>' +
        '<div class="dc-cp-row__val">' +
          '<span class="dc-cp-row__num">' + _fmtInt(row.unitsB) + ' <small style="color:var(--muted);font-weight:400">(' + pctB.toFixed(1) + '% of gap)</small></span>' +
          '<div class="dc-cp-row__bar-wrap"><div class="dc-cp-row__bar dc-cp-row__bar--b" style="width:' + Math.min(pctB, 100).toFixed(1) + '%"></div></div>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
    html += '</div>';
    return html;
  }

  // ── Slot clear handler ─────────────────────────────────────────────

  function _handleSlotClear(e) {
    var btn = e.target.closest('.dc-comp-slot__clear');
    if (!btn) return;
    var which = btn.dataset.clear;
    if (which === 'A') _dealA = null;
    if (which === 'B') _dealB = null;
    _persist(); _renderSetupBar(); _renderPanel();
  }

  // ── Public API ─────────────────────────────────────────────────────

  function _captureAndSave(slot) {
    // Capture current deal state from the calculator
    if (typeof window.readDealState !== 'function' && typeof window._dcReadDealState !== 'function') {
      console.warn('[DealComparison] readDealState not available');
      return false;
    }
    var reader = window._dcReadDealState || window.readDealState;
    var snapshot = reader();
    if (!snapshot) return false;

    // Prompt for scenario name
    var defaultName = snapshot.creditType === '9%' ? '9% Scenario' : '4% Scenario';
    var name = prompt('Name this scenario:', slot === 'A'
      ? (_dealA ? _dealA.name : defaultName)
      : (_dealB ? _dealB.name : defaultName));
    if (name === null) return false; // cancelled
    snapshot.name = name || defaultName;

    if (slot === 'A') _dealA = snapshot;
    else _dealB = snapshot;

    _persist();
    _renderSetupBar();
    _renderPanel();
    return true;
  }

  function init() {
    _restore();
    _loadCommunityNeed();
    _renderSetupBar();
    _renderPanel();

    // Delegated click handler
    document.addEventListener('click', function (e) {
      _handleSlotClear(e);

      // "Save as A" / "Save as B" buttons
      var saveA = e.target.closest('#dcSaveAsA');
      if (saveA) { _captureAndSave('A'); return; }
      var saveB = e.target.closest('#dcSaveAsB');
      if (saveB) { _captureAndSave('B'); return; }
    });
  }

  window.DealComparison = {
    init: init,
    saveA: function () { return _captureAndSave('A'); },
    saveB: function () { return _captureAndSave('B'); },
    getState: function () { return { a: _dealA, b: _dealB }; },
    reset: function () { _dealA = null; _dealB = null; _persist(); _renderSetupBar(); _renderPanel(); },
  };

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 200); });
  } else {
    setTimeout(init, 200);
  }

})();
