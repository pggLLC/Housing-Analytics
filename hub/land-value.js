// Land value (#/opportunity/land-value): the live tool's own arithmetic (js/components/land-value-tool.js,
// window.LandValueTool) behind a Tool-template form. Inputs live in the hash, so a result can be shared and Back
// restores it. The lab adds no arithmetic of its own: comps, residual, negotiation band and confidence are the
// module's.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl;
  var esc = Shell.esc;
  var LIVE = 'https://cohoanalytics.com/land-value.html';
  // The sales table opens with four rows. "Add a sale" adds one at a time (rows= in the address), up to MAX_COMPS;
  // the live tool's own form adds rows the same way, and its arithmetic takes any number of sales.
  var COMPS = 4, MAX_COMPS = 20;

  var FIELDS = [
    { id: 'acres', label: 'Site size (acres)', step: '0.1', ex: '3.5' },
    { id: 'units', label: 'Proposed homes', step: '1', ex: '60' },
    { id: 'tdc', label: 'Development cost, without land', step: '100000', ex: '18000000', money: true },
    { id: 'eq', label: 'Equity and first mortgage', step: '100000', ex: '16000000', money: true },
    { id: 'soft', label: 'Soft sources (state, HOME, local)', step: '50000', ex: '1500000', money: true },
    { id: 'def', label: 'Deferred developer fee', step: '50000', ex: '500000', money: true },
    { id: 'off', label: 'Off-site costs (roads, utilities)', step: '50000', ex: '250000', money: true },
    { id: 'rem', label: 'Cleanup costs', step: '50000', ex: '0', money: true },
    { id: 'disc', label: 'Public land discount (%)', step: '5', ex: '50' }
  ];
  // The live tool's "Asking price or land value" input (land-value.html, id lvtAsk), kept out of FIELDS so the
  // fieldset slices above stay as they are.
  var ASK = { id: 'ask', label: 'Asking price or land value', step: '50000', ex: '1200000', money: true };
  var ZONING = [['', 'Not set'], ['mf-right', 'Multifamily by right'], ['mf-cup', 'Multifamily with a conditional use permit'], ['rezone', 'Needs rezoning'], ['mixed', 'Mixed use'], ['commercial', 'Commercial, to convert'], ['other', 'Other']];
  var CONF = { moderate: 'Moderate', low: 'Low', 'very-low': 'Very low' };

  function money(n) { return n == null ? '—' : n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : '$' + Math.round(n).toLocaleString('en-US'); }
  function val(p, k) { var v = parseFloat(p.get(k)); return isFinite(v) ? v : 0; }

  // How many sale rows to draw: four, or more when the address asks for them (rows=) or already holds a later sale.
  function rowCount(p) {
    var asked = Math.floor(val(p, 'rows')), last = 0;
    p.forEach(function (v, k) { var m = /^c(\d+)[dapy]$/.exec(k); if (m && v !== '') last = Math.max(last, Number(m[1])); });
    return Math.min(MAX_COMPS, Math.max(COMPS, asked, last));
  }

  // Builds the module's state from the hash, the same fields its own form reads.
  function stateFrom(p) {
    var comps = [];
    for (var i = 1, n = rowCount(p); i <= n; i++) {
      var a = val(p, 'c' + i + 'a'), pr = val(p, 'c' + i + 'p');
      if (a > 0 && pr > 0) comps.push({ description: p.get('c' + i + 'd') || '', acres: a, price: pr, pricePerAcre: pr / a, date: p.get('c' + i + 'y') || '' });
    }
    return {
      siteAcres: val(p, 'acres'), totalUnits: val(p, 'units'), zoning: p.get('zoning') || '',
      tdc: val(p, 'tdc'), equityAndDebt: val(p, 'eq'), softSources: val(p, 'soft'), deferredFee: val(p, 'def'),
      offSiteCosts: val(p, 'off'), remediationCosts: val(p, 'rem'), publicLandDiscount: val(p, 'disc'), askingPrice: val(p, 'ask'), comps: comps
    };
  }

  function result(st) {
    var L = global.LandValueTool;
    var comps = L.analyzeComps(st.comps, st.siteAcres);
    var hasResidual = st.tdc > 0 && st.equityAndDebt > 0;
    var res = hasResidual ? L.computeResidual(st) : null;
    var band = L.computeNegotiationBand(comps, res, st.publicLandDiscount);
    var conf = L.computeConfidence(st);
    // The live tool's own check of the price on the table against the most the deal can pay (null when no price).
    var ask = L.evaluateAsk ? L.evaluateAsk(st.askingPrice, res, st.publicLandDiscount, st.totalUnits) : null;
    return { comps: comps, res: res, band: band, conf: conf, ask: ask };
  }

  // The negotiation band as one horizontal scale: each party's number is a marked point.
  function bandChart(b, ask) {
    var pts = [ask ? ['Asking price you entered', ask.ask, 'lv-seller'] : ['Seller’s likely ask', b.seller, 'lv-seller'], ['Market value', b.market, 'lv-market'], ['Most the deal can pay', b.developer, 'lv-dev'], ['Price with the public discount', b.publicPartner, 'lv-public']].filter(function (x) { return x[1] > 0; });
    if (pts.length < 2) return '';
    var max = Math.max.apply(null, pts.map(function (x) { return x[1]; })) * 1.05;
    // With a price entered the title uses it after any public discount, the same figure as the asking price card.
    var top = ask ? ask.net : b.seller, who = ask ? 'asking price you entered' + (ask.discountPct ? ', after the ' + ask.discountPct + '% discount,' : '') : 'seller\u2019s likely ask';
    var gap = top > 0 && b.developer > 0 ? top - b.developer : null;
    // Gemini round 16, pick 1 (paul 11-05): the finding is the title; "Where the numbers land" was the old title.
    var finding = gap == null ? 'Where the numbers land' : gap > 0 ? 'The ' + who + ' is ' + money(gap) + ' above the most the deal can pay' : 'The deal can pay ' + money(-gap) + ' more than the ' + who;
    return '<figure class="lv-band"><figcaption><strong>' + esc(finding) + '</strong><span class="note">' +
      esc(gap == null ? 'Each mark is one side\u2019s number.' : 'What land like this sells for, against the most the deal can pay. Each mark is one side\u2019s number.') + '</span></figcaption>' +
      '<ul class="lv-rows">' + pts.map(function (x) {
        return '<li><span class="lv-label">' + esc(x[0]) + '</span><span class="lv-track"><span class="lv-bar ' + x[2] + '" style="width:' + (x[1] / max * 100).toFixed(2) + '%" title="' + esc(x[0] + ': ' + money(x[1])) + '"></span></span><span class="bar-value">' + esc(money(x[1])) + '</span></li>';
      }).join('') + '</ul></figure>';
  }

  // How to read the two values and the band, from the live page's own guidance, in plain words. The example
  // is the live page's own (checked there by test/explanatory-diagrams.test.js): parts add to each total.
  var EX = { raise: [['Equity and first mortgage', 18.0], ['Soft sources', 2.0], ['Deferred developer fee', 0.8]],
    cost: [['Hard costs', 14.0], ['Soft costs', 3.0], ['Developer fee', 2.3]], ask: 2.0 };
  // Gemini round 10, pick A, and round 16, page 10 (paul 11-06 "fix the gaps"): the first phone screen shows the
  // page's question as a picture, from the same worked example as the guide below: the seller's ask against the
  // most the deal can pay. Example figures, labelled as such.
  function exampleStrip() {
    var sum = function (a) { return a.reduce(function (t, x) { return t + x[1]; }, 0); };
    var left = sum(EX.raise) - sum(EX.cost), max = Math.max(EX.ask, left, 0.1);
    var m = function (v) { return '$' + v.toFixed(1) + 'M'; };
    var finding = 'Example: the seller asks ' + m(EX.ask) + ', the deal can pay ' + m(left) + (EX.ask > left ? ', ' + m(EX.ask - left) + ' short' : '');
    var row = function (label, v, cls) { return '<li><span class="lv-label">' + esc(label) + '</span><span class="lv-track"><span class="lv-bar ' + cls + '" style="width:' + (Math.max(0, v) / max * 100).toFixed(1) + '%"></span></span><span class="lv-v"><b>' + m(v) + '</b></span></li>'; };
    return '<figure class="lv-band lv-strip" data-no-source="example: figures labelled as an example, not a real deal" aria-label="' + esc(T.alt(finding, 'COHO Land value worked example')) + '"><figcaption><strong>' + esc(finding) + '</strong></figcaption>' +
      '<ul class="lv-rows" aria-hidden="true">' + row('What the seller asks', EX.ask, 'lv-seller') + row('Most the deal can pay', left, 'lv-dev') + '</ul>' +
      '<p class="note">Example figures, not a real deal. Enter your site below to see your own.</p></figure>';
  }

  function guide() {
    var sum = function (a) { return a.reduce(function (t, x) { return t + x[1]; }, 0); };
    var R = sum(EX.raise), C = sum(EX.cost), left = R - C, max = Math.max(R, C);
    var m = function (v) { return '$' + v.toFixed(1) + 'M'; };
    var bar = function (label, parts, cls) {
      return '<li><span class="lv-label">' + esc(label) + ' ' + m(sum(parts)) + '</span><span class="lv-stack">' + parts.map(function (x, i) {
        return '<span class="lv-seg ' + cls + i + '" style="width:' + (x[1] / max * 100).toFixed(2) + '%" title="' + esc(x[0] + ': ' + m(x[1])) + '"></span>';
      }).join('') + '</span><span class="lv-parts">' + parts.map(function (x) { return esc(x[0]) + ' ' + m(x[1]); }).join(' · ') + '</span></li>';
    };
    return '<section class="tool-section lv-guide"><h2>How this tool is used in practice</h2>' +
      '<p>A site has two values. One is what land like it sells for. The other is what an affordable project can pay and still close. The tool shows both and the room between them.</p>' +
      '<h3>Market value from comparables</h3>' +
      '<p>This is how an appraiser starts: recent sales of similar land nearby. Enter at least three sales with acres, price and year. The tool takes the median price an acre and applies it to your site. The lowest and highest sales give the range.</p>' +
      '<ul><li><strong>County assessor:</strong> sales are public record, usually free online (for example <a href="https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Department-of-Finance/Our-Divisions/Assessors-Office">Denver</a> or <a href="https://www.bouldercounty.org/property-and-land/assessor/">Boulder County</a>).</li>' +
      '<li><strong>CoStar, LoopNet or the MLS:</strong> filter by land use, zoning and sale date. Paid, or through a broker.</li>' +
      '<li><strong>Other developers:</strong> multifamily land often sells off-market and never shows up in a database.</li>' +
      '<li><strong>CHFA tax credit applications:</strong> past deals disclose what they paid for land. See <a href="#/deals">Deal summaries</a>.</li></ul>' +
      '<p class="note">Keep sales to the same zoning, similar entitlement and the last 12 to 24 months. A two-acre infill lot in Denver is not a comp for 20 acres in Weld County. Treat transit, flood risk and utilities as judgment, not a dollar adjustment.</p>' +
      '<h3>Residual land value</h3>' +
      '<p>This starts from the deal: what the project can raise, less what it costs to build without land. What is left is the most it can pay for land.</p>' +
      '<figure class="lv-band lv-residual" data-no-source="example: figures labelled as an example, not a real deal"><figcaption><strong>An example: ' + m(R) + ' raised less ' + m(C) + ' to build leaves ' + m(left) + ' for land</strong><span class="note">Example figures, not a real deal.</span></figcaption><ul class="lv-rows">' +
      bar('What the project can raise', EX.raise, 'lv-r') + bar('What it costs to build, without land', EX.cost, 'lv-c') + '</ul>' +
      '<p class="note">The seller asks ' + m(EX.ask) + ', so this deal is ' + m(EX.ask - left) + ' short. It needs a land discount, public land, a seller carry-back note or more soft money.</p></figure>' +
      '<p>"Equity and first mortgage" is whatever funds your deal: tax credit equity plus a first mortgage, conventional debt for workforce housing, or housing authority or land trust capital. Soft sources are grants and soft loans (CHFA, DOH, HOME or a local fund). The deferred fee is the part of the developer fee paid later from cash flow; enter $0 if none.</p>' +
      '<p>Where resort land prices are set by luxury demand, the residual often sits below market. The usual fixes are housing authority land, a long ground lease, the <a href="https://coloradoaffordablehousingfinancingfund.com/land-banking/">Prop 123 land banking program</a>, an employer’s land, or a negotiated community benefit.</p>' +
      '<h3>Negotiation band interpretation</h3><ul class="lv-reading">' +
      '<li><strong>Most the deal can pay is at or above market value.</strong> The project can afford market land. Negotiate from strength.</li>' +
      '<li><strong>Between the public-discount price and market value.</strong> It needs a below-market deal; housing authority or Prop 123 land banking help can close it.</li>' +
      '<li><strong>Above zero but below the public-discount price.</strong> A big gap. Expect a ground lease, donated land or a seller carry-back note.</li>' +
      '<li><strong>Zero or less.</strong> The deal cannot pay anything for land. Don’t pursue it unless land is donated.</li></ul>' +
      '<h3>Further reading</h3><ul>' +
      '<li><a href="https://www.appraisalinstitute.org">Appraisal Institute</a>: the MAI directory, and the sales-comparison and residual methods in full.</li>' +
      '<li><a href="https://www.novoco.com/resource-centers/affordable-housing-tax-credits">Novogradac tax credit resource center</a>: land valuation from the developer’s side.</li>' +
      '<li><a href="https://www.cohnreznick.com/industries/affordable-housing">CohnReznick affordable housing</a>: operating benchmarks behind residual assumptions.</li>' +
      '<li><a href="https://coloradoaffordablehousingfinancingfund.com/land-banking/">Prop 123 land banking</a>: Colorado money to buy land for future affordable homes, for tax credit and other deals.</li></ul></section>';
  }

  // The asking price check, in the live tool's own words (js/components/land-value-tool.js, _renderResults).
  function askCard(a, units) {
    if (!a) return '';
    var per = a.perUnit != null && units > 0 ? ' (' + money(a.perUnit) + ' a home)' : '';
    var say = a.verdict === 'free' ? 'With the discount the land costs nothing, so the deal can take the site.'
      : a.verdict === 'fits' ? 'The deal can pay this price, with ' + money(a.room) + ' to spare' + per + '.'
      : a.verdict === 'short' ? 'The deal is ' + money(-a.room) + ' short of this price' + per + '. It covers ' + Math.round(a.covered * 100) + '% of it.'
      : a.verdict === 'unknown' ? 'Enter the development cost and the sources to check this price.'
      : 'The deal cannot pay anything for land, so it cannot pay this price.';
    var close = a.room != null && a.room < 0 ? ' Ways to close it: a lower price, a public land discount or ground lease, a seller carry-back note, or more soft money. Land is not in eligible basis, so tax credits will not cover it.' : '';
    return '<div class="metric lv-ask"><p class="metric-title">Can the deal pay the asking price?</p><p class="metric-value">' +
      esc(a.verdict === 'unknown' ? 'Not known yet' : a.room == null || a.verdict === 'free' ? 'Yes' : a.room >= 0 ? 'Yes, ' + money(a.room) + ' to spare' : 'No, ' + money(-a.room) + ' short') + '</p>' +
      '<p class="metric-detail">' + esc('Price ' + (a.discountPct ? 'after the ' + a.discountPct + '% discount ' : '') + money(a.net) + (a.max == null ? '' : ', against ' + money(a.max) + ' the deal can pay') + '. ' + say + close) + '</p></div>';
  }

  // One row of the sales table, and what sits under it: "Add a sale", or a line once the table is full.
  function compRow(i, p) {
    var v = function (k) { return esc((p && p.get('c' + i + k)) || ''); };
    return '<tr><th scope="row">' + i + '</th>' +
      '<td><input type="text" data-lv="c' + i + 'd" value="' + v('d') + '" aria-label="Sale ' + i + ' address or note"></td>' +
      '<td><input type="number" min="0" step="0.1" data-lv="c' + i + 'a" value="' + v('a') + '" aria-label="Sale ' + i + ' acres"></td>' +
      '<td><input type="number" min="0" step="10000" data-lv="c' + i + 'p" value="' + v('p') + '" aria-label="Sale ' + i + ' price"></td>' +
      '<td><input type="text" data-lv="c' + i + 'y" value="' + v('y') + '" aria-label="Sale ' + i + ' year" placeholder="2025"></td></tr>';
  }
  function addSale(rows) {
    return rows < MAX_COMPS ? '<button type="button" class="button-link secondary" data-lv-add="1">Add a sale</button>'
      : '<span class="note" tabindex="-1" data-lv-full="1">' + MAX_COMPS + ' sales is the most this page takes.</span>';
  }
  // ---- Sales found near the site (js/land-comps.js) ------------------------------------------------------------
  // The free site shows the summary only: how many sales, the rules that picked them, the spread, the middle and
  // where the asking price ranks. Each sale is listed on the member site brief; the state forbids resale of rows.
  var auto = { key: '', state: 'idle', summary: null, county: null, error: '', accessed: '' };
  var MEMBER_BRIEF = 'https://coho-backend.communityplanner.workers.dev/developer-site-brief.html';
  function autoKey(p) { return (p.get('addr') || '').trim().toLowerCase() + '|' + val(p, 'acres'); }
  function perAcre(n) { return Number.isFinite(n) ? money(n) + ' an acre' : '—'; }
  function yr(d) { return d ? d.slice(0, 4) : ''; }

  // A strip of the sales' $ per acre on a spread-out (log) scale, so a $20,000 and a $2 million acre both show:
  // the middle half as a box, the middle as a line, the asking price as a mark.
  function spreadStrip(s) {
    if (!(s.count >= 3) || !(s.ppaMin > 0)) return '';
    // The scale runs over the sales and the asking price together, and its end labels name its real ends.
    var bottom = Math.min(s.ppaMin, s.ask && s.ask.ppa > 0 ? s.ask.ppa : Infinity), top = Math.max(s.ppaMax, s.ask ? s.ask.ppa : 0, bottom * 1.01);
    var lo = Math.log(bottom), hi = Math.log(top);
    var x = function (v) { return Math.max(0, Math.min(100, (Math.log(v) - lo) / (hi - lo) * 100)).toFixed(1) + '%'; };
    var ask = s.ask ? '<span class="lvs-ask" style="left:' + x(s.ask.ppa) + '" title="' + esc('Asking price: ' + perAcre(s.ask.ppa)) + '"></span>' : '';
    return '<div class="lvs-strip" aria-hidden="true"><span class="lvs-track"></span>' +
      '<span class="lvs-box" style="left:' + x(s.q1) + ';width:calc(' + x(s.q3) + ' - ' + x(s.q1) + ')"></span>' +
      '<span class="lvs-mid" style="left:' + x(s.median) + '"></span>' + ask + '</div>' +
      '<p class="lvs-ends note" aria-hidden="true"><span>' + esc(money(bottom)) + '</span><span>' + esc(money(top)) + ' an acre</span></p>' +
      '<p class="note lvs-key"><span class="lvs-ki"><span class="lvs-k lvs-k-box"></span>Middle half of sales</span><span class="lvs-ki"><span class="lvs-k lvs-k-mid"></span>Middle</span>' + (s.ask ? '<span class="lvs-ki"><span class="lvs-k lvs-k-ask"></span>Asking price</span>' : '') + '</p>' +
      '<p class="note">Spread-out scale, so low and high sales both show.</p>';
  }

  function autoPanel(p) {
    var L = global.LandComps;
    if (!L || !global.CohoGeocode) return '';
    var head = '<h2>Land sales near the site</h2>';
    if (!(p.get('addr') || '').trim()) return head + '<p class="note">Enter the site’s address and acres, then press “Find sales”. CoHO looks up recorded sales of vacant land nearby.</p>';
    if (!(val(p, 'acres') > 0)) return head + '<p class="note">Enter the site’s acres too, so CoHO can pick land of a similar size.</p>';
    if (auto.key !== autoKey(p) || auto.state === 'idle') return head + '<p class="note">Press “Find sales” to look up recorded land sales near this address.</p>';
    if (auto.state === 'busy') return head + '<p class="note" role="status">Looking up sales near the site…</p>';
    if (auto.state === 'error') return head + '<p class="callout">' + esc(auto.error) + '</p>';
    var s = auto.summary, r = s.rule, ask = val(p, 'ask');
    var finding = s.count >= L.MIN_FOR_MIDDLE ? 'Vacant land like this sold for a middle of ' + perAcre(s.median)
      : s.count ? 'Only ' + s.count + (s.count === 1 ? ' sale' : ' sales') + ' found: too few for a middle value' : 'No recorded vacant-land sales found nearby';
    var rows = [];
    if (s.count) rows.push(['Sales found', s.count + ' vacant-land ' + (s.count === 1 ? 'sale' : 'sales') + ' within ' + s.milesMax.toFixed(1) + ' miles, ' + (Math.round(s.acresMin * 10) / 10) + ' to ' + (Math.round(s.acresMax * 10) / 10) + ' acres, sold ' + (yr(s.dateMin) === yr(s.dateMax) ? yr(s.dateMin) : yr(s.dateMin) + ' to ' + yr(s.dateMax)) + '.']);
    rows.push(['How they were picked', 'Within ' + r.miles + ' miles, ' + r.lo + ' to ' + r.hi + ' times the site’s acres, sold since ' + yr(r.since) + ', vacant land only.' + (s.widened ? ' Widened from 5 miles and 2023 because fewer than ' + L.ENOUGH + ' sales were found.' : '')]);
    if (s.count >= L.MIN_FOR_MIDDLE) {
      rows.push(['Middle half', perAcre(s.q1) + ' to ' + perAcre(s.q3) + '. For ' + val(p, 'acres') + ' acres that is ' + money(s.q1 * val(p, 'acres')) + ' to ' + money(s.q3 * val(p, 'acres')) + '.']);
      rows.push(['Lowest and highest', perAcre(s.ppaMin) + ' and ' + perAcre(s.ppaMax) + '.']);
    }
    if (s.ask) rows.push(['Your asking price', perAcre(s.ask.ppa) + ', above ' + s.ask.above + ' of ' + s.ask.of + ' sales.']);
    else if (s.count && !(ask > 0)) rows.push(['Your asking price', 'Enter it above to see where it ranks.']);
    var warn = [];
    if (auto.county && L.NO_VACANT_LABEL.indexOf(auto.county) >= 0) warn.push(auto.county + ' County’s records don’t say which land is vacant, so none of its sales are used. These come from neighbouring counties.');
    if (auto.truncated) warn.push('There were more sales than one look-up returns, so some may be missing.');
    var files = s.counties.map(function (c) { return c.county + ' (file received ' + c.fileDate + ')'; }).join(', ');
    return head + '<figure class="lv-band lvs"><figcaption><strong>' + esc(finding) + '</strong></figcaption>' + spreadStrip(s) +
      '<dl class="lvs-facts">' + rows.map(function (x) { return '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd>'; }).join('') + '</dl>' +
      warn.map(function (w) { return '<p class="callout">' + esc(w) + '</p>'; }).join('') +
      '<p class="note">Source: <a href="' + L.SOURCE_PAGE + '" rel="noopener">State of Colorado public parcels</a>, accessed ' + esc(auto.accessed) + (files ? '. Counties: ' + esc(files) : '') +
      '. Each parcel shows only its last sale, so land later built on drops out. Prices are as recorded, with no adjustment for time. Sales between relatives can’t be screened out. From records, arithmetic only: not an appraisal.</p>' +
      '<p class="note">Members see each sale on a map with its county record: <a href="' + MEMBER_BRIEF + '">site brief</a>.</p>' +
      '<p class="note">Public land for housing: from December 2, 2026, a lease of a Forest Service administrative site can back a loan. <a href="#/research/brief/forest-service-admin-site-leases-2026">Which Colorado counties could use it</a>.</p></figure>';
  }

  // The four best-use tests and the open questions, from what is known so far.
  var STATUS = { checked: 'Checked', partly: 'Partly checked', not_checked: 'Not checked' };
  // key: the current site's look-up key, so a summary from an earlier address or acreage is never used here.
  function bestUsePanel(st, r, key) {
    var L = global.LandComps;
    if (!L) return '';
    var tests = L.bestUse({ zoning: st.zoning, zoningSource: st.zoning ? 'your entry' : '', acres: st.siteAcres, homes: st.totalUnits, residual: r.res ? r.res.adjustedResidual : null });
    var qs = L.questions({ zoning: st.zoning, summary: auto.state === 'done' && auto.key === key ? auto.summary : null });
    return '<section class="lvb"><h2>Best use: a first read</h2><p class="note">The four tests an appraiser uses, marked by how far CoHO can check them.</p><ol class="lvb-tests">' +
      tests.map(function (t) {
        return '<li class="lvb-' + t.result.status + '"><span class="lvb-q">' + esc(t.title) + '</span><span class="lvb-a">' + esc(t.result.answer) + '</span>' + (t.result.answer === STATUS[t.result.status] ? '' : '<span class="lvb-s">' + esc(STATUS[t.result.status]) + '</span>') + '<span class="lvb-t note">' + esc(t.result.text) + '</span></li>';
      }).join('') + '</ol>' +
      '<h3>What to find out next</h3><ol class="lvb-next">' + qs.map(function (x) { return '<li>' + esc(x.text) + '</li>'; }).join('') + '</ol></section>';
  }

  // Looks up the sales for the address and acres in p, then redraws the panels.
  function findSales(p) {
    var L = global.LandComps, G = global.CohoGeocode;
    var key = autoKey(p), acres = val(p, 'acres');
    auto = { key: key, state: 'busy', summary: null, county: null, error: '', accessed: '' };
    paintAuto(p);
    G.find(p.get('addr')).then(function (hit) {
      if (!hit) throw new Error('That address wasn’t found in Colorado. Try adding the town, or a nearby street address.');
      var subject = { lat: hit.lat, lon: hit.lon, acres: acres };
      return Promise.all([L.fetchNear(subject), L.countyAt(subject).catch(function () { return null; })]).then(function (x) {
        if (auto.key !== key) return;
        var picked = L.pick(subject, x[0].sales);
        auto = { key: key, state: 'done', summary: L.summarize(picked, subject, val(p, 'ask')), county: x[1], truncated: x[0].truncated, error: '', accessed: x[0].accessed };
      });
    }).catch(function (e) {
      if (auto.key !== key) return;
      auto = { key: key, state: 'error', summary: null, county: null, error: (e && e.message) || 'The look-up did not finish. Try again.', accessed: '' };
    }).then(function () {
      if (auto.key !== key) return;
      // Paint with the form as it is now: the reader may have changed the price or the deal while the look-up ran.
      var form = document.querySelector('[data-lv-form]'), now = form ? formParams(form) : p;
      if (autoKey(now) !== key) { auto = { key: '', state: 'idle', summary: null, county: null, error: '', accessed: '' }; paintAuto(now); return; }
      paintAuto(now);
      // On a phone the panel sits below the form: bring the answer into view.
      var box = document.querySelector('.lv-auto');
      if (box && global.innerWidth < 860 && box.scrollIntoView) box.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }
  // The results first: they rank the asking price again from the sales found, and the sales panel shows that rank.
  function paintAuto(p) {
    var out = document.querySelector('.lv-out');
    if (out && global.LandValueTool) out.innerHTML = results(p);
    var box = document.querySelector('.lv-auto');
    if (box) box.innerHTML = autoPanel(p);
  }

  // The results panel, for the inputs in p. Drawn with the page, and again on its own after each change.
  function results(p) {
    var st = stateFrom(p), r = result(st);
    // The asking price can change after a look-up: rank it again from the sales already found.
    if (auto.state === 'done' && auto.key === autoKey(p) && auto.summary && auto.summary.count && global.LandComps) {
      var s0 = auto.summary, a = val(p, 'ask');
      s0.ask = a > 0 && st.siteAcres > 0 && s0.ppaSorted ? { ppa: a / st.siteAcres, above: s0.ppaSorted.filter(function (v) { return v < a / st.siteAcres; }).length, of: s0.count } : null;
    }
    return '<h2>Land value negotiation support</h2>' + '<div class="metrics">' +
      '<div class="metric"><p class="metric-title">Market value from your sales</p><p class="metric-value">' + esc(r.comps ? money(r.comps.estimatedValue) : '—') + '</p><p class="metric-detail">' + esc(r.comps ? 'Median ' + money(r.comps.medianPerAcre) + ' an acre from ' + r.comps.count + (r.comps.count === 1 ? ' sale' : ' sales') + '. Range ' + money(r.comps.rangeValue.low) + ' to ' + money(r.comps.rangeValue.high) + '.' : 'Enter at least one sale with acres and price.') + '</p></div>' +
      '<div class="metric"><p class="metric-title">Most the deal can pay for land</p><p class="metric-value">' + esc(r.res ? money(r.res.adjustedResidual) : '—') + '</p><p class="metric-detail">' + esc(r.res ? (st.totalUnits > 0 ? money(r.res.perUnit) + ' a home. ' : '') + (st.siteAcres > 0 ? money(r.res.perAcre) + ' an acre. ' : '') + (r.res.adjustedResidual > 0 ? 'Sources minus cost, less off-site and cleanup costs.' : 'As entered, the sources ' + (r.res.grossResidual > 0 ? 'leave ' + money(r.res.grossResidual) + ', which off-site and cleanup costs use up' : 'do not cover the cost before land') + ', so nothing is left for land.') : 'Enter development cost and equity and first mortgage.') + '</p></div>' +
      askCard(r.ask, st.totalUnits) +
      '<div class="metric"><p class="metric-title">How complete the inputs are</p><p class="metric-value">' + esc(CONF[r.conf.level] + ', ' + r.conf.score + ' of 100') + '</p><p class="metric-detail">The tool’s own completeness check: sales, project figures and site details. It is not a measure of accuracy.</p></div>' +
      '</div>' + bandChart(r.band, r.ask) +
      bestUsePanel(st, r, autoKey(p)) +
      '<p class="note">This page keeps your figures in its link, so you can copy the address to share it. Nothing is saved anywhere else.</p>';
  }

  function view(params) {
    if (!global.LandValueTool) return '<h1>Land value</h1><p class="callout">The Land value tool’s module did not load.</p>';
    var p = params;
    var input = function (f) {
      return '<label class="lv-field"><span>' + esc(f.label) + '</span><input type="number" inputmode="decimal" min="0" step="' + f.step + '" data-lv="' + f.id + '" value="' + esc(p.get(f.id) || '') + '" placeholder="For example ' + esc(f.money ? money(Number(f.ex)) : f.ex) + '"></label>';
    };
    var compRows = '', rows = rowCount(p);
    if (global.LandComps && global.CohoGeocode && (p.get('addr') || '').trim() && val(p, 'acres') > 0 && auto.key !== autoKey(p)) setTimeout(function () { findSales(p); }, 0);
    for (var i = 1; i <= rows; i++) compRows += compRow(i, p);
    return T.head({
      kind: 'tool', crumbs: T.trail('opportunities', 'Land value'), title: 'Land value',
      answer: 'What a site is worth on the market, the most an affordable project can pay for it, and the room between the two.',
      strip: exampleStrip(),
      meta: '<span class="scope-tag">Not an appraisal</span> For an offer letter or financing, use an MAI or state-certified appraiser.'
    }) +
      '<div class="lv-layout"><form class="lv-form" data-lv-form="1" data-lv-rows="' + rows + '" onsubmit="return false">' +
      '<fieldset><legend>The site</legend>' +
      (global.LandComps && global.CohoGeocode ? '<label class="lv-field"><span>Site address</span><input type="text" autocomplete="street-address" data-lv="addr" value="' + esc(p.get('addr') || '') + '" placeholder="For example 1200 Main St, Durango"></label>' : '') +
      FIELDS.slice(0, 2).map(input).join('') + input(ASK) +
      (global.LandComps && global.CohoGeocode ? '<p class="lv-add"><button type="button" class="button-link" data-lv-find="1">Find sales near this site</button></p>' : '') +
      '<label class="lv-field"><span>Zoning</span><select data-lv="zoning">' + ZONING.map(function (z) { return '<option value="' + z[0] + '"' + (p.get('zoning') === z[0] ? ' selected' : '') + '>' + esc(z[1]) + '</option>'; }).join('') + '</select></label></fieldset>' +
      '<fieldset><legend>Recent land sales nearby</legend><p class="note">Three or more sales of similar zoning within about five miles. County assessor records and local brokers are the usual sources.</p>' +
      '<div class="table-scroll"><table class="lv-comps" data-no-source="input: sales the visitor enters"><thead><tr><th scope="col">#</th><th scope="col">Address or note</th><th scope="col">Acres</th><th scope="col">Price</th><th scope="col">Year</th></tr></thead><tbody>' + compRows + '</tbody></table></div><p class="lv-add">' + addSale(rows) + '</p></fieldset>' +
      '<fieldset><legend>What the project can pay</legend><p class="note">Take these from the Deal Calculator if you have run the deal.</p>' + FIELDS.slice(2, 8).map(input).join('') + '</fieldset>' +
      '<fieldset><legend>Public land</legend>' + input(FIELDS[8]) + '<p class="note">100% means donated land, 50% half the market price.</p></fieldset>' +
      '</form><div class="lv-side"><section class="lv-auto" aria-live="polite">' + autoPanel(p) + '</section><section class="lv-out" aria-live="polite">' + results(p) + '</section></div></div>' +
      guide() +
      '<details class="counted"><summary>What this does not cover</summary><p>The sales look-up uses each parcel’s last recorded sale in the counties that send prices to the state (22 of 64 counties). It does not cover entitlement risk or a ground lease. Off-site and cleanup costs count only if you enter them. The arithmetic is the same as the <a href="' + LIVE + '">full Land value tool</a>.</p></details>' +
      T.next('Next', [{ href: '#/deal-calculator', label: 'Test the deal with this land cost →' }, { href: '#/opportunity/preservation', label: 'Homes that could be lost', secondary: true }]);
  }

  // The form's fields as the address carries them. Rows added with "Add a sale" stay, filled in or not.
  function formParams(form) {
    var p = new URLSearchParams();
    form.querySelectorAll('[data-lv]').forEach(function (f) { if (f.value !== '') p.set(f.dataset.lv, f.value); });
    var rows = Math.min(MAX_COMPS, form.querySelectorAll('.lv-comps tbody tr').length);
    if (rows > COMPS) p.set('rows', String(rows));
    return p;
  }
  // Writes the form into the address and redraws the results panel only. The form itself is left as it is, so
  // the cursor stays where the reader put it: a full redraw sent it back to the field just edited, and typing
  // meant for the next field landed there.
  function update(form) {
    var p = formParams(form);
    history.replaceState(null, '', '#/opportunity/land-value' + (String(p) ? '?' + p : ''));
    var out = document.querySelector('.lv-out');
    if (out && global.LandValueTool) out.innerHTML = results(p);
    var box = document.querySelector('.lv-auto');
    if (box) box.innerHTML = autoPanel(p);
  }
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el.dataset || !el.dataset.lv) return;
    var form = el.closest('[data-lv-form]');
    if (form) update(form);
  });
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-lv-find]');
    var form = b && b.closest('[data-lv-form]');
    if (!form) return;
    var p = formParams(form);
    history.replaceState(null, '', '#/opportunity/land-value' + (String(p) ? '?' + p : ''));
    findSales(p);
  });
  // "Add a sale": one more row at the foot of the table, with the cursor in it. Nothing typed so far is touched.
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-lv-add]');
    var form = b && b.closest('[data-lv-form]'), body = form && form.querySelector('.lv-comps tbody');
    if (!body) return;
    var n = body.rows.length + 1;
    if (n > MAX_COMPS) return;
    body.insertAdjacentHTML('beforeend', compRow(n, null));
    var box = b.closest('.lv-add');
    if (box && n >= MAX_COMPS) box.innerHTML = addSale(n);
    update(form);
    var first = form.querySelector('[data-lv="c' + n + 'd"]');
    if (first) first.focus();
  });

  global.LabLandValue = { view: view, stateFrom: stateFrom, result: result, rowCount: rowCount, autoPanel: autoPanel, findSales: findSales, _auto: function () { return auto; } };
})(window);
