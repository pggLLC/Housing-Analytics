// Opportunities: the hub as four records with figures, and a lab screen for each. The tax credit
// portfolio, the preservation map list, Proposition 123 land banking awards and CHFA's 2026 Round One
// awards are read as published; the only arithmetic is counting and summing their rows.
(function (global) {
  'use strict';

  // A column strip under 200 px for a page head (Gemini round 10, pick A): one column per row, its value on top.
  function colStrip(title, rows, src, altSrc) {
    if (!rows || rows.length < 2) return '';
    var max = Math.max.apply(null, rows.map(function (r) { return r[1] || 0; })) || 1;
    var k = function (v) { return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v)); };
    return '<figure class="col-strip" aria-label="' + Shell.esc((global.LabTpl && global.LabTpl.alt || function (f, s) { return f + '. Source: ' + s + '.'; })(title, altSrc || src)) + '">' +
      '<figcaption><strong>' + Shell.esc(title) + '</strong></figcaption><ol class="cs-cols" aria-hidden="true">' + rows.map(function (r) {
        return '<li><span class="cs-v">' + k(r[1] || 0) + '</span><span class="cs-bar" style="height:' + Math.max(2, (r[1] || 0) / max * 70).toFixed(0) + 'px"></span><span class="cs-l">\u2019' + String(r[0]).slice(-2) + '</span></li>';
      }).join('') + '</ol><p class="metric-source">' + Shell.esc(src) + '</p></figure>';
  }

  var Shell = global.LabShell, UI = global.LabUI;
  var esc = Shell.esc, num = UI.num, money = UI.money;

  var FILES = {
    lihtc: 'data/chfa-lihtc.json',
    preservation: 'data/affordable-housing/preservation/chfa-preservation.json',
    landBank: 'data/policy/prop123-land-banking-awards.json',
    roundOne: 'data/affordable-housing/chfa-awards/2026-round-one.json'
  };
  var AMI_TIERS = [['20% AMI or less', 'lte20'], ['30% AMI', 'ami30'], ['40% AMI', 'ami40'], ['50% AMI', 'ami50'], ['60% AMI', 'ami60'], ['70% AMI', 'ami70'], ['80% AMI', 'ami80'], ['100% AMI', 'ami100'], ['120% AMI', 'ami120']];
  var LIHTC_SRC = 'CHFA Housing Tax Credit Properties feed';
  // The preservation file carries no URL of its own; this is the CHFA layer the live site's fetch script reads.
  var PRES_URL = 'https://services3.arcgis.com/gSW3qyxbcpEXSMfe/arcgis/rest/services/PreservationProperties_Layer_Final_view_new/FeatureServer/0';

  // Menus that narrow a screen. Each choice lives in the address (f.<key>=value), so Back and a copied link
  // return to the same view; a change re-renders the screen and puts focus back on the menu.
  function hashParts() {
    var raw = (location.hash || '#/').slice(1), q = raw.indexOf('?');
    return { path: q > -1 ? raw.slice(0, q) : raw, params: new URLSearchParams(q > -1 ? raw.slice(q + 1) : '') };
  }
  function chosen(key, dflt) { var v = hashParts().params.get('f.' + key); return v == null ? (dflt || '') : v; }
  // options: [[value, label]]
  function menu(key, label, options, dflt) {
    var cur = chosen(key, dflt);
    return '<label class="opp-menu"><span>' + esc(label) + '</span><select data-opp-menu="' + esc(key) + '" data-default="' + esc(dflt || '') + '">' +
      options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
  }
  function menus(html) { return '<div class="opp-menus" role="group" aria-label="Narrow the list">' + html + '</div>'; }
  document.addEventListener('change', function (ev) {
    var key = ev.target.dataset && ev.target.dataset.oppMenu;
    if (!key) return;
    var h = hashParts();
    if (ev.target.value === (ev.target.dataset.default || '')) h.params.delete('f.' + key); else h.params.set('f.' + key, ev.target.value);
    var qs = h.params.toString();
    history.replaceState(null, '', '#' + h.path + (qs ? '?' + qs : ''));
    Shell.render();
    var again = document.querySelector('[data-opp-menu="' + key + '"]');
    if (again) again.focus();
  });

  // A CSV of the rows a screen shows. The rows are kept when the screen draws, and the file is made on click.
  var CSV = {};
  function csvLink(id, label, header, rows) {
    CSV[id] = { header: header, rows: rows };
    return '<p class="opp-csv"><a class="button-link secondary" href="#" data-opp-csv="' + esc(id) + '" download="' + esc(id) + '.csv">' + esc(label) + '</a></p>';
  }
  function csvText(c) {
    var q = function (v) { v = v == null ? '' : String(v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return [c.header].concat(c.rows).map(function (r) { return r.map(q).join(','); }).join('\r\n');
  }
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('[data-opp-csv]');
    if (!a || !CSV[a.dataset.oppCsv]) return;
    ev.preventDefault();
    var url = URL.createObjectURL(new Blob(['﻿' + csvText(CSV[a.dataset.oppCsv])], { type: 'text/csv' }));
    var t = document.createElement('a');
    t.href = url; t.download = a.getAttribute('download');
    document.body.appendChild(t); t.click(); t.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  // The county a mapped point falls in, by the same even-odd ray test over every ring of the Census
  // county outlines (data/co-county-boundaries.json) that the live preservation page uses.
  function countyIndex(gj) {
    return gj.features.map(function (f) {
      var g = f.geometry, rings = g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? [].concat.apply([], g.coordinates) : [];
      var xs = [], ys = [];
      rings.forEach(function (r) { r.forEach(function (c) { xs.push(c[0]); ys.push(c[1]); }); });
      return { name: f.properties.NAME, fips: f.properties.GEOID, rings: rings, box: [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)] };
    });
  }
  function inRing(lon, lat, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function countyAt(index, lon, lat) {
    if (!isFinite(lon) || !isFinite(lat)) return null;
    for (var i = 0; i < index.length; i++) {
      var c = index[i], b = c.box;
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      var n = c.rings.filter(function (r) { return inRing(lon, lat, r); }).length;
      if (n % 2 === 1) return c;
    }
    return null;
  }

  function facts(d) {
    var props = d.lihtc.features.map(function (f) { return f.properties; });
    var active = props.filter(function (p) { return p.ComplianceStatus === 'Active Compliance'; });
    var pres = d.preservation.features.map(function (f) { return f.properties; });
    return {
      props: props, active: active, pres: pres,
      activeHomes: active.reduce(function (t, p) { return t + (p.LI_UNITS || 0); }, 0),
      presHomes: pres.reduce(function (t, p) { return t + (p.N_UNITS || 0); }, 0),
      fetched: String(d.lihtc.fetchedAt || '').slice(0, 10)
    };
  }

  // Every Opportunities screen opens with the Data template's head under the menu's breadcrumb.
  function frame(title, back) {
    var extra = back === '#/opportunity/preservation' ? [{ label: 'Preservation inventory', href: back }] : [];
    return global.LabTpl.head({ kind: 'data', crumbs: global.LabTpl.trail('opportunities', title, extra), title: title });
  }
  function loading(title) {
    var s = UI.load(FILES);
    if (s.error) return { html: frame(title) + '<p class="callout">' + esc(s.error) + '</p>' };
    if (!s.data) return { html: frame(title) + '<p role="status" class="note">Loading the public records…</p>' };
    return { d: s.data };
  }

  function hub() {
    var s = UI.load(FILES);
    var head = Shell.hubHead('opportunities');
    if (s.data) {
      head = global.LabTpl.head({
        kind: 'hub', crumbs: [{ label: 'Home', href: '#/' }, { label: 'Opportunities' }], title: 'Opportunities',
        answer: 'Where affordable homes already stand, which ones could be lost, and where the state is putting money now.',
        meta: '<span class="scope-tag">Scope: Colorado</span> CHFA Housing Tax Credit properties; HUD Multifamily Assisted properties; USDA Rural Development multifamily rentals.'
      });
    }
    var rest = Shell.list(Shell.catalog().entries.filter(function (e) { return e.hub === 'opportunities' && ['chfa-portfolio.html', 'preservation.html', 'land-banking-awards.html', 'land-value.html'].indexOf(e.path) < 0; }));
    if (s.error) return head + '<p class="callout">' + esc(s.error) + '</p>' + rest;
    if (!s.data) return head + '<p role="status" class="note">Loading the public records…</p>';
    var d = s.data, f = facts(d), lb = d.landBank.meta, r1 = d.roundOne.metadata;
    return head +
      '<h2>Open a record set</h2>' +
      '<div class="metrics">' +
      UI.linkCard('#/opportunity/portfolio', 'Tax credit properties in compliance', num(f.active.length), num(f.activeHomes) + ' low-income homes', LIHTC_SRC + ', ' + f.fetched, d.lihtc.source) +
      UI.linkCard('#/opportunity/preservation', 'Properties on CHFA’s preservation map', num(f.pres.length), num(f.presHomes) + ' homes. About half match a tax credit or USDA record that dates them; the page shows each date', 'CHFA preservation map, no date in the source file', PRES_URL) +
      UI.linkCard('#/opportunity/land-banking', 'Prop 123 land banking awards', num(lb.award_count), UI.millions(lb.total_awarded) + ' for about ' + num(lb.total_estimated_units) + ' future homes', 'CHFA award lists, ' + lb.generated, lb.program_url) +
      UI.linkCard('#/opportunity/round-one', '2026 Round One tax credit awards', num(r1.parsed_count), num(r1.press_release_total_units) + ' homes, $' + r1.press_release_total_equity_M + ' million in equity', 'CHFA, ' + r1.announcement_date, r1.source_url) +
      '</div>' +
      UI.bars('Low-income homes in tax credit properties, by year awarded', 'Five-year periods, all compliance states', UI.tally(f.props, function (p) { var y = p.AwardYear && Math.floor(p.AwardYear / 5) * 5; return !y ? null : y + 4 >= new Date().getFullYear() ? y + ' to date' : y + '–' + (y + 4); }, function (p) { return p.LI_UNITS; })
        .sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }), num) + global.LabTpl.source(LIHTC_SRC, d.lihtc.source, f.fetched) +
      '<div class="callout"><strong>Land banking is open now.</strong> ' + esc(lb.open_round.summary) + ' <a href="' + esc(lb.open_round.source_url) + '">CHFA program page</a>, checked ' + esc(lb.open_round.checked) + '.</div>' +
      '<h2>Jobs and commuting</h2><ul class="choices">' + '<li class="choice"><a href="#/opportunity/commuting"><h3>Commuting and jobs</h3><p>How many of a town’s jobs are held by people who drive in, how far, and what the drive costs.</p></a></li>' + '</ul>' +
      '<h2>More tools</h2>' + rest +
      global.LabTpl.next('Next', [{ href: '#/opportunity/preservation', label: 'Homes that could be lost \u2192' }, { href: '#/opportunity/land-value', label: 'Value a site', secondary: true }, { href: '#/deal-calculator', label: 'Test a LIHTC deal', secondary: true }]);
  }

  // The portfolio map adds the county outlines and HUD's two designated-area layers.
  var PORT_FILES = { lihtc: FILES.lihtc, preservation: FILES.preservation, landBank: FILES.landBank, roundOne: FILES.roundOne,
    counties: 'data/boundaries/counties_co.geojson', qct: 'data/qct-colorado.json', dda: 'data/dda-colorado.json' };
  function rings(g) { return g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; }
  function pathOf(g) { return rings(g).map(function (poly) { return poly.map(function (ring) { return 'M' + ring.map(function (c) { return xy(c).join(' '); }).join('L') + 'Z'; }).join(''); }).join(''); }
  // A county's label point: the middle of its largest ring's bounding box, enough for Colorado's mostly boxy counties.
  function middle(g) {
    var best = null, area = -1;
    rings(g).forEach(function (poly) {
      var xs = poly[0].map(function (c) { return c[0]; }), ys = poly[0].map(function (c) { return c[1]; });
      var a = (Math.max.apply(null, xs) - Math.min.apply(null, xs)) * (Math.max.apply(null, ys) - Math.min.apply(null, ys));
      if (a > area) { area = a; best = [(Math.max.apply(null, xs) + Math.min.apply(null, xs)) / 2, (Math.max.apply(null, ys) + Math.min.apply(null, ys)) / 2]; }
    });
    return best;
  }
  // Tax credit properties grouped by county: one circle per county, its area matching the count, so the Front
  // Range reads as counts instead of a blob of pins. QCT and DDA areas are switchable layers under the circles.
  // Map kit part 2: the finding, from the same counts the circles draw.
  function portFinding(d, byFips, active) {
    var nm = {}; d.counties.features.forEach(function (f) { nm[f.properties.GEOID] = f.properties.NAME; });
    var ks = Object.keys(byFips).sort(function (a, b) { return byFips[b] - byFips[a]; }), top3 = ks.slice(0, 3), n3 = top3.reduce(function (t, k) { return t + byFips[k]; }, 0);
    return ks.length ? nm[top3[0]] + ', ' + nm[top3[1]] + ' and ' + nm[top3[2]] + ' counties hold ' + Math.round(n3 / active.length * 100) + '% of the ' + num(active.length) + ' tax credit properties in compliance; ' + (d.counties.features.length - ks.length) + ' counties have none' : 'Tax credit properties by county';
  }
  function countyMap(d, active) {
    var byFips = {};
    active.forEach(function (p) { var k = p.CNTY_FIPS; if (k) byFips[k] = (byFips[k] || 0) + 1; });
    var max = Math.max.apply(null, Object.keys(byFips).map(function (k) { return byFips[k]; })) || 1;
    var outline = d.counties.features.map(function (f) { return '<path d="' + pathOf(f.geometry) + '"><title>' + esc(f.properties.NAMELSAD) + '</title></path>'; }).join('');
    var qct = d.qct.features.map(function (f) { return '<path d="' + pathOf(f.geometry) + '"><title>' + esc('Qualified Census Tract ' + f.properties.GEOID) + '</title></path>'; }).join('');
    var dda = d.dda.features.map(function (f) { return '<path d="' + pathOf(f.geometry) + '"><title>' + esc('Difficult Development Area: ' + (f.properties.DDA_NAME || f.properties.NAME)) + '</title></path>'; }).join('');
    var circles = d.counties.features.map(function (f) {
      var fips = f.properties.GEOID, n = byFips[fips];
      if (!n) return '';
      var c = xy(middle(f.geometry)), r = Math.max(4, 26 * Math.sqrt(n / max));
      var name = f.properties.NAMELSAD;
      return '<g class="pc-county"><circle cx="' + c[0] + '" cy="' + c[1] + '" r="' + r.toFixed(1) + '"><title>' + esc(name + ': ' + n + ' tax credit properties in compliance') + '</title></circle>' +
        (r >= 11 ? '<text x="' + c[0] + '" y="' + (+c[1] + 5) + '" text-anchor="middle">' + n + '</text>' : '') + '</g>';
    }).join('');
    return '<figure class="pres-map port-map">' +
      '<figcaption><span class="cc-kicker">Tax credit properties by county</span><strong>' + esc(portFinding(d, byFips, active)) + '</strong><span class="note">One circle per county, its area matching the number of properties in compliance. Tap or point to a circle for the county and count; zoom with the + and \u2212 buttons or a pinch, and drag to move around. HUD\u2019s Qualified Census Tracts and Difficult Development Areas can be switched on underneath.</span></figcaption>' +
      '<fieldset class="pm-toggles"><legend class="visually-hidden">Show on the map</legend>' +
      '<label class="pm-toggle"><input type="checkbox" checked data-pm-layer="projects"><span class="pm-key pc-key-projects" aria-hidden="true"></span>Properties by county (' + num(active.length) + ')</label>' +
      '<label class="pm-toggle"><input type="checkbox" checked data-pm-layer="qct"><span class="pm-key pc-key-qct" aria-hidden="true"></span>Qualified Census Tracts (' + num(d.qct.features.length) + ')</label>' +
      '<label class="pm-toggle"><input type="checkbox" data-pm-layer="dda"><span class="pm-key pc-key-dda" aria-hidden="true"></span>Difficult Development Areas (' + num(d.dda.features.length) + ')</label>' +
      '</fieldset>' +
      '<div class="pm-frame"><svg viewBox="0 0 ' + MAP_W + ' ' + MAP_H + '" role="group" aria-label="Colorado counties with a circle sized by tax credit properties">' +
      '<g class="pm-counties">' + outline + '</g><g class="pm-layer pc-dda" data-layer="dda" style="display:none">' + dda + '</g><g class="pm-layer pc-qct" data-layer="qct">' + qct + '</g>' +
      '<g class="pm-layer pc-projects" data-layer="projects">' + circles + '</g>' + K.cities() + '</svg></div>' +
      '<p class="note">QCT and DDA designations: HUD, ' + esc(String(d.dda.designationYear || '')) + '. County outlines: US Census TIGER. Counts are CHFA properties in active compliance.</p>' +
      (global.LabVizData ? global.LabVizData.block('Tax credit properties by county', ['County', 'Properties in compliance'], d.counties.features.map(function (f) { return [f.properties.NAMELSAD, byFips[f.properties.GEOID] || 0]; })
        .sort(function (a, b) { return a[0] < b[0] ? -1 : 1; })) : '') + '</figure>';
  }

  // The live portfolio page's own field rules, so a filter here picks the same properties it does there.
  function creditLabel(v) {
    if (v == null || v === '') return null;
    var s = String(v);
    if (s === 'MIHTC') return 'MIHTC';
    if (s.indexOf('9%') === 0 && s.indexOf('State') > -1) return '9% + State';
    if (s.indexOf('4%') === 0 && s.indexOf('State') > -1) return '4% + State';
    if (s.indexOf('9%') === 0) return '9%';
    if (s.indexOf('4%') === 0) return '4%';
    return s;
  }
  var CREDIT_MENU = [['', 'All types'], ['9pct', '9% competitive'], ['4pct', '4% bond / tax-exempt'], ['state', 'State-paired'], ['mihtc', 'MIHTC']];
  function creditIs(v, k) {
    var s = String(v || '');
    return !k || (k === '9pct' ? s.indexOf('9%') === 0 : k === '4pct' ? s.indexOf('4%') === 0 : k === 'state' ? s.indexOf('State') > -1 || s === 'MIHTC' : k === 'mihtc' ? s === 'MIHTC' : true);
  }
  var DEV_LABEL = { 'new': 'New construction', rehab: 'Rehab', mixed: 'New + rehab' };
  function devType(p) {
    var s = String(p.ProjectType || ''), n = /New Construction/i.test(s), r = /Rehab/i.test(s);
    return n && r ? 'mixed' : n ? 'new' : r ? 'rehab' : null;
  }
  var SERVES = [['', 'Any population'], ['family', 'Families'], ['senior', 'Seniors'], ['supportive', 'Supportive housing'], ['homeless', 'People experiencing homelessness'], ['special', 'Special populations'], ['veteran', 'Veterans']];
  var INCOME = [['', 'Any income level'], ['le30', 'Has homes at 30% AMI or less'], ['le50', 'Has homes at 50% AMI or less'], ['gt60', 'Has homes above 60% AMI']];
  var INCOME_BANDS = { le30: ['lte20', 'ami30'], le50: ['lte20', 'ami30', 'ami40', 'ami50'], gt60: ['ami70', 'ami80', 'ami100', 'ami120'] };
  // A record whose breakdown is all zero has no breakdown, so it matches no specific group.
  function hasSplit(g) { return !!g && typeof g === 'object' && Object.keys(g).some(function (k) { return Number(g[k]) > 0; }); }
  function servesIs(p, k) { return !k || (hasSplit(p.PopulationUnits) && Number(p.PopulationUnits[k]) > 0); }
  function incomeIs(p, k) { return !k || (hasSplit(p.AMIUnits) && INCOME_BANDS[k].some(function (b) { return Number(p.AMIUnits[b]) > 0; })); }
  // Award year, guarding against the 8888 and 9999 "unknown" codes older HUD records carry.
  function awardYear(p) {
    var c = [p.AwardYear, p.YR_ALLOC, p.ReservationYear];
    for (var i = 0; i < c.length; i++) { var y = parseInt(c[i], 10); if (y >= 1986 && y <= 2030) return y; }
    return null;
  }
  // Whether the deal took the 30% basis boost, as HUD's LIHTC database reports it. CHFA's feed carries QCT and
  // DDA columns with no values, so a blank there is never read as "no".
  function boost(p) {
    var q = p.QCT, dd = p.DDA, known = function (v) { return v !== null && v !== undefined && v !== ''; };
    if ((known(dd) && (dd === 1 || dd === '1')) || (known(q) && (q === 1 || q === '1'))) return [(dd == 1 ? 'DDA ' : '') + (q == 1 ? 'QCT' : '')].join('').trim();
    if (known(dd) || known(q)) return 'No';
    if (p.HUD && p.HUD.basis === 1) return 'Yes';
    if (p.HUD && p.HUD.basis === 0) return 'No';
    return 'Not published';
  }
  function mapUrl(p, c) {
    var ok = function (v) { return v != null && v !== '' && isFinite(Number(v)) && Number(v) !== 0; };
    var q = c && ok(c[1]) && ok(c[0]) ? c[1] + ',' + c[0] : p.PROJ_ADD ? [p.PROJ_ADD, p.PROJ_CTY, p.PROJ_ST || 'CO'].filter(Boolean).join(', ') : null;
    return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : null;
  }

  function portfolio() {
    var L = (function () {
      var st = UI.load(PORT_FILES);
      if (st.error) return { html: frame('CHFA multifamily portfolio') + '<p class="callout">' + esc(st.error) + '</p>' };
      if (!st.data) return { html: frame('CHFA multifamily portfolio') + '<p role="status" class="note">Loading the public records…</p>' };
      return { d: st.data };
    })();
    if (L.html) return L.html;
    var f = facts(L.d), T = global.LabTpl, r1 = L.d.roundOne;
    var all = L.d.lihtc.features.map(function (x) { return { p: x.properties, c: x.geometry && x.geometry.coordinates }; });
    var counties = Object.keys(UI.tally(all, function (x) { return x.p.CNTY_NAME; }).reduce(function (o, r) { o[r[0]] = 1; return o; }, {})).sort();
    var years = all.map(function (x) { return awardYear(x.p); }).filter(Boolean);
    var y0 = Math.min.apply(null, years), y1 = Math.max.apply(null, years), yearOpts = [];
    for (var y = y0; y <= y1; y++) yearOpts.push([String(y), String(y)]);
    var want = { county: chosen('pf.county'), credit: chosen('pf.credit'), dev: chosen('pf.dev'), setting: chosen('pf.setting'), serves: chosen('pf.serves'), income: chosen('pf.income'), from: Number(chosen('pf.from')) || 0, to: Number(chosen('pf.to')) || 0 };
    var shown = all.filter(function (x) {
      var p = x.p, yr = awardYear(p) || 0;
      return (!want.county || p.CNTY_NAME === want.county) && creditIs(p.CREDIT, want.credit) && (!want.dev || devType(p) === want.dev) &&
        (!want.setting || p.UrbanRural === want.setting) && servesIs(p, want.serves) && incomeIs(p, want.income) &&
        (!want.from || yr >= want.from) && (!want.to || yr <= want.to);
    });
    var sp = shown.map(function (x) { return x.p; });
    var sy = sp.map(awardYear).filter(Boolean);
    var narrowed = shown.length < all.length;
    var rows = shown.map(function (x) {
      var p = x.p;
      return { name: p.PROJECT, city: p.PROJ_CTY, county: p.CNTY_NAME, homes: p.N_UNITS, li: p.LI_UNITS, year: awardYear(p), resv: (parseInt(p.YR_ALLOC, 10) >= 1986 && parseInt(p.YR_ALLOC, 10) <= 2030) ? p.YR_ALLOC : null,
        credit: creditLabel(p.CREDIT), dev: DEV_LABEL[devType(p)] || null, map: mapUrl(p, x.c) ? 'Map' : null, mapUrl: mapUrl(p, x.c), boost: boost(p), status: p.ComplianceStatus || 'Not stated', addr: p.PROJ_ADD };
    }).sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
    var ami = AMI_TIERS.map(function (t) { return [t[0], f.active.reduce(function (s, p) { return s + ((p.AMIUnits && p.AMIUnits[t[1]]) || 0); }, 0)]; });
    var byCounty = UI.tally(f.active, function (p) { return p.CNTY_NAME; }, function (p) { return p.LI_UNITS; }).slice(0, 12);
    var top = byCounty[0];
    var liveMax = all.reduce(function (m, x) { return x.p.AwardDate && x.p.AwardDate > m ? x.p.AwardDate : m; }, '').slice(0, 10);
    var r1m = r1.metadata, r1units = r1.awards.reduce(function (s, a) { return s + (+a.total_units || 0); }, 0);
    var sum = function (k) { return sp.reduce(function (s, p) { return s + (parseInt(p[k], 10) || 0); }, 0); };
    var countyCount = Object.keys(sp.reduce(function (o, p) { if (p.CNTY_NAME) o[p.CNTY_NAME] = 1; return o; }, {})).length;
    var SRC = 'CHFA Housing Tax Credit feed, ' + f.fetched;
    return T.head({
      kind: 'data', crumbs: T.trail('opportunities', 'CHFA multifamily portfolio'), title: 'CHFA multifamily portfolio',
      answer: 'Every Housing Tax Credit property in CHFA’s feed: where it is, how many homes, for which incomes, and what kind of deal. ' +
        num(f.activeHomes) + ' low-income homes are in ' + num(f.active.length) + ' properties still in compliance; ' + esc(top[0]) + ' County has the most, ' + num(top[1]) + '.',
      meta: '<span class="scope-tag">Scope: Colorado, by property</span> CHFA’s Housing Tax Credit properties feed, with HUD’s LIHTC database for the basis boost.',
      dated: L.d,
      facts: [
        { value: num(shown.length), label: narrowed ? 'Properties that match the menus, of ' + num(all.length) : 'Tax credit properties, every compliance status', source: SRC, href: L.d.lihtc.source },
        { value: num(sum('N_UNITS')), label: 'Homes, all income levels', source: SRC, href: L.d.lihtc.source },
        { value: num(sum('LI_UNITS')), label: 'Low-income (income-restricted) homes', source: SRC, href: L.d.lihtc.source },
        { value: num(countyCount), label: 'Counties served, of Colorado’s 64', source: SRC, href: L.d.lihtc.source },
        { value: sy.length ? Math.min.apply(null, sy) + '–' + Math.max.apply(null, sy) : 'None', label: 'Years CHFA awarded the credits, first to last', source: SRC, href: L.d.lihtc.source }
      ]
    }) +
      T.onThisPage([{ id: 'pf-map', title: 'Where they are' }, { id: 'pf-list', title: 'Every property' }, { id: 'pf-r1', title: 'Awards not yet in the feed' }, { id: 'pf-about', title: 'About the columns' }], true) +
      '<section id="pf-map" tabindex="-1"><h2>Where they are</h2>' + countyMap(L.d, f.active) + T.source(LIHTC_SRC, L.d.lihtc.source, f.fetched) +
      '<div class="chart-pair">' +
      UI.bars('Low-income homes by county', 'The 12 counties with the most, properties in compliance', byCounty.map(function (r) { return [r[0] + ' County', r[1]]; }), num) +
      UI.bars('Homes by income limit', 'Properties in compliance, where CHFA lists the mix', ami, num) +
      '</div>' + T.source(LIHTC_SRC, L.d.lihtc.source, f.fetched) + '</section>' +
      '<section id="pf-list" tabindex="-1"><h2>Every property</h2>' +
      '<p>Narrow the list by county, credit, kind of deal, setting, who it serves, income targeting or the year CHFA awarded the credits. The facts above follow the menus.</p>' +
      menus(
        menu('pf.county', 'County', [['', 'All counties']].concat(counties.map(function (c) { return [c, c]; }))) +
        menu('pf.credit', 'Credit type', CREDIT_MENU) +
        menu('pf.dev', 'Development', [['', 'Any type'], ['new', 'New construction'], ['rehab', 'Rehab'], ['mixed', 'New + rehab']]) +
        menu('pf.setting', 'Setting', [['', 'All settings'], ['Urban', 'Urban'], ['Rural', 'Rural'], ['Mountain', 'Mountain']]) +
        menu('pf.serves', 'Serves', SERVES) +
        menu('pf.income', 'Income targeting', INCOME) +
        menu('pf.from', 'Award year from', [['', 'Any']].concat(yearOpts)) +
        menu('pf.to', 'to', [['', 'Any']].concat(yearOpts))) +
      csvLink('chfa-portfolio', 'Download these properties (CSV)', ['Property', 'Address', 'City', 'County', 'Total units', 'Low-income units', 'Award year', 'Reservation year', 'Credit type', 'Development', 'Basis boost', 'Compliance status'],
        rows.map(function (r) { return [r.name, r.addr, r.city, r.county, r.homes, r.li, r.year, r.resv, r.credit, r.dev, r.boost, r.status]; })) +
      UI.table('lihtc', 'Tax credit properties', [
        { key: 'name', label: 'Property', href: function (r) { return UI.placeFor(r.city); } },
        { key: 'city', label: 'City' },
        { key: 'county', label: 'County' },
        { key: 'homes', label: 'Homes', num: true, fmt: num, tip: 'All units in the property' },
        { key: 'li', label: 'Low-income', num: true, fmt: num, tip: 'Units restricted by the tax credit' },
        { key: 'year', label: 'Awarded', num: true, tip: 'Year CHFA awarded the credits' },
        { key: 'resv', label: 'Reservation', num: true, tip: 'Year of the credit reservation (allocation year)' },
        { key: 'credit', label: 'Credit', tip: '9% competitive, 4% with tax-exempt bonds, state credits paired with either, and MIHTC (middle-income credit)' },
        { key: 'dev', label: 'Development', tip: 'New construction, rehab of an existing building, or both, from CHFA’s project type' },
        { key: 'map', label: 'Location', href: function (r) { return r.mapUrl; }, tip: 'Opens Google Maps at the point CHFA publishes, or the street address when there is no point' },
        { key: 'boost', label: 'Basis boost', tip: 'Whether the deal took the 30% boost in eligible basis, as reported to HUD’s LIHTC database' },
        { key: 'status', label: 'Status', tip: 'CHFA compliance status' }
      ], rows, { noun: 'properties' }) + T.source(LIHTC_SRC, L.d.lihtc.source, f.fetched) +
      '<p class="note">A property name links to its town’s Housing Needs Assessment when one is published. Newest awards first; sort by any column heading.</p></section>' +
      '<section id="pf-r1" tabindex="-1"><h2>Awards not yet in the feed</h2>' +
      '<p>Two vintages sit side by side. CHFA’s live feed: latest record dated ' + esc(liveMax) + '. CHFA’s 2026 Round One, announced ' + esc(r1m.announcement_date) + ': ' + num(r1.awards.length) + ' developments, ' + num(r1units) + ' homes, $' + esc(r1m.press_release_total_equity_M) + ' million in equity. The feed usually picks up a round two to three months after CHFA announces it, so these are listed apart and not added to the totals above.</p>' +
      '<ul class="opp-cards">' + r1.awards.map(function (a) {
        var c = [a.federal_9pct_credit && '9%: ' + money(+a.federal_9pct_credit), a.federal_4pct_credit && '4%: ' + money(+a.federal_4pct_credit), a.state_credit && 'state: ' + money(+a.state_credit), a.toc_credit && 'TOC: ' + money(+a.toc_credit)].filter(Boolean);
        return '<li><strong>' + esc(a.name) + '</strong> · ' + esc(a.city || '—') + '<span>' + esc((a.total_units || '—') + ' homes · ' + (a.sponsor || 'Sponsor not named')) + '</span>' + (c.length ? '<span>' + esc(c.join(' · ')) + '</span>' : '') + '</li>';
      }).join('') + '</ul>' +
      '<p class="note">Sources: <a href="' + esc(r1m.source_url) + '">CHFA award descriptions</a> and <a href="' + esc(r1m.press_release_url) + '">press release</a>. All 14 are on the <a href="#/opportunity/round-one">2026 Round One</a> screen.</p></section>' +
      '<section id="pf-about" tabindex="-1"><h2>About the columns</h2>' +
      '<p><strong>Location.</strong> CHFA’s feed publishes no property website, so Map opens Google Maps at the coordinates CHFA publishes for the property. The property’s own listing is usually one click away there. A property with no coordinates is looked up by street address, and one with neither shows a dash rather than a guessed location.</p>' +
      '<p><strong>Development, setting, serves and income.</strong> Each uses a field CHFA publishes for every property. Development is the kind of deal (new construction, rehab of an existing building, or both), not the building form: CHFA publishes no building type. Serves and income targeting match a property with at least one home in that group. A few properties have no population or income breakdown in CHFA’s data; they appear under “Any” but drop out when you pick a group, because the source does not say whether they serve it.</p>' +
      '<p><strong>Basis boost.</strong> Whether the deal took the 30% increase in eligible basis, as reported to HUD’s LIHTC database (HUD’s records run through properties that opened in 2024, updated April 2026). A boost can come from a QCT, a DDA or a state designation under IRC 42(d)(5)(B)(v), so “Yes” does not by itself mean the site is in a QCT or DDA. CHFA’s feed carries DDA and QCT columns but publishes no values in them, and each deal turns on the designation in force at its allocation. The lists are redrawn every year and these properties were allocated between ' + y0 + ' and ' + y1 + ', so no QCT or DDA badge is drawn from today’s boundaries. Deals HUD has not yet recorded, mostly those awarded since 2021, show Not published rather than a blank, because a blank reads as “no”.</p>' +
      '<p><strong>Award year</strong> is the year CHFA awarded the credits. CHFA’s feed publishes no placed-in-service year, and a property typically opens two to three years after its award, so a recent award year can be a project still under construction. Data may lag the current allocation year by 12 to 18 months.</p></section>' +
      T.source(LIHTC_SRC, L.d.lihtc.source, f.fetched) +
      T.source('HUD LIHTC database (basis boost)', 'https://www.huduser.gov/portal/datasets/lihtc.html', 'records through properties placed in service in 2024') +
      T.next('Next', [{ href: '#/opportunity/preservation', label: 'Preservation candidates →' }, { href: '#/opportunity/round-one', label: '2026 Round One awards', secondary: true }, { href: '#/places', label: 'Find a place', secondary: true }]);
  }

  // Preservation reads three more public files: HUD's assisted properties, USDA's rural rentals and
  // CHFA's award reports (for acquisition and rehab examples).
  var PRES_FILES = {
    lihtc: FILES.lihtc, preservation: FILES.preservation, landBank: FILES.landBank, roundOne: FILES.roundOne,
    hud: 'data/affordable-housing/preservation/hud-multifamily-assisted.json',
    usda: 'data/affordable-housing/preservation/usda-rural-housing.json',
    awards: 'data/policy/funding-awards/award-rows.json',
    counties: 'data/boundaries/counties_co.geojson',
    // HUD's Section 8 and 202/811 contract list, the property pages the live site has checked, and the
    // county outlines the live page places each property with.
    contracts: 'data/market/hud_s8_contracts_co.json',
    sites: 'data/affordable-housing/property-websites.json',
    coBounds: 'data/co-county-boundaries.json'
  };
  var HUD_URL = 'https://hudgis-hud.opendata.arcgis.com/datasets/HUD::multifamily-properties-assisted/';
  var USDA_URL = 'https://www.rd.usda.gov/data-sets/multi-family-housing-rentals';
  var AWARDS_URL = 'https://www.chfainfo.com/rental-housing/housing-credit/awards';
  var THIS_YEAR = new Date().getFullYear();

  function presLoading(title) {
    var s = UI.load(PRES_FILES);
    if (s.error) return { html: frame(title) + '<p class="callout">' + esc(s.error) + '</p>' };
    if (!s.data) return { html: frame(title) + '<p role="status" class="note">Loading the public records…</p>' };
    return { d: s.data };
  }

  // Records from different feeds are matched on street address and city, with street words such as
  // "Street" and "N" dropped. No feed shares an ID, so a match is likely, not certain, and says so.
  function addrKey(p) {
    var a = String(p.PROJ_ADD || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ')
      .replace(/\b(STREET|ST|AVENUE|AVE|ROAD|RD|DRIVE|DR|BLVD|BOULEVARD|LANE|LN|COURT|CT|PLACE|PL|WAY|N|S|E|W|NORTH|SOUTH|EAST|WEST)\b/g, ' ');
    return a.split(/\s+/).filter(Boolean).join(' ') + '|' + String(p.PROJ_CTY || '').trim().toUpperCase();
  }
  function index(rows) {
    var m = {};
    rows.forEach(function (p) { var k = addrKey(p); (m[k] = m[k] || []).push(p); });
    return m;
  }
  function presData(d) {
    if (d._pres) return d._pres;
    var props = function (f) { return f.features.map(function (x) { return x.properties; }); };
    var x = {
      chfa: props(d.preservation), hud: props(d.hud), usda: props(d.usda), lihtc: props(d.lihtc),
      examples: acqRehab(d.awards.rows)
    };
    x.byAddr = { hud: index(x.hud), usda: index(x.usda), lihtc: index(x.lihtc) };
    // Each CHFA property's county, from its mapped point (a point near a county line can land next door).
    var ci = d.coBounds ? countyIndex(d.coBounds) : [];
    x.county = {};
    d.preservation.features.forEach(function (ft) {
      var c = ft.geometry && ft.geometry.coordinates, hit = c ? countyAt(ci, Number(c[0]), Number(c[1])) : null;
      if (hit) x.county[ft.properties.RecordID] = hit.name;
    });
    x.matches = function (p) {
      var k = addrKey(p);
      return { hud: x.byAddr.hud[k] || [], usda: x.byAddr.usda[k] || [], lihtc: x.byAddr.lihtc[k] || [] };
    };
    return (d._pres = x);
  }

  // CHFA's award reports mark acquisition and rehab as "A/R" or "Acquisition/Rehabilitation".
  // The fields are read from each row as CHFA printed it.
  function acqRehab(rows) {
    return rows.filter(function (r) { return /\bA\/R\b|Acquisition\s*\/\s*Rehab/i.test(r.quote); }).map(function (r) {
      var f = {};
      r.quote.split('; ').forEach(function (part) { var i = part.indexOf(': '); if (i > 0) f[part.slice(0, i).replace(/\s+/g, ' ').trim()] = part.slice(i + 2); });
      var year = Number(f['Cycle Year']) || Number((/20\d\d/.exec(r.source_file) || [])[0]) || null;
      var homes = Number(String(f['Total Units'] || '').replace(/[^0-9]/g, '')) || null;
      var bond = f['PAB Amount ***'] || f['PAB Amount'] || f['Bond Amount'] || null;
      return { name: r.name, city: r.location, year: year, homes: homes, type: f['Building Type'] || f.Type || f['Typ e *'] || '', bond: bond, sponsor: r.sponsor, report: r.source_file };
    }).sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
  }

  // Tax credit dates are estimates from the year placed in service: the 15-year compliance period and
  // the 30-year federal minimum. Actual terms are in each property's recorded agreement, and many
  // Colorado agreements run longer.
  function est(p, n) { return p.YR_PIS ? p.YR_PIS + n : null; }
  function usdaEnd(p) { var s = String(p.restrictive_expiration || ''); return /^\d{8}$/.test(s) ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6) : null; }

  // A map drawn from the records' own coordinates over the Census county outlines, with no basemap
  // tiles (nothing is fetched from a map server). Each layer can be switched off; a CHFA point opens
  // its property page. Dot area follows the number of homes.
  // Statewide frame and projection from site/map-kit.js.
  var K = global.LabMap, MAP_W = K.W, MAP_H = K.H;
  function xy(c) { return [K.x(c[0]).toFixed(1), K.y(c[1]).toFixed(1)]; }
  var LAYERS = [
    // Map kit part 2 (Gemini round 15, pick 3): each list has its own shape as well as its colour.
    { id: 'chfa', label: 'CHFA preservation map', cls: 'pm-chfa', shape: 'circle' },
    { id: 'hud', label: 'HUD-assisted', cls: 'pm-hud', shape: 'square' },
    { id: 'usda', label: 'USDA rural', cls: 'pm-usda', shape: 'triangle' }
  ];
  function presMap(d) {
    var outline = d.counties.features.map(function (f) {
      var rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      return '<path d="' + rings.map(function (poly) { return poly.map(function (ring) { return 'M' + ring.map(function (c) { return xy(c).join(' '); }).join('L') + 'Z'; }).join(''); }).join('') + '"><title>' + esc(f.properties.NAMELSAD) + '</title></path>';
    }).join('');
    var counts = {}, insetGroups = [];
    var dots = LAYERS.map(function (L) {
      var feats = d[L.id === 'chfa' ? 'preservation' : L.id].features.filter(function (f) { return f.geometry && f.geometry.coordinates && f.geometry.coordinates[0] < -100; });
      counts[L.id] = feats.length;
      insetGroups.push({ cls: L.cls, layer: L.id, dots: feats.map(function (f) {
        var p = f.properties;
        return { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], r: Math.max(3, Math.min(12, Math.sqrt(p.N_UNITS || 1) * 0.75)), shape: L.shape, href: L.id === 'chfa' ? '#/opportunity/preservation/' + esc(p.RecordID) : null,
          label: esc(String(p.PROJECT).trim() + ', ' + String(p.PROJ_CTY || '').trim() + ': ' + (num(p.N_UNITS) || 'no count of') + ' homes (' + L.label + ')') };
      }) });
      return '<g class="pm-layer ' + L.cls + '" data-layer="' + L.id + '">' + feats.map(function (f) {
        var p = f.properties, c = xy(f.geometry.coordinates), r = Math.max(2.2, Math.min(9, Math.sqrt(p.N_UNITS || 1) * 0.5)).toFixed(1);
        var t = '<title>' + esc(String(p.PROJECT).trim() + ', ' + String(p.PROJ_CTY || '').trim() + ': ' + (num(p.N_UNITS) || 'no count of') + ' homes (' + L.label + ')') + '</title>';
        var dot = L.shape === 'circle' ? '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="' + r + '">' + t + '</circle>' : '<path class="mk-g" d="' + K.glyph(L.shape, +c[0], +c[1], +r) + '">' + t + '</path>';
        return L.id === 'chfa' ? '<a href="#/opportunity/preservation/' + esc(p.RecordID) + '">' + dot + '</a>' : dot;
      }).join('') + '</g>';
    }).join('');
    return '<figure class="pres-map">' +
      '<figcaption><span class="cc-kicker">Where the properties are</span><strong>' + esc(num(counts.chfa) + ' CHFA, ' + num(counts.hud) + ' HUD-assisted and ' + num(counts.usda) + ' USDA rural properties to watch across Colorado') + '</strong><span class="note">Each mark is a property, sized by its homes: circles CHFA, squares HUD, triangles USDA. Tap or point to a dot for its name; select a CHFA dot to open its page. The list below has every property.</span></figcaption>' +
      '<fieldset class="pm-toggles"><legend class="visually-hidden">Show on the map</legend>' + LAYERS.map(function (L) {
        return '<label class="pm-toggle"><input type="checkbox" checked data-pm-layer="' + L.id + '"><span class="pm-key ' + L.cls + '" aria-hidden="true"></span>' + esc(L.label) + ' (' + num(counts[L.id]) + ')</label>';
      }).join('') + '</fieldset>' +
      '<div class="pm-frame"><svg viewBox="0 0 ' + MAP_W + ' ' + MAP_H + '" role="group" aria-label="Map of Colorado preservation properties by source">' +
      '<g class="pm-counties">' + outline + '</g>' + dots + K.metroBox() + K.cities() + '</svg></div>' +
      K.inset({ features: d.counties.features, groups: insetGroups }) +
      '<p class="note">Mobile home parks are not on this map yet. Their registry is kept by the Colorado Division of Housing and is not in the site’s data. County outlines: US Census TIGER.</p></figure>';
  }
  document.addEventListener('change', function (ev) {
    var id = ev.target.dataset && ev.target.dataset.pmLayer;
    if (!id) return;
    // The state map and its metro close-up both carry the layer.
    var fig = ev.target.closest('.pres-map') || document;
    Array.prototype.forEach.call(fig.querySelectorAll('[data-layer="' + id + '"]'), function (g) { g.style.display = ev.target.checked ? '' : 'none'; });
  });

  // HUD writes most names in capitals: shown in title case, keeping roman numerals and anything with a digit.
  function niceName(s) {
    s = String(s || '');
    if (s !== s.toUpperCase()) return s;
    return s.toLowerCase().replace(/[a-z0-9'.&-]+/g, function (w) {
      if (/^(i{1,3}|iv|v|vi{0,3}|ix|x)$/.test(w) || /\d/.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    });
  }
  function usDate(iso) {
    if (!iso) return null;
    var d = new Date(iso + 'T12:00:00Z');
    return isNaN(d) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  function cityCase(s) {
    var t = String(s || '').trim();
    return t && t === t.toUpperCase() ? t.toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }) : t;
  }
  function count(v) { var n = parseFloat(v); return v == null || v === '' || !isFinite(n) || n <= 0 ? null : n; }
  var SIZES = [['', 'All sizes'], ['1-24', '1–24 units'], ['25-49', '25–49 units'], ['50-99', '50–99 units'], ['100+', '100 or more units'], ['none', 'No unit count listed']];
  function sizeIs(n, k) {
    if (!k) return true;
    if (k === 'none') return n == null;
    if (n == null) return false;
    return k === '1-24' ? n < 25 : k === '25-49' ? n >= 25 && n < 50 : k === '50-99' ? n >= 50 && n < 100 : n >= 100;
  }
  // HUD's window: Dec 31, n years after the year HUD's file is current to.
  function windowEnd(asOf, n) { return ((Number(String(asOf || '').slice(0, 4)) || THIS_YEAR) + n) + '-12-31'; }
  // A property's own page shows only when the checked entry still names the same property.
  function siteFor(sites, c) {
    var e = sites && sites['hud-mf:' + c.property_id];
    if (!e || e.kind !== 'property' || !/^https:\/\//.test(e.url)) return null;
    return String(e.name).trim().toUpperCase() === String(c.property_name || '').trim().toUpperCase() ? e.url : null;
  }

  function contractsSection(d) {
    var doc = d.contracts, m = doc.meta, sites = (d.sites && d.sites.entries) || {};
    var y0 = Number(String(m.as_of).slice(0, 4)) || THIS_YEAR;
    var dflt = windowEnd(m.as_of, 5);
    var county = chosen('hc.county'), until = chosen('hc.until', dflt);
    var names = {};
    doc.contracts.forEach(function (c) { if (c.county_fips) names[c.county_fips] = c.county_name; });
    var rows = doc.contracts.filter(function (c) { return (!county || c.county_fips === county) && (!until || (c.term_ends && c.term_ends <= until)); })
      .sort(function (a, b) { return a.term_ends < b.term_ends ? -1 : a.term_ends > b.term_ends ? 1 : 0; });
    var homes = rows.reduce(function (t, c) { return t + (c.assisted_units || 0); }, 0);
    var byYear = UI.tally(rows, function (c) { return c.term_ends ? c.term_ends.slice(0, 4) : null; }, function (c) { return c.assisted_units || 0; }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    var table = rows.map(function (c) {
      var ended = /expired/i.test(c.status || '');
      return { name: niceName(c.property_name), url: siteFor(sites, c), ends: usDate(c.term_ends) + (ended ? ' (HUD lists it as expired)' : ''), endsIso: c.term_ends, homes: c.assisted_units, city: c.city, county: c.county_name, program: c.program };
    });
    return '<section id="p-hud" tabindex="-1"><h2>Federal rent subsidy contracts ending soon</h2>' +
      '<p>HUD pays part of the rent in these properties under Section 8 and Section 202/811 contracts. When a contract’s term ends, the owner can renew it or leave the program. An ending term is a date to watch, not a loss.</p>' +
      '<p class="chapter-finding" role="status">' + num(rows.length) + ' HUD rent subsidy contract' + (rows.length === 1 ? '' : 's') + ', covering ' + num(homes) + ' homes' +
      (county ? ' in ' + esc(names[county]) + ' County' : ' in Colorado') + ', ' + (until ? 'end their current term by ' + esc(usDate(until)) : 'are listed') + '.</p>' +
      menus(menu('hc.county', 'County', [['', 'All counties']].concat(Object.keys(names).sort(function (a, b) { return names[a].localeCompare(names[b]); }).map(function (k) { return [k, names[k] + ' County']; }))) +
        menu('hc.until', 'Term ends', [1, 2, 5, 10].map(function (n) { return [windowEnd(m.as_of, n), 'By the end of ' + (y0 + n)]; }).concat([['', 'Any year']]), dflt)) +
      UI.bars('Assisted homes whose contract term ends, by year', 'The contracts the menus pick. A year can hold several contracts at one property.', byYear, num) +
      UI.table('hudc', 'HUD rent subsidy contracts', [
        { key: 'name', label: 'Property', href: function (r) { return r.url; }, tip: 'Property name as HUD lists it. A linked name opens the property’s own page, where one was found and checked' },
        { key: 'ends', label: 'Term ends', tip: 'End of the contract’s overall term (HUD tracs_overall_expiration_date). Owners can renew' },
        { key: 'homes', label: 'Assisted homes', num: true, fmt: num, tip: 'Homes this contract pays rent on. A property can have more than one contract' },
        { key: 'city', label: 'City', tip: 'City in HUD’s property address' },
        { key: 'county', label: 'County', tip: 'County in HUD’s property record' },
        { key: 'program', label: 'Program', tip: 'HUD program that pays the rent subsidy' }
      ], table, { noun: 'contracts', placeholder: 'Property, city or program' }) +
      '<p class="metric-source">Source: <a href="' + esc(m.source_url) + '">HUD Multifamily Assistance &amp; Section 8 Contracts database</a>, current as of ' + esc(usDate(m.as_of)) + ', read ' + esc(usDate(m.fetched)) + '. It covers HUD project-based contracts only, not Housing Tax Credit, USDA or local restrictions. Owner and manager contacts are not copied here; HUD’s file has them.</p></section>';
  }

  function preservation() {
    var L = presLoading('Preservation inventory');
    if (L.html) return L.html;
    var f = facts(L.d), x = presData(L.d);
    var byCity = UI.tally(f.pres, function (p) { return (p.PROJ_CTY || '').trim(); }, function (p) { return p.N_UNITS; });
    var byCounty = UI.tally(f.pres, function (p) { return x.county[p.RecordID]; }, function (p) { return count(p.N_UNITS) || 0; });
    var nCounties = byCounty.length, noCount = f.pres.filter(function (p) { return count(p.N_UNITS) == null; }).length;
    var placed = f.pres.filter(function (p) { return x.county[p.RecordID]; }).length;
    var SRC = 'CHFA preservation map';
    var T = global.LabTpl;
    var sPres = T.source('CHFA preservation properties layer', PRES_URL, 'retrieved September 2026'),
      sLihtc = T.source(LIHTC_SRC, L.d.lihtc.source, f.fetched),
      sHud = T.source('HUD Multifamily Properties, Assisted', HUD_URL, 'no date in the source file'),
      sUsda = T.source('USDA Rural Development multifamily housing rentals', USDA_URL, 'no date in the source file');
    var exYears = x.examples.map(function (r) { return r.year; }).filter(Boolean);
    var sAwards = T.source('CHFA Housing Tax Credit award reports, each row as printed', AWARDS_URL, exYears.length ? 'reports ' + Math.min.apply(null, exYears) + '–' + Math.max.apply(null, exYears) : '');
    var window10 = [];
    for (var y = THIS_YEAR; y < THIS_YEAR + 10; y++) window10.push(y);
    var reach = function (n) {
      return window10.map(function (yr) { return [String(yr), x.lihtc.filter(function (p) { return est(p, n) === yr; }).reduce(function (t, p) { return t + (p.LI_UNITS || 0); }, 0)]; });
    };
    var y15 = reach(15), y30 = reach(30);
    var sum = function (r) { return r.reduce(function (t, v) { return t + v[1]; }, 0); };
    var BANDS = [['Date has passed', function (y) { return y < THIS_YEAR; }], [THIS_YEAR + '–' + (THIS_YEAR + 4), function (y) { return y >= THIS_YEAR && y < THIS_YEAR + 5; }], [(THIS_YEAR + 5) + '–' + (THIS_YEAR + 9), function (y) { return y >= THIS_YEAR + 5 && y < THIS_YEAR + 10; }], [(THIS_YEAR + 10) + ' or later', function (y) { return y >= THIS_YEAR + 10; }]];
    var usdaBands = BANDS.map(function (b) { return [b[0], x.usda.filter(function (p) { var e = usdaEnd(p); return e && b[1](Number(e.slice(0, 4))); }).reduce(function (t, p) { return t + (p.N_UNITS || 0); }, 0)]; });
    var usdaNone = x.usda.filter(function (p) { return !usdaEnd(p); }).length;
    var hudTypes = UI.tally(x.hud, function (p) { return p.property_category || 'Not given'; }, function (p) { return p.LI_UNITS || 0; });
    var troubled = x.hud.filter(function (p) { return p.is_troubled; });
    var wantCounty = chosen('pr.county'), wantSize = chosen('pr.size');
    var listed = f.pres.filter(function (p) { return (!wantCounty || x.county[p.RecordID] === wantCounty) && sizeIs(count(p.N_UNITS), wantSize); });
    var rows = listed.map(function (p) {
      var m = x.matches(p);
      var also = [m.lihtc.length && 'Tax credit', m.hud.length && 'HUD', m.usda.length && 'USDA'].filter(Boolean).join(', ');
      var y15s = m.lihtc.map(function (l) { return est(l, 15); }).filter(function (v) { return v >= THIS_YEAR; });
      var ends = m.usda.map(usdaEnd).filter(Boolean);
      return { id: p.RecordID, name: String(p.PROJECT).trim(), addr: p.PROJ_ADD, city: cityCase(p.PROJ_CTY), county: x.county[p.RecordID] || 'Not assigned', zip: p.Zip != null ? String(p.Zip) : null, homes: count(p.N_UNITS), also: also || null, next15: y15s.length ? Math.min.apply(null, y15s) : null, usdaEnd: ends.length ? ends.sort()[0] : null };
    });
    var matched = rows.filter(function (r) { return r.also; }).length;
    var listedHomes = rows.reduce(function (t, r) { return t + (r.homes || 0); }, 0);
    return T.head({
      kind: 'data', crumbs: T.trail('opportunities', 'Preservation inventory'), title: 'Preservation inventory',
      strip: colStrip(num(sum(y15)) + ' tax credit homes reach year 15 by ' + (THIS_YEAR + 9) + ' (estimate)', y15, 'Year placed in service plus 15, from ' + LIHTC_SRC + '. The extended-use agreement runs on after it. Fetched ' + f.fetched + '.', 'CHFA tax credit properties, fetched ' + f.fetched),
      answer: 'Which existing affordable homes could be lost, when, and how Colorado keeps them. CHFA lists ' + num(f.pres.length) + ' properties with ' + num(f.presHomes) + ' homes in ' + num(nCounties) + ' counties; ' + esc(byCounty[0][0]) + ' County has the most, ' + num(byCounty[0][1]) + '.',
      meta: '<span class="scope-tag">Scope: Colorado, by property</span> CHFA’s preservation map, with HUD, USDA and tax credit records matched by address, and HUD’s rent subsidy contracts.',
      facts: [
        { value: num(f.pres.length), label: 'Properties on CHFA’s map, ' + num(f.presHomes) + ' homes', source: SRC, href: PRES_URL },
        { value: num(nCounties), label: 'Counties with a listed property; ' + num(noCount) + ' properties list no unit count', source: SRC, href: PRES_URL },
        { value: num(sum(y15)), label: 'Tax credit homes reaching year 15 by ' + (THIS_YEAR + 9) + ' (estimate)', source: LIHTC_SRC, href: L.d.lihtc.source },
        { value: num(troubled.length), label: 'HUD-assisted properties HUD flags as troubled, of ' + num(x.hud.length), source: 'HUD Multifamily Assisted', href: HUD_URL },
        { value: num(x.examples.length), label: 'Acquisition and rehab awards in CHFA’s reports', source: 'CHFA award reports', href: AWARDS_URL }
      ]
    }) +
      '<p>CHFA lists properties that receive or have received an incentive to keep them affordable, such as rent supplements, below-market financing or Housing Tax Credits, drawn from CHFA’s portfolio and from the Colorado Division of Housing, the City and County of Denver, USDA and HUD. This copy of the map layer was retrieved in September 2026; CHFA updates its own portfolio annually and partner data at staggered intervals. The layer gives each property’s name, address, city, ZIP code and total units, not its subsidy or end dates, so this page matches other public records by address and shows <a href="#/opportunity/preservation?at=p-hud" data-jump="p-hud">HUD’s contract end dates</a> further down. Verify current restrictions with CHFA.</p>' +
      T.onThisPage([{ id: 'p-dates', title: 'When homes could be lost' }, { id: 'p-where', title: 'Where they are' }, { id: 'p-list', title: 'Every property' }, { id: 'p-examples', title: 'Colorado examples' }, { id: 'p-hud', title: 'HUD contracts ending soon' }, { id: 'p-how', title: 'How preservation works' }], true) +
      '<section id="p-dates" tabindex="-1"><h2>When homes could be lost</h2>' +
      // Gemini round 16 picks 1 and 3, round 10 pick A (paul 11-05): the year-15 strip in the page head carries the
      // message; every date chart, year 15 by year included, folds under "Show the numbers".
      '<details class="fold"><summary>Show the numbers: year 15, year 30, USDA and HUD dates</summary><div class="chart-pair">' +
      UI.bars(num(sum(y15)) + ' tax credit homes reach year 15 by ' + (THIS_YEAR + 9) + ' (estimate), by year', 'Estimate: year placed in service plus 15, when the federal compliance period ends. The extended-use agreement runs on after it.', y15, num) +
      UI.bars('Tax credit homes reaching year 30, by year', 'Estimate: year placed in service plus 30, the federal minimum. Many Colorado agreements run longer.', y30, num) +
      '</div>' + sLihtc + '<div class="chart-pair">' +
      UI.bars('USDA rural homes, by restriction end date', 'As USDA lists it. A past date does not mean the homes have left the program; USDA still lists them.' + (usdaNone ? ' ' + usdaNone + (usdaNone === 1 ? ' property gives' : ' properties give') + ' no date.' : ''), usdaBands, num) +
      UI.bars('HUD-assisted low-income homes, by HUD category', 'HUD’s own property categories', hudTypes, num) +
      '</div>' + sUsda + sHud + '</details></section>' +
      '<section id="p-where" tabindex="-1"><h2>Where they are</h2>' + presMap(L.d) + sPres + sHud + sUsda +
      '<details class="fold"><summary>Show the numbers: homes by county and city</summary><div class="chart-pair">' +
      UI.bars('Listed units by county (12 largest)', 'Every listed property, placed in a county from its mapped location. A property close to a county line can land in the neighbouring county. The menus below change the list only.', byCounty.slice(0, 12).map(function (r) { return [r[0] + ' County', r[1]]; }), num) +
      UI.bars('Homes on CHFA’s preservation map, by city', 'The 12 cities with the most', byCity.slice(0, 12), num) + '</div>' + sPres + '</details>' +
      '<p class="note">' + (placed === f.pres.length ? 'Every property was placed in a county from its mapped location.' : num(placed) + ' of ' + num(f.pres.length) + ' properties were placed in a county from their mapped location; the rest show Not assigned.') +
      ' CHFA reports that, as of December 2024, affordability restrictions on nearly 21,000 rental units in Colorado are set to expire in the next 15 years (<a href="https://www.chfainfo.com/rental-housing/preservation">CHFA preservation</a>). The property list does not show which properties those are.</p></section>' +
      '<section id="p-list" tabindex="-1"><h2>Every property</h2>' +
      '<p class="note">Open a property for its subsidies, dates and next steps. ' + num(matched) + ' of ' + num(rows.length) + ' match a tax credit, HUD or USDA record at the same address.</p>' +
      menus(menu('pr.county', 'County', [['', 'All counties']].concat(byCounty.map(function (r) { return r[0]; }).sort().map(function (c) { return [c, c]; }))) + menu('pr.size', 'Property size', SIZES)) +
      (wantCounty || wantSize ? '<p class="chapter-finding" role="status">' + num(rows.length) + ' properties with ' + num(listedHomes) + ' listed homes match the menus.</p>' : '') +
      csvLink('chfa-preservation-inventory', 'Download these properties (CSV)', ['Record', 'Property', 'Address', 'City', 'County', 'ZIP', 'Units', 'Also in', 'Next year 15 (est.)', 'USDA end date'],
        rows.map(function (r) { return [r.id, r.name, r.addr, r.city, r.county, r.zip, r.homes, r.also, r.next15, r.usdaEnd]; })) +
      UI.table('pres', 'Preservation candidates', [
        { key: 'name', label: 'Property', href: function (r) { return '#/opportunity/preservation/' + r.id; } },
        { key: 'addr', label: 'Address' },
        { key: 'city', label: 'City' },
        { key: 'county', label: 'County', tip: 'From the property’s mapped location, using Census county outlines' },
        { key: 'zip', label: 'ZIP' },
        { key: 'homes', label: 'Homes', num: true, fmt: num, tip: 'Total units in the property, as CHFA lists it' },
        { key: 'also', label: 'Also in', tip: 'Other public records at the same address and city' },
        { key: 'next15', label: 'Year 15', num: true, tip: 'Estimated: the next tax credit year 15 still to come, from the year placed in service' },
        { key: 'usdaEnd', label: 'USDA end date', tip: 'USDA restrictive-use end date, as listed' }
      ], rows, { noun: 'properties', placeholder: 'Name, address or city' }) + sPres +
      '<p class="note">A property missing from this list may still carry affordability restrictions; the map covers properties CHFA and its partners report.</p></section>' +
      '<section id="p-examples" tabindex="-1"><h2>Colorado examples</h2>' +
      '<p class="note">Acquisition and rehab deals in CHFA’s award reports. Each row is read from the report as printed.</p>' +
      UI.table('acqrehab', 'Acquisition and rehab awards', [
        { key: 'name', label: 'Property' },
        { key: 'city', label: 'City' },
        { key: 'year', label: 'Year', num: true, tip: 'Cycle year, or the report year' },
        { key: 'homes', label: 'Homes', num: true, fmt: num },
        { key: 'type', label: 'Type as printed', tip: 'A/R = acquisition and rehab; N = new construction' },
        { key: 'bond', label: 'Bonds', tip: 'Private activity bond amount, where the report gives one' },
        { key: 'report', label: 'CHFA report' }
      ], x.examples, { noun: 'awards', placeholder: 'Name or city' }) + sAwards + '</section>' +
      contractsSection(L.d) +
      '<section id="p-how" tabindex="-1"><h2>How preservation works</h2>' +
      '<p>The tools Colorado owners, buyers and local governments use to keep these homes affordable are in the guide.</p>' +
      '<p><a class="button-link" href="#/guide/preservation">Preservation in Colorado</a></p>' +
      '<p class="note">For other subsidy types and end dates, see the <a href="https://preservationdatabase.org/">National Housing Preservation Database (NHPD)</a>, a joint project of the National Low Income Housing Coalition and the Public and Affordable Housing Research Corporation (PAHRC), which requires registration.</p></section>' +
      T.source('CHFA preservation properties layer', PRES_URL, 'retrieved September 2026') +
      T.source('HUD Multifamily Properties, Assisted', HUD_URL, 'no date in the source file') +
      T.source('HUD Multifamily Assistance & Section 8 Contracts database', L.d.contracts.meta.source_url, 'current as of ' + usDate(L.d.contracts.meta.as_of)) +
      T.source('USDA Rural Development multifamily housing rentals', USDA_URL, 'no date in the source file') +
      T.source(LIHTC_SRC, L.d.lihtc.source, f.fetched) +
      T.source('County outlines: US Census Bureau TIGER/Line', 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html') +
      T.next('Next', [{ href: '#/guide/preservation', label: 'Preservation in Colorado →' }, { href: '#/deal-calculator', label: 'Test an acquisition and rehab deal', secondary: true }, { href: '#/opportunity/portfolio', label: 'CHFA portfolio', secondary: true }]);
  }

  function property(id) {
    var L = presLoading('Property');
    if (L.html) return L.html;
    var x = presData(L.d), T = global.LabTpl;
    var p = x.chfa.filter(function (r) { return String(r.RecordID) === String(id); })[0];
    if (!p) return frame('Property not found', '#/opportunity/preservation') + '<p class="lede">CHFA’s preservation map has no property with this number.</p>';
    var m = x.matches(p), name = String(p.PROJECT).trim(), city = (p.PROJ_CTY || '').trim();
    var li = m.lihtc.concat(m.hud, m.usda).map(function (r) { return r.LI_UNITS; }).filter(function (v) { return v > 0; });
    var future15 = m.lihtc.map(function (l) { return est(l, 15); }).filter(function (v) { return v >= THIS_YEAR; });
    var ends = m.usda.map(usdaEnd).filter(Boolean).sort();
    var county = (m.hud.concat(m.usda, m.lihtc).map(function (r) { return r.CNTY_NAME; }).filter(Boolean)[0]) || null;
    var place = UI.placeFor(city);
    var facts = [
      { value: num(p.N_UNITS) || 'Not given', label: 'Homes, as CHFA lists them', source: 'CHFA preservation map', href: PRES_URL },
      li.length ? { value: num(Math.max.apply(null, li)), label: 'Low-income homes, the most any matched record lists', source: m.lihtc.length ? LIHTC_SRC : m.hud.length ? 'HUD Multifamily Assisted' : 'USDA', href: m.lihtc.length ? L.d.lihtc.source : m.hud.length ? HUD_URL : USDA_URL } : null,
      future15.length ? { value: String(Math.min.apply(null, future15)), label: 'Next tax credit year 15 (estimate)', source: LIHTC_SRC, href: L.d.lihtc.source } : null,
      ends.length ? { value: ends[0], label: 'USDA restriction end date, as listed', source: 'USDA Rural Development', href: USDA_URL } : null
    ].filter(Boolean);
    var block = function (title, rows, cols) {
      if (!rows.length) return '';
      return '<h3>' + esc(title) + '</h3><div class="table-scroll" role="region" tabindex="0" aria-label="' + esc(title) + '"><table><thead><tr>' + cols.map(function (c) { return '<th scope="col">' + esc(c[0]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.map(function (r) { return '<tr>' + cols.map(function (c) { var v = c[1](r); return '<td>' + esc(v == null || v === '' ? '—' : String(v)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    };
    var yes = function (v) { return v === true ? 'Yes' : v === false ? 'No' : null; };
    var none = !m.lihtc.length && !m.hud.length && !m.usda.length;
    return T.head({
      kind: 'data', crumbs: T.trail('opportunities', name, [{ href: '#/opportunity/preservation', label: 'Preservation inventory' }]), title: name,
      answer: esc(p.PROJ_ADD + ', ' + city + (county ? ' (' + county + ' County)' : '')) + '. ' + (none
        ? 'CHFA lists it for preservation; no tax credit, HUD or USDA record matches its address, so its subsidy and dates are not in these files.'
        : 'Matched to ' + [m.lihtc.length && 'tax credit', m.hud.length && 'HUD', m.usda.length && 'USDA'].filter(Boolean).join(', ') + ' records at the same address.'),
      meta: '<span class="scope-tag">Scope: one property</span> Matches are by street address and city, since the feeds share no ID. Check the property’s recorded agreements before relying on a date.',
      facts: facts
    }) +
      '<section><h2>Subsidies and dates</h2>' +
      (none ? '<p class="note">Nothing matched. The property may be under another address in other feeds, or carry a subsidy these files do not cover.</p>' : '') +
      block('Tax credit records', m.lihtc, [['Name', function (r) { return r.PROJECT; }], ['Placed in service', function (r) { return r.YR_PIS; }], ['Year 15 (est.)', function (r) { return est(r, 15); }], ['Year 30 (est.)', function (r) { return est(r, 30); }], ['Credit', function (r) { return r.TypeOfCredits || r.CREDIT; }], ['Low-income', function (r) { return num(r.LI_UNITS); }], ['Status', function (r) { return r.ComplianceStatus || 'Not stated'; }]]) +
      block('HUD-assisted records', m.hud, [['Name', function (r) { return r.PROJECT; }], ['HUD category', function (r) { return r.property_category; }], ['Residents', function (r) { return r.client_group; }], ['Low-income', function (r) { return num(r.LI_UNITS); }], ['Inspection score', function (r) { return r.reac_score; }], ['Troubled', function (r) { return yes(r.is_troubled); }], ['Use restriction', function (r) { return yes(r.has_use_restriction); }]]) +
      block('USDA rural records', m.usda, [['Name', function (r) { return r.PROJECT; }], ['Restriction start', function (r) { var s = String(r.effective_date || ''); return /^\d{8}$/.test(s) ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6) : null; }], ['Restriction end', usdaEnd], ['Rental assistance homes', function (r) { return num(r.ra_units); }], ['Residents', function (r) { return r.rental_designation; }]]) +
      (m.lihtc.length ? '<p class="note">Year 15 and year 30 are estimates from the year placed in service. Year 15 ends the federal compliance period; the property\u2019s recorded extended-use agreement sets what can happen after it. The guide explains the options.</p>' : '') +
      (m.usda.length ? '<p class="note">USDA’s end date is shown as listed. A past date does not by itself mean the homes have left USDA’s program.</p>' : '') +
      '</section>' +
      T.source('CHFA preservation properties layer', PRES_URL, 'record ' + p.RecordID) +
      T.next('Next', [
        { href: '#/guide/preservation', label: 'How preservation works →' },
        { href: '#/deal-calculator', label: 'Test an acquisition and rehab deal', secondary: true }
      ].concat(place ? [{ href: place, label: 'Housing need in ' + city, secondary: true }] : []).concat([{ href: '#/opportunity/preservation', label: 'Back to the inventory', secondary: true }]));
  }

  // Land banking awards on the county map: CHFA names a town per award, so each pin sits at that town's
  // Census Gazetteer centre (the file's own placement), sized by estimated homes. The menus narrow the awards
  // by round, homes planned, who holds the award and status, and pick what the pin colours show; the
  // list below follows the same menus. Labels and colours follow the live page.
  var LB_PURPOSE = { 'Rental': 'Rental', 'Homeownership': 'For-sale', 'Rental and Homeownership': 'Rental and for-sale' };
  var LB_HOLDER = { government: 'Town, county or housing authority', nonprofit: 'Nonprofit or other' };
  var LB_STATUS = ['financed', 'applied', 'partner', 'seeking', 'not_funded', 'none_found', 'none'];
  // Colour-blind-safe set (Okabe-Ito order), as the live map uses.
  var LB_COLOURS = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)', 'var(--cat-5)', 'var(--cat-6)', 'var(--cat-7)'];
  var LB_FILES = { landBank: FILES.landBank, status: 'data/policy/prop123-land-banking-status.json', counties: PRES_FILES.counties };
  function lbData(d) {
    if (d._lb) return d._lb;
    var st = (d.status && d.status.status) || {}, meta = (d.status && d.status.meta) || {};
    var rounds = d.landBank.meta.rounds || [];
    var roundOf = {}; rounds.forEach(function (r, i) { roundOf[r.id] = { label: r.label, i: i, r: r }; });
    var awards = d.landBank.awards.map(function (a) {
      var s = st[a.id] || null;
      return { a: a, s: s, round: (roundOf[a.round] || {}).label || a.round, roundI: (roundOf[a.round] || { i: -1 }).i, purpose: LB_PURPOSE[a.purpose] || a.purpose,
        holder: s && s.holder ? s.holder.type : null, status: s ? s.status : null, project: a.show_project || a.project, sponsor: a.show_sponsor || a.sponsor };
    });
    return (d._lb = { awards: awards, rounds: rounds, labels: meta.labels || {}, meta: meta });
  }
  // The dated public sources behind a status, as links (the old page prints them under each award). Only web
  // addresses become links; anything else prints as its title.
  function lbSourceLinks(list) {
    var links = (list || []).filter(function (q) { return q && q.title; }).map(function (q) {
      return /^https?:\/\//i.test(String(q.url || '')) ? '<a href="' + esc(q.url) + '">' + esc(q.title) + '</a>' : esc(q.title);
    });
    return links.length ? ' <span class="lb-sources">' + (links.length === 1 ? 'Source: ' : 'Sources: ') + links.join('; ') + '.</span>' : '';
  }
  function lbStatusText(x) {
    var s = x.s;
    if (!s || !s.label) return null;
    return s.label + (s.status === 'none_found' && s.checked ? ' (checked ' + s.checked + ')' : '') + '.' + (s.text ? ' ' + s.text : '');
  }
  // What a pin's colour shows: one of four splits, each with its own key.
  function lbSplits(lb) {
    return {
      purpose: { label: 'Homes planned', keys: ['Rental', 'For-sale', 'Rental and for-sale'], of: function (x) { return x.purpose; }, name: function (k) { return k; } },
      round: { label: 'Award round', keys: lb.rounds.map(function (r) { return r.label; }), of: function (x) { return x.round; }, name: function (k) { return k; } },
      holder: { label: 'Held by', keys: ['government', 'nonprofit'], of: function (x) { return x.holder; }, name: function (k) { return LB_HOLDER[k]; } },
      status: { label: 'Status', keys: LB_STATUS, of: function (x) { return x.status; }, name: function (k) { return lb.labels[k] || k; } }
    };
  }
  function landMap(d, shown, split) {
    var outline = d.counties.features.map(function (f) {
      var rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      return '<path d="' + rings.map(function (poly) { return poly.map(function (ring) { return 'M' + ring.map(function (c) { return xy(c).join(' '); }).join('L') + 'Z'; }).join(''); }).join('') + '"><title>' + esc(f.properties.NAMELSAD) + '</title></path>';
    }).join('');
    var colour = {}; split.keys.forEach(function (k, i) { colour[k] = LB_COLOURS[i % LB_COLOURS.length]; });
    var pins = [], unplaced = 0;
    shown.forEach(function (x) {
      var placed = (x.a.places || []).filter(function (p) { return p.lat != null && p.lng != null; });
      if (!placed.length) unplaced++;
      placed.forEach(function (p) { pins.push({ x: x, p: p }); });
    });
    pins.sort(function (m, n) { return (n.x.a.estimated_units || 0) - (m.x.a.estimated_units || 0); });
    // Awards that share a town share its pin point; the tip says so, and that the pin is the town, not the site.
    var perTown = {};
    pins.forEach(function (q) { perTown[q.p.name] = (perTown[q.p.name] || 0) + 1; });
    var dots = pins.map(function (q) {
      var a = q.x.a, c = xy([q.p.lng, q.p.lat]), r = Math.max(4, Math.min(14, Math.sqrt(a.estimated_units || 1) * 1.1)).toFixed(1);
      var t = q.x.project + ', ' + q.p.name + ' (' + q.x.round + '): ' + money(a.amount_awarded) + ', about ' + (num(a.estimated_units) || 'no count of') + ' homes, ' + q.x.purpose.toLowerCase() + (q.x.s ? '. Status: ' + q.x.s.label : '') +
        '. Pin at the centre of ' + q.p.name + ', not the site' + (perTown[q.p.name] > 1 ? '; ' + perTown[q.p.name] + ' awards share this town, all listed below the map' : '') + '.';
      var dot = '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="' + r + '" style="fill:' + (colour[split.of(q.x)] || 'var(--cat-7)') + '"><title>' + esc(t) + '</title></circle>';
      return q.p.geoid ? '<a href="#/place/' + esc(q.p.geoid) + '">' + dot + '</a>' : dot;
    }).join('');
    var key = split.keys.map(function (k) {
      var n = shown.filter(function (x) { return split.of(x) === k; }).length;
      return n ? '<li><span class="pm-key" style="background:' + colour[k] + '" aria-hidden="true"></span>' + esc(split.name(k)) + ' <b>' + num(n) + '</b></li>' : '';
    }).join('');
    return '<figure class="pres-map lb-map">' +
      '<figcaption><span class="cc-kicker">Where the awards are</span><strong>' + esc((function () {
        var tot = shown.reduce(function (t, x) { return t + (x.a.amount_awarded || 0); }, 0), homes = shown.reduce(function (t, x) { return t + (x.a.estimated_units || 0); }, 0);
        return num(shown.length) + ' land banking awards, ' + money(tot) + (homes ? ' for about ' + num(homes) + ' homes' : '') + (unplaced ? '; ' + unplaced + ' have no town to place' : '');
      })()) + '</strong><span class="note">Each pin is an award at the town CHFA names, sized by its estimated homes. Tap or point to a pin for the award; select it to open that place.</span></figcaption>' +
      '<div class="pm-frame"><svg viewBox="0 0 ' + MAP_W + ' ' + MAP_H + '" role="group" aria-label="Map of Proposition 123 land banking awards by town">' +
      '<g class="pm-counties">' + outline + '</g><g class="pm-layer lb-pins">' + dots + '</g>' + K.cities() + '</svg></div>' +
      '<p class="note">Pin colour shows ' + esc(split.label.toLowerCase()) + ' (number of awards):</p><ul class="lb-key">' + key + '</ul>' +
      '<p class="note">' + esc(d.landBank.meta.location_note) + (unplaced ? ' ' + unplaced + (unplaced === 1 ? ' award has' : ' awards have') + ' no town to place.' : '') + ' County outlines: US Census TIGER.</p></figure>';
  }
  var LB_SORTS = [
    ['newest', 'Newest round first', function (a, b) { return b.roundI - a.roundI; }],
    ['oldest', 'Oldest round first', function (a, b) { return a.roundI - b.roundI; }],
    ['town', 'Town, A to Z', function (a, b) { return String(a.a.location).localeCompare(String(b.a.location)); }],
    ['grantee', 'Grantee, A to Z', function (a, b) { return a.sponsor.localeCompare(b.sponsor); }],
    ['holder', 'Towns, counties and housing authorities first', function (a, b) { return (a.holder === 'government' ? 0 : 1) - (b.holder === 'government' ? 0 : 1); }],
    ['purpose', 'Rental first, then for-sale', function (a, b) { var o = ['Rental', 'Rental and for-sale', 'For-sale']; return o.indexOf(a.purpose) - o.indexOf(b.purpose); }],
    ['status', 'Furthest along first', function (a, b) { return LB_STATUS.indexOf(a.status) - LB_STATUS.indexOf(b.status); }],
    ['amount', 'Largest award first', function (a, b) { return (b.a.amount_awarded || 0) - (a.a.amount_awarded || 0); }],
    ['homes', 'Most homes first', function (a, b) { return (b.a.estimated_units || 0) - (a.a.estimated_units || 0); }]
  ];

  function landBanking() {
    var s = UI.load(LB_FILES), title = 'Proposition 123 land banking';
    if (s.error) return frame(title) + '<p class="callout">' + esc(s.error) + '</p>';
    if (!s.data) return frame(title) + '<p role="status" class="note">Loading the public records…</p>';
    var d = s.data, m = d.landBank.meta, lb = lbData(d), T = global.LabTpl, splits = lbSplits(lb);
    var towns = function (list) { var t = {}; list.forEach(function (x) { (x.a.places || []).forEach(function (p) { if (p.lat != null) t[p.name] = (t[p.name] || 0) + 1; }); }); return t; };
    var allTowns = towns(lb.awards);
    var want = { round: chosen('lb.round'), purpose: chosen('lb.purpose'), holder: chosen('lb.holder'), status: chosen('lb.status'), colour: chosen('lb.colour', 'purpose'), sort: chosen('lb.sort', 'newest') };
    var shown = lb.awards.filter(function (x) {
      return (!want.round || x.a.round === want.round) && (!want.purpose || x.a.purpose === want.purpose) && (!want.holder || x.holder === want.holder) && (!want.status || x.status === want.status);
    });
    var sorter = (LB_SORTS.filter(function (o) { return o[0] === want.sort; })[0] || LB_SORTS[0])[2];
    shown = shown.map(function (x, i) { return [x, i]; }).sort(function (p, q) { return sorter(p[0], q[0]) || (q[0].roundI - p[0].roundI) || p[1] - q[1]; }).map(function (p) { return p[0]; });
    var shownTowns = towns(shown), townNames = Object.keys(allTowns).sort();
    var split = splits[want.colour] || splits.purpose;
    var narrowed = shown.length < lb.awards.length;
    var rows = shown.map(function (x) {
      var a = x.a;
      return { round: x.round, project: x.project, url: a.source_url, status: lbStatusText(x), sponsor: x.sponsor, holder: x.holder ? LB_HOLDER[x.holder] : null, location: a.location, purpose: x.purpose, amount: a.amount_awarded, homes: a.estimated_units, printed: a.source_quote,
        sources: x.s && x.s.sources ? x.s.sources.map(function (q) { return q.title + ' ' + q.url; }).join('; ') : null, sourceList: x.s && x.s.sources ? x.s.sources : [] };
    });
    var byRound = lb.rounds.map(function (r) { return [r.label, d.landBank.awards.filter(function (a) { return a.round === r.id; }).reduce(function (t, a) { return t + a.amount_awarded; }, 0)]; });
    var byPurpose = UI.tally(lb.awards, function (x) { return x.purpose; }, function (x) { return x.a.estimated_units; });
    var byStatus = LB_STATUS.map(function (k) { return [lb.labels[k] || k, lb.awards.filter(function (x) { return x.status === k; }).length]; }).filter(function (r) { return r[1] > 0; });
    var o = m.open_round;
    return T.head({
      kind: 'data', crumbs: T.trail('opportunities', title), title: title,
      answer: 'Since 2024, Colorado has given $' + (m.total_awarded / 1e6).toFixed(1) + ' million' + ' in ' + num(m.award_count) + ' awards to buy land for about ' + num(m.total_estimated_units) + ' future affordable homes in ' + num(townNames.length) + ' towns. The money comes from Proposition 123, the housing fund Colorado voters approved.',
      meta: '<span class="scope-tag">Scope: Colorado, by award</span> ' + esc(m.program) + ', run by ' + esc(m.administrator.split(',')[0]) + '.',
      facts: [
        { value: num(m.award_count), label: 'Awards in ' + num(lb.rounds.length) + ' rounds', source: 'CHFA award lists, ' + m.generated, href: m.program_url },
        { value: UI.millions(m.total_awarded), label: 'Awarded to buy land', source: 'CHFA award lists', href: m.program_url },
        { value: num(m.total_estimated_units), label: 'Future homes the grantees estimate', source: 'CHFA award lists', href: m.program_url },
        { value: num((lb.meta.counts || {}).financed || 0), label: 'Awards whose project has later state building money', source: 'COHO status check, ' + ((lb.meta.generated_from || {}).research_checked || ''), href: m.program_url }
      ]
    }) +
      '<div class="callout"><strong>Applying now.</strong> ' + esc(o.summary) + ' <a href="#/opportunity/land-banking?at=lb-apply" data-jump="lb-apply">How to apply</a>.</div>' +
      T.onThisPage([{ id: 'lb-where', title: 'Where the awards are' }, { id: 'lb-every', title: 'Every award' }, { id: 'lb-apply', title: 'Applying now' }, { id: 'lb-how', title: 'How land banking works' }, { id: 'lb-about', title: 'About this data' }], true) +
      '<section id="lb-where" tabindex="-1"><h2>Where the awards are</h2>' +
      '<p>Each award buys a site now so homes can be built there later, at rents or prices that households with low or moderate incomes can afford. Use the menus to narrow the awards by round, rental or for-sale homes, who holds the award, or status, and to choose what the pin colours show. The list under the map follows the same menus.</p>' +
      menus(
        menu('lb.round', 'Award round', [['', 'All rounds']].concat(lb.rounds.map(function (r) { return [r.id, r.label]; }))) +
        menu('lb.purpose', 'Homes planned', [['', 'All kinds'], ['Rental', 'Rental'], ['Homeownership', 'For-sale'], ['Rental and Homeownership', 'Rental and for-sale']]) +
        menu('lb.holder', 'Held by', [['', 'All grantees'], ['government', LB_HOLDER.government], ['nonprofit', LB_HOLDER.nonprofit]]) +
        menu('lb.status', 'Status', [['', 'Any status']].concat(LB_STATUS.map(function (k) { return [k, lb.labels[k] || k]; }))) +
        menu('lb.colour', 'Colour pins by', [['purpose', 'Homes planned'], ['round', 'Award round'], ['holder', 'Held by'], ['status', 'Status']], 'purpose')) +
      '<p class="chapter-finding" role="status">' + (narrowed ? 'Showing ' + num(shown.length) + ' of ' + num(lb.awards.length) + ' awards' : 'Showing all ' + num(shown.length) + ' awards') + ' in ' + num(Object.keys(shownTowns).length) + ' towns.</p>' +
      landMap(d, shown, split) + T.source('CHFA land banking award lists', m.program_url, m.generated) +
      '<details class="lb-towns"><summary>List the ' + num(Object.keys(shownTowns).length) + ' towns instead</summary><ul>' + Object.keys(shownTowns).sort().map(function (t) {
        var g = UI.placeFor(t);
        return '<li>' + (g ? '<a href="' + esc(g) + '">' + esc(t) + '</a>' : esc(t)) + ' <span class="note">' + num(shownTowns[t]) + (shownTowns[t] === 1 ? ' award' : ' awards') + '</span></li>';
      }).join('') + '</ul></details>' +
      '<div class="chart-pair">' +
      UI.bars('Dollars awarded, by round', 'Each list’s rows add up to the total it prints', byRound, UI.millions) +
      UI.bars('Estimated future homes, by homes planned', m.units_note, byPurpose, num) +
      '</div>' + T.source('CHFA land banking award lists', m.program_url, m.generated) +
      UI.bars('Where the sites stand now', 'Awards by status: other state awards to the same project, and dated public sources. “Building money awarded” does not mean homes are built.', byStatus, num) +
      T.source('CHFA award lists and dated public sources, COHO status check', m.program_url, (lb.meta.generated_from || {}).research_checked || m.generated) +
      '</section>' +
      '<section id="lb-every" tabindex="-1"><h2>Every award</h2>' +
      '<p>The same awards as the map, following the menus above. Sort them with a column heading or the Sort by menu. Questions about an award go to the organization that received it; questions about the program go to the Colorado Housing and Finance Authority (CHFA), which runs it.</p>' +
      menus(menu('lb.sort', 'Sort by', LB_SORTS.map(function (x) { return [x[0], x[1]]; }), 'newest')) +
      csvLink('prop123-land-banking-awards', 'Download these awards (CSV)', ['Round', 'Project', 'Status', 'Received by', 'Held by', 'Town', 'Homes planned', 'Awarded', 'Estimated homes', 'Source', 'Row as printed', 'Status sources'],
        rows.map(function (r) { return [r.round, r.project, r.status, r.sponsor, r.holder, r.location, r.purpose, r.amount, r.homes, r.url, r.printed, r.sources]; })) +
      UI.table('landbank', 'Land banking awards', [
        { key: 'round', label: 'Round' },
        { key: 'project', label: 'Project', href: function (r) { return r.url; }, tip: 'Links to the CHFA award list (PDF) for its round' },
        { key: 'status', label: 'Status', tip: lb.meta.note || 'Where the project on the site stands', more: function (r) { return lbSourceLinks(r.sourceList); } },
        { key: 'sponsor', label: 'Received by' },
        { key: 'holder', label: 'Held by', tip: lb.meta.holder_note || 'Kind of grantee' },
        { key: 'location', label: 'Town' },
        { key: 'purpose', label: 'Homes planned' },
        { key: 'amount', label: 'Awarded', num: true, fmt: money },
        { key: 'homes', label: 'Est. homes', num: true, fmt: num, tip: m.units_note },
        { key: 'printed', label: 'Row as printed', tip: 'The row exactly as CHFA’s award list prints it' }
      ], rows, { noun: 'awards', placeholder: 'Sponsor, project or town' }) + T.source('CHFA land banking award lists', m.program_url, m.generated) +
      '<p class="note">Each status links the dated sources behind it, and the CSV lists them too. A status reads only public state award records and dated public sources.</p></section>' +
      '<section id="lb-apply" tabindex="-1"><h2>Applying now</h2>' +
      '<p>' + esc(o.summary) + '</p>' +
      '<p>To ask for an application, email <a href="mailto:' + esc(m.program_email) + '">' + esc(m.program_email) + '</a>.</p>' +
      '<blockquote class="opp-quote"><p>CHFA’s words: “' + esc(o.quote) + '” “' + esc(o.allocation_quote) + '”</p><footer><a href="' + esc(o.source_url) + '">Program page</a>, checked ' + esc(usDate(o.checked)) + '</footer></blockquote></section>' +
      '<section id="lb-how" tabindex="-1"><h2>How land banking works</h2><ul class="opp-points">' +
      '<li><strong>Who can get it.</strong> Towns, counties and tribal governments receive grants. Nonprofits with a record of providing affordable housing receive loans that are forgiven if they build. Private developers cannot receive it directly.</li>' +
      '<li><strong>It buys land, not buildings.</strong> The land must be zoned, with a development plan, within five years, and the homes permitted and funded within ten. Otherwise the money is repaid.</li>' +
      '<li><strong>Only places that made a Prop 123 promise qualify.</strong> A town or county must first file a commitment to grow its affordable housing with the state Division of Housing. The Division lists who has filed on its <a href="https://cdola.colorado.gov/commitment-filings">commitment filings page</a>.</li>' +
      '</ul></section>' +
      '<section id="lb-about" tabindex="-1"><h2>About this data</h2>' +
      '<p>CHFA describes the program this way: “' + esc(m.program_quote) + '”</p>' +
      '<p>Home counts are each grantee’s estimate in its award list. Land banking buys land, and the homes come later, so these are plans, not homes built.</p>' +
      '<p>Each row is copied from CHFA’s award list for its round; the Row as printed column shows the original. Where a name in a list wraps onto two lines, it is joined back together. The program is part of the Prop 123 Affordable Housing Financing Fund, which CHFA runs for the Colorado Office of Economic Development and International Trade (OEDIT).</p>' +
      '<p>' + esc(lb.meta.holder_note || '') + ' ' + esc(lb.meta.note || '') + '</p>' +
      '<p>Award lists: ' + lb.rounds.map(function (r) { return '<a href="' + esc(r.source_url) + '">' + esc(r.title) + '</a>, dated ' + esc(usDate(r.pdf_date)); }).join('; ') + '. Each list’s rows add up to the total it prints.</p>' +
      '<p class="note">A public-data reference. Confirm current terms and contacts with CHFA before relying on them.</p></section>' +
      T.source('CHFA land banking award lists', m.program_url, m.generated) +
      T.next('Next', [{ href: '#/opportunity/round-one', label: '2026 Round One awards →' }, { href: '#/places', label: 'Find a place', secondary: true }]);
  }

  function roundOne() {
    var L = loading('2026 Round One tax credit awards');
    if (L.html) return L.html;
    var m = L.d.roundOne.metadata, awards = L.d.roundOne.awards;
    return frame('2026 Round One tax credit awards') +
      '<p class="lede">Announced by CHFA on ' + esc(m.announcement_date) + '.</p>' +
      UI.intro('Which developments won tax credits this spring, where, and how big they are.',
        num(m.parsed_count) + ' developments won credits for ' + num(m.press_release_total_units) + ' homes and about $' + m.press_release_total_equity_M + ' million in equity.') +
      UI.bars('Homes in each award', null, awards.map(function (a) { return [a.name + ', ' + a.city, a.total_units]; }).sort(function (a, b) { return b[1] - a[1]; }), num) +
      UI.table('r1', '2026 Round One awards', [
        { key: 'name', label: 'Development', href: function (r) { return UI.placeFor(r.city); } },
        { key: 'city', label: 'City' },
        { key: 'county', label: 'County' },
        { key: 'sponsor', label: 'Sponsor' },
        { key: 'total_units', label: 'Homes', num: true, fmt: num },
        { key: 'federal_9pct_credit', label: '9% credit', num: true, fmt: money, tip: 'Annual federal 9% credit awarded' },
        { key: 'federal_4pct_credit', label: '4% credit', num: true, fmt: money, tip: 'Annual federal 4% credit, where listed' },
        { key: 'state_credit', label: 'State credit', num: true, fmt: money, tip: 'Colorado state credit awarded' },
        { key: 'unit_mix_raw', label: 'Unit mix' }
      ], awards, { noun: 'awards', placeholder: 'Name, city or sponsor' }) +
      '<p class="note metric-source">' + esc(m.note) + ' Sources: <a href="' + esc(m.source_url) + '">CHFA award descriptions</a> and <a href="' + esc(m.press_release_url) + '">press release</a>, announced ' + esc(m.announcement_date) + '.</p>' +
      UI.next([{ href: '#/opportunity/portfolio', label: 'Whole tax credit portfolio →' }, { href: '#/opportunities', label: 'Back to Opportunities', secondary: true }]);
  }

  var SCREENS = { portfolio: portfolio, preservation: preservation, 'land-banking': landBanking, 'round-one': roundOne };
  Shell.views.opportunities = hub;
  Shell.views.opportunity = function (params, parts) {
    if (parts[1] === 'preservation' && parts[2]) return property(parts[2]);
    if (parts[1] === 'land-value' && global.LabLandValue) return global.LabLandValue.view(params);
    if (parts[1] === 'commuting' && global.LabCommuting) return global.LabCommuting.view(params);
    var s = SCREENS[parts[1]];
    return s ? s() : frame('Not found') + '<p class="lede">There is no Opportunities screen called ' + esc(parts[1] || '') + '.</p>';
  };
  global.LabOpportunities = { csvLink: csvLink, FILES: FILES, PRES_FILES: PRES_FILES, LB_FILES: LB_FILES, lbData: lbData, countyIndex: countyIndex, countyAt: countyAt, windowEnd: windowEnd, csvText: csvText, creditLabel: creditLabel, boost: boost, awardYear: awardYear, facts: facts, presData: presData, addrKey: addrKey, SCREENS: Object.keys(SCREENS) };
})(window);
