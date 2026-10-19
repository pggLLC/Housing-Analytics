/**
 * deal-diagrams.js — two drawn diagrams on the Deal Calculator's Deal step.
 *
 * Capital stack bar: total development cost as one bar, split into the
 * sources the Sources & Uses table counts (first mortgage, federal, state and
 * added credit equity, soft funding, deferred developer fee) and the gap left
 * over, drawn as a hole. A figure the deal calculation could not work out is
 * shown as unavailable with its reason, never as $0.
 *
 * Waterfall ladder: the Capital Event Waterfall's tiers as steps. Each step
 * starts where the one above it ended, so the bar shows how far down the
 * ladder the sale proceeds reach.
 *
 * Both read the deal-engine result that js/deal-calculator.js publishes on
 * every recalculation ('deal-calc:updated'); neither changes a figure.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DealDiagrams = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function known(v) { return typeof v === 'number' && isFinite(v); }
  function money(v) {
    if (!known(v)) return 'Unavailable';
    var a = Math.abs(v), s = a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? Math.round(a / 1e3) + 'K' : Math.round(a) + '';
    return (v < 0 ? '-$' : '$') + s;
  }
  function pct(v) { return (Math.round(v * 1000) / 10) + '%'; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  // ── Capital stack ─────────────────────────────────────────────────────
  // Same pieces, in the same order a lender reads a stack: the senior loan
  // first, then the equity, the soft money, the developer's own fee, the gap.
  function stackModel(result) {
    if (!result) return { unavailable: 'The deal calculation is unavailable.' };
    var tdc = result.tdc;
    if (!known(tdc) || tdc <= 0) return { unavailable: 'Total development cost is missing.' };
    var un = result.unavailable || {};
    var cs = result.creditStack || { federal: result.equity, state: result.stateEquity, added: 0 };
    var reasonOf = function (path) { return un[path] || result.noiUnknownReason || result.rentsUnknownReason || 'Not available for these inputs.'; };
    var parts = [
      { key: 'mortgage', label: 'First mortgage', amount: result.mortgage, cls: 'dg-seg--cs1', reason: reasonOf('mortgage') },
      { key: 'federal', label: 'Federal credit equity', amount: cs.federal, cls: 'dg-seg--cs3', reason: result.basisUnknownReason || reasonOf('equity') },
      { key: 'state', label: 'State credit equity', amount: cs.state, cls: 'dg-seg--cs2', reason: reasonOf('stateEquity'), optional: true },
      // An added credit that is chosen but not counted is unknown, never $0.
      { key: 'added', label: (cs.label || 'Added credit') + ' equity', amount: cs.counted ? cs.added : cs.label ? NaN : 0, cls: 'dg-seg--cs4', reason: cs.reason || 'Its equity cannot be worked out yet.', optional: true },
      { key: 'soft', label: 'Soft funding', amount: result.totalSoftSourceAmt, cls: 'dg-seg--cs5', reason: reasonOf('totalSoftSourceAmt'), optional: true },
      { key: 'deferred', label: 'Deferred developer fee', amount: result.deferredDevFee, cls: 'dg-seg--cs6', reason: reasonOf('deferredDevFee'), optional: true }
    ];
    var gap = result.gap;
    var shown = [], missing = [], covered = 0;
    parts.forEach(function (p) {
      if (!known(p.amount)) { missing.push({ label: p.label, reason: p.reason }); return; }
      if (p.optional && p.amount === 0) return;
      covered += Math.max(0, p.amount);
      shown.push(p);
    });
    if (!known(gap)) missing.push({ label: 'Gap', reason: reasonOf('gap') });
    var gapAmount = known(gap) && gap > 0 ? gap : 0;
    var surplus = known(gap) && gap < 0 ? -gap : 0;
    // The bar's length is the larger of the cost and what the sources add up
    // to, so a surplus shows as sources running past the cost line.
    var scale = Math.max(tdc, covered + gapAmount);
    var segs = shown.map(function (p) { return { label: p.label, amount: p.amount, cls: p.cls, width: Math.max(0, p.amount) / scale }; });
    if (gapAmount > 0) segs.push({ label: 'Gap still to fill', amount: gapAmount, cls: 'dg-seg--gap', width: gapAmount / scale, gap: true });
    var unknownRest = missing.length ? Math.max(0, tdc - covered - gapAmount) : 0;
    if (unknownRest > 0) segs.push({ label: 'Not yet known', amount: unknownRest, cls: 'dg-seg--unknown', width: unknownRest / scale, unknown: true });
    return { tdc: tdc, scale: scale, costLine: tdc / scale, segments: segs, missing: missing, gap: known(gap) ? gap : null, surplus: surplus };
  }

  function stackVerdict(m) {
    if (m.unavailable) return 'Capital stack unavailable: ' + m.unavailable;
    return m.gap === null ? 'The gap cannot be worked out yet.'
      : m.gap > 0 ? 'The sources leave a gap of ' + money(m.gap) + ', ' + pct(m.gap / m.tdc) + ' of the cost.'
      : m.surplus > 0 ? 'The sources run ' + money(m.surplus) + ' past the cost, so there is no gap.'
      : 'The sources cover the cost exactly.';
  }

  function renderStack(m) {
    if (m.unavailable) return '<p class="diagram__title">Capital stack</p><p data-dg="unavailable">Unavailable: ' + esc(m.unavailable) + '</p>';
    var bar = m.segments.map(function (s) {
      return '<span class="dg-seg ' + s.cls + '" style="width:' + (s.width * 100).toFixed(2) + '%" title="' + esc(s.label + ': ' + money(s.amount)) + '"></span>';
    }).join('');
    var costLine = m.costLine < 0.9995 ? '<span class="dg-costline" style="left:' + (m.costLine * 100).toFixed(2) + '%" aria-hidden="true"></span>' : '';
    var key = m.segments.map(function (s) {
      return '<li><i class="' + (s.gap ? 'dg-gap-key' : s.unknown ? 'dg-unknown-key' : s.cls) + '"></i>' + esc(s.label) + ' <strong>' + money(s.amount) + '</strong> (' + pct(s.amount / m.tdc) + ')</li>';
    }).join('');
    var missing = m.missing.map(function (x) { return '<li data-dg="missing">' + esc(x.label) + ': unavailable. ' + esc(x.reason || '') + '</li>'; }).join('');
    var verdict = stackVerdict(m);
    return '<p class="diagram__title">Capital stack</p>' +
      '<div class="dg-stack">' +
        '<p class="dg-stack__label"><span>Total development cost</span><strong>' + money(m.tdc) + '</strong></p>' +
        '<div class="dg-stack__bar" aria-hidden="true">' + bar + costLine + '</div>' +
        '<ul class="dg-stack__key">' + key + '</ul>' +
        (missing ? '<ul class="dg-stack__missing">' + missing + '</ul>' : '') +
      '</div>' +
      '<p class="dg-verdict" data-dg="verdict">' + esc(verdict) + '</p>';
  }

  // ── Waterfall ladder ──────────────────────────────────────────────────
  var PARTY_CLASS = { 'Lender': 'dg-seg--cs1', 'Soft lenders': 'dg-seg--cs5', 'Asset manager': 'dg-seg--cs7',
    'Sponsor (GP)': 'dg-seg--cs6', 'Developer (GP)': 'dg-seg--cs6', 'GP sponsor': 'dg-seg--cs6', 'LP investor': 'dg-seg--cs3' };

  function ladderModel(wf) {
    if (!wf || !known(wf.grossProceeds)) return null;
    var gross = wf.grossProceeds, start = 0, reached = null, splitStart = null;
    var steps = wf.tiers.map(function (t, i) {
      var amt = known(t.amount) ? Math.max(0, t.amount) : 0;
      // A tier paid nothing either had nothing owed or came after the money ran out.
      // The residual split steps (6a GP, 6b LP) are shares of one balance paid at the
      // same time, not one after the other, so they sit side by side in one band.
      var split = /Residual split/i.test(t.name);
      if (split && splitStart === null) splitStart = start;
      var s = { name: t.name, recipient: t.recipient, amount: amt, cls: PARTY_CLASS[t.recipient] || 'dg-seg--cs7', split: split,
        empty: amt > 0 ? null : gross - (split && splitStart !== null ? splitStart : start) > 0.5 ? 'None owed' : 'Nothing left',
        left: gross > 0 ? start / gross : 0, width: gross > 0 ? amt / gross : 0 };
      start += amt;
      if (amt > 0) reached = i;
      return s;
    });
    var last = reached === null ? null : steps[reached].name;
    return { gross: gross, steps: steps, lastPaid: last, lastSplit: reached !== null && steps[reached].split };
  }

  function renderLadder(m) {
    var rows = m.steps.map(function (s) {
      var paid = s.amount > 0;
      return '<li class="dg-ladder__step"' + (paid ? '' : ' data-empty="true"') + '>' +
        '<span class="dg-ladder__name">' + esc(s.name) + '<span class="dg-ladder__who">' + esc(s.recipient) + (s.split ? ', a share of the residual paid at the same time as the other share' : '') + '</span></span>' +
        '<span class="dg-ladder__track" aria-hidden="true"><span class="dg-ladder__bar ' + s.cls + '" style="left:' + (s.left * 100).toFixed(2) + '%;width:' + (s.width * 100).toFixed(2) + '%"></span></span>' +
        '<span class="dg-ladder__amt">' + (paid ? money(s.amount) : s.empty) + '</span>' +
      '</li>';
    }).join('');
    return '<p class="diagram__title">Where the sale money goes, step by step</p>' +
      '<p class="dg-ladder__gross">Sale proceeds: <strong>' + money(m.gross) + '</strong></p>' +
      '<ol class="dg-ladder">' + rows + '</ol>';
  }

  // One spoken line for both diagrams, read out politely when it changes.
  function summary(sm, lm) {
    var parts = [stackVerdict(sm)];
    if (lm) parts.push(lm.lastPaid ? 'Sale proceeds of ' + money(lm.gross) + ' reach the ' + (lm.lastSplit ? 'residual split' : lm.lastPaid) + ' step.' : 'The sale proceeds pay no waterfall step.');
    return parts.join(' ');
  }

  function mount(doc) {
    function refresh(result) {
      var su = doc.getElementById('dc-su-table');
      var fs = su && su.closest('fieldset');
      var sm = stackModel(result);
      var lm = ladderModel(result && result.waterfall);
      if (fs) {
        var fig = doc.getElementById('dcCapitalStackDiagram');
        if (!fig) {
          fig = doc.createElement('figure');
          fig.className = 'diagram dg-capstack';
          fig.id = 'dcCapitalStackDiagram';
          fs.parentNode.insertBefore(fig, fs);
        }
        var live = doc.getElementById('dcDealDiagramsStatus');
        if (!live) {
          live = doc.createElement('p');
          live.id = 'dcDealDiagramsStatus';
          live.className = 'sr-only no-glossary';
          live.setAttribute('role', 'status');
          live.setAttribute('aria-live', 'polite');
          live.setAttribute('aria-atomic', 'true');
          fig.parentNode.insertBefore(live, fig);
        }
        var said = summary(sm, lm);
        if (live.textContent !== said) live.textContent = said;
        fig.innerHTML = renderStack(sm) +
          '<figcaption>Each piece is a figure from the Sources &amp; Uses table below, drawn to scale against the total development cost. ' +
          'A hatched piece is the gap the listed sources do not cover.</figcaption>';
      }
      var table = doc.getElementById('dcWaterfallTable');
      if (table) {
        var lad = doc.getElementById('dcWaterfallLadder');
        if (!lad) {
          lad = doc.createElement('figure');
          lad.className = 'diagram dg-ladderfig';
          lad.id = 'dcWaterfallLadder';
          table.parentNode.insertBefore(lad, table);
        }
        lad.hidden = !lm;
        if (lm) lad.innerHTML = renderLadder(lm) +
          '<figcaption>Each step is paid in full before the next gets anything, so each bar starts where the one above it ended. ' +
          'The two residual split steps are the exception: they divide what is left at the same time, side by side. ' +
          'The amounts are the tiers in the table below.</figcaption>';
      }
    }
    doc.addEventListener('deal-calc:updated', function (e) { refresh(e.detail && e.detail.result); });
  }

  if (typeof document !== 'undefined') mount(document);

  return { stackModel: stackModel, renderStack: renderStack, summary: summary, ladderModel: ladderModel, renderLadder: renderLadder, money: money };
}));
