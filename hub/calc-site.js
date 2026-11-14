// The Deal Calculator's site and scale helpers on the Financials page (calculator move, piece D, 14 Nov 2026):
//   1. Estimate gross area from the unit mix (the live page's dc-gsf-standard, dc-gsf-efficiency, dc-gsf-apply),
//      on the live page's own module js/deal-calculator-unit-size.js and data/policy/unit-size-standards.json.
//   2. Site coordinates, Detect and Use my location (dc-coords-lat, dc-coords-lon, dc-coords-detect, dc-coords-geo),
//      which find the county from a point with the live page's js/county-from-coords.js and set the grid's county.
//   3. Pre-fill from local need (dc-ami-prefill): the grid's 30%, 50% and 60% AMI rows set in proportion to the
//      local shortfall, by the live page's own rule (_prefillAmiFromGap in js/deal-calculator.js), from
//      data/co_ami_gap_by_place.json and data/co_ami_gap_by_county.json.
//   4. The concept recommendation the live page draws when a county is picked (_runDealPredictor), on the live
//      modules js/lihtc-deal-predictor.js, js/lihtc-deal-predictor-enhanced.js and js/lihtc-concept-card-renderer.js.
// Nothing here does deal arithmetic, and nothing changes a figure unless the reader presses a button.
// qa/calc-site.test.js checks it; qa/calc-site-live.js compares it with the live page.
(function (global) {
  'use strict';

  var Shell = global.LabShell;
  var esc = Shell.esc;
  var BR = ['studio', '1br', '2br', '3br', '4br'];
  // A saved schedule's rows name their size this way (the live page's RENT_BEDROOMS).
  var RENT_BEDROOMS = { studio: 'efficiency', '1br': '1BR', '2br': '2BR', '3br': '3BR', '4br': '4BR' };
  var LOW = [30, 40, 50, 60];
  var FILES = { standards: 'data/policy/unit-size-standards.json', gapCounty: 'data/co_ami_gap_by_county.json', gapPlace: 'data/co_ami_gap_by_place.json' };
  var src = { started: false, standards: undefined, gapCounty: undefined, gapPlace: undefined };
  var notes = {};   // what the last button press said, by project and scenario; not saved
  function load() {
    if (src.started) return;
    src.started = true;
    Object.keys(FILES).forEach(function (k) {
      fetch(global.LAB_VENDOR + FILES[k]).then(function (r) { if (!r.ok) throw new Error(FILES[k] + ' ' + r.status); return r.json(); })
        .then(function (d) { src[k] = d; arrived(); }, function () { src[k] = null; arrived(); });
    });
  }
  // A Pre-fill pressed before the two shortfall files are in waits here, and runs once both have answered.
  var waiting = [];
  function arrived() {
    patch();
    if (src.gapCounty === undefined || src.gapPlace === undefined || !waiting.length) return;
    var run = waiting; waiting = [];
    run.forEach(function (w) { doPrefill(w[0], w[1]); });
  }
  // A file arriving late redraws only this file's own two blocks, so a fold the reader opened elsewhere on the
  // page, and anything being typed there, is left alone.
  var last = { area: null, concept: null };
  function patch() {
    var c = document.querySelector('[data-role="concept"]');
    if (c && last.concept) c.outerHTML = concept.apply(null, last.concept);
    var a = document.getElementById('fin-gsf-estimate'), at = document.activeElement;
    if (a && last.area && !(at && at.name === 'dc-gsf-efficiency')) {
      var was = a.open, name = at && a.contains(at) ? at.name : null;
      a.outerHTML = area.apply(null, last.area);
      a = document.getElementById('fin-gsf-estimate');
      if (a) { a.open = was; if (name && a.querySelector('[name="' + name + '"]')) a.querySelector('[name="' + name + '"]').focus(); }
    }
  }
  // The live page's own modules are fetched when Financials first needs them, not with every hub page.
  var asked = {};
  function need(path, have, then) {
    if (have()) return true;
    if (!asked[path]) {
      asked[path] = [];
      var el = document.createElement('script');
      el.src = global.LAB_VENDOR + path;
      el.onload = function () { var q = asked[path]; asked[path] = 'done'; q.forEach(function (f) { f(true); }); };
      el.onerror = function () { var q = asked[path]; asked[path] = 'failed'; q.forEach(function (f) { f(false); }); };
      document.body.appendChild(el);
    }
    if (Array.isArray(asked[path])) asked[path].push(then);
    else if (asked[path] === 'failed') then(false);
    return false;
  }
  var UNIT_SIZE = 'js/deal-calculator-unit-size.js', COUNTY = 'js/county-from-coords.js';
  // A button press redraws the page and keeps the reader's folds as they were, so the answer stays in view.
  function redraw() {
    var open = {};
    Array.prototype.forEach.call(document.querySelectorAll('main details[id]'), function (el) { open[el.id] = el.open; });
    Shell.render();
    Object.keys(open).forEach(function (id) { var el = document.getElementById(id); if (el && el.tagName === 'DETAILS') el.open = open[id]; });
  }
  function route() { return (location.hash || '').slice(2).split('?')[0].split('/'); }
  function key(pid, sid) { return pid + '/' + sid; }
  function bands() { return global.LabCalcGrid ? global.LabCalcGrid.BANDS : []; }

  // The fields this file adds to a Financials draft, under the live page's ids. site-gsf-derived is the lab's own
  // note that the gross area came from the estimate (the live page keeps it on the field as data-derived); it is
  // never sent to the engine.
  var INPUTS = [
    { id: 'dc-gsf-standard', group: 'site', value: '' },
    { id: 'dc-gsf-efficiency', group: 'site', value: '' },
    { id: 'dc-coords-lat', group: 'site', value: '' },
    { id: 'dc-coords-lon', group: 'site', value: '' },
    { id: 'site-gsf-derived', group: 'site', value: '' }
  ];
  // What the engine's field record holds for these, as the live page fills it.
  function engineFields(fields, draft) {
    delete fields['site-gsf-derived'];
    fields['dc-gsf-standard'] = draft.fields['dc-gsf-standard'] || '';
    fields['dc-gsf-efficiency'] = efficiency(draft);
  }

  // Typing a gross area replaces the estimate, as on the live page (clearGrossSfDerivation).
  function read(d) {
    if (!d.fields['site-gsf-derived']) return;
    var derived = null;
    try { derived = JSON.parse(d.fields['site-gsf-derived']); } catch (x) { derived = null; }
    if (!derived || String(derived.sf) !== String(d.fields['dc-gross-sf'])) d.fields['site-gsf-derived'] = '';
  }

  // ---------- 1. gross area from the unit mix ----------
  function standards() { return src.standards && Array.isArray(src.standards.standards) ? src.standards.standards : []; }
  function effMeta() { var m = src.standards && src.standards.meta && src.standards.meta.efficiency; return m && isFinite(m.default) ? m : null; }
  // The live field starts at 0.80 and takes the data file's default once it loads, unless the reader typed one.
  function efficiency(d) {
    var own = d.fields['dc-gsf-efficiency'];
    if (own != null && own !== '') return String(own);
    var m = effMeta();
    return m ? String(m.default) : '0.80';
  }
  // Homes by size, the live page's collectBedroomMix: a saved schedule's rows when the deal runs from one, else the
  // grid's ticked rows, where a row's size split wins over its single size.
  function mix(inp, G) {
    var m = {};
    BR.forEach(function (b) { m[b] = 0; });
    var R = inp && inp.resolvedDealMix;
    if (R && R.available) {
      R.restrictedRows.concat(R.marketRows).forEach(function (r) {
        var br = BR.filter(function (b) { return RENT_BEDROOMS[b] === r.bedrooms; })[0];
        if (br) m[br] += r.units;
      });
      return m;
    }
    var g = G && G.grid;
    if (!g) return m;
    bands().forEach(function (t) {
      if (g['dc-chk-' + t] !== 'yes') return;
      var split = 0;
      BR.forEach(function (b) { var n = parseInt(g['dc-units-' + t + '-' + b], 10); if (isFinite(n) && n > 0) { m[b] += n; split += n; } });
      if (split > 0) return;
      var u = parseInt(g['dc-units-' + t], 10), br = g['dc-br-' + t] || '2br';
      if (isFinite(u) && u > 0 && Object.prototype.hasOwnProperty.call(m, br)) m[br] += u;
    });
    return m;
  }
  function estimate(d, inp, G) {
    var U = global.DealCalcUnitSize;
    if (!U) return null;
    var std = standards().filter(function (s) { return s.id === d.fields['dc-gsf-standard']; })[0] || null;
    var result = U.derive({ standard: std, mix: mix(inp, G), efficiency: efficiency(d) });
    return { standard: std, result: result, working: U.workingText(result, std) };
  }
  function area(d, inp, G) {
    last.area = [d, inp, G];
    load();
    if (!need(UNIT_SIZE, function () { return !!global.DealCalcUnitSize; }, function (ok) { if (ok) patch(); })) {
      return '<details class="tranche-more site-area" id="fin-gsf-estimate" data-no-source="the reader’s own homes and a named reference standard"><summary>Estimate gross area from the homes</summary>' +
        '<p class="note" role="status">' + (asked[UNIT_SIZE] === 'failed' ? 'The estimate did not load; enter gross area directly.' : 'Loading the estimate…') + '</p></details>';
    }
    var e = estimate(d, inp, G), m = effMeta(), list = standards();
    var derived = null;
    try { derived = d.fields['site-gsf-derived'] ? JSON.parse(d.fields['site-gsf-derived']) : null; } catch (x) { derived = null; }
    if (derived && String(derived.sf) !== String(d.fields['dc-gross-sf'])) derived = null;
    return '<details class="tranche-more site-area" id="fin-gsf-estimate" data-no-source="the reader’s own homes and a named reference standard">' +
      '<summary>Estimate gross area from the homes</summary>' +
      '<p class="note">Colorado’s CHFA Qualified Allocation Plan sets no minimum home size by bedroom count, so there is no Colorado standard to work from. ' +
      'The references below are other places’ figures, labelled as such. Multiplying your homes by one of them is a screening estimate, not a design.</p>' +
      '<div class="field-grid">' +
      '<label class="field"><span>Reference standard</span><select name="dc-gsf-standard"><option value="">Choose a reference</option>' +
      list.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === d.fields['dc-gsf-standard'] ? ' selected' : '') + '>' + esc(s.label + ', ' + s.jurisdiction + (s.applies_to_colorado ? '' : ' (not Colorado)')) + '</option>'; }).join('') +
      '</select></label>' +
      '<label class="field"><span>Efficiency (net area ÷ gross area)</span><input name="dc-gsf-efficiency" type="number" min="0.5" max="1" step="0.01" inputmode="decimal" value="' + esc(efficiency(d)) + '">' +
      '<small class="note">' + esc(src.standards === undefined ? 'Loading the reference data…' : m ? 'Starts at ' + m.default + ' (benchmarks ' + m.range[0] + ' to ' + m.range[1] + ', trade press, not a regulation). Change it here and the working updates.' : 'Reference data unavailable; enter gross area directly.') + '</small></label>' +
      '</div>' +
      '<p class="note" data-role="gsf-working" role="status">' + esc(e ? e.working : '') + '</p>' +
      (derived ? '<p class="note site-result site-good" data-role="gsf-derived">Gross building area above is this estimate (' + esc(Number(derived.sf).toLocaleString('en-US')) + ' square feet). Typing a value there replaces it.</p>' : '') +
      '<div class="actions"><button type="button" class="button-link secondary" data-action="gsf-apply"' + (e && e.result && e.result.status === 'ok' ? '' : ' disabled') + '>Use this estimate as gross area</button></div>' +
      '</details>';
  }

  // ---------- 2. site coordinates ----------
  function coords(p, s, d) {
    var n = notes[key(p.projectId, s.scenarioId)], c = n && n.coords;
    return '<details class="tranche-more site-coords" id="fin-site-coords" data-no-source="the reader’s own site">' +
      '<summary>Find the county from the site’s coordinates</summary>' +
      '<p class="note">Useful when the site is in a town that spans more than one county, such as Erie, Aurora or Longmont. Enter the latitude and longitude and the county above is set for you.</p>' +
      '<div class="field-grid">' +
      '<label class="field"><span>Latitude</span><input name="dc-coords-lat" type="number" step="0.000001" inputmode="decimal" placeholder="39.7392" value="' + esc(d.fields['dc-coords-lat'] || '') + '"></label>' +
      '<label class="field"><span>Longitude</span><input name="dc-coords-lon" type="number" step="0.000001" inputmode="decimal" placeholder="-104.9847" value="' + esc(d.fields['dc-coords-lon'] || '') + '"></label>' +
      '</div>' +
      '<div class="actions"><button type="button" class="button-link secondary" data-action="coords-detect">Find the county</button>' +
      '<button type="button" class="button-link secondary" data-action="coords-geo">Use my location</button></div>' +
      '<p class="note site-result' + (c && c.kind ? ' site-' + c.kind : '') + '" data-role="coords-result" role="status">' + esc(c ? c.text : '') + '</p>' +
      '</details>';
  }
  // The live page's lookup and its messages (_wireCountyDetect), in this site's words.
  function lookup(pid, sid, lat, lon) {
    var k = key(pid, sid);
    function say(text, kind) { notes[k] = Object.assign({}, notes[k], { coords: { text: text, kind: kind || '' } }); redraw(); }
    if (!isFinite(lat) || !isFinite(lon)) return say('Enter a latitude and a longitude.', 'bad');
    var outside = lat < 36 || lat > 42 || lon < -110 || lon > -101;
    if (!need(COUNTY, function () { return !!global.CountyFromCoords; }, function (ok) { if (ok) lookup(pid, sid, lat, lon); else say('The county lookup did not load.', 'bad'); })) {
      if (asked[COUNTY] !== 'failed') say('Looking up the county…');
      return;
    }
    var C = global.CountyFromCoords;
    say('Looking up the county…');
    // The live module reads its county outlines through DataService or a path beside the page; point it at the copy
    // for the one call that starts the load, as deep-dive.js does.
    var had = Object.prototype.hasOwnProperty.call(global, 'DataService'), before = global.DataService, started;
    global.DataService = { baseData: function (rel) { return global.LAB_VENDOR + 'data/' + rel; }, getJSON: function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }); } };
    try { started = C.init(); } finally { if (had) global.DataService = before; else delete global.DataService; }
    Promise.resolve(started).then(function () { return C.lookup(lat, lon); }).then(function (county) {
      if (!county) return say((outside ? 'Those coordinates look outside Colorado (about 37 to 41 north, 102 to 109 west). ' : '') + 'No Colorado county found for them. Pick the county above yourself.', 'warn');
      var P = global.LabProjects, F = global.LabFinancials, p = P.get(pid);
      if (!p) return;
      var d = F.draftFor(p, sid), G = global.LabCalcGrid && global.LabCalcGrid.ctx(p, sid, d);
      var known = ((F._data.chfa && F._data.chfa.counties) || []).some(function (c) { return c.fips === county.fips; });
      if (!G || !known) return say('Found ' + county.name + ' County (' + county.fips + '), but it is not in the county list. Pick the county above yourself.', 'warn');
      G.grid['dc-county-select'] = county.fips;
      d.grid = G.grid;
      P.setOverride(pid, sid, 'financialsDraft', d);
      say('Found ' + county.name + ' County (' + county.fips + '). The county above and its rent limits now use it.', 'good');
    }).catch(function (err) { say('The lookup failed: ' + (err && err.message ? err.message : err), 'bad'); });
  }

  // ---------- 3. pre-fill from local need ----------
  // The live page's three band counts from either file (_gapTrioFromRecord).
  function trio(rec, kind) {
    var out = {};
    if (kind === 'place') {
      var hh = rec.households_le_ami_pct || {}, un = rec.units_priced_affordable_le_ami_pct || {};
      ['30', '50', '60'].forEach(function (b) { out[b] = Math.max(0, (Number(hh[b]) || 0) - (Number(un[b]) || 0)); });
    } else {
      var g = rec.gap_units_minus_households_le_ami_pct || {};
      ['30', '50', '60'].forEach(function (b) { out[b] = Math.max(0, -(Number(g[b]) || 0)); });
    }
    return out;
  }
  // The live page's allocation (_prefillAmiFromGap), as a pure function: what the rows become and what the note
  // says. placeGeoid is the project's place when it is a town; it counts only while the grid's county is its own.
  function prefill(g, totalUnits, placeGeoid, gapPlace, gapCounty) {
    var fips = g['dc-county-select'] || '';
    var place = placeGeoid && gapPlace && gapPlace.places ? gapPlace.places[placeGeoid] || null : null;
    if (place && place.containing_county_fips && String(place.containing_county_fips) !== String(fips)) place = null;
    var county = null;
    ((gapCounty && gapCounty.counties) || []).forEach(function (c) { if (!county && fips && String(c.fips).padStart(5, '0') === String(fips).padStart(5, '0')) county = c; });
    var rec = place || county, meta = place ? gapPlace.meta : gapCounty && gapCounty.meta;
    var series = place ? [rec && rec.households_le_ami_pct, rec && rec.units_priced_affordable_le_ami_pct] : [rec && rec.gap_units_minus_households_le_ami_pct];
    var complete = rec && meta && meta.acs_year && series.every(function (values) {
      return values && ['30', '50', '60'].every(function (b) { return values[b] != null && values[b] !== '' && isFinite(Number(values[b])); });
    });
    var next = Object.assign({}, g);
    if (!complete) {
      // As on the live page: with no complete record the four rows are emptied, never guessed.
      LOW.forEach(function (t) { next['dc-units-' + t] = ''; BR.forEach(function (b) { next['dc-units-' + t + '-' + b] = ''; }); });
      return { grid: next, changed: LOW.filter(function (t) { return g['dc-units-' + t] !== ''; }), text: 'No complete shortfall record for this county or place yet. Pick a county first.', kind: 'warn' };
    }
    var kind = place ? 'place' : 'county', gaps = trio(rec, kind), label = place ? (rec.place_name || 'this place') : (rec.county_name || 'this county');
    var total = (gaps['30'] || 0) + (gaps['50'] || 0) + (gaps['60'] || 0);
    if (total <= 0) return { grid: g, changed: [], text: 'The record for ' + label + ' shows no households short of a home at or below 60% AMI, so there is nothing to fill in.', kind: '' };
    var units = Math.max(1, parseInt(totalUnits, 10) || 0);
    var u30 = Math.round(units * (gaps['30'] / total)), u50 = Math.round(units * (gaps['50'] / total)), u60 = Math.max(0, units - u30 - u50);
    var set = { 30: u30, 40: 0, 50: u50, 60: u60 };
    LOW.forEach(function (t) {
      next['dc-chk-' + t] = set[t] > 0 ? 'yes' : '';
      next['dc-units-' + t] = String(set[t]);
      BR.forEach(function (b) { next['dc-units-' + t + '-' + b] = '0'; });
    });
    var changed = LOW.filter(function (t) { return String(g['dc-units-' + t]) + '|' + (g['dc-chk-' + t] === 'yes') !== String(next['dc-units-' + t]) + '|' + (next['dc-chk-' + t] === 'yes'); });
    var p30 = Math.round(100 * gaps['30'] / total), p50 = Math.round(100 * gaps['50'] / total), p60 = Math.max(0, 100 - p30 - p50);
    return { grid: next, changed: changed, kind: 'good', units: units, set: set, label: label, level: kind, shares: { 30: p30, 50: p50, 60: p60 },
      source: (meta.source || 'Census ACS renter affordability-gap counts') + ', ACS ' + meta.acs_year + ', HUD FY' + meta.hud_income_limits_year,
      text: (changed.length ? 'Set ' + units + ' homes' : 'No change: the rows already match ' + units + ' homes') + ' in proportion to the shortfall in ' + label + ' (' + (kind === 'place' ? 'town' : 'county') + ' figures): ' +
        p30 + '% at 30% AMI, ' + p50 + '% at 50% AMI, ' + p60 + '% at 60% AMI. Rows now: 30% AMI ' + u30 + ', 40% AMI 0, 50% AMI ' + u50 + ', 60% AMI ' + u60 + '. ' +
        'Rows from 70% to 120% AMI are left as they were. This is an allocation estimate, not a project commitment.' };
  }
  function prefillBar(p, s) {
    load();
    var n = notes[key(p.projectId, s.scenarioId)], f = n && n.prefill;
    return '<div class="site-prefill" data-no-source="the note names the file each count comes from">' +
      '<div class="actions"><button type="button" class="button-link secondary" data-action="ami-prefill">Pre-fill from local need</button></div>' +
      '<p class="note site-result' + (f && f.kind ? ' site-' + f.kind : '') + '" data-role="ami-prefill-meta" role="status">' +
      (f ? esc(f.text) + (f.source ? ' <small class="tax-src">' + esc(f.source) + '</small>' : '') : 'Sets the 30%, 50% and 60% AMI rows in proportion to the local shortfall of homes at each level, for the total homes above.') + '</p></div>';
  }

  // ---------- 4. concept recommendation ----------
  var SCRIPTS = [['js/data-connectors/hud-fmr.js', function () { return !!global.HudFmr; }],
    ['js/lihtc-deal-predictor.js', function () { return !!global.LIHTCDealPredictor; }],
    ['js/lihtc-concept-card-renderer.js', function () { return !!global.LIHTCConceptCardRenderer; }],
    ['js/lihtc-deal-predictor-enhanced.js', function () { return !!global.LIHTCDealPredictorEnhanced; }]];
  var scripts = {}, conceptData = { started: false, ready: false };
  // The live page loads these four in this order; each is fetched only when the one before it is in.
  function needScripts() {
    for (var i = 0; i < SCRIPTS.length; i++) {
      var path = SCRIPTS[i][0];
      if (SCRIPTS[i][1]()) continue;
      if (scripts[path] === 'failed') return 'failed';
      if (!scripts[path]) {
        scripts[path] = 1;
        var el = document.createElement('script');
        el.src = global.LAB_VENDOR + path;
        el.onload = patch;
        el.onerror = (function (f) { return function () { scripts[f] = 'failed'; patch(); }; }(path));
        document.body.appendChild(el);
      }
      return false;
    }
    return true;
  }
  // What the live page hands the predictor (_runDealPredictor): the county, the homes, whether a basis boost
  // designation is picked, and the county's shortfall by band. No funding amount and no market score.
  function conceptInputs(fips, units, designation, gapCounty) {
    var P = global.LIHTCDealPredictor;
    var inputs = { softFundingAvailable: null, pmaScore: null, geoid: fips || undefined, countyFips: fips || null, proposedUnits: units,
      isQct: ['qct', 'dda', 'sadda'].indexOf(designation) !== -1 };
    var county = null;
    ((gapCounty && gapCounty.counties) || []).forEach(function (c) { if (!county && fips && String(c.fips).padStart(5, '0') === String(fips).padStart(5, '0')) county = c; });
    var shortfall = county && P && P.amiShortfallFromCounty ? P.amiShortfallFromCounty(county) : null;
    if (shortfall) { Object.assign(inputs, shortfall); inputs.ami30Scope = 'area'; }
    return inputs;
  }
  function predict(fips, units, designation) {
    var inputs = conceptInputs(fips, units, designation, src.gapCounty);
    return global.LIHTCDealPredictorEnhanced ? global.LIHTCDealPredictorEnhanced.predictEnhanced(inputs).base : global.LIHTCDealPredictor.predictConcept(inputs);
  }
  function concept(d, inp, r) {
    last.concept = [d, inp, r];
    load();
    var fips = inp && inp.fields && inp.fields['dc-county-select'] || '';
    var head = '<section class="fin-section site-concept" aria-labelledby="fin-concept" data-role="concept" data-no-source="estimate: the site’s own early concept model; its reasons are listed"><h2 id="fin-concept">Concept recommendation</h2>';
    if (!fips) return head + '<p class="note">Pick a county to see the early concept screen for it.</p></section>';
    var have = needScripts();
    if (have === 'failed') return head + '<p class="note">The concept model did not load, so no recommendation is shown.</p></section>';
    if (!have || src.gapCounty === undefined) return head + '<p class="note" role="status">Loading the concept model…</p></section>';
    if (!conceptData.started) {
      conceptData.started = true;
      var P = global.LIHTCDealPredictor, H = global.HudFmr;
      Promise.all([P.whenMixDataReady ? P.whenMixDataReady() : null, H && H.load ? H.load().catch(function () { return null; }) : null])
        .then(function () { conceptData.ready = true; patch(); }, function () { conceptData.ready = true; patch(); });
    }
    if (!conceptData.ready) return head + '<p class="note" role="status">Loading the concept model’s data…</p></section>';
    var units = Number(r && r.units);
    if (!(units > 0)) return head + '<p class="note" data-role="concept-none">Enter the homes to screen this concept. No recommendation is shown, rather than one based on an assumed project size.</p></section>';
    var rec = predict(fips, units, d.fields['dc-boost-designation'] || '');
    var missing = Object.keys(rec.inputAvailability || {}).filter(function (k) { return rec.inputAvailability[k].unavailableReason; });
    var type = String(rec.conceptType || '');
    return head + '<p class="note">An early screen from the county, the number of homes and the county’s shortfall by income level. It does not read the costs, rents or loans above.</p>' +
      '<p data-role="concept-head"><strong>' + esc(rec.recommendedExecution + ' ' + type.charAt(0).toUpperCase() + type.slice(1) + ' Housing') + '</strong> <span class="note">' + esc(rec.confidence) + ' confidence</span></p>' +
      '<ul data-role="concept-why">' + (rec.keyRationale || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      (missing.length ? '<div class="callout" data-role="concept-missing"><strong>Missing inputs</strong><ul>' + missing.map(function (k) { var i = rec.inputAvailability[k]; return '<li>' + esc(i.label) + ': ' + esc(i.reason) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<div data-role="concept-mix">' + (global.LIHTCConceptCardRenderer && global.LIHTCConceptCardRenderer.mixCheckHtml ? global.LIHTCConceptCardRenderer.mixCheckHtml(rec.mixCheck) : '') + '</div>' +
      // The model's own caution, in its words.
      (global.LIHTCDealPredictor.DISCLAIMER ? '<p class="note" data-role="concept-disclaimer">' + esc(global.LIHTCDealPredictor.DISCLAIMER) + '</p>' : '') + '</section>';
  }

  // The Pre-fill button's work, on the saved draft. While a shortfall file is still on its way nothing is changed
  // and the press waits; if the county file never came, the rows are left as they were, not emptied.
  function doPrefill(pid, sid) {
    var P = global.LabProjects, F = global.LabFinancials, p = P.get(pid), k = key(pid, sid);
    if (!p) return;
    var d = F.draftFor(p, sid), G = global.LabCalcGrid ? global.LabCalcGrid.ctx(p, sid, d) : null;
    if (!G) return;
    function say(text, kind) { notes[k] = Object.assign({}, notes[k], { prefill: { text: text, kind: kind || '', source: '' } }); redraw(); }
    load();
    if (src.gapCounty === undefined || src.gapPlace === undefined) {
      if (!waiting.some(function (w) { return w[0] === pid && w[1] === sid; })) waiting.push([pid, sid]);
      return say('Loading the local shortfall figures…');
    }
    if (src.gapCounty === null) return say('The local shortfall figures did not load, so the rows are left as they were. Try again in a moment.', 'bad');
    // The live page allocates its Total Units field; here a blank total means the homes in the rows.
    var total = G.grid['dc-units'] !== '' && G.grid['dc-units'] != null ? G.grid['dc-units'] : global.LabCalcGrid.gridHomes(G.grid);
    var place = p.jurisdiction && /^\d{7}$/.test(String(p.jurisdiction.geoid || '')) ? String(p.jurisdiction.geoid) : null;
    var out = prefill(G.grid, total, place, src.gapPlace, src.gapCounty);
    d.grid = out.grid;
    notes[k] = Object.assign({}, notes[k], { prefill: { text: out.text, kind: out.kind, source: out.source || '' } });
    P.setOverride(pid, sid, 'financialsDraft', d);
    redraw();
  }

  // ---------- buttons ----------
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest && ev.target.closest('button[data-action="gsf-apply"], button[data-action="coords-detect"], button[data-action="coords-geo"], button[data-action="ami-prefill"]');
    var P = global.LabProjects, F = global.LabFinancials;
    if (!b || !P || !F) return;
    var at = route(), p = P.get(at[1]), form = b.form || b.closest('form');
    if (!p || !form) return;
    var pid = at[1], sid = at[2], d = F.readDraft(form, F.draftFor(p, sid)), act = b.dataset.action, k = key(pid, sid);
    var G = global.LabCalcGrid ? global.LabCalcGrid.ctx(p, sid, d) : null;
    if (act === 'gsf-apply') {
      var e = estimate(d, F.inputsFor(p, sid, d), G);
      if (!e || !e.result || e.result.status !== 'ok') return;
      d.fields['dc-gross-sf'] = String(e.result.grossSf);
      d.fields['site-gsf-derived'] = JSON.stringify({ sf: String(e.result.grossSf), std: e.result.standardId || 'estimate', text: e.working });
      P.setOverride(pid, sid, 'financialsDraft', d);
      return redraw();
    }
    if (act === 'ami-prefill') {
      if (!G) return;
      // Keep what the form holds, then fill from it; the rows change only once both files have answered.
      P.setOverride(pid, sid, 'financialsDraft', d);
      return doPrefill(pid, sid);
    }
    P.setOverride(pid, sid, 'financialsDraft', d);
    if (act === 'coords-detect') return lookup(pid, sid, parseFloat(d.fields['dc-coords-lat']), parseFloat(d.fields['dc-coords-lon']));
    if (act === 'coords-geo') {
      var say = function (text, kind) { notes[k] = Object.assign({}, notes[k], { coords: { text: text, kind: kind || '' } }); redraw(); };
      if (!navigator.geolocation) return say('This browser does not share a location.', 'bad');
      say('Asking the browser for your location…');
      navigator.geolocation.getCurrentPosition(function (pos) {
        var now = P.get(pid), nd = F.draftFor(now, sid);
        nd.fields['dc-coords-lat'] = pos.coords.latitude.toFixed(6);
        nd.fields['dc-coords-lon'] = pos.coords.longitude.toFixed(6);
        P.setOverride(pid, sid, 'financialsDraft', nd);
        lookup(pid, sid, pos.coords.latitude, pos.coords.longitude);
      }, function (err) { say('The browser did not share a location: ' + err.message, 'warn'); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
    }
  });

  global.LabCalcSite = { INPUTS: INPUTS, engineFields: engineFields, read: read, area: area, coords: coords, prefillBar: prefillBar, concept: concept,
    mix: mix, estimate: estimate, efficiency: efficiency, prefill: prefill, trio: trio, conceptInputs: conceptInputs, predict: predict, _src: src, _notes: notes };
})(typeof window !== 'undefined' ? window : globalThis);
