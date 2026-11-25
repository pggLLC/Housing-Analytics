// The deal workspace pilot (layout proposal revision 3, approved by paul 20 Nov 2026): chapter 3, Costs, with the
// chapter menu and the result rail, at #/financials/<project>/<scenario>/costs. It is a second layout of the same
// Financials page, not a second calculator: site/financials.js builds the draft, the engine inputs and the engine
// run exactly as for the full page, then hands them here. Every figure shown is the engine's own result
// (DealEngine.computeDeal) or an input as entered; a field changed here is saved to the same scenario draft by
// financials.js's own change handler, because the form keeps data-action="financials".
// The other five chapters open their sections on the full Financials page until each is built.
(function (global) {
  'use strict';

  var Shell = global.LabShell;
  var esc = Shell.esc;
  var F = function () { return global.LabFinancials; };
  var CB = function () { return global.DealCostBasis; };

  var CHAPTERS = [
    { n: 1, id: 'project', title: 'Project and place', short: 'Project' },
    { n: 2, id: 'homes', title: 'Homes and income', short: 'Homes' },
    { n: 3, id: 'costs', title: 'Costs', short: 'Costs' },
    { n: 4, id: 'operations', title: 'Operations', short: 'Operations' },
    { n: 5, id: 'funding', title: 'Funding and loans', short: 'Funding' },
    { n: 6, id: 'results', title: 'Results and review', short: 'Results' }
  ];
  var BUILT = { project: true, homes: true, costs: true, operations: true, funding: true, results: true };
  // Four statuses, each a word and an icon; colour only repeats them.
  var STATE = {
    ready: { icon: '✓', word: 'Ready' },
    example: { icon: '◐', word: 'Uses an example' },
    answer: { icon: '!', word: 'Needs an answer' },
    none: { icon: '○', word: 'Not started' }
  };
  // Soft-funding programs that are public money (loans and grants from a government or a public agency). A sponsor
  // or seller loan, the cash value of other tax credits and "Other / custom" are left out.
  var PUBLIC_PROGRAMS = { prop123: 1, local_pha: 1, chfa_cmf: 1, chfa_htf: 1, dola_htf: 1, home: 1, cdbg: 1, nhtf: 1, impact_fee_loan: 1 };

  function money(n) { return F().money(n); }
  // Charts and the rail's small figures: $M from a million, $k below (revision 3, change 19).
  function short$(n) {
    if (n == null || !isFinite(n)) return '—';
    var a = Math.abs(n), sign = n < 0 ? '−' : '';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2).replace(/0$/, '') + 'M';
    if (a >= 1e3) return sign + '$' + Math.round(a / 1e3) + 'k';
    return sign + '$' + Math.round(a);
  }
  function num(v) { return v === '' || v == null || !isFinite(Number(v)) ? null : Number(v); }
  function base(p, s) { return '#/financials/' + encodeURIComponent(p.projectId) + '/' + encodeURIComponent(s.scenarioId); }

  // ---------- the checks behind each chapter's status ----------
  function landCheck(c) {
    var d = c.d, tdc = num(d.fields['dc-tdc']), land = num((d.costs || {}).land);
    if (land == null || tdc == null || tdc <= 0 || land < tdc) return null;
    var others = F().costIds().filter(function (id) { return id !== 'land'; }).reduce(function (t, id) { var v = num(d.costs[id]); return t + (v != null && v > 0 ? v : 0); }, 0);
    var left = tdc - others;
    return 'Land (' + money(land) + ') must be less than the total (' + money(tdc) + '). ' +
      (others > 0 ? 'The other lines add to ' + money(others) + ', which ' + (left > 0 ? 'leaves ' + money(left) + ' for land.' : 'already uses the whole total.') : 'No other line is entered yet.') +
      ' Results wait until this is fixed; nothing is replaced for you.';
  }
  function costsStatus(c) {
    var d = c.d, tdc = num(d.fields['dc-tdc']);
    var entered = F().costIds().filter(function (id) { return num(d.costs[id]) != null; });
    var sum = c.r.costBasis && c.r.costBasis.summary;
    var land = landCheck(c);
    if ((tdc == null || tdc <= 0) && !entered.length) return { state: 'none', text: 'Not started', items: [{ state: 'none', text: 'Costs: no total or cost line entered yet' }] };
    if (land) return { state: 'answer', text: 'Needs an answer: land', items: [{ state: 'answer', text: 'Land is not less than the total' }], blocker: land };
    if (tdc == null || tdc <= 0) return { state: 'answer', text: 'Needs an answer: total', items: [{ state: 'answer', text: 'Enter the total development cost' }] };
    if (sum && sum.reason) return { state: 'answer', text: 'Needs an answer: cost lines', items: [{ state: 'answer', text: sum.reason.replace(/\.$/, '') }] };
    // The engine prices the developer fee only once the whole cost is itemized (DealCostBasis.feeBase).
    if (sum && sum.notItemized > 0) return { state: 'answer', text: 'Needs an answer: ' + short$(sum.notItemized) + ' to place', items: [{ state: 'answer', text: money(sum.notItemized) + ' of the total is not on a line yet' }] };
    return { state: 'ready', text: 'Ready: ' + entered.length + ' lines, ' + short$(tdc), items: [] };
  }
  function statuses(c) {
    var p = c.p, r = c.r, d = c.d, out = {};
    var place = p.jurisdiction && p.jurisdiction.geoid;
    out.project = place ? { state: 'ready', text: 'Ready: ' + (p.jurisdiction.name || 'place set'), items: [] }
      : { state: 'answer', text: 'Needs an answer: place', items: [{ state: 'answer', text: 'Choose the project’s place' }] };
    var stale = c.sched && c.sched.state === 'stale';
    out.homes = stale ? { state: 'answer', text: 'Needs an answer: rents out of date', items: [{ state: 'answer', text: 'The rent schedule is out of date' }] }
      : r.units > 0 && r.annualRents != null ? { state: 'ready', text: 'Ready: ' + r.units + ' homes', items: [] }
      : { state: 'answer', text: 'Needs an answer: homes and rents', items: [{ state: 'answer', text: 'Enter the homes and their rents' }] };
    out.costs = costsStatus(c);
    var OB = global.DealOperatingBudget;
    var op = OB ? OB.summarizeOperating(c.inputs.operatingLines, c.inputs.otherIncomeLines) : { reason: null };
    out.operations = d.fields['dc-auto-noi'] === 'no' ? { state: 'ready', text: 'Ready: income entered as one figure', items: [] }
      : d.opExample ? { state: 'example', text: 'Uses the example budget', items: [{ state: 'example', text: 'Running costs are the example budget' }] }
      : op.reason ? { state: 'answer', text: 'Needs an answer: budget', items: [{ state: 'answer', text: op.reason.replace(/\.$/, '') }] }
      : { state: 'ready', text: 'Ready: budget entered', items: [] };
    var rateDefault = F().INPUTS.filter(function (i) { return i.id === 'dc-rate'; })[0].value;
    var ex = [];
    if (String(d.fields['dc-rate']) === String(rateDefault)) ex.push({ state: 'example', text: 'Loan rate is the calculator’s ' + rateDefault + '%' });
    if (!d.fields['dc-equity-price']) ex.push({ state: 'example', text: 'Equity price is the published average' });
    out.funding = ex.length ? { state: 'example', text: 'Uses an example: ' + (ex.length > 1 ? 'rate and price' : /rate/.test(ex[0].text) ? 'loan rate' : 'equity price'), items: ex }
      : { state: 'ready', text: 'Ready: your terms', items: [] };
    var waits = CHAPTERS.slice(0, 5).filter(function (ch) { return out[ch.id].state === 'answer'; });
    out.results = waits.length ? { state: 'none', text: 'Waits on chapter ' + waits.map(function (ch) { return ch.n; }).join(' and '), items: [] }
      : r.gap != null ? { state: 'ready', text: 'Ready: gap ' + short$(Math.max(0, r.gap)), items: [] }
      : { state: 'answer', text: 'Needs an answer: results unavailable', items: [{ state: 'answer', text: F().unavailable(r, 'gap').replace(/\.$/, '') }] };
    return out;
  }
  function chapterHref(c, ch) {
    var b = base(c.p, c.s);
    if (BUILT[ch.id]) return b + '/' + ch.id;
    return b;
  }
  function badge(st, text) {
    return '<span class="fc-st fc-st-' + st + '"><span class="fc-ic" aria-hidden="true">' + STATE[st].icon + '</span><span class="fc-sw">' + esc(text) + '</span></span>';
  }

  // ---------- chapter menu (desktop) and progress row (phone) ----------
  function menu(c, here, st) {
    var items = CHAPTERS.map(function (ch) {
      var cur = ch.id === here, x = st[ch.id];
      return '<li><a class="fc-ch' + (cur ? ' is-here' : '') + '" href="' + esc(chapterHref(c, ch)) + '"' + (cur ? ' aria-current="step"' : '') + '>' +
        '<span class="fc-n">' + ch.n + '</span><span class="fc-t">' + esc(ch.title) + (BUILT[ch.id] ? '' : ' <small>on the full page</small>') + '</span>' + badge(x.state, x.text) + '</a></li>';
    }).join('');
    return '<nav class="fc-menu" aria-label="Chapters"><h2 class="fc-menu-h">Chapters</h2><ol>' + items + '</ol></nav>';
  }
  function progress(c, here, st) {
    var ch = CHAPTERS.filter(function (x) { return x.id === here; })[0];
    return '<nav class="fc-prog" aria-label="Chapters"><p class="fc-prog-h">Chapter ' + ch.n + ' of 6: <strong>' + esc(ch.title) + '</strong>, ' + esc(STATE[st[here].state].word.toLowerCase()) + '</p><ol>' +
      CHAPTERS.map(function (x) {
        var cur = x.id === here, s1 = st[x.id];
        return '<li><a class="fc-step fc-st-' + s1.state + (cur ? ' is-here' : '') + '" href="' + esc(chapterHref(c, x)) + '"' + (cur ? ' aria-current="step"' : '') +
          ' aria-label="' + esc(x.n + ' ' + x.title + ': ' + s1.text + (cur ? ', you are here' : '')) + '"><span class="fc-n">' + x.n + '</span><span class="fc-ic" aria-hidden="true">' + STATE[s1.state].icon + '</span></a></li>';
      }).join('') + '</ol></nav>';
  }

  // ---------- the result rail ----------
  function gapBlock(c, st) {
    var r = c.r, land = st.costs.blocker;
    if (land) return '<div class="fc-gap fc-wait"><h2>Funding gap</h2><p class="fc-big">Waiting on land</p><p class="note">Fix the land line in chapter 3 to see the gap.</p></div>';
    if (r.gap == null) return '<div class="fc-gap fc-wait"><h2>Funding gap</h2><p class="fc-big">Not available yet</p><p class="note">' + esc(F().unavailable(r, 'gap')) + '</p></div>';
    var g = Math.max(0, r.gap);
    return '<div class="fc-gap"><h2>Funding gap: still to find</h2><p class="fc-big" data-role="fc-gap">' + esc(money(g)) + '</p>' +
      (r.gap < 0 ? '<p class="note">Modeled sources cover the cost, with ' + esc(money(-r.gap)) + ' to spare.</p>'
        : '<p class="note">' + (r.tdc > 0 ? esc(Math.round(g / r.tdc * 100) + '% of cost') : '') + (r.units > 0 ? ' · ' + esc(money(g / r.units)) + ' a home' : '') + '</p>') + '</div>';
  }
  // What pays for the cost: one bar per source on one scale (the total development cost), every paid source in one
  // colour and labelled, the gap hatched in ink. A source with no amount is listed as unknown and drawn as nothing.
  function paysChart(c, st) {
    var r = c.r, su = F().sourcesUsesRows(r);
    if (st.costs.blocker || !su || !(r.tdc > 0)) return '<section class="fc-pays" aria-labelledby="fc-pays-h"><h2 id="fc-pays-h">What pays for it</h2><p class="note">' +
      esc(st.costs.blocker ? 'Shown once the land line is fixed.' : F().unavailable(r, 'budget.groups')) + '</p></section>';
    var rows = su.sources.filter(function (x) { return x[3] && (x[1] == null || x[1] > 0); });
    var bars = rows.map(function (x) {
      var gap = x[3] === 'gap', w = x[1] == null ? 0 : Math.min(100, x[1] / r.tdc * 100);
      return '<li class="fc-bar' + (gap ? ' is-gap' : '') + '"><span class="fc-bl">' + esc(gap ? 'Funding gap' : x[0]) + '</span>' +
        '<span class="fc-bt">' + (x[1] == null ? '' : '<span class="fc-bf" style="width:' + w.toFixed(1) + '%"></span>') + '</span>' +
        '<span class="fc-bv">' + (x[1] == null ? 'Unknown' : esc(short$(x[1]) + ' · ' + Math.round(x[1] / r.tdc * 100) + '%')) + '</span></li>';
    }).join('');
    var table = '<details class="fc-tbl"><summary>Show as a table</summary><div class="table-scroll" role="region" aria-label="What pays for it, as a table" tabindex="0"><table data-sort-seen="1"><thead><tr><th scope="col">Source</th><th scope="col" class="num">Amount</th><th scope="col" class="num">Share of cost</th></tr></thead><tbody>' +
      rows.map(function (x) { return '<tr><th scope="row">' + esc(x[3] === 'gap' ? 'Funding gap' : x[0]) + '</th><td class="num">' + (x[1] == null ? 'Unknown: ' + esc(x[4] || F().unavailable(r, x[2])) : esc(money(x[1]))) + '</td><td class="num">' + (x[1] == null ? '—' : Math.round(x[1] / r.tdc * 100) + '%') + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><th scope="row">Total development cost</th><td class="num">' + esc(money(r.tdc)) + '</td><td class="num">100%</td></tr></tfoot></table></div></details>';
    return '<section class="fc-pays" aria-labelledby="fc-pays-h"><h2 id="fc-pays-h">What pays for the ' + esc(short$(r.tdc)) + ' cost?</h2>' +
      '<ul class="fc-bars" role="list">' + bars + '</ul>' + table + '<p class="note fc-src">From the Deal Engine’s sources and uses.</p></section>';
  }
  function railFigures(c) {
    var r = c.r, bands = F().homesByBand(c.inputs, c.G);
    var deep = Object.keys(bands).filter(function (t) { return Number(t) <= 30; }).reduce(function (t, k) { return t + bands[k]; }, 0);
    var pub = (r.trancheBreakdown || []).filter(function (t) { return PUBLIC_PROGRAMS[t.program] && t.amount > 0; });
    var pubSum = pub.reduce(function (t, x) { return t + x.amount; }, 0);
    var y1 = r.coverage && r.coverage.years && r.coverage.years[0];
    return '<section class="fc-fig" aria-labelledby="fc-fig-h"><h2 id="fc-fig-h">For the community and funders</h2><dl>' +
      '<div><dt>Homes at or below 30% AMI</dt><dd>' + (r.units > 0 ? esc(deep + ' of ' + r.units) : 'No homes yet') + '</dd></div>' +
      '<div><dt>Public funding per home<small>Public loans and grants ÷ ' + esc(String(r.units || 0)) + ' homes</small></dt><dd>' +
        (pub.length && r.units > 0 ? esc(money(pubSum / r.units)) : 'Not entered yet (chapter 5)') + '</dd></div>' +
      '<div><dt>Coverage, year 1<small>First mortgage</small></dt><dd>' + (y1 && y1.seniorCoverage != null ? esc(y1.seniorCoverage.toFixed(2) + 'x') : 'Not available yet') + '</dd></div>' +
      '</dl></section>';
  }
  function toCheck(c, st) {
    var items = [];
    CHAPTERS.forEach(function (ch) { (st[ch.id].items || []).forEach(function (it) { items.push({ ch: ch, it: it }); }); });
    var answers = items.filter(function (x) { return x.it.state === 'answer'; }).length, examples = items.filter(function (x) { return x.it.state === 'example'; }).length;
    var parts = [];
    if (answers) parts.push(answers + (answers === 1 ? ' needs an answer' : ' need an answer'));
    if (examples) parts.push(examples + (examples === 1 ? ' uses an example' : ' use an example'));
    var rest = items.length - answers - examples;
    if (rest) parts.push(rest + ' not started');
    return '<section class="fc-check" aria-labelledby="fc-check-h"><h2 id="fc-check-h">To check (' + items.length + ')' + (parts.length ? ': ' + esc(parts.join(', ')) : '') + '</h2>' +
      (items.length ? '<ul role="list">' + items.map(function (x) {
        return '<li><a href="' + esc(chapterHref(c, x.ch)) + '">' + badge(x.it.state, x.it.text) + '<span class="fc-chn">Chapter ' + x.ch.n + '</span></a></li>';
      }).join('') + '</ul>' : '<p class="note">Nothing to check: every chapter is ready.</p>') + '</section>';
  }
  function rail(c, st, here) {
    return '<aside class="fc-rail" id="fc-rail" aria-label="Result" tabindex="-1">' + gapBlock(c, st) + (here === 'results' ? '' : checkPanel(c, st, false) + paysChart(c, st)) + railFigures(c) + toCheck(c, st) + '</aside>';
  }
  function slim(c, st) {
    var r = c.r, n = 0;
    CHAPTERS.forEach(function (ch) { n += (st[ch.id].items || []).length; });
    var gap = st.costs.blocker ? 'waiting on land' : r.gap == null ? 'not available yet' : short$(Math.max(0, r.gap));
    return '<p class="fc-slim"><span>Funding gap: <strong>' + esc(gap) + '</strong></span><button type="button" class="fc-jump" data-fc-jump="fc-rail">' + n + ' to check ›</button></p>';
  }

  // ---------- chapter 3, Costs ----------
  function moneyBox(name, value, label, extra) {
    // Shown with commas (revision 2, change 4); the commas are taken out again before the draft reads the form.
    var n = num(value), shown = n == null ? (value == null ? '' : String(value)) : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return '<span class="fc-money"><span class="fc-cur" aria-hidden="true">$</span><input name="' + esc(name) + '" type="text" inputmode="decimal" autocomplete="off" data-fc-money value="' + esc(shown) + '" placeholder="not entered" aria-label="' + esc(label) + '"' + (extra || '') + '></span>';
  }
  function basisCell(l) {
    var fixed = CB().NEVER_IN_BASIS[l.id];
    if (fixed) return '<span class="fc-never" title="' + esc(fixed) + '">Never</span>';
    return '<select name="basis:' + esc(l.id) + '" aria-label="' + esc(l.label) + ': counts toward basis?">' +
      F().BASIS_CHOICES.map(function (b) { return '<option value="' + b[0] + '"' + (b[0] === l.basis ? ' selected' : '') + '>' + esc({ eligible: 'Yes', partial: 'Partly', ineligible: 'No' }[b[0]]) + '</option>'; }).join('') + '</select>';
  }
  function lineRow(c, l, error) {
    var d = c.d, v = (d.costs || {})[l.id];
    var extra = '';
    if (l.basis === 'partial') extra += '<label class="fc-extra">Part in basis ' + moneyBox('part:' + l.id, (d.parts || {})[l.id], l.label + ': part in basis ($)') + '</label>';
    if (CB().CONTINGENCY_KINDS[l.id]) extra += '<label class="fc-extra">Proposed use so far ' + moneyBox('used:' + l.id, (d.used || {})[l.id], l.label + ': proposed use so far ($)') + '</label>';
    var errId = error ? 'fc-err-' + l.id : '';
    return '<tr data-cost-line="' + esc(l.id) + '"' + (error ? ' class="is-error"' : '') + '><th scope="row">' + (error ? '<span class="fc-ic fc-st-answer" aria-hidden="true">!</span> ' : '') + esc(l.label) + '</th>' +
      '<td class="fc-amt">' + moneyBox('cost:' + l.id, v, l.label + ' ($)', error ? ' aria-invalid="true" aria-describedby="' + errId + '"' : '') + extra + '</td>' +
      '<td data-label="Counts toward basis">' + basisCell(l) + '</td><td class="fc-from">' + (num(v) != null ? 'Your entry' : '<span class="fc-blank">Not entered</span>') + '</td></tr>' +
      (error ? '<tr class="fc-errrow"><td colspan="4"><p class="fc-err" id="' + errId + '" role="alert"><span class="fc-ic" aria-hidden="true">!</span> ' + esc(error) + '</p></td></tr>' : '');
  }
  var HEAD = '<thead><tr><th scope="col">Line</th><th scope="col">Amount</th><th scope="col">Counts toward basis</th><th scope="col">Where from</th></tr></thead>';
  function costsChapter(c, st) {
    var d = c.d, inputs = c.inputs, r = c.r;
    var lines = inputs.costLines, byId = {};
    lines.forEach(function (l) { byId[l.id] = l; });
    var tdc = num(d.fields['dc-tdc']);
    var land = st.costs.blocker;
    var itemized = lines.reduce(function (t, l) { return t + (Number(l.amount) || 0); }, 0);
    var top = '<div class="table-scroll fc-ctable" role="region" aria-label="Total and land" tabindex="0"><table>' + HEAD + '<tbody>' +
      '<tr class="fc-total"><th scope="row">Total development cost</th><td class="fc-amt">' + moneyBox('dc-tdc', d.fields['dc-tdc'], 'Total development cost ($)') + '</td><td class="fc-nobasis">—</td><td class="fc-from">' + (tdc != null ? 'Your entry' : '<span class="fc-blank">Not entered</span>') + '</td></tr>' +
      (byId.land ? lineRow(c, byId.land, land) : '') + '</tbody></table></div>';
    var groups = CB().GROUPS.map(function (g) {
      var gl = lines.filter(function (l) { return l.group === g.id && l.id !== 'land'; });
      if (!gl.length) return '';
      var ent = gl.filter(function (l) { return l.amount != null; });
      var sub = ent.reduce(function (t, l) { return t + (Number(l.amount) || 0); }, 0);
      return '<details class="fc-group" id="fc-group-' + esc(g.id) + '"' + (ent.length ? ' open' : '') + '><summary><span>' + esc(g.label) + '</span><span class="sub">' +
        esc(gl.length + (gl.length === 1 ? ' line' : ' lines') + (ent.length ? ', ' + ent.length + ' entered, ' + money(sub) : '')) + '</span></summary>' +
        '<div class="table-scroll fc-ctable" role="region" aria-label="' + esc(g.label) + ' costs" tabindex="0"><table>' + HEAD + '<tbody>' + gl.map(function (l) { return lineRow(c, l, null); }).join('') + '</tbody></table></div></details>';
    }).join('');
    var left = tdc != null && tdc > 0 ? tdc - itemized : null;
    var addsUp = '<p class="fc-adds" role="status"><span>Lines add to <strong>' + esc(money(itemized)) + '</strong></span><span>' +
      (left == null ? 'Enter the total above.' : Math.abs(left) < 1 ? 'Matches the total.' : left > 0 ? esc(money(left)) + ' still to place.' : '<strong class="fc-over">' + esc(money(-left)) + ' over the total</strong>' + (land ? ', because of the land line.' : '.')) + '</span></p>';
    var sum = r.costBasis && r.costBasis.summary;
    var sources = '<details class="fc-more"><summary>Sources</summary><ul class="note">' +
      '<li>Line names and the nine groups: the Colorado Division of Housing’s development budget, as on the full Deal Calculator.</li>' +
      '<li>Land and reserves never count toward basis: eligible basis is the building’s adjusted basis (<a href="https://www.law.cornell.edu/uscode/text/26/42">26 U.S.C. 42(d)(1) ↗</a>); reserves are cash held for operations.</li>' +
      '<li>Fee and cost limits: CHFA’s Qualified Allocation Plan, read by the Deal Engine from ' + esc((global.LAB_PIN ? 'Housing-Analytics ' + global.LAB_PIN + ', ' : '') + 'data/policy/lihtc-underwriting-rules.json') + '.</li></ul></details>';
    return '<section class="fc-chapter" aria-labelledby="fc-h"><h2 id="fc-h"><span class="fc-n">3</span> Costs</h2>' +
      '<p class="fc-q">What will it cost to deliver? Enter the total, then the lines; the lines must fit inside the total. A blank line carries no cost.</p>' +
      top + groups + addsUp +
      (sum && sum.reason && !land ? '<p class="callout" data-role="fc-engine-reason"><strong>From the engine:</strong> ' + esc(sum.reason) + '</p>' : '') +
      '<div class="actions"><button type="button" class="button-link secondary" data-action="use-cost-total">Make the total match the lines</button>' +
      '<button type="button" class="button-link secondary" data-action="clear-costs">Clear the cost lines</button></div>' +
      '<details class="fc-more"><summary>Building type and CHFA’s cost limits</summary>' + c.fieldGrid(d, 'costs') + '</details>' +
      '<details class="fc-more"><summary>Developer fee, building purchase and federal grants</summary><p class="note">These answers set CHFA’s fee limits and what a building purchase and a federal grant do to basis.</p>' + c.fieldGrid(d, 'devfee') + '</details>' +
      '<details class="fc-more"><summary>Eligible basis and the 30% boost</summary>' + (c.basisSection(r, inputs.fields) || '<p class="note">' + esc((sum && sum.reason) || 'Not available for these inputs.') + '</p>') +
        '<p class="note">The boost itself is chosen in <a href="' + esc(chapterHref(c, CHAPTERS[0])) + '">chapter 1</a>.</p></details>' +
      '<details class="fc-more"><summary>Land value and negotiation</summary><p class="note">The land value tool estimates a site’s value and a negotiation range from nearby sales and what the deal can carry. <a href="#/opportunity/land-value">Open the land value tool</a>.</p></details>' +
      sources + '</section>';
  }
  // ---------- chapter 4, Operations ----------
  // The full page's operating budget, word for word and box for box (financials.js operatingBudget), with its money
  // boxes shown with commas like every other money box in the workspace.
  function commaBoxes(html) {
    return html.replace(/<input name="(op|opinc):([a-z0-9_]+)" type="number" min="0" step="10" inputmode="numeric" value="([^"]*)"/g, function (m, kind, id, v) {
      var n = num(v);
      return '<input name="' + kind + ':' + id + '" type="text" inputmode="decimal" autocomplete="off" data-fc-money value="' + (n == null ? v : n.toLocaleString('en-US', { maximumFractionDigits: 2 })) + '"';
    });
  }
  function operationsChapter(c, st) {
    var d = c.d, r = c.r, inputs = c.inputs;
    var pct = function (v) { return v == null || !isFinite(v) ? null : F().pct(v); };
    var homesHref = chapterHref(c, CHAPTERS[1]);
    var facts = '<dl class="fc-facts">' +
      '<div><dt>Homes</dt><dd>' + esc(r.units > 0 ? String(r.units) : 'None yet') + '</dd></div>' +
      '<div><dt>Scheduled rent</dt><dd>' + esc(r.annualRents != null ? money(r.annualRents) + ' a year' : 'Not available yet') + '</dd></div>' +
      '<div><dt>Vacancy</dt><dd>' + esc(pct(r.vacancyRate) || 'Not set') + ' <small>set with the homes, <a href="' + esc(homesHref) + '">chapter 2</a></small></dd></div>' +
      '<div><dt>Net operating income</dt><dd data-role="fc-noi">' + esc(r.noi != null ? money(r.noi) + ' a year' : 'Not available yet') + '</dd></div></dl>' +
      (r.noi == null ? '<p class="note">' + esc(F().unavailable(r, 'noi')) + '</p>' : '');
    var dohHtml = global.LabCalcDoh && global.LabCalcDoh.fifteen ? global.LabCalcDoh.fifteen(r, inputs.fields) : '';
    return '<section class="fc-chapter" aria-labelledby="fc-h"><h2 id="fc-h"><span class="fc-n">4</span> Operations</h2>' +
      '<p class="fc-q">What will it cost to run, and what does it earn? The budget is per home per year; a blank line is nothing budgeted on it.</p>' +
      facts + '<div class="fc-budget">' + commaBoxes(F().operatingBudget(d, inputs, r)) + '</div>' +
      '<h3>Property tax and replacement reserve</h3><p class="note">Counted in the Division of Housing\u2019s \u201cOther expenses\u201d group above.</p>' +
      F().fieldGridIds(d, ['dc-rep-reserve', 'dc-prop-tax', 'dc-tax-exempt']) +
      '<details class="fc-more"><summary>Operating projection, year by year</summary>' + F().projectionTable(r) + '</details>' +
      (dohHtml ? '<details class="fc-more"><summary>15-year operating pro forma, DOH layout</summary>' + dohHtml + '</details>' : '') +
      '</section>';
  }

  // ---------- chapter 5, Funding and loans ----------
  // The full page's credit, loan and exit inputs, box for box (financials.js creditInputs, loanStackInputs and the
  // first mortgage's terms), with the engine's four funding figures on top. Adding or removing a source uses the full
  // page's own buttons and handler.
  function fundingChapter(c, st) {
    var d = c.d, r = c.r;
    var fig = function (v, path) { return v != null ? esc(money(v)) : 'Not available yet'; };
    var facts = '<dl class="fc-facts">' +
      '<div><dt>Tax-credit equity</dt><dd data-role="fc-equity">' + fig(r.equity) + '</dd></div>' +
      '<div><dt>First mortgage</dt><dd data-role="fc-mortgage">' + fig(r.mortgage) + '</dd></div>' +
      '<div><dt>Soft loans and grants</dt><dd>' + fig(r.totalSoftSourceAmt) + '</dd></div>' +
      '<div><dt>Deferred developer fee</dt><dd>' + fig(r.deferredDevFee) + '</dd></div></dl>' +
      (r.mortgage == null ? '<p class="note">First mortgage: ' + esc(F().unavailable(r, 'mortgage')) + '</p>' : '') +
      (r.equity == null ? '<p class="note">Equity: ' + esc(F().unavailable(r, 'equity')) + '</p>' : '');
    var ls = global.LabLenderSchedules ? global.LabLenderSchedules.render(d, r, c.fieldGrid) : '';
    return '<section class="fc-chapter" aria-labelledby="fc-h"><h2 id="fc-h"><span class="fc-n">5</span> Funding and loans</h2>' +
      '<p class="fc-q">What pays for it? Credit pricing, the first mortgage\u2019s terms, soft sources and the deferred fee. A blank equity price uses the published average.</p>' +
      facts +
      '<h2>Credit price and the deferred fee</h2>' + F().fieldGridIds(d, ['dc-equity-price', 'dc-deferred-pct', 'dc-deferred-auto-balance', 'dc-deferred-repay-cap']) +
      '<h2>First mortgage terms</h2>' + F().fieldGridIds(d, ['dc-dcr', 'dc-rate', 'dc-perm-spread', 'dc-term']) +
      F().loanStackInputs(d).replace('<p class="note">The rate, amortization and coverage are under Assumptions.</p>', '<p class="note">The rate, amortization and coverage are under First mortgage terms above.</p>') +
      F().creditInputs(d) +
      '<h2>Exit and projection</h2>' + c.fieldGrid(d, 'exit') +
      (ls ? '<details class="fc-more"><summary>Lender schedules: construction to year 30</summary>' + ls + '</details>' : '') +
      '<details class="fc-more"><summary>Funding programs for this county</summary><p class="note">The programs that fund homes in this county, their terms and their sources are listed on <a href="' + esc(base(c.p, c.s)) + '?step=fin-funding">the full Financials page</a>.</p></details>' +
      '</section>';
  }

  // ---------- chapter 1, Project and place ----------
  // The place and the program choices the rest of the deal depends on: credit type, the federal set-aside election and
  // the 30% basis boost, box for box with their notes; the property tax programs on record for the place; and the
  // concept recommendation the full page draws for the county.
  function projectChapter(c, st) {
    var d = c.d, r = c.r, p = c.p, s = c.s, inputs = c.inputs;
    var j = p.jurisdiction || {};
    var tag = F().boostTag(r, inputs.fields);
    var tax = global.LabCalcTax && global.LabCalcTax.callout ? global.LabCalcTax.callout(p, d) : '';
    var site = global.LabCalcSite;
    return '<section class="fc-chapter" aria-labelledby="fc-h"><h2 id="fc-h"><span class="fc-n">1</span> Project and place</h2>' +
      '<p class="fc-q">Where is it, and under which program? These choices set the rent limits, which homes earn credit and the basis boost.</p>' +
      '<dl class="fc-facts">' +
        '<div><dt>Project</dt><dd>' + esc(p.name) + '<small>Scenario: ' + esc(s.name) + '</small></dd></div>' +
        '<div><dt>Place</dt><dd>' + esc(j.name || 'Not chosen') + '<small><a href="#/project/' + esc(p.projectId) + '">Change it on the project page</a></small></dd></div></dl>' +
      '<h2>Program</h2>' + F().fieldGridIds(d, ['dc-credit', 'dc-minimum-set-aside']) + F().setAsideStatus(r) +
      '<h2>30% basis boost</h2>' + F().fieldGridIds(d, ['dc-boost-designation', 'dc-boost-evidence', 'dc-boost-pct']) +
      '<p class="boost-tag boost-' + esc(tag.kind) + '" data-role="boost-tag">' + esc(tag.text) + '</p>' +
      (tax ? '<details class="fc-more"><summary>Property tax programs on record for this place</summary>' + tax + '<p class="note">The exemption itself is entered in <a href="' + esc(chapterHref(c, CHAPTERS[3])) + '">chapter 4</a>.</p></details>' : '') +
      (site && site.concept ? site.concept(d, inputs, r) : '') +
      '</section>';
  }

  // ---------- chapter 2, Homes and income ----------
  // The homes and rents as the full page takes them: the unit grid for a scenario typed there, otherwise the saved rent
  // schedule (changed in Homes and affordability) under fixed CHFA limits; then rent caps and building areas, all box
  // for box. The priced rents, the capture check and the two rent sections are context, in folds.
  function homesChapter(c, st) {
    var d = c.d, r = c.r, inputs = c.inputs, p = c.p, s = c.s, G = c.G;
    var bands = F().homesByBand(inputs, G);
    var deep = Object.keys(bands).filter(function (t) { return Number(t) <= 30; }).reduce(function (t, k) { return t + bands[k]; }, 0);
    var homesPage = '#/homes/' + encodeURIComponent(p.projectId) + '/' + encodeURIComponent(s.scenarioId);
    var facts = '<dl class="fc-facts">' +
      '<div><dt>Homes</dt><dd>' + esc(r.units > 0 ? String(r.units) : 'None yet') + '</dd></div>' +
      '<div><dt>At or below 30% AMI</dt><dd>' + esc(r.units > 0 ? deep + ' of ' + r.units : '\u2014') + '</dd></div>' +
      '<div><dt>Scheduled rent</dt><dd>' + esc(r.annualRents != null ? money(r.annualRents) + ' a year' : 'Not available yet') + '</dd></div>' +
      '<div><dt>Vacancy</dt><dd>' + esc(r.vacancyRate != null ? F().pct(r.vacancyRate) : 'Not set') + '</dd></div></dl>' +
      (r.annualRents == null ? '<p class="note">' + esc(F().unavailable(r, 'annualRents')) + '</p>' : '');
    var homes = G ? global.LabCalcGrid.section(p, s, G, inputs, r, c.data)
      : '<p class="callout">These homes and rents come from the scenario\u2019s saved rent schedule. <a href="' + esc(homesPage) + '">Change them in Homes and affordability</a>.</p>' + F().rentLimitsFixed(p, s);
    var cm = F().captureMarket(p, s, inputs, G);
    var site = global.LabCalcSite;
    return '<section class="fc-chapter" aria-labelledby="fc-h"><h2 id="fc-h"><span class="fc-n">2</span> Homes and income</h2>' +
      '<p class="fc-q">Who will live here, and what will they pay? Homes by income band, rents, who pays utilities and the allowance, and vacancy.</p>' +
      facts + homes + F().rentCapInputs(d, r) +
      '<h2>Building areas</h2>' + F().fieldGridIds(d, ['dc-gross-sf', 'dc-res-sf', 'dc-restricted-sf']) + (site && site.area ? site.area(d, inputs, G) : '') +
      (global.LabCalcGrid && global.LabCalcGrid.tables ? '<details class="fc-more"><summary>Homes and rents as priced, and rent limits against market rent</summary>' + global.LabCalcGrid.tables(r, inputs, G, c.data) + '</details>' : '') +
      '<details class="fc-more" id="fc-capture"><summary>Can the market fill these homes?</summary>' + F().captureSection(p, s, cm) + '</details>' +
      '</section>';
  }
  // ---------- How this deal is doing (paul, 25 Nov 2026: "build the deal check panel") ----------
  // Six indicators, each the engine's own figure against a published target or the reader's own setting, with a
  // status and one suggested change linked to the chapter where it is made. No overall score.
  var CHECK = {
    meets: { st: 'ready', word: 'Meets target' },
    misses: { st: 'answer', word: 'Misses target' },
    unknown: { st: 'none', word: 'Not measured yet' }
  };
  function chap(id) { return CHAPTERS.filter(function (x) { return x.id === id; })[0]; }
  function dealChecks(c, st) {
    var r = c.r, f = c.inputs.fields, out = [];
    var rules = F()._data && F()._data.rules && F()._data.rules.rules;
    var minDcr = rules && rules.min_debt_coverage && Number(rules.min_debt_coverage.min_coverage);
    var x2 = function (v) { return v == null || !isFinite(v) ? null : v.toFixed(2) + 'x'; };
    var add = function (o) { out.push(o); };
    // 1. Funding gap
    (function () {
      var o = { id: 'gap', name: 'Funding gap', target: '$0', source: 'Sources must cover the cost', ch: 'funding' };
      if (st.costs.blocker) { o.state = 'unknown'; o.value = 'Waiting on land'; o.fix = 'Fix the land line.'; o.ch = 'costs'; }
      else if (r.gap == null) { o.state = 'unknown'; o.value = 'Not available'; o.fix = F().unavailable(r, 'gap'); }
      else if (r.gap <= 0.5) { o.state = 'meets'; o.value = r.gap < -0.5 ? short$(-r.gap) + ' to spare' : 'Covered'; }
      else {
        o.state = 'misses'; o.value = short$(r.gap) + ' short';
        var best = levers(c).filter(function (x) { return x.delta < -0.5; }).sort(function (a, b) { return a.delta - b.delta; })[0];
        if (best) { o.fix = best.ch.label + ' ' + (best.dir < 0 ? best.ch.down : best.ch.up) + ' would make the gap ' + short$(-best.delta) + ' smaller' + (best.gap <= 0.5 ? ', closing it' : '') + '. Or add a soft loan or grant.'; o.ch = best.ch.ch; }
        else o.fix = 'Add a soft loan or grant.';
      }
      add(o);
    }());
    // 2. First-mortgage coverage, year 1
    (function () {
      var y1 = r.coverage && r.coverage.years && r.coverage.years[0], v = y1 ? y1.seniorCoverage : null;
      var o = { id: 'dcr', name: 'First-mortgage coverage, year 1', target: minDcr ? 'At least ' + x2(minDcr) : '—', source: 'CHFA minimum, underwriting rules', ch: 'funding' };
      if (v == null || !minDcr) { o.state = 'unknown'; o.value = 'Not available'; o.fix = F().unavailable(r, 'coverage'); }
      else if (v >= minDcr - 0.005) { o.state = 'meets'; o.value = x2(v); }
      else { o.state = 'misses'; o.value = x2(v); o.fix = 'Size the loan at ' + x2(minDcr) + ' or more (coverage under First mortgage terms), or lower running costs in chapter 4.'; }
      add(o);
    }());
    // 3. Coverage under the combined stress case
    (function () {
      var v = r.stress && r.stress.combined ? r.stress.combined.dscr : null, floor = num(f['dc-stress-dscr-floor']);
      var o = { id: 'stress', name: 'Coverage under the combined stress case', target: floor != null ? 'At least ' + x2(floor) : '—', source: 'Your lender floor setting', ch: 'results' };
      if (v == null || !isFinite(v) || floor == null) { o.state = 'unknown'; o.value = 'Not available'; o.fix = F().unavailable(r, 'stress'); }
      else if (v >= floor - 0.005) { o.state = 'meets'; o.value = x2(v); }
      else { o.state = 'misses'; o.value = x2(v); o.fix = 'Size the first mortgage at a higher coverage (chapter 5), or fund an operating reserve; the stress cases are under Results.'; o.ch = 'funding'; }
      add(o);
    }());
    // 4. Deferred developer fee repaid by year 15
    (function () {
      var rc = r.deferredRepayCap || {}, yrs = rc.years || 15, dfYr = r.exit ? r.exit.dfYr : null;
      var o = { id: 'fee-repaid', name: 'Deferred developer fee repaid', target: 'By year ' + yrs, source: 'CHFA QAP ' + (rc.citation ? rc.citation.replace(/^QAP /, '') : '2.B'), ch: 'funding' };
      if (!(r.deferredDevFee > 0.5)) { o.state = r.deferredDevFee == null ? 'unknown' : 'meets'; o.value = r.deferredDevFee == null ? 'Not available' : 'No fee deferred'; if (r.deferredDevFee == null) o.fix = F().unavailable(r, 'deferredDevFee'); }
      else if (dfYr != null && dfYr <= yrs) { o.state = 'meets'; o.value = 'Year ' + dfYr; }
      else if (dfYr != null || (rc.owedAfter != null && rc.owedAfter > 0.5)) { o.state = 'misses'; o.value = dfYr != null ? 'Year ' + dfYr : 'Not by year ' + yrs; o.fix = 'Defer less of the fee (chapter 5), turn on the repayment limit, or lower running costs in chapter 4.'; }
      else { o.state = 'unknown'; o.value = 'Not available'; o.fix = rc.reason || F().unavailable(r, 'exit.dfYr'); }
      add(o);
    }());
    // 5. Developer fee
    (function () {
      var dev = (r.costBasis || {}).developerFee;
      var o = { id: 'fee', name: 'Developer fee', target: 'Within CHFA’s limit', source: 'CHFA QAP developer fee limits', ch: 'costs' };
      if (dev && dev.passes === false) { o.state = 'misses'; o.value = short$(dev.excess) + ' over'; o.fix = 'Lower the developer fee to ' + money(dev.limit) + '; the excess is out of basis.'; }
      else if (dev && dev.passes === true) { o.state = 'meets'; o.value = dev.fee != null ? short$(dev.fee) : 'Within'; }
      else { o.state = 'unknown'; o.value = 'Not tested'; o.fix = (dev && dev.reason) || 'Itemize the costs so the fee can be tested.'; }
      add(o);
    }());
    // 6. Cost per home and per bedroom, against CHFA's per-home cost basis limits for this mix (Method Three)
    (function () {
      var b = (r.costBasis || {}).basis || {}, clm = b.costLimitMethod || {}, plan = b.costLimitPlan || {};
      var units = r.units, beds = 0, counted = 0;
      (r.pricedRows || []).forEach(function (row) {
        var n = Number(row && row.units), k = row && row.bedrooms;
        if (!(n > 0) || !k) return;
        var br = k === 'efficiency' || k === '0BR' ? 1 : parseInt(k, 10);
        if (!(br > 0)) return;
        beds += br * n; counted += n;
      });
      var perHome = r.tdc > 0 && units > 0 ? r.tdc / units : null;
      var perBed = r.tdc > 0 && beds > 0 && Math.abs(counted - units) < 0.5 ? r.tdc / beds : null;
      var limitHome = clm.checked && units > 0 ? clm.adjustedEligibleBasis / units : null;
      var basisHome = r.eligibleBasis > 0 && units > 0 ? r.eligibleBasis / units : null;
      var o = { id: 'cost', name: 'Cost per home and per bedroom', target: 'Within CHFA’s per-home limits',
        source: 'CHFA 2027 Common Application, by bedrooms and building type' + (limitHome != null ? ': ' + short$(limitHome) + ' a home for this mix' : ''), ch: 'costs',
        detail: (perBed != null ? short$(perBed) + ' a bedroom (studios count as one)' : 'Per bedroom needs a bedroom count for every home') +
          (basisHome != null ? '; eligible basis ' + short$(basisHome) + ' a home' : '') };
      o.value = perHome != null ? short$(perHome) + ' a home' : 'No cost yet';
      if (perHome == null) { o.state = 'unknown'; o.fix = 'Enter the costs in chapter 3.'; }
      else if (!clm.checked) { o.state = 'unknown'; o.fix = clm.reason || 'CHFA’s limits need the county, the building type and a bedroom count for every home.'; }
      else if (clm.lower) {
        o.state = 'misses';
        o.fix = 'Eligible basis is above CHFA’s per-home limits for this mix, so Method Three cuts the credit to ' + money(clm.credit) + ' a year' + (plan.applied ? ' (applied)' : '') + '. Lower costs, or check the building type.';
      } else o.state = 'meets';
      add(o);
    }());
    // 7. Minimum set-aside
    (function () {
      var m = r.minimumSetAsideResult;
      var o = { id: 'set-aside', name: 'Minimum set-aside', target: 'Qualifies', source: '26 U.S.C. 42(g), as screened by the engine', ch: 'homes' };
      if (!m || m.qualifies == null) { o.state = 'unknown'; o.value = 'Not available'; o.fix = 'Enter the homes and their income bands.'; }
      else if (m.qualifies) { o.state = 'meets'; o.value = m.setAsideUnits + ' of ' + m.totalUnits + ' homes'; }
      else { o.state = 'misses'; o.value = 'Does not qualify'; o.fix = m.reason + '. Change the homes’ income bands (chapter 2) or the election (chapter 1).'; }
      add(o);
    }());
    return out;
  }
  function lc(t) { t = String(t); return /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t; }
  function checkBadge(o) { var k = CHECK[o.state]; return badge(k.st, k.word); }
  function checkPanel(c, st, wide) {
    var list = dealChecks(c, st), n = { meets: 0, misses: 0, unknown: 0 };
    list.forEach(function (o) { n[o.state]++; });
    var sum = n.meets + ' of ' + list.length + ' meet their target' + (n.misses ? ', ' + n.misses + ' miss' : '') + (n.unknown ? ', ' + n.unknown + ' not measured yet' : '');
    var id = wide ? 'fc-dc-h' : 'fc-dcr-h';
    var link = function (o) { var ch = chap(o.ch); return '<a href="' + esc(chapterHref(c, ch)) + '">Chapter ' + ch.n + '<span class="sr-only"> ' + esc(ch.title) + '</span></a>'; };
    return '<section class="fc-dcheck' + (wide ? ' fc-dcheck-wide' : '') + '" aria-labelledby="' + id + '"><h2 id="' + id + '">How this deal is doing</h2><p class="note">' + esc(sum) + '.' +
      (wide ? ' Each figure is the Deal Engine\u2019s; each target is published or your own setting. There is no overall score.' : '') + '</p><ul role="list">' +
      list.map(function (o) {
        return '<li data-check="' + o.id + '"><div class="fc-dcl"><span class="fc-dcn">' + esc(o.name) + (o.detail ? '<small class="fc-dcs fc-dcd">' + esc(o.detail) + '</small>' : '') + (wide ? '<small class="fc-dcs">Target: ' + esc(lc(o.target)) + ' (' + esc(o.source) + ')</small>' : '') + '</span>' +
          '<span class="fc-dcv">' + esc(o.value) + (wide ? '' : ' <small>target ' + esc(lc(o.target)) + '</small>') + '</span>' + checkBadge(o) + '</div>' +
          (o.fix && o.state !== 'meets' ? '<p class="fc-dcf">' + esc(o.fix) + ' ' + link(o) + '</p>' : '') + '</li>';
      }).join('') + '</ul></section>';
  }

  // ---------- chapter 6, Results and review ----------
  // A one-line answer from each chapter with its status and a link to change it; three graphics drawn on one scale
  // each; the full page's result cards; and every result section of the full page in folds. "What moves the gap"
  // runs the same Deal Engine again with one input changed (as the full page's rate and price grid does); nothing
  // else is computed here.
  var CHANGES = [
    { id: 'cost', label: 'All costs', down: '5% lower', up: '5% higher', ch: 'costs' },
    { id: 'price', label: 'Equity price', down: '$0.05 lower', up: '$0.05 higher', ch: 'funding' },
    { id: 'rate', label: 'First mortgage rate', down: '0.5 point lower', up: '0.5 point higher', ch: 'funding' }
  ];
  function rerun(inputs, id, dir) {
    var f = Object.assign({}, inputs.fields), x = Object.assign({}, inputs, { fields: f, skipSchedules: true });
    if (id === 'cost') {
      var k = 1 + dir * 0.05, sc = function (v) { return v == null || !isFinite(Number(v)) ? v : Number(v) * k; };
      if (num(f['dc-tdc']) != null) f['dc-tdc'] = String(Number(f['dc-tdc']) * k);
      x.costLines = inputs.costLines.map(function (l) {
        var m = Object.assign({}, l, { amount: sc(l.amount), eligibleAmount: sc(l.eligibleAmount) });
        if ('used' in l) m.used = sc(l.used);
        return m;
      });
    } else if (id === 'price') {
      var pr = num(f['dc-equity-price']); if (pr == null) return null;
      f['dc-equity-price'] = String(Math.round((pr + dir * 0.05) * 100) / 100);
    } else {
      var rt = num(f['dc-rate']); if (rt == null || rt + dir * 0.5 <= 0) return null;
      f['dc-rate'] = String(Math.round((rt + dir * 0.5) * 100) / 100);
    }
    return global.DealEngine.computeDeal(x).gap;
  }
  // The six one-input runs, made once per drawing and shared by the chart and the deal check.
  function levers(c) {
    if (c._levers) return c._levers;
    var r = c.r, rows = [];
    if (r.gap != null && global.DealEngine) CHANGES.forEach(function (ch) {
      [-1, 1].forEach(function (dir) {
        var g = rerun(c.inputs, ch.id, dir);
        if (g != null) rows.push({ ch: ch, dir: dir, gap: g, delta: g - r.gap });
      });
    });
    c._levers = rows;
    return rows;
  }
  function movesChart(c, st) {
    var r = c.r, h = '<section class="fc-graphic" aria-labelledby="fc-moves-h"><h2 id="fc-moves-h">What moves the gap most?</h2>';
    if (st.costs.blocker || r.gap == null || !global.DealEngine) return h + '<p class="note">' + esc(st.costs.blocker ? 'Shown once the land line is fixed.' : F().unavailable(r, 'gap')) + '</p></section>';
    var rows = levers(c).slice();
    if (!rows.length) return h + '<p class="note">Not available for these inputs.</p></section>';
    var widest = Math.max.apply(null, rows.map(function (x) { return Math.abs(x.delta); })) || 1;
    var size = {}; rows.forEach(function (x) { size[x.ch.id] = Math.max(size[x.ch.id] || 0, Math.abs(x.delta)); });
    rows.sort(function (a, b) { return size[b.ch.id] - size[a.ch.id] || a.dir - b.dir; });
    var what = function (x) { return x.ch.label + ' ' + (x.dir < 0 ? x.ch.down : x.ch.up); };
    var says = function (x) { return Math.abs(x.delta) < 0.5 ? 'No change' : r.gap > 0 && x.gap <= 0 ? 'Gap closed (' + short$(-x.delta) + ' less)' : (x.delta > 0 ? 'Gap ' + short$(x.delta) + ' bigger' : 'Gap ' + short$(-x.delta) + ' smaller'); };
    var top = rows[0];
    var list = rows.map(function (x) {
      var w = Math.abs(x.delta) / widest * 50;
      return '<li class="fc-mv' + (x.delta > 0 ? ' is-up' : '') + '"><span class="fc-ml">' + esc(what(x)) + '</span>' +
        '<span class="fc-mt" aria-hidden="true"><span class="fc-mf" style="width:' + w.toFixed(1) + '%;' + (x.delta > 0 ? 'left:50%' : 'right:50%') + '"></span></span>' +
        '<span class="fc-mvv">' + esc(says(x)) + '</span></li>';
    }).join('');
    var table = '<details class="fc-tbl"><summary>Show as a table</summary><div class="table-scroll" role="region" aria-label="What moves the gap, as a table" tabindex="0"><table data-sort-seen="1"><thead><tr><th scope="col">One change</th><th scope="col" class="num">Funding gap</th><th scope="col" class="num">Against now</th><th scope="col">Change it</th></tr></thead><tbody>' +
      '<tr><th scope="row">As entered</th><td class="num">' + esc(money(r.gap)) + '</td><td class="num">—</td><td></td></tr>' +
      rows.map(function (x) {
        var chap = CHAPTERS.filter(function (y) { return y.id === x.ch.ch; })[0];
        return '<tr><th scope="row">' + esc(what(x)) + '</th><td class="num">' + esc(money(x.gap)) + '</td><td class="num">' + esc(Math.abs(x.delta) < 0.5 ? '$0' : (x.delta > 0 ? '+' : '−') + money(Math.abs(x.delta)).replace(/^-/, '')) + '</td><td><a href="' + esc(chapterHref(c, chap)) + '">Chapter ' + chap.n + '</a></td></tr>';
      }).join('') + '</tbody></table></div></details>';
    return h + '<p class="note">The Deal Engine run again with one input changed, the rest as entered; the first mortgage is re-sized each time. A gap below zero is money to spare.</p>' +
      '<p class="fc-mkey"><span class="fc-k fc-k-dn" aria-hidden="true"></span> Gap smaller <span class="fc-k fc-k-up" aria-hidden="true"></span> Gap bigger</p>' +
      '<ul class="fc-moves" role="list">' + list + '</ul>' +
      '<p><strong>' + esc(top.ch.label) + '</strong> moves the gap most here: up to ' + esc(short$(size[top.ch.id])) + ' for that change.</p>' + table + '</section>';
  }
  function carryChart(c, st) {
    var r = c.r, h = '<section class="fc-graphic" aria-labelledby="fc-carry-h"><h2 id="fc-carry-h">Can the rent carry the loans?</h2>';
    var y1 = r.coverage && r.coverage.years && r.coverage.years[0];
    if (!y1 || y1.noi == null || y1.mustPayDebtService == null) return h + '<p class="note">' + esc(F().unavailable(r, 'coverage')) + '</p></section>';
    var left = y1.cashFlow;
    var rows = [
      ['Net operating income', y1.noi, 'is-noi'],
      ['Loan payments that must be paid', y1.mustPayDebtService, 'is-pay'],
      [left != null && left < 0 ? 'Short before the deferred fee' : 'Left before the deferred fee', left, left != null && left < 0 ? 'is-short' : 'is-left']
    ];
    var scale = Math.max.apply(null, rows.map(function (x) { return Math.abs(x[1] || 0); })) || 1;
    var weak = r.coverage.weakestAllMustPay;
    var balloon = r.coverage.years.filter(function (y) { return y.maturityDue > 0.5; })[0];
    var bars = rows.map(function (x) {
      return '<li class="fc-bar fc-carry ' + x[2] + '"><span class="fc-bl">' + esc(x[0]) + '</span><span class="fc-bt">' + (x[1] == null ? '' : '<span class="fc-bf" style="width:' + (Math.abs(x[1]) / scale * 100).toFixed(1) + '%"></span>') + '</span>' +
        '<span class="fc-bv">' + esc(x[1] == null ? 'Unknown' : short$(x[1])) + '</span></li>';
    }).join('');
    var table = '<details class="fc-tbl"><summary>Show as a table</summary><div class="table-scroll" role="region" aria-label="Year 1 income and loan payments, as a table" tabindex="0"><table data-sort-seen="1"><thead><tr><th scope="col">Year 1</th><th scope="col" class="num">Amount</th></tr></thead><tbody>' +
      rows.map(function (x) { return '<tr><th scope="row">' + esc(x[0]) + '</th><td class="num">' + esc(x[1] == null ? 'Unknown' : money(x[1])) + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
    return h + '<p class="note">Year 1, on one scale. Payments that must be paid are the first mortgage and any soft loan with fixed payments. What is left is after every loan payment, the bridge loan and the asset management fee, and before the deferred developer fee is repaid from it.</p>' +
      '<ul class="fc-bars" role="list">' + bars + '</ul>' +
      '<dl class="fc-facts fc-carry-facts">' +
        '<div><dt>Coverage, year 1</dt><dd>' + esc(y1.allMustPayCoverage != null ? y1.allMustPayCoverage.toFixed(2) + 'x' : 'Not available') + '<small>Income ÷ payments that must be paid</small></dd></div>' +
        '<div><dt>Weakest year</dt><dd>' + esc(weak ? weak.ratio.toFixed(2) + 'x in year ' + weak.year : 'Not available') + '<small>Over the ' + esc(String(r.coverage.years.length)) + '-year projection</small></dd></div>' +
        '<div><dt>First balloon payment</dt><dd>' + esc(balloon ? short$(balloon.maturityDue) + ' in year ' + balloon.year : 'None in the projection') + '<small>Loan balances due at maturity</small></dd></div></dl>' +
      table + '</section>';
  }
  function answerLine(c, id) {
    var p = c.p, d = c.d, r = c.r;
    var credit = { '9': '9% credits', '4': '4% credits with bonds' }[String(d.fields['dc-credit'])] || 'Credit type not set';
    var f = c.inputs.fields, pr = num(f['dc-equity-price']);
    if (id === 'project') return ((p.jurisdiction && p.jurisdiction.name) || 'No place chosen') + ', ' + credit;
    if (id === 'homes') return r.units > 0 ? r.units + ' homes, ' + (r.annualRents != null ? money(r.annualRents) + ' scheduled rent a year' : 'rents not available') : 'No homes yet';
    if (id === 'costs') return r.tdc > 0 ? money(r.tdc) + ' total' + (r.units > 0 ? ', ' + money(r.tdc / r.units) + ' a home' : '') : 'No total yet';
    if (id === 'operations') return r.annualOpex != null ? money(r.annualOpex) + ' a year to run; net operating income ' + (r.noi != null ? money(r.noi) : 'not available') : 'No budget yet';
    if (id === 'funding') return (pr != null ? '$' + pr.toFixed(2) + ' equity price' : 'Equity price not set') + ', ' + String(d.fields['dc-rate']) + '% loan rate, ' + (function (n) { return n === 1 ? '1 soft source' : n + ' soft sources'; }((c.inputs.tranches || []).filter(function (t) { return t.amount > 0; }).length));
    return '';
  }
  function reviewTable(c, st) {
    return '<section class="fc-review" aria-labelledby="fc-review-h"><h2 id="fc-review-h">Check your answers</h2>' +
      '<div class="table-scroll" role="region" aria-label="Your answers by chapter" tabindex="0"><table data-sort-seen="1"><thead><tr><th scope="col">Chapter</th><th scope="col">Your answers</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Change</span></th></tr></thead><tbody>' +
      CHAPTERS.slice(0, 5).map(function (ch) {
        return '<tr><th scope="row">' + ch.n + ' ' + esc(ch.title) + '</th><td>' + esc(answerLine(c, ch.id)) + '</td><td>' + badge(st[ch.id].state, st[ch.id].text) + '</td>' +
          '<td><a href="' + esc(chapterHref(c, ch)) + '">Change<span class="sr-only"> ' + esc(ch.title) + '</span></a></td></tr>';
      }).join('') + '</tbody></table></div></section>';
  }
  function resultsChapter(c, st) {
    var d = c.d, r = c.r, inputs = c.inputs, p = c.p, s = c.s;
    var X = F(), DOH = global.LabCalcDoh;
    var rs = global.LabDealExtras && global.LabDealExtras.resultSections ? global.LabDealExtras.resultSections(p, s, r, c.data) : null;
    var fold = function (id, title, html) { return html ? '<details class="fc-more" id="' + id + '"><summary>' + esc(title) + '</summary>' + html + '</details>' : ''; };
    var land = st.costs.blocker;
    return '<section class="fc-chapter" aria-labelledby="fc-h"><h2 id="fc-h"><span class="fc-n">6</span> Results and review</h2>' +
      '<p class="fc-q">Does it work, and what would change it? Check each chapter’s answers, then read the result.</p>' +
      checkPanel(c, st, true) + reviewTable(c, st) +
      (land ? '<p class="callout"><strong>Waiting on land:</strong> ' + esc(land) + '</p>' : '') +
      '<div class="fc-graphics">' + paysChart(c, st) + movesChart(c, st) + carryChart(c, st) + '</div>' +
      '<h2 id="fin-result">The result</h2>' + X.resultCards(r, inputs) +
      fold('fc-likely', 'Most-likely case and the loan rate', X.mostLikely(d, inputs, r) + X.rateGrid(inputs, r)) +
      fold('fc-su', 'Sources and uses', X.sourcesUses(r)) +
      fold('fc-loans', 'Loans', X.loanTable(r)) +
      fold('fc-doh', 'Division of Housing sections', DOH ? DOH.sections(r, d.fields) : '') +
      fold('fc-stress', 'Stress cases and sliders: ' + X.combinedLabel(inputs.constants),
        '<h2>Stress case settings</h2><p class="note">How far each stress case moves rent, vacancy and operating cost. These are screening settings, not a lender’s or CHFA’s required cases.</p>' +
        c.fieldGrid(d, 'stressconst') + '<div class="actions"><button type="button" class="button-link secondary" data-action="reset-stress-settings">Reset to the Deal Calculator’s defaults</button></div>' +
        X.stressTable(r, inputs.constants) + X.stressSliders(d, inputs, r)) +
      fold('fc-sens', 'How sensitive is the deal?', rs ? rs.sensitivity : '') +
      fold('fc-exit', 'Exit', X.exitSummary(r, inputs)) +
      fold('fc-wf', 'Partnership waterfall', X.waterfallSection(d, r)) +
      fold('fc-credit', 'Fee, credit and cost checks', X.creditChecks(r)) +
      fold('fc-outcome', 'Housing outcome', global.LabCalcOutcome ? global.LabCalcOutcome.render(p, d, inputs, r, c.G) : '') +
      fold('fc-comps', 'Comparable deals', global.LabCalcComps ? global.LabCalcComps.render(inputs) : '') +
      (global.LabLenderExport ? global.LabLenderExport.remember(r, s.name) : '') +
      '</section>';
  }

  // Sections with forms of their own sit after the chapter's form, never inside it.
  function after(c, here) {
    if (here === 'results') {
      var rs = global.LabDealExtras && global.LabDealExtras.resultSections ? global.LabDealExtras.resultSections(c.p, c.s, c.r, c.data) : null;
      return (rs ? '<details class="fc-more" id="fc-compare"><summary>Compare this project\u2019s scenarios</summary>' + rs.compare + '</details>' : '') +
        (global.LabCalcChecks ? '<details class="fc-more" id="fc-checks"><summary>Partnership, Colorado factors and project type checks</summary>' + global.LabCalcChecks.render(c.p, c.s) + '</details>' : '') +
        (global.LabDealFile ? global.LabDealFile.panel(c.p, c.s) : '');
    }
    if (here !== 'homes' || !global.LabDealExtras || !global.LabDealExtras.rentSections) return '';
    var x = global.LabDealExtras.rentSections(c.p, c.inputs, c.data);
    return '<details class="fc-more" id="fc-rent-context"><summary>Rent context: voucher, existing and asking rents</summary>' + x.context + '</details>' +
      '<details class="fc-more" id="fc-rvb"><summary>Rent or buy: when does buying win?</summary>' + x.rentVsBuy + '</details>';
  }

  function pager(c, here) {
    var i = CHAPTERS.map(function (x) { return x.id; }).indexOf(here);
    var prev = CHAPTERS[i - 1], next = CHAPTERS[i + 1];
    return '<nav class="fc-pager" aria-label="Previous and next chapter">' +
      (prev ? '<a class="button-link secondary" href="' + esc(chapterHref(c, prev)) + '">← ' + prev.n + ' ' + esc(prev.short) + '</a>' : '<span></span>') +
      (next ? '<a class="button-link" href="' + esc(chapterHref(c, next)) + '">' + next.n + ' ' + esc(next.short) + ' →</a>' : '') + '</nav>';
  }

  function render(here, c) {
    var p = c.p, s = c.s, st = statuses(c);
    var head = '<p class="fc-crumbs"><a href="#/projects">Your projects</a> › <a href="#/project/' + esc(p.projectId) + '">' + esc(p.name) + '</a> › ' + esc(s.name) + '</p>' +
      '<div class="fc-head"><div><h1>Deal workspace</h1><p class="lede">Kept in this browser only, as this scenario’s draft. Same Deal Engine as the full Financials page.</p></div>' +
      '<div class="fc-head-actions"><a class="button-link secondary" href="' + esc(base(p, s)) + '">All Financials sections on one page</a>' +
      (global.LabDealFile ? '<a class="button-link secondary" href="' + esc(base(p, s)) + '/results?step=fin-share">Share, export or print</a>' : '') + '</div></div>';
    var stale = c.sched && c.sched.state === 'stale' ? '<p class="callout">The rent schedule is out of date: ' + esc(c.sched.staleReason) + '. Save it again in Homes and affordability before relying on these figures.</p>' : '';
    var body = here === 'project' ? projectChapter(c, st) : here === 'homes' ? homesChapter(c, st) : here === 'costs' ? costsChapter(c, st) : here === 'operations' ? operationsChapter(c, st) : here === 'funding' ? fundingChapter(c, st) : here === 'results' ? resultsChapter(c, st) : '';
    return head + stale + progress(c, here, st) + slim(c, st) +
      '<div class="fc-work">' + menu(c, here, st) +
      '<div class="fc-col"><form class="fc-main homes" data-action="financials" novalidate>' + body + '</form>' + after(c, here) + pager(c, here) + '</div>' +
      rail(c, st, here) + '</div>';
  }

  function classicLink(p, s) {
    return '<p class="note fc-try" data-role="fc-try">New layout to try: <a href="' + esc(base(p, s)) + '/project">the deal workspace, in six chapters</a> (same scenario and engine).</p>';
  }

  // A link with ?step= opens that section of the full page and brings it into view once it is drawn (the page may
  // draw twice while its data loads).
  function revealStep() {
    var raw = location.hash || '', q = raw.indexOf('?');
    if (!/^#\/financials\//.test(raw) || q < 0) return;
    var id = new URLSearchParams(raw.slice(q + 1)).get('step');
    if (!id || !/^fin-[a-z-]+$/.test(id)) return;
    var tries = 0, at = raw;
    (function look() {
      if (location.hash !== at) return;
      var el = document.getElementById(id);
      if (el) { if (el.tagName === 'DETAILS') el.open = true; el.scrollIntoView({ block: 'start' }); return; }
      if (++tries < 30) setTimeout(look, 150);
    }());
  }
  // Guarded so the page's scripts still start where there is no window to listen on (HA's render-home test).
  if (global.addEventListener) global.addEventListener('hashchange', function () { setTimeout(revealStep, 0); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(revealStep, 0); });
  else setTimeout(revealStep, 0);
  // Before financials.js reads the form (its listeners are on #main, so they run after this capturing one), every
  // money box goes back to a plain number: "1,200,000" or "$1,200,000" becomes "1200000". Anything else is left as
  // typed, so the engine still reports it as not a number.
  function plainMoney(form) {
    Array.prototype.forEach.call(form.querySelectorAll('input[data-fc-money]'), function (i) {
      var t = i.value.trim().replace(/^\$\s*/, '');
      if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) || /^\d+(\.\d+)?$/.test(t)) i.value = t.replace(/,/g, '');
    });
  }
  ['change', 'submit', 'click'].forEach(function (type) {
    document.addEventListener(type, function (ev) {
      var form = ev.target && (ev.target.form || (ev.target.closest && ev.target.closest('form')));
      if (type === 'click' && !(ev.target.closest && ev.target.closest('button'))) return;
      if (form && form.classList && form.classList.contains('fc-main')) plainMoney(form);
    }, true);
  });
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-fc-jump]');
    if (!b) return;
    var el = document.getElementById(b.getAttribute('data-fc-jump'));
    if (el) { el.scrollIntoView({ block: 'start' }); el.focus({ preventScroll: true }); }
  });

  global.LabFinChapters = { CHAPTERS: CHAPTERS, has: function (id) { return !!BUILT[id]; }, render: render, classicLink: classicLink, statuses: statuses, landCheck: landCheck, short$: short$ };
})(window);
