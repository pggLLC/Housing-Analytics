// Quick estimate, homes for sale: county, total development cost, homes and the buyer's income target, with no
// project to set up. It answers what the live Deal Calculator's for-sale mode answers before anyone itemizes:
// the price a buyer at the target can pay (js/hna/ownership-finance.js at the pin, its default 30-year,
// 10%-down kernel), the cost per home, and the gap the Deal Engine's computeForSaleFeasibility finds between
// them. Inputs are built the way deal-calculator.js readOwnershipSources builds them. This file adds no arithmetic.
// qa/deal-quick-live.js runs the live calculator in for-sale mode on the same inputs and checks the figures agree.
(function (global) {
  'use strict';

  var Shell = global.LabShell;
  var esc = Shell.esc;
  var VENDOR = global.LAB_VENDOR;
  var LIVE_TOOL = 'https://cohoanalytics.com/deal-calculator.html';
  // The live page's for-sale starting point: its example $20M budget, 60 homes, sold to buyers at 80% of area median income.
  var TARGETS = [80, 100, 110, 120];
  var START = { county: '', tdc: 20000000, units: 60, target: 80 };
  var FILES = { hud: 'data/hud-fmr-income-limits.json', programs: 'data/policy/developer-ownership-funding.json' };

  var data = null, failed = null, asked = false;
  function load() {
    if (asked) return;
    asked = true;
    var keys = Object.keys(FILES);
    Promise.all(keys.map(function (k) { return fetch(VENDOR + FILES[k]).then(function (r) { if (!r.ok) throw new Error(FILES[k] + ' ' + r.status); return r.json(); }); }))
      .then(function (r) { data = {}; keys.forEach(function (k, i) { data[k] = r[i]; }); Shell.render(); })
      .catch(function (e) { failed = e.message; Shell.render(); });
  }

  function ami4(src, fips) {
    var c = (src.hud && src.hud.counties || []).filter(function (x) { return x.fips === fips; })[0];
    var il = c && c.income_limits;
    return il && il.ami_4person ? +il.ami_4person : NaN;
  }

  // What readOwnershipSources hands the engine: the price from the default affordability kernel (no model picked),
  // the developer funding programs, and no resale screen (the quick estimate does not show one).
  function build(s, src, OF) {
    var target = s.target / 100, a = ami4(src, s.county);
    var price = isFinite(a) && a > 0 ? OF.maxAffordablePrice(a, target, undefined) : null;
    return { tdc: s.tdc, units: s.units, grossSf: '', ami4Person: a, targetAmiPct: target, hasAffordablePriceHelper: true,
      maxAffordableSalePrice: price, developerFundingPrograms: (src.programs && src.programs.programs) || [], ownershipResale: null,
      countyFips: s.county || null };
  }
  function run(s, src) { return global.DealEngine.computeForSaleFeasibility(build(s, src, global.OwnershipFinance)); }

  var s = JSON.parse(JSON.stringify(START));
  function money(n) { return (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US'); }
  function card(key, label, v, sub) {
    return '<div data-out="' + key + '" data-value="' + Math.round(v) + '"><dt>' + esc(label) + '</dt><dd>' + esc(money(v)) + '</dd>' + (sub ? '<p class="why">' + sub + '</p>' : '') + '</div>';
  }

  // What is wrong with the cost or homes as entered, or null. A blank, zero, negative or part-home entry is not run.
  function problem(st) {
    var bad = [];
    if (!(isFinite(st.tdc) && st.tdc > 0)) bad.push(st.tdc == null ? 'Enter the total development cost.' : 'The total development cost must be above $0.');
    if (!(isFinite(st.units) && st.units >= 1 && Math.round(st.units) === st.units)) bad.push(st.units == null ? 'Enter the number of homes.' : 'Homes must be a whole number, 1 or more.');
    return bad.length ? bad.join(' ') : null;
  }
  function shown(v) { return v == null || !isFinite(v) ? '' : String(v); }

  function results() {
    var why = problem(s);
    if (why) return '<p class="callout quick-prompt" role="alert">' + esc(why) + '</p>';
    if (!s.county) return '<p class="note quick-prompt">Pick a county to see the price a buyer can pay and the gap.</p>';
    var r = run(s, data);
    if (!r || r.status !== 'ok') return '<p class="note quick-prompt">' + esc(r && r.status === 'missing-ami' ? 'HUD lists no median income for this county.' : 'Enter a cost above zero and at least one home.') + '</p>';
    var cap = global.OwnershipFinance.computeBuyerCapacity(r.ami4Person, r.targetAmiPct), A = cap && cap.assumptions || {}, M = global.OwnershipFinance.MORTGAGE_RATE || {};
    var gap = r.subsidyGapPerUnit > 0;
    var out = '<dl class="quick-out" aria-live="polite">' +
      card('tdcPerUnit', 'Cost per home', r.tdcPerUnit, esc(money(s.tdc)) + ' over ' + s.units + ' homes.') +
      card('maxAffordableSalePrice', 'Price a buyer at ' + s.target + '% can pay', r.maxAffordableSalePrice, 'A household of four earning ' + esc(money(r.ami4Person * r.targetAmiPct)) + ' a year.') +
      (gap ? card('subsidyGapPerUnit', 'Gap per home', r.subsidyGapPerUnit, 'Cost per home less the price.')
        : card('surplusPerUnit', 'Room per home', r.surplusPerUnit, 'The price covers the cost per home.')) +
      card('totalSubsidyGap', 'Total gap', r.totalSubsidyGap, gap ? 'For all ' + s.units + ' homes.' : 'No subsidy needed at this cost.') +
      '</dl>';
    out += '<p class="note">The price assumes a 30-year loan at ' + esc(((A.rateAnnual || 0) * 100).toFixed(2)) + '% (' + esc(M.source || 'Freddie Mac PMMS') + '), ' +
      esc(String(Math.round((A.downPaymentRate || 0) * 100))) + '% down, and housing costs (loan, tax, insurance and mortgage insurance) held to ' +
      esc(String(Math.round((A.frontEndRatio || 0) * 100))) + '% of income. Income is HUD’s ' + esc(String(data.hud.meta && data.hud.meta.income_limits_fiscal_year || '')) +
      ' four-person median for the county (<a href="' + esc(data.hud.meta && data.hud.meta.url_il || 'https://www.huduser.gov/portal/datasets/il.html') + '">HUD</a>).</p>';
    var stack = r.developerFundingStack || {}, apply = (stack.appliedSources || []).filter(function (p) { return p.appliedAmountPerUnit > 0; });
    if (gap && apply.length) {
      out += '<h3>Programs that may cover part of the gap</h3><p class="note">Screening only. Each has its own eligibility, and none is an award; check the program before counting it.</p><ul class="quick-programs">' +
        apply.map(function (p) {
          var def = (data.programs.programs || []).filter(function (x) { return x.id === p.id; })[0] || {};
          return '<li><a href="' + esc(p.sourceUrl) + '">' + esc(p.name) + ' ↗</a>' + (def.jurisdiction_scope ? ' (' + esc(def.jurisdiction_scope) + ')' : '') +
            ': ' + esc(money(p.appliedAmountPerUnit)) + ' a home counted. <span class="hint">' + esc(p.note || '') + '</span></li>';
        }).join('') + '</ul>';
    }
    if (gap) out += '<p class="quick-left">Still to find after these programs: <strong data-out="residualGapPerUnit" data-value="' + Math.round(stack.residualGapPerUnit || 0) + '">' +
      esc(money(stack.residualGapPerUnit)) + '</strong> a home.</p>' + (stack.outsideSources || []).map(function (p) {
        return '<p class="note" data-outside-county="' + esc(p.id) + '">' + esc(p.name) + ': ' + esc(p.reason) + (p.jurisdictionScope ? ' (' + esc(p.jurisdictionScope) + ' only)' : '') + '; not counted.</p>';
      }).join('');
    var verify = stack.verifySources || [];
    if (gap && verify.length) out += '<p class="note">' + verify.length + ' more sources (Prop 123, FHLBank, USDA, local fee waivers and others) have no screening amount; the <a href="' + LIVE_TOOL + '">live calculator ↗</a> lists them.</p>';
    return out;
  }

  function view() {
    load();
    if (failed) return '<p class="note" role="status">The data did not load (' + esc(failed) + ').</p>';
    if (!data) return '<p class="note quick-prompt">Loading the income limits…</p>';
    var counties = (data.hud.counties || []).slice().sort(function (a, b) { return String(a.county_name).localeCompare(String(b.county_name)); });
    return '<form class="homes" data-action="quick-sale" novalidate><div class="field-grid">' +
      '<label class="field">County<select name="sale:county"><option value="">Pick a county</option>' + counties.map(function (c) {
        return '<option value="' + esc(c.fips) + '"' + (c.fips === s.county ? ' selected' : '') + '>' + esc(c.county_name) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="field">Total development cost ($)<input name="sale:tdc" type="number" min="0" step="100000" inputmode="numeric" value="' + esc(shown(s.tdc)) + '"' + (isFinite(s.tdc) && s.tdc > 0 ? '' : ' aria-invalid="true"') + '></label>' +
      '<label class="field">Homes<input name="sale:units" type="number" min="1" step="1" inputmode="numeric" value="' + esc(shown(s.units)) + '"' + (isFinite(s.units) && s.units >= 1 && Math.round(s.units) === s.units ? '' : ' aria-invalid="true"') + '></label>' +
      '<label class="field">Sold to buyers earning<select name="sale:target">' + TARGETS.map(function (t) {
        return '<option value="' + t + '"' + (t === s.target ? ' selected' : '') + '>' + t + '% of median income</option>';
      }).join('') + '</select></label></div></form>' + results() +
      '<p class="note">A screening estimate, not underwriting.</p>' +
      '<div class="actions"><a class="button-link" href="#/sale-deal">Every line: floor area, resale rules and funding</a></div>';
  }

  document.addEventListener('change', function (ev) {
    var t = ev.target, n = t && t.name;
    if (!n || n.indexOf('sale:') !== 0) return;
    if (n === 'sale:county') s.county = t.value;
    // A cleared or invalid entry stays as typed and the results say what is missing; nothing is quietly restored.
    else if (n === 'sale:tdc') s.tdc = t.value === '' ? null : Number(t.value);
    else if (n === 'sale:units') s.units = t.value === '' ? null : Number(t.value);
    else if (n === 'sale:target') { var g = Number(t.value); if (TARGETS.indexOf(g) !== -1) s.target = g; }
    Shell.render();
  });

  // The full for-sale screen (sale-deal.js) shares these answers, so a reader moves between the two without retyping.
  global.LabDealQuickSale = { view: view, build: build, ami4: ami4, TARGETS: TARGETS, START: START, load: load,
    state: function () { return s; }, problem: problem, ready: function () { return !!data; }, failed: function () { return failed; },
    _result: function () { return data && s.county ? run(s, data) : null; },
    _set: function (o) { s = Object.assign(JSON.parse(JSON.stringify(START)), o); } };
})(window);
