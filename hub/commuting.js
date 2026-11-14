// Commuting and jobs (#/opportunity/commuting): the live commuting page rebuilt in the lab style. Reads the
// same two files the live page reads, LEHD LODES commute counts by town (data/market/commute-strength.json)
// and the principal-employer tables from local audit filings (data/market/principal-employers.json), and
// computes only what the live page computes: shares, and a yearly drive cost at the IRS rate.
(function (global) {
  'use strict';

  var Shell = global.LabShell, UI = global.LabUI;
  var esc = Shell.esc, num = UI.num;

  var FILES = {
    commute: 'data/market/commute-strength.json',
    employers: 'data/market/principal-employers.json',
    counties: 'data/boundaries/counties_co.geojson'
  };
  // IRS standard mileage rate from 1 July 2026 (Announcement 2026-11). It covers the full cost of a car, so a
  // cost built on it is the high end per mile; distances are straight-line, so the miles are a floor.
  var IRS_RATE = 0.76, WORKDAYS = 240;
  // Share of a town's jobs held by people driving 20 to 60 miles in, light to strong (Okabe-Ito, as live).
  var BINS = [
    { max: 0.05, color: 'var(--share-0)', label: 'Under 5%' },
    { max: 0.15, color: 'var(--cat-6)', label: '5 to 15%' },
    { max: 0.25, color: 'var(--cat-2)', label: '15 to 25%' },
    { max: Infinity, color: 'var(--cat-5)', label: '25% or more' }
  ];
  var IRS_URL = 'https://www.journalofaccountancy.com/news/2026/jul/irs-raises-standard-mileage-rates-for-remainder-of-2026/';

  function pct(a, b) { return b ? Math.round(100 * a / b) + '%' : '–'; }
  function cost(miles) { return miles ? '$' + (Math.round(2 * miles * WORKDAYS * IRS_RATE / 10) * 10).toLocaleString('en-US') : null; }
  function farShare(p) { return p.jobs ? p.far / p.jobs : 0; }
  function binFor(share) { for (var i = 0; i < BINS.length; i++) if (share < BINS[i].max) return BINS[i]; return BINS[BINS.length - 1]; }
  // "Silverthorne (town)" reads as "Silverthorne" in the list and the sentence.
  function bare(name) { return String(name).replace(/\s*\([^)]*\)$/, ''); }

  // The first useful answer for a town, worded as the live page words it.
  function answer(p) {
    var c = cost(p.median_far_miles);
    return p.name + ': ' + num(p.in_commuters) + ' of its ' + num(p.jobs) + ' jobs (' + pct(p.in_commuters, p.jobs) + ') are held by people who live somewhere else. ' +
      num(p.far) + ' of them live 20 to 60 miles away' + (c ? ', a drive that costs about ' + c + ' a year at the typical distance' : '') + '.';
  }

  // Statewide frame and projection from site/map-kit.js.
  var K = global.LabMap, MAP_W = K.W, MAP_H = K.H;
  function xy(lon, lat) { return [K.x(lon).toFixed(1), K.y(lat).toFixed(1)]; }

  function townHref(geoid) { return '#/opportunity/commuting?town=' + encodeURIComponent(geoid) + '&at=cj-town'; }

  function map(d, list, byName, sel) {
    var outline = d.counties.features.map(function (f) {
      var rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      return '<path d="' + rings.map(function (poly) { return poly.map(function (ring) { return 'M' + ring.map(function (c) { return xy(c[0], c[1]).join(' '); }).join('L') + 'Z'; }).join(''); }).join('') + '"><title>' + esc(f.properties.NAMELSAD) + '</title></path>';
    }).join('');
    var flows = '';
    if (sel) {
      var max = sel.from.length ? sel.from[0][1] : 1, to = xy(sel.lon, sel.lat);
      flows = '<g class="cj-flows-lines">' + sel.from.map(function (f) {
        var o = byName[String(f[0]).toLowerCase()];
        if (!o) return '';
        var a = xy(o.lon, o.lat);
        return '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + to[0] + '" y2="' + to[1] + '" stroke-width="' + (1.5 + 6 * f[1] / max).toFixed(1) + '"><title>' + esc(bare(f[0]) + ' to ' + bare(sel.name) + ': ' + num(f[1]) + ' workers') + '</title></line>';
      }).join('') + '</g>';
    }
    var dots = list.slice().sort(function (a, b) { return b.jobs - a.jobs; }).map(function (p) {
      var c = xy(p.lon, p.lat), r = Math.max(3, Math.min(13, 1.5 + Math.sqrt(p.jobs) / 24)).toFixed(1);
      var t = bare(p.name) + ': ' + pct(p.far, p.jobs) + ' of ' + num(p.jobs) + ' jobs held by people driving 20 to 60 miles in';
      return '<a href="' + esc(townHref(p.geoid)) + '"' + (sel && sel.geoid === p.geoid ? ' class="is-picked"' : '') + '><circle cx="' + c[0] + '" cy="' + c[1] + '" r="' + r + '" style="fill:' + binFor(farShare(p)).color + '"><title>' + esc(t) + '</title></circle></a>';
    }).join('');
    return '<figure class="pres-map cj-map">' +
      '<figcaption><span class="cc-kicker">Share of each town’s jobs held by people driving 20 to 60 miles in</span><strong>' + esc((function () {
        var t = list.slice().sort(function (a, b) { return farShare(b) - farShare(a); });
        return t.length > 1 ? 'Statewide, people driving 20 to 60 miles in hold the most jobs in ' + bare(t[0].name) + ' (' + pct(t[0].far, t[0].jobs) + ') and ' + bare(t[1].name) + ' (' + pct(t[1].far, t[1].jobs) + ')' : 'Share of each town’s jobs held by people driving 20 to 60 miles in';
      })()) + '</strong><span class="note">' + (sel ? 'This headline is for all of Colorado. ' + esc(bare(sel.name)) + ' is outlined, with lines from the towns that send it the most workers; its own numbers are above. ' : '') + 'One dot per town with 200 or more jobs, sized by its jobs. Select a dot, or pick a town above, to see its numbers and the towns that send it the most workers.</span></figcaption>' +
      '<div class="pm-frame"><svg viewBox="0 0 ' + MAP_W + ' ' + MAP_H + '" role="group" aria-label="Colorado towns shaded by the share of jobs held by people driving 20 to 60 miles in">' +
      '<g class="pm-counties">' + outline + '</g>' + flows + '<g class="pm-layer cj-dots">' + dots + '</g>' + K.metroBox() + K.cities() + '</svg></div>' +
      '<ul class="lb-key">' + BINS.map(function (b) { return '<li><span class="pm-key" style="background:' + b.color + '" aria-hidden="true"></span>' + esc(b.label) + ' <b>' + num(list.filter(function (p) { return binFor(farShare(p)) === b; }).length) + '</b></li>'; }).join('') + '</ul>' +
      // Map kit part 3: the Denver metro close-up, the same towns and shares.
      K.inset({ features: d.counties.features, groups: [{ cls: 'cj-dots', dots: list.slice().sort(function (a, b) { return b.jobs - a.jobs; }).map(function (p) {
        return { lon: p.lon, lat: p.lat, r: Math.max(4, Math.min(16, 2 + Math.sqrt(p.jobs) / 18)), fill: binFor(farShare(p)).color, href: esc(townHref(p.geoid)), label: esc(bare(p.name) + ': ' + pct(p.far, p.jobs) + ' of ' + num(p.jobs) + ' jobs held by people driving 20 to 60 miles in') };
      }) }] }) +
      '<p class="note">County outlines: US Census TIGER. Towns are placed at the point the commute file gives.</p>' +
      (global.LabVizData ? global.LabVizData.block('Share of each town’s jobs held by people driving 20 to 60 miles in', ['Town', 'Jobs', 'Held by people driving 20 to 60 miles in', 'Share (%)'],
        list.slice().sort(function (a, b) { return b.jobs - a.jobs; }).map(function (p) { return [bare(p.name), p.jobs, p.far, p.jobs ? Math.round(p.far / p.jobs * 1000) / 10 : null]; })) : '') + '</figure>';
  }

  function detail(p) {
    var c = cost(p.median_far_miles);
    var stat = function (v, t) { return '<li><b>' + esc(v) + '</b><span>' + esc(t) + '</span></li>'; };
    var flow = function (title, rows) { return UI.bars(title, 'The five largest, workers', rows.map(function (f) { return [bare(f[0]), f[1]]; }), num); };
    return '<div class="cj-detail"><h3>' + esc(bare(p.name)) + '</h3><p class="chapter-finding">' + esc(answer(p)) + '</p><ul class="cj-stats">' +
      stat(num(p.jobs), 'jobs in town (primary jobs)') +
      stat(pct(p.in_commuters, p.jobs), 'held by people who live elsewhere (' + num(p.in_commuters) + ')') +
      stat(num(p.far), 'drive in from 20 to 60 miles; ' + num(p.far_low) + ' of them earn $3,333 a month or less') +
      (c ? stat(c, 'a year for a typical 20 to 60 mile commuter (' + p.median_far_miles + ' miles each way, straight line, 240 days, IRS rate)') : '') +
      stat(num(p.long), 'recorded 60+ miles away; many are not daily trips, so they are not costed') +
      stat(pct(p.out_commuters, p.residents), 'of working residents work in another Colorado town (' + num(p.out_commuters) + ' of ' + num(p.residents) + ')') +
      '</ul><div class="chart-pair">' + flow('Where its in-commuters live', p.from) + flow('Where its residents work', p.to) + '</div>' +
      (UI.placeFor(bare(p.name)) ? '<p><a class="button-link secondary" href="' + esc(UI.placeFor(bare(p.name))) + '">Housing need in ' + esc(bare(p.name)) + '</a></p>' : '') + '</div>';
  }

  function sourceLine(meta) {
    return '<p class="note metric-source">Source: U.S. Census Bureau, LEHD LODES ' + esc(meta.lodes_year) + ' origin-destination file, primary jobs (<a href="' + esc(meta.source) + '">co_od_main_JT01_' + esc(meta.lodes_year) + '</a>), home block to work block; built ' + esc(meta.generated) +
      '. Straight-line miles. Cost at the IRS rate of 76 cents a mile from 1 July 2026, 240 workdays.</p>';
  }

  function picker(name, label, options, cur) {
    return '<label class="opp-menu"><span>' + esc(label) + '</span><select data-cj-pick="' + esc(name) + '">' + options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select></label>';
  }
  function params() { var h = location.hash || '', q = h.indexOf('?'); return new URLSearchParams(q > -1 ? h.slice(q + 1) : ''); }
  document.addEventListener('change', function (ev) {
    var k = ev.target.dataset && ev.target.dataset.cjPick;
    if (!k) return;
    var p = params();
    p.delete('at');
    if (ev.target.value) p.set(k, ev.target.value); else p.delete(k);
    history.replaceState(null, '', '#/opportunity/commuting' + (p.toString() ? '?' + p.toString() : ''));
    Shell.render();
    var again = document.querySelector('[data-cj-pick="' + k + '"]');
    if (again) again.focus();
  });

  function employers(doc, cur) {
    var areas = doc.areas || [], i = Math.max(0, Math.min(areas.length - 1, Number(cur) || 0)), a = areas[i], s = a.source;
    return '<section id="cj-employers" tabindex="-1"><h2>Largest employers</h2>' +
      '<p>As each county or city printed them in its audited annual financial report. A filer that reprints another government’s table says so in its source line.</p>' +
      picker('area', 'Area', areas.map(function (x, n) { return [n, x.area + ' (' + x.as_of + ')']; }).sort(function (x, y) { return x[1].localeCompare(y[1], 'en', { sensitivity: 'base' }); }), i) +
      '<div class="table-scroll" role="region" tabindex="0" aria-label="Largest employers"><table><caption>Largest employers, ' + esc(a.area) + ', ' + esc(a.as_of) + '</caption><thead><tr><th scope="col" class="num">Rank</th><th scope="col">Employer</th><th scope="col" class="num">Employees</th></tr></thead><tbody>' +
      a.rows.map(function (r) { return '<tr><td class="num">' + esc(r.rank == null ? '' : r.rank) + '</td><td>' + esc(r.employer) + '</td><td class="num">' + esc(r.employees) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<p class="note metric-source">Source: ' + esc(s.filer) + ', annual financial report filed with the Office of the State Auditor (<a href="' + esc(s.url) + '">PDF</a>' + (s.pdf_page ? ', PDF page ' + esc(s.pdf_page) : '') + '), “Principal Employers”, ' + esc(a.as_of) + '. Its source: ' + esc(a.stated_source) + '.</p></section>';
  }

  function view() {
    var T = global.LabTpl, title = 'Commuting and jobs';
    var head = function (extra) { return T.head(Object.assign({ kind: 'data', crumbs: T.trail('opportunities', title), title: title }, extra || {})); };
    var s = UI.load(FILES);
    if (s.error) return head() + '<p class="callout">' + esc(s.error) + '</p>';
    if (!s.data) return head() + '<p role="status" class="note">Loading the public records…</p>';
    var d = s.data, meta = d.commute.meta, places = d.commute.places;
    var list = Object.keys(places).map(function (k) { var p = places[k]; p.geoid = k; return p; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var byName = {};
    list.forEach(function (p) { byName[p.name.toLowerCase()] = p; });
    var q = params(), sel = places[q.get('town')] || null;
    if (sel) sel.geoid = q.get('town');
    var jobs = list.reduce(function (t, p) { return t + p.jobs; }, 0), far = list.reduce(function (t, p) { return t + p.far; }, 0);
    var top = list.slice().sort(function (a, b) { return farShare(b) - farShare(a); }).slice(0, 12);
    var rows = list.map(function (p) {
      return { geoid: p.geoid, name: bare(p.name), jobs: p.jobs, inShare: p.jobs ? Math.round(100 * p.in_commuters / p.jobs) : null, far: p.far, farShare: p.jobs ? Math.round(100 * p.far / p.jobs) : null, farLow: p.far_low, miles: p.median_far_miles, cost: p.median_far_miles ? Math.round(2 * p.median_far_miles * WORKDAYS * IRS_RATE / 10) * 10 : null, out: p.residents ? Math.round(100 * p.out_commuters / p.residents) : null };
    });
    return head({
      answer: 'Where a town’s workers live tells you whether its housing fits its jobs. Pick a town to see how many of its jobs are held by people who drive in, how far, and what the drive costs them.',
      meta: '<span class="scope-tag">Scope: Colorado towns with 200 or more jobs</span> LEHD LODES ' + esc(meta.lodes_year) + ', primary jobs, home block to work block.',
      facts: [
        { value: num(list.length), label: 'Towns with 200 or more primary jobs', source: 'LEHD LODES ' + meta.lodes_year, href: meta.source },
        { value: num(far), label: 'Jobs in those towns held by people driving 20 to 60 miles in, of ' + num(jobs), source: 'LEHD LODES ' + meta.lodes_year, href: meta.source },
        { value: cost(25), label: 'A year to drive 25 miles each way, 240 days, at the IRS rate', source: 'IRS rate via Journal of Accountancy, July 2026', href: IRS_URL },
        { value: num((d.employers.areas || []).length), label: 'Areas with a largest-employer table from audit filings', source: 'Office of the State Auditor filings', href: d.employers.meta.library }
      ]
    }) +
      T.onThisPage([{ id: 'cj-town', title: 'Who drives in to work' }, { id: 'cj-employers', title: 'Largest employers' }, { id: 'cj-why', title: 'Why it matters for housing' }, { id: 'cj-tools', title: 'Run it yourself' }, { id: 'cj-about', title: 'About this data' }], true) +
      '<section id="cj-town" tabindex="-1"><h2>Who drives in to work</h2>' +
      picker('town', 'Find a town', [['', 'Pick one of ' + list.length + ' towns']].concat(list.map(function (p) { return [p.geoid, bare(p.name) + (p.name !== bare(p.name) ? ' ' + p.name.slice(bare(p.name).length).trim() : '')]; })), sel ? sel.geoid : '') +
      (sel ? detail(sel) : '<p class="chapter-finding">Pick a town, or select one on the map. ' + num(list.length) + ' towns with 200 or more jobs are shown.</p>') +
      map(d, list, byName, sel) +
      sourceLine(meta) +
      UI.bars('Towns where the most jobs are held by 20 to 60 mile commuters', 'Share of each town’s primary jobs; the 12 highest', top.map(function (p) { return [bare(p.name), Math.round(1000 * farShare(p)) / 10]; }), function (v) { return v.toFixed(1) + '%'; }) +
      sourceLine(meta) +
      UI.table('cj', 'Every town', [
        { key: 'name', label: 'Town', href: function (r) { return townHref(r.geoid); } },
        { key: 'jobs', label: 'Jobs', num: true, fmt: num, tip: 'Primary jobs in town (LODES JT01), so each worker counts once' },
        { key: 'inShare', label: 'Held by in-commuters', num: true, fmt: function (v) { return v + '%'; }, tip: 'Share of the town’s jobs held by people who live somewhere else' },
        { key: 'far', label: '20–60 mile commuters', num: true, fmt: num, tip: 'Jobs held by people who live 20 to 60 straight-line miles away' },
        { key: 'farShare', label: 'Share driving 20–60 mi', num: true, fmt: function (v) { return v + '%'; } },
        { key: 'farLow', label: 'Of them lower-paid', num: true, fmt: num, tip: '$3,333 a month or less, LODES’s lower two pay bands' },
        { key: 'miles', label: 'Typical miles', num: true, tip: 'Median one-way straight-line miles for the 20 to 60 mile commuters' },
        { key: 'cost', label: 'Yearly drive cost', num: true, fmt: UI.money, tip: 'Typical miles, both ways, 240 days, at the IRS rate of 76 cents a mile' },
        { key: 'out', label: 'Residents working elsewhere', num: true, fmt: function (v) { return v + '%'; }, tip: 'Share of working residents whose job is in another Colorado town' }
      ], rows, { noun: 'towns', placeholder: 'Town name' }) + sourceLine(meta) + '</section>' +
      employers(d.employers, q.get('area')) +
      '<section id="cj-why" tabindex="-1"><h2>Why it matters for housing</h2><ul class="opp-points">' +
      '<li><strong>The drive costs real money.</strong> At the IRS rate of 76 cents a mile (from 1 July 2026, IRS Announcement 2026-11, <a href="' + IRS_URL + '">reported by the Journal of Accountancy</a>), a 25-mile commute driven 240 days a year is ' + cost(25) + '. That rate covers the full cost of a car, so it is the high end.</li>' +
      '<li><strong>Long drives push workers to other jobs.</strong> In one urban school district, each 5 more minutes of commute raised a teacher’s chance of moving schools by about 1 point, and 40-minute commuters were more likely to leave (<a href="https://doi.org/10.1177/23328584241287792">Santelli and Grissom, AERA Open, October 2024</a>).</li>' +
      '<li><strong>Many would move closer.</strong> 61% of Summit County in-commuters would make a trade-off to live in the county (<a href="https://www.friscogov.com/wp-content/uploads/2026/04/Attachment-1_2023-Summit-County-Housing-Needs-Assessment.pdf">Summit County Housing Needs Assessment, September 2023</a>, p. 59), and 70% of Eagle County in-commuters said they would prefer to live there (<a href="https://web.archive.org/web/20230126180915/https://files.vailvalleypartnership.com/sites/2/2016/07/2016-Housing-Needs-Assessment-upated_FINAL.pdf">Eagle County update, June 2016</a>, citing the 2007 survey).</li>' +
      '<li><strong>New homes do fill with them.</strong> For Smith Ranch Apartments in Silverthorne, managers at six tax-credit and mixed-income properties reported 10% to 50% of tenants from outside Summit County (<a href="https://www.chfainfo.com/getattachment/4a09630b-e9f1-4117-8e2d-18628f014462/2022-round2-narratives.pdf">CHFA 2022 Round Two application narratives</a>). CHFA counts that kind of move as demand only when comparable properties document it.</li>' +
      '</ul></section>' +
      '<section id="cj-tools" tabindex="-1"><h2>Run it yourself with Census tools</h2><ul class="opp-points">' +
      '<li><a href="https://onthemap.ces.census.gov/">OnTheMap</a>: draw any area and see where its workers live and where its residents work.</li>' +
      '<li><a href="https://ledextract.ces.census.gov/">LED Extraction Tool</a>: download the same commute and job counts for counties and towns.</li>' +
      '<li><a href="https://qwiexplorer.ces.census.gov/">QWI Explorer</a>: hiring, turnover and earnings by county and industry, every quarter.</li>' +
      '<li><a href="https://j2jexplorer.ces.census.gov/">Job-to-Job Explorer</a>: how many workers change jobs, and between which states and metros.</li>' +
      '</ul></section>' +
      '<section id="cj-about" tabindex="-1"><h2>About this data</h2>' +
      '<p>Commute counts are from the Census Bureau’s LEHD LODES ' + esc(meta.lodes_year) + ' origin-destination file (primary jobs, so each worker counts once), home block to work block, matched to towns with the <a href="' + esc(meta.crosswalk) + '">LEHD crosswalk</a>. LODES covers jobs in Colorado held by people who live in Colorado and lags two to three years.</p>' +
      '<p>Distances are straight lines between blocks. Roads are longer, so every cost on this page is a floor. LODES places some workers at an employer’s main office, so trips recorded at 60 miles or more include people who do not drive that far every day. The page counts them apart and never costs them.</p>' +
      '<p>Lower-paid means $3,333 a month or less, LODES’s lower two pay bands. Towns with fewer than ' + num(meta.min_jobs) + ' primary jobs are left out.</p>' +
      '<p>Employer tables are copied from the “Principal Employers” schedules that counties, cities and school districts print in their annual comprehensive financial reports, filed with the <a href="' + esc(d.employers.meta.library) + '">Office of the State Auditor</a>. Most filings do not include the schedule, so ' + num((d.employers.areas || []).length) + ' areas are covered so far.</p>' +
      '<p>The market study’s capture stack adds a second line, capture with relocation. It grows the county renter pool only by the share of tenants from outside the county documented at a comparable Colorado property, uses the low end of that range, and caps the added households at the county’s lower-paid workers who drive 20 to 60 miles in. CHFA allows in-migration only when comparable projects show it, so a county with no such comparable gets no relocation number. Comparables measured from outside a project’s market area are listed but not applied, because a market area is smaller than a county. The comparables are in <a href="https://cohoanalytics.com/data/market/relocation-comparables.json">relocation-comparables.json</a>, each with its quote and page.</p>' +
      '<p class="note">A public-data reference. Check a figure against its source before relying on it.</p></section>' +
      T.source('U.S. Census Bureau, LEHD LODES ' + meta.lodes_year + ' origin-destination file', meta.source, 'built ' + meta.generated) +
      T.source('Principal employers from local government audit filings', d.employers.meta.library, 'checked ' + d.employers.meta.as_of) +
      T.next('Next', [{ href: '#/market', label: 'Check a market →' }, { href: '#/guide/commuters-capture', label: 'Commuters and capture rates', secondary: true }, { href: '#/places', label: 'Find a place', secondary: true }, { href: '#/opportunities', label: 'Back to Opportunities', secondary: true }]);
  }

  global.LabCommuting = { view: view, FILES: FILES, answer: answer, cost: cost, binFor: binFor, BINS: BINS, IRS_RATE: IRS_RATE, WORKDAYS: WORKDAYS };
})(window);
