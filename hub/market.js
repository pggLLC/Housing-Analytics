// Two free pages for any Colorado place, built only from files the public site already publishes:
//   #/market?g=<geoid>     Market check: renters and the homes priced for them, rents against the tax credit
//                          rent, and tax credit supply in the county. The full site-level Market Analysis stays
//                          a member tool (paul, 26 Oct); this page links to it and copies none of it.
//   #/for-sale?g=<geoid>   For-sale and ownership: what each income band can pay against the typical home value,
//                          (the full For-Sale Market Study becomes a member tool too, paul 30 Oct)
//                          and how the shared-equity resale formulas play out. Prices come from the public site's
//                          own engines (js/hna/ownership-finance.js, js/hna/ownership-resale.js); the lab adds
//                          no arithmetic of its own beyond sums and shares of published counts.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI, Pl = global.LabPlaces;
  var esc = Shell.esc, num = Pl.num, money = Pl.money;
  var LIVE = Pl.LIVE;
  var EXTRA = {
    zori: 'data/market/zori_rents_co.json',
    roundOne: 'data/affordable-housing/chfa-awards/2026-round-one.json',
    resale: 'data/policy/resale-conventions.json',
    demand: 'data/market/chfa_renter_demand_co.json',
    // The live Market Analysis passes these to the capture engine too (js/market-analysis.js _chfaQualifiedRenters):
    // the ACS renter count each tract is scaled to, and B25009 renter households by size (QA 11-09).
    acs: 'data/market/acs_tract_metrics_co.json', sizes: 'data/market/acs_tract_renter_household_size_co.json'
  };
  // The engine options the live page uses, built once per load.
  var engineOpts = null;
  function liveOpts(x) {
    if (engineOpts && engineOpts.from === x) return engineOpts.o;
    var idx = {}; ((x.acs && x.acs.tracts) || []).forEach(function (m) { idx[m.geoid] = m; });
    engineOpts = { from: x, o: { acsIdx: Object.keys(idx).length ? idx : null, sizeIdx: x.sizes && x.sizes.tracts ? x.sizes.tracts : null } };
    return engineOpts.o;
  }
  var LINKS = {
    zillow: 'https://www.zillow.com/research/data/',
    fmr: 'https://www.huduser.gov/portal/datasets/fmr.html',
    chfa: 'https://www.chfainfo.com/rental-housing/housing-credit/income-and-rent-limits',
    acsRent: 'https://data.census.gov/table/ACSDP5Y2024.DP04',
    acsValue: 'https://data.census.gov/table/ACSDT5Y2024.B25075',
    il: 'https://www.huduser.gov/portal/datasets/il.html'
  };

  function shortName(label) { return String(label || '').replace(/ (town|city|CDP)$/, ''); }
  function metric(c, k) { var m = c && c.digest && c.digest.metrics ? c.digest.metrics[k] : null; return m && m.value != null ? m : null; }
  function val(c, k) { var m = metric(c, k); return m ? m.value : null; }
  function pct(v) { return v == null ? null : (Math.round(v * 10) / 10) + '%'; }

  // The place picker both pages open on: no figures until a place is chosen (as the HNA starts, paul 26 Oct).
  function picker(route, title, answer, q, menu) {
    var hits = q ? Shell.catalog().entries.filter(function (e) { return e.geoid; }).filter(Shell.matches(q)).slice(0, 12) : [];
    return T.head({ kind: 'tool', crumbs: T.trail(menu || 'deal', title), title: title, answer: answer }) +
      '<form class="search" role="search" data-pick="' + route + '"><label for="' + route + '-q">Pick a town, city or county</label>' +
      '<input id="' + route + '-q" name="q" type="search" autocomplete="off" value="' + esc(q || '') + '" placeholder="For example Fruita or Mesa County"></form>' +
      (q ? (hits.length ? '<ul class="route-list">' + hits.map(function (e) { return '<li><a href="#/' + route + '?g=' + esc(e.geoid) + '">' + esc(e.label) + '</a></li>'; }).join('') + '</ul>'
        : '<p class="note">No Colorado place matches that name.</p>')
        : '<p class="note">Or start with an example: <a href="#/' + route + '?g=0828745">Fruita</a>, <a href="#/' + route + '?g=08077">Mesa County</a>, <a href="#/' + route + '?g=0812045">Carbondale</a>.</p>');
  }
  document.addEventListener('input', function (ev) {
    var form = ev.target.form;
    if (!form || !form.dataset || !form.dataset.pick) return;
    history.replaceState(null, '', '#/' + form.dataset.pick + (ev.target.value ? '?q=' + encodeURIComponent(ev.target.value) : ''));
    Shell.render();
    var box = document.getElementById(form.dataset.pick + '-q');
    if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  });

  // Everything a page needs for one place, or a loading or error line.
  function gather(geoid, title, menu) {
    var entry = Pl.entryFor(geoid);
    var head = function (body) { return T.head({ kind: 'tool', crumbs: T.trail(menu || 'deal', title), title: title }) + body; };
    if (!entry) return { html: head('<p class="callout">No Colorado place has the ID ' + esc(geoid) + '.</p>') };
    var shared = Pl.data(), c = global.LabHna.loadPlace(geoid), extra = UI.load(EXTRA);
    var err = shared.error || c.error || extra.error;
    if (err) return { html: head('<p class="callout">' + esc(err) + '</p>') };
    if (!shared.data || !c.digest || !extra.data) return { html: head('<p role="status" class="note">Loading the public data for ' + esc(entry.label) + '…</p>') };
    var place = Pl.placeFacts(geoid, shared.data);
    var isCounty = String(geoid).length === 5;
    var fips = isCounty ? geoid : place && place.rec.containing_county_fips;
    var county = Pl.countyFacts(fips, shared.data);
    var countyName = county.county ? county.county.county_name : 'the county';
    return { entry: entry, d: shared.data, c: c, x: extra.data, place: place, isCounty: isCounty, fips: fips, county: county, countyName: countyName, name: shortName(entry.label) };
  }

  // ---- Market check ---------------------------------------------------------------------------
  // Rents: what a 60% AMI tax credit home may charge against what renters pay and what listings ask.
  function rentPart(s) {
    var V = global.LabViz;
    var z = s.x.zori, zr = null, zwhere = '';
    if (z && z.cities && !s.isCounty && z.cities[s.name.toLowerCase()]) { zr = z.cities[s.name.toLowerCase()].rent; zwhere = s.name; }
    else if (z && z.counties && z.counties[s.fips]) { zr = z.counties[s.fips].rent; zwhere = s.countyName; }
    var fmr = s.county.hud && s.county.hud.fmr ? s.county.hud.fmr.two_br : null;
    var tc = s.county.chfa60two, paid = val(s.c, 'gross_rent_median');
    var rents = [['Tax credit rent limit, 60% AMI, 2-bedroom', tc, V.COLORS.households], ['HUD Fair Market Rent, 2-bedroom', fmr, V.COLORS.ink],
      ['Median rent paid, all sizes', paid, V.COLORS.muted], ['Typical asking rent' + (zwhere ? ', ' + zwhere : ''), zr, V.COLORS.homes]];
    var edge = zr != null && tc != null ? zr - tc : null;
    var fig = V.rentScale({
      title: 'Rents against the tax credit rent limit', scope: '',
      rents: rents, gap: edge != null ? [0, 3, '$' + num(Math.abs(edge)) + (edge > 0 ? ' below asking rent' : ' above asking rent')] : null,
      answer: edge == null ? null : edge > 0 ? 'The 60% AMI tax credit limit for a 2-bedroom, $' + num(tc) + ', is $' + num(edge) + ' below the typical asking rent for homes of all sizes. The two are not the same kind of rent, so this is not a saving any tenant is sure to see; the market study compares like homes.'
        : 'The 60% AMI tax credit rent limit is $' + num(-edge) + ' above the typical asking rent, so a tax credit home would have to rent below its limit to compete.',
      note: 'The tax credit limit is CHFA’s gross rent, before the utility allowance. The Fair Market Rent and the limit are for a 2-bedroom home; the median and asking rents cover all sizes.',
      source: Pl.srcLine([['CHFA 2026 rent limits', LINKS.chfa], ['HUD ' + (s.d.hud && s.d.hud.meta && s.d.hud.meta.fiscal_year ? 'FY' + s.d.hud.meta.fiscal_year + ' ' : '') + 'Fair Market Rents', LINKS.fmr], ['Census ACS 2020–2024', LINKS.acsRent], ['Zillow Observed Rent Index' + (z && z.meta ? ', ' + String(z.meta.vintage_month).slice(0, 7) : ''), LINKS.zillow]])
    });
    return { fig: fig, edge: edge, tc: tc, zr: zr, fmr: fmr };
  }

  // Supply: tax credit properties in the county, and this year's awards there.
  function supplyPart(s) {
    var proxy = { level: 'county-proxy', countyName: s.countyName };
    var r1 = s.x.roundOne.awards.filter(function (a) { return a.county_fips === s.fips; });
    var lihtc = s.d.lihtc.features.map(function (f) { return f.properties; }).filter(function (p) { return p.CNTY_FIPS === s.fips && p.ComplianceStatus === 'Active Compliance'; });
    var recent = lihtc.filter(function (p) { return +p.AwardYear >= new Date().getFullYear() - 5; }).sort(function (a, b) { return (+b.AwardYear || 0) - (+a.AwardYear || 0); });
    var supplyRows = recent.slice(0, 8).map(function (p) { return '<tr><th scope="row">' + esc(p.PROJECT) + '</th><td>' + esc(p.PROJ_CTY || '') + '</td><td class="num">' + esc(num(p.LI_UNITS)) + '</td><td class="num">' + esc(String(p.AwardYear || '')) + '</td></tr>'; }).join('');
    var r1Rows = r1.map(function (a) { return '<tr><th scope="row">' + esc(a.name) + '</th><td>' + esc(a.city || '') + '</td><td class="num">' + esc(num(a.total_units)) + '</td><td class="num">2026</td></tr>'; }).join('');
    var html = '<p>' + esc(s.countyName) + ' has ' + num(lihtc.length) + ' tax credit properties in compliance with ' + num(s.county.lowIncomeHomes) + ' low-income homes' +
      (r1.length ? '. CHFA’s 2026 Round One added ' + r1.length + (r1.length === 1 ? ' award' : ' awards') + ' here, ' + num(r1.reduce(function (t, a) { return t + (a.total_units || 0); }, 0)) + ' homes.' : '. CHFA’s 2026 Round One made no award here.') + ' ' + Pl.scope(proxy) + '</p>' +
      (supplyRows || r1Rows ? '<div class="table-scroll"><table><caption>Awarded in the last five years, and 2026 Round One</caption><thead><tr><th scope="col">Property</th><th scope="col">City</th><th scope="col" class="num">Homes</th><th scope="col" class="num">Awarded</th></tr></thead><tbody>' + r1Rows + supplyRows + '</tbody></table></div>' : '') +
      '<p class="metric-source">' + Pl.srcLine([['CHFA Housing Tax Credit property list, ' + String(s.d.lihtc.fetchedAt).slice(0, 10), s.d.lihtc.source], ['CHFA 2026 Round One awards', s.x.roundOne.metadata.source_url]]) + '</p>';
    return { html: html, lihtc: lihtc, r1: r1 };
  }

  // Capture: the share of income-qualified renters a project would need, counted the CHFA market-study way by
  // the public site's own engine (PMAMarketScoring.chfaQualifiedRenters, js/market-analysis-scoring.js). The
  // whole county stands in for the market area. Tiers follow the live Market Analysis (js/market-analysis.js):
  // capture divides by renters who qualify for the project's tier; penetration divides existing plus proposed
  // tax credit homes by renters who qualify for any tier up to 80% AMI. 85% is the line in CHFA's 2027-28
  // QAP; the 2025-26 QAP sets none (PMAMarketScoring.CHFA_CAPTURE_LIMIT).
  // Member CHFA-format market study draft (coho-backend gated/developer-chfa-market-study.html). Linked, never copied.
  var CHFA_DRAFT = 'https://coho-backend.communityplanner.workers.dev/developer-chfa-market-study.html';
  var PEN_TIERS = [20, 30, 40, 45, 50, 55, 60, 70, 80], CAP_TIERS = [30, 40, 50, 60, 70, 80];
  function capturePart(s, units, tier, noForm) {
    var E = global.PMAMarketScoring, V = global.LabViz;
    if (!E || !E.chfaQualifiedRenters) return { html: '<p class="note">The site\u2019s capture engine did not load.</p>' };
    var limits = {}; (s.d.chfa.counties || []).forEach(function (c) { limits[c.fips] = c; });
    var tracts = Object.keys(s.x.demand.tracts || {}).filter(function (g) { return g.slice(0, 5) === s.fips; }).map(function (g) { return { geoid: g }; });
    var q = E.chfaQualifiedRenters(s.x.demand, limits, tracts, [tier], undefined, liveOpts(s.x));
    var pool = E.chfaQualifiedRenters(s.x.demand, limits, tracts, PEN_TIERS, undefined, liveOpts(s.x));
    var line = E.CHFA_CAPTURE_LIMIT || 0.85;
    var existing = s.county.lowIncomeHomes || 0;
    var capture = q.value > 0 ? units / q.value : null;
    var pen = pool.value > 0 ? (existing + units) / pool.value : null;
    var p1 = function (x) { return (Math.round(x * 1000) / 10).toFixed(1).replace(/\.0$/, '') + '%'; };
    var form = noForm ? '' : '<form class="capture-form" data-capture="' + esc(s.entry.geoid) + '"><label>Homes in the project <input name="u" type="number" min="1" max="1000" step="1" value="' + units + '"></label>' +
      '<label>Rent and income level <select name="t">' + CAP_TIERS.map(function (t) { return '<option value="' + t + '"' + (t === tier ? ' selected' : '') + '>' + t + '% AMI</option>'; }).join('') + '</select></label></form>';
    if (capture == null) return { html: form + '<p class="callout">No capture rate: ' + esc(q.reason || 'no renter household in ' + s.countyName + ' qualifies for a ' + tier + '% AMI home under CHFA\u2019s rules') + '.</p>', capture: null };
    var meter = function (label, v, note) {
      var w = Math.min(v / 1.2, 1) * 100, lw = line / 1.2 * 100;
      return '<div class="cap-row"><p class="cap-label">' + esc(label) + ' <strong>' + p1(v) + '</strong></p>' +
        '<div class="cap-track" role="img" aria-label="' + esc(label + ' ' + p1(v) + ', against the 85% line') + '"><span class="cap-fill' + (v > line ? ' cap-over' : '') + '" style="width:' + w.toFixed(1) + '%"></span><span class="cap-line" style="left:' + lw.toFixed(1) + '%"></span></div>' +
        '<p class="note">' + esc(note) + '</p></div>';
    };
    var answer = 'A ' + num(units) + '-home project at ' + tier + '% AMI would need ' + p1(capture) + ' of the ' + num(q.value) + ' renter households in ' + s.countyName + ' who qualify for it.' +
      (pen != null ? ' With the county\u2019s ' + num(existing) + ' tax credit homes, ' + p1(pen) + ' of renters who qualify at any tax credit level would be in one' + (pen > line ? ', over the 85% line in CHFA\u2019s rules.' : ', under the 85% line in CHFA\u2019s rules.') : '');
    var src = s.x.demand.meta && s.x.demand.meta.sources || {};
    // A town that holds a small slice of the county's low-income renters still gets the whole county's pool here
    // (Ramah: 0.6% capture on 9,884 renters). Under 5% of the county's renters at or under 80% AMI, lead with the
    // town's own count. 5% is our judgement of where the county pool stops describing the town, not a CHFA rule.
    var smallNote = '';
    if (!s.isCounty && s.place && s.county.county) {
      var own = s.place.rec.households_le_ami_pct && s.place.rec.households_le_ami_pct['80'];
      var all = s.county.county.households_le_ami_pct && s.county.county.households_le_ami_pct['80'];
      if (own != null && all > 0 && own / all < 0.05) {
        smallNote = '<p class="callout"><strong>' + esc(s.name) + ' holds ' + (own / all < 0.001 ? 'under 0.1%' : p1(own / all)) + ' of ' + esc(s.countyName) + '’s low-income renters.</strong> ' +
          esc(s.name) + ' has about ' + num(own) + ' renter households at or under 80% AMI' + (own > 0 ? '; a ' + num(units) + '-home project is ' + (units / own >= 10 ? num(Math.round(units / own)) : (Math.round(units / own * 10) / 10)) + ' times that' : '') + '. ' +
          'The rate below counts every qualified renter in the county, so it only holds if the project draws from across ' + esc(s.countyName) + '. A market study would draw a smaller market area. We flag places under 5% of the county’s renters; that cut-off is our judgement, not a CHFA rule.</p>';
      }
    }
    var html = form + smallNote + '<figure class="viz cap-figure"><figcaption><strong>Capture rate</strong>' + Pl.scope({ level: 'county-proxy', countyName: s.countyName }) + '</figcaption>' +
      '<p class="viz-answer">' + esc(answer) + '</p>' +
      meter('Capture rate, this project', capture, num(units) + ' homes \u00f7 ' + num(q.value) + ' renter households who qualify for a ' + tier + '% AMI home.') +
      (pen != null ? meter('Penetration, all tax credit homes', pen, '(' + num(existing) + ' existing + ' + num(units) + ' proposed) \u00f7 ' + num(pool.value) + ' renter households who qualify at 20 to 80% AMI.') : '') +
      '<p class="note">The marked line is 85%: CHFA\u2019s 2027\u201328 QAP (adopted October 2026) will not accept a rate above it without more demand data. The 2025\u201326 QAP sets no number. Qualified renters follow CHFA\u2019s Market Study Guide: income at or under the limit, rent no more than 40% of income, 1 to 3 bedroom household sizes.</p>' +
      '<p class="metric-source">' + Pl.srcLine([[(src.chas ? src.chas.name : 'HUD CHAS 2018\u20132022'), src.chas && src.chas.url], [(src.pums ? src.pums.name : 'Census ACS PUMS'), src.pums && src.pums.url], ['CHFA 2026 rent limits', LINKS.chfa], ['CHFA Housing Tax Credit property list', s.d.lihtc.source]]) + '</p></figure>';
    return { html: html, capture: capture, penetration: pen, qualified: q.value, pool: pool.value, small: !!smallNote };
  }
  document.addEventListener('change', function (ev) {
    var form = ev.target.form;
    if (!form || !form.dataset || !form.dataset.capture) return;
    var u = Math.max(1, Math.min(1000, Math.round(+form.u.value) || 60));
    history.replaceState(null, '', '#/market?g=' + encodeURIComponent(form.dataset.capture) + '&u=' + u + '&t=' + form.t.value);
    Shell.render();
  });

  function market(params) {
    var g = params.get('g');
    if (!g) return picker('market', 'Market check', 'Renters, rents, tax credit supply and a capture rate for any Colorado place, from public data.', params.get('q'));
    var s = gather(g, 'Market check');
    if (s.html) return s.html;
    if (global.LabHna && global.LabHna.setWorking) global.LabHna.setWorking(g); // the market check's place becomes the working place
    var b60 = s.place ? s.place.bands[3] : null;
    var here = s.isCounty ? Pl.AT.county : Pl.AT.place;
    var vac = metric(s.c, 'active_market_vacancy_rate_pct');
    var rent = rentPart(s), supply = supplyPart(s);
    var units = Math.max(1, Math.min(1000, Math.round(+params.get('u')) || 60)), tier = CAP_TIERS.indexOf(+params.get('t')) > -1 ? +params.get('t') : 60;
    var cap = capturePart(s, units, tier);

    var facts = [
      { value: b60 ? num(b60.households) : '—', label: 'Renter households at or below 60% AMI' + (s.isCounty ? '' : ', ' + s.name), source: 'Census ACS 2020–2024', href: Pl.SRC.acsGap },
      { value: b60 ? num(b60.homes) : '—', label: 'Homes renting at prices they can afford', source: 'Census ACS 2020–2024', href: Pl.SRC.acsGap },
      { value: num(s.county.lowIncomeHomes), label: 'Tax credit homes in compliance, ' + s.countyName, source: 'CHFA property list', href: s.d.lihtc.source },
      { value: vac ? pct(vac.value) : '—', label: 'Homes vacant and for rent or sale' + (s.isCounty ? '' : ', ' + s.name), source: 'Census ACS 2020–2024', href: LINKS.acsRent }
    ];
    return T.head({
      kind: 'tool', crumbs: T.trail('deal', 'Market check', [{ label: 'Pick a place', href: '#/market' }]), title: 'Market check: ' + s.entry.label,
      answer: 'Who rents here, what they can pay, how rents compare with what a tax credit home can charge, how much tax credit housing the county has, and the capture rate a project would need.',
      meta: '<span class="scope-tag">Free screen, not a market study</span> Town figures are for ' + esc(s.entry.label) + '. Supply and the tax credit rent limit are county-wide, the closest public stand-in for a market area.',
      facts: facts
    }) +
      '<h2>Renters and the homes priced for them</h2>' + (s.place ? Pl.gapChart(s.place, here, s.d) : '<p class="note">The income gap file has no row for this place.</p>') +
      '<h2>Rents</h2>' + rent.fig +
      '<h2>Tax credit supply in ' + esc(s.countyName) + '</h2>' + supply.html +
      '<h2>Capture rate</h2>' + cap.html +
      '<h2 id="mk-pma">Draw the market area</h2>' +
      '<p>This screen uses the whole county. A CHFA market study needs a primary market area drawn round the site from whole census tracts; CHFA does not accept a radius. The full Market Analysis draws it: place the site, add or drop tracts, and note the natural barriers, school districts, town lines or commute patterns that justify the edge. Demand by income and bedroom size, capture and nearby comparables then count only what is inside it.</p>' +
      '<p><a href="' + LIVE + 'deal-market-analysis.html?geoid=' + encodeURIComponent(g) + '" rel="noopener">Open the full Market Analysis and draw the market area ↗</a></p>' +
      '<p>Members can then start a <a href="' + CHFA_DRAFT + '" rel="noopener">CHFA-format market study ↗</a>: CHFA\u2019s nine sections in order, the tables public data can fill, six maps, and a Word file for a CHFA-approved analyst to finish. It supports the study; it is not the study CHFA accepts.</p>' +
      '<p class="metric-source">' + Pl.srcLine('CHFA Market Study Guide, Appendix A to the 2027–28 QAP (adopted 25 September 2026, approved 23 October 2026)', 'https://www.chfainfo.com/getattachment/0978a6c3-ed9b-4058-8a35-becc27dd9d8d/2027-2028-QAP.pdf') + '</p>' +
      T.next('Next', [{ href: '#/report?g=' + encodeURIComponent(g), label: 'Free report for ' + s.name }, { href: LIVE + 'deal-market-analysis.html?geoid=' + encodeURIComponent(g), label: 'Full Market Analysis ↗', secondary: true }, { href: '#/for-sale?g=' + encodeURIComponent(g), label: 'For-sale and ownership here', secondary: true }]);
  }

  // ---- For-sale and ownership ----------------------------------------------------------------
  var BANDS = [[0.6, '60% AMI'], [0.8, '80% AMI'], [1.0, '100% AMI'], [1.2, '120% AMI']];
  var YEARS = 15, MARKET_RATE = 0.03;
  function reachPart(s) {
    var V = global.LabViz, OF = global.OwnershipFinance;
    var ami = s.place ? s.place.rec.ami_4person : null;
    var homeM = metric(s.c, 'median_home_value'), home = homeM ? homeM.value : null;
    var rate = OF.MORTGAGE_RATE || null;
    var bands = BANDS.map(function (b) { return [b[1], ami ? OF.maxAffordablePrice(ami, b[0]) : null]; });
    var at80 = bands[1][1];

    // 3.2: who the homes are priced for.
    var short = bands.filter(function (b) { return b[1] != null && home != null && b[1] < home; });
    var reach = V.reachBars({
      title: 'What each income can pay, against the typical home', scope: homeM ? Pl.scope({ level: homeM.geography_level === 'county' ? 'county-proxy' : 'place', countyName: s.countyName }) : '',
      rows: bands, target: home, targetLabel: 'Typical home',
      answer: home == null ? null : short.length === bands.length ? 'Even a household at 120% AMI falls $' + num(home - bands[3][1]) + ' short of the typical home.'
        : short.length ? 'Households up to ' + short[short.length - 1][0] + ' fall short of the typical home; at 80% AMI the gap is $' + num(home - at80) + '.'
        : 'A household at 60% AMI can afford the typical home.',
      note: 'What a four-person household can pay, from HUD’s area median income and the site’s ownership engine: 30-year loan, 10% down, 30% of income for the payment, taxes, insurance and mortgage insurance' + (rate ? ', at ' + (rate.rateAnnual * 100).toFixed(2) + '% (' + rate.source + ')' : '') + '.',
      source: Pl.srcLine([[homeM && /zillow/.test(homeM.source_id) ? 'Zillow Home Value Index, ' + homeM.as_of : 'Census ACS 2020–2024', homeM && /zillow/.test(homeM.source_id) ? LINKS.zillow : LINKS.acsValue], ['HUD FY2026 income limits', LINKS.il]])
    });
    return { fig: reach, ami: ami, home: home, homeM: homeM, at80: at80, bands: bands, short: short };
  }

  function forSale(params) {
    var g = params.get('g');
    if (!g) return picker('for-sale', 'For-sale and ownership', 'What households at each income can pay for a home, against what homes cost, and how shared-equity resale formulas play out. Free.', params.get('q'));
    var s = gather(g, 'For-sale and ownership');
    if (s.html) return s.html;
    var V = global.LabViz, OF = global.OwnershipFinance, OR = global.OwnershipResale;
    if (!OF || !OR) return T.head({ kind: 'tool', crumbs: T.trail('deal', 'For-sale and ownership'), title: 'For-sale and ownership' }) + '<p class="callout">The site’s ownership engines did not load.</p>';
    var r = reachPart(s), ami = r.ami, home = r.home, homeM = r.homeM, at80 = r.at80, reach = r.fig;

    // 3.3: the most a shared-equity home can resell for, year by year, under each formula, from the engine.
    var doc = s.x.resale, conv = OR.conventionList(doc).filter(function (k) { return k.type !== 'recapture'; });
    var input = function (years) {
      var mv = OR.scenarioMarketValue(at80, years, MARKET_RATE);
      return { purchasePrice: at80, holdingPeriodYears: years, unrestrictedMarketValue: mv, marketAppreciation: mv == null ? null : mv - at80, ami4Person: ami, targetAmiPct: 0.80, maxAffordablePrice: OF.maxAffordablePrice };
    };
    var COLORS = [V.COLORS.homes, V.COLORS.blue, V.COLORS.purple];
    var years = []; for (var y = 0; y <= YEARS; y++) years.push(y);
    var series = [{ label: 'Market sale, 3% a year', color: V.COLORS.households, points: years.map(function (y) { return [y, OR.scenarioMarketValue(at80, y, MARKET_RATE)]; }) }]
      .concat(conv.map(function (k, i) { return { label: k.label, color: COLORS[i % COLORS.length], dash: i > 0, points: years.map(function (y) { return [y, OR.evaluateConvention(k, input(y)).maxResalePrice]; }) }; }));
    var lines = at80 ? V.multiLine({
      title: 'What a shared-equity home can resell for, by years owned', scope: '',
      series: series, ref: { y: at80, label: 'Affordable at 80% AMI today' }, xUnit: 'years',
      answer: 'A home bought for $' + num(at80) + ', the most an 80% AMI household can pay here, resells for $' + num(series[0].points[YEARS][1]) + ' on the open market after ' + YEARS + ' years at 3% a year. The resale formulas cap it lower, at $' +
        num(Math.min.apply(null, series.slice(1).map(function (x) { return x.points[YEARS][1]; }))) + ' to $' + num(Math.max.apply(null, series.slice(1).map(function (x) { return x.points[YEARS][1]; }))) + '.',
      note: 'Market growth of 3% a year is the site’s moderate scenario. Recapture is left out: the home sells at market and public money is repaid from the owner’s gain. Screening only; the deed restriction or ground lease decides the real terms.',
      source: Pl.srcLine([['COHO resale conventions, verified ' + ((doc.meta && doc.meta.last_verified) || ''), LIVE + 'for-sale-market-study.html']])
    }) : '';

    // 3.4: each formula as input, rule and result at 10 years.
    var cards = at80 ? '<div class="resale-cards">' + OR.conventionList(doc).map(function (k) {
      var r = OR.evaluateConvention(k, input(10));
      return '<article class="resale-card"><h3>' + esc(k.label) + '</h3>' +
        '<p><span class="rc-k">Input</span> Bought for $' + num(at80) + '</p>' +
        '<p><span class="rc-k">Rule</span> ' + esc(r.calculationBasis || k.objective || '') + '</p>' +
        '<p><span class="rc-k">After 10 years</span> <strong>' + (r.maxResalePrice != null ? '$' + num(r.maxResalePrice) : 'Not available') + '</strong></p>' +
        '<p class="rc-keep ' + (r.preservesAffordability ? 'rc-yes' : r.preservesAffordability === false ? 'rc-no' : '') + '">' + esc(r.preservationLabel) + '</p>' +
        (k.source_url ? '<p class="note"><a href="' + esc(k.source_url) + '">' + esc(k.source_program || 'Source') + '</a></p>' : '') + '</article>';
    }).join('') + '</div>' : '';

    var facts = [
      { value: home != null ? '$' + num(home) : '—', label: 'Typical home value' + (s.isCounty ? '' : ', ' + s.name), source: homeM && /zillow/.test(homeM.source_id) ? 'Zillow ZHVI' : 'Census ACS', href: homeM && /zillow/.test(homeM.source_id) ? LINKS.zillow : LINKS.acsValue },
      { value: at80 != null ? '$' + num(at80) : '—', label: 'Most a household at 80% AMI can pay', source: 'COHO ownership engine', href: LIVE + 'methods.html' },
      { value: pct(val(s.c, 'pct_owner_stock_affordable_100ami')) || '—', label: 'Owner homes valued within reach at 100% AMI', source: 'Census ACS B25075', href: LINKS.acsValue },
      { value: pct(val(s.c, 'pct_owner_burdened_30plus')) || '—', label: 'Owners paying over 30% of income', source: 'HUD CHAS', href: 'https://www.huduser.gov/portal/datasets/cp.html' }
    ];
    var rec = val(s.c, 'ownership_need_recommendation');
    return T.head({
      kind: 'tool', crumbs: T.trail('deal', 'For-sale and ownership', [{ label: 'Pick a place', href: '#/for-sale' }]), title: 'For-sale and ownership: ' + s.entry.label,
      answer: 'Who can buy here, how far each income falls short of the typical home, and how deed-restricted resale formulas keep homes affordable.',
      meta: '<span class="scope-tag">Free screen, not a for-sale study</span>' + (rec ? ' The HNA reads this place as: ' + esc(rec) + '.' : ''),
      facts: facts
    }) +
      '<h2>Who the homes are priced for</h2>' + (reach || '<p class="note">No home value or income limit is published for this place.</p>') +
      '<h2>What happens when an owner sells</h2>' + lines +
      '<h2>The resale formulas, side by side</h2>' + cards +
      '<p class="note">' + esc(OR.SCREENING_CAVEAT) + '</p>' +
      '<div class="callout">This is a free screen. The full for-sale study, with land structures, resale settlements, effective demand and capture, is a member tool, as the full Market Analysis is.</div>' +
      T.next('Next', [{ href: '#/report?g=' + encodeURIComponent(g), label: 'Free report for ' + s.name }, { href: LIVE + 'for-sale-market-study.html', label: 'Full for-sale study ↗', secondary: true }, { href: '#/market?g=' + encodeURIComponent(g), label: 'Market check here', secondary: true }, { href: '#/assistance', label: 'Help for homebuyers', secondary: true }]);
  }

  Shell.views.market = market;
  Shell.views['for-sale'] = forSale;
  global.LabMarket = { EXTRA: EXTRA, LINKS: LINKS, market: market, forSale: forSale, BANDS: BANDS, gather: gather, picker: picker, metric: metric, shortName: shortName, rentPart: rentPart, supplyPart: supplyPart, reachPart: reachPart, capturePart: capturePart, PEN_TIERS: PEN_TIERS };
})(window);
