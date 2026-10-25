/**
 * deal-diagrams.js — drawn diagrams on the Deal Calculator's Deal step.
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
 * Partnership structure: who puts money into the partnership (investor,
 * sponsor, lenders), who owns it, what is paid each year and at the exit, and
 * what each side gets back, with the deal terms that drive it listed beside.
 *
 * All read the deal-engine result that js/deal-calculator.js publishes on
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

  // ── Partnership structure and deal terms ─────────────────────────────
  // Who puts money in, who owns the partnership, and who is paid each year
  // and at the exit, from the same result the split below uses.
  function pctTerm(v, digits) { return known(v) ? +(v * 100).toFixed(digits == null ? 1 : digits) + '%' : 'Unavailable'; }
  function structureModel(result) {
    if (!result) return null;
    var wf = result.waterfall, t = result.partnershipTerms || {}, un = result.unavailable || {};
    var exit = result.exit || {};
    var lpEquity = wf ? wf.lpEquity : (known(t.lpEquityOverride) && t.lpEquityOverride > 0 ? t.lpEquityOverride : NaN);
    return {
      units: result.units, tdc: result.tdc, lpEquity: lpEquity, autoLp: !(t.lpEquityOverride > 0),
      annualCredits: result.annualCredits, fee: result.deferredDevFee, mortgage: result.mortgage,
      softLoans: result.totalLoanPrincipal, grants: result.totalGrant,
      lpShare: t.lpOpsShare, terms: t, wf: wf, hold: exit.holdYears, cap: exit.exitCap,
      reason: wf ? null : (un.waterfall || 'The partnership split is unavailable for these inputs.')
    };
  }
  function box(cls, who, lines) {
    return '<div class="dg-ps__box ' + cls + '"><p class="dg-ps__who">' + esc(who) + '</p><ul>' +
      lines.filter(Boolean).map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul></div>';
  }
  function renderStructure(m) {
    var t = m.terms, wf = m.wf, buyout = t.exit === 'buyout';
    var lenders = ['First mortgage <strong>' + money(m.mortgage) + '</strong>'];
    if (known(m.softLoans) && m.softLoans > 0) lenders.push('Soft loans <strong>' + money(m.softLoans) + '</strong>');
    if (known(m.grants) && m.grants > 0) lenders.push('Grants <strong>' + money(m.grants) + '</strong>');
    lenders.push('Paid first, every year and at the exit');
    var top = '<div class="dg-ps__row">' +
      box('dg-ps__box--lp', 'Tax credit investor (limited partner)', [
        'Pays <strong>' + money(m.lpEquity) + '</strong> for the credits' + (m.autoLp ? '' : ' (entered)'),
        known(m.annualCredits) ? 'Receives the federal credits: <strong>' + money(m.annualCredits) + '</strong> a year for 10 years' : null,
        'Owns <strong>' + pctTerm(m.lpShare, 2) + '</strong>']) +
      box('dg-ps__box--gp', 'Sponsor (general partner)', [
        'Leaves <strong>' + money(m.fee) + '</strong> of its fee in the deal',
        'Owns <strong>' + pctTerm(known(m.lpShare) ? 1 - m.lpShare : NaN, 2) + '</strong>, builds and manages',
        'Guarantees completion and operations (not modeled)']) +
      box('dg-ps__box--lender', 'Lenders', lenders) +
      '</div>';
    var core = '<div class="dg-ps__arrow" aria-hidden="true">&#8595;</div>' +
      '<div class="dg-ps__core"><strong>The partnership owns the property</strong>' +
      (known(m.units) ? ' · ' + m.units + ' homes' : '') + (known(m.tdc) ? ' · total cost ' + money(m.tdc) : '') + '</div>' +
      '<div class="dg-ps__arrow" aria-hidden="true">&#8595;</div>';
    var yearly = box('dg-ps__box--year', 'Every year', [
      '1. Loan payments',
      '2. Cash left repays the sponsor’s deferred fee',
      '3. Anything after that: <strong>' + pctTerm(m.lpShare, 2) + '</strong> investor, <strong>' + pctTerm(known(m.lpShare) ? 1 - m.lpShare : NaN, 2) + '</strong> sponsor']);
    var exitLines;
    if (!wf) exitLines = ['Unavailable: ' + esc(m.reason)];
    else {
      var pick = function (re) { var x = wf.tiers.filter(function (tr) { return re.test(tr.name); }); return x.reduce(function (a, tr) { return a + (known(tr.amount) ? tr.amount : 0); }, 0); };
      exitLines = [
        (buyout ? 'Property value ' : 'Sale price ') + '<strong>' + money(wf.grossProceeds) + '</strong>' + (known(m.hold) ? ' in year ' + m.hold : ''),
        'Loans repaid: <strong>' + money(pick(/debt payoff/i)) + '</strong>',
        'Rest of the deferred fee: <strong>' + money(pick(/Deferred developer fee/i)) + '</strong>',
        buyout ? 'Investor sells its interest for <strong>' + money(wf.lpTotal) + '</strong>' : 'Investor: <strong>' + money(wf.lpTotal) + '</strong> (its capital back first, then its preferred return and ' + pctTerm(1 - wf.gpResidualPct, 0) + ' of what is left)',
        buyout ? (pick(/buyout shortfall/i) < 0 ? 'Sponsor pays <strong>' + money(-pick(/buyout shortfall/i)) + '</strong> of its own, because the price is more than the value left' : 'Sponsor keeps the property, worth <strong>' + money(pick(/Value the sponsor keeps/i)) + '</strong> after the above') : 'Sponsor: <strong>' + money(pick(/catch-up|Residual split — GP/i)) + '</strong> more (' + pctTerm(wf.gpResidualPct, 0) + ' of what is left)'];
    }
    var exitBox = box('dg-ps__box--exit', buyout ? 'At the exit: sponsor buys the investor out' : t.exit === 'sale' ? 'At the exit: sale, split by the waterfall' : 'At the exit: unavailable', exitLines);
    var res = !wf ? null : box('dg-ps__box--result', 'What each side gets back', [
      'Sponsor: <strong>' + money(wf.sponsorCash) + '</strong> on its <strong>' + money(wf.sponsorIn) + '</strong> deferred fee = <strong>' + (known(wf.sponsorIrr) ? pctTerm(wf.sponsorIrr) : 'unavailable') + '</strong> a year',
      'Investor: <strong>' + money(wf.lpTotal) + '</strong> of cash at the exit, plus the credits and tax losses, which are its main return']);
    return '<p class="diagram__title">Partnership structure</p><div class="dg-ps">' + top + core +
      '<div class="dg-ps__row">' + yearly + exitBox + (res || '') + '</div></div>';
  }
  function termRow(term, value, note, unused) {
    return '<tr' + (unused ? ' data-unused="true"' : '') + '><th scope="row">' + esc(term) + '</th><td>' + value + '</td><td>' + esc(unused ? 'Not used: ' + unused : note) + '</td></tr>';
  }
  function renderTerms(m) {
    // A choice the engine rejected (null) reads unavailable, never as a default.
    var t = m.terms, buyout = t.exit === 'buyout', sale = t.exit === 'sale', saleOnly = buyout ? 'the investor is bought out, so this sale term does not apply.' : null;
    var rows = [
      termRow('Investor equity', money(m.lpEquity), m.autoLp ? 'Automatic: what the investor pays for the credits. Enter an amount below to change it.' : 'Entered below.'),
      termRow('Ownership and yearly cash split', pctTerm(t.lpOpsShare, 2) + ' investor / ' + pctTerm(known(t.lpOpsShare) ? 1 - t.lpOpsShare : NaN, 2) + ' sponsor', 'Applies to cash left after loan payments and the deferred fee. Set below.'),
      termRow('Deferred developer fee', money(m.fee), 'Repaid from yearly cash before any split; the sale pays what is left. Set by the fee and gap in the sources above.'),
      termRow('Hold period', known(m.hold) ? m.hold + ' years' : 'Unavailable', 'Set in the exit panel.'),
      termRow('Exit cap rate', known(m.cap) ? pctTerm(m.cap, 2) : 'Unavailable', 'Set in the exit panel. Price = sale-year NOI ÷ cap.'),
      termRow('How the investor exits', buyout ? 'Sponsor buys the investor out' : sale ? 'Sale, split by the waterfall' : 'Unavailable', 'Set below.'),
      termRow('Buyout price', buyout ? money(t.buyoutPrice) : sale ? '—' : 'Unavailable', 'Paid to the investor for its interest. Set below.', sale ? 'the property is sold, not bought out.' : null),
      termRow('Investor preferred return', pctTerm(t.prefRate), 'Accrues each year on the investor’s equity and is paid from the sale. Set below.', saleOnly),
      termRow('Sponsor catch-up', t.catchup === 'full' ? 'Full catch-up' : t.catchup === 'none' ? 'None' : 'Unavailable', 'Set below.', saleOnly),
      termRow('Residual split', pctTerm(t.gpResidualPct, 0) + ' sponsor / ' + pctTerm(known(t.gpResidualPct) ? 1 - t.gpResidualPct : NaN, 0) + ' investor', 'What is left of the sale after the steps above. Set below.', saleOnly)
    ].join('');
    return '<p class="diagram__title">Deal terms used</p>' +
      '<div class="dg-terms__scroll"><table data-no-sort class="dg-terms__table"><thead><tr><th scope="col">Term</th><th scope="col">Value</th><th scope="col">Where it comes from</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (m.reason ? '<p data-dg="unavailable">Split unavailable: ' + esc(m.reason) + '</p>' : '');
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
      var ps = doc.getElementById('dcPartnershipStructure'), terms = doc.getElementById('dcDealTerms');
      var pm = structureModel(result);
      if (ps) ps.innerHTML = pm ? renderStructure(pm) + '<figcaption id="dcPartnershipStructureCaption">Every figure is from this deal\'s calculation and the deal terms listed below. ' +
        'It shows cash only: the investor\'s main return, the tax credits and losses, is listed but not priced.</figcaption>' : '<p data-dg="unavailable">Unavailable: the deal calculation is unavailable.</p>';
      if (terms) terms.innerHTML = pm ? renderTerms(pm) : '';
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

  return { stackModel: stackModel, renderStack: renderStack, summary: summary, ladderModel: ladderModel, renderLadder: renderLadder,
    structureModel: structureModel, renderStructure: renderStructure, renderTerms: renderTerms, money: money };
}));
