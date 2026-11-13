// Colorado deep dive, rebuilt (wave 1, ticket 1A): every section of the live colorado-deep-dive.html, in
// the lab's own layout, drawn from the public site's own pinned data files.
//   #/places/deep-dive?tab=<id>   one page, fourteen tabs; every tab is drawn into the page and the bar
//                                 switches between them in place, so a link opens on the tab it names.
// Pickers keep their choice in the address too (ami=, sig=, peer=, units=, dir=, call=, cdp=, fund*=), so a copied
// link returns to the same view. Nothing here computes a model: figures are read from the files, summed or
// compared the way the live page does it, and the public site's own engines (FundingFit, LihtcProjectSize,
// LihtcByYear, AffordabilityMetrics, MarketHealthComposite) are loaded from the pinned copy where the live
// page uses one. Text the live page prints from its own markup, not from a data file, is carried in STATIC
// below with the source and date the live page gives it, and is marked static on screen.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI, Viz = global.LabViz;
  var esc = Shell.esc, num = UI.num, money = UI.money;
  var LIVE = 'https://cohoanalytics.com/', DD = LIVE + 'colorado-deep-dive.html';
  var VENDOR = global.LAB_VENDOR;
  var C = Viz.COLORS || {};
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var QWORD = ['first', 'second', 'third', 'fourth'];

  // ---------- small helpers ----------
  function pct(v, d) { return v == null || isNaN(v) ? null : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d == null ? 1 : d) + '%'; }
  function share(v, d) { return v == null || isNaN(v) ? null : (v * 100).toFixed(d == null ? 1 : d) + '%'; }
  function plain(v, d) { return v == null || isNaN(v) ? null : Number(v).toFixed(d == null ? 1 : d) + '%'; }
  function signed(v) { return v == null ? null : (v > 0 ? '+' : v < 0 ? '−' : '') + num(Math.abs(v)); }
  function compact(n) { return n == null ? null : n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? '$' + Math.round(n / 1e3) + 'K' : money(n); }
  function day(iso) { if (!iso) return ''; var d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); return isNaN(d) ? String(iso) : MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear(); }
  function monthOf(p) { var m = /^(\d{4})-(\d{2})/.exec(p || ''); return m ? MONTHS[+m[2] - 1] + ' ' + m[1] : String(p || ''); }
  function quarterOf(iso) { var m = /^(\d{4})-(\d{2})/.exec(iso || ''); return m ? 'Q' + (Math.floor((+m[2] - 1) / 3) + 1) + ' ' + m[1] : ''; }
  function yearBefore(iso) { return (+iso.slice(0, 4) - 1) + iso.slice(4); }
  function obs(fred, id) { var s = fred.series[id]; return s ? s.observations.filter(function (o) { return o.value !== '.' && o.value !== '' && o.value != null; }) : []; }
  function valueAt(list, date) { for (var i = 0; i < list.length; i++) if (list[i].date === date) return +list[i].value; return null; }
  function change(a, b) { return a == null || b == null || !b ? null : (a / b - 1) * 100; }
  function ext(href, text) { return '<a href="' + esc(href) + '" rel="noopener">' + esc(text) + ' ↗</a>'; }
  function cname(n) { return String(n || '').replace(/ County$/, ''); }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; }

  // A section: heading, then what it holds. lvl 2 or 3.
  function sec(id, title, body, lvl) {
    var h = 'h' + (lvl || 2);
    return '<section class="dd-sec" id="dd-' + esc(id) + '" aria-labelledby="dd-' + esc(id) + '-h"><' + h + ' id="dd-' + esc(id) + '-h">' + esc(title) + '</' + h + '>' + body + '</section>';
  }
  // Metric cards: [{ label, value, detail, src, href }]. A card with no value says so.
  function kpis(list) {
    return '<div class="metrics dd-kpis">' + list.map(function (k) {
      return '<div class="metric"><p class="metric-label">' + esc(k.label) + '</p><p class="metric-value">' + esc(k.value == null ? 'Not published' : k.value) + '</p>' +
        (k.detail ? '<p class="metric-detail">' + esc(k.detail) + '</p>' : '') +
        (k.src ? '<p class="metric-source">' + (k.href ? '<a href="' + esc(k.href) + '" rel="noopener">' + esc(k.src) + '</a>' : esc(k.src)) + '</p>' : '') + '</div>';
    }).join('') + '</div>';
  }
  // A folded part: the title and a one-line take show; the rest opens below.
  function fold(title, take, body, open) {
    return '<details class="fold dd-fold"' + (open ? ' open' : '') + '><summary><span class="fold-title">' + esc(title) + '</span>' + (take ? '<span class="fold-take">' + esc(take) + '</span>' : '') + '</summary><div>' + body + '</div></details>';
  }
  function src(text, href, date) { return T.source(text, href, date); }
  // Marks text the live page prints from its own markup (no data file behind it), with the date it gives.
  function staticTag(note) { return '<p class="dd-static"><span class="dd-tag">Static</span> ' + esc(note) + '</p>'; }
  function list(items) { return '<ul class="dd-list">' + items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>'; }
  // Bars either side of zero: rows [label, value, detail]. Red short, green surplus.
  function diverge(title, note, rows, fmt) {
    var max = Math.max.apply(null, rows.map(function (r) { return Math.abs(r[1] || 0); })) || 1;
    return '<figure class="dd-diverge"><figcaption><strong>' + esc(title) + '</strong>' + (note ? '<span class="note">' + esc(note) + '</span>' : '') + '</figcaption><div class="dd-div-rows">' +
      rows.map(function (r) {
        var v = r[1], w = v == null ? 0 : Math.abs(v) / max * 50;
        return '<div class="dd-div-row"><p class="dd-div-label">' + esc(r[0]) + '</p><div class="dd-div-track" role="img" aria-label="' + esc(r[0] + ': ' + (v == null ? 'not published' : fmt(v))) + '">' +
          '<span class="dd-div-bar ' + (v < 0 ? 'is-short' : 'is-over') + '" style="' + (v < 0 ? 'right:50%' : 'left:50%') + ';width:' + w.toFixed(2) + '%"></span><span class="dd-div-axis"></span></div>' +
          '<p class="dd-div-value">' + esc(v == null ? 'Not published' : fmt(v)) + (r[2] ? ' <span class="note">' + esc(r[2]) + '</span>' : '') + '</p></div>';
      }).join('') + '</div></figure>';
  }
  // A choice that lives in the address: changing it redraws the page on the same tab.
  function picker(id, key, label, options, picked) {
    return '<div class="search dd-pick"><label for="' + esc(id) + '">' + esc(label) + '</label><select id="' + esc(id) + '" data-dd-pick="' + esc(key) + '">' +
      options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(picked == null ? '' : picked) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>';
  }
  function countyOptions(names, allLabel) {
    return (allLabel ? [['', allLabel]] : []).concat(names.slice().sort().map(function (n) { return [n, n]; }));
  }

  // ---------- Colorado map: counties, with optional dots ----------
  // Statewide frame and projection from site/map-kit.js.
  var K = global.LabMap, MAP_W = K.W, MAP_H = K.H;
  var RAMP = ['var(--map-0)', 'var(--map-1)', 'var(--map-2)', 'var(--map-3)', 'var(--map-4)', 'var(--map-5)'], NONE = 'var(--map-empty)';
  function px(lon, lat) { return [K.x(lon), K.y(lat)]; }
  var ring = K.ring;
  function shape(g) { return (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(function (p) { return p.map(ring).join(''); }).join(''); }
  // o: { features, value(fips) → number|null, fill(fips) → colour (optional), label(fips), picked, title (the finding),
  //      kicker (the topic, small above it), legend: [[colour, text]], fmt(v) for an automatic legend with numbers,
  //      thin: { fips: true } for the dotted thin-data overlay, dots: [{lon, lat, r, fill, label, shape}] }
  // Map kit part 2: a county with no figure gets the "not published" hatch, never the lowest colour.
  function coMap(o) {
    var mk = K.marks();
    var vals = o.features.map(function (f) { return o.value ? o.value(f.properties.GEOID) : null; }).filter(function (v) { return v != null; });
    var sorted = vals.slice().sort(function (a, b) { return a - b; });
    function cls(v) { return Math.min(RAMP.length - 1, Math.floor(sorted.indexOf(v) / Math.max(1, sorted.length) * RAMP.length)); }
    function shade(v) { return v == null ? NONE : RAMP[cls(v)]; }
    var hasNone = false;
    var paths = o.features.map(function (f) {
      var k = f.properties.GEOID, v = o.value ? o.value(k) : null;
      var fill = o.fill ? o.fill(k) : shade(v);
      if (fill === NONE) { fill = mk.none; hasNone = true; }
      return '<path d="' + shape(f.geometry) + '" fill="' + fill + '" stroke="' + (o.picked === k ? 'var(--ink)' : 'var(--map-edge)') + '" stroke-width="' + (o.picked === k ? 2 : 0.8) + '"><title>' + esc(o.label(k, v)) + '</title></path>';
    }).join('');
    var thinN = o.thin ? o.features.filter(function (f) { return o.thin[f.properties.GEOID]; }).length : 0;
    var thin = thinN ? K.thinLayer(o.features, o.thin, mk) : '';
    var dots = (o.dots || []).map(function (d) {
      var p = px(d.lon, d.lat), t = '<title>' + esc(d.label) + '</title>', at = ' fill="' + (d.fill || 'var(--rust)') + '" fill-opacity="' + (d.opacity || '.8') + '" stroke="var(--halo)" stroke-width="' + (d.stroke || '.4') + '"';
      return d.shape && d.shape !== 'circle' ? '<path d="' + K.glyph(d.shape, p[0], p[1], d.r || 2.4) + '"' + at + '>' + t + '</path>'
        : '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + (d.r || 2.4) + '"' + at + '>' + t + '</circle>';
    }).join('');
    // A shaded map with fmt gets its classes written out: lowest to highest value and how many counties.
    var legend = o.legend ? o.legend.slice() : [];
    if (!o.legend && o.fmt && sorted.length) legend = K.classes(sorted, RAMP.length, cls).map(function (c, i) {
      return c.count ? [RAMP[i], (c.lo === c.hi ? o.fmt(c.lo) : o.fmt(c.lo) + ' to ' + o.fmt(c.hi)) + ' (' + c.count + ')'] : null;
    }).filter(Boolean);
    var items = legend.filter(function (l) { return l[0] !== NONE; }).map(function (l) { return '<li><span class="dd-swatch" style="background:' + l[0] + '"></span>' + esc(l[1]) + '</li>'; });
    if (hasNone || legend.some(function (l) { return l[0] === NONE; })) items.push('<li>' + K.KEY_NONE + esc((legend.filter(function (l) { return l[0] === NONE; })[0] || [0, 'Not published'])[1]) + '</li>');
    if (thinN) items.push('<li>' + K.KEY_THIN + 'Under ' + num(K.THIN) + ' homes: wide survey margin (' + thinN + ')</li>');
    return '<figure class="dd-map"><figcaption>' + (o.kicker ? '<span class="dd-kicker">' + esc(o.kicker) + '</span>' : '') + '<strong>' + esc(o.title) + '</strong>' + (o.note ? '<span class="note">' + esc(o.note) + '</span>' : '') + '</figcaption>' +
      '<div class="pm-frame"><svg viewBox="0 0 ' + MAP_W + ' ' + MAP_H + '" role="img" aria-label="' + esc(global.LabTpl ? (global.LabTpl && global.LabTpl.alt || function (f, s) { return f + '. Source: ' + s + '.'; })(o.title, String(o.alt || '').replace(/^Source: /, '').replace(/\.$/, '')) : o.title) + '">' + mk.defs + paths + thin + dots + (o.inset ? K.metroBox() : '') + K.cities() + '</svg></div>' +
      (items.length ? '<ul class="dd-legend">' + items.join('') + '</ul>' : '') +
      // Map kit part 3: the Denver metro close-up, with the same dots drawn larger.
      (o.inset ? K.inset({ features: o.features, dots: (o.dots || []).map(function (d) { return { lon: d.lon, lat: d.lat, r: (d.r || 2.4) * 2.4, fill: d.fill || 'var(--rust)', label: esc(d.label), shape: d.shape, attrs: ' fill-opacity="' + (d.opacity || '.8') + '"' }; }) }) : '') +
      (o.source ? '<p class="metric-source">Source: ' + o.source + '</p>' : '') + mapTable(o) + '</figure>';
  }
  // "Show the numbers" for a map: one row per county (or per dot when the dots carry the figures), in the map's own words.
  function mapTable(o) {
    var VD = global.LabVizData;
    if (!VD) return '';
    if (o.dots && o.dots.length) return VD.block(o.title, ['Each mark on the map'], o.dots.map(function (d) { return [d.label]; }));
    var rows = o.features.map(function (f) {
      var k = f.properties.GEOID, v = o.value ? o.value(k) : null, n = (f.properties.NAME || k) + ' County';
      var t = String(o.label(k, v) || '').replace(new RegExp('^' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*'), '');
      return o.value ? [n, v, t] : [n, t];
    }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    return VD.block(o.title, o.value ? ['County', o.valueName || 'Value', 'Detail'] : ['County', 'What the map shows'], rows);
  }

  // ---------- the public site's own engines, loaded once from the pinned copy ----------
  var engines = {};
  function engine(file, globalName) {
    if (global[globalName]) return global[globalName];
    if (!engines[file]) {
      engines[file] = 'loading';
      var s = document.createElement('script');
      s.src = VENDOR + file;
      s.onload = function () { engines[file] = 'ready'; Shell.render(); };
      s.onerror = function () { engines[file] = 'failed'; Shell.render(); };
      document.head.appendChild(s);
    }
    return global[globalName] || null;
  }
  function failed(file) { return engines[file] === 'failed'; }
  // Said in place of a part whose public-site module this copy of the site does not carry.
  function missing(what) { return '<p class="callout">' + esc(what) + ' uses a module this page does not carry yet. It is on ' + ext(DD, 'the full Colorado Deep Dive') + '.</p>'; }
  // Fixed lists a live module keeps inside itself (the policy simulator's scenarios):
  // read from the pinned module's own text, so the lab carries what the live page draws, not a copy of it.
  var literals = {};
  function literal(file, name) {
    var k = file + '|' + name;
    if (!literals[k]) {
      literals[k] = { data: null, error: null };
      fetch(VENDOR + file).then(function (r) { if (!r.ok) throw new Error(file + ' ' + r.status); return r.text(); }).then(function (text) {
        var at = text.indexOf('const ' + name + ' = [');
        if (at < 0) throw new Error(name + ' not found in ' + file);
        var i = text.indexOf('[', at), depth = 0, j = i;
        for (; j < text.length; j++) { var ch = text[j]; if (ch === '[') depth++; else if (ch === ']') { depth--; if (!depth) break; } }
        // eslint-disable-next-line no-new-func
        literals[k].data = new Function('return ' + text.slice(i, j + 1))();
        Shell.render();
      }).catch(function (e) { literals[k].error = String(e.message || e); Shell.render(); });
    }
    return literals[k];
  }

  // ---------- text the live page prints from its own markup ----------
  // Each entry is the live page's wording at the pinned commit (31 Oct 2026), with the source and date it names.
  // qa/deep-dive.test.js checks every entry against colorado-deep-dive.html at the pin.
  var STATIC = {
    homePriceRead: 'Prices are not falling enough to make homes affordable for lower-income households, so the need figures elsewhere on this page still apply. For site-level work, re-run any financial model against current construction costs rather than older estimates.',
    concessionImpact: 'New luxury properties offering up to 3 months free rent, creating downward pressure on older Class B/C properties throughout the metro.',
    // Denver metro average monthly concession, 2022 to 2025, as the live chart draws it. The live page labels the
    // series "AAMD Q4 2025" in its subtitle and cites CBRE Multifamily Outlook 2025 under the chart.
    concessionTrend: { years: [2022, 2023, 2024, 2025], values: [45, 65, 110, 169] },
    concessionClass: [['Class A (2020+)', 285, 'Up to 3 months free rent'], ['Class B (2000-2019)', 150, '1-2 months free + gift cards'], ['Class C (pre-2000)', 95, 'Selective incentives + waived fees']],
    concessionMarkets: [
      ['Denver Metro', '$169', '9.5%', '4-5 weeks', 'Oversupply (19K units 2024)'],
      ['Colorado Springs', '$95', '6.2%', '3 weeks', 'Moderate supply increase'],
      ['Fort Collins', '$110', '7.1%', '3.5 weeks', 'Student housing competition'],
      ['Boulder', '$125', '6.8%', '3.5 weeks', 'New luxury supply'],
      ['Pueblo', '$45', '4.1%', '2 weeks', 'Limited new construction']
    ],
    nahb: ['The NAHB / Wells Fargo Housing Market Index is the standard barometer of US builder sentiment. A reading above 50 means builders see good conditions; below 50 means poor. The series is published monthly but is paywalled behind NAHB membership and is not available via a free public feed.',
      'At time of last review, the national HMI sat in the low-to-mid 40s — consistent with elevated mortgage rates, soft buyer traffic, and the concession environment described above. Builders in mountain-west markets (including Colorado) typically track 2–4 points below the national index in periods of high construction wage pressure.'],
    keyFindings: [
      'Credit pricing slid from about $0.90 in 2022 to the low $0.80s by mid-2026 (chart above)',
      'Housing starts continue to track Front Range population growth',
      'Denver metro consistently captures the majority share of statewide LIHTC units',
      'Rural set-aside is heavily oversubscribed at most rounds (CHFA round reports document the gap)',
      'Transit-oriented development receives scoring premium in the 2026 QAP'
    ],
    priorities: {
      intro: 'The 2025-26 QAP (§2.A) names three priorities, and one threshold every project must meet:',
      items: [['Homelessness', 'housing for people experiencing homelessness'], ['Special populations', 'housing with services for groups the QAP names as special populations'], ['Non-metro counties', 'projects in non-metro counties of 180,000 people or fewer']],
      green: 'every project must earn a green building certification, and the applicant picks Enterprise Green Communities, LEED or NGBS. Annual energy reporting is also required, and so is EV-ready parking, except on acquisition/rehab projects and projects that are 100% for people experiencing homelessness or Special Populations. This is a threshold, not points. All-electric or higher-level certification makes an application “more competitive” under a Guiding Principle.',
      quote: 'CHFA requires all projects to obtain green building certification and accepts several certification programs'
    },
    // Metro grouping the live Market Overview table uses (by county name); every other county is "Other / Rural".
    metroByCounty: { Denver: 'Denver Metro', Arapahoe: 'Denver Metro', Jefferson: 'Denver Metro', Adams: 'Denver Metro', Douglas: 'Denver Metro', Broomfield: 'Denver Metro',
      'El Paso': 'Colorado Springs', Teller: 'Colorado Springs', Larimer: 'Fort Collins / NoCo', Weld: 'Fort Collins / NoCo', Boulder: 'Boulder', Pueblo: 'Pueblo',
      Mesa: 'Western Slope', Garfield: 'Western Slope', Pitkin: 'Mountain Resort', Eagle: 'Mountain Resort', Summit: 'Mountain Resort', Routt: 'Mountain Resort',
      'San Miguel': 'Mountain Resort', 'La Plata': 'Mountain Resort', Gunnison: 'Mountain Resort' },
    about: ['Colorado affordable housing figures: county-level LIHTC pipeline, AMI affordability gaps, CHFA allocation history, market trends, construction activity, and Prop 123 compliance tracking.',
      'Colorado-specific context is essential for LIHTC development. Statewide trends, CHFA priorities, Prop 123 dynamics, and competitive landscape all influence deal positioning. This page provides the state-level view that complements jurisdiction-level analysis.',
      'This is a data exploration page, not a scored analysis. It does not recommend specific sites or rank jurisdictions. Some data is manually updated (CAR reports) and may lag by 1-2 months. Historical allocation data from HUD has a 12-24 month reporting lag.'],
    disclaimer: 'This analysis aggregates data from multiple authoritative sources for informational purposes. Market conditions change rapidly. Developers and investors should conduct independent due diligence, verify current pricing and incentives, and consult qualified professionals for project-specific guidance. DDA/QCT designations shown are based on 2026 HUD designations effective January 1, 2026.'
  };

  // ---------- 1. Overview and map ----------
  function overview(d, params) {
    var hpi = obs(d.fred, 'COSTHPI'), h = hpi[hpi.length - 1], hb = valueAt(hpi, yearBefore(h.date));
    var hp = change(+h.value, hb), prevQ = hpi[hpi.length - 2], prevB = valueAt(hpi, yearBefore(prevQ.date)), hpPrev = change(+prevQ.value, prevB);
    var q = Math.floor((+h.date.slice(5, 7) - 1) / 3), word = Math.abs(hp) < 1 ? 'flat' : hp > 0 ? 'rising' : 'falling';
    var co = d.alloc.states.CO, feats = d.lihtc.features, am = d.aamd.metro, av = d.aamd.meta.vintage;
    var picked = params.get('map') || '';
    var byCounty = {};
    feats.forEach(function (f) { var p = f.properties, k = p.CNTY_FIPS; var c = byCounty[k] = byCounty[k] || { projects: 0, units: 0, li: 0 }; c.projects++; c.units += p.N_UNITS || 0; c.li += p.LI_UNITS || 0; });
    var qctBy = {}; d.qct.features.forEach(function (f) { var k = '08' + f.properties.COUNTY; qctBy[k] = (qctBy[k] || 0) + 1; });
    var ddaCounty = d.dda.features.filter(function (f) { return f.properties.DDA_KIND === 'county'; }), ddaZip = d.dda.features.filter(function (f) { return f.properties.DDA_KIND !== 'county'; });
    var ddaSet = {}; ddaCounty.forEach(function (f) { ddaSet[f.properties.GEOID] = true; });
    var names = {}; d.bounds.features.forEach(function (f) { names[f.properties.GEOID] = f.properties.NAME; });
    var dots = feats.filter(function (f) { return f.geometry && f.geometry.coordinates && (!picked || f.properties.CNTY_FIPS === picked); }).map(function (f) {
      // Map kit part 2: a project's dot is sized by its homes, so the dots carry the counts and the shading the rate.
      var p = f.properties; return { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], r: (picked ? 1.6 : 1.1) + Math.sqrt(p.N_UNITS || 0) / (picked ? 3.2 : 4.5), opacity: '.7', label: p.PROJECT + ', ' + p.PROJ_CTY + ' · ' + num(p.N_UNITS) + ' homes · ' + (p.CREDIT || 'credit type not recorded') + ' · awarded ' + p.YR_ALLOC };
    });
    var rows = feats.filter(function (f) { return !picked || f.properties.CNTY_FIPS === picked; }).map(function (f) {
      var p = f.properties; return { name: p.PROJECT, city: p.PROJ_CTY, county: p.CNTY_NAME, units: p.N_UNITS, li: p.LI_UNITS, year: p.YR_ALLOC, credit: p.CREDIT, qct: p.HUD && p.HUD.qct_pis ? 'Yes' : '', type: p.ProjectType };
    });
    // Map kit part 2: shade a rate, never a raw count (cartography review, finding 3).
    var hhBy = {}; d.bounds.features.forEach(function (f) { var c = d.cdemo.counties[f.properties.NAME]; if (c && c.households) hhBy[f.properties.GEOID] = c.households; });
    var rateOf = function (k) { return hhBy[k] ? ((byCounty[k] || {}).units || 0) / hhBy[k] * 1000 : null; };
    var rated = Object.keys(names).filter(function (k) { return rateOf(k) != null; }).sort(function (a, b) { return rateOf(b) - rateOf(a); });
    var noneN = rated.filter(function (k) { return !byCounty[k]; }).length;
    var rateTitle = names[rated[0]] + ' County has the most tax credit homes for its size (' + rateOf(rated[0]).toFixed(0) + ' per 1,000 households, then ' + names[rated[1]] + ' at ' + rateOf(rated[1]).toFixed(0) + '); ' + noneN + ' counties have none';
    var countyRows = Object.keys(names).map(function (k) { var c = byCounty[k] || { projects: 0, units: 0, li: 0 }; return { fips: k, county: names[k], projects: c.projects, units: c.units, qct: qctBy[k] || 0, dda: ddaSet[k] ? 'Non-metro county DDA' : '' }; });
    var mapIntro = 'Zoomable layers for tracts are on the Data map. Here: every CHFA tax credit property as a dot (' + num(feats.length) + ' projects through ' + Math.max.apply(null, feats.map(function (f) { return f.properties.YR_ALLOC || 0; })) +
      '), counties shaded by tax credit homes, and each county’s 2026 Qualified Census Tracts and Difficult Development Areas, the HUD designations that make a project eligible for the 30% basis boost.';
    return sec('home-prices', 'Colorado home prices, ' + QWORD[q] + ' quarter ' + h.date.slice(0, 4) + ': ' + word,
        '<p>The Federal Housing Finance Agency’s Colorado House Price Index (series ' + ext('https://fred.stlouisfed.org/series/COSTHPI', 'COSTHPI') + ') moved <strong>' + esc(pct(hp)) + ' from ' + esc(quarterOf(yearBefore(h.date))) + ' to ' + esc(quarterOf(h.date)) + '</strong> (' + (+hb).toFixed(2) + ' to ' + (+h.value).toFixed(2) + '), after ' + esc(pct(hpPrev)) + ' over the year to ' + esc(quarterOf(prevQ.date)) + '.</p>' +
        (word === 'flat' ? '<p>' + esc(STATIC.homePriceRead) + '</p>' : '') +
        src('FHFA Colorado All-Transactions House Price Index (FRED · COSTHPI), quarterly, not seasonally adjusted', 'https://fred.stlouisfed.org/series/COSTHPI', 'latest ' + quarterOf(h.date)) +
        kpis([
          { label: h.date.slice(0, 4) === '2026' ? '2026 federal housing credit ceiling' : co.name + ' credit ceiling', value: '$' + (co.allocation / 1e6).toFixed(1) + 'M', detail: 'Colorado’s yearly 9% credit authority ($' + (co.allocation / co.population).toFixed(3) + ' per resident)', src: d.alloc.source.name, href: d.alloc.source.url },
          { label: 'CHFA tax credit properties', value: num(feats.length), detail: 'All Colorado properties in CHFA’s housing credit list', src: 'CHFA HousingTaxCreditProperties, fetched ' + day(d.lihtc.fetchedAt), href: 'https://www.chfainfo.com/rental-housing/housing-credit' },
          { label: 'Metro Denver apartment vacancy (' + av + ')', value: plain(am.stabilized_vacancy_pct), detail: 'Of stabilized units · ' + plain(am.stabilized_vacancy_prior_quarter_pct) + ' last quarter · ' + plain(am.stabilized_vacancy_year_ago_pct) + ' a year ago', src: 'AAMD Vacancy & Rent Report', href: d.aamd.meta.source_landing_url },
          { label: 'Average monthly concession (' + av + ')', value: money(am.average_concession), detail: 'Denver metro, per unit (' + plain(am.concession_pct_of_gross_rent) + ' of gross rent)', src: 'AAMD Vacancy & Rent Report', href: d.aamd.meta.source_landing_url }
        ]), 3) +
      sec('map', 'Interactive map: DDAs, QCTs and LIHTC projects', '<p>' + esc(mapIntro) + '</p>' +
        picker('dd-map-pick', 'map', 'Show one county', [['', 'All of Colorado']].concat(Object.keys(names).sort(function (a, b) { return names[a] < names[b] ? -1 : 1; }).map(function (k) { return [k, names[k] + ' County']; })), picked) +
        coMap({ features: d.bounds.features, value: rateOf, picked: picked, fmt: function (v) { return v === 0 ? 'None' : v.toFixed(v < 10 ? 1 : 0); }, valueName: 'Tax credit homes per 1,000 households',
          label: function (k) { var c = byCounty[k], r = rateOf(k); return names[k] + ' County: ' + (c ? num(c.projects) + ' projects, ' + num(c.units) + ' homes' : 'no tax credit projects') + (r != null ? ' (' + r.toFixed(1) + ' per 1,000 households)' : '') + '; ' + (qctBy[k] || 0) + ' QCTs' + (ddaSet[k] ? '; non-metro DDA' : ''); },
          kicker: picked ? 'Tax credit projects in ' + names[picked] + ' County' : 'Tax credit projects across Colorado', title: picked ? names[picked] + ' County: ' + num((byCounty[picked] || {}).projects || 0) + ' tax credit projects, ' + (rateOf(picked) != null ? rateOf(picked).toFixed(1) + ' homes per 1,000 households' : 'households not published') : rateTitle,
          note: 'Counties are shaded by tax credit homes per 1,000 households, so big counties do not look darkest just for their size. Each dot is a project, sized by its homes. Tap or point to a dot or county for its figures; zoom in to separate the Denver-area dots.',
          inset: !picked, alt: 'CHFA, Census ACS', dots: dots }) +
        kpis([
          { label: '2026 Qualified Census Tracts', value: num(d.qct.features.length), detail: 'Tracts where half of households earn under 60% AMI, or poverty is 25% or more', src: 'HUD QCT 2026, fetched ' + day(d.qct.fetchedAt), href: 'https://www.huduser.gov/portal/datasets/qct.html' },
          { label: '2026 Difficult Development Areas', value: num(d.dda.features.length), detail: ddaCounty.length + ' non-metro counties and ' + ddaZip.length + ' metro ZIP code areas', src: 'HUD DDA ' + d.dda.designationYear + ', fetched ' + day(d.dda.fetchedAt), href: 'https://www.huduser.gov/portal/datasets/qct.html' }
        ]) +
        '<p>Non-metro county DDAs: ' + esc(ddaCounty.map(function (f) { return f.properties.DDA_NAME; }).sort().join(', ')) + '. Metro DDAs by ZIP code: ' + esc((function () { var n = {}; ddaZip.forEach(function (f) { var k = f.properties.DDA_NAME || f.properties.ZCTA5; if (k) n[k] = (n[k] || 0) + 1; }); return Object.keys(n).sort().map(function (k) { return k + ' (' + n[k] + (n[k] === 1 ? ' ZIP)' : ' ZIPs)'); }).join(', '); })()) + '.</p>' +
        fold('Every county: projects, homes, QCTs and DDAs', '64 counties, sortable', UI.table('dd-map-c', 'Tax credit projects and HUD designations by county', [
          { key: 'county', label: 'County', href: function (r) { return '#/places/deep-dive?tab=overview&map=' + r.fips; } }, { key: 'projects', label: 'Projects', num: true, fmt: num }, { key: 'units', label: 'Homes', num: true, fmt: num },
          { key: 'qct', label: '2026 QCTs', num: true, fmt: num, tip: 'Qualified Census Tracts in the county (HUD 2026)' }, { key: 'dda', label: 'DDA', tip: 'Whole-county non-metro Difficult Development Area (HUD 2026). Metro DDAs are drawn by ZIP code and listed above.' }
        ], countyRows, { noun: 'counties', placeholder: 'County' })) +
        fold(picked ? 'Every project in ' + names[picked] + ' County' : 'Every tax credit project', num(rows.length) + ' projects, sortable and searchable', UI.table('dd-map-p', 'CHFA tax credit properties', [
          { key: 'name', label: 'Project' }, { key: 'city', label: 'City' }, { key: 'county', label: 'County' }, { key: 'units', label: 'Homes', num: true, fmt: num }, { key: 'li', label: 'Low-income homes', num: true, fmt: num },
          { key: 'year', label: 'Awarded', num: true }, { key: 'credit', label: 'Credit' }, { key: 'type', label: 'Type' }
        ], rows, { noun: 'projects', placeholder: 'Project, city or county' })) +
        '<p><a class="button-link secondary" href="#/data/map?layer=qct">Open the tract layers on the data map →</a></p>' +
        src('CHFA HousingTaxCreditProperties; HUD 2026 QCT and DDA designations; Census county boundaries', 'https://www.huduser.gov/portal/datasets/qct.html', 'fetched ' + day(d.lihtc.fetchedAt)));
  }

  // ---------- 2. AMI gap ----------
  function amiGap(d, params) {
    var hud = d.hud, den = hud.counties.filter(function (c) { return c.fips === '08031'; })[0], il = den.income_limits;
    var tiers = [[30, 'Extremely low'], [50, 'Very low'], [60, 'Tax credit standard'], [80, 'Low income']];
    var denRows = tiers.map(function (t) { var r = { tier: t[0] + '% AMI (' + t[1] + ')' }; [1, 2, 3, 4].forEach(function (n) { r['p' + n] = il['il' + t[0] + '_' + n + 'person']; }); return r; });
    var hourly = il.il80_1person / 2080;
    var countyRows = hud.counties.map(function (c) { return { county: cname(c.county_name), area: c.fmr_area_name, ami: c.income_limits.ami_4person, l1: c.income_limits.il60_1person, l4: c.income_limits.il60_4person }; });
    var gap = d.gap, bands = gap.bands, st = gap.statewide;
    var pick = params.get('ami') || '08', rec = pick === '08' ? st : gap.counties.filter(function (c) { return c.fips === pick; })[0] || st;
    var rowsFor = function (r) { return bands.map(function (b) { return { band: b + '% AMI', rent: r.affordable_rent_monthly[b], hh: r.households_le_ami_pct[b], units: r.units_priced_affordable_le_ami_pct[b], gap: r.gap_units_minus_households_le_ami_pct[b], cov: r.coverage_le_ami_pct[b] }; }); };
    var rows = rowsFor(rec), cov100 = rec.coverage_le_ami_pct[100];
    var covWord = cov100 < 0.5 ? 'critical' : cov100 < 0.8 ? 'a moderate gap' : cov100 < 1 ? 'a small gap' : 'enough homes priced for them';
    var gapSrc = src('HUD FY' + gap.meta.hud_income_limits_year + ' county income limits · ACS ' + gap.meta.acs_year + ' B25118 and B25063', gap.sources[2].url, 'built ' + day(gap.meta.generated_at));
    var opts = [['08', 'Colorado (statewide)']].concat(gap.counties.slice().sort(function (a, b) { return a.county_name < b.county_name ? -1 : 1; }).map(function (c) { return [c.fips, c.county_name]; }));
    return sec('ami', 'Area Median Income (AMI) analysis', '<p>Most affordable homes are priced to a share of area median income. These sections set Colorado’s renters, by income, against the rental homes priced for them.</p>') +
      sec('denver-il', 'Denver income limits (HUD FY' + hud.meta.income_limits_fiscal_year + ')', '<p>The most a household can earn and still qualify, by household size.</p>' +
        UI.table('dd-den', 'Denver County income limits by household size', [{ key: 'tier', label: 'Income tier' }].concat([1, 2, 3, 4].map(function (n) { return { key: 'p' + n, label: n + (n > 1 ? ' people' : ' person'), num: true, fmt: money, tip: 'Income limit for a ' + n + '-person household at this AMI level' }; })), denRows, { noun: 'tiers', placeholder: 'Tier' }) +
        '<p>Area median income, 4-person household: <strong>' + money(il.ami_4person) + '</strong>. HUD publishes the median for a 4-person household only. In Denver, one person earning up to ' + money(il.il80_1person) + ' a year (about $' + hourly.toFixed(2) + ' an hour full time) counts as “low income” at 80% AMI.</p>' +
        src(hud.meta.source + ', Denver County', hud.meta.url_il, 'generated ' + day(hud.meta.generated)), 3) +
      sec('need-by-ami', 'Colorado housing need by AMI level', '<p>Estimated renter households against homes priced for them, statewide. Counts are cumulative: 60% AMI includes every household at or below 60%.</p>' +
        UI.bars('Renter households at or below each income', 'Statewide, ACS ' + gap.meta.acs_year, rowsFor(st).map(function (r) { return [r.band, r.hh]; }), num, 'households') +
        UI.bars('Homes renting at a price each band can pay', 'Rent at or below 30% of the band’s income', rowsFor(st).map(function (r) { return [r.band + ' (' + money(r.rent) + ' a month)', r.units]; }), num, 'homes') +
        src('HUD FY' + gap.meta.hud_income_limits_year + ' county income limits · ACS B25118 and B25063', gap.sources[2].url, 'built ' + day(gap.meta.generated_at)), 3) +
      sec('ami-counties', 'AMI variations across Colorado counties', '<p>HUD sets limits for each county or metro area, so the same 60% AMI home means a different income in each place.</p>' +
        UI.table('dd-ami-c', 'Area median income and 60% AMI limits by county', [
          { key: 'county', label: 'County' }, { key: 'area', label: 'HUD area', tip: 'The HUD metro or county area whose limits apply' },
          { key: 'ami', label: '4-person AMI (100%)', num: true, fmt: money }, { key: 'l1', label: '60% limit, 1 person', num: true, fmt: money }, { key: 'l4', label: '60% limit, 4 people', num: true, fmt: money }
        ], countyRows, { noun: 'counties', placeholder: 'County' }) + src(hud.meta.source, hud.meta.url_il, 'generated ' + day(hud.meta.generated)), 3) +
      sec('ami-module', 'Colorado AMI households vs priced-affordable units',
        '<p>Renter households at or below each income, against renter-occupied homes whose gross rent is at or below 30% of that income (ACS B25063). A home priced for a band is not necessarily vacant or available to it.</p>' +
        picker('dd-ami-pick', 'ami', 'County or region', opts, pick) +
        kpis([
          { label: 'Selected geography', value: rec.county_name, detail: 'Renter households: ' + num(rec.renter_households_total) },
          { label: '4-person AMI (100%)', value: money(rec.ami_4person), src: 'HUD FY' + gap.meta.hud_income_limits_year + ' income limits', href: gap.sources[0].url },
          { label: 'Renter households ≤100% AMI', value: num(rec.households_le_ami_pct[100]), src: 'ACS B25118', href: gap.sources[2].url },
          { label: 'Priced-affordable homes ≤100% AMI', value: num(rec.units_priced_affordable_le_ami_pct[100]), src: 'ACS B25063', href: gap.sources[3].url }
        ]) +
        sec('ami-compare', 'Households vs priced-affordable units by AMI level',
          '<div class="chart-pair">' + UI.bars('Renter households at or below the band', rec.county_name, rows.map(function (r) { return [r.band, r.hh]; }), num, 'households') +
          UI.bars('Homes priced for the band', rec.county_name, rows.map(function (r) { return [r.band, r.units]; }), num, 'homes') + '</div>' + gapSrc, 3) +
        sec('ami-gap', 'Affordability gap', diverge('Homes minus households at each AMI level', 'Red: more households than homes priced for them. Green: more homes than households.', rows.map(function (r) { return [r.band, r.gap]; }), signed) + gapSrc, 3) +
        sec('ami-cov', 'Coverage ratio at 100% AMI', '<p>Priced-affordable homes for every renter household at or below 100% AMI: <strong>' + esc(share(cov100, 0)) + '</strong>, which reads as ' + esc(covWord) + ' (under 50% is critical, 50–80% a moderate gap).</p>' +
          '<div class="dd-meter" role="img" aria-label="Coverage ' + esc(share(cov100, 0)) + '"><span style="width:' + Math.min(100, cov100 * 100).toFixed(1) + '%"></span></div><p class="note">0% · 50% · 100%</p>', 3) +
        sec('ami-table', 'AMI gap detail table', UI.table('dd-ami-t', 'Every measure by AMI band, ' + rec.county_name, [
          { key: 'band', label: 'AMI band' }, { key: 'rent', label: 'Affordable rent (4 people, 30% of income)', num: true, fmt: money },
          { key: 'hh', label: 'Renter households', num: true, fmt: num }, { key: 'units', label: 'Priced-affordable homes', num: true, fmt: num, tip: 'Homes renting at or below the affordable rent for this band, occupied or not, and by anyone' },
          { key: 'gap', label: 'Gap (homes − households)', num: true, fmt: signed, tip: 'Negative means more households than affordable homes' },
          { key: 'cov', label: 'Coverage ratio', num: true, fmt: function (v) { return v.toFixed(2); }, tip: 'Priced-affordable homes divided by households. Below 1.0 means a shortfall.' }
        ], rows, { noun: 'bands', placeholder: 'Band' }) + gapSrc, 3) +
        fold('Methodology and data sources', 'How the gap is counted', list(gap.methodology.map(function (m) { return esc(m); })) + list(gap.sources.map(function (s) { return ext(s.url, s.name); })) + '<p class="note">' + esc(gap.meta.note) + '</p>') +
        src('AMI gap by county (COHO Analytics, from Census ACS and HUD income limits)', gap.sources[2].url, 'updated ' + day(gap.meta.generated_at)));
  }

  // The live modules that read their files through window.DataService: pointed at the pinned copy for the
  // one call that starts their loads, then put back, so no other module sees the stand-in.
  function startEngine(mod) {
    if (!mod || mod._labStarted) return mod && mod._labReady;
    mod._labStarted = true;
    var had = Object.prototype.hasOwnProperty.call(global, 'DataService'), before = global.DataService;
    global.DataService = { baseData: function (rel) { return VENDOR + 'data/' + rel; }, getJSON: function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }); } };
    var p;
    try { p = mod.init(); } finally { if (had) global.DataService = before; else delete global.DataService; }
    Promise.resolve(p).then(function () { mod._labReady = true; Shell.render(); }, function () { mod._labReady = 'failed'; Shell.render(); });
    return false;
  }
  function unemploymentAvg(ind) {
    var v = Object.keys(ind.counties).map(function (k) { return ind.counties[k].unemployment_rate; }).filter(function (x) { return x != null && isFinite(x); });
    return v.length ? v.reduce(function (s, x) { return s + x; }, 0) / v.length : null;
  }

  // ---------- 3. Market trends ----------
  function trends(d) {
    var am = d.aamd.metro, av = d.aamd.meta.vintage, fc = d.fc, fs = fc.summary, ind = d.ind;
    var un = unemploymentAvg(ind);
    var fcLine = function (k) { return fc.series[k].points.filter(function (p) { return !p.suppressed && p.value_pct != null; }).map(function (p) { return [p.year + (p.quarter - 1) / 4, p.value_pct]; }); };
    // Market dynamics: four metros from FRED, as the live table reads them.
    var METROS = [['Denver', 'ATNHPIUS19740Q', 'MEDDAYONMAR19740'], ['Colorado Springs', 'ATNHPIUS17820Q', 'MEDDAYONMAR17820'], ['Fort Collins', 'ATNHPIUS22660Q', 'MEDDAYONMAR22660'], ['Grand Junction', 'ATNHPIUS24300Q', 'MEDDAYONMAR24300']];
    var common = function (i) { var c = null; METROS.forEach(function (m) { var o = obs(d.fred, m[i]); var l = o.length ? o[o.length - 1].date : null; if (l && (!c || l < c)) c = l; }); return c; };
    var lastH = common(1), lastD = common(2);
    var metroRows = METROS.map(function (m) {
      var h = obs(d.fred, m[1]), dm = obs(d.fred, m[2]);
      return { metro: m[0], dated: change(valueAt(h, '2024-10-01'), valueAt(h, '2023-10-01')), latest: lastH ? change(valueAt(h, lastH), valueAt(h, yearBefore(lastH))) : null,
        dec24: valueAt(dm, '2024-12-01'), now: lastD ? valueAt(dm, lastD) : null, prev: lastD ? valueAt(dm, yearBefore(lastD)) : null };
    });
    var rent = obs(d.fred, 'CUUSA433SEHA'), rl = rent[rent.length - 1];
    var r24 = change(valueAt(rent, '2024-01-01'), valueAt(rent, '2023-01-01')), rNow = rl ? change(+rl.value, valueAt(rent, yearBefore(rl.date))) : null;
    var state = [], hpi = obs(d.fred, 'COSTHPI'), hl = hpi[hpi.length - 1];
    state.push('Prices statewide: ' + pct(change(+hl.value, valueAt(hpi, yearBefore(hl.date)))) + ', ' + quarterOf(yearBefore(hl.date)) + ' to ' + quarterOf(hl.date) + '.');
    var bp = obs(d.fred, 'COBPPRIV');
    if (bp.length >= 24) {
      var sum = function (a) { return a.reduce(function (t, o) { return t + (+o.value); }, 0); }, l12 = sum(bp.slice(-12)), p12 = sum(bp.slice(-24, -12)), byY = {}, peak = null;
      bp.forEach(function (o) { var y = o.date.slice(0, 4); byY[y] = (byY[y] || 0) + (+o.value); });
      Object.keys(byY).forEach(function (y) { if (bp.filter(function (o) { return o.date.slice(0, 4) === y; }).length === 12 && (!peak || byY[y] > byY[peak])) peak = y; });
      state.push('Homes permitted, 12 months to ' + monthOf(bp[bp.length - 1].date) + ': ' + num(l12) + ', ' + pct(change(l12, p12)) + ' on the 12 months before' + (peak ? ' and ' + Math.round((1 - l12 / byY[peak]) * 100) + '% below the ' + peak + ' peak of ' + num(byY[peak]) : '') + '.');
    }
    var act = obs(d.fred, 'ACTLISCOUCO'), cut = obs(d.fred, 'PRIREDCOUCO'), a = act[act.length - 1];
    if (a) {
      var aP = valueAt(act, yearBefore(a.date)), c = valueAt(cut, a.date), cP = valueAt(cut, yearBefore(a.date));
      if (aP) state.push('Homes for sale, ' + monthOf(a.date) + ': ' + num(+a.value) + ' listings, ' + pct(change(+a.value, aP)) + ' on a year earlier.');
      if (c != null && cP != null && aP) state.push('Listings with a price cut, ' + monthOf(a.date) + ': ' + Math.round(c / a.value * 100) + '%, against ' + Math.round(cP / aP * 100) + '% a year earlier.');
    }
    // Tax credit homes by award year (LI_UNITS by AwardYear), the live timeline chart.
    var byYear = {}; d.lihtc.features.forEach(function (f) { var p = f.properties, y = p.AwardYear || p.YR_ALLOC; if (y) byYear[y] = (byYear[y] || 0) + (p.LI_UNITS || 0); });
    var yrs = Object.keys(byYear).map(Number).sort();
    // The affordability ratios and the market health score, from the live modules themselves.
    var AM = engine('js/affordability-metrics-panel.js', 'AffordabilityMetrics'), MH = engine('js/market-health-composite.js', 'MarketHealthComposite');
    var amReady = AM ? startEngine(AM) : failed('js/affordability-metrics-panel.js') ? 'failed' : null, mhReady = MH ? startEngine(MH) : failed('js/market-health-composite.js') ? 'failed' : null;
    var fipsOf = {}; d.hud.counties.forEach(function (c) { fipsOf[cname(c.county_name)] = c.fips; });
    var affRows = null, rate = null;
    if (amReady === true) {
      affRows = Object.keys(ind.counties).map(function (n) {
        var r = AM.compute(ind.counties[n], 1750, { homeValue: d.cascade.counties[fipsOf[n]], geographyLevel: 'county' });
        if (r) rate = r.mortgage_rate;
        return r && r.home_price ? { county: n, home: r.home_price, hhi: r.median_hhi, pi: r.price_to_income, pr: r.price_to_rent, aff: r.affordability_rate_pct } : null;
      }).filter(Boolean);
    }
    var mhRows = mhReady === true ? MH.computeAll().map(function (c) { return { county: c.name, score: c.composite, job: c.jobGrowth, pop: c.popGrowth, un: c.unempRate, orig: c.origVolume, den: c.denialRate == null ? null : c.denialRate * 100 }; }) : null;
    var waitFor = function (what) { return '<p role="status" class="note">Loading the live ' + esc(what) + '…</p>'; };
    var OF = global.OwnershipFinance && global.OwnershipFinance.MORTGAGE_RATE;
    return sec('concessions', 'Multifamily concessions analysis', '<p>How much landlords are giving away to fill apartments, from the Apartment Association of Metro Denver’s quarterly report.</p>' +
        sec('vac-con', 'Vacancy and concessions, ' + av.replace('-', ' '), '<p>Metro Denver stabilized apartment vacancy was ' + plain(am.stabilized_vacancy_pct) + ' in ' + esc(av.replace('-', ' ')) + ', against ' + plain(am.stabilized_vacancy_prior_quarter_pct) + ' the quarter before and ' + plain(am.stabilized_vacancy_year_ago_pct) + ' a year earlier. Concessions averaged ' + money(am.average_concession) + ' a month (' + plain(am.concession_pct_of_gross_rent) + ' of gross rent), against ' + money(am.average_concession_prior_quarter) + ' the quarter before. Effective rents (gross rent net of concessions) were ' + esc(pct(am.effective_rent_yoy_pct)) + ' year over year.</p>' +
          '<p><strong>Impact:</strong> ' + esc(STATIC.concessionImpact) + '</p>' +
          UI.table('dd-aamd', 'Stabilized vacancy and average rent by county, ' + av, [{ key: 'c', label: 'County' }, { key: 'v', label: 'Stabilized vacancy', num: true, fmt: plain }, { key: 'r', label: 'Average rent', num: true, fmt: money }],
            Object.keys(d.aamd.counties).map(function (k) { return { c: k, v: d.aamd.counties[k].stabilized_vacancy_pct, r: d.aamd.counties[k].average_rent }; }), { noun: 'counties', placeholder: 'County' }) +
          src(d.aamd.meta.source + ' (' + d.aamd.meta.capture + ')', d.aamd.meta.source_landing_url, av + ', checked ' + day(d.aamd.meta.last_verified)), 3) +
        sec('con-trend', 'Denver metro concession trends', Viz.timeLines({ title: 'Average monthly concession, Denver metro, ' + STATIC.concessionTrend.years[0] + ' to ' + STATIC.concessionTrend.years[3], answer: 'Concessions grew from $' + STATIC.concessionTrend.values[0] + ' to $' + STATIC.concessionTrend.values[3] + ' a month.',
          series: [{ label: 'Average concession', color: C.homes || 'var(--pine)', points: STATIC.concessionTrend.years.map(function (y, i) { return [y, STATIC.concessionTrend.values[i]]; }) }], fmt: function (v) { return '$' + Math.round(v); }, source: ext('https://www.cbre.com/insights/books/us-real-estate-market-outlook-2025/multifamily', 'CBRE Multifamily Outlook 2025') }) +
          staticTag('Typed in by hand, not read from a data file. The original chart names the AAMD Q4 2025 series and CBRE Multifamily Outlook 2025 as its sources; neither is confirmed here.'), 3) +
        sec('con-class', 'Concessions by property class', UI.bars('Average monthly concession by building age, Q4 2025', 'Denver metro', STATIC.concessionClass.map(function (r) { return [r[0] + ' · ' + r[2], r[1]]; }), money, 'homes') +
          staticTag('Q4 2025 averages typed in by hand, citing AAMD Q4 2025. The current AAMD quarter above has no class split.'), 3) +
        sec('con-state', 'Statewide concession comparison', UI.table('dd-con-s', 'Concessions by Colorado market, Q4 2025', [{ key: 0, label: 'Market' }, { key: 1, label: 'Average concession' }, { key: 2, label: '% of gross rent' }, { key: 3, label: 'Free weeks equivalent' }, { key: 4, label: 'Primary driver' }],
          STATIC.concessionMarkets.map(function (r) { return { 0: r[0], 1: r[1], 2: r[2], 3: r[3], 4: r[4] }; }), { noun: 'markets', placeholder: 'Market' }) +
          staticTag('Typed in by hand, citing AAMD / Apartment Insights Q4 2025, to be refreshed when AAMD publishes.'), 3)) +
      sec('foreclosure', 'Foreclosure and distress analysis', '<p>Whether owners are falling behind on mortgages, statewide, from FHFA’s National Mortgage Database.</p>' +
        sec('fc-process', 'Colorado mortgage foreclosure process', Viz.timeLines({ title: 'Share of active Colorado mortgages, by quarter', answer: fs.latest_foreclosure_process_pct + '% in foreclosure, bankruptcy or deed-in-lieu in ' + fs.latest_period + '; ' + fs.latest_serious_delinquency_pct + '% 90+ days late.',
          series: [{ label: 'Foreclosure, bankruptcy or deed-in-lieu', color: C.rust || 'var(--rust)', points: fcLine('foreclosure_process_pct') }, { label: '90+ days delinquent', color: C.homes || 'var(--pine)', points: fcLine('serious_delinquency_pct') }, { label: '30–89 days delinquent', color: 'var(--c-blue)', dash: true, points: fcLine('early_delinquency_pct') }],
          fmt: function (v) { return (+v).toFixed(1) + '%'; }, source: ext(fc.meta.source_landing_url, fc.meta.source) + ', data through ' + esc(fc.meta.data_through) + ', checked ' + esc(day(fc.meta.last_verified)) }) +
          src(fc.meta.source + ', data through ' + fc.meta.data_through, fc.meta.source_landing_url, 'last verified ' + day(fc.meta.last_verified) + ', review by ' + day(fc.meta.review_by)), 3) +
        sec('fc-risk', 'Foreclosure risk assessment', kpis([
          { label: 'Overall risk level', value: /low/i.test(fs.risk_label) ? 'Low' : fs.risk_label, detail: fs.risk_label + ' through ' + fs.latest_period + '.', src: 'FHFA NMDB', href: fc.meta.source_landing_url },
          { label: 'Foreclosure process', value: fs.latest_foreclosure_process_pct + '%', detail: 'Of active Colorado mortgages in foreclosure, bankruptcy or deed-in-lieu, ' + fs.latest_period, src: 'FHFA NMDB', href: fc.meta.source_landing_url },
          { label: 'Employment', value: un == null ? null : un.toFixed(1) + '%', detail: 'Unemployment, the average of the 64 county rates (BLS LAUS, 2025 annual average)', src: 'BLS LAUS via co-county-economic-indicators.json, ' + ind.updated, href: 'https://www.bls.gov/lau/' },
          { label: 'Lead indicator', value: fs.latest_serious_delinquency_pct + '%', detail: 'Of active Colorado mortgages 90+ days delinquent, ' + fs.latest_period, src: 'FHFA NMDB', href: fc.meta.source_landing_url }
        ]), 3) +
        sec('fc-signal', 'Statewide signal: low foreclosure-process share', '<p>FHFA NMDB statewide mortgage-performance data show ' + fs.latest_foreclosure_process_pct + '% of active Colorado mortgages in foreclosure, bankruptcy or deed-in-lieu in ' + fs.latest_period + ', against a ' + fs.peak_foreclosure_process_pct + '% Colorado peak in ' + fs.peak_foreclosure_process_period + '. ' + esc(fs.interpretation) + '</p><p class="note">Method: ' + esc(fc.meta.methodology) + '</p>', 3)) +
      sec('confidence', 'Consumer confidence and market sentiment', '<p>How builders and buyers feel about the market.</p>' +
        sec('hmi', 'Colorado housing market confidence', '<p>' + esc(STATIC.nahb[0]) + '</p><p>' + esc(STATIC.nahb[1]) + '</p><p>' + ext('https://www.nahb.org/news-and-economics/housing-economics/indices/housing-market-index', 'Read the latest release: NAHB Housing Market Index') + '</p>' +
          staticTag('Builder and buyer sentiment: the NAHB index has no free public feed, so this is an explainer, not a reading.'), 3) +
        sec('dynamics', 'Market dynamics shift', '<p>Four Colorado metros, 2024 against the latest release, then statewide readings. Columns marked “dated” are kept for comparison and do not change.</p>' +
          UI.table('dd-metro', 'Prices and time on market, by metro', [
            { key: 'metro', label: 'Metro' }, { key: 'dated', label: 'Prices, Q4 2023 to Q4 2024 (dated)', num: true, fmt: pct },
            { key: 'latest', label: lastH ? 'Prices, ' + quarterOf(yearBefore(lastH)) + ' to ' + quarterOf(lastH) : 'Prices, latest year', num: true, fmt: pct },
            { key: 'dec24', label: 'Days on market, Dec 2024 (dated)', num: true, fmt: num },
            { key: 'now', label: lastD ? 'Days on market, ' + monthOf(lastD) : 'Days on market, latest', num: true, fmt: function (v, r) { return num(v) + (r.prev != null ? ' (' + num(r.prev) + ' a year earlier)' : ''); } }
          ], metroRows, { noun: 'metros', placeholder: 'Metro' }) +
          '<p><strong>Denver rents, all renters (BLS):</strong> ' + esc(pct(r24)) + ' in 2024 (dated)' + (rl && rNow != null ? '; ' + esc(pct(rNow)) + ' in ' + rl.date.slice(0, 4) : '') + ', annual average against the year before. BLS publishes this index for the Denver area only.</p>' +
          '<h4>Latest statewide readings</h4>' + list(state.map(esc)) +
          src('FHFA all-transactions house price index, Realtor.com days on market and listings, Census permits and BLS CPI rent, via FRED', 'https://fred.stlouisfed.org/', 'FRED file updated ' + day(d.fred.updated)), 3) +
        sec('lihtc-alloc', 'LIHTC historical allocations (' + yrs[0] + '–' + yrs[yrs.length - 1] + ')', '<p>Low-income tax credit homes by the year CHFA awarded the credits, not the year they opened.</p>' +
          UI.bars('Low-income homes awarded each year', 'CHFA award year', yrs.slice().reverse().map(function (y) { return [String(y), byYear[y]]; }), num, 'homes') +
          src('CHFA LIHTC feed (LI_UNITS by AwardYear)', 'https://www.chfainfo.com/rental-housing/housing-credit', 'fetched ' + day(d.lihtc.fetchedAt)), 3)) +
      sec('aff-metrics', 'Affordability metrics: per-county ratios', '<p>Three standard affordability ratios per county. Price to income: healthy at 3 or under, stretched over 4.5. Price to rent: 15 or under favors buying, over 20 favors renting. Affordability rate: an estimate of households who can afford the median home at a ' + (rate ? rate.toFixed(2) + '%' : 'current') + ' mortgage rate' + (OF && OF.source ? ' (' + esc(OF.source.label || OF.source.name || OF.source) + ')' : '') + ', with housing costs at 30% of income.</p>' +
        (affRows ? UI.table('dd-aff', 'Affordability ratios by county, least affordable first', [
          { key: 'county', label: 'County' }, { key: 'home', label: 'Median home', num: true, fmt: money, tip: 'County values use the modeled ACS/FHFA cascade, with ACS DP04 as fallback' },
          { key: 'hhi', label: 'Median household income', num: true, fmt: money }, { key: 'pi', label: 'Price to income', num: true, fmt: function (v) { return v.toFixed(2); } },
          { key: 'pr', label: 'Price to rent', num: true, fmt: function (v) { return v.toFixed(1); }, tip: 'Uses one statewide rent of $1,750 a month for every county' }, { key: 'aff', label: 'Affordability rate', num: true, fmt: function (v) { return Math.round(v) + '%'; } }
        ], affRows.sort(function (x, y) { return y.pi - x.pi; }), { noun: 'counties', placeholder: 'County' }) : amReady === 'failed' ? '<p class="callout">The affordability module did not load.</p>' : waitFor('affordability ratios')) +
        '<p class="note">Price to rent uses one statewide rent ($1,750 a month) for every county, until county rents are wired in.</p>' +
        src('Home values: COHO home-value cascade (Zillow ZHVI, ACS DP04 and FHFA); income: ' + ind.source, 'https://www.huduser.gov/portal/datasets/il.html', 'indicators ' + ind.updated + ', home values ' + day(d.cascade.meta.generated_at))) +
      sec('health', 'Market health composite: 0–100 per county', '<p>One score per county blending five signals with equal weight: employed residents (5-year change), population growth (5 years), unemployment (lower scores higher), mortgage originations per 1,000 households and the mortgage denial rate (lower scores higher). 70 and up is strong, 50 to 69 moderate, under 50 soft. It reads the market, not housing need.</p>' +
        (mhRows ? UI.table('dd-mh', 'Market health composite by county, strongest first', [
          { key: 'county', label: 'County' }, { key: 'score', label: 'Composite', num: true }, { key: 'job', label: 'Jobs, 5 years', num: true, fmt: function (v) { return plain(v); } },
          { key: 'pop', label: 'Population, 5 years', num: true, fmt: function (v) { return plain(v); } }, { key: 'un', label: 'Unemployment', num: true, fmt: function (v) { return plain(v); } },
          { key: 'orig', label: 'Originations', num: true, fmt: num, tip: 'Annual HMDA mortgage originations; the score uses them per 1,000 households' }, { key: 'den', label: 'Denial rate', num: true, fmt: function (v) { return plain(v); } }
        ], mhRows, { noun: 'counties', placeholder: 'County' }) : mhReady === 'failed' ? '<p class="callout">The market health module did not load.</p>' : waitFor('market health scores')) +
        src('BLS LAUS, ACS 5-year and CFPB HMDA, blended by COHO', 'https://ffiec.cfpb.gov/data-browser/', 'indicators ' + ind.updated));
  }

  // ---------- 4. Colorado snapshot ----------
  var SNAPSHOT_SOURCES = [
    ['https://www.huduser.gov/portal/sadda/sadda_qct.html', 'HUD QCT/DDA Designations', '2026 DDA and QCT designations (effective January 1, 2026); Federal Register notice (September 30, 2025)'],
    ['https://www.novoco.com/resource-centers/affordable-housing-tax-credits/qct-dda-mapping-tool', 'Novogradac QCT/DDA Mapping Tool', 'Interactive mapping of qualified census tracts and difficult development areas'],
    ['https://www.huduser.gov/portal/datasets/il.html', 'HUD Income Limits', 'FY2026 county income limits'],
    ['https://www.huduser.gov/portal/datasets/lihtc.html', 'HUD LIHTC Dataset', 'Project-level allocation data (query tool: huduser.gov/lihtc)'],
    ['https://www.chfainfo.com/arh/lihtc', 'CHFA', 'Colorado Housing and Finance Authority LIHTC program data and priorities'],
    ['https://cdola.colorado.gov/prop123', 'DOLA Proposition 123', 'Local government affordable housing commitment data'],
    ['https://www.census.gov/programs-surveys/acs/', 'ACS (American Community Survey)', 'Renter household income distribution (B25118), all-tenure household income (B19001), gross rent by unit (B25063)'],
    ['https://fred.stlouisfed.org', 'Federal Reserve (FRED)', 'Economic indicators: vacancy rates, housing starts, employment'],
    ['https://coloradorealtors.com/market-trends/', 'Colorado Association of REALTORS (CAR)', '2025 Market Trends Report, concessions data, foreclosure data']
  ];
  function snapshot(d) {
    var co = d.alloc.states.CO, am = d.aamd.metro, nov = d.nov.pricing, coP = nov.by_state.CO, fs = d.fc.summary, un = unemploymentAvg(d.ind);
    var scen = literal('js/policy-simulator.js', 'SCENARIOS');
    var sims = scen.data ? scen.data.map(function (s) {
      // The live module's own derived figures (enrichScenario in js/policy-simulator.js): cost per home, and its return.
      return { label: s.label, description: s.description, units: s.unitsProduced, cost: s.totalPublicCostM, per: Math.round(s.totalPublicCostM * 1e6 / s.unitsProduced),
        roi: +(((s.taxRevenueM + s.totalPublicCostM * (s.economicMultiplier - 1)) / s.totalPublicCostM) * 100).toFixed(1), hh: s.householdsServed, ami: s.avgAmiFocus, rural: s.ruralShare };
    }) : null;
    var pj = d.p123.jurisdictions, pc = pj.filter(function (j) { return j.kind === 'county'; }).length;
    var car = d.car, cs = car.statewide;
    var hm = d.hmdaState, yrs = Object.keys(hm.years).sort(), y = yrs[yrs.length - 1], yp = yrs[yrs.length - 2], H = hm.years[y], HP = hm.years[yp];
    var top = Object.keys(d.hmdaCounty.counties).map(function (k) { var c = d.hmdaCounty.counties[k], r = c.years[y]; return r ? { county: c.name, orig: r.originations, vol: r.origination_volume_usd / 1e6, den: r.denial_rate * 100, mf: r.multifamily && r.multifamily.originations } : null; })
      .filter(Boolean).sort(function (a, b) { return b.orig - a.orig; }).slice(0, 10);
    return sec('snapshot', 'Colorado snapshot', '<p>Colorado’s credit ceiling, credit per resident, vacancy, credit pricing, employment and foreclosure risk. Each card names its source.</p>' +
        sec('key-metrics', 'Key Colorado metrics', kpis([
          { label: 'Colorado 9% credit ceiling (' + d.alloc.year + ')', value: '$' + (co.allocation / 1e6).toFixed(1) + 'M', detail: 'Yearly credit, before carryforward and returns', src: 'IRS Notice 2026-22', href: d.alloc.source.populationUrl },
          { label: 'Federal credit per resident (' + d.alloc.year + ')', value: '$' + co.perCapita.toFixed(2), detail: co.basis === 'per-capita' ? 'The per-capita amount, not the small-state minimum' : co.basis, src: 'IRS Rev. Proc. 2025-32', href: d.alloc.source.url },
          { label: 'Multifamily vacancy rate', value: plain(am.stabilized_vacancy_pct), detail: 'Metro Denver, ' + d.aamd.meta.vintage, src: 'AAMD', href: d.aamd.meta.source_landing_url },
          { label: 'Credit pricing (Colorado)', value: '$' + coP.median_all_credits.toFixed(2), detail: 'Median, all credit types · 9% market reference $' + nov.national_avg.credit_9pct.toFixed(2), src: 'Novogradac ' + d.nov.meta.vintage, href: d.nov.meta.source_url },
          { label: 'Unemployment rate', value: un == null ? null : un.toFixed(1) + '%', detail: 'Average of the county rates, BLS LAUS 2025', src: 'BLS LAUS', href: 'https://www.bls.gov/lau/' },
          { label: 'Foreclosure risk', value: /low/i.test(fs.risk_label) ? 'Low' : fs.risk_label, detail: fs.latest_foreclosure_process_pct + '% in the foreclosure process, ' + fs.latest_period, src: 'FHFA NMDB', href: d.fc.meta.source_landing_url }
        ]), 3) +
        sec('snap-sources', 'Data sources and methodology', list(SNAPSHOT_SOURCES.map(function (s) { return ext(s[0], s[1]) + ' — ' + esc(s[2]); })) + '<p class="note"><strong>Disclaimer:</strong> ' + esc(STATIC.disclaimer) + '</p>', 3)) +
      sec('simulator', 'LIHTC policy simulator', '<p>Five Colorado tax credit policy scenarios side by side. They are modelled estimates based on historical program data and policy analysis: illustrative, for comparing policies, not forecasts.</p>' +
        (scen.error ? '<p class="callout">' + esc(scen.error) + '</p>' : !sims ? '<p role="status" class="note">Loading the scenarios…</p>' :
          '<div class="dd-scen">' + sims.map(function (s) {
            return '<div class="dd-scen-card"><p class="lever-title">' + esc(s.label) + '</p><p class="note">' + esc(s.description) + '</p><dl class="dd-dl"><dt>Homes produced</dt><dd>' + num(s.units) + '</dd><dt>Total public cost</dt><dd>$' + num(s.cost) + 'M</dd><dt>Cost per home</dt><dd>' + money(s.per) + '</dd><dt>Return</dt><dd>' + s.roi + '%</dd><dt>Households served</dt><dd>' + num(s.hh) + '</dd><dt>Rural share</dt><dd>' + s.rural + '%</dd><dt>AMI focus</dt><dd>' + s.ami + '%</dd></dl></div>';
          }).join('') + '</div>' +
          sec('sim-visual', 'Visual comparison', '<div class="chart-pair">' + UI.bars('Homes produced', 'By scenario', sims.map(function (s) { return [s.label, s.units]; }), num, 'homes') +
            UI.bars('Cost per home', 'Lower is cheaper', sims.map(function (s) { return [s.label, s.per]; }), money, 'households') + '</div>' +
            UI.bars('Return on public cost', 'Tax revenue plus the construction multiplier, over cost', sims.map(function (s) { return [s.label, s.roi]; }), function (v) { return v + '%'; }, 'homes') +
            '<p class="note">Method: unit and cost projections are modelled from CHFA annual reports, the HUD LIHTC database, Urban Institute research and Colorado OEDIT fiscal notes. Return counts direct tax revenue, a construction employment multiplier (IMPLAN) and ongoing property tax. All figures are illustrative estimates.</p>', 3)) +
        staticTag('The scenario figures are typed in by hand, with no data file or dated source behind them. The per-capita scenario says Colorado’s allocation is $2.75 per resident; the 2026 IRS figure above is $' + co.perCapita.toFixed(2) + '. Treat these as unconfirmed.')) +
      sec('prop123', 'Proposition 123: local government commitments', '<p>' + num(pj.length) + ' jurisdictions (' + pc + ' counties, ' + (pj.length - pc) + ' municipalities) have filed a local government affordable housing commitment with DOLA. ' + num(d.p123.commitment_met_count) + ' are listed as having met it, and ' + num(d.p123.fast_track_count) + ' have adopted a fast-track approval process.</p>' +
        fold('Every jurisdiction and its commitment', num(pj.length) + ' rows, sortable and searchable', UI.table('dd-p123', 'Proposition 123 commitment filings', [
          { key: 'name', label: 'Jurisdiction' }, { key: 'type', label: 'Type' }, { key: 'status', label: 'Status', tip: 'Committed: filed a commitment. Commitment Met: DOLA lists it as fully compliant.' }, { key: 'filing_date', label: 'Filed' },
          { key: 'proposed_units', label: 'Proposed homes', num: true, fmt: num }, { key: 'required', label: 'Homes required (DOLA)', num: true, fmt: function (v) { return v == null ? '—' : num(v); }, tip: 'DOLA\u2019s count of the homes the commitment required, where it has verified the commitment as met' }, { key: 'fast', label: 'Fast track', tip: 'Adopted an expedited approval process (DOLA fast-track list)' }
        ], pj.map(function (j) { return { name: j.name, type: j.type, status: j.status + (j.compliance_verified && j.compliance_verified.unit_commitment ? ', verified ' + j.compliance_verified.unit_commitment : ''), filing_date: j.filing_date, proposed_units: j.proposed_units, required: j.compliance_verified && j.compliance_verified.required_units_met != null ? j.compliance_verified.required_units_met : null, fast: j.fast_track ? 'Yes' + (j.fast_track_adopted ? ', ' + j.fast_track_adopted : '') : '' }; }), { noun: 'jurisdictions', placeholder: 'Town, county or status' })) +
        '<p><a href="#/places/incentives">Each place’s incentives and commitment →</a></p>' +
        src('DOLA commitment filings and fast-track list', d.p123.source_url, 'updated ' + day(d.p123.updated)), 3) +
      sec('car', 'Colorado market conditions (CAR)', '<p>Statewide figures from the Colorado Association of REALTORS monthly report for ' + esc(monthOf(car.month)) + '. ' + (car.estimated ? 'Listings and days on market are estimated from CAR’s county reports (' + esc(car.estimate_basis) + '), not figures CAR published for the state. ' : '') + 'Prices stay blank until CAR publishes them.</p>' +
        kpis([
          { label: 'Median sale price', value: cs.median_sale_price == null ? 'Not yet published by CAR' : money(cs.median_sale_price), src: 'CAR', href: car.source_url },
          { label: 'Active listings', value: num(cs.active_listings), detail: car.estimated ? 'Estimated' : '', src: 'CAR', href: car.source_url },
          { label: 'Median days on market', value: cs.median_days_on_market + ' days', detail: car.estimated ? 'Estimated' : '', src: 'CAR', href: car.source_url },
          { label: 'Months of supply', value: String(cs.months_of_supply), src: 'CAR', href: car.source_url }
        ]) + src(car.source, car.source_url, monthOf(car.month) + ', generated ' + day(car.generated_at))) +
      sec('hmda', 'Mortgage credit access (HMDA, CFPB)', '<p>Origination volume, denial rates and multifamily lending from the federal Home Mortgage Disclosure Act data. A rising denial rate or falling origination count signals tighter credit, which comes before slower multifamily starts. Latest: ' + y + ' (years ' + yrs[0] + '–' + y + ').</p>' +
        kpis([
          { label: 'Originations (Colorado, ' + y + ')', value: num(H.originations), detail: pct(change(H.originations, HP.originations)) + ' on ' + yp, src: 'CFPB HMDA', href: 'https://ffiec.cfpb.gov/data-browser/' },
          { label: 'Denial rate', value: plain(H.denial_rate * 100), detail: (H.denial_rate - HP.denial_rate >= 0 ? '+' : '−') + Math.abs((H.denial_rate - HP.denial_rate) * 100).toFixed(1) + ' points on ' + yp, src: 'CFPB HMDA', href: 'https://ffiec.cfpb.gov/data-browser/' },
          { label: 'Mean loan amount', value: money(H.mean_loan_amount_usd), detail: pct(change(H.mean_loan_amount_usd, HP.mean_loan_amount_usd)) + ' on ' + yp, src: 'CFPB HMDA', href: 'https://ffiec.cfpb.gov/data-browser/' },
          { label: 'Multifamily originations', value: num(H.multifamily.originations), detail: pct(change(H.multifamily.originations, HP.multifamily.originations)) + ' on ' + yp + ' · closest to tax credit lending', src: 'CFPB HMDA', href: 'https://ffiec.cfpb.gov/data-browser/' }
        ]) +
        sec('hmda-top', 'Top 10 counties by origination volume (latest year)', UI.table('dd-hmda', 'Mortgage originations by county, ' + y, [
          { key: 'county', label: 'County' }, { key: 'orig', label: 'Originations', num: true, fmt: num }, { key: 'vol', label: 'Volume ($M)', num: true, fmt: num },
          { key: 'den', label: 'Denial rate', num: true, fmt: function (v) { return plain(v); } }, { key: 'mf', label: 'Multifamily loans', num: true, fmt: num, tip: 'Loans secured by buildings of five or more homes' }
        ], top, { noun: 'counties', placeholder: 'County' }) +
          '<p class="note">Denial rate = denials ÷ (originations + approved not accepted + denials). Mean loan amount is total ÷ count. Multifamily = HMDA dwelling category “Multifamily: site-built”.</p>' +
          src('HMDA mortgage lending by county (CFPB HMDA Data Browser API)', 'https://ffiec.cfpb.gov/data-browser/', 'updated ' + day(d.hmdaCounty.meta.generated_at)), 3));
  }

  // ---------- 5. Affordability geography ----------
  // Map kit part 2: both maps use the one teal "more of something" ramp. The traffic-light tract scale and the blue
  // burden ramp are gone (red-green readers could not separate the first; the second broke the one-ramp rule).
  var RATIO_BANDS = [[25, 'var(--map-1)', 'Under 25%'], [30, 'var(--map-2)', '25–29%, near the 30% line'], [50, 'var(--map-4)', '30–49%, cost-burdened'], [Infinity, 'var(--map-5)', '50% or more, severely cost-burdened']];
  var BURDEN_BANDS = [[0.4, 'var(--map-1)', 'Under 40%'], [0.5, 'var(--map-2)', '40–50%'], [0.6, 'var(--map-4)', '50–60%'], [Infinity, 'var(--map-5)', 'Over 60%']];
  function geography(d) {
    var at = {}; d.cent.tracts.forEach(function (c) { at[c.geoid] = c; });
    var counts = RATIO_BANDS.map(function () { return 0; }), dots = [];
    d.tracts.tracts.forEach(function (t) {
      var c = at[t.geoid], rent = t.median_gross_rent, inc = t.median_hh_income;
      if (!c || !rent || !inc || inc <= 0) return;
      var r = rent * 12 / inc * 100, b = 0; while (r >= RATIO_BANDS[b][0]) b++;
      counts[b]++;
      dots.push({ lon: c.lon, lat: c.lat, r: 2.6, opacity: '.95', stroke: '.5', fill: RATIO_BANDS[b][1], label: c.tract_name + ', ' + c.county_name + ' County: rent ' + money(rent) + ' a month, income ' + money(inc) + ' (' + r.toFixed(0) + '%)' });
    });
    var chas = d.chas.counties, burden = {};
    Object.keys(chas).forEach(function (k) { var a = chas[k].renter_hh_by_ami, tr = 0, tb = 0; Object.keys(a).forEach(function (t) { tr += a[t].total || 0; tb += a[t].cost_burdened || 0; }); burden[k] = tr ? tb / tr : null; });
    var bColor = function (v) { if (v == null) return NONE; var i = 0; while (v >= BURDEN_BANDS[i][0]) i++; return BURDEN_BANDS[i][1]; };
    var bk = Object.keys(burden).filter(function (k) { return burden[k] != null; }).sort(function (a, b) { return burden[b] - burden[a]; });
    var half = bk.filter(function (k) { return burden[k] >= 0.5; }).length;
    var burdenTitle = 'In ' + half + ' of ' + bk.length + ' counties, half or more of renters pay over 30% of income; ' + (chas[bk[0]] || {}).name + ' is highest at ' + share(burden[bk[0]]);
    var gap50 = d.gap.counties.slice().sort(function (a, b) { return (a.gap_units_minus_households_le_ami_pct[50] || 0) - (b.gap_units_minus_households_le_ami_pct[50] || 0); }).slice(0, 10)
      .map(function (c) { return { county: c.county_name, gap: c.gap_units_minus_households_le_ami_pct[50], cov: c.coverage_le_ami_pct[50] * 100, fips: c.fips }; });
    var names = {}; d.bounds.features.forEach(function (f) { names[f.properties.GEOID] = f.properties.NAME; });
    return sec('geo', 'Geography of housing affordability', '<p>Where affordability pressure is sharpest, from tract rent burdens to county housing gaps.</p>' +
        sec('ratio-map', 'Affordability ratio map: gross rent as % of income', '<p>Each dot is a Colorado census tract, colored by how much of the median household income the median gross rent takes. Tracts in red spend half or more of their income on housing, a sign of severe stress.</p>' +
          coMap({ features: d.bounds.features, fill: function () { return 'var(--track)'; }, label: function (k) { return names[k] + ' County'; }, kicker: 'Median rent as a share of median income, by tract',
            title: 'In ' + num(counts[2] + counts[3]) + ' of ' + num(dots.length) + ' Colorado tracts, median rent takes 30% or more of median income; in ' + num(counts[3]) + ', half or more',
            note: num(dots.length) + ' tracts with both figures, ACS ' + d.tracts.meta.vintage + ' 5-year. Darker means rent takes more of income.', inset: true, alt: 'Source: ACS ' + d.tracts.meta.vintage + ' 5-year.',
            dots: dots, legend: RATIO_BANDS.map(function (b) { return [b[1], b[2]]; }) }) +
          UI.bars('Tracts in each band', 'Median gross rent × 12 ÷ median household income', RATIO_BANDS.map(function (b, i) { return [b[2], counts[i]]; }), num, 'homes') +
          src(d.tracts.meta.source + ', ' + d.tracts.meta.vintage + ' (B25064, B19013); tract points from TIGER', 'https://data.census.gov/', 'built ' + day(d.tracts.meta.generated)), 3) +
        sec('burden-map', 'Cost burden map: share of renters paying more than 30% of income', '<p>The share of renter households spending more than 30% of income on housing, by county. Darker counties have more cost-burdened renters, and a greater need for affordable homes.</p>' +
          coMap({ features: d.bounds.features, fill: function (k) { return bColor(burden[k]); }, label: function (k) { return names[k] + ' County: ' + (burden[k] == null ? 'not published' : share(burden[k]) + ' of renters cost-burdened'); },
            thin: K.thinSet(d.cdemo, d.bounds.features), kicker: 'Renters paying more than 30% of income, by county', title: burdenTitle, alt: 'Source: HUD CHAS ' + d.chas.meta.vintage + '.',
            legend: BURDEN_BANDS.map(function (b) { var n = Object.keys(burden).filter(function (k) { return burden[k] != null && bColor(burden[k]) === b[1]; }).length; return [b[1], b[2] + ' (' + n + ')']; }).concat([[NONE, 'Not published']]) }) +
          fold('Every county’s share', '64 counties, sortable', UI.table('dd-burden', 'Cost-burdened renter share by county (HUD CHAS ' + d.chas.meta.vintage + ')', [{ key: 'county', label: 'County' }, { key: 'v', label: 'Renters paying 30%+', num: true, fmt: function (v) { return share(v); } }],
            Object.keys(chas).map(function (k) { return { county: chas[k].name, v: burden[k] }; }), { noun: 'counties', placeholder: 'County' })) +
          src('HUD CHAS ' + d.chas.meta.vintage + ' (county level)', d.chas.meta.url, 'built ' + day(d.chas.meta.generated)), 3) +
        sec('gap-top10', 'AMI gap: top 10 counties by unmet affordable housing need', '<p>Counties ranked by the gap between renter households at or below 50% AMI and the homes priced for them. A larger negative number means a larger shortfall.</p>' +
          UI.table('dd-gap10', 'Ten counties with the largest 50% AMI shortfall', [
            { key: 'county', label: 'County', href: function (r) { return '#/place/' + r.fips; } }, { key: 'gap', label: 'Gap (homes)', num: true, fmt: signed, tip: 'Homes priced for 50% AMI minus renter households at or below 50% AMI' },
            { key: 'cov', label: 'Supply coverage', num: true, fmt: function (v) { return plain(v); }, tip: 'Share of income-qualified households for whom a priced-affordable home exists' }
          ], gap50, { noun: 'counties', placeholder: 'County' }) + src('AMI gap by county (COHO Analytics, from Census ACS and HUD income limits)', d.gap.sources[2].url, 'updated ' + day(d.gap.meta.generated_at)), 3) +
        fold('Data sources and methodology', 'Tract, CHAS and AMI gap sources', list([
          '<strong>ACS 5-year tract-level estimates</strong>: American Community Survey (U.S. Census Bureau), ' + esc(d.tracts.meta.vintage) + ' 5-year estimates. Fields used: median gross rent, median household income, cost burden rate. ' + num(d.tracts.tracts.length) + ' Colorado census tracts.',
          '<strong>CHAS data (HUD)</strong>: HUD Comprehensive Housing Affordability Strategy, ' + esc(d.chas.meta.vintage) + ' 5-year estimates. County counts of renter households by AMI tier and cost-burden status.',
          '<strong>AMI gap calculations</strong>: from HUD FY' + d.gap.meta.hud_income_limits_year + ' county income limits and ACS ' + d.gap.meta.acs_year + ' household income distributions. Gap = priced-affordable homes minus households at each AMI threshold.',
          '<strong>County boundaries</strong>: U.S. Census Bureau TIGER/Line county boundary files for Colorado.'
        ])));
  }

  // ---------- 6. Market signals ----------
  function signals(d, params) {
    var county = params.get('sig') || '', cd = county ? d.cdemo.counties[county] : null, demo = cd || d.demo;
    var feats = d.lihtc.features.map(function (f) { return f.properties; }).filter(function (p) { return !county || String(p.CNTY_NAME || '').toLowerCase().indexOf(county.toLowerCase()) > -1; });
    var units = feats.reduce(function (s, p) { return s + (p.N_UNITS || 0); }, 0), li = feats.reduce(function (s, p) { return s + (p.LI_UNITS || 0); }, 0);
    var hh = demo.household_count || demo.households;
    var pj = d.p123.jurisdictions, pjf = county ? pj.filter(function (j) { return j.name.toLowerCase().indexOf(county.toLowerCase()) > -1; }) : pj;
    var inP123 = feats.filter(function (p) { var c = String(p.PROJ_CTY || '').toLowerCase().trim(); return c && pj.some(function (j) { return j.name.toLowerCase().indexOf(c) > -1; }); }).length;
    var bp = d.fred.series.COBPPRIV.observations, lp = bp[bp.length - 1], pp = bp[bp.length - 13];
    var comp = obs(d.fred, 'COMPUTSA'), und = obs(d.fred, 'UNDCONTSA');
    var rentNow = demo.median_gross_rent_current || demo.median_gross_rent, rentPrior = demo.median_gross_rent_prior;
    var ind = county ? d.ind.counties[county] : null, st = d.acsState.data.filter(function (r) { return r.state_fips === '08'; })[0];
    var avg = function (f) { var v = Object.keys(d.ind.counties).map(function (k) { return d.ind.counties[k][f]; }).filter(function (x) { return x != null; }); return v.length ? v.reduce(function (s, x) { return s + x; }, 0) / v.length : null; };
    var econ = ind || { unemployment_rate: avg('unemployment_rate'), job_growth_5yr_pct: avg('job_growth_5yr_pct'), population_growth_5yr_pct: avg('population_growth_5yr_pct'),
      median_home_price: st ? +st.median_home_value : null, median_hh_income: st ? +st.median_household_income : null, affordability_index: st ? st.median_home_value / st.median_household_income : null };
    var band = function (v, cuts, words) { if (v == null) return ''; for (var i = 0; i < cuts.length; i++) if (cuts[i](v)) return words[i]; return words[words.length - 1]; };
    var LBY = engine('js/components/lihtc-by-year.js', 'LihtcByYear');
    var trend = LBY ? LBY.series(d.lihtc.features) : null, trendChart = '';
    if (trend && trend.years.length) {
      var keys = county ? [county] : Object.keys(trend.counties).sort(function (a, b) { var s = function (k) { return trend.counties[k].projects.reduce(function (t, x) { return t + x; }, 0); }; return s(b) - s(a); }).slice(0, 6);
      var palette = ['var(--scatter-1)', 'var(--scatter-2)', 'var(--scatter-3)', 'var(--scatter-4)', 'var(--scatter-5)', 'var(--scatter-6)'];
      trendChart = Viz.timeLines({ title: 'Tax credit projects per year' + (county ? ', ' + county + ' County' : ', the six counties with the most projects'), answer: county ? num(trend.counties[county] ? trend.counties[county].projects.reduce(function (t, x) { return t + x; }, 0) : 0) + ' projects since ' + trend.years[0] + '.' : 'Projects by the year CHFA reserved the credits.',
        series: keys.filter(function (k) { return trend.counties[k]; }).map(function (k, i) { return { label: k, color: palette[i % 6], points: trend.years.map(function (y, j) { return [y, trend.counties[k].projects[j]]; }) }; }), fmt: num,
        note: 'By the year CHFA reserved the credits (YR_ALLOC), not the year a project opened, which CHFA does not publish; projects usually open two to three years later. The latest year is preliminary.', source: '<a href="https://www.chfainfo.com/rental-housing/housing-credit">CHFA HousingTaxCreditProperties</a>' + ', fetched ' + esc(day(d.lihtc.fetchedAt)) });
    }
    var events = d.timeline.events.map(function (e) { return e.date.slice(0, 4) + ': ' + e.title; });
    var names = Object.keys(d.cdemo.counties);
    return '<p>Statewide and county demand, supply, affordable inventory, risk, policy and economic health, from public datasets. Pick a county to narrow the view; supply figures stay statewide or national.</p>' +
      picker('dd-sig-pick', 'sig', 'County or statewide', countyOptions(names, 'Statewide (Colorado)'), county) +
      sec('demand', 'Demand signals', kpis([
          { label: 'Cost-burdened renters (30%+ of income)', value: share(demo.cost_burden_share) }, { label: 'Severely cost-burdened (50%+)', value: share(demo.severe_burden_share) },
          { label: 'Household growth (5 years)', value: demo.household_growth_rate_5yr == null ? null : share(demo.household_growth_rate_5yr), detail: demo.household_growth_rate_5yr == null ? 'Not in the county file' : '' }, { label: 'Overcrowded homes (more than 1 person a room)', value: share(demo.overcrowding_rate) }
        ]) + UI.bars('Renter stress, ' + (county ? county + ' County' : 'Colorado'), 'Share of renter households, and of homes', [['Paying 30%+ of income', demo.cost_burden_share * 100], ['Paying 50%+ of income', demo.severe_burden_share * 100], ['Overcrowded', demo.overcrowding_rate * 100]], function (v) { return v.toFixed(1) + '%'; }, 'households') +
        src('Source: ACS 5-year estimates (Census Bureau, public API): B25070 rent burden, B25014 overcrowding, B11001 households', 'https://data.census.gov/', county ? 'county file updated ' + d.cdemo.updated : 'state file updated ' + d.demo.updated)) +
      sec('supply', 'Supply signals', kpis([
          { label: 'Colorado building permits (monthly)', value: num(+lp.value), detail: monthOf(lp.date) + ', FRED COBPPRIV' }, { label: 'U.S. completions (SAAR)', value: comp.length ? num(+comp[comp.length - 1].value) : null, detail: 'National context, thousands' },
          { label: 'U.S. under construction (SAAR)', value: und.length ? num(+und[und.length - 1].value) : null, detail: 'National context, thousands' }, { label: 'Permits, change on a year earlier', value: pct(change(+lp.value, +pp.value)), detail: monthOf(pp.date) + ' to ' + monthOf(lp.date) }
        ]) + Viz.timeLines({ title: 'Colorado homes permitted each month', answer: num(+lp.value) + ' in ' + monthOf(lp.date) + '.', series: [{ label: 'Homes permitted', color: C.homes || 'var(--pine)', points: bp.slice(-60).map(function (o) { return [new Date(o.date + 'T12:00:00Z'), +o.value]; }) }], fmt: num, source: ext('https://fred.stlouisfed.org/series/COBPPRIV', 'FRED COBPPRIV') + ', FRED file updated ' + esc(day(d.fred.updated)) }) +
        src('Source: Census Building Permits Survey (public), via FRED: COBPPRIV for Colorado; COMPUTSA and UNDCONTSA are national, with no state series', 'https://www.census.gov/construction/bps/', 'FRED file updated ' + day(d.fred.updated))) +
      sec('inventory', 'Affordable inventory', kpis([
          { label: 'LIHTC projects', value: num(feats.length) }, { label: 'LIHTC total homes', value: num(units) }, { label: 'Low-income homes', value: num(li) },
          { label: 'LIHTC homes per 1,000 households', value: hh ? (li / (hh / 1000)).toFixed(1) : null }, { label: 'In Prop 123 jurisdictions', value: num(inP123), detail: 'Projects whose city appears in a committed jurisdiction’s name' }
        ]) + '<p>Showing ' + num(feats.length) + ' tax credit projects with ' + num(li) + ' affordable homes ' + (county ? 'in ' + esc(county) + ' County' : 'statewide') + '.</p>' +
        src('Source: CHFA HousingTaxCreditProperties (public ArcGIS feature service)', 'https://www.chfainfo.com/rental-housing/housing-credit', 'fetched ' + day(d.lihtc.fetchedAt))) +
      sec('risk', 'Risk dashboard', kpis([
          { label: 'Vacancy (proxy)', value: share(demo.vacancy_rate), detail: 'ACS B25004 vacancy rate, all homes' },
          { label: 'Rent trend (proxy)', value: rentNow && rentPrior ? ((rentNow - rentPrior) / rentPrior * 100).toFixed(1) + '% a year' : null, detail: rentNow && rentPrior ? 'Median gross rent, ACS 2020–2024 against 2019–2023' : 'Prior-year rent is not in the county file' },
          { label: 'Tax credit projects per 1,000 households', value: hh ? (feats.length / (hh / 1000)).toFixed(2) : null, detail: 'Every CHFA project in the area, over households' },
          { label: 'Affordability gap', value: demo.affordable_rent_60pct && rentNow ? (demo.affordable_rent_60pct - rentNow >= 0 ? '+' : '−') + money(Math.abs(Math.round(demo.affordable_rent_60pct) - Math.round(rentNow))) + ' a month' : null,
            detail: demo.affordable_rent_60pct ? '60% AMI rent (' + money(demo.affordable_rent_60pct) + ' a month; HUD, bedroom-mix weighted, not a CHFA limit) minus median gross rent. Negative means the median rent is higher.' : '60% AMI affordable rent is not published for this geography' }
        ]) + '<p class="note">Risk indicators are proxies from public data, for screening, not underwriting.</p>') +
      sec('policy', 'Policy landscape', kpis([{ label: 'Prop 123 committed jurisdictions', value: num(pjf.length) }, { label: 'Prop 123 counties', value: num(pjf.filter(function (j) { return /county/i.test(j.kind || j.type); }).length) }, { label: 'Prop 123 municipalities', value: num(pjf.filter(function (j) { return !/county/i.test(j.kind || j.type); }).length) }]) +
        sec('policy-res', 'Key policy resources', list([ext('https://cdola.colorado.gov/commitment-filings', 'DOLA Prop 123: commitment filings'), ext('https://www.huduser.gov/portal/datasets/lihtc.html', 'HUD LIHTC database'), ext('https://www.chfainfo.com/', 'CHFA: Colorado Housing and Finance Authority'),
          ext('https://leg.colorado.gov/bills/sb23-213', 'SB23-213: land use and TOD rezoning'), ext('https://www.census.gov/programs-surveys/acs/', 'Census ACS: American Community Survey')]) + src('Colorado Prop 123 commitments (DOLA)', d.p123.source_url, 'updated ' + day(d.p123.updated)), 3)) +
      sec('econ', 'Economic health', kpis([
          { label: 'Unemployment rate', value: econ.unemployment_rate == null ? null : econ.unemployment_rate.toFixed(1) + '%', detail: band(econ.unemployment_rate, [function (v) { return v < 3.8; }, function (v) { return v <= 5.5; }], ['Low', 'Moderate', 'High']) },
          { label: 'Employed residents, 5-year change', value: pct(econ.job_growth_5yr_pct), detail: band(econ.job_growth_5yr_pct, [function (v) { return v >= 8; }, function (v) { return v >= 2; }], ['Strong', 'Moderate', 'Weak']) },
          { label: 'Affordability index', value: econ.affordability_index == null ? null : econ.affordability_index.toFixed(1) + '×', detail: 'Median home price ÷ median household income · ' + band(econ.affordability_index, [function (v) { return v <= 3; }, function (v) { return v <= 6; }], ['Affordable', 'Stretched', 'Unaffordable']) },
          { label: 'Population growth, 5 years', value: pct(econ.population_growth_5yr_pct), detail: band(econ.population_growth_5yr_pct, [function (v) { return v >= 3; }, function (v) { return v >= 0; }], ['Growing', 'Stable', 'Declining']) },
          { label: 'Median home price', value: money(econ.median_home_price), detail: county ? county + ' County (ACS 2020–2024)' : 'Colorado (ACS ' + (st ? (st.year - 4) + '–' + st.year : '5-year') + ')' },
          { label: 'Median household income', value: money(econ.median_hh_income), detail: county ? county + ' County (ACS 2020–2024)' : 'Colorado (ACS 5-year)' }
        ]) + '<p class="note">' + (county ? '' : 'Statewide unemployment, job and population growth are the averages of the county figures. ') + 'Affordability index = median home price ÷ median household income.</p>' +
        src('Source: BLS LAUS (unemployment and employed residents, counted where people live), ACS 2020–2024 (affordability, population): ' + d.ind.source, 'https://www.bls.gov/lau/', 'data as of ' + d.ind.updated)) +
      sec('lihtc-trend', 'LIHTC historical trend' + (trend && trend.range ? ' (' + trend.range + ')' : ''), (trendChart || (failed('js/components/lihtc-by-year.js') ? missing('The LIHTC trend chart') : trend ? '<p class="note">CHFA’s list has no tax credit projects by award year for ' + (county ? esc(county) : 'Colorado') + '.</p>' : '<p role="status" class="note">Loading the CHFA series…</p>')) +
        '<p class="note">Milestones on the timeline tab: ' + esc(events.join(' · ')) + '.</p>' +
        src('Source: CHFA housing tax credit properties, ArcGIS FeatureServer (public)', 'https://www.chfainfo.com/rental-housing/housing-credit', 'fetched ' + day(d.lihtc.fetchedAt))) +
      sec('site-sel', 'Site selection tool', '<p>Ready to test a specific site? The market check draws a primary market area around it and reads the capture rate, competing projects and QCT/DDA status. For statewide tax credit, Prop 123 and QCT/DDA map layers, see the overview tab and the data map.</p>' +
        '<div class="actions"><a class="button-link" href="#/market">Market check →</a><a class="button-link secondary" href="#/data/map?layer=qct">Data map</a></div>') +
      sec('sig-sources', 'Data sources', list([ext('https://data.census.gov/', 'ACS 5-year, Census Bureau (B25070, B25014, B11001)'), ext('https://www.huduser.gov/portal/datasets/lihtc.html', 'HUD LIHTC tax credit database'), ext('https://www.chfainfo.com/', 'CHFA, Colorado Housing and Finance Authority'),
        ext('https://fred.stlouisfed.org/', 'FRED economic series and housing starts'), ext('https://www.bls.gov/lau/', 'BLS LAUS unemployment and employed residents'), ext('https://cdola.colorado.gov/commitment-filings', 'Prop 123: DOLA commitment filings'), ext('https://lehd.ces.census.gov/', 'LEHD / LODES commuting flows')]) +
        '<p><a href="#/data/sources">Every data source →</a> · <a href="#/data/status">Data freshness →</a></p>');
  }

  // ---------- 7. Construction labor and costs ----------
  function construction(d) {
    var cc = d.cc, m = cc.monthly, sm = cc.summary;
    var card = function (id, label, fmt) {
      var s = m[id]; if (!s || !s.latest) return { label: label, value: null, detail: s && s.unavailableReason };
      var y = s.yoy, dv = y ? (y.basis === 'pts' ? (y.value >= 0 ? '+' : '−') + Math.abs(y.value).toFixed(1) + ' pts' : pct(y.value)) : null;
      return { label: label, value: fmt(s.latest.value), detail: (dv ? dv + ' on a year earlier · ' : '') + monthOf(s.latest.period) + (s.latest.preliminary ? ' (preliminary)' : '') };
    };
    var wage = m.SMU08000002000000003, wobs = wage.observations.slice(-60);
    var o = cc.oews, areaName = {}; o.areas.forEach(function (a) { areaName[a.code] = a.name; });
    var tradeRows = o.occupations.map(function (oc) {
      var r = { trade: oc.title, soc: oc.soc };
      o.areas.forEach(function (a) { var x = o.rows.filter(function (w) { return w.area === a.code && w.soc === oc.soc; })[0]; r[a.code] = x ? x.hourlyMean : null; });
      var stx = o.rows.filter(function (w) { return w.area === '0800000' && w.soc === oc.soc; })[0]; r.chg = stx ? stx.changePct : null; r.chgWhy = stx && stx.changeUnavailableReason;
      return r;
    });
    var mats = cc.materials.series, fred = d.fred;
    var latestP = mats[0].latestPeriod, base = (+latestP.slice(0, 4) - 5) + latestP.slice(4);
    var idxLines = mats.slice(0, 5).map(function (s, i) {
      var ob = obs(fred, s.id), b = ob.filter(function (x) { return x.date.slice(0, 7) === base; })[0];
      var lb = s.label.replace(/^PPI: /, '').replace(/\s*\(.*$/, ''); if (lb.length > 30) lb = lb.slice(0, 30).replace(/\s+\S*$/, '') + '…';
      return b ? { label: lb, color: ['var(--pine)', 'var(--c-blue)', 'var(--rust)', 'var(--c-purple)', 'var(--c-green)'][i], points: ob.filter(function (x) { return x.date.slice(0, 7) >= base; }).map(function (x) { return [new Date(x.date + 'T12:00:00Z'), +x.value / +b.value * 100]; }) } : null;
    }).filter(Boolean);
    var hist = cc.history.slice(-12).reverse();
    var w = function (v) { return v == null ? null : '$' + (+v).toFixed(2); };
    return sec('cc', 'Construction labor and costs in Colorado', '<p>What it costs to build in Colorado right now. ' + esc(sm.text) + ' Updated monthly after the BLS state jobs release; this file was refreshed ' + esc(day(cc.generatedAt)) + '.</p>') +
      sec('cc-labor', 'Labor: wage rates and availability', kpis([
          card('SMU08000002000000003', 'Colorado construction hourly earnings', function (v) { return '$' + v.toFixed(2); }), card('SMU08000002000000011', 'Colorado construction weekly earnings', function (v) { return money(v); }),
          card('SMU08000002000000001', 'Colorado construction jobs', function (v) { return v.toFixed(1) + 'K'; }), card('LASST080000000000003', 'Colorado unemployment rate', function (v) { return v.toFixed(1) + '%'; }),
          card('JTU230000000000000JOR', 'U.S. construction job openings rate', function (v) { return v.toFixed(1) + '%'; }), card('JTU230000000000000HIR', 'U.S. construction hires rate', function (v) { return v.toFixed(1) + '%'; })
        ]) +
        Viz.timeLines({ title: 'Colorado construction average hourly earnings', answer: '$' + (+wobs[0].value).toFixed(2) + ' in ' + monthOf(wobs[0].period) + ' to $' + (+wobs[wobs.length - 1].value).toFixed(2) + ' in ' + monthOf(wobs[wobs.length - 1].period) + '.', zero: false,
          series: [{ label: 'Hourly earnings', color: C.homes || 'var(--pine)', points: wobs.map(function (x) { return [new Date(x.period + '-15T12:00:00Z'), +x.value]; }) }], fmt: function (v) { return '$' + Math.round(v); }, source: ext('https://www.bls.gov/sae/', 'BLS CES SMU08000002000000003') }) +
        src('Source: BLS State Employment & Earnings (CES), BLS LAUS, BLS JOLTS, BLS OEWS; monthly, latest two months preliminary', 'https://www.bls.gov/sae/', 'refreshed ' + day(cc.generatedAt)) +
        sec('cc-trade', 'Hourly wage by trade, ' + o.referencePeriod, UI.table('dd-trade', 'Mean hourly wage by construction trade, Colorado and its metro areas (BLS OEWS)', [{ key: 'trade', label: 'Trade' }].concat(o.areas.map(function (a) { return { key: a.code, label: a.name.replace(', CO', ''), num: true, fmt: w }; }))
          .concat([{ key: 'chg', label: 'Statewide change', num: true, fmt: pct, tip: 'Change in the statewide mean hourly wage from the prior OEWS year' }]), tradeRows, { noun: 'trades', placeholder: 'Trade' }) + src('BLS Occupational Employment and Wage Statistics (OEWS), ' + o.referencePeriod, 'https://www.bls.gov/oes/', 'refreshed ' + day(cc.generatedAt)) +
          '<p class="note">OEWS mean hourly wages are published once a year for May, so this table changes yearly. ' + esc((tradeRows[0] || {}).chgWhy || '') + ' A dash means BLS suppressed or did not publish the figure.</p>', 3)) +
      sec('cc-mat', 'Materials: construction input prices', kpis(mats.map(function (s) { return { label: s.label, value: pct(s.yoyPct), detail: s.unavailableReason || 'On a year earlier · ' + monthOf(s.latestPeriod) }; })) +
        (idxLines.length ? Viz.timeLines({ title: 'Construction input prices, rebased to ' + monthOf(base) + ' = 100', answer: idxLines.map(function (l) { return l.label + ' ' + l.points[l.points.length - 1][1].toFixed(1); }).join('; ') + '.', zero: false, series: idxLines, fmt: function (v) { return Math.round(v); }, source: ext('https://fred.stlouisfed.org/series/WPUIP231120', 'BLS PPI via FRED') + ', FRED file updated ' + esc(day(d.fred.updated)) }) : '') +
        '<p class="note">Producer price indexes are national. No public price index exists for construction materials in Colorado alone, so these show the direction and size of material cost change, not Colorado price levels.</p>' +
        src('Source: BLS Producer Price Index via FRED (WPUIP231120 and construction-material commodity indexes), monthly', 'https://fred.stlouisfed.org/', 'FRED file updated ' + day(d.fred.updated))) +
      sec('cc-month', 'Month by month', UI.table('dd-cc-hist', 'Year-over-year change in Colorado construction wages, jobs and input prices, latest 12 months', [
          { key: 'period', label: 'Month', fmt: monthOf }, { key: 'laborWageYoyPct', label: 'Colorado construction hourly earnings', num: true, fmt: pct }, { key: 'employmentYoyPct', label: 'Colorado construction jobs', num: true, fmt: pct },
          { key: 'materialsYoyPct', label: 'Construction input prices (national)', num: true, fmt: pct }
        ], hist, { noun: 'months', placeholder: 'Month' }) +
        fold('Every month since ' + monthOf(cc.history[0].period), num(cc.history.length) + ' months', UI.table('dd-cc-all', 'Every month on record', [{ key: 'period', label: 'Month', fmt: monthOf }, { key: 'laborWageYoyPct', label: 'Hourly earnings', num: true, fmt: pct }, { key: 'employmentYoyPct', label: 'Jobs', num: true, fmt: pct }, { key: 'materialsYoyPct', label: 'Input prices', num: true, fmt: pct }], cc.history.slice().reverse(), { noun: 'months', placeholder: 'Month' })) +
        src('Colorado Construction Labor & Costs (BLS CES, LAUS, JOLTS, OEWS + BLS PPI via FRED)', 'https://www.bls.gov/sae/', 'updated ' + day(cc.generatedAt)));
  }

  // ---------- 8. Historical trends ----------
  function history(d, params) {
    var LBY = engine('js/components/lihtc-by-year.js', 'LihtcByYear');
    var PS = LBY && engine('js/lihtc-project-size.js', 'LihtcProjectSize'), HT = LBY && engine('js/historical-trends.js', 'HistoricalTrends');
    if (!LBY || !PS || !HT) return failed('js/components/lihtc-by-year.js') || failed('js/lihtc-project-size.js') || failed('js/historical-trends.js') ? missing('Historical trends') : '<p role="status" class="note">Loading the CHFA history modules…</p>';
    var f = d.lihtc.features, s = LBY.series(f), yrs = s.years, cr = s.credits;
    var awardRows = yrs.map(function (y, i) { return { year: y, n9: cr.nine.projects[i], n4: cr.four.projects[i], no: cr.other.projects[i], u9: cr.nine.units[i], u4: cr.four.units[i], uo: cr.other.units[i] }; }).reverse();
    var cumP = 0, cumU = 0, stock = yrs.map(function (y, i) { cumP += s.totals.projects[i]; cumU += s.totals.units[i] || 0; return { year: y, projects: s.totals.projects[i], units: s.totals.units[i], cp: cumP, cu: cumU }; });
    var last5 = stock.filter(function (r) { return r.year > yrs[yrs.length - 1] - 5; });
    var size = PS.compute(f, LBY);
    var round = HT._internal.summarizeRound(d.round, f);
    var peer = params.get('peer') || '', target = parseInt(params.get('units') || '0', 10) || 0;
    var counties = {}; f.forEach(function (x) { if (x.properties.CNTY_NAME) counties[x.properties.CNTY_NAME] = true; });
    var peers = peer ? f.filter(function (x) { return x.properties.CNTY_NAME === peer; }).map(function (x) { var p = x.properties; return { name: p.PROJECT, city: p.PROJ_CTY, units: p.N_UNITS, li: p.LI_UNITS, year: p.YR_ALLOC, credit: p.CREDIT, from: 'CHFA property feed' }; })
      .concat(HT._internal.bridgeBenchmarkRows(d.round, f, peer).map(function (r) { return { name: r.name, city: r.city, units: r.units, li: r.liUnits, year: r.yrAlloc, credit: r.credit, from: 'CHFA ' + (round && round.name || 'latest round') + ' award report' }; })) : [];
    if (target > 0) peers.sort(function (a, b) { if (a.units == null || b.units == null) return (a.units == null) - (b.units == null); return Math.abs(a.units - target) - Math.abs(b.units - target); });
    else peers.sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
    var med = function (a) { return median(a.filter(function (x) { return x != null; })); };
    return fold('Data quality: ' + (round ? 'both sources current' : 'the CHFA feed') + ' (2 sources)', 'The CHFA property feed and the latest round report', list([
        '<strong>' + esc(round ? 'CHFA ' + round.name + ' award report' : 'Latest CHFA round') + '</strong>: ' + (round ? num(round.developments) + ' developments, ' + num(round.units) + ' homes, announced ' + esc(day(round.announced)) + '. Parsed from CHFA’s published award report; it bridges the months before the live feed carries the round.' : 'not loaded'),
        '<strong>CHFA LIHTC (live)</strong>: ' + num(f.length) + ' Colorado projects, ' + esc(s.range) + ', refreshed weekly from CHFA’s HousingTaxCreditProperties feature service (fetched ' + esc(day(d.lihtc.fetchedAt)) + '). The award year is the year credits were reserved, usually two to three years before a project opens, so the latest rounds are still in construction or lease-up.',
        'Known limits: a history, not a forecast. Application scores and applicant counts are not shown: there is no verified public source for them yet.'
      ])) +
      sec('awards-year', 'Awards per year, by credit type (' + s.range + ')', '<p>Every Colorado tax credit project in CHFA’s live property feed, by the year its credits were reserved. 9% credits are capped and won in CHFA’s scoring round; 4% credits come with tax-exempt bond financing and skip that round, though the bond cap behind them is limited too. 4% deals are typically about twice the size.</p>' +
        Viz.stackedBars({ noData: true, title: 'Projects awarded each year, ' + s.range, rows: awardRows.slice(0, 15).map(function (r) { return [String(r.year), [r.n9, r.n4, r.no]]; }), parts: [['9% competitive', 'var(--pine)'], ['4% with bonds', 'var(--c-blue)'], ['Other or mixed', 'var(--grey)']], end: function (r) { return num(r[1].reduce(function (t, x) { return t + (x || 0); }, 0)) + ' projects'; }, answer: 'The latest 15 years; every year is in the table below.', source: '<a href="https://www.chfainfo.com/rental-housing/housing-credit">CHFA HousingTaxCreditProperties_view</a>' + ', fetched ' + esc(day(d.lihtc.fetchedAt)) }) +
        fold('Show the numbers behind this chart', num(awardRows.length) + ' award years', UI.table('dd-awards', 'Colorado LIHTC awards per year by credit type', [
          { key: 'year', label: 'Award year' }, { key: 'n9', label: '9% projects', num: true }, { key: 'n4', label: '4% projects', num: true }, { key: 'no', label: 'Other', num: true, tip: 'Credit type recorded as neither 9% nor 4%, or as mixed' },
          { key: 'u9', label: '9% homes', num: true, fmt: num }, { key: 'u4', label: '4% homes', num: true, fmt: num }, { key: 'uo', label: 'Other homes', num: true, fmt: num }
        ], awardRows, { noun: 'years', placeholder: 'Year' })) + src('CHFA LIHTC portfolio (CHFA ArcGIS FeatureServer, public)', 'https://www.chfainfo.com/rental-housing/housing-credit', 'fetched ' + day(d.lihtc.fetchedAt))) +
      sec('stock', 'LIHTC stock trajectory (' + s.range + ')', '<p>Homes in Colorado tax credit projects, added up by the year CHFA awarded their credits. The feed does not record when a project opened; recent years include buildings still under construction.</p>' +
        Viz.timeLines({ noData: true, title: 'Cumulative homes in Colorado tax credit projects, by award year', answer: num(cumU) + ' homes in ' + num(cumP) + ' projects through ' + yrs[yrs.length - 1] + '.', series: [{ label: 'Cumulative homes', color: C.homes || 'var(--pine)', points: stock.map(function (r) { return [r.year, r.cu]; }) }], fmt: num, source: '<a href="https://www.chfainfo.com/rental-housing/housing-credit">CHFA feed</a>' + ', fetched ' + esc(day(d.lihtc.fetchedAt)) }) +
        kpis([{ label: 'Total Colorado LIHTC projects', value: num(cumP) }, { label: 'Total LIHTC homes', value: num(cumU) }, { label: 'Years of data', value: s.range }, { label: 'Awarded ' + last5[0].year + '–' + yrs[yrs.length - 1], value: num(last5.reduce(function (t, r) { return t + r.projects; }, 0)) + ' projects', detail: num(last5.reduce(function (t, r) { return t + (r.units || 0); }, 0)) + ' homes' }]) +
        fold('Show the numbers behind this chart', num(stock.length) + ' years', UI.table('dd-stock', 'Colorado LIHTC projects and homes by award year, cumulative', [
          { key: 'year', label: 'Award year' }, { key: 'projects', label: 'Projects', num: true }, { key: 'units', label: 'Homes', num: true, fmt: num }, { key: 'cp', label: 'Cumulative projects', num: true, fmt: num }, { key: 'cu', label: 'Cumulative homes', num: true, fmt: num }
        ], stock.slice().reverse(), { noun: 'years', placeholder: 'Year' }) + src('CHFA LIHTC portfolio (CHFA ArcGIS FeatureServer, public)', 'https://www.chfainfo.com/rental-housing/housing-credit', 'fetched ' + day(d.lihtc.fetchedAt)))) +
      sec('size', 'LIHTC project size (' + size.range + ')', '<p>How big Colorado tax credit projects are. 9% deals are capped by competitive credit, so they stay small; 4% bond deals are sized to carry their bond financing. Use this to check whether a proposed unit count is typical for the credit type and market.</p>' +
        kpis([{ label: 'Median project, all years', value: size.median + ' homes' }, { label: 'Median urban project', value: size.setting.Urban.median + ' homes' }, { label: 'Median rural project', value: size.setting.Rural.median + ' homes' },
          { label: 'Projects of 100+ homes', value: num(size.bands.filter(function (b) { return /100|200/.test(b.label); }).reduce(function (t, b) { return t + b.projects; }, 0)) + ' of ' + num(size.projects) }]) +
        UI.table('dd-size-p', 'Colorado LIHTC project size by award period', [
          { key: 'label', label: 'Award period' }, { key: 'projects', label: 'Projects', num: true }, { key: 'units', label: 'Homes', num: true, fmt: num }, { key: 'median', label: 'Median, all', num: true },
          { key: 'm9', label: 'Median 9% (projects)', num: true, fmt: function (v, r) { return v == null ? '—' : v + ' (' + r.n9 + ')'; } }, { key: 'm4', label: 'Median 4% (projects)', num: true, fmt: function (v, r) { return v == null ? '—' : v + ' (' + r.n4 + ')'; } }
        ], size.periods.slice().reverse().map(function (p) { return { label: p.label, projects: p.projects, units: p.units, median: p.median, m9: p.nine.median, n9: p.nine.projects, m4: p.four.median, n4: p.four.projects }; }), { noun: 'periods', placeholder: 'Period' }) +
        UI.table('dd-size-b', 'Colorado LIHTC projects by size band and credit type', [
          { key: 'label', label: 'Size' }, { key: 'projects', label: 'Projects', num: true }, { key: 'share', label: 'Share of projects', num: true, fmt: function (v) { return Math.round(v) + '%'; } }, { key: 'units', label: 'Homes', num: true, fmt: num },
          { key: 'nine', label: '9%', num: true }, { key: 'four', label: '4%', num: true }, { key: 'other', label: 'Other or mixed', num: true }
        ], size.bands.map(function (b) { return { label: b.label, projects: b.projects, share: b.projects / size.projects * 100, units: b.units, nine: b.nine, four: b.four, other: b.other }; }), { noun: 'bands', placeholder: 'Band' }) + src('CHFA LIHTC portfolio (CHFA ArcGIS FeatureServer, public)', 'https://www.chfainfo.com/rental-housing/housing-credit', 'fetched ' + day(d.lihtc.fetchedAt)) +
        fold('Project size by county (' + size.counties.length + ' counties with LIHTC projects)', 'Average, median and largest project', UI.table('dd-size-c', 'Colorado LIHTC project size by county', [
          { key: 'county', label: 'County' }, { key: 'projects', label: 'Projects', num: true }, { key: 'units', label: 'Homes', num: true, fmt: num }, { key: 'average', label: 'Average', num: true }, { key: 'median', label: 'Median', num: true }, { key: 'largest', label: 'Largest project', num: true }
        ], size.counties, { noun: 'counties', placeholder: 'County' }) + src('CHFA LIHTC portfolio (CHFA ArcGIS FeatureServer, public)', 'https://www.chfainfo.com/rental-housing/housing-credit', 'fetched ' + day(d.lihtc.fetchedAt))) +
        (size.excluded ? '<p class="note">' + size.excluded + ' projects with no award year or unit count are left out, not counted as zero.</p>' : '')) +
      sec('peer', 'Peer project benchmark', '<p>Pick a county, and a target unit count if you have one, to see tax credit projects in the same market, closest in size first (or newest first). Use it to calibrate the AMI mix, sanity-check a unit count, or find operating comparables.</p>' +
        '<div class="dd-pickrow">' + picker('dd-peer-county', 'peer', 'County', [['', 'Select a county…']].concat(Object.keys(counties).sort().map(function (c) { return [c, c]; })), peer) +
        '<form class="search dd-pick" data-dd-units onsubmit="return false"><label for="dd-units">Target unit count (optional)</label><input id="dd-units" type="number" min="0" inputmode="numeric" value="' + (target || '') + '" data-dd-num="units"></form></div>' +
        (peer ? '<p>' + num(peers.length) + ' projects in ' + esc(peer) + ' County; median ' + med(peers.map(function (p) { return p.units; })) + ' homes.</p>' + UI.table('dd-peer-t', 'Tax credit projects in ' + peer + ' County', [
          { key: 'name', label: 'Project' }, { key: 'city', label: 'City' }, { key: 'units', label: 'Homes', num: true, fmt: num }, { key: 'li', label: 'Low-income homes', num: true, fmt: num }, { key: 'year', label: 'Year allocated', num: true }, { key: 'credit', label: 'Credit type' }, { key: 'from', label: 'Record' }
        ], peers, { noun: 'projects', placeholder: 'Project or city' }) : '<p class="note">Select a county to see peer projects.</p>') +
        src('CHFA LIHTC portfolio and the CHFA ' + (round && round.name || 'latest') + ' award report', 'https://www.chfainfo.com/rental-housing/housing-credit', 'fetched ' + day(d.lihtc.fetchedAt)));
  }

  // ---------- 9. Funding sources ----------
  var F_FIELDS = [['what_it_funds', 'What it funds'], ['award_size', 'Award size'], ['rate', 'Rate'], ['term', 'Term'], ['ami_restriction', 'AMI restriction'], ['affordability_period', 'Affordability period'],
    ['eligible_applicants', 'Eligible applicants'], ['eligible_projects', 'Eligible projects'], ['application_cycle', 'Application cycle']];
  var F_STATUS = { open: 'Open', rolling: 'Rolling', annual: 'Annual round', rounds: 'Periodic rounds', closed: 'Closed', watch: 'No round announced', ending: 'Ending', ended: 'Ended' };
  var F_TYPE = { tax_credit: 'Tax credit', bond: 'Tax-exempt bonds', loan: 'Loan', insured_loan: 'Insured loan', deferred_loan: 'Deferred loan', forgivable_loan: 'Forgivable loan', grant: 'Grant', equity: 'Equity', guarantee: 'Guarantee', rental_assistance: 'Rental assistance' };
  var F_COMPARE = [['administrator', 'Administrator'], ['status', 'Round'], ['award_size', 'Award size'], ['rate', 'Rate'], ['term', 'Term'], ['ami_restriction', 'AMI restriction'], ['affordability_period', 'Affordability period'], ['application_cycle', 'Application cycle']];
  function fType(p) { return (Array.isArray(p.funding_type) ? p.funding_type : [p.funding_type]).filter(Boolean).map(function (t) { return F_TYPE[t] || t; }).join(', '); }
  function srcLinks(list) { return (list || []).map(function (s) { return typeof s === 'string' ? ext(s, s.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)) : ext(s.url, s.label || s.url); }).join(' · '); }
  function funding(d, params) {
    var g = d.guide, FF = global.FundingFit, m = g.meta;
    var q = { execution: params.get('fexec') || '', projectType: params.get('ftype') || '', county: params.get('fcounty') || '', openOnly: params.get('fopen') === '1', includeSupport: params.get('fsup') === '1' };
    var picked = (params.get('fcmp') || '').split(',').filter(Boolean).slice(0, 3);
    var byId = {}; g.programs.forEach(function (p) { byId[p.id] = p; });
    var names = {}; d.bounds.features.forEach(function (f) { names[f.properties.GEOID] = f.properties.NAME; });
    var countyOpts = Object.keys(names).sort(function (a, b) { return names[a] < names[b] ? -1 : 1; }).map(function (k) { return [k, names[k] + ' County']; });
    var hits = FF ? FF.select(g, { execution: q.execution || null, projectType: q.projectType || null, county: q.county || null, openOnly: q.openOnly, includeSupport: q.includeSupport }) : [];
    var cmpBtn = function (p) { var on = picked.indexOf(p.id) !== -1; return '<button type="button" class="btn-secondary dd-cmp" data-dd-cmp="' + esc(p.id) + '" aria-pressed="' + on + '"' + (!on && picked.length >= 3 ? ' disabled title="Up to three programs side by side"' : '') + '>' + (on ? 'Remove from comparison' : 'Compare this program') + '</button>'; };
    var card = function (p) {
      var head = esc(p.name) + '<span class="fold-take">' + esc(p.administrator) + ' · ' + esc(fType(p)) + ' · ' + esc(F_STATUS[p.status] || p.status) + '</span>';
      return '<details class="fold dd-fold dd-prog"><summary><span class="fold-title">' + head + '</span></summary><div>' + cmpBtn(p) +
        '<p>Official page: ' + ext(p.official_url, p.official_url.replace(/^https?:\/\/(www\.)?/, '')) + '</p><dl class="dd-dl">' +
        F_FIELDS.map(function (f) { return '<dt>' + esc(f[1]) + '</dt><dd>' + esc(p[f[0]] == null ? 'Not stated' : p[f[0]]) + '</dd>'; }).join('') + '</dl>' +
        '<h4>What to know</h4>' + list((p.key_considerations || []).map(esc)) +
        '<h4>Sources</h4><p>' + srcLinks(p.sources) + '</p>' +
        ((p.evidence || []).length ? '<details class="fold dd-fold"><summary><span class="fold-title">Quoted terms from the official sources</span><span class="fold-take">' + p.evidence.length + ' quotes</span></summary><div>' +
          list(p.evidence.map(function (e) { return esc(String(e.field).replace(/_/g, ' ')) + ': “' + esc(e.quote) + '” ' + ext(e.url, 'source'); })) + '</div></details>' : '') +
        ((p.unverified || []).length ? '<p class="note"><strong>Not yet confirmed:</strong> ' + p.unverified.map(function (u) { return esc(String(u.field).replace(/_/g, ' ')) + ': ' + esc(u.reason); }).join(' ') + '</p>' : '') +
        '<p class="note">Checked ' + esc(day(p.last_checked)) + '.</p></div></details>';
    };
    var cmp = picked.map(function (id) { return byId[id]; }).filter(Boolean);
    var lim = d.limits, amc = params.get('famc') || '08031', lc = lim.counties.filter(function (c) { return c.fips === amc; })[0] || lim.counties[0];
    var tiers = Object.keys(lc.regular_tiers || {}).sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); });
    var amiRows = tiers.map(function (t) { var x = lc.regular_tiers[t], il = x.income_limits || {}, mr = x.max_rents || {}; return { tier: (/%/.test(t) ? t : t + '%') + ' AMI', i1: il['1p'], i2: il['2p'], i4: il['4p'], r1: mr['1br'], r2: mr['2br'], r3: mr['3br'] }; });
    return sec('df', 'Funding sources for Colorado affordable housing', '<p>How Colorado affordable rental housing is financed, which public and private programs fill each layer of the capital stack, and the terms, AMI restrictions and eligibility rules that come with each one. Every program links to its official page, and every term below quotes that page. Use them alongside the <a href="#/deal-calculator">Deal Calculator</a>. To see who these programs have already funded, and where, open <a href="#/money">Where Colorado’s housing money goes</a>. Tax credit applicants seeking DOH, OEDIT or Denver gap money apply through one shared workbook; the steps and calendar are on ' + ext('https://housinghubcolorado.com/', 'Housing Hub Colorado') + '.</p>' +
        '<p class="note">Program terms checked against each official source on ' + esc(day(m.last_checked)) + '. Next scheduled review: ' + esc(day(m.review_by)) + '. ' + esc(m.disclaimer) + '</p>') +
      sec('df-find', 'Find programs for my project', '<p>Each choice narrows the program list. The finder screens for eligibility from each program’s own published terms; it does not rank programs or predict an award, so confirm fit with the administrator.</p><div class="dd-pickrow">' +
        picker('dd-fexec', 'fexec', 'Deal type', [['', 'Any deal type'], ['9%', '9% housing tax credit (competitive)'], ['4%', '4% housing tax credit with bonds'], ['rental', 'Rental without LIHTC'], ['for-sale', 'For-sale homes']], q.execution) +
        picker('dd-ftype', 'ftype', 'Project type', [['', 'Any project type'], ['new-construction', 'New construction'], ['acq-rehab', 'Acquisition and rehab'], ['preservation', 'Preservation or refinance'], ['supportive', 'Supportive housing'], ['land', 'Land acquisition'], ['predevelopment', 'Predevelopment']], q.projectType) +
        picker('dd-fcounty', 'fcounty', 'County', [['', 'Anywhere in Colorado']].concat(countyOpts), q.county) +
        picker('dd-fopen', 'fopen', 'Rounds', [['', 'Every program'], ['1', 'Only programs taking applications or with a published next round']], q.openOnly ? '1' : '') +
        picker('dd-fsup', 'fsup', 'Support', [['', 'Project capital only'], ['1', 'Also show help that is not project capital (planning grants, technical help)']], q.includeSupport ? '1' : '') + '</div>' +
        (FF ? '<p role="status"><strong>' + num(hits.length) + ' of ' + num(g.programs.length) + ' programs fit.</strong></p>' + UI.table('dd-fit', 'Programs that fit these choices, open rounds first', [
            { key: 'name', label: 'Program' }, { key: 'admin', label: 'Administrator' }, { key: 'avail', label: 'Round' }, { key: 'notes', label: 'Check' }
          ], hits.map(function (h) { return { name: h.program.name, admin: h.program.administrator, avail: FF.AVAILABILITY_LABELS ? FF.AVAILABILITY_LABELS[h.availability] : h.availability, notes: h.notes.join(' ') }; }), { noun: 'programs', placeholder: 'Program' }) + '<p class="metric-source">Source: each program’s own published terms, linked in its detail; checked ' + esc(day(m.last_checked)) + '</p>'
          : '<p role="status" class="note">Loading the funding finder…</p>') +
        sec('df-compare', 'Side by side', cmp.length ? '<div class="table-wrap"><table class="data-table"><caption>Up to three programs side by side</caption><thead><tr><th scope="col">Term</th>' + cmp.map(function (p) { return '<th scope="col">' + esc(p.name) + '</th>'; }).join('') + '</tr></thead><tbody>' +
            F_COMPARE.map(function (r) { return '<tr><th scope="row">' + esc(r[1]) + '</th>' + cmp.map(function (p) { var v = r[0] === 'status' ? F_STATUS[p.status] || p.status : p[r[0]]; return '<td>' + esc(v == null ? 'Not stated' : v) + '</td>'; }).join('') + '</tr>'; }).join('') +
            '</tbody></table></div><p><button type="button" class="btn-secondary" data-dd-cmp="">Clear comparison</button></p>' : '<p class="note">Open a program below and choose “Compare this program” to set up to three side by side.</p>', 3)) +
      sec('df-stack', 'How a Colorado deal is usually stacked', '<ol class="dd-list">' + g.stack.map(function (s) { return '<li><strong>' + esc(s.layer) + '.</strong> ' + esc(s.body) + '</li>'; }).join('') + '</ol>') +
      sec('df-consider', 'Major considerations', g.considerations.map(function (c) {
        return '<section class="dd-sec"><h3>' + esc(c.title) + '</h3><p>' + esc(c.body) + '</p><p class="note">Source: ' + srcLinks(c.sources) + (c.last_checked ? ' · checked ' + esc(day(c.last_checked)) : '') + '</p></section>';
      }).join('')) +
      sec('df-programs', 'Programs, terms and eligibility', '<p>Open a program to see its award size, rate, term, AMI restriction, affordability period, eligibility and application cycle. “Not stated” means the official sources checked do not publish that term; ask the administrator. All programs (' + g.programs.length + '): ' +
          g.categories.map(function (c) { return esc(c.label) + ' (' + g.programs.filter(function (p) { return p.category === c.id; }).length + ')'; }).join(' · ') + '.</p>' +
        g.categories.map(function (c) {
          var ps = g.programs.filter(function (p) { return p.category === c.id; });
          return '<section class="dd-sec"><h3>' + esc(c.label) + '</h3><p>' + esc(c.summary) + '</p>' + ps.map(card).join('') + '</section>';
        }).join('')) +
      sec('df-more', 'More funding, by place and by track', list([
        '<a href="#/places/incentives">Local Housing Incentives</a>: each town’s and county’s own housing funds, fee waivers and land-use tools, with the record each one comes from. This guide lists only the largest city funds.',
        '<a href="#/deal-calculator">Deal Calculator, ownership mode</a>: the funding sources for deed-restricted for-sale homes, including buy-downs, down payment assistance layering and fee deferrals, applied to a for-sale project’s subsidy gap.',
        '<a href="#/assistance">Help for Homebuyers</a>: down payment and mortgage help for the households who buy those homes.',
        '<a href="#/places/deep-dive?tab=need">Funding vs Need</a>: what CHFA credits and Prop 123 have actually awarded, county by county, against the need.'
      ])) +
      sec('df-ami', 'AMI quick reference: CHFA income and rent limits', '<p>Most Colorado programs restrict units by area median income (AMI) using CHFA’s published limits. Pick a county to see the income ceiling and maximum rent at each AMI tier.</p>' +
        picker('dd-famc', 'famc', 'County', lim.counties.map(function (c) { return [c.fips, c.county_name]; }).sort(function (a, b) { return a[1] < b[1] ? -1 : 1; }), lc.fips) +
        UI.table('dd-ami-ref', 'CHFA income limits by household size and maximum gross rents by bedroom count, by AMI tier, for ' + lc.county_name, [
          { key: 'tier', label: 'AMI tier', tip: 'Percent of area median income' }, { key: 'i1', label: 'Income, 1 person', num: true, fmt: money }, { key: 'i2', label: 'Income, 2 people', num: true, fmt: money }, { key: 'i4', label: 'Income, 4 people', num: true, fmt: money },
          { key: 'r1', label: 'Max rent, 1 BR', num: true, fmt: money, tip: 'Maximum monthly gross rent, including the utility allowance' }, { key: 'r2', label: 'Max rent, 2 BR', num: true, fmt: money }, { key: 'r3', label: 'Max rent, 3 BR', num: true, fmt: money }
        ], amiRows, { noun: 'tiers', placeholder: 'Tier' }) +
        src(lim.meta.source || 'CHFA 2026 income and rent limits', lim.meta.source_url, 'effective ' + day(lim.meta.effective_date)));
  }

  // ---------- 10. Market overview ----------
  function market(d) {
    var co = d.alloc.states.CO, feats = d.props.features, ph = d.pricing.quarterly.slice(-12);
    var groups = {};
    feats.forEach(function (f) { var p = f.properties || {}, mt = STATIC.metroByCounty[(p.CNTY_NAME || '').trim()] || 'Other / Rural'; var x = groups[mt] = groups[mt] || { props: 0, units: 0, li: 0 }; x.props++; x.units += parseInt(p.N_UNITS, 10) || 0; x.li += parseInt(p.LI_UNITS, 10) || 0; });
    var rows = Object.keys(groups).map(function (k) { return { metro: k, props: groups[k].props, units: groups[k].units, li: groups[k].li }; }).sort(function (a, b) { return b.li - a.li; });
    var liAll = rows.reduce(function (t, r) { return t + r.li; }, 0); rows.forEach(function (r) { r.share = liAll ? r.li / liAll * 100 : null; });
    var pr = STATIC.priorities;
    return sec('mo', 'Market overview', '<p>Colorado’s federal housing credit ceiling for ' + esc(String(d.alloc.year || 2026)) + ' is about ' + esc(compact(co.allocation)) + ' a year ($' + co.perCapita.toFixed(2) + ' per resident), and CHFA awards it in competitive rounds alongside state credits. The Denver metro accounts for the majority of statewide units, with significant development in Colorado Springs, Fort Collins, Boulder and Pueblo. The metro breakdown below comes directly from the CHFA portfolio.</p>' +
        kpis([{ label: 'Federal housing credit ceiling', value: compact(co.allocation), detail: '$' + co.perCapita.toFixed(2) + ' per resident × ' + num(co.population) + ' residents', src: 'IRS', href: d.alloc.source && d.alloc.source.url },
          { label: 'Tax credit properties in CHFA’s portfolio', value: num(feats.length), src: 'CHFA, fetched ' + day(d.props.fetchedAt) }, { label: 'Low-income homes in them', value: num(liAll) }]) +
        sec('mo-pricing', 'LIHTC credit pricing, recent quarters', staticTag('Recorded quarterly equity price per $1 of credit, 9% and 4%; same series as the Tax credit equity markets page') +
          Viz.timeLines({ noData: true, title: 'Equity price per $1 of federal credit, ' + ph[0].quarter + ' to ' + ph[ph.length - 1].quarter, answer: 'Latest ' + ph[ph.length - 1].quarter + ': 9% $' + (+ph[ph.length - 1].nine).toFixed(2) + ', 4% $' + (+ph[ph.length - 1].four).toFixed(2) + '.', zero: false,
            series: [{ label: '9% credit', color: C.homes || 'var(--pine)', points: ph.map(function (r, i) { return [i, +r.nine]; }) }, { label: '4% credit', color: C.blue || 'var(--c-blue)', points: ph.map(function (r, i) { return [i, +r.four]; }) }], fmt: function (v) { return '$' + v.toFixed(2); },
            note: 'Quarters left to right: ' + ph.map(function (r) { return r.quarter; }).join(', ') + '.', source: '<a href="#/equity-pricing">Tax credit equity markets</a>, Novogradac series captured ' + esc(day(d.pricing.meta.captured)) }) +
          fold('Show the numbers behind this chart', ph.length + ' quarters', UI.table('dd-mo-price', 'Recorded 9% and 4% equity pricing by quarter', [{ key: 'quarter', label: 'Quarter' }, { key: 'nine', label: '9%', num: true, fmt: function (v) { return '$' + (+v).toFixed(2); } }, { key: 'four', label: '4%', num: true, fmt: function (v) { return '$' + (+v).toFixed(2); } }], ph.slice().reverse(), { noun: 'quarters', placeholder: 'Quarter' })) +
          src('COHO equity pricing history', '#/equity-pricing', 'Novogradac series captured ' + day(d.pricing.meta.captured)), 3)) +
      sec('mo-findings', 'Key findings', staticTag('COHO’s editorial summary of the CHFA QAP, the Novogradac pricing trend and the CHFA portfolio') + list(STATIC.keyFindings.map(esc))) +
      sec('mo-metro', 'Metro area breakdown', '<p>Aggregated from CHFA’s HousingTaxCreditProperties feed by county, grouped into metro areas. Updates when CHFA refreshes the service.</p>' +
        UI.table('dd-mo-metro', 'CHFA tax credit properties by metro area', [{ key: 'metro', label: 'Metro area', tip: 'Metro area the county is grouped into for this table' }, { key: 'props', label: 'Properties', num: true, fmt: num }, { key: 'units', label: 'Total homes', num: true, fmt: num, tip: 'All homes in those developments, restricted and unrestricted' },
          { key: 'li', label: 'Low-income homes', num: true, fmt: num, tip: 'Homes restricted to income-qualified households under the tax credit agreement' }, { key: 'share', label: '% of low-income homes', num: true, fmt: function (v) { return v == null ? '—' : v.toFixed(1) + '%'; } }], rows, { noun: 'metro areas', placeholder: 'Metro' }) +
        '<p class="note">Metro groups: Denver Metro is Denver, Arapahoe, Jefferson, Adams, Douglas and Broomfield; Colorado Springs is El Paso and Teller; Fort Collins / NoCo is Larimer and Weld; Western Slope is Mesa and Garfield; Mountain Resort is Pitkin, Eagle, Summit, Routt, San Miguel, La Plata and Gunnison. Every other county is Other / Rural.</p>' +
        src('CHFA LIHTC portfolio (CHFA ArcGIS FeatureServer, public)', 'https://www.chfainfo.com/rental-housing/housing-credit', 'fetched ' + day(d.props.fetchedAt))) +
      sec('mo-prio', 'CHFA 2026 priorities', staticTag('Summary of the CHFA 2025-26 QAP, the plan in force for 2026; refer to the PDF for exact scoring each cycle') + '<p>' + esc(pr.intro) + '</p>' +
        list(pr.items.map(function (x) { return '<strong>' + esc(x[0]) + '</strong>: ' + esc(x[1]); }).concat(['<strong>Green building</strong>: ' + esc(pr.green)])) + '<blockquote>“' + esc(pr.quote) + '”</blockquote>' +
        src('CHFA 2025-26 Qualified Allocation Plan', 'https://www.chfainfo.com/rental-housing/housing-credit', '')) +
      sec('mo-sources', 'Data sources', list([ext('https://www.chfainfo.com/rental-housing/housing-credit', 'Colorado Housing and Finance Authority (CHFA)') + ': LIHTC allocations and program data', ext('https://www.huduser.gov/portal/datasets/lihtc.html', 'HUD LIHTC dataset') + ': project-level allocation data',
        ext('https://www.census.gov/programs-surveys/acs', 'U.S. Census Bureau ACS') + ': population and housing statistics', ext('https://www.novoco.com/', 'Novogradac') + ': market reports and pricing data', ext('https://fred.stlouisfed.org/', 'Federal Reserve (FRED)') + ': economic indicators',
        ext('https://coloradorealtors.com/market-trends/', 'Colorado Association of REALTORS (CAR)') + ': statewide market trends']), 3);
  }

  // ---------- 11. Funding vs need ----------
  var QUAD = {
    underserved: ['High need, little funding', 'Need above the middle county, tax credit homes below it.', 'var(--rust)'],
    aligned: ['High need, funded', 'Need and tax credit homes both above the middle county.', 'var(--map-4)'],
    'funded-above-need': ['Funded beyond need', 'Tax credit homes above the middle county, need below it.', 'var(--c-blue)'],
    'low-need-low-funding': ['Low need, little funding', 'Need and tax credit homes both below the middle county.', 'var(--grey)'],
    'not-computable': ['Not computable', 'Too few renters at 30% AMI to compare.', 'var(--line)']
  };
  var FLAGS = { 'high-vacancy': 'High vacancy', 'building-ahead': 'Building ahead of growth' };
  function flagText(fl) { return (fl || []).map(function (f) { return FLAGS[f.id || f] || f.id || f; }).join('; '); }
  // Need (x) against funding (y), one dot per county, with the two median lines.
  // Drawn twice: a wide one for desktop and a 340-wide one for phones, so axis text stays about 13 px on a
  // 390 px screen (the wide drawing shrunk to a phone set it near 6 px). CSS shows one (hubs/deep-dive.css).
  function scatter(o) {
    return '<figure class="dd-map dd-scatter"><figcaption><strong>' + esc(o.title) + '</strong><span class="note">' + esc(o.answer) + '</span></figcaption>' +
      scatterSvg(o, { cls: 'viz-d', W: 720, H: 420, L: 60, B: 44, tick: 12, axis: 13, r: 5.5, xLabel: o.xLabel, yLabel: o.yLabel }) +
      scatterSvg(o, { cls: 'viz-p', W: 340, H: 300, L: 56, B: 42, tick: 13, axis: 14, r: 5, xLabel: o.xShort || o.xLabel, yLabel: o.yShort || o.yLabel }) +
      '<ul class="dd-legend">' + o.legend.map(function (l) { return '<li><span class="dd-swatch" style="background:' + l[0] + '"></span>' + esc(l[1]) + '</li>'; }).join('') + '</ul>' +
      (global.LabVizData ? global.LabVizData.block(o.title, ['County', o.xLabel, o.yLabel], o.points.map(function (p) { return [p.name || p.label, p.x, p.y]; })) : '') + '</figure>';
  }
  function scatterSvg(o, s) {
    var W = s.W, H = s.H, L = s.L, B = s.B, R = 12, Tp = 12;
    var xs = o.points.map(function (p) { return p.x; }), ys = o.points.map(function (p) { return p.y; });
    // Axis tops are multiples of 20, so the quarter ticks land on whole numbers (0, 15, 30…, not 13 or 38).
    var mx = Math.ceil(Math.max.apply(null, xs.concat([o.sx])) / 20) * 20 || 20, my = Math.ceil(Math.max.apply(null, ys.concat([o.sy])) / 20) * 20 || 20;
    var X = function (v) { return L + v / mx * (W - L - R); }, Y = function (v) { return H - B - v / my * (H - B - Tp); };
    var g = '';
    [0, .25, .5, .75, 1].forEach(function (t) { g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(my * t) + '" y2="' + Y(my * t) + '" stroke="var(--line)"/><text x="' + (L - 6) + '" y="' + (Y(my * t) + 4) + '" text-anchor="end" font-size="' + s.tick + '" fill="var(--muted)">' + Math.round(my * t) + '</text>' +
      '<text x="' + X(mx * t) + '" y="' + (H - B + 18) + '" text-anchor="middle" font-size="' + s.tick + '" fill="var(--muted)">' + Math.round(mx * t) + '</text>'; });
    g += '<line x1="' + X(o.sx) + '" x2="' + X(o.sx) + '" y1="' + Tp + '" y2="' + (H - B) + '" stroke="var(--slate-text)" stroke-dasharray="5,4"/><line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(o.sy) + '" y2="' + Y(o.sy) + '" stroke="var(--slate-text)" stroke-dasharray="5,4"/>';
    g += o.points.map(function (p) { return '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="' + s.r + '" fill="' + p.color + '" fill-opacity=".85" stroke="var(--halo)"><title>' + esc(p.label) + '</title></circle>'; }).join('');
    g += '<text x="' + ((L + W) / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="' + s.axis + '" fill="var(--ink)">' + esc(s.xLabel) + '</text><text transform="translate(14 ' + (H / 2) + ') rotate(-90)" text-anchor="middle" font-size="' + s.axis + '" fill="var(--ink)">' + esc(s.yLabel) + '</text>';
    return '<svg class="' + s.cls + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.title + '. ' + o.answer) + '">' + g + '</svg>';
  }
  // Under the glance cards: the counties left out of all four groups, by name and the file's own reason.
  // The method notes in the derived file are written for builders: they open with a field name and cite the
  // file they read. Readers get the sentence, not the field name or the path.
  function plainMeta(t) {
    return String(t || '').replace(/^[a-z0-9_]+ from the ranking index:\s*/, 'Need: ').replace(/;\s*data\/[^\s)]+\.json/g, '').replace(/\s*\(?data\/[^\s)]+\.json\)?/g, '')
      .replace(/^high-vacancy:/, 'High vacancy:').replace(/\bbuilding-ahead:/, 'Building ahead of growth:');
  }
  // The one headline for homes short at 30% AMI is HUD CHAS affordable-and-available, as on the lab's Home;
  // the ACS figures on this page answer the same question another way and are labelled as such.
  var CHAS_URL = 'https://www.huduser.gov/portal/datasets/cp.html';
  function chas30(d) { return d.aa && d.aa.statewide && d.aa.statewide.tiers ? d.aa.statewide.tiers['30'] : null; }
  function chasYears(d) { return d.aa && d.aa.meta ? d.aa.meta.vintage : ''; }
  // Counties the groups leave out because the ACS gap is zero, with what HUD's CHAS count says for them.
  function chasOutNote(d) {
    var out = d.fvn.counties.filter(function (c) { return !c.quadrant && /zero/.test(c.quadrant_unavailable_reason || ''); });
    var ac = d.aa && d.aa.counties ? d.aa.counties : {};
    var short = out.map(function (c) { var t = ac[c.fips] && ac[c.fips].tiers ? ac[c.fips].tiers['30'] : null; return t && t.homes_short > 0 ? cname(c.name) + ' ' + num(t.homes_short) : null; }).filter(Boolean);
    return short.length ? ' On HUD\u2019s CHAS count these counties are short too: ' + short.join(', ') + ' homes at or below 30% AMI.' : '';
  }
  // The award ledger is CHFA's round award reports, which leave out most 4% bond deals. From HA #2726 the
  // funding file adds them from CHFA's property list (bond_units_outside_rounds); an older pin does not.
  function hasBonds(sw) { return sw && typeof sw.bond_units_outside_rounds === 'number'; }
  function ledgerNote(sw) {
    return hasBonds(sw)
      ? 'These groups count CHFA\u2019s round awards and ' + num(sw.bond_deals_outside_rounds) + ' 4% bond deals CHFA awarded outside the rounds (' + num(sw.bond_units_outside_rounds) + ' homes), taken from CHFA\u2019s property list and matched so no deal counts twice.'
      : 'These groups count homes in CHFA\u2019s round award reports. Most 4% bond deals are approved outside the rounds and never appear in those reports, so they are missing here, and counties that rely on bond deals look less funded than they are. CHFA\u2019s property list, on the portfolio page, has them.';
  }
  function glanceNote(fvn) {
    var out = fvn.counties.filter(function (c) { return !c.quadrant; });
    if (!out.length) return '';
    var why = {};
    out.forEach(function (c) { var r = c.quadrant_unavailable_reason || 'not computable'; (why[r] = why[r] || []).push(cname(c.name)); });
    return '<p class="note">' + out.length + (out.length === 1 ? ' county is' : ' counties are') + ' in no group: ' +
      Object.keys(why).map(function (r) { return why[r].sort().join(', ') + ' (' + r + ')'; }).join('; ') + '.</p>';
  }
  function need(d, params) {
    var fvn = d.fvn, ami = d.gap, st = ami.statewide, sw = fvn.statewide, w = fvn.meta.window, split = fvn.meta.quadrant_split;
    var quadOn = params.get('quad');
    var gap30 = -st.gap_units_minus_households_le_ami_pct[30], c30 = chas30(d);
    var counties = fvn.counties.map(function (c) {
      return { fips: c.fips, county: cname(c.name), region: c.region, gap: c.need.gap_units_30ami, per1000: c.need.gap_per_1000_residents, share: c.need.share_of_state_gap, units: c.funding.lihtc_units, ushare: c.funding.share_of_state_lihtc_units,
        per100: c.funding.lihtc_units_per_100_gap, c9: c.funding.federal_9pct_credit_per_unit_annual, p123: c.funding.prop123_dollars, vac: c.market.active_market_vacancy_pct, pace: c.market.production_to_need_ratio,
        quad: c.quadrant, quadText: c.quadrant ? (QUAD[c.quadrant] || [c.quadrant])[0] : 'Not placed (' + (c.quadrant_unavailable_reason || 'not computable') + ')', flags: flagText(c.flags) || 'None' };
    });
    var shown = quadOn ? counties.filter(function (c) { return c.quad === quadOn; }) : counties;
    var link = function (k) { return '#/places/deep-dive?tab=need' + (quadOn === k ? '' : '&quad=' + encodeURIComponent(k)); };
    var pts = counties.filter(function (c) { return c.per1000 != null && c.per100 != null && QUAD[c.quad]; }).map(function (c) { return { x: c.per1000, y: c.per100, color: QUAD[c.quad][2], name: c.county + ' · ' + QUAD[c.quad][0], label: c.county + ': ' + c.per1000.toFixed(1) + ' short per 1,000 residents, ' + c.per100.toFixed(1) + ' tax credit homes per 100 short · ' + QUAD[c.quad][0] }; });
    var z = d.zori.counties, rent = fvn.counties.map(function (c) { var m = z[c.fips], cap = c.market.chfa_60ami_max_rent_2br; return m && m.rent > 0 && cap > 0 ? { county: cname(c.name), gap: m.rent - cap, market: m.rent, cap: cap, yoy: m.yoy_change_pct, units: c.funding.lihtc_units } : null; }).filter(Boolean).sort(function (a, b) { return b.gap - a.gap; });
    var below = rent.filter(function (r) { return r.gap <= 0; }).map(function (r) { return r.county; });
    var mfmt = function (v) { return (v < 0 ? '−' : '') + money(Math.abs(v)); };
    var amiRows = ami.bands.filter(function (b) { return b <= 80; }).map(function (b) { return { band: b + '% AMI', rent: st.affordable_rent_monthly[b], hh: st.households_le_ami_pct[b], units: st.units_priced_affordable_le_ami_pct[b], gap: st.gap_units_minus_households_le_ami_pct[b] }; });
    return sec('fvn', 'Funding vs need: where Colorado’s housing subsidy goes', '<p>From ' + w.first_year + ' to ' + w.last_year + ', CHFA awarded housing tax credits to ' + num(sw.tax_credit_awards) + ' projects with ' + num(sw.lihtc_units) + ' LIHTC units, and the Prop 123 financing fund selected ' + num(sw.prop123_awards) + ' awards worth ' + compact(sw.prop123_dollars) + '. ' +
          num(sw.quadrants.underserved) + ' counties have above-median need and below-median funding for it; ' + sw.counties_soft_and_funded.length + ' funded counties show both soft-market signals at once (' + esc(sw.counties_soft_and_funded.join(', ')) + '). Awards are read from CHFA’s Housing Tax Credit award reports and the Prop 123 financing fund’s selected-applicant lists. Built ' + esc(day(fvn.meta.generatedAt)) + '.</p><p class="note">' + esc(ledgerNote(fvn.statewide)) + '</p>' +
        kpis([{ label: 'LIHTC units awarded', value: num(sw.lihtc_units), detail: w.first_year + '–' + w.last_year + (hasBonds(sw) ? ': ' + num(sw.round_report_lihtc_units) + ' in rounds, ' + num(sw.bond_units_outside_rounds) + ' in 4% bond deals' : ', ' + num(sw.tax_credit_awards) + ' credit awards') }, { label: 'Prop 123 fund awards', value: compact(sw.prop123_dollars), detail: num(sw.prop123_awards) + ' selections since FY23-24' },
          { label: 'High need, little funding', value: num(sw.quadrants.underserved) + ' counties', detail: 'Split at the county medians' }, { label: 'Soft and funded', value: num(sw.counties_soft_and_funded.length) + ' counties', detail: 'Both soft-market flags and LIHTC awards' }]) +
        sec('fvn-ami', 'Renters and the homes priced for them, statewide', (c30 ? '<p>Colorado is <strong>' + num(c30.homes_short) + ' homes short</strong> for renters at or below 30% of area median income on HUD\u2019s CHAS count (' + esc(chasYears(d)) + '), the one headline figure this site uses. It counts only homes those renters can afford that are vacant or rented by someone in the group.</p>' : '') +
          '<p>The ACS count below is newer and reaches every county, so the groups on this page use it. At 30% of area median income, ' + num(st.households_le_ami_pct[30]) + ' renter households compete for ' + num(st.units_priced_affordable_le_ami_pct[30]) + ' homes priced for them, a shortfall of ' + num(gap30) + ' on this count. It is larger because it includes cheap homes rented by higher-income households and measures everyone against one statewide AMI. The shortfall shrinks with income and turns to a surplus near 70% AMI.</p>' +
          UI.table('dd-ami', 'Renters against homes priced for them, by income', [{ key: 'band', label: 'Income' }, { key: 'rent', label: 'Rent they can pay', num: true, fmt: money }, { key: 'hh', label: 'Renter households', num: true, fmt: num }, { key: 'units', label: 'Homes priced for them', num: true, fmt: num },
            { key: 'gap', label: 'Homes minus households', num: true, fmt: function (v) { return (v > 0 ? '+' : '') + num(v); }, tip: 'Negative means more households than homes' }], amiRows, { noun: 'income bands', placeholder: 'Income' }) + src('ACS ' + ami.meta.acs_year + ' B25118 and B25063 with HUD FY' + ami.meta.hud_income_limits_year + ' income limits', ami.sources[2].url, 'built ' + day(ami.meta.generated_at)), 3)) +
      sec('fvn-scatter', 'Need against funding received, by county', '<p class="note">Need: renter households at or below 30% AMI minus homes priced for them (the ACS count, ' + esc(ami.meta.acs_year) + ' with HUD income limits, via the ranking index), not HUD\u2019s CHAS count, so a county\u2019s group can differ on that measure.' + esc(chasOutNote(d)) + ' Funding: LIHTC units in CHFA round award reports since ' + w.first_year + (hasBonds(sw) ? ', plus 4% bond deals awarded outside the rounds.</p>' : '; 4% bond deals outside the rounds are not counted.</p>') +
        scatter({ title: 'Homes short at 30% AMI per 1,000 residents, against tax credit homes per 100 short', answer: 'Scatter of ' + pts.length + ' counties. ' + ['underserved', 'aligned', 'funded-above-need', 'low-need-low-funding'].map(function (k) { return QUAD[k][0] + ': ' + sw.quadrants[k]; }).join('; ') + '.',
          points: pts, sx: split.gap_per_1000_residents, sy: split.lihtc_units_per_100_gap, xLabel: 'Homes short at 30% AMI per 1,000 residents', yLabel: 'Tax credit homes per 100 short', xShort: 'Short at 30% AMI, per 1,000 residents', legend: ['underserved', 'aligned', 'funded-above-need', 'low-need-low-funding'].map(function (k) { return [QUAD[k][2], QUAD[k][0]]; }).concat([['var(--slate-text)', 'Dashed: county medians']]) }) +
        '<p>The dashed lines are the county medians (' + split.gap_per_1000_residents + ' and ' + split.lihtc_units_per_100_gap + '), so each county lands in one of four groups. Select a group to list its counties. LIHTC units mostly rent at up to 60% AMI, so this compares scale, not whether each unit reaches a household at 30% AMI.</p>' +
        '<div class="agency-cards">' + ['underserved', 'aligned', 'funded-above-need', 'low-need-low-funding'].map(function (k) {
          return '<a class="agency-card' + (quadOn === k ? ' is-on' : '') + '" href="' + esc(link(k)) + '"' + (quadOn === k ? ' aria-current="true"' : '') + '><p class="lever-title">' + esc(QUAD[k][0]) + '</p><p class="metric-value">' + num(sw.quadrants[k]) + ' counties</p><p class="dq-what">' + esc(QUAD[k][1]) + '</p></a>';
        }).join('') + '</div>' + src('CHFA Housing Tax Credit award reports; ACS ' + ami.meta.acs_year + ' renters by income and gross rent with HUD income limits, via the HNA ranking index', '#/money?agency=CHFA', 'awards ' + w.first_year + ' to date')) +
      sec('fvn-rent', 'How much a 60% AMI rent saves a tenant', '<p>' + rent.length + ' counties have a Zillow rent. The largest gap is ' + esc(rent[0].county) + ' at ' + money(rent[0].gap) + ' a month. ' + (below.length ? 'The 60% AMI maximum is at or above typical market rent in ' + esc(below.join(', ')) + '.' : 'Typical market rent is above the 60% AMI maximum in every one.') + '</p>' +
        diverge('Typical market rent minus the 60% AMI two-bedroom maximum', 'Dollars a month; below zero, the restricted rent is at or above market', rent.map(function (r) { return [r.county, r.gap, 'market ' + money(r.market) + ', 60% max ' + money(r.cap)]; }), mfmt) +
        '<p class="note">Where the bar is short or negative, a 60% AMI unit rents for about what the market already charges, so the affordability it buys depends on deeper targeting (30% to 50% AMI) or rental assistance. Zillow rent vintage: ' + esc(d.zori.meta.vintage_month) + '.</p>' +
        src('Zillow Observed Rent Index (county) and CHFA 2026 maximum gross rent, 60% AMI, 2 bedrooms', d.zori.meta.county_url, 'ZORI ' + monthOf(d.zori.meta.vintage_month) + '; CHFA 2026')) +
      sec('fvn-year', 'Awards by year', Viz.timeLines({ noData: true, title: 'LIHTC units awarded by year, ' + w.first_year + ' to ' + w.last_year, answer: num(sw.lihtc_units) + ' units across ' + num(sw.tax_credit_awards) + ' awards; Prop 123 added ' + compact(sw.prop123_dollars) + ' across ' + num(sw.prop123_awards) + ' awards since 2023.',
          series: [{ label: 'Tax credit homes', color: C.homes || 'var(--pine)', points: sw.by_year.map(function (y) { return [y.year, y.lihtc_units]; }) }], fmt: num, note: w.last_year + ' is the year to date.', source: '<a href="#/money">CHFA award reports; Prop 123 selected-applicant lists</a>, built ' + esc(day(fvn.meta.generatedAt)) }) +
        fold('Show the numbers behind this chart', sw.by_year.length + ' years', UI.table('dd-fvn-year', 'Tax credit and Prop 123 awards by year', [{ key: 'year', label: 'Year' }, { key: 'tax_credit_awards', label: 'Credit awards', num: true }, { key: 'lihtc_units', label: 'LIHTC units', num: true, fmt: num }, { key: 'prop123_awards', label: 'Prop 123 awards', num: true }, { key: 'prop123_dollars', label: 'Prop 123 dollars', num: true, fmt: money }], sw.by_year.slice().reverse(), { noun: 'years', placeholder: 'Year' }) + src('CHFA award reports; Prop 123 selected-applicant lists', '#/money', 'built ' + day(fvn.meta.generatedAt)))) +
      sec('fvn-table', 'Every county', (quadOn ? '<p><a href="#/places/deep-dive?tab=need">Show every county</a></p>' : '') + UI.table('dd-fvn', quadOn ? QUAD[quadOn][0] + ' counties' : 'Affordable-housing need, tax credit and Prop 123 awards, and market signals for each Colorado county', [
          { key: 'county', label: 'County', href: function (r) { return '#/place/' + r.fips; } }, { key: 'region', label: 'Region' },
          { key: 'gap', label: '≤30% AMI gap', num: true, fmt: num, tip: 'Renter households at or below 30% AMI less homes priced for them (ACS with HUD income limits, via the ranking index)' },
          { key: 'per1000', label: 'Gap per 1,000 residents', num: true, fmt: function (v) { return v == null ? '—' : v.toFixed(1); } }, { key: 'share', label: 'Share of state gap', num: true, fmt: function (v) { return v == null ? '—' : v.toFixed(2) + '%'; } },
          { key: 'units', label: 'LIHTC units awarded', num: true, fmt: num, tip: 'Awarded ' + w.first_year + '–' + w.last_year + '; restricted units where the report prints them, else total units' }, { key: 'ushare', label: 'Share of state LIHTC units', num: true, fmt: function (v) { return v == null ? '—' : v.toFixed(2) + '%'; } },
          { key: 'per100', label: 'Units per 100 gap households', num: true, fmt: function (v) { return v == null ? '—' : v.toFixed(1); } }, { key: 'c9', label: '9% credit per unit (annual)', num: true, fmt: money, tip: 'Annual federal 9% credit divided by 9% units; the credit is claimed for 10 years' },
          { key: 'p123', label: 'Prop 123 dollars', num: true, fmt: money }, { key: 'vac', label: 'Active-market vacancy', num: true, fmt: function (v) { return v == null ? '—' : v.toFixed(1) + '%'; } },
          { key: 'pace', label: 'Permits ÷ projected growth', num: true, fmt: function (v) { return v == null ? '—' : v.toFixed(2) + '×'; } }, { key: 'quadText', label: 'Need vs funding' },
          { key: 'flags', label: 'Soft-market flags', tip: 'High vacancy: active-market vacancy at or above the county 75th percentile. Building ahead of growth: five-year permits at least 2× DOLA projected household growth' }
        ], shown, { noun: 'counties', placeholder: 'County or region' }) + src('HUD income limits, Census ACS, CHFA and OEDIT award lists', '#/money', 'built ' + day(fvn.meta.generatedAt))) +
      sec('fvn-method', 'What this does and does not show', list([esc(plainMeta(fvn.meta.need_measure)), esc(plainMeta(fvn.meta.coverage_measure)), esc(plainMeta(fvn.meta.quadrant_method)), esc(plainMeta(fvn.meta.flag_method)),
          'Correlation, not cause. A soft market today can come from a wave of market-rate supply, not from subsidy. An award is not a finished home: projects take two to four years to deliver, and some awards are returned.', esc(fvn.meta.credit_note),
          'Coverage: CHFA award reports from ' + w.first_year + ' and Prop 123 lists from FY23-24. Division of Housing grants and loans are not in this comparison; <a href="#/money">Where Colorado’s housing money goes</a> lists the ones the Division has announced.']) +
        src('HUD income limits, Census ACS, CHFA and OEDIT award lists', '#/money', 'built ' + day(fvn.meta.generatedAt)));
  }

  // ---------- 12. Market direction ----------
  var CALLS = { emerging: 'Emerging', steady: 'Steady', softening: 'Softening', falling_demand: 'Falling demand', second_home_shift: 'Second-home shift', not_enough_data: 'Not enough data' };
  var CALL_COLOR = { emerging: 'var(--call-emerging)', steady: 'var(--call-steady)', softening: 'var(--call-softening)', falling_demand: 'var(--text-red)', second_home_shift: 'var(--call-second-home)', not_enough_data: 'var(--call-no-data)' };
  var STAGES = [['under_construction', 'Under construction'], ['funded', 'Funded'], ['land_funded', 'Land funded'], ['applied', 'Applied'], ['letter_of_intent', 'Letter of intent'], ['not_funded', 'Not funded']];
  function why(b) { if (!b) return ''; if (b.indexOf(':') < 0) return b.charAt(0).toUpperCase() + b.slice(1); var p = b.split('; ').filter(function (x) { return !/: none$/.test(x); }); if (!p.length) return 'Nothing rising or falling'; var s = p.join('; '); return s.charAt(0).toUpperCase() + s.slice(1); }
  function sig(s, unit) { if (!s || s.value == null) return null; return pct(s.value) + (unit || '') + ' (' + (s.reading === 'up' ? 'rising' : s.reading === 'down' ? 'falling' : 'flat') + ')'; }
  function direction(d, params) {
    var md = d.dir, m = md.meta, keys = Object.keys(md.counties), names = {};
    keys.forEach(function (k) { names[k] = md.counties[k].name; });
    var order = ['emerging', 'steady', 'softening', 'falling_demand', 'not_enough_data'], cc = m.call_counts;
    var parts = order.filter(function (k) { return cc[k]; }).map(function (k) { return cc[k] + ' ' + (k === 'falling_demand' ? 'losing household population and jobs' : k === 'not_enough_data' ? 'without enough data to call' : CALLS[k].toLowerCase()); });
    parts[0] = parts[0].replace(/^(\d+) /, function (x, n) { return n + (n === '1' ? ' is ' : ' are '); });
    var tc = m.places.call_counts.town, towns = Object.keys(md.places).filter(function (k) { return md.places[k].type === 'town'; }).length;
    var thr = m.sources.permits_ytd.through, ty = +thr.slice(0, 4), tm = +thr.slice(5, 7), now = 0, before = 0;
    keys.forEach(function (k) { var p = md.counties[k].permits_ytd; if (p && p.ytd && p.prior_ytd) { now += p.ytd.total; before += p.prior_ytd.total; } });
    var lead = 'Of Colorado’s ' + keys.length + ' counties, ' + parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] + '. Of ' + towns + ' towns, ' + (tc.emerging || 0) + ' are emerging, ' + (tc.softening || 0) + ' softening and ' + (tc.falling_demand || 0) + ' losing household population with a market signal that agrees. Statewide, ' + num(now) + ' homes were permitted January–' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][tm - 1] + ' ' + ty + ', against ' + num(before) + ' in the same months of ' + (ty - 1) + '.';
    var cRows = keys.map(function (k) { var c = md.counties[k], s = c.signals, aa = c.affordable_activity || {}, e = c.rent_edge || {};
      return { fips: k, county: cname(c.name), call: CALLS[c.call] || c.call, why: why(c.call_basis), pop: sig(s.population), jobs: sig(s.jobs), permits: sig(s.permits), price: sig(s.price), rent: sig(s.rent),
        ytd: c.permits_ytd && c.permits_ytd.ytd ? num(c.permits_ytd.ytd.total) + ' vs ' + num(c.permits_ytd.prior_ytd && c.permits_ytd.prior_ytd.total) : null, ytdpct: c.permits_ytd ? c.permits_ytd.change_pct : null,
        edge: e.reading ? ({ clear: 'Clear', thin: 'Thin', no_edge: 'None' }[e.reading] || e.reading) + (e.edge_pct != null ? ' (' + e.edge_pct.toFixed(1) + '%)' : '') : null, pipe: aa.homes != null ? num(aa.homes) + ' homes in ' + num(aa.projects) + ' projects' : null }; });
    var dirC = params.get('dir') || '', callF = params.get('call') || '', cdp = params.get('cdp') === '1';
    var places = Object.keys(md.places).map(function (k) { var p = md.places[k]; p._k = k; return p; }).filter(function (p) { return (cdp || p.type === 'town') && (!dirC || p.county_fips === dirC) && (!callF || p.call === callF); });
    var tRows = places.map(function (p) { var s = p.signals; return { town: p.name, county: cname(names[p.county_fips]), type: p.type === 'cdp' ? 'CDP' : 'Town', call: CALLS[p.call] || p.call, why: why(p.call_basis), pop: sig(s.population), permits: sig(s.permits), price: sig(s.price), rent: sig(s.rent), ytd: p.permits_ytd && p.permits_ytd.ytd ? num(p.permits_ytd.ytd.total) + ' vs ' + num(p.permits_ytd.prior_ytd && p.permits_ytd.prior_ytd.total) : null, cc: CALLS[p.county_call] || p.county_call }; });
    var pc = dirC ? md.counties[dirC] : null, aa = pc && pc.affordable_activity;
    var th = m.thresholds, pth = m.places.thresholds, fmtT = function (v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '%'; };
    var thRows = [['permits', 'Permits, 5 years against the 5 before'], ['price', 'Home prices'], ['rent', 'Rent, past year'], ['population', 'Household population, % a year'], ['jobs', 'Jobs']].map(function (r) {
      var c = th[r[0]], t = pth[r[0]]; return { reading: r[1], up: c ? fmtT(c.up_at_or_above) + ' or more' : 'Not used', down: c ? fmtT(c.down_at_or_below) + ' or less' : 'Not used', town: t ? fmtT(t.up_at_or_above) + ' / ' + fmtT(t.down_at_or_below) : 'Not used' }; });
    var callList = ['falling_demand', 'softening', 'emerging', 'steady', 'second_home_shift', 'not_enough_data'].map(function (k) { return '<strong>' + esc(CALLS[k]) + '.</strong> ' + (m.calls[k] ? 'Counties: ' + esc(m.calls[k]) + ' ' : '') + (m.places.calls[k] ? 'Towns: ' + esc(m.places.calls[k]) : ''); });
    var srcs = m.sources;
    var mdDate = 'inputs as of ' + day(m.generated_at), mdSrc = src('COHO market direction (readings and sources under “How a call is made”)', LIVE + 'colorado-deep-dive.html#tab-direction', mdDate);
    return sec('md', 'Which Colorado housing markets are growing, and which are weakening', '<p>' + esc(lead) + '</p><p>A county call reads household population and jobs (demand) against permits, home prices and rents (the market). A town call reads household population against the same market signals, because no jobs series exists for towns. The data come from DOLA, the Census Bureau, FHFA and Zillow; the rule and its thresholds are under “How a call is made” below.</p>' +
        Viz.sortedBars({ title: 'County market calls', answer: lead.split('. ')[0] + '.', rows: order.filter(function (k) { return cc[k]; }).map(function (k) { return [CALLS[k], cc[k]]; }), fmt: num, source: ext(LIVE + 'colorado-deep-dive.html#tab-direction', 'COHO market direction') + ', ' + esc(mdDate), noShare: true }) +
        // Map kit part 2: "Not enough data" is the hatch, not a grey next to "Steady" grey; each class is counted.
        coMap({ features: d.bounds.features, fill: function (k) { var c = md.counties[k]; return c && c.call !== 'not_enough_data' ? CALL_COLOR[c.call] || NONE : NONE; }, label: function (k) { var c = md.counties[k]; return c ? c.name + ': ' + (CALLS[c.call] || c.call) + ' · ' + why(c.call_basis) : k; }, picked: dirC,
          kicker: 'Market call by county', title: (function () { var top = order.filter(function (k) { return cc[k] && k !== 'not_enough_data'; }).sort(function (a, b) { return cc[b] - cc[a]; }); return top.length ? 'Most Colorado counties are ' + CALLS[top[0]].toLowerCase() + ' (' + cc[top[0]] + ' of ' + keys.length + ')' + (top[1] ? '; ' + cc[top[1]] + ' are ' + CALLS[top[1]].toLowerCase() : '') : 'Market call by county'; })(),
          legend: order.filter(function (k) { return cc[k]; }).map(function (k) { return [k === 'not_enough_data' ? NONE : CALL_COLOR[k], CALLS[k] + ' (' + cc[k] + ')']; }), source: ext(LIVE + 'colorado-deep-dive.html#tab-direction', 'COHO market direction') + ', ' + esc(mdDate) })) +
      sec('md-county', 'Every county', UI.table('dd-md-c', 'The market call for each Colorado county and the readings behind it', [
          { key: 'county', label: 'County', href: function (r) { return '#/place/' + r.fips; } }, { key: 'call', label: 'Call', tip: 'The first rule in the order under “How a call is made” that applies' }, { key: 'why', label: 'Why', tip: 'The signals that decided the call' },
          { key: 'pop', label: 'Household population, per year' }, { key: 'jobs', label: 'Jobs', tip: 'Jobs located in the county, Census LEHD LODES' }, { key: 'permits', label: 'Permits, 5 years' }, { key: 'price', label: 'Home prices', tip: 'FHFA index, nominal' }, { key: 'rent', label: 'Rent, past year', tip: 'Zillow Observed Rent Index' },
          { key: 'ytd', label: 'Homes permitted this year vs last', tip: 'Context only; no call reads it' }, { key: 'ytdpct', label: 'Change this year', num: true, fmt: pct }, { key: 'edge', label: 'Tax-credit rent edge', tip: 'How far the 60% AMI two-bedroom rent sits below HUD Fair Market Rent: clear (10% or more), thin (under 10%) or none' },
          { key: 'pipe', label: 'Affordable homes in the pipeline', tip: 'Homes in affordable projects a state agency recorded since 2023, at any stage' }
        ], cRows, { noun: 'counties', placeholder: 'County or call' }) + mdSrc) +
      sec('md-town', 'Towns', '<div class="dd-pickrow">' + picker('dd-dir', 'dir', 'County', [['', 'All counties']].concat(keys.slice().sort(function (a, b) { return names[a] < names[b] ? -1 : 1; }).map(function (k) { return [k, names[k]]; })), dirC) +
          picker('dd-call', 'call', 'Call', [['', 'Every call']].concat(Object.keys(CALLS).map(function (k) { return [k, CALLS[k]]; })), callF) + picker('dd-cdp', 'cdp', 'Places', [['', 'Towns only'], ['1', 'Towns and census-designated places']], cdp ? '1' : '') + '</div>' +
        fold(num(tRows.length) + (cdp ? ' towns and CDPs' : ' towns') + (dirC ? ' in ' + names[dirC] : '') + (callF ? ', call ' + CALLS[callF].toLowerCase() : ''), 'The call for each town and the readings behind it', UI.table('dd-md-t', 'The market call for each Colorado town, filtered by the county and call picked above', [
          { key: 'town', label: 'Town' }, { key: 'county', label: 'County' }, { key: 'type', label: 'Type', tip: 'Town: an incorporated municipality. CDP: a census-designated place' }, { key: 'call', label: 'Call' }, { key: 'why', label: 'Why' }, { key: 'pop', label: 'Household population, per year' },
          { key: 'permits', label: 'Permits, 5 years' }, { key: 'price', label: 'Home prices, past year' }, { key: 'rent', label: 'Rent, past year' }, { key: 'ytd', label: 'Homes permitted this year vs last' }, { key: 'cc', label: 'County call' }
        ], tRows, { noun: 'places', placeholder: 'Town' }) + mdSrc, !!(dirC || callF))) +
      sec('md-projects', 'Affordable projects in the county', pc ? (aa && aa.projects ? '<p>Since ' + aa.since + ', state agencies recorded ' + num(aa.projects) + ' affordable projects with ' + num(aa.homes) + ' homes in ' + esc(pc.name) + '.</p>' +
            UI.table('dd-md-p', 'Affordable-housing projects a state agency recorded in ' + pc.name + ', by stage', [{ key: 'stage', label: 'Stage' }, { key: 'projects', label: 'Projects', num: true }, { key: 'homes', label: 'Homes', num: true, fmt: num }],
              STAGES.filter(function (s) { return aa.by_stage[s[0]]; }).map(function (s) { var x = aa.by_stage[s[0]]; return { stage: s[1], projects: x.projects, homes: x.homes }; }), { noun: 'stages', placeholder: 'Stage' }) +
            '<p>Every project, newest first, with its agency and record: <a href="#/money?county=' + esc(dirC) + '">Where the money goes, ' + esc(pc.name) + '</a>.</p>' : '<p>No affordable project recorded by a state agency since 2023 in ' + esc(pc.name) + '.</p>') : '<p class="note">Pick a county above to see the affordable projects state agencies recorded there.</p>') +
      sec('md-method', 'How a call is made', '<p>' + esc(m.rule_order.replace(/_/g, ' ')) + '. Towns: ' + esc(m.places.rule_order.replace(/_/g, ' ')) + '.</p>' + list(callList) +
        UI.table('dd-md-th', 'The thresholds at which each reading counts as rising or falling, for counties and for towns', [{ key: 'reading', label: 'Reading' }, { key: 'up', label: 'County: rising at' }, { key: 'down', label: 'County: falling at' }, { key: 'town', label: 'Town: rising / falling' }], thRows, { noun: 'readings', placeholder: 'Reading' }) + mdSrc +
        '<p class="note">' + esc(m.threshold_note) + '</p>' +
        sec('md-not', 'What this does not show', list(['A call is a reading of public data, not a forecast. It says which way the latest published figures point, and every figure lags: the calls use annual permits through last year. This year’s permits are context; no call reads them.',
          'Gaps are shown, not filled. Zillow publishes no rent index for many rural counties and towns, and FHFA no price index for some; a call made on fewer signals says so in “Why”.',
          'A second-home shift is not a failing market. Where seasonal homes are a fifth or more of the stock, a falling year-round population usually means homes changing use.']) +
          '<p>Sources: ' + ['permits', 'price', 'rent', 'population', 'jobs', 'fmr', 'lihtc_rents', 'permits_ytd'].filter(function (k) { return srcs[k] && srcs[k].url; }).map(function (k) { return ext(srcs[k].url, srcs[k].source); }).concat([ext(m.places.population_source.url, m.places.population_source.source)]).join(' · ') + '</p>' +
          src('COHO market direction', LIVE + 'colorado-deep-dive.html#tab-direction', 'inputs as of ' + day(m.generated_at)), 3));
  }

  // ---------- 13. COHO market pattern ----------
  // Rebuilt from the live tab (js/market-types.js) on the same file, data/market/market-types.json: the type
  // names, rules, menus and items all come from the file's meta, so the page cannot disagree with the build.
  // A written rule, not a score.
  // Palette colours only (Gemini round 8, q28), chosen so every pair stays at least 23 colour-difference units
  // apart for red- and green-blind readers too; each pattern also carries its own mark, so colour is never alone.
  var MT_COLOR = { resort: 'var(--slate)', job_centre: 'var(--map-3)', growing: 'var(--gold)', softening: 'var(--rust)', steady: 'var(--map-1)', too_little_data: 'var(--map-none)' };
  var MT_MARK = { resort: '\u25B2', job_centre: '\u25A0', growing: '\u2191', softening: '\u2193', steady: '=', too_little_data: '?' };
  var MT_STATUS = { authorized_with_voter_approval: 'Needs voter approval', unclear: 'Colorado authority unclear', prohibited_for_new: 'Not open to new adoption',
    required_for_subject_jurisdictions: 'Required in some places', closed: 'Closed', ended: 'Ended', ending: 'Ending', watch: 'No round announced' };
  function patterns(d, params) {
    var mt = d.mt, m = mt.meta, all = Object.keys(mt.places).map(function (g) { var p = mt.places[g]; p.geoid = g; return p; });
    var label = function (t) { return (m.types[t] || {}).label || t; };
    var pill = function (t) { return '<span class="mt-badge mt-' + esc(t) + '"><i aria-hidden="true">' + (MT_MARK[t] || '') + '</i>' + esc(label(t)) + '</span>'; };
    var towns = all.filter(function (p) { return p.level === 'town'; }), thin = towns.filter(function (p) { return p.type === 'too_little_data'; }).length;
    var counties = all.filter(function (p) { return p.level === 'county'; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var lead = towns.length + ' Colorado towns and all ' + counties.length + ' counties sorted into five COHO market patterns by written rules, each with the Colorado programs and local tools that tend to fit it' +
      (thin ? ' (' + thin + (thin === 1 ? ' town has' : ' towns have') + ' too little data to sort).' : '.');
    var link = function (name, url) { return /^https:/.test(url || '') ? ext(url, name) : esc(name); };
    var item = function (e) { var it = m.items[e.item]; if (!it) return ''; var st = MT_STATUS[it.status];
      return '<strong>' + link(it.name, it.url) + '</strong>' + (st ? ' <span class="dd-tag">' + esc(st) + '</span>' : '') + ' ' + esc(e.why); };

    // One place: its pattern, why, and the menu that tends to fit.
    var pick = params.get('mtp') || '', p = mt.places[pick], card = '<p class="note">Pick a county or town to see its market pattern and the options that tend to fit.</p>';
    if (p) {
      var shown = p.type === 'too_little_data' && p.county_fips && mt.places[p.county_fips] ? mt.places[p.county_fips] : p, t = shown.type;
      var menu = (m.menus[t] || []).map(item);
      (p.modifiers || []).forEach(function (k) { var mm = m.modifiers[k]; if (mm && mm.items.length) menu = menu.concat(mm.items.map(function (e) { return item(e) + ' <span class="note">(' + esc(mm.label) + ')</span>'; })); });
      var here = (p.here_now || []).map(function (h) { return link(h.name, h.url) + ' <span class="note">' + esc(h.kind) + '</span>'; });
      card = '<p class="dd-mt-pick"><strong>' + esc(p.name) + '</strong>' + (p.county ? ' · ' + esc(p.county) : '') + ': ' + pill(t) + '</p><p>' + esc(shown.basis) + ' ' + esc(m.types[t].plain) + '</p>' +
        (shown !== p ? '<p class="note">Public data is too thin to set a pattern for ' + esc(p.name) + ', so this uses ' + esc(shown.name) + '’s pattern.</p>' : '') +
        (shown.stability < 0.8 ? '<p class="note">Near the line: under seasonal-share uncertainty this pattern holds in ' + Math.round(shown.stability * 100) + '% of redraws of the ACS seasonal share. The other readings are not redrawn.</p>' : '') +
        (shown.near_line && shown.near_line.length ? '<p class="note">Close to a rule threshold on ' + esc(shown.near_line.join(' and ')) + '.</p>' : '') +
        ((p.modifiers || []).length ? '<p>Also: ' + esc(p.modifiers.map(function (k) { return m.modifiers[k] ? m.modifiers[k].label : k; }).join(', ')) + '</p>' : '') +
        sec('mt-fit', 'Options that tend to fit', menu.length ? list(menu.slice(0, 3)) + (menu.length > 3 ? '<details class="mt-more"><summary>Show all ' + menu.length + ' options</summary>' + list(menu.slice(3)) + '</details>' : '') : '<p>No menu for this pattern.</p>', 3) +
        sec('mt-here', 'Already here', here.length ? list(here) : '<p>No local housing fund or housing authority program in our records.</p>', 3);
    }
    var byName = function (a, b) { return a.name.localeCompare(b.name); };
    var placeOpts = [['', 'Pick a county or town']].concat(counties.map(function (c) { return [c.geoid, c.name]; }), towns.slice().sort(byName).map(function (x) { return [x.geoid, x.name]; }));

    // Towns by pattern, filtered by county and pattern in the address.
    var cF = params.get('mtc') || '', tF = params.get('mtt') || '';
    var tRows = towns.filter(function (x) { return (!cF || x.county_fips === cF) && (!tF || x.type === tF); }).sort(byName).map(function (x) {
      return { town: x.name.replace(/ \((city|town)\)$/, ''), geoid: x.geoid, county: x.county || '', type: x.type, pattern: label(x.type), why: x.basis + (x.stability < 0.8 ? ' (near the line)' : ''), also: (x.modifiers || []).map(function (k) { return m.modifiers[k] ? m.modifiers[k].label : k; }).join(', ') || '—' }; });
    var v = m.validation;
    var mtDate = m.generated_at ? 'built ' + day(m.generated_at) : '', mtSrc = src('COHO market pattern', DD + '#tab-types', mtDate);
    return sec('mt', 'COHO market pattern: what kind of market is it, and what tends to work there', '<p>' + esc(lead) + '</p>' +
        '<p class="note">A COHO market pattern is a written rule, not a score, and is not CHFA’s urban, rural or mountain property category.' + (m.generated_at ? ' Built from the market calls of ' + esc(day(m.generated_at)) + '.' : '') + '</p>' +
        Viz.sortedBars({ title: 'Towns by market pattern', answer: lead.split(' sorted')[0] + '.', rows: m.order.map(function (t) { return [label(t), (m.counts[t] || {}).town || 0]; }), fmt: num, source: ext(DD + '#tab-types', 'COHO market pattern') + (mtDate ? ', ' + esc(mtDate) : '') }) +
        coMap({ features: d.bounds.features, fill: function (k) { var c = mt.places[k]; return c ? MT_COLOR[c.type] || NONE : NONE; }, label: function (k) { var c = mt.places[k]; return c ? c.name + ': ' + label(c.type) + ' · ' + c.basis : k; }, picked: pick.length === 5 ? pick : cF,
          kicker: 'Market pattern by county', title: (function () { var t = m.order.filter(function (t) { return (m.counts[t] || {}).county; }).sort(function (a, b) { return m.counts[b].county - m.counts[a].county; }); var n = t.reduce(function (x, k) { return x + m.counts[k].county; }, 0);
            return t.length ? 'The most common county market is ' + label(t[0]).replace(/\s*\(.*$/, '').toLowerCase() + ' (' + m.counts[t[0]].county + ' of ' + n + ')' + (t[1] ? ', then ' + label(t[1]).replace(/\s*\(.*$/, '').toLowerCase() + ' (' + m.counts[t[1]].county + ')' : '') : 'Market pattern by county'; })(),
          legend: m.order.filter(function (t) { return (m.counts[t] || {}).county; }).map(function (t) { return [MT_COLOR[t], (MT_MARK[t] ? MT_MARK[t] + ' ' : '') + label(t) + ' (' + m.counts[t].county + ')']; }), source: ext(DD + '#tab-types', 'COHO market pattern') + (mtDate ? ', ' + esc(mtDate) : '') })) +
      sec('mt-place', 'One place', picker('dd-mtp', 'mtp', 'County or town', placeOpts, pick) + card) +
      sec('mt-town', 'Towns by pattern', '<div class="dd-pickrow">' + picker('dd-mtc', 'mtc', 'County', [['', 'All counties']].concat(counties.map(function (c) { return [c.geoid, c.name]; })), cF) +
          picker('dd-mtt', 'mtt', 'Pattern', [['', 'Every pattern']].concat(m.order.map(function (t) { return [t, label(t)]; })), tF) + '</div>' +
        fold(num(tRows.length) + (tRows.length === 1 ? ' town' : ' towns') + (tF ? ', ' + label(tF).toLowerCase() : ''), 'The pattern of each town, why, and the conditions that add to its menu', UI.table('dd-mt-t', 'The COHO market pattern of each Colorado town, why it has that pattern, and the conditions that change its menu', [
          { key: 'town', label: 'Town', href: function (r) { return '#/places/deep-dive?tab=patterns&mtp=' + r.geoid; } }, { key: 'pattern', label: 'Pattern', tip: 'The first written rule that holds', cls: function (r) { return 'mt-cell mt-' + r.type; } }, { key: 'county', label: 'County' }, { key: 'why', label: 'Why', tip: 'The reading that set the pattern' }, { key: 'also', label: 'Also', tip: 'Conditions that add to the menu without changing the pattern' }
        ], tRows, { noun: 'towns', placeholder: 'Town' }) + mtSrc, !!(cF || tF))) +
      sec('mt-method', 'How a pattern is set', '<p>The rules run in order; the first that holds names the pattern.</p>' + fold('The rules, checks and limits', m.order.length + ' patterns, ' + Object.keys(m.modifiers).length + ' conditions that add to a menu, and what the patterns do not show', 
        list(m.order.map(function (t) { return pill(t) + ' ' + esc(m.types[t].rule); }).concat(Object.keys(m.modifiers).map(function (k) { return '<strong>' + esc(m.modifiers[k].label) + ':</strong> ' + esc(m.modifiers[k].rule) + ' Adds to the menu; does not change the pattern.'; }))) +
        sec('mt-checks', 'Checks', list(['<strong>Stability under seasonal-share uncertainty: ' + Math.round(v.stable_80_share * 100) + '% of places keep their pattern in at least 80% of redraws.</strong> ' + esc(v.stability),
          '<strong>Cluster check: ' + v.cluster_check.adjusted_rand.toFixed(2) + '.</strong> ' + esc(v.cluster_check.reading) + ' Groups found by ' + esc(v.cluster_check.method) + ' (' + v.cluster_check.places + ' places) only partly match the written patterns, which is why the patterns are rules you can read rather than clusters.']), 3) +
        sec('mt-not', 'What this does not show', list(m.limits.map(esc).concat([esc(m.menu_note)])), 3) +
        '<p class="note">Sources: ' + m.sources.map(function (x) { return '<code>' + esc(x) + '</code>'; }).join(' · ') + '</p>' +
        src('COHO market pattern', DD + '#tab-types', m.generated_at ? day(m.generated_at) : '')));
  }

  // ---------- 14. Policy timeline ----------
  function timeline(d) {
    var ev = d.timeline.events.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return sec('pt', 'Policy and economic milestones', '<p>Historical events provide context, not current funding availability.</p>' +
      fold('Read the timeline and official sources', ev.length + ' events, ' + ev[0].date.slice(0, 4) + ' to ' + ev[ev.length - 1].date.slice(0, 4), '<ol class="dd-timeline">' + ev.map(function (e) {
        return '<li><p class="dd-tl-when">' + esc(day(e.date)) + ' · ' + esc(e.status) + '</p><p class="dd-tl-what"><strong>' + esc(e.title) + '</strong></p><p>' + esc(e.detail) + '</p><p class="note">' + ext(e.source_url, 'Source') + (e.verified ? ' checked ' + esc(day(e.verified)) : '') + '</p></li>';
      }).join('') + '</ol>', true));
  }

  // ---------- the page: fourteen chapters, each folded, one open ----------
  // Every chapter is drawn into the page and folded; the bar at the top opens one and moves to it, and the
  // address keeps it (tab=), so a link opens on the chapter it names. Folded rather than hidden, so the page
  // reads top to bottom with every chapter open, prints whole and works without the bar.
  var F = {
    fred: 'data/fred-data.json', alloc: 'data/allocations.json', lihtc: 'data/chfa-lihtc.json', aamd: 'data/market/aamd-denver-vacancy.json', bounds: 'data/co-county-boundaries.json',
    qct: 'data/qct-colorado.json', dda: 'data/dda-colorado.json', hud: 'data/hud-fmr-income-limits.json', gap: 'data/co_ami_gap_by_county.json', fc: 'data/market/colorado-foreclosure-performance.json',
    ind: 'data/co-county-economic-indicators.json', cascade: 'data/hna/home-value-cascade.json', nov: 'data/market/novogradac-equity-pricing.json', p123: 'data/policy/prop123_jurisdictions.json',
    hmdaState: 'data/hmda/co-state-trends.json', hmdaCounty: 'data/hmda/co-county-aggregates.json', tracts: 'data/market/acs_tract_metrics_co.json', cent: 'data/market/tract_centroids_co.json',
    chas: 'data/hna/chas_affordability_gap.json', demo: 'data/co-demographics.json', cdemo: 'data/co-county-demographics.json', acsState: 'data/census-acs-state.json', cc: 'data/market/co-construction-labor-cost.json',
    round: 'data/affordable-housing/chfa-awards/2026-round-one.json', guide: 'data/policy/co-developer-funding-guide.json', limits: 'data/chfa-income-rent-limits-2026.json', props: 'data/affordable-housing/lihtc/chfa-properties.json',
    pricing: 'data/market/lihtc-equity-pricing-history.json', fvn: 'data/derived/funding-vs-need.json', aa: 'data/hna/chas_affordable_available.json', zori: 'data/market/zori_rents_co.json', dir: 'data/market/market-direction.json', mt: 'data/market/market-types.json', timeline: 'data/policy/policy-timeline.json'
  };
  var TABS = [
    ['deepdive', 'Deep dive', 'The map of tax credit projects, QCTs and DDAs, and Colorado home prices', overview],
    ['ami-gap', 'AMI gap', 'Income limits and the gap between households and homes priced for them', amiGap],
    ['market-trends', 'Market trends', 'Concessions, foreclosures, builder confidence, metro prices, county ratios', trends],
    ['snapshot', 'Colorado snapshot', 'Key metrics, the policy simulator, Prop 123, CAR and mortgage lending', snapshot],
    ['affordability-geo', 'Affordability geography', 'Rent against income by tract, cost burden by county', geography],
    ['signals', 'Market signals', 'Demand, supply, affordable inventory, risk, policy and the economy, statewide or by county', signals],
    ['construction', 'Construction labor and costs', 'Wages, labor availability and material prices, month by month', construction],
    ['history', 'Historical trends', 'CHFA awards by credit type, stock growth, project size and a peer benchmark', history],
    ['funding', 'Funding sources', 'Every program that finances Colorado affordable housing, with a finder', funding],
    ['market', 'Market overview', 'The 2026 allocation, credit pricing, metro breakdown and CHFA priorities', market],
    ['need', 'Funding vs need', 'Where tax credits and Prop 123 money went, against need', need],
    ['direction', 'Market direction', 'Which county and town markets are growing, and which are weakening', direction],
    ['patterns', 'Market patterns', 'What kind of market each county and town is, and what tends to work there', patterns],
    ['timeline', 'Policy timeline', 'Policy and economic milestones, with sources', timeline]
  ];
  function chapter(t, d, params, open) {
    var body;
    try { body = t[3](d, params); } catch (e) { body = '<p class="note">This chapter could not be drawn (' + esc(e.message) + '). The rest of the page is unaffected; the original page is ' + ext(DD, 'Colorado Deep Dive') + '.</p>'; if (global.console) console.error(e); }
    return '<details class="dd-chapter" id="dd-ch-' + t[0] + '" data-dd-chapter="' + t[0] + '"' + (open ? ' open' : '') + '><summary><span class="dd-ch-title">' + esc(t[1]) + '</span><span class="dd-ch-take">' + esc(t[2]) + '</span></summary><div class="dd-ch-body">' + body + '</div></details>';
  }
  function view(params) {
    var title = 'Colorado deep dive';
    var idx = UI.load({ car: 'data/car-market-reports.json' });
    var s = idx.data ? UI.load(Object.assign({ car: 'data/car-market-report-' + idx.data.car.latest + '.json' }, F)) : idx;
    // The page story (paul 11-06): lead with what the statewide figures show, not the list of chapters.
    // The page story (paul 11-06): lead with the statewide finding. Not the funding groups: they leave out most
    // 4% bond deals on pins before HA #2726 (see ledgerNote), so they cannot carry the headline.
    var lede = function () {
      var R = global.LabRentIncome && global.LabRentIncome.rows(), x = R && !R.error && R.geo && R.geo['08'], o = x && global.LabRentIncome.over(R, x, '2000');
      if (!o || o.fell) return 'Statewide figures for Colorado: tax credit projects and awards, rents against income, costs, funding against need, and the market in each county and town.';
      return 'Since 2000, the typical Colorado rent rose ' + Math.round(o.rp * 100) + '% and household income ' + Math.round(o.ip * 100) + '%. Below: rents against income, where tax credit homes went, costs, and the market in each county.';
    };
    var head = function (facts, d) {
      return T.head({ kind: 'data', crumbs: T.trail('places', title), title: title,
        answer: esc(lede(d)),
        meta: '<span class="scope-tag">Scope: Colorado and its counties</span> Every figure is read from the site’s own data files and carries its source and date.', facts: facts, dated: d });
    };
    if (!s.data) return head([]) + (s.error ? '<p class="note">' + esc(s.error) + '</p>' : '<p role="status" class="note">Loading the Colorado data…</p>');
    var d = s.data, on = params.get('tab') || (params.get('quad') ? 'need' : 'deepdive');
    if (!TABS.some(function (t) { return t[0] === on; })) on = 'deepdive';
    var co = d.alloc.states.CO, st = d.gap.statewide, sw = d.fvn.statewide, w = d.fvn.meta.window;
    return head([
        { value: compact(co.allocation), label: d.alloc.year + ' federal housing credit ceiling ($' + co.perCapita.toFixed(2) + ' per resident)', source: 'IRS', href: d.alloc.source && d.alloc.source.url },
        chas30(d) ? { value: num(chas30(d).homes_short), label: 'Homes short for renters at or below 30% AMI', source: 'HUD CHAS ' + chasYears(d), href: CHAS_URL } : null,
        { value: num(-st.gap_units_minus_households_le_ami_pct[30]), label: 'The same on the ACS count (another measure), used for the county groups', source: 'ACS ' + d.gap.meta.acs_year + ' with HUD limits', href: d.gap.sources[2] && d.gap.sources[2].url },
        { value: num(sw.lihtc_units), label: hasBonds(sw) ? 'Tax credit homes CHFA awarded, ' + w.first_year + '–' + w.last_year + ', rounds and 4% bond deals' : 'Tax credit homes in CHFA round award reports, ' + w.first_year + '–' + w.last_year + ' (4% bond deals outside the rounds not included)', source: 'CHFA award reports', href: '#/money?agency=CHFA' }
      ].filter(Boolean), d) +
      fold('About this page', 'What it does, why it matters, and what it does not do', '<p><strong>What this page does.</strong> ' + esc(STATIC.about[0]) + '</p><p><strong>Why it matters.</strong> ' + esc(STATIC.about[1]) + '</p><p><strong>What this page does not do.</strong> ' + esc(STATIC.about[2]) + '</p>' +
        '<p>Next: <a href="#/places/ranking">compare jurisdictions</a> to rank geographies by housing need, or <a href="#/places">find a place</a> to start a local housing needs assessment.</p>') +
      '<section class="dd-glance" aria-labelledby="dd-glance-h"><h2 id="dd-glance-h">Funding against need, at a glance</h2>' + glanceNote(d.fvn) + '<p class="note">' + esc(ledgerNote(d.fvn.statewide)) + '</p>' + '<div class="agency-cards">' + ['underserved', 'aligned', 'funded-above-need', 'low-need-low-funding'].map(function (k) {
        return '<a class="agency-card" href="#/places/deep-dive?tab=need&amp;quad=' + k + '"><p class="lever-title">' + esc(QUAD[k][0]) + '</p><p class="metric-value">' + num(sw.quadrants[k]) + ' counties</p><p class="dq-what">' + esc(QUAD[k][1]) + '</p></a>';
      }).join('') + '</div></section>' +
      // One clear next page above the chapters (usage report, 26 Oct to 1 Nov: pages per visit fell to 1.4).
      '<section class="dd-rent" aria-labelledby="dd-rent-h"><h2 id="dd-rent-h">Rent against income, 1980 to today</h2>' + (global.LabRentIncome ? global.LabRentIncome.widget('deep') : '') + '</section>' +
      T.means([
        { text: 'Tax credit homes are the main way Colorado adds rentals for low incomes. Where they fall short of need, the lowest-income renters have the fewest homes they can afford.' },
        hasBonds(sw) ? { text: 'The four groups count round awards and 4% bond deals together, so counties that rely on bond deals show their full funding.' }
          : { text: 'The four groups count CHFA\u2019s round award reports only. Most 4% bond deals are approved outside the rounds and are not in those reports, so counties that rely on bond deals look less funded than they are.' }
      ]) +
      T.next('What to do next', [{ href: '#/places', label: 'Open a county or town’s full needs assessment →' }, { href: '#/places/attract-housing', label: 'What a town can do first', secondary: true }]) +
      '<nav class="dd-tabs" aria-label="Chapters"><div role="tablist" aria-label="Colorado deep dive chapters">' + TABS.map(function (t) {
        return '<button type="button" role="tab" id="dd-tab-' + t[0] + '" aria-controls="dd-ch-' + t[0] + '" aria-selected="' + (t[0] === on) + '" tabindex="' + (t[0] === on ? 0 : -1) + '" data-dd-tab="' + t[0] + '">' + esc(t[1]) + '</button>';
      }).join('') + '</div></nav>' +
      '<div class="dd-chapters">' + TABS.map(function (t) { return chapter(t, d, params, t[0] === on); }).join('') + '</div>' +
      '<p class="note">' + esc(STATIC.disclaimer) + '</p>' +
      T.source('COHO data files: CHFA, HUD, Census ACS and BPS, BLS, FHFA via FRED, Zillow, AAMD, CAR, CFPB HMDA, DOLA and the COHO funding guide', DD, day(d.fvn.meta.generatedAt)) +
      T.next('More to read', [{ href: '#/places/ranking', label: 'Every place ranked →' }, { href: '#/money', label: 'Where the state\u2019s housing money went', secondary: true }]);
  }

  // ---------- page events: chapter bar, pickers, comparison ----------
  // global.history, not history: this file has its own history() chapter, which hides the browser's.
  function setParam(k, v) {
    var h = location.hash.replace(/^#/, ''), i = h.indexOf('?'), path = i < 0 ? h : h.slice(0, i), p = new URLSearchParams(i < 0 ? '' : h.slice(i + 1));
    if (v == null || v === '') p.delete(k); else p.set(k, v);
    var qs = p.toString();
    global.history.replaceState(null, '', '#' + path + (qs ? '?' + qs : ''));
  }
  function onDeepDive() { return /^#\/places\/deep-dive(\?|$)/.test(location.hash); }
  function openTab(id, focus) {
    var ch = document.getElementById('dd-ch-' + id); if (!ch) return;
    document.querySelectorAll('[data-dd-tab]').forEach(function (b) { var me = b.getAttribute('data-dd-tab') === id; b.setAttribute('aria-selected', me); b.tabIndex = me ? 0 : -1; if (me && focus) b.focus(); });
    // A tab shows its own chapter: the others fold, so the chapter lands right under the bar. A chapter title still
    // opens and folds on its own, for readers who want two side by side.
    document.querySelectorAll('details.dd-chapter').forEach(function (c) { c.open = c === ch; });
    setParam('tab', id);
    var still = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ch.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
  }
  function redraw(focusId) {
    var y = global.scrollY; Shell.render();
    global.scrollTo(0, y);
    if (focusId) { var el = document.getElementById(focusId); if (el) el.focus(); }
  }
  document.addEventListener('click', function (e) {
    if (!onDeepDive()) return;
    var t = e.target.closest && e.target.closest('[data-dd-tab]');
    if (t) { e.preventDefault(); openTab(t.getAttribute('data-dd-tab')); return; }
    var c = e.target.closest && e.target.closest('[data-dd-cmp]');
    if (c) {
      var h = location.hash, i = h.indexOf('?'), p = new URLSearchParams(i < 0 ? '' : h.slice(i + 1)), list = (p.get('fcmp') || '').split(',').filter(Boolean), id = c.getAttribute('data-dd-cmp');
      if (!id) list = []; else if (list.indexOf(id) !== -1) list = list.filter(function (x) { return x !== id; }); else if (list.length < 3) list.push(id);
      setParam('fcmp', list.join(',')); setParam('tab', 'funding'); redraw();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (!onDeepDive()) return;
    var t = e.target.closest && e.target.closest('[data-dd-tab]'); if (!t) return;
    var all = Array.prototype.slice.call(document.querySelectorAll('[data-dd-tab]')), i = all.indexOf(t), n = null;
    if (e.key === 'ArrowRight') n = all[(i + 1) % all.length]; else if (e.key === 'ArrowLeft') n = all[(i - 1 + all.length) % all.length]; else if (e.key === 'Home') n = all[0]; else if (e.key === 'End') n = all[all.length - 1];
    if (n) { e.preventDefault(); n.focus(); }
  });
  document.addEventListener('change', function (e) {
    if (!onDeepDive()) return;
    var el = e.target, k = el.getAttribute && (el.getAttribute('data-dd-pick') || el.getAttribute('data-dd-num'));
    if (!k) return;
    var ch = el.closest('[data-dd-chapter]');
    setParam(k, el.value); if (ch) setParam('tab', ch.getAttribute('data-dd-chapter'));
    redraw(el.id);
  });
  document.addEventListener('toggle', function (e) {
    if (!onDeepDive() || !e.target.matches || !e.target.matches('details.dd-chapter') || !e.target.open) return;
    var id = e.target.getAttribute('data-dd-chapter');
    document.querySelectorAll('[data-dd-tab]').forEach(function (b) { var me = b.getAttribute('data-dd-tab') === id; b.setAttribute('aria-selected', me); b.tabIndex = me ? 0 : -1; });
  }, true);

  global.LabDeepDive = { view: view, TABS: TABS.map(function (t) { return t[0]; }), STATIC: STATIC };
})(window);
