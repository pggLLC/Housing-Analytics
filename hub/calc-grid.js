// The Deal Calculator's own unit grid on the Financials page (calculator move, piece B, 14 Nov 2026).
// A scenario whose homes are typed in the grid (overrides.manualMix) is priced the way deal-calculator.html prices
// its manual grid: the same field ids go to the same DealEngine.computeDeal, and the rent limits, utility allowance,
// market rents and Prop 123 rules are read the way js/deal-calculator.js reads them at the pin (rentCeilingFor,
// updateAmiLimitsFromFmr, resolveUtilityAllowance, readManualMarketInputs, populateProp123Choices). This file does
// no deal arithmetic of its own. qa/calc-grid.test.js checks the inputs; the side-by-side run against the live page
// is recorded in docs/financials-controls.md.
(function (global) {
  'use strict';

  var Shell = global.LabShell;
  var esc = Shell.esc;
  var VENDOR = global.LAB_VENDOR;

  var BANDS = [20, 30, 40, 50, 60, 70, 80, 100, 110, 120];
  var BR = ['studio', '1br', '2br', '3br', '4br'];
  var RENT_BEDROOMS = { studio: 'efficiency', '1br': '1BR', '2br': '2BR', '3br': '3BR', '4br': '4BR' };
  var BR_SHORT = { studio: 'Studio', '1br': '1BR', '2br': '2BR', '3br': '3BR', '4br': '4BR' };
  var BEDROOM_LABEL = { efficiency: 'Studio', '1BR': '1 bedroom', '2BR': '2 bedroom', '3BR': '3 bedroom', '4BR': '4 bedroom' };
  var FMR_FIELDS = [['Studio', 'efficiency'], ['1BR', 'one_br'], ['2BR', 'two_br'], ['3BR', 'three_br'], ['4BR', 'four_br']];
  // The live page's rent limit choices, in its order and words.
  var REGIMES = [['chfa_lihtc', 'CHFA LIHTC'], ['home_high', 'HOME, High HOME rents (HUD)'], ['home_low', 'HOME, Low HOME rents (HUD)'],
    ['prop123', 'Prop 123 (Colorado affordable housing fund)'], ['ami_formula', 'Other AMI-restricted rental (non-CHFA formula)'], ['market', 'Market-rate (unrestricted)']];
  var REGIME_SHORT = { chfa_lihtc: 'CHFA LIHTC', ami_formula: 'Other AMI-restricted rental', market: 'Market-rate', home_high: 'HOME (High HOME rents)', home_low: 'HOME (Low HOME rents)', prop123: 'Prop 123' };
  var FORMULA = {
    chfa_lihtc: 'Published CHFA maximum gross rent by county, income level and home size.',
    ami_formula: 'Non-CHFA formula: household income limit × (income level ÷ 50) × rent burden ÷ 12.',
    market: 'No restricted limit (market-rate).',
    home_high: 'HUD High HOME rent by county and home size: the lesser of the fair market rent and 30% of income at 65% AMI.',
    home_low: 'HUD Low HOME rent by county and home size: 30% of income at 50% AMI, capped by the High HOME rent.',
    prop123: 'Prop 123: gross rent at 30% of the home’s income limit, the lower of CHFA’s published cell and that rule.'
  };
  var BURDEN_HELP = {
    ami_formula: 'Applies only to the non-CHFA income-based formula.',
    market: 'Market-rate rents have no income-based ceiling.',
    home_high: 'Published HUD HOME rents are fixed; rent burden does not change them.',
    home_low: 'Published HUD HOME rents are fixed; rent burden does not change them.',
    prop123: 'Prop 123 sets rent at 30% of the home’s income limit; rent burden does not change it.',
    chfa_lihtc: 'Published CHFA rents are fixed; rent burden does not change them.'
  };
  var CHECKS = { 'dc-achievable-cap': true };
  BANDS.forEach(function (t) { CHECKS['dc-chk-' + t] = true; });

  // ---------- the four files the live page loads for these choices ----------
  // Each is optional, as on the live page: a miss leaves that program's rents unavailable with the engine's reason.
  var src = { started: false, home: undefined, prop123: undefined, zori: undefined, acs: undefined };
  var FILES = [['home', 'data/hud-home-rent-limits-co-2026.json'], ['prop123', 'data/policy/prop123-rental-rules.json'],
    ['zori', 'data/market/zori_rents_co.json'], ['acs', 'data/market/acs_renter_bedrooms_co.json']];
  function load() {
    if (src.started) return;
    src.started = true;
    FILES.forEach(function (x) {
      fetch(VENDOR + x[1]).then(function (r) { if (!r.ok) throw new Error(x[1] + ' ' + r.status); return r.json(); })
        .then(function (j) { src[x[0]] = j; Shell.render(); })
        .catch(function () { src[x[0]] = null; Shell.render(); });
    });
  }
  function ready() { return FILES.every(function (x) { return src[x[0]] !== undefined; }); }

  // ---------- the grid's fields, under the live page's ids ----------
  function blank(fips) {
    var g = { 'dc-county-select': fips || '', 'dc-rent-limit-regime': 'chfa_lihtc', 'dc-prop123-program': '', 'dc-prop123-petition': '',
      'dc-units': '', 'dc-vacancy': '7', 'dc-const-rent-burden': '30', 'dc-achievable-cap': '',
      'dc-market-rent-mode': 'zori', 'dc-market-bedroom': '2br', 'dc-market-rent-source': '', 'dc-unrepresented-schedule-rows': '[]' };
    BR.forEach(function (br) { g['dc-market-rent-' + br] = ''; });
    BANDS.forEach(function (t) {
      g['dc-chk-' + t] = ''; g['dc-units-' + t] = '0'; g['dc-br-' + t] = '2br';
      BR.forEach(function (br) { g['dc-units-' + t + '-' + br] = '0'; });
    });
    return g;
  }
  var KEYS = Object.keys(blank());
  function int(v) { var n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : 0; }
  // Homes in a row, counted as the engine counts them: the size split when it holds any home, else the row's count.
  function rowHomes(g, t) {
    var split = BR.reduce(function (n, br) { return n + int(g['dc-units-' + t + '-' + br]); }, 0);
    return split > 0 ? split : int(g['dc-units-' + t]);
  }
  function gridHomes(g) { return BANDS.reduce(function (n, t) { return n + rowHomes(g, t); }, 0); }

  // A copy made on the Homes page starts from its cells, as the live page's "Edit here instead" fills the grid:
  // each row ticked, its homes in the size split, vacancy and county as saved. A new grid starts empty.
  function seed(manual, sched, project) {
    var subject = sched && sched.snapshot && sched.snapshot.subject || null, result = sched && sched.snapshot && sched.snapshot.result || null;
    var place = project && project.jurisdiction && String(project.jurisdiction.geoid || '');
    var g = blank(manual && manual.countyFips || subject && subject.county_fips || (/^08\d{3}$/.test(place || '') ? place : ''));
    var cells = manual && Array.isArray(manual.cells) ? manual.cells : [];
    cells.forEach(function (c) {
      if (BANDS.indexOf(Number(c.tier)) < 0 || BR.indexOf(c.bedroomCell) < 0) return;
      var k = 'dc-units-' + c.tier + '-' + c.bedroomCell;
      g[k] = String(int(g[k]) + int(c.units));
      g['dc-units-' + c.tier] = String(int(g['dc-units-' + c.tier]) + int(c.units));
      g['dc-chk-' + c.tier] = 'yes';
    });
    if (cells.length) {
      g['dc-units'] = String(gridHomes(g));
      if (result && result.vacancyRate != null) g['dc-vacancy'] = String(Math.round(result.vacancyRate * 1e8) / 1e6);
    }
    return g;
  }
  function stored(o) {
    if (!o || typeof o !== 'object') return null;
    var g = blank();
    KEYS.forEach(function (k) { if (o[k] != null) g[k] = String(o[k]); });
    return g;
  }

  // What Financials needs to know about a scenario priced from the grid; null for one priced from a saved schedule.
  function ctx(p, scenarioId, draft) {
    var manual = p && p.overrides[scenarioId] && p.overrides[scenarioId].manualMix;
    if (!manual) return null;
    var sched = p.attachments.filter(function (a) { return a.scenarioId === scenarioId && a.kind === 'rent-schedule' && a.state !== 'replaced'; })[0] || null;
    return { manual: manual, sched: sched, subject: sched && sched.snapshot && sched.snapshot.subject || null,
      grid: stored(draft && draft.grid) || seed(manual, sched, p), place: p.jurisdiction && p.jurisdiction.geoid ? String(p.jurisdiction.geoid) : null };
  }

  // Reads the grid off the Financials form. A box not on the form keeps its saved value (the Prop 123 choices and
  // the entered market rents stay while hidden, as the live page keeps its hidden fields).
  function read(fd, form, d, G) {
    if (!G || fd.get('dc-unit-mix-source') !== 'manual') return;
    var g = G.grid;
    KEYS.forEach(function (k) {
      if (CHECKS[k]) { if (form.querySelector('[name="' + k + '"]')) g[k] = fd.get(k) != null ? 'yes' : ''; return; }
      if (fd.get(k) != null) g[k] = String(fd.get(k));
    });
    d.grid = g;
  }

  // ---------- Prop 123 choices (populateProp123Choices) ----------
  function prop123Programs() {
    var rules = src.prop123;
    return (rules && Array.isArray(rules.programs) ? rules.programs : []).filter(function (p) {
      var income = p.income_rule || {};
      return income.type !== 'none' && income.max_ami_pct != null && p.id.indexOf('lihtc') === -1;
    });
  }
  function prop123Petitions(fips) {
    var list = src.prop123 && src.prop123.rural_resort_petitions && src.prop123.rural_resort_petitions.petitions || [];
    return list.filter(function (x) { return x.status === 'approved' && Array.isArray(x.county_fips) && x.county_fips.indexOf(fips) !== -1; });
  }
  // A program or petition that is no longer offered reads as not chosen, as the live page's lists drop it.
  function prop123Choice(g) {
    var fips = g['dc-county-select'] || null;
    var program = prop123Programs().some(function (p) { return p.id === g['dc-prop123-program']; }) ? g['dc-prop123-program'] : null;
    var petition = prop123Petitions(fips).some(function (x) { return x.jurisdiction === g['dc-prop123-petition']; }) ? g['dc-prop123-petition'] : null;
    return { program: program, petition: petition };
  }

  // ---------- what the live page hands the engine for its manual grid ----------
  function hudFmr(hud) {
    return {
      getFmrByFips: function (fips) { var c = (hud && hud.counties || []).filter(function (x) { return x.fips === fips; })[0]; return c && c.fmr ? c.fmr : null; },
      getMeta: function () { return hud && hud.meta || null; }
    };
  }
  function rentBurden(g) { var v = parseFloat(g['dc-const-rent-burden']); return isFinite(v) && v >= 0 ? v * 0.01 : 0.30; }
  function ceiling(g, fin, tier, br) {
    var choice = prop123Choice(g);
    return global.ChfaRentLimits.rentCeiling({ regime: g['dc-rent-limit-regime'], chfaTable: fin.chfa,
      hudTable: fin.hud ? { meta: fin.hud.meta, counties: fin.hud.counties } : null,
      homeTable: src.home || null, prop123Rules: src.prop123 || null, program: choice.program, petitionJurisdiction: choice.petition,
      fips: g['dc-county-select'] || null, tier: tier, bedrooms: RENT_BEDROOMS[br], rentBurden: rentBurden(g), useHera: false });
  }
  function perBedroomMarket(g, fin, place) {
    var fips = g['dc-county-select'] || null;
    if (!fips || !global.ZoriRentUtils) return null;
    return global.ZoriRentUtils.getPerBedroomRent(src.zori, fips, hudFmr(fin.hud), { bedroomMix: src.acs, geoid: /^08\d{5}$/.test(place || '') ? place : null });
  }
  // collectBedroomMix: the sizes in the ticked rows.
  function bedroomMix(g) {
    var mix = {};
    BR.forEach(function (b) { mix[b] = 0; });
    BANDS.forEach(function (t) {
      if (g['dc-chk-' + t] !== 'yes') return;
      var split = 0;
      BR.forEach(function (br) { var n = int(g['dc-units-' + t + '-' + br]); if (n > 0) { mix[br] += n; split += n; } });
      if (split > 0) return;
      var u = int(g['dc-units-' + t]), b = g['dc-br-' + t] || '2br';
      if (u > 0 && Object.prototype.hasOwnProperty.call(mix, b)) mix[b] += u;
    });
    return mix;
  }
  function allowance(g, subject) {
    var C = global.ChfaRentLimits, fips = g['dc-county-select'] || null;
    if (g['dc-rent-limit-regime'] === 'market') return { applied: false, reason: 'unrestricted_market' };
    var a = C.allowanceByBedroom(subject || null, fips);
    if (a.applied) {
      var mix = bedroomMix(g);
      var missing = BR.filter(function (br) { return mix[br] > 0 && a.perBedroom[RENT_BEDROOMS[br]] == null; })[0];
      if (missing) return { applied: false, reason: 'allowance_bedroom_missing:' + RENT_BEDROOMS[missing] };
    }
    return a;
  }
  function manualMarket(g, fin, zori) {
    var fips = g['dc-county-select'] || null, override = g['dc-market-rent-mode'] === 'override';
    var meta = zori && zori._meta || {};
    var county = (fin.hud && fin.hud.counties || []).filter(function (c) { return c.fips === fips; })[0];
    var source = Object.assign({ countyFips: fips, geography: county && county.county_name || fips }, {
      source: meta.source, sourceUrl: meta.sourceUrl, vintage: meta.vintage_month, geography: meta.name, geoid: meta.geoid, binding: 'zori-fmr-bedroom-ratios',
      why: (meta.method || 'Local ZORI, HUD FMR or ACS renter bedroom mix unavailable.') + ' ACS mix: ' + (meta.bedroomMixVintage || 'unavailable') + ' (' + (meta.bedroomMixSourceUrl || '') +
        '); HUD FMR FY' + (meta.fmrVintage || 'unavailable') + ' (' + (meta.fmrSourceUrl || '') + '). Screening market-rent estimate.' });
    var rents = {};
    BR.forEach(function (br) {
      var rent = zori && zori[br];
      var available = typeof rent === 'number' && isFinite(rent) && rent > 0 && source.vintage != null;
      rents[br] = override ? String(g['dc-market-rent-' + br] || '') : available ? String(rent) : '';
    });
    return { mode: override ? 'override' : 'zori', note: override ? String(g['dc-market-rent-source'] || '').trim() : '', rents: rents, zori: zori, source: source,
      fallbackBedroom: g['dc-market-bedroom'] || '2br' };
  }

  // Turns Financials' engine inputs into the live page's manual-grid inputs. `out` is what buildInputs made for
  // everything that is not about homes and rents (costs, credits, loans, operations); those stay as they are.
  function inputs(out, G, fin) {
    var g = G.grid, f = out.fields, fips = g['dc-county-select'] || null, regime = g['dc-rent-limit-regime'];
    KEYS.forEach(function (k) { f[k] = CHECKS[k] ? g[k] === 'yes' : g[k]; });
    // A blank total means every home is in a row, the same as typing the rows' sum.
    if (String(g['dc-units']).trim() === '') f['dc-units'] = String(gridHomes(g));
    f['dc-unit-mix-source'] = 'manual';
    f['dc-market-rent-mode'] = g['dc-market-rent-mode'] === 'override' ? 'override' : 'zori';
    var choice = prop123Choice(g);
    f['dc-prop123-program'] = choice.program || ''; f['dc-prop123-petition'] = choice.petition || '';
    out.constants = Object.assign({}, out.constants, { rentBurdenPct: rentBurden(g) });
    var limits = null, byBr = null;
    if (fips || regime === 'market') {
      limits = {}; byBr = {};
      BANDS.forEach(function (t) {
        byBr[t] = {};
        BR.forEach(function (br) { byBr[t][br] = ceiling(g, fin, t, br).grossRent; });
        limits[t] = byBr[t]['2br'];
      });
    }
    var zori = perBedroomMarket(g, fin, G.place);
    var county = (fin.hud && fin.hud.counties || []).filter(function (c) { return c.fips === fips; })[0];
    out.resolvedDealMix = { available: false, reason: 'manual_selection' };
    out.amiLimits = limits; out.amiLimitsByBr = byBr; out.countyFips = fips; out.regime = regime;
    out.utilityAllowance = allowance(g, G.subject);
    out.perBrMarket = fips ? zori : null;
    out.prop123 = { prop123Rules: src.prop123 || null, program: choice.program, petitionJurisdiction: choice.petition };
    out.manualMarket = manualMarket(g, fin, zori);
    out.hasUnitMixWarning = true;
    out.fmrData = county && county.fmr ? county.fmr : null;
    return out;
  }

  // ---------- the form ----------
  function money(n) { return n == null || !isFinite(n) ? null : '$' + Math.round(n).toLocaleString('en-US'); }
  function opts(list, value) {
    return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }
  function limitText(res) {
    return res.grossRent != null ? money(res.grossRent) + ' a month' : (global.ChfaRentLimits.unavailableMessage(res.unavailableReason) || 'Rent limits unavailable');
  }
  function srcLine(list) { return global.LabPlaces && global.LabPlaces.srcLine ? global.LabPlaces.srcLine(list) : list.map(function (x) { return esc(x[0]); }).join(' · '); }
  function regimeSource(res, fin) {
    var year = res.tableYear == null ? '' : ' ' + res.tableYear;
    if (res.regime === 'market') return null;
    return [(res.source || 'Source unavailable') + year + (res.effectiveDate ? ', effective ' + res.effectiveDate : ''), res.sourceUrl || null];
  }
  function allowanceNote(inp, G) {
    var a = inp.utilityAllowance, C = global.ChfaRentLimits;
    if (a.applied) return 'Each limit is lowered by the utility allowance and fees saved with this scenario’s homes' + (a.basis && a.basis.reference ? ' (' + a.basis.reference + (a.basis.effectiveDate ? ', ' + a.basis.effectiveDate : '') + ')' : '') + '.';
    if (a.reason === 'unrestricted_market') return 'Market-rate rents have no utility allowance.';
    var why = a.reason === 'subject_project_unavailable' ? 'none is saved with this scenario' : (C.unavailableMessage(String(a.reason || '').replace(/:.*$/, '')) || a.reason) +
      (/:/.test(a.reason || '') ? ': ' + (BEDROOM_LABEL[String(a.reason).split(':')[1]] || String(a.reason).split(':')[1]) : '');
    return 'No utility allowance is taken off, so each restricted home is priced at the full limit (' + why +
      '). If residents pay utilities, the rent to the owner is lower: price the homes with their allowance in Homes and affordability, then copy them into the unit grid.';
  }

  // The "Homes and rents" step of the Financials form, for a scenario priced from the grid.
  function section(p, s, G, inp, r, fin) {
    var g = G.grid, fips = g['dc-county-select'] || '', regime = g['dc-rent-limit-regime'];
    var counties = [['', 'Choose a county']].concat((fin.chfa && fin.chfa.counties || []).map(function (c) { return [c.fips, c.county_name + ' County']; }));
    var eg = ceiling(g, fin, 60, '2br');
    var choice = prop123Choice(g);
    var caption = (REGIME_SHORT[regime] || regime) + (regime === 'prop123' && eg.program && eg.program.name ? ' · ' + eg.program.name : '') + ' · ' + (eg.source || 'Source unavailable') + (eg.tableYear == null ? '' : ' · ' + eg.tableYear);
    var notes = regime === 'prop123' && eg.caveats ? eg.caveats.slice() : [];
    if (regime === 'home_high' || regime === 'home_low') {
      notes.push(regime === 'home_high' ? 'High HOME homes serve households at or below 80% AMI.' : 'Low HOME homes serve households at or below 50% AMI.');
      notes.push('For a tax credit project with HOME homes, the lower of the two limits applies; this setting prices the whole project as HOME.');
    }
    if (regime === 'chfa_lihtc') notes.push('Regular CHFA limits. HERA limits apply only to projects placed in service by 12/31/2008.');
    var election = inp.minimumSetAsideElection, E = global.DealEngine;

    var h = '<input type="hidden" name="dc-unit-mix-source" value="manual">' +
      '<h2>Homes and rents</h2><p class="note">Type the homes by income level and size. The Deal Calculator sets each rent from the rent limits you choose, the way its own unit grid does.</p>' +
      '<div class="field-grid">' +
      '<label class="field"><span>County</span><select name="dc-county-select">' + opts(counties, fips) + '</select><small class="note">Sets the rent limits, HUD fair market rents and market rent estimates.</small></label>' +
      '<label class="field"><span>Rent limits</span><select name="dc-rent-limit-regime">' + opts(REGIMES, regime) + '</select><small class="note" data-role="rent-limit-caption">' + esc(caption) + '. ' + esc(FORMULA[regime] || '') + '</small></label>';
    if (regime === 'prop123') {
      h += '<label class="field"><span>Prop 123 program</span><select name="dc-prop123-program">' + opts([['', 'Choose a program']].concat(prop123Programs().map(function (x) { return [x.id, x.name]; })), choice.program || '') + '</select></label>' +
        '<label class="field"><span>Approved rural resort petition</span><select name="dc-prop123-petition">' +
        opts([['', 'None']].concat(prop123Petitions(fips).map(function (x) { return [x.jurisdiction, x.jurisdiction + ' (' + x.ami_pct_rental + '% AMI rental)']; })), choice.petition || '') +
        '</select><small class="note">Only petitions filed from the chosen county are listed; pick one only if the project is inside that jurisdiction. Prop 123 tax credit gap and predevelopment loans follow the CHFA LIHTC setting, because those projects carry tax credits.</small></label>';
    }
    h += '<label class="field"><span>Rent burden (% of income)</span><input name="dc-const-rent-burden" type="number" min="20" max="50" step="1" inputmode="numeric" value="' + esc(g['dc-const-rent-burden']) + '"' + (regime === 'ami_formula' ? '' : ' disabled') + '>' +
      '<small class="note">' + esc(BURDEN_HELP[regime] || '') + '</small></label>' +
      '<label class="field"><span>Total homes</span><input name="dc-units" type="number" min="0" step="1" inputmode="numeric" value="' + esc(g['dc-units']) + '" placeholder="' + esc(String(gridHomes(g))) + '">' +
      '<small class="note">Leave blank when every home is in a row below. A larger total adds market-rate homes.</small></label>' +
      '<label class="field"><span>Vacancy (%)</span><input name="dc-vacancy" type="number" min="0" max="50" step="0.5" inputmode="decimal" value="' + esc(g['dc-vacancy']) + '"></label>' +
      '</div>' +
      '<p class="note" data-role="rent-limit-example">At 60% AMI, 2 bedroom: ' + esc(limitText(eg)) + '.' + (notes.length ? ' ' + esc(notes.join(' ')) : '') + '</p>' +
      '<p class="note" data-role="allowance-note">' + esc(allowanceNote(inp, G)) + '</p>';
    // The live page's site coordinates and "Pre-fill from local need", from calc-site.js.
    if (global.LabCalcSite && global.LabFinancials) h += global.LabCalcSite.coords(p, s, global.LabFinancials.draftFor(p, s.scenarioId)) + global.LabCalcSite.prefillBar(p, s);

    h += '<div class="cg-grid" data-role="unit-grid" data-no-source="the visitor’s own inputs"><div class="cg-head" aria-hidden="true"><span>Income level</span><span>Homes</span><span>Size</span></div>' +
      BANDS.map(function (t) {
        var on = g['dc-chk-' + t] === 'yes', br = g['dc-br-' + t] || '2br';
        var split = BR.reduce(function (n, b) { return n + int(g['dc-units-' + t + '-' + b]); }, 0);
        var credit = regime === 'chfa_lihtc' && E && E.isLihtcCreditEligiblePct ? (E.isLihtcCreditEligiblePct(t, election) ? '' : 'no federal credit') : '';
        var lim = inp.amiLimitsByBr && inp.amiLimitsByBr[t] ? inp.amiLimitsByBr[t][br] : null;
        var hint = regime === 'market' ? '' : (typeof lim === 'number' ? BR_SHORT[br] + ' limit ' + money(lim) : fips ? BR_SHORT[br] + ': ' + limitText(ceiling(g, fin, t, br)) : '');
        return '<div class="cg-row' + (on ? ' on' : '') + '" data-band="' + t + '">' +
          '<label class="cg-on"><input type="checkbox" name="dc-chk-' + t + '" value="yes"' + (on ? ' checked' : '') + '><span>' + t + '% AMI' + (credit ? ' <small>' + esc(credit) + '</small>' : '') + '</span></label>' +
          '<input name="dc-units-' + t + '" type="number" min="0" step="1" inputmode="numeric" value="' + esc(g['dc-units-' + t]) + '" aria-label="Homes at ' + t + '% AMI">' +
          '<select name="dc-br-' + t + '" aria-label="Size of the homes at ' + t + '% AMI">' + opts(BR.map(function (b) { return [b, BR_SHORT[b]]; }), br) + '</select>' +
          '<p class="cg-hint">' + esc(hint) + (split > 0 ? (hint ? '. ' : '') + 'The size split is used: ' + split + ' homes.' : '') + (!on && rowHomes(g, t) > 0 ? ' Not ticked: these homes count in the total and earn no rent.' : '') + '</p>' +
          '<details class="cg-split" id="cg-split-' + t + '"' + (split > 0 ? ' open' : '') + '><summary>Split ' + t + '% AMI by size</summary><div class="cg-cells">' +
          BR.map(function (b) {
            return '<label><span>' + BR_SHORT[b] + '</span><input name="dc-units-' + t + '-' + b + '" type="number" min="0" step="1" inputmode="numeric" value="' + esc(g['dc-units-' + t + '-' + b]) + '" aria-label="' + BR_SHORT[b] + ' homes at ' + t + '% AMI"></label>';
          }).join('') + '</div></details></div>';
      }).join('') + '</div>' +
      '<p class="note">Tick a row to price its homes. Which rows earn tax credits depends on the federal minimum set-aside election under Loans, credits and terms; 100%, 110% and 120% AMI never earn federal credits. ' +
      '110% and 120% AMI are middle-income planning levels for Colorado’s middle-income credit and Prop 123 only; this calculator does not size that credit.</p>';

    // The live page's unit-sync message, from the engine's own counts.
    var units = r.units || 0, inRows = r.amiUnitSum || 0, extra = Math.max(0, units - inRows);
    if (units > 0 && inRows > units) h += '<p class="callout" role="status" data-role="unit-sync"><strong>The rows hold ' + inRows + ' homes, more than the total of ' + units + '.</strong> Each row is part of the total. Lower a row or raise the total.</p>';
    else if (extra > 0) h += '<p class="note" role="status" data-role="unit-sync"><strong>' + extra + ' market-rate home' + (extra === 1 ? '' : 's') + '</strong> (total ' + units + ' less ' + inRows + ' in the rows). They have no income limit and earn no tax credits. If every home should be in a row, raise a row or lower the total.</p>';

    if (extra > 0) {
      var mm = r.manualMarket || {}, zori = inp.manualMarket && inp.manualMarket.zori, meta = zori && zori._meta || {}, override = g['dc-market-rent-mode'] === 'override';
      var hasMix = Object.keys(r.gridBedrooms || {}).some(function (k) { return r.gridBedrooms[k] > 0; });
      h += '<fieldset class="cg-market" data-role="market-rents"><legend>Rents for the market-rate homes</legend>' +
        '<p class="note">' + (hasMix ? 'Their sizes follow the rows above in the same proportions, rounded to whole homes.' : 'No sizes are entered above, so choose one size for these homes.') + '</p><div class="field-grid">' +
        (hasMix ? '' : '<label class="field"><span>Size of the market-rate homes</span><select name="dc-market-bedroom">' + opts(BR.map(function (b) { return [b, BR_SHORT[b]]; }), g['dc-market-bedroom']) + '</select></label>') +
        '<label class="field"><span>Rent source</span><select name="dc-market-rent-mode">' + opts([['zori', 'Local Zillow rent estimates by size'], ['override', 'Enter market rents and a source note']], override ? 'override' : 'zori') + '</select>' +
        '<small class="note">' + esc(zori ? meta.source + (meta.review_flag ? '. ' + meta.review_flag.note : '') : 'No Zillow estimate by size for this county; enter market rents with a source note.') + '</small></label>' +
        BR.map(function (b) {
          var shown = override ? g['dc-market-rent-' + b] : (inp.manualMarket.rents[b] || '');
          return '<label class="field"><span>' + BR_SHORT[b] + ' rent a month ($)</span><input ' + (override ? 'name="dc-market-rent-' + b + '"' : 'readonly data-zori="' + b + '"') + ' type="number" min="1" step="1" inputmode="numeric" value="' + esc(shown) + '" placeholder="' + (override ? 'not entered' : 'no estimate') + '"></label>';
        }).join('') +
        (override ? '<label class="field"><span>Source for your market rents (required)</span><input name="dc-market-rent-source" type="text" maxlength="200" value="' + esc(g['dc-market-rent-source']) + '" placeholder="Survey or comparable properties, date and county"></label>' : '') +
        '</div><p class="note" role="status" data-role="market-status">' + esc(mm.message ? 'Unavailable — ' + mm.message : (mm.rows || []).map(function (row) { return row.units + ' ' + (BEDROOM_LABEL[row.bedrooms] || row.bedrooms) + ' homes × ' + money(row.rent) + ' a month'; }).join('; ')) + '</p></fieldset>';
    }

    if (regime !== 'market') {
      var capOn = g['dc-achievable-cap'] === 'yes', market = inp.perBrMarket, mmeta = market && market._meta || {}, binds = r.capBindings || [];
      h += '<label class="field check" data-role="market-cap"><input name="dc-achievable-cap" type="checkbox" value="yes"' + (capOn ? ' checked' : '') + '><span>Cap 70% to 120% AMI rents at market rent</span>' +
        '<small class="note">Where rents are soft, the limit at these income levels can be above what the market pays. When ticked, each of these homes is priced at the lower of its limit and the Zillow market rent estimate for its size. Homes at 60% AMI and below are not changed. ' +
        esc(!capOn ? '' : !market ? 'No market rent estimate for this county, so the cap changes nothing.'
          : 'Cap on, ' + (mmeta.name || 'county') + ' Zillow rent index ' + (mmeta.vintage_month || 'undated') + '. ' + (binds.length
            ? 'Lowered: ' + binds.map(function (b) { return b.units + ' ' + BR_SHORT[b.br] + ' at ' + b.pct + '% AMI from ' + money(b.ceiling) + ' to ' + money(b.market); }).join('; ') + '.'
            : 'It lowers no rent: the limits on these homes are already at or below market.')) + '</small></label>';
    }
    return h;
  }
  function sub(r, G) {
    var g = G.grid, units = r.units || 0;
    return units > 0 ? units + ' homes, ' + (REGIME_SHORT[g['dc-rent-limit-regime']] || '') : 'not entered';
  }

  // ---------- peer deals ----------
  // The live page's Peer Deals panel: up to five tax credit projects in the county with the same credit type, newest
  // award first, then closest in size. findPeerDeals below is js/deal-calculator.js's own function at the pin, copied
  // because that file is the old page's screen code and cannot be loaded here; qa/calc-grid.test.js runs both on
  // CHFA's list for every county and both credit types and fails on any difference.
  var peers = { started: false, data: undefined };
  function loadPeers() {
    if (peers.started) return;
    peers.started = true;
    fetch(VENDOR + 'data/chfa-lihtc.json').then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (j) { peers.data = j && Array.isArray(j.features) ? j : null; Shell.render(); })
      .catch(function () { peers.data = null; Shell.render(); });
  }
  function findPeerDeals(opts) {
    opts = opts || {};
    var features = Array.isArray(opts.features) ? opts.features : [];
    var countyFips = opts.countyFips ? String(opts.countyFips).padStart(5, '0') : null;
    var proposedUnits = +opts.proposedUnits || 0, limit = +opts.limit || 5;
    if (!countyFips || features.length === 0) return [];
    function normCredit(x) {
      if (!x) return null;
      var t = String(x).replace(/\s+/g, '').replace(/%/g, '').trim();
      if (/^9/.test(t)) return '9%';
      if (/^4/.test(t)) return '4%';
      return null;
    }
    var creditNorm = normCredit(opts.creditType || null);
    var filtered = features.filter(function (f) {
      var p = (f && f.properties) ? f.properties : f;
      if (!p) return false;
      if (String(p.CNTY_FIPS || p.cnty_fips || '').padStart(5, '0') !== countyFips) return false;
      if (creditNorm) { var fc = normCredit(p.CREDIT || p.CREDIT_PCT || p.creditType); if (fc && fc !== creditNorm) return false; }
      return true;
    });
    function triState(raw, explicit, truthyValues) {
      if (explicit === true) return true;
      if (raw === null || raw === undefined || raw === '') return null;
      return (truthyValues || ['1', 1, 'Y', 'y', true]).indexOf(raw) !== -1;
    }
    function safeYear(p) {
      var raw = parseInt((p.AwardYear || p.YR_ALLOC || p.YEAR_ALLOC || null) || 0, 10);
      return !Number.isFinite(raw) || raw < 1986 || raw > 2030 ? 0 : raw;
    }
    filtered.sort(function (a, b) {
      var pa = (a && a.properties) ? a.properties : a, pb = (b && b.properties) ? b.properties : b;
      var yA = safeYear(pa), yB = safeYear(pb);
      if (yA !== yB) return yB - yA;
      if (proposedUnits > 0) {
        var uA = parseInt(pa.N_UNITS || pa.LI_UNITS || pa.TOTAL_UNITS || 0, 10) || 0, uB = parseInt(pb.N_UNITS || pb.LI_UNITS || pb.TOTAL_UNITS || 0, 10) || 0;
        return Math.abs(uA - proposedUnits) - Math.abs(uB - proposedUnits);
      }
      return 0;
    });
    return filtered.slice(0, limit).map(function (f) {
      var p = (f && f.properties) ? f.properties : f;
      return { name: p.PROJECT_NAME || p.PROJECT || p.projectName || 'Unknown', city: p.CITY || p.PROJ_CTY || p.city || '', county: p.CNTY_NAME || p.cnty_name || '',
        countyFips: String(p.CNTY_FIPS || '').padStart(5, '0'), units: parseInt(p.N_UNITS || p.TOTAL_UNITS || 0, 10) || 0, liUnits: parseInt(p.LI_UNITS || 0, 10) || 0,
        creditType: normCredit(p.CREDIT || p.CREDIT_PCT) || '\u2014', yearAward: safeYear(p) || null,
        yearAlloc: (function () { var y = parseInt(p.YR_ALLOC || p.YEAR_ALLOC || 0, 10); return Number.isFinite(y) && y >= 1986 && y <= 2030 ? y : null; })(),
        isQct: triState(p.QCT, p.isQct), isDda: triState(p.DDA, p.isDda), isNonProf: triState(p.NON_PROF, null, ['1', 1, '2', 2]) };
    });
  }
  function peersSection(r, inp) {
    loadPeers();
    var fips = inp.countyFips, credit = inp.fields['dc-rate-4'] ? '4%' : '9%', units = r.units || 0;
    var h = '<section class="fin-section" aria-labelledby="cg-peers"><h2 id="cg-peers">Peer deals</h2>' +
      '<p class="note">Up to five tax credit projects in this county with the same credit type, newest award first, then closest in size to this deal. A check on size and credit type, not a financial benchmark: CHFA publishes no project costs, equity prices or loan coverage.</p>';
    if (!fips) return h + '<p class="note" data-role="peers">Choose a county to see peer deals.</p></section>';
    if (peers.data === undefined) return h + '<p class="note" role="status" data-role="peers">Loading CHFA\u2019s project list\u2026</p></section>';
    if (peers.data === null) return h + '<p class="note" data-role="peers">CHFA\u2019s project list did not load, so no peer deals can be shown. This is a loading failure, not a sign that no comparable projects exist. Reload the page to try again.</p></section>';
    var list = findPeerDeals({ features: peers.data.features, countyFips: fips, creditType: credit, proposedUnits: units, limit: 5 });
    var when = String(peers.data.fetchedAt || '').slice(0, 10);
    var source = '<p class="metric-source">Source: ' + srcLine([['CHFA Housing Tax Credit properties, ' + peers.data.features.length + ' Colorado projects, read ' + (when || 'no date in the source file'), 'https://www.chfainfo.com/rental-housing/housing-credit/awards']]) + '</p>';
    if (!list.length) return h + '<p class="note" data-role="peers">No tax credit projects with ' + esc(credit) + ' credits are listed in this county. Try the other credit type.</p>' + source + '</section>';
    var flag = function (on, label, title) { return on === true ? '<span class="cg-flag" title="' + esc(title) + '">' + esc(label) + '</span>' : ''; };
    var withheld = [['isQct', 'QCT'], ['isDda', 'DDA'], ['isNonProf', 'nonprofit sponsor']].filter(function (f) { return list.every(function (x) { return x[f[0]] === null; }); }).map(function (f) { return f[1]; });
    return h + '<div class="table-scroll" role="region" aria-label="Peer deals" tabindex="0"><table data-role="peers"><thead><tr><th scope="col">Project</th><th scope="col">City</th><th scope="col" class="num">Award year</th><th scope="col" class="num">Homes</th><th scope="col">Flags</th></tr></thead><tbody>' +
      list.map(function (x) {
        var near = units > 0 && Math.abs(x.units - units) <= Math.max(10, units * 0.2);
        var flags = flag(x.isQct, 'QCT', 'Qualified Census Tract') + flag(x.isDda, 'DDA', 'Difficult Development Area') + flag(x.isNonProf, 'NP', 'Nonprofit sponsor');
        return '<tr><td>' + esc(x.name) + (x.creditType !== '\u2014' ? ' <small>' + esc(x.creditType) + '</small>' : '') + '</td><td>' + esc(x.city || '\u2014') + '</td><td class="num">' + esc(String(x.yearAward || '\u2014')) +
          '</td><td class="num"' + (near ? ' data-near="yes"' : '') + '>' + esc(String(x.units || '\u2014')) + '</td><td>' + (flags || '\u2014') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="note">The year is when CHFA awarded the credits, not when the property opened: projects usually open two to three years after award. A home count in bold is within 20% (or 10 homes) of this deal.' +
      (withheld.length ? ' ' + esc(withheld.join(', ')) + ' status ' + (withheld.length === 1 ? 'is' : 'are') + ' not published by CHFA for these properties, so no flag means unknown, not \u201cno\u201d. QCT and DDA decide the 30% basis boost; check a site against HUD\u2019s maps before relying on it.' : '') + '</p>' +
      source + '</section>';
  }

  // ---------- result tables ----------
  // The homes as the engine priced them (grid scenarios), the live page's Rent Achievability Check and HUD's fair
  // market rent by size (every scenario). Each number is the engine's or the published table's.
  var ACH_LABEL = { clear: 'At or below market', tight: 'Within $50 above market', concerning: 'Above market', misaligned: 'Far above market' };
  function tables(r, inp, G, fin) {
    var h = '', C = global.ChfaRentLimits, hudMeta = fin.hud && fin.hud.meta || {};
    var fmrSrc = ['HUD Fair Market Rents FY' + (hudMeta.fiscal_year || ''), hudMeta.url_fmr || 'https://www.huduser.gov/portal/datasets/fmr.html'];
    var regime = inp.regime, eg = G ? ceiling(G.grid, fin, 60, '2br') : C.rentCeiling({ regime: 'chfa_lihtc', chfaTable: fin.chfa, fips: inp.countyFips, tier: 60, bedrooms: '2BR', rentBurden: 0.30, useHera: false });
    var limitSrc = regimeSource(eg, fin);
    if (G) {
      var rows = r.pricedRows || [];
      var zmeta = inp.perBrMarket && inp.perBrMarket._meta || inp.manualMarket && inp.manualMarket.zori && inp.manualMarket.zori._meta || null;
      var sources = [];
      if (limitSrc) sources.push(limitSrc);
      if (rows.some(function (x) { return x.tier === 'market'; }) || regime === 'market' || (r.capBindings || []).length) {
        if (inp.manualMarket.mode === 'override' && rows.some(function (x) { return x.tier === 'market'; })) sources.push(['Market rents entered here: ' + (inp.manualMarket.note || 'no source note'), null]);
        else if (zmeta) sources.push([zmeta.source, zmeta.sourceUrl || null]);
      }
      h += '<section class="fin-section" aria-labelledby="cg-priced"><h2 id="cg-priced">Homes and rents as priced</h2>' +
        (rows.length ? '<div class="table-scroll" role="region" aria-label="Homes and rents as priced" tabindex="0"><table data-role="priced-rows"><thead><tr><th scope="col">Income level</th><th scope="col">Size</th><th scope="col" class="num">Homes</th><th scope="col" class="num">Rent a month</th><th scope="col" class="num">Rent a year</th></tr></thead><tbody>' +
          rows.map(function (x) {
            var rent = x.tier === 'market' ? x.rent : x.contractRent;
            return '<tr><td>' + (x.tier === 'market' ? 'Market rate' : esc(String(x.tier)) + '% AMI') + '</td><td>' + esc(BEDROOM_LABEL[x.bedrooms] || x.bedrooms) + '</td><td class="num">' + esc(String(x.units)) + '</td><td class="num">' + esc(money(rent) || 'Unavailable') +
              '</td><td class="num">' + esc(rent == null || !isFinite(rent) ? 'Unavailable' : money(rent * x.units * 12)) + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<p class="note">' + esc(r.annualRents != null && isFinite(r.annualRents) ? money(r.annualRents) + ' scheduled rent a year before vacancy. ' : '') + esc(allowanceNote(inp, G)) +
          (r.prop123Average && r.prop123Average.averageAmiPct != null ? ' The income-restricted homes average ' + esc(String(r.prop123Average.averageAmiPct)) + '% AMI; ' + esc(r.prop123Average.programName || 'the program') + ' allows a project average of at most ' + esc(String(r.prop123Average.maxAmiPct)) + '% AMI.' : '') + '</p>' +
          (sources.length ? '<p class="metric-source">Source: ' + srcLine(sources) + '</p>' : '')
          : '<p class="note">No homes are priced yet. Tick a row and enter its homes under Homes and rents.</p>') + '</section>';
    }
    var ach = r.achResult, fmr = inp.fmrData;
    h += '<section class="fin-section" aria-labelledby="cg-ach"><h2 id="cg-ach">Rent limits against market rent</h2>' +
      '<p class="note">Each income level’s 2 bedroom rent limit beside HUD’s fair market rent for a 2 bedroom home in the county. Where the limit is above market rent, income figured at the limit is too high and loan coverage will come in lower.</p>';
    if (regime === 'market') h += '<p class="note" data-role="rent-ach">No restricted limit: every home is priced at market rent.</p>';
    else if (ach) {
      h += '<div class="table-scroll" role="region" aria-label="Rent limits against market rent" tabindex="0"><table data-role="rent-ach"><thead><tr><th scope="col">Income level</th><th scope="col" class="num">Rent limit</th><th scope="col" class="num">HUD fair market rent</th><th scope="col" class="num">Difference</th><th scope="col">Reading</th></tr></thead><tbody>' +
        BANDS.map(function (t) {
          var x = ach.tiers.filter(function (e) { return e.pct === t; })[0];
          if (!x) return '<tr><td>' + t + '% AMI</td><td colspan="4">' + esc(G ? limitText(ceiling(G.grid, fin, t, '2br')) : 'Not published for this income level') + '</td></tr>';
          return '<tr data-status="' + esc(x.status) + '"><td>' + x.pct + '% AMI</td><td class="num">' + esc(money(x.ceiling)) + '</td><td class="num">' + esc(money(x.fmr2br)) + '</td><td class="num">' +
            esc((x.gap > 0 ? '+' : x.gap < 0 ? '−' : '') + money(Math.abs(x.gap))) + '</td><td>' + esc(ACH_LABEL[x.status] || x.status) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    } else h += '<p class="note" data-role="rent-ach">Choose a county to see this check.</p>';
    if (fmr && regime !== 'market') {
      h += '<div class="table-scroll" role="region" aria-label="HUD fair market rent by size" tabindex="0"><table data-role="fmr-by-size"><caption>HUD fair market rent by size, gross rent a month</caption><thead><tr>' +
        FMR_FIELDS.map(function (x) { return '<th scope="col" class="num">' + x[0] + '</th>'; }).join('') + '</tr></thead><tbody><tr>' +
        FMR_FIELDS.map(function (x) { var v = fmr[x[1]]; return '<td class="num">' + esc(typeof v === 'number' && v > 0 ? money(v) : '—') + '</td>'; }).join('') + '</tr></tbody></table></div>';
    }
    h += '<p class="note">HUD’s fair market rent is the 40th-percentile rent for the area, includes utilities and lags by about 18 months. For a binding test, order a rent comparability study before closing.</p>' +
      '<p class="metric-source">Source: ' + srcLine((limitSrc ? [limitSrc] : []).concat([fmrSrc])) + '</p></section>';
    return h + peersSection(r, inp);
  }

  global.LabCalcGrid = { load: load, ready: ready, ctx: ctx, read: read, inputs: inputs, section: section, sub: sub, tables: tables, blank: blank, seed: seed, stored: stored,
    gridHomes: gridHomes, rowHomes: rowHomes, findPeerDeals: findPeerDeals, prop123Programs: prop123Programs, prop123Petitions: prop123Petitions, BANDS: BANDS, BR: BR, REGIMES: REGIMES, KEYS: KEYS, _src: src };
})(window);
