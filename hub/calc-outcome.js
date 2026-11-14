// The housing outcome in four parts, on Financials (paul, 14 Nov 2026: "four parts", "make sure it makes sense").
// It replaces the old Deal Calculator's Housing Outcome Score with four separate checks, each on its own data and
// source, never added up: no grade, no single number (lab rule: no universal score).
//   Need:      this deal's homes at or below 30%, 50% and 60% AMI beside the households at those levels with no
//              home they can afford, from the county or town record (data/co_ami_gap_by_county.json,
//              data/co_ami_gap_by_place.json). A missing count is said to be missing, never counted as covered.
//   Money:     the funding gap and its share of the cost, and coverage after stress, from this Financials run.
//   Place:     the local government's housing tools, from the housing policy scorecard
//              (data/policy/housing-policy-scorecard.json), each yes, no or not known.
//   Site:      the basis boost designation as entered here, with its evidence. The Market Analysis does not yet save
//              its site scores to a hub project, so they are said to be not measured, with a link to run it.
// The old score counted the Market Analysis site score twice and the QCT/DDA flag again, and counted missing need as
// covered; none of that is carried (deep dive: /mnt/project-files/cutover/calculator-move/housing-outcome-score-deep-dive.md).
(function (global) {
  'use strict';
  var FILES = { gapCounty: 'data/co_ami_gap_by_county.json', gapPlace: 'data/co_ami_gap_by_place.json', scorecard: 'data/policy/housing-policy-scorecard.json' };
  var src = {};   // each file: undefined while loading, null if it failed, else the file
  var started = false, last = null;
  var LEVELS = [30, 50, 60];

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function num(n) { return Math.round(n).toLocaleString('en-US'); }
  function money(n) { return (n < 0 ? '-$' : '$') + num(Math.abs(n)); }

  function load() {
    if (started) return;
    started = true;
    Object.keys(FILES).forEach(function (k) {
      fetch(global.LAB_VENDOR + FILES[k]).then(function (r) { if (!r.ok) throw new Error(FILES[k] + ' ' + r.status); return r.json(); })
        .then(function (d) { src[k] = d; patch(); }, function () { src[k] = null; patch(); });
    });
  }
  // A file arriving late redraws only this section, so a fold the reader opened elsewhere stays open.
  function patch() {
    var el = document.querySelector('[data-role="outcome"]');
    if (el && last) el.outerHTML = section.apply(null, last);
  }

  // A unit grid on market rents (no restricted limit): the engine prices every row at market rent whatever its label
  // (js/deal-engine.js tierRent), so none of its homes is restricted to an income level.
  function marketOnly(inputs, G) { return !!((G && G.grid && G.grid['dc-rent-limit-regime'] === 'market') || (inputs && inputs.regime === 'market' && !(inputs.resolvedDealMix && inputs.resolvedDealMix.available))); }
  // Homes by income level, from the saved schedule the engine ran on or from the unit grid. Restricted homes only.
  function homesByTier(inputs, G) {
    var out = {}, R = inputs && inputs.resolvedDealMix;
    if (marketOnly(inputs, G)) return out;
    if (R && R.available) {
      R.restrictedRows.forEach(function (r) { var t = Number(r.tier); if (isFinite(t) && r.units > 0) out[t] = (out[t] || 0) + r.units; });
      return out;
    }
    var g = G && G.grid;
    if (!g) return out;
    Object.keys(g).forEach(function (k) {
      var m = /^dc-units-(\d+)$/.exec(k);
      if (!m || g['dc-chk-' + m[1]] !== 'yes') return;
      var t = Number(m[1]), split = 0;
      Object.keys(g).forEach(function (k2) { var b = new RegExp('^dc-units-' + t + '-').test(k2) ? parseInt(g[k2], 10) : NaN; if (b > 0) split += b; });
      var n = split > 0 ? split : parseInt(g[k], 10);
      if (n > 0) out[t] = (out[t] || 0) + n;
    });
    return out;
  }
  function atOrBelow(byTier, level) { return Object.keys(byTier).reduce(function (s, t) { return Number(t) <= level ? s + byTier[t] : s; }, 0); }

  // The record the need part reads: the town's own while the deal's county is the town's county, else the county's.
  // Counts are households at or below each level with no home priced for them (households minus homes, never below 0).
  function needRecord(placeGeoid, fips) {
    var place = placeGeoid && src.gapPlace && src.gapPlace.places ? src.gapPlace.places[placeGeoid] || null : null;
    if (place && place.containing_county_fips && String(place.containing_county_fips) !== String(fips)) place = null;
    var county = ((src.gapCounty && src.gapCounty.counties) || []).filter(function (c) { return fips && String(c.fips).padStart(5, '0') === String(fips).padStart(5, '0'); })[0] || null;
    var rec = place || county, meta = place ? src.gapPlace.meta : src.gapCounty && src.gapCounty.meta;
    if (!rec || !meta) return null;
    var short = {};
    LEVELS.forEach(function (b) {
      var v;
      if (place) {
        var hh = Number((rec.households_le_ami_pct || {})[b]), un = Number((rec.units_priced_affordable_le_ami_pct || {})[b]);
        v = isFinite(hh) && isFinite(un) && (rec.households_le_ami_pct || {})[b] != null && (rec.units_priced_affordable_le_ami_pct || {})[b] != null ? Math.max(0, hh - un) : null;
      } else {
        var g = (rec.gap_units_minus_households_le_ami_pct || {})[b];
        v = g != null && g !== '' && isFinite(Number(g)) ? Math.max(0, -Number(g)) : null;
      }
      short[b] = v;
    });
    return { name: place ? rec.place_name || 'this town' : rec.county_name || 'this county', level: place ? 'town' : 'county', short: short,
      source: String(meta.source || 'Census ACS renter affordability-gap counts').replace(/[.\s]+$/, '') + (meta.acs_year ? ', ACS ' + meta.acs_year : '') + (meta.hud_income_limits_year ? ', HUD FY' + meta.hud_income_limits_year + ' income limits' : '') };
  }

  function part(title, status, kind, body, source, meaning) {
    return '<div class="outcome-part outcome-' + kind + '" data-part="' + esc(title.toLowerCase()) + '"><h3>' + esc(title) + ' <span class="outcome-status">' + esc(status) + '</span></h3>' +
      '<p class="outcome-meaning">' + esc(meaning) + '</p>' + body + (source ? '<p class="metric-source">' + source + '</p>' : '') + '</div>';
  }

  function needPart(p, inputs, G) {
    var meaning = 'Who this deal would house, beside the households in the area who have no home they can afford at each income level.';
    if (src.gapCounty === undefined || src.gapPlace === undefined) return part('Need', 'loading', 'none', '<p class="note">Loading the local shortfall figures…</p>', '', meaning);
    if (src.gapCounty === null) return part('Need', 'not measured', 'none', '<p class="note">The local shortfall figures did not load. Reload the page to try again.</p>', '', meaning);
    var fips = String(inputs.countyFips || (G && G.grid && G.grid['dc-county-select']) || (p.jurisdiction && p.jurisdiction.geoid || '').slice(0, 5));
    var geoid = p.jurisdiction && /^\d{7}$/.test(String(p.jurisdiction.geoid)) ? String(p.jurisdiction.geoid) : null;
    var rec = needRecord(geoid, fips), byTier = homesByTier(inputs, G), homes = LEVELS.map(function (b) { return atOrBelow(byTier, b); });
    if (!rec) return part('Need', 'not measured', 'none', '<p class="note">There is no shortfall record for this county or town, so this part is not measured. It is not counted as met.</p>', '', meaning);
    if (marketOnly(inputs, G)) return part('Need', 'no restricted homes', 'none', '<p class="note">This scenario prices every home at market rent (no rent limit), so none is kept for a household at a set income level, whatever row it sits in. There is nothing to set beside the need.</p>',
      esc(rec.source), meaning);
    if (!homes[2]) return part('Need', 'no homes at 60% AMI or below', 'none', '<p class="note">This deal has no homes at or below 60% AMI yet, so there is nothing to set beside the need. Add homes under Homes and affordability or in the unit grid.</p>',
      esc(rec.source), meaning);
    var rows = LEVELS.map(function (b, i) {
      var sh = rec.short[b], h = homes[i];
      var them = sh == null ? 'Households short of a home: not counted in the record, so not measured.'
        : sh === 0 ? 'Households short of a home: none counted. The record has more homes priced at this level than households, though many are rented by households with more income.'
        : 'Households short of a home in ' + rec.name + ': ' + num(sh) + '. This deal would house ' + (h / sh * 100 < 1 ? 'under 1%' : Math.round(h / sh * 100) + '%') + ' of them.';
      return '<li data-level="' + b + '"><strong>At or below ' + b + '% AMI</strong><br>This deal: ' + num(h) + ' home' + (h === 1 ? '' : 's') + '. ' + esc(them) + '</li>';
    }).join('');
    var gaps = LEVELS.filter(function (b) { return rec.short[b] == null; });
    return part('Need', homes[0] ? num(homes[0]) + ' of ' + num(homes[2]) + ' homes at or below 30% AMI' : 'no homes at or below 30% AMI, where the shortfall is deepest', homes[0] ? 'good' : 'warn',
      '<ul class="outcome-need">' + rows + '</ul>' +
      (gaps.length ? '<p class="note">Not counted at ' + gaps.join('% and ') + '% AMI in the record: that level is not measured, not met.</p>' : '') +
      '<p class="note">Each row counts everyone at or below that level, so the rows overlap. Homes priced for a level are not always available to the household; this counts homes, not who lives in them.</p>',
      esc(rec.source) + ' (' + esc(rec.level) + ' record)', meaning);
  }

  function moneyPart(r) {
    var meaning = 'Whether this Financials run pays for itself with the sources entered, and how it holds up under stress.';
    if (!r || r.gap == null) return part('Money', 'not measured', 'none', '<p class="note">This run has no funding gap yet: ' + esc(String((r && r.unavailable && r.unavailable.gap) || 'enter the costs and homes above').replace(/[.\s]+$/, '')) + '.</p>', '', meaning);
    var tdc = r.tdc != null ? r.tdc : r.totalDevelopmentCost, share = tdc > 0 ? r.gap / tdc * 100 : null;
    var st = r.stress && r.stress.combined && r.stress.combined.dscr;
    var lines = '<ul><li>' + (r.gap > 0 ? 'Funding gap ' + money(r.gap) + (share != null ? ', ' + share.toFixed(1) + '% of the total development cost' : '') + '.' : 'No funding gap: the sources entered cover the costs.') + '</li>' +
      (st != null && isFinite(st) ? '<li>Coverage after the stress test: ' + st.toFixed(2) + 'x' + (st < 1 ? ': under the stress test above, income would not cover the loan payments.' : ': under the stress test above, income still covers the loan payments.') + '</li>' : '') + '</ul>';
    return part('Money', r.gap > 0 ? 'gap to fill' : 'pays for itself', r.gap > 0 ? 'warn' : 'good', lines, 'This Financials run, on the inputs above.', meaning);
  }

  var POLICY = [['prop123_committed', 'Proposition 123 commitment filed'], ['has_housing_authority', 'Housing authority'], ['has_housing_nonprofits', 'Housing nonprofits working here'],
    ['has_local_funding', 'Local affordable housing funding'], ['has_iz_ordinance', 'Zoning incentives or inclusionary ordinance'], ['has_comp_plan', 'Housing in the comprehensive plan'], ['has_hna', 'Housing needs assessment']];
  function placePart(p) {
    var meaning = 'The local government’s housing tools a deal can lean on. It describes the place, not this deal.';
    if (src.scorecard === undefined) return part('Place', 'loading', 'none', '<p class="note">Loading the housing policy scorecard…</p>', '', meaning);
    var g = p.jurisdiction && String(p.jurisdiction.geoid || '');
    var e = src.scorecard && src.scorecard.scores && g ? src.scorecard.scores[g] : null;
    if (!e) return part('Place', 'not measured', 'none', '<p class="note">' + (src.scorecard === null ? 'The housing policy scorecard did not load.' : 'The housing policy scorecard has no entry for this project’s place' + (g ? '' : ': pick a place on the project page') + '.') + '</p>', '', meaning);
    var yes = 0, known = 0;
    var items = POLICY.map(function (d) {
      var v = e.dimensions ? e.dimensions[d[0]] : null;
      if (v === true || v === false) { known++; if (v) yes++; }
      return '<li><span class="outcome-flag outcome-flag-' + (v === true ? 'yes' : v === false ? 'no' : 'unknown') + '">' + (v === true ? 'Yes' : v === false ? 'No' : 'Not known') + '</span> ' + esc(d[1]) + '</li>';
    }).join('');
    var date = src.scorecard.metadata && String(src.scorecard.metadata.generatedAt || '').slice(0, 10);
    return part('Place', yes + ' of 7 tools in place' + (known < 7 ? ', ' + (7 - known) + ' not known' : ''), 'info', '<ul class="outcome-flags">' + items + '</ul>' +
      '<p class="note"><a href="#/places/incentives/' + esc(g) + '">Local housing tools for ' + esc(e.name) + '</a></p>',
      'Housing policy scorecard for ' + esc(e.name) + (date ? ', built ' + esc(date) : '') + ', from the state Proposition 123 filings, local resource lists and zoning records it names.', meaning);
  }

  var DESIGNATION = { qct: 'Qualified Census Tract (QCT)', dda: 'Difficult Development Area (DDA)', sadda: 'Small Area DDA (SADDA)', chfa: 'CHFA basis boost' };
  function sitePart(p, fields) {
    var meaning = 'What is known about the site itself. The site’s access, feasibility and market scores come from the Market Analysis.';
    var key = fields && fields['dc-boost-designation'], ev = fields && String(fields['dc-boost-evidence'] || '').trim();
    var g = p.jurisdiction && p.jurisdiction.geoid ? '?g=' + encodeURIComponent(p.jurisdiction.geoid) : '';
    var desig = DESIGNATION[key] ? '<li>Basis boost designation entered: ' + esc(DESIGNATION[key]) + (ev ? ' (evidence: ' + esc(ev) + ')' : ', with no evidence entered yet') + '.</li>'
      : '<li>No basis boost designation entered. Check HUD’s maps and lists under the basis boost above.</li>';
    return part('Site', 'Market Analysis not saved here yet', 'none', '<ul>' + desig +
      '<li>The Market Analysis scores a site\u2019s access, feasibility and market, but it does not yet save them to a project here, so they are not measured in this part. <a href="#/market' + esc(g) + '">Market check for this place</a>.</li></ul>',
      'The designation is as entered on this page; the boost counts only with evidence, as the note under it says.', meaning);
  }

  function section(p, d, inputs, r, G) {
    return '<section class="fin-section outcome" data-role="outcome" aria-labelledby="fin-outcome"><h2 id="fin-outcome">Housing outcome in four parts</h2>' +
      '<p>Four separate checks, each with its own source. They are not added up: there is no grade and no single score, because each part answers a different question and a strong part cannot make up for a weak one.</p>' +
      '<div class="outcome-parts">' + needPart(p, inputs, G) + moneyPart(r) + placePart(p) + sitePart(p, inputs && inputs.fields || d.fields) + '</div></section>';
  }

  function render(p, d, inputs, r, G) {
    load();
    last = [p, d, inputs, r, G];
    return section(p, d, inputs, r, G);
  }

  global.LabCalcOutcome = { render: render, homesByTier: homesByTier, marketOnly: marketOnly, atOrBelow: atOrBelow, _needRecord: needRecord, _src: src, FILES: FILES };
})(window);
