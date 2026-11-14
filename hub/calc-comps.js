// Calculator move, piece E, part 2: the live Deal Calculator's "CHFA portfolio comparables" on Financials.
// The five tax credit projects most like this deal in Colorado's affordable property list
// (data/affordable-housing/properties.json), ranked by the live page's own similarity points: county 40 (8 for another
// Colorado county), size up to 25, credit type 15, project type 10, award recency 10. The scoring below is
// js/deal-calculator.js _initChfaComparables at the pin, copied line for line (it sits inside a closure there and
// cannot be called); qa/calc-comps-live.js compares the two pages' five projects and points.
// The live page reads its Total Units box and its 9%/4% choice; it has no project type control, so every proposed
// deal counts as new construction there, and here.
(function (global) {
  'use strict';
  var FILE = 'data/affordable-housing/properties.json';
  var state = { data: undefined }, last = null;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // ---- copied from js/deal-calculator.js (_initChfaComparables) ----
  function normCreditType(s) {
    if (!s) return null;
    var t = String(s).toLowerCase();
    if (/9.?%|9pct|9-?per/.test(t)) return '9%';
    if (/4.?%|4pct|4-?per|tax.?exempt|bond/.test(t)) return '4%';
    return null;
  }
  function propProjectType(prop) {
    var pt = String(prop.project_type || '').toLowerCase();
    var cat = String(prop.property_category || '').toLowerCase();
    if (/preserv|rehab|acq/.test(pt) || /preserv|subsidized/.test(cat)) return 'preservation';
    return 'new';
  }
  function scoreProp(prop, ctx) {
    var s = 0;
    var propFips = String(prop.county_fips || '').padStart(5, '0');
    if (ctx.countyFips && propFips === ctx.countyFips) s += 40;
    else if (ctx.countyFips && propFips.substring(0, 2) === ctx.countyFips.substring(0, 2)) s += 8;
    var u = +prop.total_units || +prop.assisted_units || 0;
    if (ctx.proposedUnits > 0 && u > 0) {
      var ratio = Math.min(u, ctx.proposedUnits) / Math.max(u, ctx.proposedUnits);
      s += Math.round(25 * ratio);
    }
    var credit = normCreditType(prop.type_of_credits);
    if (credit && ctx.proposedCredit && credit === ctx.proposedCredit) s += 15;
    if (propProjectType(prop) === ctx.proposedProject) s += 10;
    var yr = +prop.award_year || +prop.reservation_year || +prop.year_placed_in_service || 0;
    if (yr >= 2020) s += 10;
    else if (yr >= 2015) s += 5;
    else if (yr >= 2010) s += 2;
    return s;
  }
  function comparables(props, ctx) {
    var lihtc = props.filter(function (p) { var pt = p.program_type; return Array.isArray(pt) && pt.some(function (t) { return /lihtc/i.test(t); }); });
    return lihtc.map(function (p) { return { prop: p, score: scoreProp(p, ctx) }; })
      .filter(function (r) { return r.score > 0; })
      .sort(function (a, b) { if (b.score !== a.score) return b.score - a.score; var yA = +a.prop.award_year || 0, yB = +b.prop.award_year || 0; return yB - yA; })
      .slice(0, 5);
  }
  // ---- end of the copy ----

  function load() {
    if (state.data !== undefined || state.loading) return;
    state.loading = true;
    fetch(global.LAB_VENDOR + FILE).then(function (r) { if (!r.ok) throw new Error(FILE + ' ' + r.status); return r.json(); })
      .then(function (j) { state.data = j && Array.isArray(j.properties) ? j : null; patch(); }, function () { state.data = null; patch(); });
  }
  function patch() {
    var el = document.querySelector('[data-role="chfa-comps"]');
    if (el && last) {
      var open = el.querySelector('details') && el.querySelector('details').open;
      el.outerHTML = section.apply(null, last);
      var d = document.querySelector('[data-role="chfa-comps"] details');
      if (d && open) d.open = true;
    }
  }

  // What the live page reads: the county, its Total Units box (dc-units, the homes the schedule or the grid adds up to),
  // its 9%/4% choice. It has no project type control, so the proposed deal is new construction.
  function context(inputs) {
    var f = inputs.fields || {};
    return { countyFips: inputs.countyFips ? String(inputs.countyFips).padStart(5, '0') : null, proposedUnits: +f['dc-units'] || 0,
      proposedCredit: f['dc-rate-4'] ? '4%' : '9%', proposedProject: 'new' };
  }

  function section(inputs) {
    var head = '<section class="fin-section" data-role="chfa-comps" aria-labelledby="fin-comps"><h2 id="fin-comps">CHFA portfolio comparables</h2><details id="fin-comps-fold"><summary>Five tax credit projects like this deal</summary>';
    var ctx = context(inputs);
    var body;
    if (!ctx.countyFips) body = '<p class="note">Choose a county to see comparables.</p>';
    else if (state.data === undefined) body = '<p class="note" role="status">Loading Colorado’s affordable property list…</p>';
    else if (state.data === null) body = '<p class="note">The affordable property list did not load, so no comparables can be shown. This is a loading failure, not a sign that none exist. Reload the page to try again.</p>';
    else {
      var list = comparables(state.data.properties, ctx), meta = state.data.metadata || {};
      var src = '<p class="metric-source">Source: Colorado affordable property list, ' + esc(state.data.properties.length.toLocaleString('en-US')) + ' records merged from <a href="https://www.chfainfo.com/rental-housing/housing-credit/">CHFA Housing Tax Credit properties ↗</a>, HUD Multifamily and CHFA preservation lists' +
        (meta.generated || meta.generatedAt || meta.built ? ', built ' + esc(String(meta.generated || meta.generatedAt || meta.built).slice(0, 10)) : '') + '. Equity prices, loans and coverage are not public, so these match on what is published only.</p>';
      body = '<p class="note">Ranked by the full Deal Calculator’s similarity points: same county 40 (another Colorado county 8), size up to 25, same credit type 15, project type 10, award since 2020 10 (2015 to 2019 5, 2010 to 2014 2), out of 100, shown in the Similarity column. ' +
        'This deal: ' + esc(String(ctx.proposedUnits)) + ' homes, ' + esc(ctx.proposedCredit) + ' credits, new construction. Similarity ranks the list; it says nothing about how well a project did.</p>' +
        (list.length ? '<div class="table-scroll" role="region" aria-label="CHFA portfolio comparables" tabindex="0"><table data-role="comps"><thead><tr><th scope="col">Project and city</th><th scope="col" class="num">Award year</th><th scope="col" class="num">Homes</th><th scope="col">Credit</th><th scope="col" class="num">Similarity</th></tr></thead><tbody>' +
          list.map(function (x) {
            var p = x.prop;
            return '<tr><td><span class="cmp-name">' + esc(p.property_name || 'Unknown') + '</span><br><small class="cmp-city">' + esc(p.city || '') + '</small></td><td class="num">' + esc(String(p.award_year || p.year_placed_in_service || '—')) + '</td><td class="num">' + esc(String(p.total_units || p.assisted_units || 0)) +
              '</td><td>' + esc(normCreditType(p.type_of_credits) || '—') + '</td><td class="num">' + esc(String(x.score)) + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<p class="note">No comparable tax credit projects were found. Try the other credit type or another county.</p>') + src;
    }
    return head + body + '</details></section>';
  }

  function render(inputs) {
    load();
    last = [inputs];
    return section(inputs);
  }

  global.LabCalcComps = { render: render, comparables: comparables, scoreProp: scoreProp, normCreditType: normCreditType, propProjectType: propProjectType, context: context, FILE: FILE, _state: state };
})(window);
