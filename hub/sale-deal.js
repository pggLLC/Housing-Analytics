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
    { id: 'dc-own-resale-principal', label: 'Loan balance left at resale ($)', value: '', step: '1000', min: '0', note: 'From the buyer’s loan amortization schedule at that year. Enter 0 if the home is paid off; blank leaves owner’s equity unshown.' },
    { id: 'dc-own-resale-costs', label: 'Selling costs ($)', value: '', step: '1000', min: '0', note: 'Commission and closing costs at resale, from a local broker. Enter 0 if none; blank leaves owner’s equity unshown.' },
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
    var known = function (id) { var v = ext[id]; if (v == null || String(v).trim() === '') return null; var n = parseFloat(v); return isFinite(n) ? n : null; };
    var resale = null;
    if (OR && typeof OR.evaluateAll === 'function') {
      var purchase = price != null && isFinite(price) && price > 0 ? price : null;
      var base = {
        purchasePrice: purchase,
        unavailableReason: purchase == null ? 'A positive purchase price is unavailable; resale price and owner equity cannot be calculated.' : null,
        // A blank loan balance or selling cost stays unknown, not $0 (Codex launch audit B3), as in deal-calculator.js.
        holdingPeriodYears: num('dc-own-resale-years', 5), remainingPrincipal: known('dc-own-resale-principal'),
        sellingCosts: known('dc-own-resale-costs'), marketAppreciation: num('dc-own-resale-appreciation', 0),
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
    // A program with a rule but no amount this screen can confirm is named with its rule, not counted (CHFA buyer
    // assistance: its amount depends on the buyer's CHFA product, first mortgage and eligibility; Codex audit B2).
    var ruled = (st.verifySources || []).filter(function (v) { return v.displayAmount && v.displayAmount !== 'VERIFY'; });
    outside += ruled.map(function (p) {
      return '<li data-not-counted="' + esc(p.id) + '"><a href="' + esc(p.sourceUrl) + '">' + esc(p.name) + ' ↗</a>: ' + esc(p.displayAmount) + '.</li>';
    }).join('');
    var verify = (st.verifySources || []).filter(function (v) { return ruled.indexOf(v) === -1; });
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
            (o.priceNote ? '<small data-resale-price-note title="' + esc(o.priceNote) + '">before selling costs (blank)</small>' : '') +
            '<small>Owner’s equity ' + esc(o.ownerGrossEquity == null && o.maxResalePrice != null ? 'not shown' : money(o.ownerGrossEquity)) + '</small>' +
            '<small>Public gets back ' + esc(o.publicSubsidyRecaptured == null && o.maxResalePrice != null ? 'not shown' : money(o.publicSubsidyRecaptured)) + '</small></td>';
        }).join('') + '</tr>';
    }).join('');
    return '<div class="field-grid sale-pickers"><label class="field">Public money in the home<select name="saleful:subsidy">' + subsidy + '</select><span class="hint">HOME funds limit which resale rules are allowed.</span></label>' +
      '<label class="field">Resale rule<select name="saleful:convention">' + mech + '</select><span class="hint">Set by the deed restriction or ground lease.</span></label></div>' + reasons +
      '<div class="table-scroll resale-table" role="region" aria-label="Resale rules compared" tabindex="0"><table><thead><tr><th scope="col">Rule</th>' +
      c.scenarios.map(function (sc) { return '<th scope="col">' + esc(sc.label) + '<small>Next buyer’s price</small></th>'; }).join('') + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      (c.equityNote ? '<p class="callout" role="note" data-resale-equity-note>' + esc(c.equityNote) + '</p>' : '') +
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

  // The Deal Calculator's for-sale mode hands its deal here: "Continue in Homes for sale" under the calculator
  // (js/components/calc-financials-link.js) and a for-sale link opened on #/open-calc both arrive as
  // #/sale-deal?v=1&mode-rental=ownership&..., in the calculator's own share-link format (js/deal-calculator-share.js:
  // each box by its id less "dc-"). Each box this screen has is filled once from the link, the place becomes the working
  // place, and every other box the link carries is named: it stays on the calculator, which the link reopens. Nothing
  // is saved. Before 24 Nov 2026 the link opened Financials, which works rental deals only, and stopped there.
  var CARRIED = { 'county-select': 'county', tdc: 'cost', units: 'homes', 'sale-target-ami': 'buyer income', 'gross-sf': 'floor area',
    'own-resale-years': 'resale', 'own-resale-principal': 'resale', 'own-resale-costs': 'resale', 'own-resale-appreciation': 'resale',
    'resale-subsidy': 'resale', 'resale-mechanism': 'resale' };
  var LINK_ONLY = { v: 1, 'mode-rental': 1, from: 1, geoid: 1, g: 1, subject: 1, inputProvenance: 1, tr: 1, rentSchedule: 1, utilityAllowance: 1 };
  var GEO = /^08\d{3}(\d{2})?$/;
  var opened = null;
  function fromLink(params) {
    if (!params || params.get('v') !== '1' || params.get('mode-rental') !== 'ownership') return null;
    // The key leaves out g, the working place this screen adds to the address, so the link is read once and later
    // edits on this screen are kept.
    var bare = new URLSearchParams(params.toString()); bare.delete('g');
    var key = bare.toString();
    if (opened && opened.key === key) return opened;
    // A new link starts from the starting values, so a box this link leaves out (the calculator's link omits a blank
    // box) never keeps the last link's entry (Codex review of HA #2991). A redraw of the same link keeps edits (above).
    var s = quick(), got = {}, notes = [], unread = [];
    var base = JSON.parse(JSON.stringify(Q().START));
    Object.keys(base).forEach(function (k) { s[k] = base[k]; });
    x = JSON.parse(JSON.stringify(START));
    var counties = data.hud.counties || [];
    var fips = String(params.get('county-select') || '');
    var county = counties.filter(function (c) { return c.fips === fips; })[0];
    if (county) { s.county = fips; got.county = 1; } else if (fips) notes.push('The link’s county (' + fips + ') is not in the HUD income limits, so no county is set.');
    // A cost or homes entry is kept as the link has it, so a blank or invalid one is named in the results, not replaced.
    if (params.has('tdc')) { s.tdc = params.get('tdc') === '' ? null : Number(params.get('tdc')); got.cost = 1; }
    if (params.has('units')) { s.units = params.get('units') === '' ? null : Number(params.get('units')); got.homes = 1; }
    if (params.has('sale-target-ami')) {
      var t = Number(params.get('sale-target-ami'));
      if (Q().TARGETS.indexOf(t) !== -1) { s.target = t; got['buyer income'] = 1; }
      else notes.push('The link’s buyer income (' + params.get('sale-target-ami') + '% of median) is not one this screen offers, so it stays at ' + s.target + '%.');
    }
    if (params.has('gross-sf')) { x.grossSf = params.get('gross-sf'); got['floor area'] = 1; }
    RESALE.forEach(function (i) { var k = i.id.replace(/^dc-/, ''); if (params.has(k)) { x[i.id] = params.get(k); got.resale = 1; } });
    // The resale pickers use the same OwnershipResale ids on both pages (js/deal-calculator-share.js sends them).
    if (params.get('resale-subsidy')) { x.subsidyType = params.get('resale-subsidy'); got.resale = 1; }
    if (params.get('resale-mechanism')) { x.conventionId = params.get('resale-mechanism'); got.resale = 1; }
    params.forEach(function (v, k) { if (!CARRIED[k] && !LINK_ONLY[k] && v !== '' && unread.indexOf(k) < 0) unread.push(k); });
    // The place: the town or county the calculator was on (its geoid), else the link's county. A town keeps its own
    // name; when the town list has not loaded, the working place looks the name up itself.
    var geoid = String(params.get('geoid') || '');
    var place = GEO.test(geoid) ? geoid : county ? fips : '';
    var label = place === fips && county ? String(county.county_name || '') : '';
    if (place && place.length === 7) {
      var town = global.LabDealTown && global.LabDealTown.lookup ? global.LabDealTown.lookup(place) : null;
      if (town && town.name) label = town.name;
    }
    if (place && global.LabDealQuick && global.LabDealQuick.adopt) global.LabDealQuick.adopt(place, label);
    var back = new URLSearchParams(key); back.delete('from');
    opened = { key: key, got: Object.keys(got), notes: notes, unread: unread, back: LIVE_TOOL.split('?')[0] + '#' + back.toString() };
    return opened;
  }
  function linkNote(o) {
    if (!o) return '';
    var list = o.got.length ? o.got.join(', ').replace(/, ([^,]*)$/, ' and $1') : 'nothing this screen uses';
    return '<div class="sale-from-link" data-from-calc="1"><p class="callout" role="status">Opened from the Deal Calculator’s for-sale mode with its ' + esc(list) + (o.got.indexOf('resale') >= 0 ? ' inputs' : '') + '. Nothing is saved.</p>' +
      o.notes.map(function (n) { return '<p class="callout">' + esc(n) + '</p>'; }).join('') +
      (o.unread.length ? '<details class="calc-unread"><summary>' + esc(String(o.unread.length)) + ' boxes from the calculator this screen does not use</summary><p class="note">They stay on the Deal Calculator: ' + esc(o.unread.join(', ')) + '. <a href="' + esc(o.back) + '">Reopen the calculator with every box ↗</a></p></details>' : '') +
      '</div>';
  }

  function view(params) {
    var head = T.head({ kind: 'tool', crumbs: T.trail('deal', 'Homes for sale', [{ label: 'Deal Calculator', href: '#/deal-calculator' }]), title: 'Homes for sale',
      answer: 'Does a for-sale project close? What each home costs against the price a buyer at the target income can pay, what may fill the gap, and what the public keeps when the home resells.' });
    if (!Q()) return head;
    Q().load(); load();
    if (failed || Q().failed()) return head + '<p class="callout" role="status">The data did not load (' + esc(failed || Q().failed()) + ').</p>';
    if (!data || !Q().ready()) return head + '<p class="note" role="status">Loading the income limits, programs and resale rules…</p>';
    var link = linkNote(fromLink(params));
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
      return head + link + '<div class="sale-layout">' + inputs + '<aside class="sale-board"><p class="callout" role="' + (bad ? 'alert' : 'status') + '">' + esc(why) + '</p></aside></div>';
    }
    var pi = publicInterest(r.ownershipResale);
    var board = '<aside class="sale-board" aria-label="The deal at a glance">' + gapGraphic(s, r) +
      '<dl class="sale-facts"><div><dt>Cost a square foot</dt><dd>' + (r.tdcPerSf ? esc(money(r.tdcPerSf)) : '<span class="muted">Add the floor area</span>') + '</dd></div>' +
      (pi ? '<div><dt>At resale, ' + esc(pi.label) + '</dt><dd>' + (pi.outcome.maxResalePrice == null ? '<span class="muted">' + esc(pi.outcome.unavailableReason || 'Unavailable') + '</span>'
        : 'Next buyer pays up to <strong data-out="publicResalePrice" data-value="' + Math.round(pi.outcome.maxResalePrice) + '">' + esc(money(pi.outcome.maxResalePrice)) + '</strong>' +
          (pi.outcome.priceNote ? ' before selling costs (blank)' : '') +
          (pi.outcome.publicSubsidyRecaptured > 0 ? ', ' + esc(money(pi.outcome.publicSubsidyRecaptured)) + ' back to the public' : '')) + '<small>' + esc(pi.scenario || '') + ' market</small></dd></div>' : '') +
      '</dl>' + programList(s, r) + '</aside>';
    return head + link + '<div class="sale-layout">' + board + inputs + '</div>' + priceTiles(r) +
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
    if (global.LabRedraw) return global.LabRedraw.after(Shell.render);
    Shell.render();
    var again = document.querySelector('[name="' + n + '"]');
    if (again) again.focus();
  });

  Shell.views['sale-deal'] = view;
  global.LabSaleDeal = { RESALE: RESALE, build: build,
    _result: function () { var s = Q() && quick(); return data && s && s.county ? run(s, x, data) : null; },
    _set: function (o) { x = Object.assign(JSON.parse(JSON.stringify(START)), o); opened = null; }, _ext: function () { return x; } };
})(window);
