/**
 * agency-funding.js — the agency funding view, on any page that holds
 * <div data-agency-funding><div data-agency-funding-view></div></div>.
 *
 * Options on the data-agency-funding element, for a page that holds the view
 * inside a tab:
 *   data-agency-funding-hash="tab-need"  the tab's own hash stays first in the
 *                                        URL (#tab-need&county=08049)
 *   data-agency-funding-level="3"        the view's headings sit under the
 *                                        page's h2
 *   data-agency-funding-defer            nothing loads (about 1 MB) until the
 *                                        page calls AgencyFunding.start()
 *
 * One set of controls (search, who paid, years, total or per resident) drives
 * four views of the same awards: the answer sentence, the county map, the
 * who-funded-whom matrix and the grouped, sortable table of every award. The
 * arithmetic lives in js/agency-funding-model.js so the tests can run it.
 */
(function (global) {
  'use strict';

  var M = global.AgencyFundingModel;
  var FILES = {
    ledger: 'data/policy/funding-awards/ledger.json',
    documents: 'data/policy/funding-awards/documents.json',
    rows: 'data/policy/funding-awards/award-rows.json',
    dola: 'data/policy/funding-awards/dola-awards.json',
    aliases: 'data/policy/funding-awards/developer-aliases.json',
    demographics: 'data/co-county-demographics.json',
    boundaries: 'data/boundaries/counties_co.geojson',
    regions: 'data/derived/funding-vs-need.json',
  };
  // Hand-researched deal summaries (deal-summary.html); each lists the award rows it covers.
  var DEAL_INDEX = 'data/deals/index.json';
  function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  // A CHFA award row matches a summary on agency, year and name; the ledger can cut long names
  // short ("Greenbriar Apartments (scattered"), so a name that starts the other also matches.
  function dealFor(a) {
    var n = normName(a.name);
    if (!n || !data.deals) return null;
    for (var i = 0; i < data.deals.length; i++) {
      var m = data.deals[i].match || {};
      if (m.agency !== a.agency || (m.year && m.year !== a.year)) continue;
      var hit = (m.names || []).some(function (x) { var k = normName(x); return k === n || (n.length >= 12 && k.indexOf(n) === 0) || (k.length >= 12 && n.indexOf(k) === 0); });
      if (hit) return data.deals[i];
    }
    return null;
  }
  // One hue, light to dark, so the order reads without colour vision.
  var RAMP = ['#e8f3f1', '#c3e1dc', '#8fc6bd', '#4fa597', '#1f7f72', '#0b5a50'];
  var NONE = '#eef0f3';

  // The view's markup, so any page can hold it with one empty element:
  // <div data-agency-funding><div data-agency-funding-view></div></div>
  var MARKUP = [
    "<form class=\"hm-search\" data-hm-search role=\"search\" aria-label=\"Find a place or developer\">",
    "  <label for=\"hm-q\" class=\"sr-only\">County, town or developer</label>",
    "  <input id=\"hm-q\" type=\"search\" list=\"hm-options\" autocomplete=\"off\" placeholder=\"Search a county, town or developer\" data-hm-q>",
    "  <datalist id=\"hm-options\" data-hm-options></datalist>",
    "  <button type=\"submit\" class=\"btn btn-primary\">Show</button>",
    "  <button type=\"button\" class=\"btn\" data-hm-clear hidden>All of Colorado</button>",
    "</form>",
    "",
    "<section aria-live=\"polite\" data-hm-answer class=\"hm-answer\">",
    "  <p class=\"hm-muted\">Loading every state housing award…</p>",
    "</section>",
    "",
    "<div class=\"hm-controls\">",
    "  <div class=\"hm-row\" role=\"group\" aria-labelledby=\"hm-who-l\">",
    "    <span class=\"hm-label\" id=\"hm-who-l\">Who paid</span>",
    "    <button type=\"button\" class=\"hm-chip\" data-hm-agency=\"ALL\" aria-pressed=\"true\">All three</button>",
    "    <button type=\"button\" class=\"hm-chip\" data-hm-agency=\"CHFA\" aria-pressed=\"false\">CHFA</button>",
    "    <button type=\"button\" class=\"hm-chip\" data-hm-agency=\"OEDIT\" aria-pressed=\"false\">OEDIT</button>",
    "    <button type=\"button\" class=\"hm-chip\" data-hm-agency=\"DOLA\" aria-pressed=\"false\">DOLA</button>",
    "  </div>",
    "  <p class=\"hm-def\" data-hm-def></p>",
    "  <div class=\"hm-row\">",
    "    <label class=\"hm-label\" for=\"hm-from\">Years</label>",
    "    <select id=\"hm-from\" data-hm-from aria-label=\"From year\"></select>",
    "    <span aria-hidden=\"true\">to</span>",
    "    <select id=\"hm-to\" data-hm-to aria-label=\"To year\"></select>",
    "  </div>",
    "  <div class=\"hm-row\" role=\"group\" aria-labelledby=\"hm-norm-l\">",
    "    <span class=\"hm-label\" id=\"hm-norm-l\">Show</span>",
    "    <span class=\"hm-seg\">",
    "      <button type=\"button\" data-hm-norm=\"total\" aria-pressed=\"false\">Total</button>",
    "      <button type=\"button\" data-hm-norm=\"per\" aria-pressed=\"true\">Per resident</button>",
    "    </span>",
    "  </div>",
    "</div>",
    "",
    "<section aria-labelledby=\"hm-flow-h\" style=\"margin:var(--sp4) 0;\">",
    "  <h2 id=\"hm-flow-h\" style=\"font-size:1.15rem;\">Which programs paid, and where the homes are</h2>",
    "  <figure class=\"diagram hm-flow\">",
    "    <svg class=\"hm-flow-svg\" data-hm-flow role=\"img\" aria-labelledby=\"hm-flow-h hm-flow-desc\"></svg>",
    "    <ul class=\"dg-legend hm-flow-legend\" data-hm-flow-legend></ul>",
    "    <p class=\"hm-flow-maptitle\" id=\"hm-flow-map-h\">Where each region is</p>",
    "    <svg class=\"hm-flow-map\" data-hm-flow-map role=\"img\" aria-labelledby=\"hm-flow-map-h\"></svg>",
    "    <figcaption data-hm-flow-cap></figcaption>",
    "  </figure>",
    "  <div id=\"hm-flow-desc\" class=\"sr-only\" data-hm-flow-text></div>",
    "</section>",
    "",
    "<section aria-labelledby=\"hm-map-h\" style=\"margin:var(--sp4) 0;\">",
    "  <h2 id=\"hm-map-h\" style=\"font-size:1.15rem;\" data-hm-map-title>By county</h2>",
    "  <svg class=\"hm-map\" data-hm-map role=\"img\" aria-labelledby=\"hm-map-h hm-map-desc\"></svg>",
    "  <p id=\"hm-map-desc\" class=\"sr-only\">Colorado counties shaded by the chosen measure. The table below has the same numbers.</p>",
    "  <div class=\"hm-legend\" data-hm-legend></div>",
    "  <p class=\"hm-muted\" style=\"font-size:var(--small);\">Tap a county to see its awards.</p>",
    "</section>",
    "",
    "<section aria-labelledby=\"hm-matrix-h\" style=\"margin:var(--sp5) 0;\">",
    "  <h2 id=\"hm-matrix-h\" style=\"font-size:1.15rem;\">Who funded whom</h2>",
    "  <div class=\"hm-row\" role=\"group\" aria-label=\"Matrix rows\">",
    "    <span class=\"hm-label\">Rows</span>",
    "    <span class=\"hm-seg\">",
    "      <button type=\"button\" data-hm-mrows=\"county\" aria-pressed=\"true\">Counties</button>",
    "      <button type=\"button\" data-hm-mrows=\"developer\" aria-pressed=\"false\">Developers</button>",
    "    </span>",
    "  </div>",
    "  <div class=\"hm-scroll\" style=\"margin-top:var(--sp2);\" data-hm-matrix></div>",
    "</section>",
    "",
    "<section aria-labelledby=\"hm-table-h\" style=\"margin:var(--sp5) 0;\">",
    "  <h2 id=\"hm-table-h\" style=\"font-size:1.15rem;\">Every award</h2>",
    "  <div class=\"hm-row\">",
    "    <label class=\"hm-label\" for=\"hm-group\">Group by</label>",
    "    <select id=\"hm-group\" data-hm-group>",
    "      <option value=\"county\">County</option>",
    "      <option value=\"town\">Town</option>",
    "      <option value=\"developer\">Developer</option>",
    "      <option value=\"agency\">Agency</option>",
    "    </select>",
    "    <label class=\"hm-label\" for=\"hm-sort\">Sort by</label>",
    "    <select id=\"hm-sort\" data-hm-sortsel>",
    "      <option value=\"measure\">Most money</option>",
    "      <option value=\"homes\">Most homes</option>",
    "      <option value=\"awards\">Most awards</option>",
    "      <option value=\"label\">Name, A to Z</option>",
    "    </select>",
    "  </div>",
    "  <div class=\"hm-row\" style=\"margin-top:var(--sp2);\">",
    "    <button type=\"button\" class=\"btn\" data-hm-expand>Open all</button>",
    "    <button type=\"button\" class=\"btn\" data-hm-csv>Download CSV</button>",
    "  </div>",
    "  <div class=\"hm-scroll\" style=\"margin-top:var(--sp2);\" data-hm-table></div>",
    "</section>",
    "",
    "<details class=\"hm-about\" data-hm-about>",
    "  <summary>About this data</summary>",
    "  <div data-hm-about-body>",
    "    <ul>",
    "      <li><strong>CHFA tax credits</strong> come from CHFA\'s award reports for 2016 to 2026; <strong>OEDIT Prop 123</strong> awards come from the Affordable Housing Financing Fund\'s selection lists for FY23-24 to FY25-26. Both are read from the PDFs by <code>scripts/funding/build_funding_awards.py</code> and checked against the total each PDF prints (<code>data/policy/funding-awards/ledger.json</code>). An award whose PDF does not print a total, or whose rows did not add up, is marked <em>not checked against a total</em>.</li>",
    "      <li><strong>DOLA Division of Housing</strong> awards were read by hand from DOLA\'s State Housing Board and Prop 123 announcements (<code>data/policy/funding-awards/dola-awards.json</code>), each with the sentence it rests on. DOLA does not publish a complete award list, so this part is partial: an announcement that names fewer projects than its total is marked incomplete.</li>",
    "      <li><strong>Tax credits are not dollars.</strong> CHFA prints the credit each project can claim per year (the federal credit runs ten years). Developers sell credits to investors, usually for less than a dollar each. So credits are shown on their own and never added to grants and loans. \"All three\" is measured in homes, the one thing every agency reports.</li>",
    "      <li><strong>Homes</strong> are the income-restricted homes each award prints, or all homes where it prints only that. Land banking awards print an estimate, marked \"est.\". A project funded by two agencies is counted under each, so \"All three\" counts homes named in awards, not separate buildings.</li>",
    "      <li><strong>Regions</strong> in the flow diagram follow the Department of Local Affairs\' planning and management regions, folded into six (<code>data/derived/funding-vs-need.json</code>). Awards that print no county, or several, sit under \"No single county printed\"; that includes every Prop 123 modular award.</li>",
    "      <li><strong>Prop 123 preliminary selections</strong> print only the amount requested; those rows say \"requested\".</li>",
    "      <li><strong>Per resident</strong> divides by county population from the Census Bureau\'s American Community Survey, 2020-2024 five-year estimates (<code>data/co-county-demographics.json</code>). Small counties swing hard: one large award in a county of 15,000 people reads as a big number per resident.</li>",
    "      <li><strong>Years:</strong> CHFA awards are by award year; Prop 123 awards by the fiscal year they were made in (FY24-25 counts as 2024).</li>",
    "      <li><strong>Developers</strong> are the sponsor, developer, borrower or grantee each list prints. Where a CHFA report prints only an owner column (\"Owner Name\" or \"Ownership\", 2016 to 2023), the owner is used and tagged \"owner as printed\": for some projects that is a partnership formed for the one project, not the developer behind it. Spelling variants of one organisation are merged (for example \"Gorman &amp; Company, LLC\" and \"Gorman &amp; Company\"); an award whose list prints no sponsor is grouped as \"Not named on the award list\". Six Prop 123 modular awards print no location and are listed but not mapped.</li>",
    "      <li>This page is a public-data reference, not legal or financial advice. Confirm current awards with the agency.</li>",
    "    </ul>",
    "  </div>",
    "</details>"
  ].join('\n');

  var state = {
    agency: 'ALL', from: null, to: null, norm: 'per',
    place: null,      // { type: 'county'|'town'|'developer', key, label }
    groupBy: 'county', sort: { key: 'measure', dir: -1 }, open: {}, matrixRows: 'county',
  };
  var data = { awards: [], counties: {}, geo: null, years: [] };
  var root;

  function $(sel) { return root.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fetchJson(url) {
    var resolved = global.resolveAssetUrl ? global.resolveAssetUrl(url) : url;
    return fetch(resolved, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' returned ' + r.status);
      return r.json();
    });
  }

  // ── formatting ────────────────────────────────────────────────────────────
  function money(v) {
    if (v === null || v === undefined) return 'Value unavailable';
    if (Math.abs(v) >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e8 ? 0 : 1) + 'M';
    return '$' + Math.round(v).toLocaleString('en-US');
  }
  function count(v) { return v === null || v === undefined ? 'Value unavailable' : Math.round(v).toLocaleString('en-US'); }

  function measureName() {
    if (state.agency === 'ALL') return state.norm === 'per' ? 'homes per 1,000 residents' : 'homes';
    var credits = M.AGENCIES[state.agency].measure === 'credits';
    if (state.norm === 'per') return credits ? 'tax credits per resident, per year' : 'dollars per resident';
    return credits ? 'tax credits per year' : 'dollars';
  }

  function measureValue(summary, population) {
    var v = M.measureOf(summary, state.agency);
    if (state.norm !== 'per') return v;
    var per = M.perResident(v, population);
    if (per === null) return null;
    return state.agency === 'ALL' ? per * 1000 : per;
  }

  function fmtMeasure(v) {
    if (v === null) return '—';
    if (state.agency === 'ALL') return state.norm === 'per' ? v.toFixed(1) : count(v);
    if (state.norm === 'per') return '$' + (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2));
    return money(v);
  }

  // ── filtering ─────────────────────────────────────────────────────────────
  function baseFilter() {
    return { agency: state.agency, from: state.from, to: state.to };
  }
  function scoped(extra) {
    var f = baseFilter();
    if (state.place) f[state.place.type] = state.place.key;
    Object.keys(extra || {}).forEach(function (k) { f[k] = extra[k]; });
    return M.filter(data.awards, f);
  }
  function placePopulation() {
    if (!state.place) return data.statePopulation;
    if (state.place.type === 'county') return (data.counties[state.place.key] || {}).population || null;
    return null;
  }

  // ── answer ────────────────────────────────────────────────────────────────
  function yearsText() {
    return state.from === state.to ? 'in ' + state.from : 'from ' + state.from + ' to ' + state.to;
  }

  function renderAnswer() {
    var awards = scoped();
    var s = M.summarise(awards);
    var where = state.place ? state.place.label : 'Colorado';
    var who = state.agency === 'ALL' ? 'CHFA, OEDIT and DOLA' : M.AGENCIES[state.agency].label;
    var pop = placePopulation();
    var html = '';
    if (!awards.length) {
      html = '<span class="hm-big">No awards</span>' + esc(who) + ' made no awards ' +
        (state.place && state.place.type === 'developer' ? 'to ' : 'in ') + esc(where) + ' ' + yearsText() +
        ' in the lists this page reads. Try more years or another agency.';
    } else {
      var lead;
      var big;
      if (state.agency === 'ALL') {
        big = count(s.homes) + ' homes';
        var parts = [];
        if (s.dollars !== null) parts.push(money(s.dollars) + ' in grants and loans');
        if (s.credits !== null) parts.push(money(s.credits) + ' a year in tax credits');
        lead = 'in ' + count(s.awards) + ' projects ' + (state.place && state.place.type === 'developer' ? 'by ' : 'in ') + esc(where) +
          ' got ' + esc(parts.join(' and ')) + ' from ' + esc(who) + ', ' + yearsText() + (s.homesEstimated ? '. Some home counts are estimates.' : '.');
      } else if (M.AGENCIES[state.agency].measure === 'credits') {
        big = money(s.credits) + ' a year in tax credits';
        lead = 'went to ' + count(s.awards) + ' projects ' + (state.place && state.place.type === 'developer' ? 'by ' : 'in ') +
          esc(where) + ' ' + yearsText() + ', for ' + count(s.homes) + ' homes.';
      } else {
        big = money(s.dollars);
        lead = 'in grants and loans from ' + esc(who) + ' went to ' + count(s.awards) + ' projects ' +
          (state.place && state.place.type === 'developer' ? 'by ' : 'in ') + esc(where) + ' ' + yearsText() + ', for ' + count(s.homes) + ' homes' +
          (s.homesEstimated ? ' (some estimated)' : '') + '.';
      }
      var per = pop ? measureValue(s, pop) : null;
      var perLine = '';
      if (per !== null && (!state.place || state.place.type === 'county')) {
        var savedNorm = state.norm; state.norm = 'per';
        if (state.agency === 'ALL' && s.dollars !== null) {
          perLine = ' That is <strong>$' + esc(Math.round(s.dollars / pop).toLocaleString('en-US')) + ' per resident</strong> in grants and loans, and ' +
            esc(fmtMeasure(measureValue(s, pop))) + ' ' + esc(measureName()) + '.';
        } else {
          perLine = ' That is <strong>' + esc(fmtMeasure(measureValue(s, pop))) + '</strong> ' + esc(measureName()) + '.';
        }
        state.norm = savedNorm;
      }
      html = '<span class="hm-big">' + esc(big) + '</span>' + lead + perLine;
      if (!state.place) html += topLine();
      html += splitList(s);
    }
    $('[data-hm-answer]').innerHTML = html;
  }

  function topLine() {
    var rows = countyRows();
    var savedNorm = state.norm; state.norm = 'per';
    rows.forEach(function (r) { r.value = measureValue(r.summary, r.population); });
    state.norm = savedNorm;
    rows = rows.filter(function (r) { return r.value !== null && r.value > 0; }).sort(function (a, b) { return b.value - a.value; });
    if (!rows.length) return '';
    var top = rows[0];
    state.norm = 'per';
    var txt = ' The most per resident went to <a href="#" data-hm-pick-county="' + esc(top.key) + '">' + esc(top.label) + '</a> (' +
      esc(fmtMeasure(top.value)) + ' ' + esc(measureName()) + ').';
    state.norm = savedNorm;
    return txt;
  }

  function splitList(s) {
    if (state.agency !== 'ALL') return '';
    var items = ['CHFA', 'OEDIT', 'DOLA'].map(function (k) {
      var b = s.byAgency[k];
      if (!b) return '<li>' + k + ': no awards</li>';
      var amt = k === 'CHFA' ? money(b.credits) + ' a year in credits' : money(b.dollars);
      return '<li><strong>' + k + '</strong>: ' + esc(amt) + ', ' + esc(count(b.homes)) + ' homes, ' + b.awards + ' awards</li>';
    });
    return '<ul class="hm-split">' + items.join('') + '</ul>';
  }

  // ── map ───────────────────────────────────────────────────────────────────
  function countyRows() {
    var awards = M.filter(data.awards, baseFilter());
    if (state.place && state.place.type === 'developer') awards = M.filter(awards, { developer: state.place.key });
    var groups = {};
    M.group(awards, 'county').forEach(function (g) { groups[g.key] = g; });
    return Object.keys(data.counties).map(function (fips) {
      var c = data.counties[fips];
      var g = groups[fips];
      return { key: fips, label: c.name + ' County', population: c.population, summary: g ? g.summary : M.summarise([]), awards: g ? g.awards : [] };
    });
  }

  function renderMap() {
    var svg = $('[data-hm-map]');
    if (!data.geo || !global.d3) { svg.style.display = 'none'; return; }
    var d3 = global.d3;
    var W = 720, H = 520;
    var projection = d3.geoMercator().fitSize([W, H], data.geo);
    var path = d3.geoPath(projection);
    var rows = countyRows();
    var byKey = {};
    rows.forEach(function (r) { r.value = measureValue(r.summary, r.population); byKey[r.key] = r; });
    var max = d3.max(rows, function (r) { return r.value || 0; }) || 0;
    function colour(v) {
      if (v === null || v <= 0 || !max) return NONE;
      // Square root, so a few large counties do not wash out the rest.
      return RAMP[Math.min(RAMP.length - 1, Math.floor(Math.sqrt(v / max) * RAMP.length))];
    }
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var picked = state.place && state.place.type === 'county' ? state.place.key : null;
    svg.innerHTML = data.geo.features.map(function (f) {
      var fips = f.properties.GEOID;
      var r = byKey[fips];
      var label = r ? r.label + ': ' + fmtMeasure(r.value) + ' ' + measureName() + ', ' + r.summary.awards + ' awards' : f.properties.NAMELSAD;
      return '<path d="' + path(f) + '" fill="' + colour(r ? r.value : null) + '" data-fips="' + fips + '" tabindex="0" role="button" aria-label="' +
        esc(label) + '"' + (picked === fips ? ' class="is-picked"' : '') + '><title>' + esc(label) + '</title></path>';
    }).join('');
    $('[data-hm-map-title]').textContent = 'By county: ' + measureName();
    $('[data-hm-legend]').innerHTML = '<span>None</span><i style="background:' + NONE + '"></i><span style="margin-left:6px;">Less</span>' +
      RAMP.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') +
      '<span>More (top: ' + esc(fmtMeasure(max || null)) + ')</span>';
  }

  // ── flow: program to region, in homes ───────────────────────────────────
  // A two-column flow (Sankey) drawn at the figure's own width, so its 12px
  // labels stay 12px on a phone instead of shrinking with a viewBox.
  var FLOW_CLASS = { CHFA: 'is-chfa', OEDIT: 'is-oedit', DOLA: 'is-dola' };
  function renderFlow() {
    var svg = $('[data-hm-flow]');
    var f = M.flows(scoped(), data.regionOf, data.regionOrder);
    var who = state.agency === 'ALL' ? 'CHFA, OEDIT and DOLA' : M.AGENCIES[state.agency].label;
    var where = state.place ? ' for ' + state.place.label : '';
    if (!f.homes) {
      svg.setAttribute('viewBox', '0 0 10 1');
      svg.innerHTML = '';
      svg.style.display = 'none';
      $('[data-hm-flow-legend]').innerHTML = '';
      if ($('[data-hm-flow-map]')) $('[data-hm-flow-map]').style.display = 'none';
      $('[data-hm-flow-cap]').textContent = 'No award' + where + ' ' + yearsText() + ' has a home count recorded in these lists, so there is nothing to draw.';
      $('[data-hm-flow-text]').textContent = '';
      return;
    }
    svg.style.display = '';
    var fig = svg.parentNode;
    var cs = global.getComputedStyle ? global.getComputedStyle(fig) : null;
    var pad = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 32;
    var W = Math.min(880, Math.max(260, Math.floor((fig.clientWidth || 720) - pad)));
    var BAR = 10, GAP = 10, SLOT = 34, TOP = 4;
    var rows = Math.max(f.left.length, f.right.length);
    // Pixels per home: the taller column fills about 22px a row on top of its label slots.
    var k = (rows * 22) / f.homes;
    function place(nodes) {
      var y = TOP;
      nodes.forEach(function (n) {
        // Each node sits in the middle of its slot, with its label beside
        // its middle, so a label never sits next to another node's bands.
        n.h = Math.max(2, n.homes * k);
        n.slot = Math.max(n.h, SLOT);
        n.y = y;
        n.top = y + (n.slot - n.h) / 2;
        n.next = n.top;
        y += n.slot + GAP;
      });
      return y;
    }
    var H = Math.ceil(Math.max(place(f.left), place(f.right))) + TOP;
    var byL = {}, byR = {};
    f.left.forEach(function (n) { byL[n.key] = n; });
    f.right.forEach(function (n) { byR[n.key] = n; });
    var x0 = 0, x1 = W - BAR;
    var ribbons = f.links.map(function (l) {
      var a = byL[l.from], b = byR[l.to];
      var h = Math.max(1, l.homes * k);
      var ya = a.next + h / 2, yb = b.next + h / 2;
      a.next += l.homes * k;
      b.next += l.homes * k;
      var mx = (x0 + BAR + x1) / 2;
      var label = byL[l.from].label + ' (' + M.AGENCIES[l.agency].label + ') to ' + byR[l.to].label + ': ' + count(l.homes) + ' homes';
      return '<path class="hm-flow-link ' + FLOW_CLASS[l.agency] + '" d="M' + (x0 + BAR) + ',' + ya.toFixed(1) + ' C' + mx + ',' + ya.toFixed(1) + ' ' + mx + ',' + yb.toFixed(1) + ' ' + x1 + ',' + yb.toFixed(1) +
        '" stroke-width="' + h.toFixed(1) + '"><title>' + esc(label) + '</title></path>';
    }).join('');
    function label(n, x, anchor) {
      var mid = n.y + n.slot / 2;
      return '<text class="hm-flow-label" x="' + x + '" y="' + (mid - 2).toFixed(1) + '" text-anchor="' + anchor + '">' + esc(n.label) + '</text>' +
        '<text class="hm-flow-value" x="' + x + '" y="' + (mid + 12).toFixed(1) + '" text-anchor="' + anchor + '">' + esc(count(n.homes) + ' homes' + (n.estimated ? ', some est.' : '')) + '</text>';
    }
    var nodes = f.left.map(function (n) {
      return '<rect class="hm-flow-node ' + FLOW_CLASS[n.agency] + '" x="' + x0 + '" y="' + n.top.toFixed(1) + '" width="' + BAR + '" height="' + n.h.toFixed(1) + '"></rect>' + label(n, x0 + BAR + 6, 'start');
    }).concat(f.right.map(function (n) {
      return '<rect class="hm-flow-node is-region" x="' + x1 + '" y="' + n.top.toFixed(1) + '" width="' + BAR + '" height="' + n.h.toFixed(1) + '"></rect>' + label(n, x1 - 6, 'end');
    })).join('');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.innerHTML = '<g>' + ribbons + '</g><g>' + nodes + '</g>';

    var agencies = ['CHFA', 'OEDIT', 'DOLA'].filter(function (a) { return f.left.some(function (n) { return n.agency === a; }); });
    var legendText = { CHFA: 'CHFA tax credits', OEDIT: 'OEDIT Prop 123 fund', DOLA: 'DOLA Division of Housing' };
    $('[data-hm-flow-legend]').innerHTML = agencies.map(function (a) {
      return '<li><i class="' + FLOW_CLASS[a] + '"></i>' + esc(legendText[a]) + '</li>';
    }).join('');
    renderRegionMap(f);
    $('[data-hm-flow-cap]').textContent = 'Left: the program that paid, colored by agency. Right: the region of the county printed on the award. ' +
      'Band width is the income-restricted homes the awards name' + where + ', ' + yearsText() + ', ' + count(f.homes) + ' in all. ' +
      'A project paid for by two programs is counted under each, so this adds up homes named in awards, not separate buildings.' +
      (f.estimated ? ' Land banking counts are the estimates the awards print.' : '') +
      (f.withoutHomes ? ' ' + count(f.withoutHomes) + ' award' + (f.withoutHomes === 1 ? ' has' : 's have') + ' no home count recorded in these lists and ' + (f.withoutHomes === 1 ? 'is' : 'are') + ' left out.' : '') +
      ' Federal grants are HOME, CDBG and the Housing Trust Fund, passed through DOLA.' +
      ' Sources: CHFA award reports, Prop 123 fund selection lists, DOLA announcements.';
    $('[data-hm-flow-text]').innerHTML = '<p>Homes named in ' + esc(who) + ' awards' + esc(where) + ', ' + esc(yearsText()) + ', by program and by region.</p><ul>' +
      f.left.map(function (n) {
        var to = f.links.filter(function (l) { return l.from === n.key; }).map(function (l) { return byR[l.to].label + ' ' + count(l.homes); });
        return '<li>' + esc(n.label + ' (' + M.AGENCIES[n.agency].label + '): ' + count(n.homes) + ' homes. ' + to.join(', ') + '.') + '</li>';
      }).join('') + '</ul>';
  }

  // ── matrix ────────────────────────────────────────────────────────────────
  function renderMatrix() {
    var awards = M.filter(data.awards, { from: state.from, to: state.to });
    if (state.place) {
      var f = {}; f[state.place.type] = state.place.key;
      awards = M.filter(awards, f);
    }
    var by = state.matrixRows === 'developer' ? 'developer' : 'county';
    var groups = M.group(awards, by);
    var perOk = by === 'county' && state.norm === 'per';
    var cols = [
      { k: 'CHFA', head: 'CHFA credits a year', tip: 'Housing tax credits a year awarded by the Colorado Housing and Finance Authority (CHFA).', val: function (b) { return b && b.credits; }, fmt: money },
      { k: 'OEDIT', head: 'OEDIT $', tip: 'Grants and loans, in dollars, awarded by the Colorado Office of Economic Development and International Trade (OEDIT).', val: function (b) { return b && b.dollars; }, fmt: money },
      { k: 'DOLA', head: 'DOLA $', tip: 'Grants and loans, in dollars, awarded by the Colorado Department of Local Affairs (DOLA).', val: function (b) { return b && b.dollars; }, fmt: money },
    ];
    groups.forEach(function (g) {
      g.population = by === 'county' ? (data.counties[g.key] || {}).population : null;
      g.sortValue = g.summary.homes || 0;
    });
    groups.sort(function (a, b) { return (a.key === '_none') - (b.key === '_none') || b.sortValue - a.sortValue; });
    var head = '<tr><th scope="col" data-tip="' + (by === 'county' ? 'The county the awarded project is in.' : 'The developer named on the award.') + '">' + (by === 'county' ? 'County' : 'Developer') + '</th>' +
      cols.map(function (c) { return '<th scope="col" class="num" data-tip="' + esc(c.tip) + '">' + esc(c.head) + '</th>'; }).join('') +
      '<th scope="col" class="num" data-tip="Homes in the awarded projects; per 1,000 residents when shown per resident.">Homes</th>' +
      '<th scope="col" class="num" data-tip="How many awards are counted, from all three agencies.">Awards</th></tr>';
    var LIMIT = 12;
    // Per resident needs a population; a row with none (awards in no one county) says so rather than showing its total.
    var NO_POP = '<td class="num hm-muted" title="No county population to divide by">n/a</td>';
    var shown = state.matrixAll ? groups : groups.slice(0, LIMIT);
    var body = shown.map(function (g) {
      var cells = cols.map(function (c) {
        var v = c.val(g.summary.byAgency[c.k]);
        if (v === null || v === undefined) return '<td class="num hm-muted">—</td>';
        if (perOk) return g.population ? '<td class="num">$' + esc((v / g.population).toFixed(2)) + '</td>' : NO_POP;
        return '<td class="num">' + esc(c.fmt(v)) + '</td>';
      }).join('');
      var homes = g.summary.homes;
      var homesCell = homes === null ? '—' : (perOk ? (g.population ? (homes / g.population * 1000).toFixed(1) : null) : count(homes));
      var label = g.key === '_none' ? '<span class="hm-muted">' + esc(g.label) + '</span>'
        : '<a href="#" data-hm-pick-' + by + '="' + esc(g.key) + '">' + esc(g.label) + '</a>';
      return '<tr><th scope="row">' + label + '</th>' + cells + (homesCell === null ? NO_POP : '<td class="num">' + esc(homesCell) + '</td>') + '<td class="num">' + g.summary.awards + '</td></tr>';
    }).join('');
    var note = '<p class="hm-muted" style="font-size:var(--small);margin:0 0 var(--sp2);">' + (perOk
      ? 'Per county resident: dollars, or tax credits a year; homes per 1,000 residents. n/a: no single county, so no population.'
      : 'Totals: tax credits a year, grants and loans in dollars, and homes.') + ' Sorted by homes. All three agencies are shown whatever "Who paid" is set to.</p>';
    var more = groups.length > LIMIT
      ? '<button type="button" class="btn" style="margin-top:var(--sp2);" data-hm-matrix-all>' + (state.matrixAll ? 'Show the top ' + LIMIT : 'Show all ' + groups.length) + '</button>' : '';
    $('[data-hm-matrix]').innerHTML = groups.length
      ? note + '<table class="hm-table hm-matrix"><caption class="sr-only">Awards by ' + by + ' and agency, ' + esc(yearsText()) +
        '. Every agency is shown here whatever "Who paid" is set to.</caption><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' + more
      : '<p class="hm-muted">No awards for these years.</p>';
  }

  // ── grouped table ─────────────────────────────────────────────────────────
  var COLS = [
    { key: 'label', head: 'Name', num: false, tip: 'The county, town, developer or agency the awards are grouped by. Select a name to open its awards.' },
    { key: 'measure', head: null, num: true, tip: 'Grants and loans in dollars, or housing tax credits a year, for the agency chosen in "Who paid". The two are never added together.' },
    { key: 'homes', head: 'Homes', num: true, tip: 'Homes in the awarded projects.' },
  ];

  function groupMeasure(g) {
    var v = M.measureOf(g.summary, state.agency);
    return v === null ? null : v;
  }
  function measureHead() {
    if (state.agency === 'ALL') return 'Money';
    return M.AGENCIES[state.agency].measure === 'credits' ? 'Tax credits a year' : 'Grants and loans';
  }
  function groupMoneyText(s) {
    if (state.agency !== 'ALL') return M.AGENCIES[state.agency].measure === 'credits' ? money(s.credits) : money(s.dollars);
    var parts = [];
    if (s.dollars !== null) parts.push(money(s.dollars) + ' grants/loans');
    if (s.credits !== null) parts.push(money(s.credits) + ' credits/yr');
    return parts.join('\n') || '—';
  }
  function awardMoneyText(a) {
    if (a.agency === 'CHFA') return a.credits === null ? 'Value unavailable' : money(a.credits) + ' credits/yr';
    if (a.dollars === null) return 'Value unavailable';
    return money(a.dollars) + (a.dollarsBasis === 'requested' ? ' requested' : '');
  }

  function shortProgram(p) {
    return String(p || '').replace(/ \+ state$/, '').trim();
  }

  function renderTable() {
    var awards = scoped();
    var groups = M.group(awards, state.groupBy);
    var sk = state.sort.key, dir = state.sort.dir;
    function val(g) {
      if (sk === 'label') return (g.label || '').toLowerCase();
      // With all three agencies the column holds two units; it sorts by grants and
      // loans, then by credits, and never adds one to the other.
      if (sk === 'measure') return state.agency === 'ALL' ? [g.summary.dollars || 0, g.summary.credits || 0] : [groupMeasure(g) || 0, 0];
      if (sk === 'homes') return g.summary.homes || 0;
      return g.summary.awards;
    }
    groups.sort(function (a, b) {
      if ((a.key === '_none') !== (b.key === '_none')) return a.key === '_none' ? 1 : -1;
      var x = val(a), y = val(b);
      if (Array.isArray(x)) { if (x[0] !== y[0]) return (x[0] - y[0]) * dir; return (x[1] - y[1]) * dir; }
      if (x < y) return -1 * dir;
      if (x > y) return 1 * dir;
      return 0;
    });
    var head = '<tr>' + COLS.map(function (c) {
      var name = c.head || measureHead();
      var sorted = sk === c.key;
      var aria = sorted ? (dir > 0 ? 'ascending' : 'descending') : 'none';
      return '<th scope="col" class="' + (c.num ? 'num' : '') + '" aria-sort="' + aria + '" data-tip="' + esc(c.tip) + '"><button type="button" data-hm-sort="' + c.key + '">' +
        esc(name) + (sorted ? (dir > 0 ? ' ▲' : ' ▼') : '') + '</button></th>';
    }).join('') + '</tr>';
    var body = groups.map(function (g) {
      var open = !!state.open[g.key];
      var rowId = 'hm-g-' + String(g.key).replace(/[^a-z0-9]+/gi, '-');
      var row = '<tbody><tr class="hm-group"><th scope="row"><button type="button" aria-expanded="' + open + '" aria-controls="' + rowId + '" data-hm-toggle="' +
        esc(g.key) + '"><span aria-hidden="true">' + (open ? '▾' : '▸') + '</span>' + esc(g.label) + '</button></th>' +
        '<td class="num hm-money">' + esc(groupMoneyText(g.summary)) + '</td><td class="num">' + esc(count(g.summary.homes)) + '</td><td class="num">' + g.summary.awards + '</td></tr></tbody>';
      if (!open) return row + '<tbody id="' + rowId + '" hidden></tbody>';
      var items = g.awards.slice().sort(function (a, b) { return (b.year || 0) - (a.year || 0); }).map(function (a) {
        var where = [a.town, a.county].filter(Boolean).join(', ');
        var tags = (a.homesEstimated ? '<span class="hm-tag">est. homes</span>' : '') +
          (a.dollarsBasis === 'requested' ? '<span class="hm-tag">preliminary</span>' : '') +
          (a.confirmed ? '' : '<span class="hm-tag">not checked against a total</span>') +
          (a.developerRole === 'owner' && a.developer ? '<span class="hm-tag">owner as printed</span>' : '');
        var src = a.sourceUrl ? '<a href="' + esc(a.sourceUrl) + '" rel="noopener" target="_blank">' + esc(a.sourceTitle) + '</a>' : esc(a.sourceTitle);
        var quote = a.quote ? '<blockquote class="hm-quote">' + esc(a.quote) + '</blockquote>' : '';
        var line2 = [a.agency + ' ' + shortProgram(a.program), a.yearLabel, where,
          state.groupBy !== 'developer' ? (a.developer ? (a.developerRole === 'owner' ? 'owner: ' : '') + a.developer : 'developer not printed') : null].filter(Boolean).join(' · ');
        var deal = dealFor(a);
        var dealLink = deal ? ' <a class="hm-deal-link" href="deal-summary.html?d=' + esc(deal.slug) + '">Deal summary</a>' : '';
        return '<tr class="hm-award"><td colspan="3"><div class="hm-award-top"><strong>' + esc(a.name || 'Project name not printed') + '</strong>' + dealLink +
          '<span class="hm-award-amt">' + esc(awardMoneyText(a)) + (a.homes !== null ? ' · ' + esc(count(a.homes)) + ' homes' : '') + '</span></div>' +
          '<div class="hm-muted">' + esc(line2) + tags + '</div>' +
          '<div class="hm-muted">Source: ' + src + (a.sourceChecked ? (a.sourceDated ? ' (dated ' : ' (read ') + esc(String(a.sourceChecked).slice(0, 10)) + ')' : '') + '</div>' + quote + '</td></tr>';
      }).join('');
      return row + '<tbody id="' + rowId + '">' + items + '</tbody>';
    }).join('');
    $('[data-hm-table]').innerHTML = groups.length
      ? '<table class="hm-table"><caption class="sr-only">Awards grouped by ' + esc(state.groupBy) + '. Select a column heading to sort; select a name to open its awards.</caption><thead>' +
        head + '</thead>' + body + '</table>'
      : '<p class="hm-muted">No awards match.</p>';
    $('[data-hm-sortsel]').value = state.sort.dir === (state.sort.key === 'label' ? 1 : -1) ? state.sort.key : $('[data-hm-sortsel]').value;
    $('[data-hm-expand]').textContent = groups.every(function (g) { return state.open[g.key]; }) && groups.length ? 'Close all' : 'Open all';
  }

  // ── controls ──────────────────────────────────────────────────────────────
  function renderControls() {
    $all('[data-hm-agency]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-hm-agency') === state.agency)); });
    $all('[data-hm-norm]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-hm-norm') === state.norm)); });
    $all('[data-hm-mrows]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-hm-mrows') === state.matrixRows)); });
    $('[data-hm-def]').innerHTML = state.agency === 'ALL'
      ? 'Colorado\'s three state housing funders: <strong>CHFA</strong> (LIHTC, the federal and state Low-Income Housing Tax Credits), <strong>OEDIT</strong> (the Prop 123 fund) and <strong>DOLA</strong> (Division of Housing grants and loans). Credits and dollars are different things, so together they are counted in homes.'
      : '<strong>' + esc(M.AGENCIES[state.agency].label) + '</strong> (' + esc(M.AGENCIES[state.agency].name) + '). ' + esc(M.AGENCIES[state.agency].plain.replace(/^\S+ is /, 'It is '));
    $('[data-hm-clear]').hidden = !state.place;
    $('[data-hm-q]').value = state.place ? state.place.label : '';
  }

  function render() {
    renderControls();
    renderAnswer();
    renderFlow();
    renderMap();
    renderMatrix();
    renderTable();
  }

  function pick(place) {
    state.place = place;
    state.open = {};
    if (place && place.type === 'county') state.groupBy = 'town';
    else if (place && place.type === 'developer') state.groupBy = 'county';
    else if (place && place.type === 'town') state.groupBy = 'developer';
    else state.groupBy = 'county';
    $('[data-hm-group]').value = state.groupBy;
    writeHash();
    render();
  }

  function options() {
    var seen = {};
    var list = [];
    Object.keys(data.counties).forEach(function (f) {
      list.push({ type: 'county', key: f, label: data.counties[f].name + ' County' });
    });
    data.awards.forEach(function (a) {
      if (a.town && !seen['t' + a.town.toLowerCase()]) {
        seen['t' + a.town.toLowerCase()] = 1;
        list.push({ type: 'town', key: a.town.toLowerCase(), label: a.town });
      }
      if (a.developerKey && !seen['d' + a.developerKey]) {
        seen['d' + a.developerKey] = 1;
        list.push({ type: 'developer', key: a.developerKey, label: a.developer });
      }
    });
    return list;
  }

  function optionText(o) {
    return o.label + (o.type === 'town' ? ' (town)' : o.type === 'developer' ? ' (developer)' : '');
  }

  function findOption(text) {
    var t = String(text || '').trim().toLowerCase();
    if (!t) return null;
    var opts = data.options;
    return opts.find(function (o) { return optionText(o).toLowerCase() === t; }) ||
      opts.find(function (o) { return o.label.toLowerCase() === t; }) ||
      opts.find(function (o) { return o.label.toLowerCase() === t + ' county'; }) ||
      opts.find(function (o) { return o.label.toLowerCase().indexOf(t) === 0; }) ||
      opts.find(function (o) { return o.label.toLowerCase().indexOf(t) !== -1; }) || null;
  }

  function writeHash() {
    var p = [];
    if (state.place) p.push(state.place.type + '=' + encodeURIComponent(state.place.key));
    if (state.agency !== 'ALL') p.push('agency=' + state.agency);
    var prefix = root.getAttribute('data-agency-funding-hash');
    if (prefix) p.unshift(prefix);
    try { history.replaceState(null, '', p.length ? '#' + p.join('&') : location.pathname + location.search); } catch (e) { /* file:// */ }
  }

  function readHash() {
    var h = String(location.hash || '').replace(/^#/, '');
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i < 0) return;
      var k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1));
      if (k === 'agency' && M.AGENCIES[v]) state.agency = v;
      if (k === 'county' || k === 'town' || k === 'developer') {
        var o = data.options.find(function (x) { return x.type === k && x.key === v; });
        if (o) state.place = o;
      }
    });
  }

  function wire() {
    root.addEventListener('click', function (e) {
      var t = e.target.closest('button, a, path');
      if (!t || !root.contains(t)) return;
      if (t.hasAttribute('data-hm-agency')) { state.agency = t.getAttribute('data-hm-agency'); writeHash(); render(); }
      else if (t.hasAttribute('data-hm-norm')) { state.norm = t.getAttribute('data-hm-norm'); render(); }
      else if (t.hasAttribute('data-hm-mrows')) { state.matrixRows = t.getAttribute('data-hm-mrows') === 'developer' ? 'developer' : 'county'; renderControls(); renderMatrix(); }
      else if (t.hasAttribute('data-hm-clear')) { pick(null); }
      else if (t.hasAttribute('data-hm-matrix-all')) { state.matrixAll = !state.matrixAll; renderMatrix(); }
      else if (t.hasAttribute('data-hm-sort')) {
        var k = t.getAttribute('data-hm-sort');
        state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: k === 'label' ? 1 : -1 };
        renderTable();
        var again = root.querySelector('[data-hm-sort="' + k + '"]'); if (again) again.focus();
      } else if (t.hasAttribute('data-hm-toggle')) {
        var g = t.getAttribute('data-hm-toggle');
        state.open[g] = !state.open[g];
        renderTable();
        var btn = root.querySelector('[data-hm-toggle="' + (global.CSS && CSS.escape ? CSS.escape(g) : g) + '"]'); if (btn) btn.focus();
      } else if (t.hasAttribute('data-hm-expand')) {
        var groups = M.group(scoped(), state.groupBy);
        var allOpen = groups.length && groups.every(function (x) { return state.open[x.key]; });
        state.open = {};
        if (!allOpen) groups.forEach(function (x) { state.open[x.key] = true; });
        renderTable();
      } else if (t.hasAttribute('data-hm-csv')) {
        download();
      } else if (t.hasAttribute('data-fips') || t.hasAttribute('data-hm-pick-county')) {
        e.preventDefault();
        var fips = t.getAttribute('data-fips') || t.getAttribute('data-hm-pick-county');
        var c = data.counties[fips];
        if (c) pick({ type: 'county', key: fips, label: c.name + ' County' });
      } else if (t.hasAttribute('data-hm-pick-developer')) {
        e.preventDefault();
        var key = t.getAttribute('data-hm-pick-developer');
        var o = data.options.find(function (x) { return x.type === 'developer' && x.key === key; });
        if (o) pick(o);
      }
    });
    root.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('path[data-fips]')) {
        e.preventDefault();
        e.target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
    $('[data-hm-search]').addEventListener('submit', function (e) {
      e.preventDefault();
      var o = findOption($('[data-hm-q]').value);
      if (o) pick(o);
      else $('[data-hm-answer]').innerHTML = '<p>No county, town or developer matches "' + esc($('[data-hm-q]').value) + '". Try a county name, such as Mesa or Denver.</p>';
    });
    $('[data-hm-q]').addEventListener('change', function () {
      var o = data.options.find(function (x) { return optionText(x) === $('[data-hm-q]').value; });
      if (o) pick(o);
    });
    $('[data-hm-from]').addEventListener('change', function (e) {
      state.from = Number(e.target.value);
      if (state.from > state.to) { state.to = state.from; $('[data-hm-to]').value = String(state.to); }
      render();
    });
    $('[data-hm-to]').addEventListener('change', function (e) {
      state.to = Number(e.target.value);
      if (state.to < state.from) { state.from = state.to; $('[data-hm-from]').value = String(state.from); }
      render();
    });
    $('[data-hm-group]').addEventListener('change', function (e) { state.groupBy = e.target.value; state.open = {}; renderTable(); });
    $('[data-hm-sortsel]').addEventListener('change', function (e) {
      var k = e.target.value;
      state.sort = { key: k, dir: k === 'label' ? 1 : -1 };
      renderTable();
    });
  }

  // The regions on the flow's right side, as a map: each county shaded by its
  // region, each region labelled with the homes the flow gives it.
  // Neighbouring regions get different hues.
  var REGION_CLASS = {
    'Front Range': 'rg-1', 'Mountains': 'rg-5', 'Western Slope': 'rg-4',
    'Southwest': 'rg-2', 'San Luis Valley': 'rg-7', 'Eastern Plains': 'rg-6',
  };
  // Each label sits on one county inside its region (El Paso, Grand, Mesa,
  // La Plata, Alamosa, Kit Carson), so the labels never stack on a phone.
  var REGION_LABEL_AT = {
    'Front Range': '08041', 'Mountains': '08049', 'Western Slope': '08077',
    'Southwest': '08067', 'San Luis Valley': '08003', 'Eastern Plains': '08063',
  };
  function renderRegionMap(f) {
    var svg = $('[data-hm-flow-map]');
    if (!svg) return;
    if (!data.geo || !global.d3) { svg.style.display = 'none'; return; }
    var d3 = global.d3;
    var W = Math.min(560, parseFloat(svg.parentNode.clientWidth) || 560);
    var H = Math.round(W * 0.74);
    var projection = d3.geoMercator().fitExtent([[4, 4], [W - 4, H - 4]], data.geo);
    var path = d3.geoPath(projection);
    var homes = {};
    f.right.forEach(function (n) { homes[n.key] = n.homes; });
    var centre = {};
    var counties = data.geo.features.map(function (feat) {
      var region = data.regionOf[feat.properties.GEOID] || null;
      if (region && REGION_LABEL_AT[region] === feat.properties.GEOID) {
        var c = path.centroid(feat);
        centre[region] = { x: c[0], y: c[1] };
      }
      return '<path d="' + path(feat) + '" class="hm-region ' + (REGION_CLASS[region] || '') + '"><title>' +
        esc(feat.properties.NAMELSAD + (region ? ': ' + region : '')) + '</title></path>';
    }).join('');
    var labels = Object.keys(centre).map(function (r) {
      var t = centre[r];
      var v = homes[r] ? count(homes[r]) + ' homes' : 'no homes';
      // Keep a label inside the map at its edges (about 7px a character at 12px bold).
      var half = Math.max(r.length, v.length) * 3.6 + 4;
      var x = Math.min(W - half, Math.max(half, t.x)), y = t.y;
      return '<text class="hm-flow-label" x="' + x.toFixed(1) + '" y="' + (y - 2).toFixed(1) + '" text-anchor="middle">' + esc(r) + '</text>' +
        '<text class="hm-flow-value" x="' + x.toFixed(1) + '" y="' + (y + 12).toFixed(1) + '" text-anchor="middle">' + esc(v) + '</text>';
    }).join('');
    svg.style.display = '';
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.innerHTML = '<g>' + counties + '</g><g>' + labels + '</g>';
  }

  // The flow is drawn at the figure's width, so it redraws when that changes.
  var flowWidth = 0, flowTimer = null;
  function watchWidth() {
    global.addEventListener('resize', function () {
      clearTimeout(flowTimer);
      flowTimer = setTimeout(function () {
        var fig = $('[data-hm-flow]');
        var w = fig && fig.parentNode.clientWidth;
        if (w && w !== flowWidth) { flowWidth = w; renderFlow(); }
      }, 150);
    });
  }

  function download() {
    var csv = M.csv(scoped());
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'colorado-housing-awards-' + (state.place ? state.place.key.replace(/[^a-z0-9]+/gi, '-') + '-' : '') + state.from + '-' + state.to + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  var started = false;
  function start() {
    root = document.querySelector('[data-agency-funding]');
    if (!root || !M || started) return;
    started = true;
    var view = root.querySelector('[data-agency-funding-view]');
    // A fixed tag per allowed level, so nothing read from the page reaches innerHTML.
    var tag = { 3: 'h3', 4: 'h4', 5: 'h5' }[root.getAttribute('data-agency-funding-level')];
    if (view) view.innerHTML = tag ? MARKUP.replace(/<(\/?)h2\b/g, function (m, slash) { return '<' + slash + tag; }) : MARKUP;
    var keys = Object.keys(FILES);
    // Deal summaries are optional: if the index fails to load, award rows simply carry no link.
    fetchJson(DEAL_INDEX).then(function (idx) { data.deals = (idx && idx.deals) || []; if (data.awards.length) render(); }).catch(function () { data.deals = []; });
    Promise.all(keys.map(function (k) { return fetchJson(FILES[k]); })).then(function (docs) {
      var d = {};
      keys.forEach(function (k, i) { d[k] = docs[i]; });
      d.boundaries.features.forEach(function (f) {
        var name = f.properties.NAME;
        var demo = d.demographics.counties[name] || {};
        data.counties[f.properties.GEOID] = { name: name, population: demo.population > 0 ? demo.population : null };
      });
      data.regionOf = {};
      data.regionOrder = [];
      ((d.regions && d.regions.counties) || []).forEach(function (c) {
        if (!c.region) return;
        data.regionOf[c.fips] = c.region;
        if (data.regionOrder.indexOf(c.region) === -1) data.regionOrder.push(c.region);
      });
      data.statePopulation = Object.keys(data.counties).reduce(function (t, k) { return t + (data.counties[k].population || 0); }, 0) || null;
      data.geo = d.boundaries;
      data.awards = M.normalise({ ledger: d.ledger, documents: d.documents, rows: d.rows, dola: d.dola, aliases: d.aliases, counties: data.counties });
      var years = data.awards.map(function (a) { return a.year; }).filter(function (y) { return y !== null; });
      var min = Math.min.apply(null, years), max = Math.max.apply(null, years);
      data.years = [];
      for (var y = min; y <= max; y++) data.years.push(y);
      // Prop 123 money starts in 2023, so the default compares all three agencies over the same years.
      state.from = Math.max(min, 2023);
      state.to = max;
      ['[data-hm-from]', '[data-hm-to]'].forEach(function (sel) {
        $(sel).innerHTML = data.years.map(function (yy) { return '<option value="' + yy + '">' + yy + '</option>'; }).join('');
      });
      $('[data-hm-from]').value = String(state.from);
      $('[data-hm-to]').value = String(state.to);
      data.options = options();
      $('[data-hm-options]').innerHTML = data.options.map(function (o) { return '<option value="' + esc(optionText(o)) + '"></option>'; }).join('');
      readHash();
      if (state.place) state.groupBy = state.place.type === 'county' ? 'town' : state.place.type === 'developer' ? 'county' : 'developer';
      $('[data-hm-group]').value = state.groupBy;
      wire();
      watchWidth();
      render();
    }).catch(function (err) {
      $('[data-hm-answer]').innerHTML = '<p>The award lists could not be loaded (' + esc(err.message) + '). Reload the page to try again.</p>';
    });
  }

  global.AgencyFunding = { start: start };
  function auto() {
    var el = document.querySelector('[data-agency-funding]');
    if (el && !el.hasAttribute('data-agency-funding-defer')) start();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto);
  else auto();
})(typeof window !== 'undefined' ? window : this);
