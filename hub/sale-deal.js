// Homes for sale, every line: the live Deal Calculator's for-sale mode in the lab. It shares the quick estimate's
// county, cost, homes and buyer target (deal-quick-sale.js), then adds what the live mode adds: floor area, the
// owner's years in the home, the resale rule and its subsidy type, and the funding programs the Deal Engine maps to
// the gap. Inputs are built the way deal-calculator.js builds them at the pin (readOwnershipSources and
// computeOwnershipResale); every figure comes from DealEngine.computeForSaleFeasibility, OwnershipFinance and
// OwnershipResale. This file does no deal arithmetic; bar widths are only drawing.
// qa/deal-quick-live.js runs the live calculator's for-sale mode on the same inputs and checks the figures agree.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl;
  var esc = Shell.esc;
  var VENDOR = global.LAB_VENDOR;
  var LIVE_TOOL = 'https://cohoanalytics.com/deal-calculator.html?mode=ownership';
  var FILES = { hud: 'data/hud-fmr-income-limits.json', programs: 'data/policy/developer-ownership-funding.json', resale: 'data/policy/resale-conventions.json' };

  // The live mode's own resale inputs, labels and defaults (deal-calculator.js, "Resident over time"), each with a
  // note on what goes in it and where to find it.
  var RESALE = [
    { id: 'dc-own-resale-years', label: 'Years the first buyer owns', value: '5', step: '1', min: '0', note: 'How long the first buyer owns before selling.' },
    { id: 'dc-own-resale-principal', label: 'Loan balance left at resale ($)', value: '', step: '1000', min: '0', note: 'From the buyer’s loan amortization schedule at that year. Blank is $0.' },
    { id: 'dc-own-resale-costs', label: 'Selling costs ($)', value: '', step: '1000', min: '0', note: 'Commission and closing costs at resale, from a local broker. Blank is $0.' },
    { id: 'dc-own-resale-appreciation', label: 'Market gain to share ($)', value: '', step: '1000', note: 'Used only by shared appreciation: the market gain the deed restriction splits. Blank is $0.' }
  ];
  var START = { grossSf: '', subsidyType: 'none', conventionId: null };
  RESALE.forEach(function (i) { START[i.id] = i.value; });

  var data = null, failed = null, asked = false;
  var x = JSON.parse(JSON.stringify(START));
  function load() {
    if (asked) return;
    asked = true;
    var keys = Object.keys(FILES);
    Promise.all(keys.map(function (k) { return fetch(VENDOR + FILES[k]).then(function (r) { if (!r.ok) throw new Error(FILES[k] + ' ' + r.status); return r.json(); }); }))
      .then(function (r) { data = {}; keys.forEach(function (k, i) { data[k] = r[i]; }); Shell.render(); })
      .catch(function (e) { failed = e.message; Shell.render(); });
  }
  function Q() { return global.LabDealQuickSale; }
  function quick() { return Q().state(); }

  // deal-calculator.js readDealInputs → readOwnershipSources → computeOwnershipResale, at the pin.
  function build(s, ext, src) {
    var OF = global.OwnershipFinance, OR = global.OwnershipResale;
    var target = s.target / 100, a = Q().ami4(src, s.county);
    var price = isFinite(a) && a > 0 ? OF.maxAffordablePrice(a, target, undefined) : null;
    var num = function (id, dflt) { return parseFloat(ext[id]) || dflt; };
    var resale = null;
    if (OR && typeof OR.evaluateAll === 'function') {
      var purchase = price != null && isFinite(price) && price > 0 ? price : null;
      var base = {
        purchasePrice: purchase,
        unavailableReason: purchase == null ? 'A positive purchase price is unavailable; resale price and owner equity cannot be calculated.' : null,
        holdingPeriodYears: num('dc-own-resale-years', 5), remainingPrincipal: num('dc-own-resale-principal', 0),
        sellingCosts: num('dc-own-resale-costs', 0), marketAppreciation: num('dc-own-resale-appreciation', 0),
        ami4Person: a, targetAmiPct: target, assumptions: undefined, maxAffordablePrice: undefined
      };
      resale = {
        label: 'Resale convention screen - screening only',
        rows: OR.evaluateAll(src.resale, base),
        comparison: OR.compareConventions(src.resale, Object.assign({}, base, {
          holdingPeriodYears: base.holdingPeriodYears || 10, cpiRateAnnual: 0.02, recaptureAmount: 90000,
          subsidyType: ext.subsidyType || 'none', selectedConventionId: ext.conventionId
        }))
      };
    }
    return { tdc: s.tdc, units: s.units, grossSf: ext.grossSf, ami4Person: a, targetAmiPct: target, hasAffordablePriceHelper: true,
      maxAffordableSalePrice: price, developerFundingPrograms: (src.programs && src.programs.programs) || [], ownershipResale: resale,
      countyFips: s.county || null };
  }
  function run(s, ext, src) { return global.DealEngine.computeForSaleFeasibility(build(s, ext, src)); }

  function money(n) { return n == null || !isFinite(n) ? '—' : (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US'); }
  function short(n) { return Math.abs(n) >= 1e6 ? '$' + (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M' : '$' + Math.round(n / 1000) + 'K'; }

  // The selected mechanism's moderate case, as the live page's "Public interest at resale" row picks it.
  function publicInterest(screen) {
    var c = screen && screen.comparison;
    if (!c || !c.rows || !c.rows.length) return null;
    var row = c.rows.filter(function (r) { return r.conventionId === c.selectedConventionId; })[0] || c.rows.filter(function (r) { return !r.disabled; })[0];
    if (!row) return null;
    var idx = 0;
    (c.scenarios || []).forEach(function (sc, n) { if (sc.id === 'moderate') idx = n; });
    return { label: row.label, outcome: row.outcomes[idx] || row.outcomes[0], scenario: (c.scenarios[idx] || {}).label };
  }

  // The answer: what each home costs against what a buyer can pay, on one scale, with the gap between them marked.
  function gapGraphic(s, r) {
    var top = Math.max(r.tdcPerUnit, r.maxAffordableSalePrice) || 1;
    var w = function (v) { return Math.max(2, Math.min(100, v / top * 100)).toFixed(1) + '%'; };
    var gap = r.subsidyGapPerUnit > 0;
    return '<figure class="sale-gap" aria-label="Cost per home ' + esc(money(r.tdcPerUnit)) + ', price a buyer can pay ' + esc(money(r.maxAffordableSalePrice)) + '">' +
      '<div class="sg-row"><span class="sg-label">Cost to build each home</span><div class="sg-track"><div class="sg-bar sg-cost" style="width:' + w(r.tdcPerUnit) + '"></div></div><strong data-out="tdcPerUnit" data-value="' + Math.round(r.tdcPerUnit) + '">' + esc(money(r.tdcPerUnit)) + '</strong></div>' +
      '<div class="sg-row"><span class="sg-label">Price a buyer at ' + esc(String(s.target)) + '% can pay</span><div class="sg-track"><div class="sg-bar sg-price" style="width:' + w(r.maxAffordableSalePrice) + '"></div>' +
      (gap ? '<div class="sg-bar sg-hole" style="left:' + w(r.maxAffordableSalePrice) + ';width:' + (Math.max(0, r.subsidyGapPerUnit) / top * 100).toFixed(1) + '%"></div>' : '') + '</div>' +
      '<strong data-out="maxAffordableSalePrice" data-value="' + Math.round(r.maxAffordableSalePrice) + '">' + esc(money(r.maxAffordableSalePrice)) + '</strong></div>' +
      '<figcaption class="sg-verdict ' + (gap ? 'is-gap' : 'is-ok') + '">' + (gap
        ? '<span class="sg-big" data-out="subsidyGapPerUnit" data-value="' + Math.round(r.subsidyGapPerUnit) + '">' + esc(money(r.subsidyGapPerUnit)) + '</span> gap a home, <span data-out="totalSubsidyGap" data-value="' + Math.round(r.totalSubsidyGap) + '">' + esc(money(r.totalSubsidyGap)) + '</span> for all ' + esc(String(s.units)) + ' homes'
        : '<span class="sg-big" data-out="surplusPerUnit" data-value="' + Math.round(r.surplusPerUnit) + '">' + esc(money(r.surplusPerUnit)) + '</span> room a home: the price covers the cost') + '</figcaption></figure>';
  }

  // The programs the engine maps to the gap in the picked county, in the engine's order: what each one counts toward
  // the gap (never more than is left), the gap left after them, and any program whose area leaves this county out.
  function programList(s, r) {
    var st = r.developerFundingStack;
    if (!(r.subsidyGapPerUnit > 0)) return '';
    if (!st || !st.sourceCount) return '<p class="note">The funding program list did not load.</p>';
    var defs = (data.programs.programs || []);
    var gap = r.subsidyGapPerUnit;
    var counted = (st.appliedSources || []).filter(function (p) { return p.appliedAmountPerUnit > 0; });
    var pct = function (v) { return (Math.max(0, v) / gap * 100).toFixed(1) + '%'; };
    var bar = '<div class="ss-bar" role="img" aria-label="' + esc(counted.map(function (p) { return p.name + ' ' + money(p.appliedAmountPerUnit); }).concat(['still to find ' + money(st.residualGapPerUnit)]).join(', ')) + '">' +
      counted.map(function (p, i) { return '<span class="ss-seg ss-' + (i % 3) + '" style="width:' + pct(p.appliedAmountPerUnit) + '"></span>'; }).join('') +
      (st.residualGapPerUnit > 0 ? '<span class="ss-seg ss-rest" style="width:' + pct(st.residualGapPerUnit) + '"></span>' : '') + '</div>';
    var rows = counted.map(function (p, i) {
      var def = defs.filter(function (d) { return d.id === p.id; })[0] || {};
      var capped = p.appliedAmountPerUnit < p.availableAmountPerUnit - 0.5;
      return '<li><i class="ss-key ss-' + (i % 3) + '" aria-hidden="true"></i><span><a href="' + esc(p.sourceUrl) + '">' + esc(p.name) + ' ↗</a>' +
        '<small>' + esc((def.jurisdiction_scope ? 'Where: ' + def.jurisdiction_scope + '. ' : '') + (capped ? 'Up to ' + money(p.availableAmountPerUnit) + ' a home; only what is left of the gap counts. ' : '') + (p.note || '')) + '</small></span>' +
        '<strong data-program="' + esc(p.id) + '" data-value="' + Math.round(p.appliedAmountPerUnit) + '">' + esc(money(p.appliedAmountPerUnit)) + '</strong></li>';
    }).join('');
    var rest = '<li class="ss-total"><i class="ss-key ss-rest" aria-hidden="true"></i><span>Still to find<small>For all ' + esc(String(s.units)) + ' homes: <span data-out="residualTotalGap" data-value="' + Math.round(st.residualTotalGap) + '">' + esc(money(st.residualTotalGap)) + '</span></small></span>' +
      '<strong data-out="residualGapPerUnit" data-value="' + Math.round(st.residualGapPerUnit) + '">' + esc(money(st.residualGapPerUnit)) + '</strong></li>';
    var outside = (st.outsideSources || []).map(function (p) {
      return '<li data-outside-county="' + esc(p.id) + '"><a href="' + esc(p.sourceUrl) + '">' + esc(p.name) + ' ↗</a>: ' + esc(p.reason) + (p.jurisdictionScope ? ' (' + esc(p.jurisdictionScope) + ' only)' : '') + '; not counted.</li>';
    }).join('');
    var verify = st.verifySources || [];
    return '<section class="sale-card" aria-labelledby="sale-stack-h"><h3 id="sale-stack-h">Programs that may cover part of the gap</h3>' +
      '<p class="ss-head">Counted toward the <span>' + esc(money(gap)) + '</span> gap a home: <strong data-out="appliedAmountPerUnit" data-value="' + Math.round(st.appliedAmountPerUnit) + '">' + esc(money(st.appliedAmountPerUnit)) + '</strong></p>' +
      bar + '<ul class="ss-list">' + rows + rest + '</ul>' +
      (outside ? '<ul class="ss-outside">' + outside + '</ul>' : '') +
      '<p class="note">Potential only, a home: none is an award, and each has its own rules. Check the program before counting it.' +
      (verify.length ? ' ' + verify.length + ' more (' + esc(verify.slice(0, 3).map(function (v) { return v.name; }).join(', ')) + ' and others) publish no screening amount.' : '') + '</p></section>';
  }

  // Each resale rule against three market cases: what the next buyer pays, what the owner walks away with, what the public gets back.
  function resaleTable(r) {
    var c = r.ownershipResale && r.ownershipResale.comparison;
    if (!c) return '<p class="note">The resale rules did not load.</p>';
    var subsidy = (global.OwnershipResale.SUBSIDY_TYPES || []).map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === c.subsidyType ? ' selected' : '') + '>' + esc(t.label) + '</option>'; }).join('');
    var mech = (c.options || []).map(function (o) { return '<option value="' + esc(o.id) + '"' + (o.id === c.selectedConventionId ? ' selected' : '') + (o.disabled ? ' disabled' : '') + '>' + esc(o.label + (o.disabled ? ' (not allowed)' : '')) + '</option>'; }).join('');
    var reasons = (c.options || []).filter(function (o) { return o.disabledReason; }).map(function (o) { return '<p class="callout"><strong>' + esc(o.label) + ':</strong> ' + esc(o.disabledReason) + '</p>'; }).join('');
    var body = c.rows.map(function (row) {
      var sel = row.conventionId === c.selectedConventionId;
      return '<tr class="' + (sel ? 'is-picked' : '') + (row.disabled ? ' is-off' : '') + '" data-resale-row="' + esc(row.conventionId) + '"><th scope="row">' + esc(row.label) + (sel ? ' <span class="pill">Picked</span>' : '') +
        '<small>' + esc(row.objective) + '</small>' + (row.sourceUrl ? '<small><a href="' + esc(row.sourceUrl) + '">' + esc(row.sourceProgram || 'Source') + ' ↗</a>' + (row.lastVerified ? ', checked ' + esc(row.lastVerified) : '') + '</small>' : '') + '</th>' +
        row.outcomes.map(function (o) {
          return '<td><span class="ro-price" data-value="' + (o.maxResalePrice == null ? '' : Math.round(o.maxResalePrice)) + '">' + esc(money(o.maxResalePrice)) + '</span>' +
            '<small>Owner’s equity ' + esc(money(o.ownerGrossEquity)) + '</small><small>Public gets back ' + esc(money(o.publicSubsidyRecaptured)) + '</small></td>';
        }).join('') + '</tr>';
    }).join('');
    return '<div class="field-grid sale-pickers"><label class="field">Public money in the home<select name="saleful:subsidy">' + subsidy + '</select><span class="hint">HOME funds limit which resale rules are allowed.</span></label>' +
      '<label class="field">Resale rule<select name="saleful:convention">' + mech + '</select><span class="hint">Set by the deed restriction or ground lease.</span></label></div>' + reasons +
      '<div class="table-scroll resale-table" role="region" aria-label="Resale rules compared" tabindex="0"><table><thead><tr><th scope="col">Rule</th>' +
      c.scenarios.map(function (sc) { return '<th scope="col">' + esc(sc.label) + '<small>Next buyer’s price</small></th>'; }).join('') + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="note">' + esc(c.caveat) + ' The rules are not ranked; each protects a different interest.</p>';
  }

  // How the buyer's price was figured, as labeled tiles from OwnershipFinance's own capacity output.
  function priceTiles(r) {
    var cap = global.OwnershipFinance.computeBuyerCapacity(r.ami4Person, r.targetAmiPct), A = cap && cap.assumptions || {}, M = global.OwnershipFinance.MORTGAGE_RATE || {};
    if (!cap) return '';
    var t = function (k, v) { return '<span class="tile"><small>' + esc(k) + '</small>' + esc(v) + '</span>'; };
    return '<div class="figured"><p><strong>How the buyer’s price is figured</strong></p><div class="tiles">' +
      t('Household income', money(cap.qualifyingIncome)) + '<span aria-hidden="true">→</span>' +
      t('Housing budget, ' + Math.round((A.frontEndRatio || 0) * 100) + '% of income', money(cap.monthlyBudget) + ' a month') + '<span aria-hidden="true">→</span>' +
      t('30-year loan at ' + ((A.rateAnnual || 0) * 100).toFixed(2) + '%', money(cap.maxLoan)) + '<span aria-hidden="true">+</span>' +
      t(Math.round((A.downPaymentRate || 0) * 100) + '% down and closing', money(cap.buyerCashRequired)) + '<span aria-hidden="true">=</span>' +
      t('Price', money(cap.maxPrice)) + '</div><p class="note">Income is HUD’s ' + esc(String(data.hud.meta && data.hud.meta.income_limits_fiscal_year || '')) + ' four-person median for the county (<a href="' +
      esc(data.hud.meta && data.hud.meta.url_il || 'https://www.huduser.gov/portal/datasets/il.html') + '">HUD</a>). The rate is ' + esc(M.source || 'Freddie Mac’s survey') + '. The budget covers the loan, tax, insurance and mortgage insurance.</p></div>';
  }

  function step(n, title, sub, body, done) {
    return '<section class="sale-step"><header><span class="sale-n' + (done ? ' is-done' : '') + '" aria-hidden="true">' + (done ? '✓' : n) + '</span><div><h2>' + esc(title) + '</h2><p>' + sub + '</p></div></header>' + body + '</section>';
  }
  function field(name, label, value, opts, note) {
    return '<label class="field">' + esc(label) + '<input name="' + name + '" type="number" inputmode="numeric"' + (opts || '') + ' value="' + esc(value == null || (typeof value === 'number' && !isFinite(value)) ? '' : String(value)) + '" placeholder="not entered">' + (note ? '<span class="hint">' + esc(note) + '</span>' : '') + '</label>';
  }

  function view() {
    var head = T.head({ kind: 'tool', crumbs: T.trail('deal', 'Homes for sale', [{ label: 'Deal Calculator', href: '#/deal-calculator' }]), title: 'Homes for sale',
      answer: 'Does a for-sale project close? What each home costs against the price a buyer at the target income can pay, what may fill the gap, and what the public keeps when the home resells.' });
    if (!Q()) return head;
    Q().load(); load();
    if (failed || Q().failed()) return head + '<p class="callout" role="status">The data did not load (' + esc(failed || Q().failed()) + ').</p>';
    if (!data || !Q().ready()) return head + '<p class="note" role="status">Loading the income limits, programs and resale rules…</p>';
    var s = quick(), bad = Q().problem(s), r = s.county && !bad ? run(s, x, data) : null, ok = r && r.status === 'ok';
    var counties = (data.hud.counties || []).slice().sort(function (a, b) { return String(a.county_name).localeCompare(String(b.county_name)); });
    var county = counties.filter(function (c) { return c.fips === s.county; })[0];
    var inputs = '<form class="homes sale-form" data-action="sale-full" novalidate>' +
      step(1, 'Homes and buyers', county ? esc(county.county_name) + ', ' + esc(s.units == null ? '?' : String(s.units)) + ' homes for buyers earning ' + esc(String(s.target)) + '% of median income' : 'Pick the county first.',
        '<div class="field-grid"><label class="field">County<select name="sale:county"><option value="">Pick a county</option>' + counties.map(function (c) {
          return '<option value="' + esc(c.fips) + '"' + (c.fips === s.county ? ' selected' : '') + '>' + esc(c.county_name) + '</option>';
        }).join('') + '</select><span class="hint">Sets the HUD median income.</span></label>' +
        field('sale:units', 'Homes', s.units, ' min="1" step="1"', 'Homes for sale in the project.') +
        '<label class="field">Sold to buyers earning<select name="sale:target">' + Q().TARGETS.map(function (t) { return '<option value="' + t + '"' + (t === s.target ? ' selected' : '') + '>' + t + '% of median income</option>'; }).join('') +
        '</select><span class="hint">The income cap in the deed restriction or the program.</span></label></div>', !!county) +
      step(2, 'Cost', (s.tdc > 0 ? esc(money(s.tdc)) : 'No cost yet') + ' to build' + (ok && r.tdcPerSf ? ', ' + esc(money(r.tdcPerSf)) + ' a square foot' : ''),
        '<div class="field-grid">' + field('sale:tdc', 'Total development cost ($)', s.tdc, ' min="0" step="100000"', 'Land, construction, soft costs and fee. From the budget or a contractor’s estimate.') +
        field('saleful:grossSf', 'Gross building area (SF), optional', x.grossSf, ' min="0" step="100"', 'All built space. Gives cost per square foot to compare against bids.') + '</div>', s.tdc > 0) +
      step(3, 'The owner over time', esc(x['dc-own-resale-years'] || '5') + ' years before the first resale',
        '<div class="field-grid">' + RESALE.map(function (i) { return field('saleful:' + i.id, i.label, x[i.id], (i.min ? ' min="' + i.min + '"' : '') + ' step="' + i.step + '"', i.note); }).join('') + '</div>', true) +
      '</form>';
    if (!ok) {
      var why = bad || (!s.county ? 'Pick a county to see the price a buyer can pay and the gap.' : r && r.status === 'missing-ami' ? 'HUD lists no median income for this county.' : 'Enter a cost above zero and at least one home.');
      return head + '<div class="sale-layout">' + inputs + '<aside class="sale-board"><p class="callout" role="' + (bad ? 'alert' : 'status') + '">' + esc(why) + '</p></aside></div>';
    }
    var pi = publicInterest(r.ownershipResale);
    var board = '<aside class="sale-board" aria-label="The deal at a glance">' + gapGraphic(s, r) +
      '<dl class="sale-facts"><div><dt>Cost a square foot</dt><dd>' + (r.tdcPerSf ? esc(money(r.tdcPerSf)) : '<span class="muted">Add the floor area</span>') + '</dd></div>' +
      (pi ? '<div><dt>At resale, ' + esc(pi.label) + '</dt><dd>' + (pi.outcome.maxResalePrice == null ? '<span class="muted">' + esc(pi.outcome.unavailableReason || 'Unavailable') + '</span>'
        : 'Next buyer pays up to <strong data-out="publicResalePrice" data-value="' + Math.round(pi.outcome.maxResalePrice) + '">' + esc(money(pi.outcome.maxResalePrice)) + '</strong>' +
          (pi.outcome.publicSubsidyRecaptured > 0 ? ', ' + esc(money(pi.outcome.publicSubsidyRecaptured)) + ' back to the public' : '')) + '<small>' + esc(pi.scenario || '') + ' market</small></dd></div>' : '') +
      '</dl>' + programList(s, r) + '</aside>';
    return head + '<div class="sale-layout">' + board + inputs + '</div>' + priceTiles(r) +
      '<section class="tool-section" aria-labelledby="sale-resale-h"><h2 id="sale-resale-h">When the home resells</h2><p>How each resale rule keeps the home affordable for the next buyer, after ' + esc(x['dc-own-resale-years'] || '5') + ' years, in a falling, steady and rising market.</p>' + resaleTable(r) + '</section>' +
      '<p class="note">Calculated by the COHO Deal Engine for homes for sale. Funding programs checked ' + esc(data.programs.meta && data.programs.meta.last_verified || '') + '. Screening only, not underwriting.</p>' +
      T.next('Next', [{ href: '#/for-sale', label: 'For-sale market study' }, { href: LIVE_TOOL, label: 'Every for-sale input on the full Deal Calculator ↗', secondary: true }, { href: '#/deal-calculator', label: 'Back to the Deal Calculator', secondary: true }]);
  }

  document.addEventListener('change', function (ev) {
    var t = ev.target, n = t && t.name;
    if (!n || n.indexOf('saleful:') !== 0) return;
    var k = n.slice(8);
    if (k === 'subsidy') x.subsidyType = t.value;
    else if (k === 'convention') x.conventionId = t.value;
    else x[k] = t.value;
    Shell.render();
    var again = document.querySelector('[name="' + n + '"]');
    if (again) again.focus();
  });

  Shell.views['sale-deal'] = view;
  global.LabSaleDeal = { RESALE: RESALE, build: build,
    _result: function () { var s = Q() && quick(); return data && s && s.county ? run(s, x, data) : null; },
    _set: function (o) { x = Object.assign(JSON.parse(JSON.stringify(START)), o); } };
})(window);
