// Quick estimate on the Deal Calculator's front page: county, total development cost, the credit rate and homes
// by income limit, with no project to set up. It answers the live page's "could this deal pencil?" panel with the
// public site's own Deal Engine at the pin, fed the way deal-calculator.html feeds it before anyone itemizes:
// its example cost budget scaled to the total (each line keeps its share), its example operating budget, its
// rate rule (10-year Treasury plus the stated spread) and its defaults. This file adds no deal arithmetic.
// qa/deal-quick.test.js runs the live page and this panel on the same inputs and checks the figures agree.
(function (global) {
  'use strict';

  var Shell = global.LabShell;
  var esc = Shell.esc;
  var VENDOR = global.LAB_VENDOR;
  var LIVE_TOOL = 'https://cohoanalytics.com/deal-calculator.html';

  var TIERS = [20, 30, 40, 50, 60, 70, 80];
  // The live panel's starting point: 60 homes, 15 each at 30, 40, 50 and 60% of area median income.
  // No one publishes a Colorado state credit price; this starting point is COHO's own estimate from Colorado tax credit
  // applications (the model sits behind the member gate). The reader replaces it with a syndicator's quote.
  var STATE_PRICE = 0.72;
  // Boost, state credit and soft funding start off, as on the live page; 'auto' turns the boost on for a county HUD lists as a DDA.
  // year is CHFA's credit year, sent to the engine as the live page's dc-qap-year. It starts at the live page's own
  // default, 2027, and is always passed: the engine's blank-year fallback differs by rule (2026 for the fall bond window).
  var YEARS = [['2027', '2027 (2027-2028 plan)'], ['2028', '2028 (2027-2028 plan)'], ['2026', '2026 (2025-2026 plan)']];
  var START = { county: '', place: '', tdc: 20000000, credit: '9', year: '2027', tiers: { 20: 0, 30: 15, 40: 15, 50: 15, 60: 15, 70: 0, 80: 0 },
    boost: 'auto', zip: '', chfaPct: 30, fedPrice: null, state: { on: false, path: 'bond_fall', annual: 0, price: STATE_PRICE }, soft: {},
    // The basic pro forma's inputs (paul 11-05). mix 'market' sizes the homes to the county's qualified renters; land and
    // opexMonth null keep the example budget's figures; util 'owner' means no utility allowance; terms are the lender and
    // investor fold, each blank until typed, so the live page's defaults stand.
    mix: 'market', land: null, opexMonth: null, util: 'owner', ua: {}, terms: {} };
  var SIZES = ['1br', '2br', '3br'];
  var SIZE_LABEL = { '1br': '1-bedroom', '2br': '2-bedroom', '3br': '3-bedroom' };

  // Gap sources a Colorado tax credit deal draws on, with each program's published limit from soft-funding-status.json.
  // Each is entered as a loan repaid from sale or refinance, at the program's published rate where there is one.
  var SOFT = [
    { k: 'p123', id: 'PROP123-LIHTC-GAP', program: 'prop123', label: 'Prop 123 LIHTC Gap Finance (OEDIT)' },
    { k: 'doh', id: 'DOH-HDG', program: 'other', label: 'DOH Housing Development Grant' },
    { k: 'cmf', id: 'CHFA-CMF', program: 'chfa_cmf', label: 'CHFA Capital Magnet Fund' },
    { k: 'hof', id: 'CHFA-HOF', program: 'other', label: 'CHFA Housing Opportunity Fund' },
    { k: 'local', id: null, program: 'local_pha', label: 'City, county or housing authority' }
  ];
  function softCap(def, softDoc, tdc) {
    var p = def.id && softDoc && softDoc.programs && softDoc.programs[def.id], r = p && p.max_rule || {};
    var caps = [r.max_amount || p && p.maxPerProject, r.max_project_cost_pct ? tdc * r.max_project_cost_pct / 100 : null].filter(function (v) { return v > 0; });
    return { max: caps.length ? Math.floor(Math.min.apply(null, caps)) : null, min: r.min_amount || null, rate: p && p.rate_pct != null ? p.rate_pct : 0,
      rule: r.text || null, url: p && p.source_url || null };
  }
  // The county's place on HUD's 2026 lists: a nonmetro county DDA, its Small Area DDA ZIP codes (metro), and its QCT count.
  function designations(src, fips) {
    var feats = (src.dda && src.dda.features || []).map(function (f) { return f.properties || {}; });
    var county = feats.filter(function (p) { return p.DDA_KIND === 'county' && p.GEOID === fips; })[0] || null;
    var zips = feats.filter(function (p) { return p.DDA_KIND === 'zip' && p.ZCTA5; }).map(function (p) { return String(p.ZCTA5); });
    var qcts = (src.qct && src.qct.features || []).filter(function (f) { return f.properties && fips && ('08' + f.properties.COUNTY) === fips; }).length;
    return { year: src.dda && src.dda.designationYear || null, county: county, zips: zips, qcts: qcts };
  }
  // The designation and evidence sent to the engine, or none with the reason.
  function boostFor(q, src) {
    var d = designations(src, q.county), year = d.year || '';
    var pick = q.boost === 'auto' ? (d.county ? 'dda' : 'none') : q.boost;
    if (pick === 'dda') return d.county ? { designation: 'dda', evidence: 'HUD ' + year + ' DDA list: ' + d.county.NAME + ' (nonmetro county)' }
      : { designation: 'none', note: 'This county is not on HUD’s ' + year + ' DDA list.' };
    if (pick === 'sadda') {
      var z = String(q.zip || '').trim();
      return d.zips.indexOf(z) !== -1 ? { designation: 'sadda', evidence: 'HUD ' + year + ' Small Area DDA list: ZIP ' + z }
        : { designation: 'none', note: z ? 'ZIP ' + z + ' is not a ' + year + ' Small Area DDA.' : 'Enter the site’s ZIP code.' };
    }
    if (pick === 'qct') return { designation: 'qct', evidence: 'Site in a HUD ' + year + ' Qualified Census Tract (checked on HUD’s map)' };
    if (pick === 'chfa') return { designation: 'chfa', evidence: 'CHFA basis boost letter (assumed for screening)', pct: q.chfaPct };
    return { designation: 'none' };
  }
  // A CHFA limit for one credit year, read the way the engine reads it (deal-cost-basis.js capStatus): a rule with
  // by_year has that year's amounts or none; a rule without by_year applies in every year. null means no limit that year.
  function yearRule(rules, key, year) {
    var r = rules && rules.rules && rules.rules[key];
    if (!r) return null;
    if (!r.by_year) return r;
    var e = Object.prototype.hasOwnProperty.call(r.by_year, String(year)) ? r.by_year[String(year)] : null;
    return e ? Object.assign({}, r, e) : null;
  }
  var STATE_KEY = { with_9pct: 'credit_cap_state_with_9pct', round_two: 'credit_cap_state_round_two_accelerated', bond_fall: 'credit_cap_state_with_4pct' };
  function statePath(q) { return q.credit === '9' ? 'with_9pct' : q.state.path; }
  // CHFA's annual state credit limit for the path in the chosen credit year, from the underwriting rules (QAP 3.L).
  function stateCap(q, rules, units) {
    var c = yearRule(rules, STATE_KEY[statePath(q)], q.year || START.year);
    if (!c) return null;
    if (q.credit === '9') return c.fixed_annual || null;
    return c.annual_cap_per_unit ? Math.min(c.annual_cap, c.annual_cap_per_unit * units) : c.annual_cap;
  }
  // Why a path has no limit in the chosen year (the rule's own ends_reason), or null when it has one.
  function stateGone(q, rules) {
    var key = STATE_KEY[statePath(q)], r = rules && rules.rules && rules.rules[key];
    if (!r || yearRule(rules, key, q.year || START.year)) return null;
    return 'CHFA has no limit for this application in ' + (q.year || START.year) + '.' + (r.ends_reason ? ' ' + r.ends_reason : '');
  }
  // The Round Two accelerated limit for the chosen CHFA year, for the option label.
  function roundTwoCap(rules, year) {
    var c = yearRule(rules, 'credit_cap_state_round_two_accelerated', year || START.year);
    return c ? c.annual_cap : null;
  }
  var OUTPUTS = [['annualCredits', 'Annual federal credit'], ['equity', 'Credit equity'], ['mortgage', 'First mortgage'], ['gap', 'Funding gap']];

  var FILES = { chfa: 'data/chfa-income-rent-limits-2026.json', hud: 'data/hud-fmr-income-limits.json', equity: 'data/market/novogradac-equity-pricing.json',
    rules: 'data/policy/lihtc-underwriting-rules.json', fred: 'data/fred-data.json', assumptions: 'data/policy/lihtc-assumptions.json',
    dda: 'data/dda-colorado.json', qct: 'data/qct-colorado.json', soft: 'data/policy/soft-funding-status.json',
    demand: 'data/market/chfa_renter_demand_co.json',
    // As the live Market Analysis passes them to the capture engine (QA 11-09): ACS renter counts per tract, B25009 sizes.
    acs: 'data/market/acs_tract_metrics_co.json', sizes: 'data/market/acs_tract_renter_household_size_co.json' };
  var engineOpts = null;
  function liveOpts(src) {
    if (engineOpts && engineOpts.from === src) return engineOpts.o;
    var idx = {}; ((src.acs && src.acs.tracts) || []).forEach(function (m) { idx[m.geoid] = m; });
    engineOpts = { from: src, o: { acsIdx: Object.keys(idx).length ? idx : null, sizeIdx: src.sizes && src.sizes.tracts ? src.sizes.tracts : null } };
    return engineOpts.o;
  }
  var data = null, failed = null, asked = false;
  function load() {
    if (asked) return;
    asked = true;
    var keys = Object.keys(FILES);
    Promise.all(keys.map(function (k) { return fetch(VENDOR + FILES[k]).then(function (r) { if (!r.ok) throw new Error(FILES[k] + ' ' + r.status); return r.json(); }); }))
      .then(function (r) { data = {}; keys.forEach(function (k, i) { data[k] = r[i]; }); Shell.render(); })
      .catch(function (e) { failed = e.message; Shell.render(); });
  }

  // The live page's permanent rate before anyone types one: the latest 10-year Treasury plus the spread in
  // lihtc-assumptions.json, to two decimals. Null when either is missing, and the lab's 6.5% default stands.
  function permRate(fred, assumptions) {
    var s = fred && fred.series && fred.series.DGS10, obs = s && (s.observations || s.data), t10 = null;
    for (var i = Array.isArray(obs) ? obs.length - 1 : -1; i >= 0; i--) {
      var raw = obs[i] && obs[i].value;
      if (raw == null || raw === '' || raw === '.') continue;
      var n = Number(raw);
      if (isFinite(n) && n > 0) { t10 = { value: n, date: obs[i].date || null }; break; }
    }
    var a = assumptions && assumptions.permRateSpreadOverTreasury, spread = a && isFinite(a.spreadPct) && a.spreadPct >= 0 ? a.spreadPct : null;
    return t10 && spread != null ? { rate: (t10.value + spread).toFixed(2), t10: t10, spread: spread } : null;
  }

  // The example budget's lines with every amount, basis part and use scaled to `total`, rounded, and the
  // rounding left over put on the largest line, as the live panel's scaleCosts does.
  // A land cost given (0 or more, below the total) replaces the example's land line, and the other lines share the rest.
  function scaledLines(B, total, land) {
    var lines = B.exampleLines().map(function (l) { return Object.assign({}, l); });
    var amt = function (l) { return l.amount == null ? 0 : Number(l.amount); };
    var setLand = land != null && isFinite(land) && land >= 0 && land < total;
    var rest = lines.filter(function (l) { return !(setLand && l.id === 'land'); });
    var from = rest.reduce(function (s, l) { return s + (amt(l) > 0 ? amt(l) : 0); }, 0);
    var to = setLand ? total - Math.round(land) : total;
    var k = from > 0 && to > 0 ? to / from : 1;
    rest.forEach(function (l) {
      ['amount', 'eligibleAmount', 'used'].forEach(function (f) { if (l[f] != null) l[f] = Math.round(Number(l[f]) * k); });
    });
    if (setLand) lines.forEach(function (l) { if (l.id === 'land') l.amount = Math.round(land); });
    var left = Math.round(total) - lines.reduce(function (s, l) { return s + (amt(l) > 0 ? amt(l) : 0); }, 0);
    var big = rest.filter(function (l) { return l.amount != null; }).reduce(function (a, b) { return amt(b) > amt(a) ? b : a; });
    if (left && big) big.amount += left;
    // Sent as the live page reads them off its fields: text, and null for a blank.
    return lines.map(function (l) {
      var o = { id: l.id, label: l.label, group: l.group, basis: l.basis, amount: l.amount == null ? null : String(l.amount) };
      if (l.basis === 'partial') o.eligibleAmount = l.eligibleAmount == null ? null : String(l.eligibleAmount);
      if (B.CONTINGENCY_KINDS[l.id]) o.used = l.used == null ? null : String(l.used);
      return o;
    });
  }

  // The example operating budget with every line scaled to `perYear` a home, rounded, the rounding put on the largest
  // line, as a reader would retype the live page's lines to a new total. Null keeps the example as it is.
  function scaledOpex(OB, perYear) {
    var ex = OB.EXAMPLE_BUDGET, ids = OB.LINE_TEMPLATE.map(function (t) { return t.id; });
    var from = ids.reduce(function (s, id) { return s + (ex[id] > 0 ? ex[id] : 0); }, 0);
    var out = {};
    if (perYear == null || !(from > 0)) { ids.forEach(function (id) { out[id] = ex[id]; }); return out; }
    var k = perYear / from;
    ids.forEach(function (id) { out[id] = ex[id] == null ? null : Math.round(ex[id] * k); });
    var left = Math.round(perYear) - ids.reduce(function (s, id) { return s + (out[id] > 0 ? out[id] : 0); }, 0);
    var big = ids.reduce(function (a, b) { return (ex[b] || 0) > (ex[a] || 0) ? b : a; });
    out[big] += left;
    return out;
  }

  // Homes split over sizes by weight, largest remainder first, so the counts add up to n.
  function splitHomes(n, w) {
    var tot = SIZES.reduce(function (s, b) { return s + (w[b] > 0 ? w[b] : 0); }, 0), out = {};
    if (!(n > 0) || !(tot > 0)) return null;
    var rem = SIZES.map(function (b) { var x = n * (w[b] > 0 ? w[b] : 0) / tot; out[b] = Math.floor(x); return [b, x - out[b]]; });
    var left = n - SIZES.reduce(function (s, b) { return s + out[b]; }, 0);
    rem.sort(function (a, b) { return b[1] - a[1] || SIZES.indexOf(a[0]) - SIZES.indexOf(b[0]); });
    for (var i = 0; i < left; i++) out[rem[i][0]]++;
    return out;
  }
  // The bedroom mix the county's market supports at each income limit: renter households who qualify for a tax credit
  // home at that limit, counted the CHFA market-study way by the public site's own engine
  // (PMAMarketScoring.chfaQualifiedRenters, js/market-analysis-scoring.js; whole county, 1 to 3 bedrooms, the guide's
  // default sizes), run once for each size on its own, as a market study counts demand by unit type: each size is
  // weighted by the renters who fit it, qualify at the limit and can pay its rent. A household that fits two sizes counts
  // for both. Only the resulting home counts are shown; the counts behind them belong to the member Market Analysis.
  var mixCache = {};
  function marketMix(q, src, E) {
    var tiers = TIERS.filter(function (t) { return q.tiers[t] > 0; });
    // A town whose renter figures hold (deal-town.js) counts its own tracts, each by its share inside the town.
    var T = global.LabDealTown, townTracts = T && q.place ? T.mixTracts(q.place, q.county) : null;
    var key = q.county + '|' + (townTracts ? q.place : '') + '|' + tiers.join(',');
    if (mixCache[key] !== undefined) return mixCache[key];
    if (!E || !E.chfaQualifiedRenters || !src.demand || !q.county || !tiers.length) return null;
    var limits = {}; (src.chfa.counties || []).forEach(function (c) { limits[c.fips] = c; });
    var tracts = townTracts || Object.keys(src.demand.tracts || {}).filter(function (g) { return g.slice(0, 5) === q.county; }).map(function (g) { return { geoid: g }; });
    var runs = SIZES.map(function (b) { return E.chfaQualifiedRenters(src.demand, limits, tracts, tiers, [b], liveOpts(src)); });
    if (runs.some(function (r) { return r.value == null; })) return (mixCache[key] = null);
    var byTier = {}, all = { '1br': 0, '2br': 0, '3br': 0 };
    tiers.forEach(function (t) {
      var w = {};
      SIZES.forEach(function (b, i) { w[b] = runs[i].byTier[t] > 0 ? runs[i].byTier[t] : 0; all[b] += w[b]; });
      byTier[t] = w;
    });
    var out = {};
    tiers.forEach(function (t) { out[t] = splitHomes(Math.round(q.tiers[t]), byTier[t]) || splitHomes(Math.round(q.tiers[t]), all); });
    return (mixCache[key] = tiers.every(function (t) { return out[t]; }) ? out : null);
  }
  // Homes of each size across the deal, for the note under the picker.
  function sizeTotals(q, mix) {
    var tot = { '1br': 0, '2br': 0, '3br': 0 };
    TIERS.forEach(function (t) {
      var n = q.tiers[t] > 0 ? Math.round(q.tiers[t]) : 0;
      if (!n) return;
      if (mix && mix[t]) SIZES.forEach(function (b) { tot[b] += mix[t][b]; });
      else tot[SIZES.indexOf(q.mix) > -1 ? q.mix : '2br'] += n;
    });
    return tot;
  }
  // The utility allowance sent to the engine: only when renters pay and an allowance is typed for every size in the deal.
  function allowanceFor(q, sizes) {
    if (q.util !== 'renter') return { applied: false, reason: 'allowance_reference_missing' };
    var used = SIZES.filter(function (b) { return sizes[b] > 0; });
    if (used.some(function (b) { return !(q.ua[b] >= 0 && q.ua[b] !== '' && q.ua[b] != null); })) return { applied: false, reason: 'allowance_entered_incomplete' };
    var per = { efficiency: null, '1BR': null, '2BR': null, '3BR': null, '4BR': null }, fees = { efficiency: 0, '1BR': 0, '2BR': 0, '3BR': 0, '4BR': 0 };
    used.forEach(function (b) { per[{ '1br': '1BR', '2br': '2BR', '3br': '3BR' }[b]] = Number(q.ua[b]); });
    return { applied: true, reason: null, source: 'shared', countyFips: q.county, perBedroom: per, feesPerBedroom: fees,
      basis: { method: 'entered', reference: 'Typed on the quick estimate from the local housing authority schedule', effectiveDate: null } };
  }

  // What deal-calculator.html's readDealInputs() hands DealEngine.computeDeal for a rental deal priced from its
  // own unit grid (no rent schedule, no utility allowance on file), with the quick estimate's five answers.
  function build(q, src, mods) {
    var F = mods.LabFinancials, C = mods.ChfaRentLimits, B = mods.DealCostBasis, OB = mods.DealOperatingBudget;
    q = Object.assign({ mix: '2br', land: null, opexMonth: null, util: 'owner', ua: {}, terms: {} }, q);
    var mix = q.mix === 'market' ? marketMix(q, src, mods.PMAMarketScoring) : null;
    var fips = q.county, credit = q.credit === '4' ? '4' : '9';
    var units = TIERS.reduce(function (s, t) { return s + (q.tiers[t] > 0 ? Math.round(q.tiers[t]) : 0); }, 0);
    var fields = {};
    F.INPUTS.forEach(function (i) { fields[i.id] = i.value; });
    var rate = permRate(src.fred, src.assumptions);
    if (rate) fields['dc-rate'] = rate.rate;
    fields['dc-tdc'] = String(Math.round(q.tdc));
    fields['dc-credit'] = credit;
    // The credit year, always sent, so the engine never falls back to a rule's own default year.
    fields['dc-qap-year'] = YEARS.some(function (y) { return y[0] === String(q.year); }) ? String(q.year) : START.year;
    fields['dc-mode-rental'] = true; fields['dc-mode-ownership'] = false;
    fields['dc-rate-9'] = credit === '9'; fields['dc-rate-4'] = credit === '4';
    fields['dc-units'] = String(units);
    fields['dc-vacancy'] = '7';
    fields['dc-county-select'] = fips;
    fields['dc-rent-limit-regime'] = 'chfa_lihtc';
    fields['dc-minimum-set-aside'] = '40-60';
    fields['dc-unit-mix-source'] = 'auto';
    fields['dc-unrepresented-schedule-rows'] = '[]';
    fields['dc-auto-noi'] = true; fields['dc-noi'] = '0';
    fields['dc-deferred-auto-balance'] = true;
    fields['dc-deferred-repay-cap'] = true;
    fields['dc-achievable-cap'] = false; fields['dc-qct-dda'] = false;
    fields['dc-gross-sf'] = ''; fields['dc-gsf-standard'] = ''; fields['dc-gsf-efficiency'] = '0.8';
    fields['dc-market-rent-mode'] = 'zori'; fields['dc-market-bedroom'] = '2br'; fields['dc-market-rent-source'] = '';
    [20, 30, 40, 50, 60, 70, 80, 100, 110, 120].forEach(function (t) {
      var n = TIERS.indexOf(t) !== -1 && q.tiers[t] > 0 ? Math.round(q.tiers[t]) : 0;
      // The live grid starts with 20 to 60% ticked; a tier given homes here is ticked too.
      fields['dc-chk-' + t] = (t >= 20 && t <= 60) || n > 0;
      // One size for every home, or the market mix as a split of each tier's homes by size.
      fields['dc-units-' + t] = String(n); fields['dc-br-' + t] = SIZES.indexOf(q.mix) > -1 ? q.mix : '2br';
      ['studio', '1br', '2br', '3br', '4br'].forEach(function (br) { fields['dc-units-' + t + '-' + br] = String(n && mix && mix[t] && mix[t][br] || 0); });
    });
    [['dc-const-rent-burden', 30], ['dc-const-rent-stress', 10], ['dc-const-vac-stress', 5], ['dc-const-opex-stress', 10],
      ['dc-const-comb-rent', 5], ['dc-const-comb-vac', 3], ['dc-const-comb-opex', 5]].forEach(function (c) { fields[c[0]] = String(c[1]); });
    // The lender and investor terms, each only when typed; otherwise the live page's own default stays.
    var T = q.terms || {};
    [['rate', 'dc-rate'], ['dcr', 'dc-dcr'], ['term', 'dc-term'], ['vacancy', 'dc-vacancy'], ['taxExempt', 'dc-tax-exempt'], ['reserve', 'dc-rep-reserve'], ['propTax', 'dc-prop-tax']]
      .forEach(function (m) { if (T[m[0]] != null && T[m[0]] !== '' && isFinite(Number(T[m[0]]))) fields[m[1]] = String(T[m[0]]); });
    var eq = F.equityDefault(credit, src.equity);
    fields['dc-equity-price'] = String(q.fedPrice > 0 ? q.fedPrice : eq);
    var b = boostFor(q, src);
    fields['dc-boost-designation'] = b.designation; fields['dc-boost-evidence'] = b.evidence || ''; fields['dc-boost-pct'] = b.pct != null ? String(b.pct) : '';
    // A state credit counts only once CHFA awards it, so the quick estimate sends it as awarded: an "if awarded" reading.
    if (q.state && q.state.on && q.state.price !== '' && q.state.price != null) {
      var cap = stateCap(Object.assign({}, q, { credit: credit }), src.rules, units);
      fields['dc-state-path'] = credit === '9' ? 'with_9pct' : q.state.path;
      // With no CHFA limit that year the amount goes as entered, and the engine says why it is unavailable.
      fields['dc-state-annual'] = String(cap == null ? (credit === '9' ? 0 : q.state.annual || 0) : credit === '9' ? cap : Math.min(q.state.annual || 0, cap));
      // No published price for the Colorado credit, so none is assumed: a blank price leaves state equity unknown.
      fields['dc-state-price'] = q.state.price !== '' && q.state.price != null ? String(q.state.price) : '';
      fields['dc-state-awarded'] = true;
    }

    var byBr = {}, limits = {};
    [20, 30, 40, 50, 60, 70, 80, 100, 110, 120].forEach(function (t) {
      byBr[t] = {};
      [['studio', 'efficiency'], ['1br', '1BR'], ['2br', '2BR'], ['3br', '3BR'], ['4br', '4BR']].forEach(function (b) {
        byBr[t][b[0]] = C.rentCeiling({ regime: 'chfa_lihtc', chfaTable: src.chfa, fips: fips, tier: t, bedrooms: b[1], rentBurden: 0.30, useHera: false }).grossRent;
      });
      limits[t] = byBr[t]['2br'];
    });
    var county = (src.hud && src.hud.counties || []).filter(function (c) { return c.fips === fips; })[0];
    var blank = function (v) { return v == null || v === '' ? null : String(v); };
    return {
      fields: fields,
      resolvedDealMix: { available: false, reason: 'schedule_unavailable:unit_count_invalid', notStarted: true },
      amiLimits: fips ? limits : null, amiLimitsByBr: fips ? byBr : null, countyFips: fips || null, creditRate: F.CREDIT_RATES[credit],
      constants: F.CONSTANTS,
      utilityAllowance: allowanceFor(q, sizeTotals(q, mix)),
      equityPriceDefault: eq, minimumSetAsideElection: '40-60', regime: 'chfa_lihtc',
      // Every home here sits at an income limit, so no market-rate rent is priced.
      perBrMarket: null, manualMarket: { mode: 'zori', note: '', rents: {}, zori: null, source: {} }, hasUnitMixWarning: false,
      tranches: tranches(q, src),
      costLines: scaledLines(B, q.tdc, q.land), costRules: src.rules,
      operatingLines: (function (ob) { return OB.LINE_TEMPLATE.map(function (t) { return { id: t.id, label: t.label, group: t.group, amount: blank(ob[t.id]) }; }); })(scaledOpex(OB, q.opexMonth > 0 ? q.opexMonth * 12 : null)),
      otherIncomeLines: OB.INCOME_TEMPLATE.map(function (t) { return { id: t.id, label: t.label, amount: blank(OB.EXAMPLE_INCOME[t.id]) }; }),
      fmrData: county ? county.fmr : null
    };
  }

  function tranches(q, src) {
    var list = SOFT.filter(function (d) { return (q.soft || {})[d.k] > 0; }).map(function (d, i) {
      var c = softCap(d, src.soft, q.tdc), amt = Math.round(q.soft[d.k]);
      if (c.max != null) amt = Math.min(amt, c.max);
      return { id: i + 1, program: d.program, amount: amt, mode: 'loan', rate: c.rate, term: 30, maturity: 30, ioYears: 0,
        loanType: 'accrue_defer', cashflowPayPct: 0, priority: 6 + i };
    });
    return list.length ? list : [{ id: 1, program: 'other', amount: 0, mode: 'loan', rate: 3, term: 30, maturity: 30, ioYears: 2, loanType: 'amortizing', cashflowPayPct: 100, priority: 5 }];
  }

  function mods() {
    return { LabFinancials: global.LabFinancials, ChfaRentLimits: global.ChfaRentLimits, DealCostBasis: global.DealCostBasis, DealOperatingBudget: global.DealOperatingBudget,
      PMAMarketScoring: global.PMAMarketScoring };
  }

  var q = JSON.parse(JSON.stringify(START));
  var kind = 'rental';
  function money(n) { return (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US'); }

  var tdcNow = NaN; // the run's total development cost, for the gap card's tone
  function card(key, label, v, why, extra) {
    var ok = v != null && isFinite(v);
    var shown = ok ? (key === 'gap' && v <= 0 ? '$0' : money(v)) : 'Unavailable';
    var tone = key === 'gap' && ok ? global.LabTpl.gapTone(v, tdcNow) : '';
    return '<div data-out="' + key + '"' + (tone ? ' class="tone-' + tone + '"' : '') + (ok ? ' data-value="' + Math.round(v) + '"' : '') + '><dt>' + esc(label) + '</dt><dd' + (ok ? '' : ' class="unavail"') + '>' + esc(shown) + '</dd>' + (tone ? global.LabTpl.toneBadge(tone) : '') +
      (!ok ? '<p class="why">' + esc(why || 'Not available for these inputs.') + '</p>' : extra ? '<p class="why">' + extra + '</p>' : '') + '</div>';
  }
  function boostLine(r) {
    var b = r.costBasis && r.costBasis.basis && r.costBasis.basis.boost;
    if (!b) return '';
    if (b.applied) return esc(boostFor(q, data).designation === 'chfa' ? 'Assumes CHFA\u2019s discretionary basis boost, ' : 'Assumes a HUD ' + ({ qct: 'QCT', dda: 'DDA', sadda: 'Small Area DDA' }[boostFor(q, data).designation] || '') + ' basis boost, ') + Math.round((b.multiplier - 1) * 100) + '%.';
    return boostFor(q, data).designation !== 'none' && b.reason ? 'No boost: ' + esc(b.reason) : 'No basis boost assumed.';
  }
  // paul 11-05: the easy version says plainly what it is.
  var DISCLAIMER = '<div class="callout quick-disclaimer" role="note"><p><strong>A first look, not underwriting.</strong> These figures use example costs and typical terms, not your lender’s, investor’s or CHFA’s. ' +
    'Rents, costs, loan terms and credit prices differ by site and change over time. Get a lender and syndicator quote, and check CHFA’s current Qualified Allocation Plan, before relying on any number here. ' +
    'This is not financial, legal or tax advice.</p></div>';

  // An adopted rule from lihtc-underwriting-rules.json as a linked citation with its quote: the same file the live engine applies.
  function rule(key) {
    var R = data && data.rules, r = R && R.rules && R.rules[key], S = r && R.sources && R.sources[r.source];
    if (!r || r.status !== 'adopted' || !S) return null;
    return { r: r, html: '<a href="' + esc(S.url) + '">' + esc(S.title) + '</a>, ' + esc(r.location) + ': “' + esc(r.quote) + '”' };
  }
  var IRC = 'https://www.law.cornell.edu/uscode/text/26/42';
  // A closed "What goes here?" fold under an input: what to enter in plain words, then the rule or source behind it.
  function help(id, body, source) {
    return '<details class="quick-help" data-quick-fold="' + id + '"' + (folds[id] ? ' open' : '') + '><summary>What goes here?</summary><p>' + body + '</p>' +
      (source ? '<p class="quick-help-src">Source: ' + source + '</p>' : '') + '</details>';
  }
  var folds = {};

  // One year once the building is full, read line by line off the engine's result: rents, vacancy, running costs, tax,
  // reserve, what is left, the loan payment it carries and the coverage. No arithmetic beyond the engine's own figures
  // except per-home division and the cash left after the loan payment.
  function proForma(r, units) {
    var known = function (v) { return v != null && isFinite(v); };
    if (!known(r.noi) || !known(r.annualRents)) return '';
    var gross = r.annualRents + (r.annualOtherIncome || 0), vac = known(r.effectiveGrossIncome) ? gross - r.effectiveGrossIncome : null;
    var row = function (label, v, cls) {
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th scope="row">' + esc(label) + '</th><td class="num">' + (known(v) ? esc(money(v)) : '—') + '</td><td class="num">' + (known(v) ? esc(money(v / units / 12)) : '—') + '</td></tr>';
    };
    var less = function (v) { return known(v) ? -v : v; };
    var cash = known(r.annualDebtService) ? r.noi - r.annualDebtService : null;
    var cov = rule('min_debt_coverage'), vacR = rule('pro_forma_vacancy');
    return '<details class="quick-pf" data-quick-fold="pf"' + (folds.pf ? ' open' : '') + '><summary>One-year pro forma: how the rent pays the loan</summary>' +
      '<div class="table-scroll"><table><caption>The first full year, in 2026 dollars</caption><thead><tr><th scope="col">Line</th><th scope="col" class="num">A year</th><th scope="col" class="num">A home a month</th></tr></thead><tbody>' +
      row('Rent from all homes', r.annualRents) + (r.annualOtherIncome > 0 ? row('Other income', r.annualOtherIncome) : '') +
      row('Less empty homes (' + Math.round((r.vacancyRate || 0) * 1000) / 10 + '%)', less(vac)) +
      row('Rent collected', r.effectiveGrossIncome, 'sub') +
      row('Less running costs', less(r.annualOpex)) + row('Less property tax', less(r.netPropTax)) + row('Less savings for repairs', less(r.annualRepReserve)) +
      row('Money left each year (NOI)', r.noi, 'sub') + row('Less the yearly loan payment', less(r.annualDebtService)) +
      row('Cash left after the loan', cash, 'sub') + '</tbody></table></div>' +
      (known(r.baseDSCR) ? '<p>The loan is sized so the building earns <strong>$' + r.baseDSCR.toFixed(2) + ' for each $1 of loan payment</strong>' + (cov ? '; CHFA’s floor is $' + cov.r.min_coverage.toFixed(2) + '.' : '.') + '</p>' : '') +
      '<p class="note">Rents are the most CHFA allows' + (r.allowanceRevenueReason ? '' : ', less any utility allowance entered') + '. A bigger loan needs more money left each year. ' +
      'Later years, reserves for lease-up and the 15-year cash flow are in the <a href="' + LIVE_TOOL + '">full calculator ↗</a>.</p>' +
      '<p class="metric-source">Sources: ' + (vacR ? vacR.html + '; ' : '') + (cov ? cov.html : '') + '</p></details>';
  }

  // Where the money comes from and where it goes. Uses are the engine's own cost groups (DealCostBasis.GROUPS labels).
  function sourcesUses(r, soft) {
    var known = function (v) { return v != null && isFinite(v); };
    var g = r.costBasis && r.costBasis.summary && r.costBasis.summary.groups, B = global.DealCostBasis;
    if (!g || !known(r.gap) || !B) return '';
    var src = [['Federal credit equity', r.equity], ['State credit equity', r.stateEquity], ['First mortgage', r.mortgage], ['Gap funding', soft],
      ['Deferred developer fee', r.deferredDevFee], ['Still to find', r.gap > 0 ? r.gap : 0]].filter(function (x) { return known(x[1]) && x[1] > 0; });
    var uses = B.GROUPS.map(function (x) { return [x.label, g[x.id]]; }).filter(function (x) { return x[1] > 0; });
    var tab = function (cap, rows) {
      var tot = rows.reduce(function (t, x) { return t + x[1]; }, 0);
      return '<div class="table-scroll"><table><caption>' + esc(cap) + '</caption><tbody>' + rows.map(function (x) {
        return '<tr><th scope="row">' + esc(x[0]) + '</th><td class="num">' + esc(money(x[1])) + '</td></tr>'; }).join('') +
        '<tr class="sub"><th scope="row">Total</th><td class="num">' + esc(money(tot)) + '</td></tr></tbody></table></div>';
    };
    return '<details class="quick-pf" data-quick-fold="su"' + (folds.su ? ' open' : '') + '><summary>Sources and uses</summary><div class="su-pair">' +
      tab('Where the money comes from', src) + tab('Where it goes', uses) + '</div>' +
      '<p class="note">Costs are the full calculator’s example budget, each line keeping its share of your total' + (q.land != null ? ', with your land cost' : '') + '. Itemize them in the full calculator.</p></details>';
  }

  // Every assumption the estimate used, one line each with its source, so nothing is silent.
  function assumptionsList(r, units) {
    var known = function (v) { return v != null && isFinite(v); };
    var rate = permRate(data.fred, data.assumptions), T = q.terms || {}, mins = r.costBasis && r.costBasis.chfaMinimums && r.costBasis.chfaMinimums.items || [];
    var minLine = function (key) { var m = mins.filter(function (x) { return x.key === key; })[0]; return m && m.passes === false ? ' <strong>Below CHFA’s minimum.</strong>' : m && m.passes ? ' Meets CHFA’s minimum.' : ''; };
    var sizes = sizeTotals(q, q.mix === 'market' ? marketMix(q, data, global.PMAMarketScoring) : null);
    var chfaMeta = data.chfa && data.chfa.meta || {}, eqMeta = data.equity && data.equity.meta || {};
    var items = [
      'Rents: <a href="' + esc(chfaMeta.source_url || '') + '">CHFA’s 2026 limits</a> for this county, effective ' + esc(chfaMeta.effective_date || '') + ', ' +
        SIZES.filter(function (b) { return sizes[b] > 0; }).map(function (b) { return sizes[b] + ' ' + SIZE_LABEL[b]; }).join(', ') + ' homes.',
      q.util === 'renter' && !r.allowanceRevenueReason && allowanceFor(q, sizes).applied ? 'Utilities: renters pay their own; the allowance you entered comes off each rent.' : 'Utilities: the owner pays them all, so rents are not reduced by an allowance.',
      'Empty homes: ' + Math.round((r.vacancyRate || 0) * 1000) / 10 + '% of income.' + minLine('pro_forma_vacancy'),
      'Running costs: ' + money(r.annualOpex / units / 12) + ' a home a month' + (q.opexMonth > 0 ? ', as you entered.' : ', the full calculator’s example, not a benchmark.') + minLine('pupa_minimum'),
      'Property tax: ' + money(r.annualPropTax / units) + ' a home a year' + (r.taxExemptPct > 0 ? ', ' + Math.round(r.taxExemptPct * 100) + '% exempt.' : ', no exemption.') + ' A COHO default; ask the county assessor.',
      'Repair savings: ' + money(r.repReservePerUnit) + ' a home a year.' + (rule('replacement_reserve_minimum') ? ' CHFA’s minimum for family homes is ' + money(rule('replacement_reserve_minimum').r.family_per_unit_annual) + '.' : ''),
      'Loan: ' + (known(r.interestRate) ? r.interestRate.toFixed(2) + '%' : '—') + (T.rate ? ', as you entered' : rate ? ' (10-year Treasury ' + rate.t10.value.toFixed(2) + '% on ' + esc(rate.t10.date || '') + ', <a href="https://fred.stlouisfed.org/series/DGS10">FRED</a>, plus a ' + rate.spread.toFixed(2) + '-point spread that is a COHO assumption)' : '') +
        ', ' + r.term + ' years, sized at $' + Number(r.dcr).toFixed(2) + ' of income for each $1 of payment.',
      'CHFA credit year: ' + esc(String(q.year)) + ', which sets the per-project credit limits (QAP 3.L).',
      'Federal credit price: $' + Number(r.equityPrice).toFixed(2) + (q.fedPrice > 0 ? ', as you set it.' : ', the <a href="' + esc(eqMeta.source_url || '') + '">Novogradac</a> national average, ' + esc(eqMeta.vintage || '') + '.'),
      q.state.on ? 'State credit price: $' + Number(q.state.price).toFixed(2) + (Number(q.state.price) === STATE_PRICE ? ', a COHO starting assumption from Colorado tax credit applications; no public source prices it.' : ', as you set it.') : null,
      'Developer fee: ' + money(r.devFeeTotal) + ' in the example budget; ' + money(r.deferredDevFee) + ' of it deferred, up to 40%, to close the gap.',
      'Land: ' + money(r.costBasis && r.costBasis.summary && r.costBasis.summary.byId ? r.costBasis.summary.byId.land || 0 : 0) + (q.land != null ? ', as you entered.' : ', the example budget’s share.') + ' Land never earns credit.'
    ];
    return '<details class="quick-pf" data-quick-fold="as"' + (folds.as ? ' open' : '') + '><summary>Assumptions used</summary><ul class="quick-assume">' +
      items.filter(Boolean).map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></details>';
  }

  var live = '';
  function results(units) {
    if (!q.county) return '<p class="note quick-prompt">Pick a county to see the estimate.</p>';
    if (!(units > 0)) return '<p class="note quick-prompt">Add homes at one or more income limits.</p>';
    var r;
    try { r = global.DealEngine.computeDeal(build(q, data, mods())); } catch (e) { return '<p class="note" role="status">The engine could not run these inputs (' + esc(e.message) + ').</p>'; }
    var why = function (k) { return (r.unavailable && r.unavailable[k]) || r.noiUnknownReason || r.rentsUnknownReason; };
    var known = function (v) { return v != null && isFinite(v); };
    var soft = (r.totalLoanPrincipal || 0) + (r.totalGrant || 0);
    tdcNow = r.tdc;
    var gapExtra = known(r.gap) ? (r.gap > 0 ? esc(money(r.gap / units)) + ' a home, ' + Math.round(r.gap / r.tdc * 100) + '% of the cost.' : r.gap < 0 ? 'Sources run ' + esc(money(-r.gap)) + ' above the cost.' : 'Sources cover the cost.') : '';
    var cards = card('annualCredits', 'Annual federal credit', r.annualCredits, why('annualCredits'), boostLine(r)) +
      card('equity', 'Federal credit equity', r.equity, why('equity'), 'At $' + Number(r.equityPrice).toFixed(2) + ' a credit dollar.') +
      (q.state.on ? card('stateEquity', 'State credit equity', r.stateEquity, why('stateEquity'), 'If CHFA awards it, in credit year ' + esc(String(q.year)) + ', at $' + Number(q.state.price).toFixed(2) + (Number(q.state.price) === STATE_PRICE ? ' (COHO starting assumption)' : '') + '.') : '') +
      card('mortgage', 'First mortgage', r.mortgage, why('mortgage')) +
      (soft > 0 ? card('soft', 'Gap funding', soft) : '') +
      card('deferredDevFee', 'Deferred developer fee', r.deferredDevFee, why('deferredDevFee'), 'Up to 40% of the fee, as the full Deal Calculator defers.') +
      card('gap', 'Funding gap', r.gap, why('gap'), gapExtra);
    // What pays for the project, as shares of the cost.
    var parts = [['Federal credit equity', r.equity, 'equity'], ['State credit equity', r.stateEquity, 'equity state'], ['First mortgage', r.mortgage, 'mortgage'],
      ['Gap funding', soft, 'soft'], ['Deferred fee', r.deferredDevFee, 'fee'], ['Still to find', r.gap > 0 ? r.gap : 0, 'gap']].filter(function (x) { return known(x[1]) && x[1] > 0; });
    var whole = parts.reduce(function (t, x) { return t + x[1]; }, 0);
    var bar = parts.length && known(r.gap) && whole > 0 ? '<div class="stack-bar" role="img" aria-label="' + esc(parts.map(function (x) { return x[0] + ' ' + Math.round(x[1] / whole * 100) + '%'; }).join(', ')) + '">' +
      parts.map(function (x) { return '<span class="seg seg-' + x[2].split(' ')[0] + (x[2].indexOf('state') > -1 ? ' seg-state' : '') + '" style="width:' + (x[1] / whole * 100).toFixed(2) + '%" title="' + esc(x[0] + ': ' + money(x[1])) + '"></span>'; }).join('') + '</div>' +
      '<ul class="stack-key">' + parts.map(function (x) { return '<li><span class="key seg-' + x[2].split(' ')[0] + (x[2].indexOf('state') > -1 ? ' seg-state' : '') + '" aria-hidden="true"></span>' + esc(x[0]) + ' ' + Math.round(x[1] / whole * 100) + '%</li>'; }).join('') + '</ul>' : '';
    var missing = ['annualCredits', 'equity', 'mortgage', 'gap'].some(function (k) { return !known(r[k]); });
    // The same engine figures as the cards below, nothing recomputed.
    live = '<p class="quick-live"><span class="quick-live-k">Result so far</span>' +
      [['Funding gap', r.gap], ['Federal credit equity', r.equity], ['First mortgage', r.mortgage]].map(function (x) {
        return '<span><b>' + x[0] + '</b> ' + (known(x[1]) ? esc(money(x[1])) : 'not available') + '</span>';
      }).join('') + '<button type="button" class="linklike" data-quick-jump="result">Full result ↓</button></p>';
    return DISCLAIMER + '<p class="quick-back"><button type="button" class="linklike" data-quick-jump="inputs">↑ Back to the inputs</button></p>' +
      '<dl class="quick-out" id="quick-result" tabindex="-1" aria-live="polite">' + cards + '</dl>' + bar + proForma(r, units) + sourcesUses(r, soft) + assumptionsList(r, units) +
      (missing ? '<p class="note">An answer the quick estimate does not ask for, such as floor space when some homes are above the credit limits, goes in the <a href="' + LIVE_TOOL + '">full Deal Calculator ↗</a>.</p>' : '');
  }

  function basicFields(units) {
    var mix = q.mix === 'market' ? marketMix(q, data, global.PMAMarketScoring) : null, sizes = sizeTotals(q, mix);
    var opt = function (v, l, cur) { return '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + esc(l) + '</option>'; };
    var sizeNote = units > 0 ? SIZES.filter(function (b) { return sizes[b] > 0; }).map(function (b) { return sizes[b] + ' ' + SIZE_LABEL[b]; }).join(', ') + '.' : '';
    var town = global.LabDealTown && q.place ? global.LabDealTown.status(q.place, q.county) : null;
    if (mix && q.place && town) sizeNote += town.useTown ? ' Sized to renters in the town you picked.' : ' Sized to renters in the whole county; the town’s own figures are too uncertain.';
    var used = SIZES.filter(function (b) { return sizes[b] > 0; });
    var opex = q.opexMonth > 0 ? q.opexMonth : 450;
    var pupa = rule('pupa_minimum');
    var tdcPer = units > 0 ? '<span class="hint">That is ' + esc(money(q.tdc / units)) + ' a home.</span>' : '';
    return '<fieldset class="quick-extra quick-basic"><legend>The building</legend><div class="field-grid">' +
      '<div class="field-wrap"><label class="field">Home sizes<select name="quick:mix">' + opt('market', 'Suggested for this market', q.mix) + opt('1br', 'All 1-bedroom', q.mix) + opt('2br', 'All 2-bedroom', q.mix) + opt('3br', 'All 3-bedroom', q.mix) + '</select>' +
        '<span class="hint">' + esc(sizeNote) + (q.mix === 'market' && !mix && units > 0 ? ' The market mix is not available here, so every home is priced as a 2-bedroom.' : '') + '</span></label>' +
        help('mix', 'How many bedrooms the homes have. Rent limits rise with bedrooms, so this moves the rent more than anything else here. ' +
          '“Suggested for this market” sizes the homes to the renters in this county, or in the town you picked when its figures are reliable enough, who qualify at your income limits and can pay each size’s rent, the way CHFA’s market study rules count them. Change it if a market study for the site says otherwise.',
          'Census ACS 2020-2024 and HUD CHAS 2018-2022 renter households; <a href="' + esc(data.rules && data.rules.sources && data.rules.sources.S5 ? data.rules.sources.S5.url : '') + '">CHFA 2027-2028 Qualified Allocation Plan</a>, Appendix A, Market Study Guide; rents assume 1.5 people a bedroom, <a href="' + IRC + '">26 U.S.C. 42(g)(2)(C)</a>. The full market analysis is a member tool.') + '</div>' +
      '<div class="field-wrap"><label class="field">Land cost ($)<input name="quick:land" type="number" min="0" step="50000" inputmode="numeric" placeholder="example: 5% of cost" value="' + (q.land != null ? esc(String(q.land)) : '') + '">' +
        (q.land != null && !(q.land < q.tdc) ? '<span class="hint warn">Land must be less than the total cost.</span>' : tdcPer) + '</label>' +
        help('land', 'What the land costs, inside the total development cost. Enter 0 if it is donated. Land never earns tax credits, so the more of the cost that is land, the smaller the credit. Leave it blank to use the example budget’s 5%.',
          '<a href="' + IRC + '">26 U.S.C. 42(d)(1)</a>: eligible basis is the building’s adjusted basis, not the land.') + '</div>' +
      '<div class="field-wrap"><label class="field">Running costs, $ a home a month<input name="quick:opex" type="number" min="0" step="10" inputmode="numeric" value="' + esc(String(opex)) + '">' +
        '<span class="hint">' + (q.opexMonth > 0 ? 'Your figure.' : 'An example, not a benchmark. Change it.') + '</span></label>' +
        help('opex', 'Management, staff, utilities the owner pays, upkeep and insurance, for each home each month. Property tax and repair savings are counted separately (under Lender and investor terms).' +
          (pupa ? ' CHFA underwrites at least ' + esc(money(pupa.r.per_unit_annual)) + ' a home a year, including tax but not repair savings.' : ''), pupa ? pupa.html : '') + '</div>' +
      '<fieldset class="field field-wrap"><legend>Utilities</legend>' +
        '<label class="radio"><input type="radio" name="quick:util" value="owner"' + (q.util !== 'renter' ? ' checked' : '') + '> Owner pays all</label>' +
        '<label class="radio"><input type="radio" name="quick:util" value="renter"' + (q.util === 'renter' ? ' checked' : '') + '> Renters pay their own</label>' +
        (q.util === 'renter' ? '<div class="ua-grid">' + used.map(function (b) {
          return '<label class="field">' + esc(SIZE_LABEL[b]) + ' allowance, $ a month<input name="quick:ua:' + b + '" type="number" min="0" step="1" inputmode="numeric" value="' + (q.ua[b] != null ? esc(String(q.ua[b])) : '') + '"></label>';
        }).join('') + '</div>' + (allowanceFor(q, sizes).applied ? '' : '<p class="hint warn">Enter an allowance for each size. Until then rents assume the owner pays.</p>') : '') +
        help('util', 'If renters pay their own heat or electric, CHFA’s rent limit has to cover those bills too, so the rent the owner collects is the limit less a utility allowance. Get the allowance for each size from the local housing authority’s schedule. If renters pay, lower the running costs by what the owner no longer pays.',
          '<a href="' + IRC + '">26 U.S.C. 42(g)(2)(B)(ii)</a>: gross rent includes the utility allowance; <a href="https://www.law.cornell.edu/cfr/text/26/1.42-10">26 CFR 1.42-10</a> sets how allowances are figured.') +
      '</fieldset></div></fieldset>';
  }

  // The lender and investor terms: closed by default; each field starts at the live page's default and says where it comes from.
  function termsField() {
    var T = q.terms || {}, rate = permRate(data.fred, data.assumptions);
    var f = function (key, label, val, step, src) {
      return '<div class="field-wrap"><label class="field">' + esc(label) + '<input name="quick:term:' + key + '" type="number" min="0" step="' + step + '" inputmode="decimal" value="' + esc(String(T[key] != null && T[key] !== '' ? T[key] : val)) + '"></label>' +
        '<p class="quick-help-src">' + src + '</p></div>';
    };
    var vac = rule('pro_forma_vacancy'), cov = rule('min_debt_coverage'), hi = rule('high_coverage_credit_reduction'), res = rule('replacement_reserve_minimum');
    var ex = T.taxExempt != null ? String(T.taxExempt) : '0';
    var opt = function (v, l) { return '<option value="' + v + '"' + (ex === v ? ' selected' : '') + '>' + esc(l) + '</option>'; };
    return '<details class="quick-extra quick-terms" data-quick-fold="terms"' + (folds.terms ? ' open' : '') + '><summary>Lender and investor terms</summary>' +
      '<p class="note">For people who have a lender’s or investor’s numbers. Each starts at the full calculator’s default.</p><div class="field-grid">' +
      f('rate', 'Loan rate (%)', rate ? rate.rate : '6.5', '0.05', rate ? '10-year Treasury ' + esc(rate.t10.value.toFixed(2)) + '% on ' + esc(rate.t10.date || '') + ' (<a href="https://fred.stlouisfed.org/series/DGS10">FRED DGS10</a>) plus ' + esc(rate.spread.toFixed(2)) + ' points, a COHO assumption with no published source. Use your lender’s quote.' : 'A COHO default. Use your lender’s quote.') +
      f('dcr', 'Income for each $1 of loan payment', '1.20', '0.01', 'A COHO default.' + (cov ? ' CHFA minimum: ' + cov.html : '') + (hi ? ' Above 1.30: ' + hi.html : '')) +
      f('term', 'Loan length (years)', '35', '1', 'A COHO default. Your lender sets it.') +
      f('vacancy', 'Empty homes (% of income)', '7', '0.5', vac ? vac.html : 'A COHO default.') +
      f('reserve', 'Repair savings, $ a home a year', '350', '5', res ? res.html : 'A COHO default.') +
      f('propTax', 'Property tax, $ a home a year', '900', '10', 'A COHO default. Ask the county assessor.') +
      '<div class="field-wrap"><label class="field">Property tax exemption<select name="quick:term:taxExempt">' + opt('0', 'None') + opt('50', 'Partial (50%), nonprofit partner') + opt('100', 'Full, housing authority owner') + '</select></label>' +
        '<p class="quick-help-src">Colorado exempts some property owned by a housing authority (C.R.S. 29-4-227) or a qualifying nonprofit (C.R.S. 39-3-112). Confirm with the county assessor.</p></div>' +
      '</div></details>';
  }

  function boostField() {
    var d = designations(data, q.county), b = boostFor(q, data), year = d.year || '';
    var pick = q.boost === 'auto' ? (d.county ? 'dda' : 'none') : q.boost;
    var opt = function (v, l) { return '<option value="' + v + '"' + (pick === v ? ' selected' : '') + '>' + esc(l) + '</option>'; };
    var status = !q.county ? '' : d.county ? esc(d.county.NAME) + ' is on HUD’s ' + year + ' list of Difficult Development Areas, so the whole county gets the 30% boost.'
      : 'Not a county-wide DDA. A site can still qualify by ZIP code (Small Area DDA, metro areas) or census tract (' + d.qcts + ' QCT' + (d.qcts === 1 ? '' : 's') + ' in this county; check the address on <a href="https://www.huduser.gov/portal/sadda/sadda_qct.html">HUD’s map ↗</a>).';
    return '<fieldset class="quick-extra"><legend>30% basis boost</legend><div class="field-grid">' +
      '<label class="field">Where the boost comes from<select name="quick:boost">' + opt('none', 'No boost') + opt('dda', 'County is a DDA') + opt('sadda', 'Site ZIP is a Small Area DDA') +
      opt('qct', 'Site is in a Qualified Census Tract') + (q.credit === '9' ? opt('chfa', 'CHFA basis boost (9% only)') : '') + '</select></label>' +
      (pick === 'sadda' ? '<label class="field">Site ZIP code<input name="quick:zip" inputmode="numeric" maxlength="5" value="' + esc(q.zip) + '"></label>' : '') +
      (pick === 'chfa' ? '<label class="field">CHFA’s boost (%)<input name="quick:chfaPct" type="number" min="1" max="30" step="1" value="' + esc(String(q.chfaPct)) + '"></label>' : '') +
      '</div>' + (status ? '<p class="note">' + status + '</p>' : '') + (b.note ? '<p class="note">' + esc(b.note) + '</p>' : '') + '</fieldset>';
  }

  function stateField(units) {
    var cap = stateCap(q, data.rules, units), gone = stateGone(q, data.rules), r2 = roundTwoCap(data.rules, q.year);
    var yearNote = '<p class="note quick-state-year" data-credit-year="' + esc(String(q.year)) + '">Credit year ' + esc(String(q.year)) + '. ' +
      (gone ? '<strong>No state credit this year.</strong> ' + esc(gone) + ' Pick 2026 under Credit' + (q.credit === '4' ? ', or Round Two' : '') + '.' : 'Limits are CHFA’s for that year.') + '</p>';
    var body = !q.state.on ? '' : q.credit === '9'
      ? (cap ? '<p class="note">CHFA pairs a fixed ' + esc(money(cap)) + ' a year of state credit with a 9% application in ' + esc(String(q.year)) + ', over six years.</p>' : '') + yearNote
      : '<div class="field-grid"><label class="field">CHFA application<select name="quick:statePath"><option value="bond_fall"' + (q.state.path === 'bond_fall' ? ' selected' : '') + '>With bonds, fall 2026: $10,000 a home, up to $700,000</option>' +
        '<option value="round_two"' + (q.state.path === 'round_two' ? ' selected' : '') + '>Round Two: ' + (r2 ? 'up to ' + esc(money(r2)) + ' accelerated' : 'no limit this year') + '</option></select></label>' +
        (cap ? '<label class="field">Annual state credit: ' + esc(money(Math.min(q.state.annual || 0, cap))) + '<input name="quick:stateAnnual" type="range" min="0" max="' + cap + '" step="10000" value="' + Math.min(q.state.annual || 0, cap) + '"></label>' : '') + '</div>' + yearNote;
    return '<fieldset class="quick-extra"><legend>Colorado state credit</legend>' +
      '<label class="check"><input type="checkbox" name="quick:stateOn"' + (q.state.on ? ' checked' : '') + '> Add CHFA’s state credit, if awarded</label>' + body +
      (q.state.on ? '<p class="note">CHFA sizes the final award with its own test (QAP 3.M.2). Set the state credit’s price under Credit prices.</p>' : '') +
      '</fieldset>';
  }

  // Both credit prices as sliders, each starting at the current estimate for this round: Novogradac's national average
  // for the federal credit (9% or 4%), and COHO's estimate for the Colorado credit.
  function priceField() {
    var eq = global.LabFinancials.equityDefault(q.credit, data.equity), meta = data.equity && data.equity.meta || {};
    var fed = q.fedPrice > 0 ? q.fedPrice : eq, st = q.state.price !== '' && q.state.price != null ? Number(q.state.price) : STATE_PRICE;
    var slider = function (name, v, min, max) { return '<input name="' + name + '" type="range" min="' + min + '" max="' + max + '" step="0.01" value="' + v.toFixed(2) + '">'; };
    return '<fieldset class="quick-extra"><legend>Credit prices (equity per dollar of credit)</legend><div class="field-grid">' +
      '<label class="field">Federal ' + q.credit + '% credit: $' + fed.toFixed(2) + slider('quick:fedPrice', fed, 0.60, 1.05) +
        '<span class="hint">Starts at $' + eq.toFixed(2) + ', the <a href="' + esc(meta.source_url || '') + '">Novogradac</a> national average for ' + q.credit + '% credits, ' + esc(meta.vintage || '') + '.' +
        (q.fedPrice > 0 && q.fedPrice !== eq ? ' <button type="button" class="linklike" data-quick-reset="fed">Back to $' + eq.toFixed(2) + '</button>' : '') + '</span></label>' +
      (q.state.on ? '<label class="field">Colorado state credit: $' + st.toFixed(2) + slider('quick:statePrice', st, 0.50, 1.00) +
        '<span class="hint">Starts at $' + STATE_PRICE.toFixed(2) + ', a COHO starting assumption you can change: our estimate from Colorado tax credit applications. No public source prices the state credit.' +
        (st !== STATE_PRICE ? ' <button type="button" class="linklike" data-quick-reset="state">Back to $' + STATE_PRICE.toFixed(2) + '</button>' : '') + '</span></label>' : '') +
      '</div><p class="note">Replace either with your syndicator’s quote.</p></fieldset>';
  }

  function softField() {
    return '<fieldset class="quick-extra"><legend>Gap funding</legend><div class="soft-grid">' + SOFT.map(function (d) {
      var c = softCap(d, data.soft, q.tdc), v = (q.soft || {})[d.k] || 0, max = c.max || Math.max(5000000, Math.round(q.tdc * 0.25 / 50000) * 50000);
      v = Math.min(v, max);
      return '<label class="field">' + esc(d.label) + ': ' + esc(money(v)) + '<input name="quick:soft:' + d.k + '" type="range" min="0" max="' + max + '" step="25000" value="' + v + '">' +
        '<span class="hint">' + (c.rule ? esc(c.rule) : c.max ? 'Up to ' + esc(money(c.max)) + '.' : 'No published limit; enter the award.') +
        (c.min && v > 0 && v < c.min ? ' Below the ' + esc(money(c.min)) + ' minimum.' : '') + (c.url ? ' <a href="' + esc(c.url) + '">Program ↗</a>' : '') + '</span></label>';
    }).join('') + '</div><p class="note">Each is entered as a loan repaid from sale or refinance' +
      ' (Prop 123 at its published 2.5%). CHFA’s Capital Magnet and Housing Opportunity loans are must-pay, which can shrink the first mortgage; run those terms in the full calculator.</p></fieldset>';
  }

  function countyName(fips) {
    var c = data && (data.hud.counties || []).filter(function (x) { return x.fips === fips; })[0];
    return c ? String(c.county_name || c.name) : '';
  }

  function view() {
    load();
    var sale = kind === 'sale' && global.LabDealQuickSale;
    var tabs = global.LabDealQuickSale ? '<div class="seg quick-kind" role="group" aria-label="Kind of deal">' + [['rental', 'Rental tax credit'], ['sale', 'Homes for sale']].map(function (k) {
      return '<button type="button" data-quick-kind="' + k[0] + '" aria-pressed="' + ((sale ? 'sale' : 'rental') === k[0]) + '">' + k[1] + '</button>';
    }).join('') + '</div>' : '';
    if (sale) return '<section class="tool-section quick" aria-labelledby="quick-title"><h2 id="quick-title">Quick estimate: homes for sale</h2>' + tabs +
      '<p>Can buyers afford what the homes cost to build? Pick a county, a cost, the homes and the buyers’ income. No project needed.</p>' + global.LabDealQuickSale.view() + '</section>';
    var head = '<section class="tool-section quick" aria-labelledby="quick-title"><h2 id="quick-title">Quick estimate: rental tax credit deal</h2>' + tabs +
      '<p>Could a rental tax credit deal pencil? Pick a county, a cost and the homes, then add the boost, state credit and gap funding a deal would use. No project needed.</p>';
    if (failed) return head + '<p class="note" role="status">The data did not load (' + esc(failed) + ').</p></section>';
    if (!data) return head + '<p class="note" role="status">Loading the rent limits and pricing…</p></section>';
    var counties = (data.hud.counties || []).slice().sort(function (a, b) { return String(a.county_name || a.name).localeCompare(String(b.county_name || b.name)); });
    var rate = permRate(data.fred, data.assumptions);
    var units = TIERS.reduce(function (s, t) { return s + (q.tiers[t] || 0); }, 0);
    // The result is worked out first so the form can carry it: on a wide screen the cards sit
    // far below the first inputs, and a change should not mean scrolling to see what it did.
    live = '';
    var out = results(units);
    return head + '<form class="homes" data-action="quick" novalidate>' + live + '<div class="field-grid">' +
      '<div class="field-wrap"><label class="field">County<select name="quick:county"><option value="">Pick a county</option>' + counties.map(function (c) {
        return '<option value="' + esc(c.fips) + '"' + (c.fips === q.county ? ' selected' : '') + '>' + esc(c.county_name || c.name) + '</option>';
      }).join('') + '</select></label>' +
      help('county', 'Where the homes will be. The county sets the income limits and the highest rent each home can charge.',
        '<a href="' + esc(data.chfa.meta && data.chfa.meta.source_url || '') + '">' + esc(data.chfa.meta && data.chfa.meta.source || 'CHFA 2026 limits') + '</a>, effective ' + esc(data.chfa.meta && data.chfa.meta.effective_date || '') + '.') + '</div>' +
      (global.LabDealTown ? global.LabDealTown.field({ esc: esc, county: q.county, countyName: countyName(q.county), place: q.place, help: help, render: function () { Shell.render(); } }) : '') +
      '<div class="field-wrap"><label class="field">Total development cost ($)<input name="quick:tdc" type="number" min="0" step="100000" inputmode="numeric" value="' + esc(String(q.tdc)) + '"></label>' +
        help('tdc', 'Everything it takes to build the homes and open the doors: land, construction, design and permits, financing, the developer fee and reserves. Compare with a similar project in Deal summaries.',
          (rule('developer_fee_limit') ? rule('developer_fee_limit').html : '')) + '</div>' +
      '<fieldset class="field quick-credit"><legend>Credit</legend><label class="radio"><input type="radio" name="quick:credit" value="9"' + (q.credit === '9' ? ' checked' : '') + '> 9% competitive</label>' +
      '<label class="radio"><input type="radio" name="quick:credit" value="4"' + (q.credit === '4' ? ' checked' : '') + '> 4% with bonds</label><p class="hint">' + (q.credit === '4' ? '4% needs tax-exempt bonds. CHFA takes these any time of year; the limit is bond cap.' : '9% is scored against other deals in CHFA application rounds.') + '</p>' +
        '<label class="field">CHFA credit year<select name="quick:year">' + YEARS.map(function (y) { return '<option value="' + y[0] + '"' + (String(q.year) === y[0] ? ' selected' : '') + '>' + esc(y[1]) + '</option>'; }).join('') + '</select>' +
        '<span class="hint">Sets CHFA’s federal and state credit limits per project (QAP 3.L). Starts at 2027, as the full calculator does.</span></label>' +
        help('credit', 'The 9% credit is larger and competitive: CHFA scores applications twice a year and caps each project. The 4% credit is smaller and comes with tax-exempt bonds, which must pay for at least a quarter of the building and land.',
          [rule('credit_cap_federal_9pct'), rule('bond_aggregate_basis_test')].filter(Boolean).map(function (x) { return x.html; }).join('; ')) + '</fieldset></div>' +
      '<fieldset class="quick-tiers"><legend>Homes by income limit (% of area median income)</legend><div class="tier-grid">' + TIERS.map(function (t) {
        return '<label class="field">' + t + '%<input name="quick:tier:' + t + '" type="number" min="0" step="1" inputmode="numeric" value="' + esc(String(q.tiers[t] || 0)) + '"></label>';
      }).join('') + '</div><p class="note">' + units + ' homes in all.</p>' +
      help('tiers', 'How many homes rent at each income limit, as a percent of the area’s median income. A home at 60% can only go to a household earning 60% or less, and its rent, with utilities, is capped at 30% of that income. Under the usual election at least 40% of the homes must be at 60% or less.',
        '<a href="' + IRC + '">26 U.S.C. 42(g)(1) and 42(g)(2)(A)</a>.') + '</fieldset>' +
      (q.county ? basicFields(units) + boostField() + stateField(units) + priceField() + softField() + termsField() : '') + '</form>' +
      out +
      '<p class="note">Every assumption is listed under Assumptions used. Boost designations are HUD’s ' + esc(String(designations(data, q.county).year || '')) + ' lists.</p></section>';
  }

  document.addEventListener('change', function (ev) {
    var t = ev.target, n = t && t.name;
    if (!n || n.indexOf('quick:') !== 0) return;
    if (n === 'quick:county') { q.county = t.value; q.place = ''; if (q.boost !== 'auto' && q.boost !== 'qct' && q.boost !== 'sadda') q.boost = 'auto'; }
    else if (n === 'quick:place') q.place = /^08\d{5}$/.test(t.value) ? t.value : '';
    else if (n === 'quick:tdc') { var v = Number(t.value); if (v > 0) q.tdc = Math.round(v); }
    else if (n === 'quick:year') q.year = YEARS.some(function (y) { return y[0] === t.value; }) ? t.value : START.year;
    else if (n === 'quick:credit') { q.credit = t.value === '4' ? '4' : '9'; q.fedPrice = null; if (q.credit === '4' && q.boost === 'chfa') q.boost = 'auto'; }
    else if (n.indexOf('quick:tier:') === 0) { var k = Number(t.value); if (k >= 0 && isFinite(k)) q.tiers[n.slice(11)] = Math.round(k); }
    else if (n === 'quick:boost') q.boost = t.value;
    else if (n === 'quick:zip') q.zip = String(t.value).replace(/\D/g, '').slice(0, 5);
    else if (n === 'quick:chfaPct') { var c = Number(t.value); if (c > 0 && c <= 30) q.chfaPct = c; }
    else if (n === 'quick:stateOn') q.state.on = !!t.checked;
    else if (n === 'quick:statePath') q.state.path = t.value === 'round_two' ? 'round_two' : 'bond_fall';
    else if (n === 'quick:stateAnnual') q.state.annual = Math.max(0, Number(t.value) || 0);
    else if (n === 'quick:statePrice') { var pr = Number(t.value); q.state.price = pr > 0 ? pr : STATE_PRICE; }
    else if (n === 'quick:fedPrice') { var fp = Number(t.value); q.fedPrice = fp > 0 ? fp : null; }
    else if (n.indexOf('quick:soft:') === 0) { q.soft = q.soft || {}; q.soft[n.slice(11)] = Math.max(0, Number(t.value) || 0); }
    else if (n === 'quick:mix') q.mix = ['market', '1br', '2br', '3br'].indexOf(t.value) > -1 ? t.value : 'market';
    else if (n === 'quick:land') { var ld = String(t.value).trim(); q.land = ld === '' || !(Number(ld) >= 0) ? null : Math.round(Number(ld)); }
    else if (n === 'quick:opex') { var ox = Number(t.value); q.opexMonth = ox > 0 && ox !== 450 ? ox : null; }
    else if (n === 'quick:util') q.util = t.value === 'renter' ? 'renter' : 'owner';
    else if (n.indexOf('quick:ua:') === 0) { var ua = String(t.value).trim(); q.ua = q.ua || {}; q.ua[n.slice(9)] = ua === '' || !(Number(ua) >= 0) ? null : Number(ua); }
    else if (n.indexOf('quick:term:') === 0) { var tv = String(t.value).trim(); q.terms = q.terms || {}; q.terms[n.slice(11)] = tv === '' || !(Number(tv) >= 0) ? null : Number(tv); }
    Shell.render();
  });

  // Folds stay as the reader left them when the panel re-renders.
  document.addEventListener('toggle', function (ev) {
    var d = ev.target;
    if (d && d.getAttribute && d.getAttribute('data-quick-fold')) folds[d.getAttribute('data-quick-fold')] = d.open;
  }, true);

  document.addEventListener('click', function (ev) {
    var kb = ev.target && ev.target.closest && ev.target.closest('[data-quick-kind]');
    if (kb) { kind = kb.getAttribute('data-quick-kind') === 'sale' ? 'sale' : 'rental'; Shell.render(); return; }
    var j = ev.target && ev.target.closest && ev.target.closest('[data-quick-jump]');
    if (j) {
      var to = j.getAttribute('data-quick-jump') === 'result' ? document.getElementById('quick-result') : document.querySelector('select[name="quick:county"]');
      if (to) { to.scrollIntoView({ block: 'center' }); to.focus({ preventScroll: true }); }
      return;
    }
    var b = ev.target && ev.target.closest && ev.target.closest('[data-quick-reset]');
    if (!b) return;
    if (b.getAttribute('data-quick-reset') === 'fed') q.fedPrice = null; else q.state.price = STATE_PRICE;
    Shell.render();
  });

  global.LabDealQuick = { view: view, build: build, scaledLines: scaledLines, scaledOpex: scaledOpex, splitHomes: splitHomes, marketMix: marketMix, allowanceFor: allowanceFor, sizeTotals: sizeTotals, permRate: permRate, boostFor: boostFor, designations: designations, stateCap: stateCap, stateGone: stateGone, YEARS: YEARS, softCap: softCap, SOFT: SOFT, TIERS: TIERS, START: START,
    _inputs: function () { return data && q.county ? build(q, data, mods()) : null; },
    _set: function (o) { q = Object.assign(JSON.parse(JSON.stringify(START)), o); } };
})(window);
