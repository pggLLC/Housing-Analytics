// Places and need: the hub as questions with figures, and a lab page for each Colorado place.
// Every figure is read from the pinned public data files as published; the only arithmetic here is
// turning the gap file's sign convention into "households minus homes" and summing CHFA's property list.
(function (global) {
  'use strict';

  var Shell = global.LabShell;
  var esc = Shell.esc;
  var VENDOR = global.LAB_VENDOR;
  // A port into the public site sets LAB_LIVE to its own root, so these links stay on that site.
  var LIVE = global.LAB_LIVE != null ? global.LAB_LIVE : 'https://cohoanalytics.com/';

  var FILES = {
    gapPlace: 'data/co_ami_gap_by_place.json',
    gapCounty: 'data/co_ami_gap_by_county.json',
    rent: 'data/market/acs_median_rent_co.json',
    hud: 'data/hud-fmr-income-limits.json',
    chfa: 'data/chfa-income-rent-limits-2026.json',
    lihtc: 'data/chfa-lihtc.json',
    chas: 'data/market/chas_co.json',
    aa: 'data/hna/chas_affordable_available.json',
    counties: 'data/boundaries/counties_co.geojson'
  };

  // What geography a figure is, and how it was derived. The wording, levels and single-tract caveat are the
  // public site's own (js/hna/geography-provenance.js). Three levels are the lab's, for readings the HNA digest
  // marks but that module does not name yet: 'estimate' (a town figure modeled from wider data, such as the
  // county forecast applied to the town), 'index' (a score or tier the HNA builds from several measures) and
  // 'area' (a count over a radius around the place).
  var LAB_LEVELS = {
    estimate: function (o) {
      return { level: 'estimate', label: 'Estimate', tone: 'derived',
        title: (o.metric || 'This figure') + ' is estimated for ' + (o.where || 'this place') + ' from ' + (o.from || 'wider data') + '. It is not measured here.' };
    },
    index: function (o) {
      return { level: 'index', label: 'HNA reading', tone: 'neutral',
        title: (o.metric || 'This figure') + ' is a reading the HNA builds from several measures. It is not a count or a measurement.' };
    },
    // Round-three review, 11-10: a figure COHO works out from published inputs is not "measured directly",
    // and is not a place's or county's "own published figure". The badge names the method, not only the geography.
    calculated: function (o) {
      return { level: 'calculated', label: 'Calculated', tone: 'derived',
        title: (o.metric || 'This figure') + ' is calculated by COHO from published figures for ' + (o.where || 'this place') + (o.from ? ' (' + o.from + ')' : '') + '. The agencies publish the inputs, not this result.' };
    },
    area: function (o) {
      return { level: 'area', label: 'Nearby area', tone: 'neutral',
        title: (o.metric || 'This figure') + ' covers ' + (o.area || 'the area around the place') + ', not only the place itself.' };
    }
  };
  function scope(o) {
    if (!o) return '';
    var GP = global.GeographyProvenance;
    var d = LAB_LEVELS[o.level] ? LAB_LEVELS[o.level](o) : GP ? GP.describe(o) : null;
    if (!d) return '';
    if (o.title) d.title = o.title;
    return '<span class="geo-chip" data-geo-level="' + esc(d.level) + '" data-tone="' + esc(d.tone) + '" title="' + esc(d.title) + '">' + esc(d.label) + '</span>' +
      '<span class="visually-hidden">. ' + esc(d.title) + '</span>';
  }
  // Common scopes on these pages.
  var AT = {
    place: { level: 'place' },
    countyLimit: function (county) { return { level: 'county', title: 'HUD and CHFA set this limit for all of ' + (county || 'the county') + '. It applies to the place as published.' }; },
    countyProxy: function (county) { return { level: 'county-proxy', countyName: county }; },
    county: { level: 'county' },
    state: { level: 'state' },
    gap: function (isCounty) { return { level: 'calculated', where: isCounty ? 'this county' : 'this place', from: 'Census household incomes and rents against HUD income limits' }; }
  };

  // Tools for any place, grouped by the question a visitor brings. Anything in the hub that is not
  // named here still appears under "More tools", so no page drops out of the lab.
  var QUESTIONS = [
    { title: 'How much housing does this place need?', paths: ['hna-scenario-builder.html'], folded: { label: 'The Housing Needs Assessment chapters, each on its own page', note: 'Every place page carries these chapters as tabs.', paths: ['housing-needs-assessment.html', 'hna-who-lives-here.html', 'hna-what-housing-exists.html', 'hna-what-households-can-afford.html', 'hna-where-its-heading.html', 'hna-what-to-do.html'] } },
    { title: 'How does it compare with other places?', paths: ['compare.html', 'hna-comparative-analysis.html', 'colorado-deep-dive.html', 'article-co-housing-costs.html', 'census-dashboard.html'] },
    { title: 'What shapes costs and local policy?', paths: ['local-incentives.html', 'economic-dashboard.html', 'construction-commodities.html'] },
    { title: 'Find a place another way', paths: ['select-jurisdiction.html', 'places/index.html'] }
  ];
  var BANDS = ['30', '40', '50', '60', '70', '80', '100'];

  var data = null, loading = false, error = null;
  function load() {
    if (data || loading || error) return;
    loading = true;
    var keys = Object.keys(FILES);
    Promise.all(keys.map(function (k) {
      return fetch(VENDOR + FILES[k]).then(function (r) { if (!r.ok) throw new Error(FILES[k] + ' ' + r.status); return r.json(); });
    })).then(function (all) {
      data = {};
      keys.forEach(function (k, i) { data[k] = all[i]; });
      Shell.render();
    }).catch(function (e) {
      error = 'The data did not load (' + e.message + '). Reload the page to try again.';
      Shell.render();
    });
  }

  var num = function (n) { return n == null ? null : Math.round(n).toLocaleString('en-US'); };
  var money = function (n) { return n == null ? null : '$' + Math.round(n).toLocaleString('en-US'); };

  // The place file counts households minus homes; the county file counts homes minus households.
  // Both say so in meta.gap_sign. netGap returns the signed difference, households minus homes, which is
  // negative where homes outnumber renters. shortfall is never below zero: the renters left over, or 0.
  // Stored values are read as they are; only the labels tell the two apart.
  function netGap(rec, band, gapSign) {
    var g = rec && rec.gap_units_minus_households_le_ami_pct && rec.gap_units_minus_households_le_ami_pct[band];
    if (g == null) return null;
    if (gapSign === 'households_minus_units') return g;
    if (gapSign === 'units_minus_households') return -g;
    throw new Error('Unknown gap sign ' + gapSign);
  }
  function shortfall(rec, band, gapSign) {
    var n = netGap(rec, band, gapSign);
    return n == null ? null : Math.max(0, n);
  }

  function countyFacts(fips, d) {
    var county = d.gapCounty.counties.filter(function (c) { return c.fips === fips; })[0] || null;
    var hud = d.hud.counties.filter(function (c) { return c.fips === fips; })[0] || null;
    var chas = d.chas.records.filter(function (c) { return c.fips === fips; })[0] || null;
    var props = d.lihtc.features.filter(function (f) { return f.properties.CNTY_FIPS === fips && f.properties.ComplianceStatus === 'Active Compliance'; });
    var chfaRent = global.ChfaRentLimits ? global.ChfaRentLimits.maxGrossRent(d.chfa, fips, 60, '2BR', {}) : null;
    return {
      county: county, hud: hud, chas: chas,
      properties: props.length,
      lowIncomeHomes: props.reduce(function (t, f) { return t + (f.properties.LI_UNITS || 0); }, 0),
      chfa60two: chfaRent && chfaRent.grossRent != null ? chfaRent.grossRent : null
    };
  }

  // A county reads the county gap file, whose sign is the opposite of the place file's (see shortfall).
  function placeFacts(geoid, d) {
    var isCounty = String(geoid).length === 5;
    var rec = isCounty ? d.gapCounty.counties.filter(function (c) { return c.fips === geoid; })[0] : d.gapPlace.places[geoid];
    if (!rec) return null;
    if (isCounty) rec = Object.assign({ place_name: rec.county_name, containing_county_fips: rec.fips }, rec);
    var rent = (isCounty ? d.rent.counties : d.rent.places)[geoid] || null;
    var sign = isCounty ? d.gapCounty.meta.gap_sign : d.gapPlace.meta.gap_sign;
    return {
      geoid: geoid, rec: rec, rent: rent, sign: sign, at: AT.gap(isCounty),
      bands: BANDS.map(function (b) {
        return { band: b, at: AT.gap(isCounty), households: rec.households_le_ami_pct[b], homes: rec.units_priced_affordable_le_ami_pct[b], net: netGap(rec, b, sign), shortfall: shortfall(rec, b, sign), rent: rec.affordable_rent_monthly[b], matched: matched(rec, b) };
      }),
      noCash: rec.renter_units_no_cash_rent,
      county: countyFacts(rec.containing_county_fips, d)
    };
  }

  // The file's matched minimum: each home counts only for households who can afford it, cheapest homes to the
  // lowest incomes first, and homes rented for no cash rent count too. It is what the live homepage headlines.
  function matched(rec, b) {
    var m = rec.min_shortfall_matched_le_ami_pct;
    var v = m ? m[b] : null;
    return typeof v === 'number' && isFinite(v) && v >= 0 ? v : null;
  }

  // Public source pages for the figures on these pages. Each data file's own URL is used where it has one.
  var SRC = {
    acsGap: 'https://data.census.gov/table/ACSDT5Y2024.B25118',
    acsRent: 'https://data.census.gov/table/ACSDT5Y2024.B25064',
    hudIl: 'https://www.huduser.gov/portal/datasets/il.html'
  };

  // A source line: text and link, or a list of [text, url] pairs joined with a dot.
  function srcLine(source, url) {
    var parts = Array.isArray(source) ? source : [[source, url]];
    return parts.map(function (x) {
      return x[1] ? '<a href="' + esc(x[1]) + '" rel="noopener">' + esc(x[0]) + '</a>' : esc(x[0]);
    }).join(' · ');
  }

  function card(title, value, detail, source, url, at) {
    return '<div class="metric"><p class="metric-label">' + esc(title) + '</p>' + (at && value != null ? '<p class="metric-scope">' + scope(at) + '</p>' : '') +
      (value == null ? '<p class="metric-value unavailable">Not published</p>' : '<p class="metric-value">' + esc(value) + '</p>') +
      (detail ? '<p class="metric-detail">' + esc(detail) + '</p>' : '') +
      '<p class="metric-source">' + srcLine(source, url) + '</p></div>';
  }

  // The net count (households minus homes priced for them) is signed and is not a count of households without a
  // home: some of those homes are rented by higher-income households. The card shows the signed difference, names
  // the shortfall (never below zero) beside it, and gives the matched minimum.
  function gapCard(b, at) {
    at = at || b.at || AT.gap(false);
    var src = [['Census ACS 2020–2024', SRC.acsGap], ['HUD FY2026 income limits', SRC.hudIl]];
    var title = 'Renter households minus homes priced for them, at or below ' + b.band + '% AMI';
    if (b.net == null) return card(title, null, null, src, null, at);
    var signed = (b.net > 0 ? '+' : b.net < 0 ? '\u2212' : '') + num(Math.abs(b.net));
    var short = b.net < 0 ? 'Shortfall: 0, since homes outnumber renters here.' : 'Shortfall: ' + num(b.shortfall) + ' renter households.';
    var min = b.matched == null ? '' : ' Matching each home to the households who can afford it, at least ' + num(b.matched) + ' homes are short.';
    return card(title, signed,
      'Signed difference. ' + short + ' ' + num(b.households) + ' renter households, ' + num(b.homes) + ' homes priced for them. Some of those homes are rented by higher-income households.' + min,
      src, null, at);
  }

  // Two series per income band: renter households (demand) and homes priced within their reach (supply).
  // Bands are cumulative, "at or below", as the source file publishes them.
  // Each band on its own (paul 10-26: "should also show the number in that category, not just cumulative"):
  // the published files count everyone at or below each band, so a band's own count is the difference from
  // the band below. Running totals stay beside each row.
  function bandsOwn(bands) {
    return bands.map(function (b, i) {
      var p = bands[i - 1];
      var own = function (k) { return b[k] == null || (p && p[k] == null) ? null : b[k] - (p ? p[k] : 0); };
      return { band: b.band, from: p ? p.band : null, rent: b.rent, fromRent: p ? p.rent : null, households: own('households'), homes: own('homes'), cumHouseholds: b.households, cumHomes: b.homes };
    });
  }
  function gapChart(f, at, d) {
    d = d || data;
    var cRec = f.rec && d && d.gapCounty && d.gapCounty.counties.filter(function (c) { return c.fips === f.rec.containing_county_fips; })[0];
    var county = cRec && cRec.fips !== f.rec.fips ? { name: cRec.county_name, households: cRec.households_le_ami_pct['30'], homes: cRec.units_priced_affordable_le_ami_pct['30'] } : null;
    var rows = bandsOwn(f.bands);
    var max = Math.max.apply(null, rows.map(function (b) { return Math.max(b.households || 0, b.homes || 0); })) || 1;
    var name = f.rec && f.rec.place_name ? f.rec.place_name.replace(/ (town|city|CDP)$/, '') : null;
    var label = function (b) { return b.from == null ? 'Up to ' + b.band + '% AMI' : b.from + '\u2013' + b.band + '% AMI'; };
    var bar = function (cls, v, what, b) {
      var w = v == null ? 0 : Math.max(Math.max(v, 0) / max * 100, v > 0 ? 0.5 : 0);
      return '<div class="bar-row"><span class="bar ' + cls + '" style="width:calc((100% - 7rem) * ' + (w / 100).toFixed(4) + ')" title="' + esc(what + ', ' + label(b) + ': ' + num(v)) + '"></span>' +
        '<span class="bar-value">' + esc(num(v)) + '</span></div>';
    };
    var first = rows[0], lead = '';
    if (first && first.households > 0 && first.homes != null) {
      var short = first.households - first.homes, r = first.homes / first.households * 10;
      var cr = county && county.households > 0 && county.homes != null ? county.homes / county.households * 10 : null;
      lead = (name || 'This place') + (short > 0 ? ' has ' + num(short) + ' more renter households at or below 30% AMI than homes priced for them' : ' has as many homes priced for renters at or below 30% AMI as such renters') +
        ': ' + r.toFixed(1) + ' homes for every 10' + (cr != null ? ' (' + county.name + ': ' + cr.toFixed(1) + ')' : '') + '.';
    }
    // Gemini round 16, picks 1 and 2 (paul 11-05): the finding is the title, and the figure's label is the
    // finding plus its source, so a reader who sees only the graphic gets both.
    var what = 'Renter households and the homes priced for them, by income' + (name ? ', ' + name : '');
    return '<figure class="gap-chart"' + (lead ? ' aria-label="' + esc((global.LabTpl && global.LabTpl.alt || function (f, s) { return f + '. Source: ' + s + '.'; })(lead, 'Census ACS, HUD')) + '"' : ' aria-labelledby="gap-chart-title"') + '>' +
      '<figcaption id="gap-chart-title"><strong>' + esc(lead || what) + '</strong>' + (lead ? '<span class="gap-what">' + esc(what) + '</span>' : '') + scope(at || f.at || AT.gap(false)) +
      '<span class="note">Each row is one income band. A home is priced for a band when its gross rent is no more than 30% of the band\u2019s income limit; renters with higher incomes can also rent it. Running totals, at or below each band, are under each label.</span></figcaption>' +
      '<ul class="legend"><li><span class="key households"></span>Renter households in the band</li><li><span class="key homes"></span>Homes priced for the band</li></ul>' +
      '<div class="gap-rows">' + rows.map(function (b) {
        return '<div class="gap-row"><p class="gap-band">' + esc(label(b)) + '<span class="note">Rent ' + esc(b.fromRent == null ? 'up to ' + money(b.rent) : money(b.fromRent + 1) + '\u2013' + money(b.rent)) + '</span>' +
          '<span class="note gap-cum">At or below: ' + esc(num(b.cumHouseholds)) + ' renters, ' + esc(num(b.cumHomes)) + ' homes</span></p>' +
          '<div class="gap-bars">' + bar('households', b.households, 'Renter households', b) + bar('homes', b.homes, 'Homes priced for the band', b) + '</div></div>';
      }).join('') + '</div><p class="metric-source">' + srcLine([['Census ACS 2020\u20132024', SRC.acsGap], ['HUD FY2026 income limits', SRC.hudIl]]) + '</p></figure>';
  }

  // Gemini round 10, pick B (paul 11-05): the affordability ladder, a strip under 200 px for the first phone
  // screen. Homes priced for renters per 100 renter households, at or below 30%, 50%, 80% and 100% AMI, read from
  // the same cumulative bands as the chart below it, with each value written on its bar (round 10, pick A).
  function ladder(f) {
    var steps = (f.bands || []).filter(function (b) { return ['30', '50', '80', '100'].indexOf(String(b.band)) > -1 && b.households > 0 && b.homes != null; });
    if (steps.length < 2) return '';
    var name = f.rec && f.rec.place_name ? f.rec.place_name.replace(/ (town|city|CDP)$/, '') : 'This place';
    var per = function (b) { return Math.round(b.homes / b.households * 100); };
    var first = steps[0], short = first.households - first.homes;
    var finding = name + ': ' + per(first) + ' homes for every 100 renter households at or below 30% AMI' + (short > 0 ? ', ' + num(short) + ' short' : '');
    var src = 'Census ACS 2020\u20132024, HUD FY2026 income limits';
    return '<figure class="ladder" aria-label="' + esc((global.LabTpl && global.LabTpl.alt || function (f, s) { return f + '. Source: ' + s + '.'; })(finding, 'Census ACS, HUD')) + '">' +
      '<figcaption><strong>' + esc(finding) + '</strong></figcaption>' +
      // "Homes short" as dots (Gemini round 5, question 19; big visual pass 11-06): 100 renter households at or below
      // 30% AMI, filled where a home is priced for them. Desktop only; the bars carry the same figure on a phone.
      '<div class="ladder-dots" aria-hidden="true"><span class="ld-grid">' + (function () { var k = Math.min(100, per(first)), o = ''; for (var i = 0; i < 100; i++) o += '<i' + (i < k ? ' class="on"' : '') + '></i>'; return o; })() + '</span>' +
      '<span class="ld-key"><span><i class="on"></i>a home priced for them</span><span><i></i>no home</span><span>per 100 renter households, \u226430% AMI</span></span></div>' +
      '<ul class="ladder-rows" aria-hidden="true">' + steps.map(function (b) {
        var v = per(b), gap = b.households - b.homes;
        return '<li><span class="ladder-l">\u2264' + esc(String(b.band)) + '% AMI</span><span class="ladder-t"><span class="ladder-b' + (v < 100 ? ' is-short' : '') + '" style="width:' + Math.min(100, v / 1.5).toFixed(1) + '%"></span><span class="ladder-100" title="100 homes per 100 renters"></span></span>' +
          '<span class="ladder-v"><b>' + v + '</b> per 100' + (gap > 0 ? ' \u00b7 ' + esc(num(gap)) + ' short' : '') + '</span></li>';
      }).join('') + '</ul><p class="metric-source">Homes priced for renters per 100 renter households, at or below each income; the black tick is 100. ' + srcLine([['Census ACS 2020\u20132024', SRC.acsGap], ['HUD FY2026 income limits', SRC.hudIl]]) + '</p></figure>';
  }

  function useHref(entry) {
    return '#/use?' + String(new URLSearchParams({ kind: 'place-reference', geoid: entry.geoid, label: entry.label, href: entry.href, from: location.hash || '#/' }));
  }

  // A place row: links to the lab place page; the figure underneath is the 30% AMI shortfall when published.
  function placeRow(entry, d) {
    var rec = d && d.gapPlace.places[entry.geoid];
    var s = rec ? shortfall(rec, '30', d.gapPlace.meta.gap_sign) : null;
    var line = rec ? num(rec.renter_households_total) + ' renter households' + (s != null ? (s > 0 ? ' · ' + num(s) + ' short at or below 30% AMI' : ' · no shortfall at or below 30% AMI') : '') : null;
    return '<li><a href="#/place/' + esc(entry.geoid) + '" data-route-path="' + esc(entry.path) + '">' + esc(entry.label) + '</a>' +
      (line ? '<p class="note">' + esc(line) + '</p>' : '') +
      '<a class="use-link" href="' + esc(useHref(entry)) + '">Use in project</a></li>';
  }

  // County map: homes priced for renters at or below 30% AMI, for every 10 such renter households.
  // A ratio of two published counts; darker means fewer homes. The lab's one map ramp (graphics checklist C3),
  // light to dark; the lightest bin is as many homes as renters or more.
  var MAP_BINS = [
    { min: 10, label: '10 or more (as many homes as renters)', fill: 'var(--map-1)' },
    { min: 7, label: '7 to 9.9', fill: 'var(--map-2)' },
    { min: 5, label: '5 to 6.9', fill: 'var(--map-3)' },
    { min: 3, label: '3 to 4.9', fill: 'var(--map-4)' },
    { min: -Infinity, label: 'Under 3', fill: 'var(--map-5)' }
  ];
  // Statewide frame and projection from site/map-kit.js.
  var K = global.LabMap, MAP_W = K.W, MAP_H = K.H;
  function xy(c) { return K.x(c[0]).toFixed(1) + ' ' + K.y(c[1]).toFixed(1); }
  function per10(c) {
    var h = c.households_le_ami_pct && c.households_le_ami_pct['30'], u = c.units_priced_affordable_le_ami_pct && c.units_priced_affordable_le_ami_pct['30'];
    return h > 0 && u != null ? u / h * 10 : null;
  }
  function needMap(d) {
    var byFips = {};
    d.gapCounty.counties.forEach(function (c) { byFips[c.fips] = c; });
    var paths = d.counties.features.map(function (f) {
      var c = byFips[f.properties.GEOID], v = c ? per10(c) : null;
      var bin = v == null ? null : MAP_BINS.filter(function (b) { return v >= b.min; })[0];
      var rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      var tip = f.properties.NAMELSAD + ': ' + (v == null ? 'not published' : v.toFixed(1) + ' homes for every 10 renter households at or below 30% AMI (' + num(c.units_priced_affordable_le_ami_pct['30']) + ' homes, ' + num(c.households_le_ami_pct['30']) + ' households)');
      return '<a href="#/place/' + esc(f.properties.GEOID) + '"><path d="' + rings.map(function (poly) { return poly.map(function (ring) { return 'M' + ring.map(xy).join('L') + 'Z'; }).join(''); }).join('') + '" fill="' + (bin ? bin.fill : 'var(--paper)') + '"><title>' + esc(tip) + '</title></path></a>';
    }).join('');
    return '<figure class="need-map"><figcaption><strong>Homes priced for the lowest-income renters, by county</strong>' +
      '<span class="note">Homes renting for what households at or below 30% AMI can pay, for every 10 such renter households. Darker means fewer homes. Tap or point to a county for its figures; select it to open its needs assessment.</span></figcaption>' +
      '<div class="pm-frame"><svg viewBox="0 0 ' + MAP_W + ' ' + MAP_H + '" role="group" aria-label="Colorado counties shaded by homes priced for renters at or below 30% AMI, per 10 such households">' + paths + K.cities() + '</svg></div>' +
      '<ul class="need-key">' + MAP_BINS.map(function (b) { return '<li><span class="need-swatch" style="background:' + b.fill + '" aria-hidden="true"></span>' + esc(b.label) + '</li>'; }).join('') + '</ul>' +
      '<p class="note">Census ACS 2020\u20132024 and HUD FY2026 income limits, from the site\u2019s county gap file. Small counties have few such households and wide survey margins, so read their shades with care. County outlines: US Census TIGER.</p>' +
      (global.LabVizData ? global.LabVizData.block('Homes priced for the lowest-income renters, by county', ['County', 'Homes per 10 renter households at or below 30% AMI', 'Homes priced for them', 'Renter households at or below 30% AMI'],
        d.counties.features.map(function (f) {
          var c = byFips[f.properties.GEOID], v = c ? per10(c) : null;
          return [f.properties.NAMELSAD, v == null ? null : Math.round(v * 10) / 10, c ? c.units_priced_affordable_le_ami_pct['30'] : null, c ? c.households_le_ami_pct['30'] : null];
        }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; })) : '') + '</figure>';
  }

  // Catalog entry for a place, or one built for a county: the live site has no per-county page in the
  // catalog, only its HNA by GEOID.
  function countyEntries() {
    return data ? data.gapCounty.counties.map(function (c) {
      return { geoid: c.fips, label: c.county_name, role: 'county', hub: 'places', path: 'housing-needs-assessment.html?geoid=' + c.fips, href: LIVE + 'housing-needs-assessment.html?geoid=' + c.fips, status: 'current' };
    }) : [];
  }
  function entryFor(geoid) {
    var e = Shell.catalog().entries.filter(function (x) { return x.geoid === geoid; })[0];
    if (e || String(geoid).length !== 5) return e || null;
    load();
    return countyEntries().filter(function (x) { return x.geoid === geoid; })[0] || null;
  }

  // The four abbreviations a first-time visitor meets on the Places pages, defined once where they first appear.
  var TERMS = '<span class="terms"><b>Terms:</b> <abbr title="census-designated place">CDP</abbr>, a community the Census counts that has no town government. ' +
    '<abbr title="American Community Survey">ACS</abbr>, the Census Bureau\u2019s yearly household survey. ' +
    '<abbr title="U.S. Department of Housing and Urban Development">HUD</abbr>, the federal housing department, which sets income limits. ' +
    '<abbr title="area median income">AMI</abbr>, the middle household income for the area; 30% AMI is 30% of it.</span>';
  // For a visitor who has no place in mind yet: the live picker's three ways in, pointing at their lab pages.
  function notSure() {
    return '<h2>Don\u2019t know your jurisdiction yet?</h2>' +
      '<p class="note">Start from the statewide picture, find the places with the widest gaps, then come back here to open one.</p>' +
      '<ul class="route-list">' +
      '<li><a href="#/places/ranking">Compare all jurisdictions \u2192</a><p class="note">Every county, town and CDP ranked by housing need, cost burden and gap.</p></li>' +
      '<li><a href="#/places/deep-dive">Colorado market overview \u2192</a><p class="note">Regional housing conditions, construction costs and how fast markets move.</p></li>' +
      '<li><a href="#/guide/lihtc-basics">What is a housing tax credit? \u2192</a><p class="note">A plain guide to the Low-Income Housing Tax Credit.</p></li>' +
      '</ul>';
  }
  // The three projects saved most recently in this browser, as the live picker shows them. Nothing leaves the browser.
  function recentProjects() {
    var P = global.LabProjects, list = [];
    try { list = P ? P.list() : []; } catch (e) { list = []; }
    var recent = list.slice().sort(function (a, b) { return String(b.savedAt || '').localeCompare(String(a.savedAt || '')); }).slice(0, 3);
    return { has: recent.length > 0, html: '<h2>Recent projects</h2>' + (recent.length ?
      '<ul class="route-list">' + recent.map(function (p) {
        return '<li><a href="#/project/' + esc(p.projectId) + '">' + esc(p.name) + ' \u2192</a><p class="note">' +
          esc((p.jurisdiction ? p.jurisdiction.name : 'No place picked yet') + (p.savedAt ? ' \u00b7 saved ' + String(p.savedAt).slice(0, 10) : ' \u00b7 not saved yet')) + '</p></li>';
      }).join('') + '</ul>' :
      '<p class="note">No projects in this browser yet. Projects you start from a place page are kept here, in this browser only, so you can pick up where you left off.</p>') };
  }

  function placesView(params) {
    var catalog = Shell.catalog();
    load();
    var q = params.get('q') || '';
    var all = catalog.entries.filter(function (e) { return e.hub === 'places'; });
    var profiles = countyEntries().concat(all.filter(function (e) { return e.role === 'generated-place'; }));
    var tools = all.filter(function (e) { return e.role !== 'generated-place'; });
    // Pages the lab has rebuilt open in the lab, not on the live site.
    var IN_LAB = { 'compare.html': '#/places/compare', 'hna-comparative-analysis.html': '#/places/ranking', 'local-incentives.html': '#/places/incentives', 'construction-commodities.html': '#/places/costs' };
    // Plain one-line notes in place of the live site's catalog blurbs (paul 11-06: say what each page answers).
    var NOTES = {
      'compare.html': 'Two to six places side by side on the needs assessment figures.',
      'hna-comparative-analysis.html': 'Every county, town and CDP ranked on housing need and access to services.',
      'colorado-deep-dive.html': 'Statewide: where tax credit homes went against need, and how rent has outrun income.',
      'article-co-housing-costs.html': 'Rents, prices, wages and permits for all 64 counties, mapped.',
      'census-dashboard.html': 'Apartments: how many, who rents them, and what renters pay.',
      'local-incentives.html': 'Which housing tools each county and town has on record.',
      'economic-dashboard.html': 'Rates, costs, permits and jobs that move a deal this year.',
      'construction-commodities.html': 'What apartment materials cost now against 2020.'
    };
    var byPath = {}; tools.forEach(function (e) {
      var n = NOTES[e.path] ? { note: NOTES[e.path] } : {};
      byPath[e.path] = IN_LAB[e.path] ? Object.assign({}, e, { href: IN_LAB[e.path], status: 'lab', note: e.note }, n) : Object.assign({}, e, n);
    });
    var named = {};
    var T = global.LabTpl;
    var st = data && data.gapCounty.statewide;
    // The one headline for homes short at 30% AMI is HUD CHAS affordable-and-available, as on the lab's Home.
    // The ACS figures below are the same question measured another way, and are labelled as such.
    var aa30 = data && data.aa && data.aa.statewide && data.aa.statewide.tiers ? data.aa.statewide.tiers['30'] : null;
    var aaYears = data && data.aa && data.aa.meta ? data.aa.meta.vintage : null;
    // The page story (paul 11-06): the finding leads, the map that proves it comes next, then the figures behind it.
    var short30 = 0, counted30 = 0;
    ((data && data.gapCounty.counties) || []).forEach(function (c) {
      var h = c.households_le_ami_pct && c.households_le_ami_pct['30'], u = c.units_priced_affordable_le_ami_pct && c.units_priced_affordable_le_ami_pct['30'];
      if (h == null || u == null) return;
      counted30++; if (h > u) short30++;
    });
    var facts = st ? [
        { value: num(st.renter_households_total), label: 'Renter households in Colorado', source: 'Census ACS 2020\u20132024', href: SRC.acsGap },
        { value: num(st.households_le_ami_pct['30']), label: 'Renters at or below 30% AMI', source: 'Census ACS 2020\u20132024', href: SRC.acsGap },
        { value: num(st.units_priced_affordable_le_ami_pct['30']), label: 'Homes priced for them', source: 'Census ACS 2020\u20132024', href: SRC.acsGap },
        aa30 ? { value: num(aa30.homes_short), label: 'Homes short for renters at or below 30% AMI', source: 'HUD CHAS ' + (aaYears || ''), href: 'https://www.huduser.gov/portal/datasets/cp.html' } : null,
        { value: num(matched(st, '30')), label: 'Homes short on the ACS count, at least (another measure)', source: 'Census ACS and HUD FY2026', href: SRC.hudIl }
      ].filter(Boolean) : null;
    var head = T.head({
      kind: 'hub', crumbs: [{ label: 'Home', href: '#/' }, { label: 'Places and need' }], title: 'Places and need',
      answer: counted30 ? num(short30) + ' of Colorado\u2019s ' + num(counted30) + ' counties have fewer homes than renters at the lowest incomes. Find your town or county to see its own gap.' :
        'Where Colorado renters most outnumber the homes they can afford, and the full needs assessment for any town, county or CDP.',
      meta: '<span class="scope-tag">Scope: Colorado, by county and place</span> Census ACS 2020\u20132024 with HUD FY2026 income limits.',
      aside: T.terms(TERMS)
    }) + (global.LabHna ? global.LabHna.stepPath(true, '#/places') : '') + Shell.searchBox('place-q', 'Find a town or county', q, 'For example Fruita or 0828745');
    var means = T.means([
      { text: 'Where renters at or below 30% AMI outnumber the homes priced for them, the rest live in homes priced for higher incomes and pay more than they can afford.' }
    ]);

    var results = '';
    if (q) {
      var hits = profiles.filter(Shell.matches(q));
      results = '<p class="count" role="status">' + (hits.length === 0 ? 'No matches.' : hits.length > 25 ? 'Showing 25 of ' + hits.length + '. Type more to narrow the list.' : hits.length + (hits.length === 1 ? ' match.' : ' matches.')) + '</p>' +
        '<ul class="route-list">' + hits.slice(0, 25).map(function (e) { return placeRow(e, data); }).join('') + '</ul>';
    }

    var glance = '';
    if (!q && data) {
      var sign = data.gapCounty.meta.gap_sign;
      var top = profiles.map(function (e) {
        var rec = data.gapPlace.places[e.geoid];
        return { e: e, s: rec ? shortfall(rec, '30', data.gapPlace.meta.gap_sign) : null };
      }).filter(function (x) { return x.s != null && x.s > 0; }).sort(function (a, b) { return b.s - a.s; }).slice(0, 8);
      var topMax = top.length ? top[0].s : 1;
      glance = '<h2>Where the need is</h2>' + (global.LabCountyNeed ? global.LabCountyNeed.figure(data, params) : needMap(data)) +
        (facts ? '<h2>Colorado, statewide</h2>' + T.factStrip(facts) : '') + means +
        '<details class="counted"><summary>How this is counted</summary>' + (aa30 ? '<p>The headline, ' + num(aa30.homes_short) + ' homes short, is HUD\u2019s CHAS count (' + esc(aaYears || '') + '): renter households at or below 30% of area median income less the homes they can afford that are vacant or rented by someone in that group. The map and lists below use the ACS count, which is newer and reaches every town, so its totals differ. Why they differ: the ACS count includes cheap homes rented by higher-income households and uses one statewide AMI; CHAS uses each county\u2019s own limits and older survey years.</p>' : '') + '<p>The ACS count: renter households earning up to 30% of area median income, minus the homes that rent for what they can afford, and minus homes rented for no cash rent, whose occupants are counted among those households. Each home counts only for households who can afford its rent, cheapest homes to the lowest incomes first. Counted homes are renter-occupied, not necessarily vacant or available, and some are rented by higher-income households. Everyone is measured against one statewide AMI (' + esc(money(st.ami_4person)) + ' for a family of four, HUD FY2026), so the figure differs from HUD\u2019s CHAS count, which uses older survey years and each county\u2019s own limits. </p></details>' +
        '<h2>Where renters at or below 30% AMI most outnumber the homes priced for them</h2>' +
        '<p class="note">Shortfall: renter households minus homes priced for them, for each Colorado place where renters outnumber homes. Larger places lead because they have more renters.</p>' +
        '<ol class="rank">' + top.map(function (x) {
          return '<li><a href="#/place/' + esc(x.e.geoid) + '" data-route-path="' + esc(x.e.path) + '">' + esc(x.e.label) + '</a>' +
            '<span class="rank-bar"><span class="bar households" style="width:' + (x.s / topMax * 100).toFixed(2) + '%" title="' + esc(x.e.label + ': ' + num(x.s) + ' more renters than homes') + '"></span></span>' +
            '<span class="bar-value">' + esc(num(x.s)) + '</span></li>';
        }).join('') + '</ol>';
    } else if (!q && error) {
      glance = '<p class="callout">' + esc(error) + '</p>';
    } else if (!q) {
      glance = '<p role="status" class="note">Loading Colorado figures…</p>';
    }

    var groups = QUESTIONS.map(function (g) {
      var rows = g.paths.map(function (p) { named[p] = true; return byPath[p]; }).filter(Boolean);
      var fold = g.folded ? g.folded.paths.map(function (p) { named[p] = true; return byPath[p]; }).filter(Boolean) : [];
      return rows.length || fold.length ? '<h2>' + esc(g.title) + '</h2>' + (rows.length ? Shell.list(rows) : '') +
        (fold.length ? '<details class="counted"><summary>' + esc(g.folded.label) + '</summary><p class="note">' + esc(g.folded.note) + '</p>' + Shell.list(fold) + '</details>' : '') : '';
    }).join('');
    var rest = tools.filter(function (e) { return !named[e.path]; });

    // Saved projects sit under the first answer; with none yet, the short note goes to the foot of the page.
    var recent = !q ? recentProjects() : null;
    return head + results + glance + (recent && recent.has ? recent.html : '') + groups + (rest.length ? '<h2>More tools</h2>' + Shell.list(rest) : '') +
      (!q ? notSure() : '') + (recent && !recent.has ? recent.html : '') +
      (!q ? '<p class="count">' + profiles.length + ' place profiles. Type a name above to find one.</p>' : '') +
      T.next('What to do next', [{ href: '#/place/0828745', label: 'Open a needs assessment: Fruita \u2192' }, { href: '#/places/ranking', label: 'See every place ranked', secondary: true }, { href: '#/market', label: 'Check a rental market', secondary: true }]);
  }

  function placeView(params, parts) {
    var catalog = Shell.catalog();
    var geoid = parts[1];
    var entry = catalog.entries.filter(function (e) { return e.geoid === geoid; })[0];
    var back = '<a class="back-link" href="#/places">← Places and need</a>';
    if (!entry) return back + '<h1>Place not found</h1><p class="lede">No Colorado place profile has the ID ' + esc(geoid) + '.</p>';
    load();
    if (error) return back + '<h1>' + esc(entry.label) + '</h1><p class="callout">' + esc(error) + '</p>';
    if (!data) return back + '<h1>' + esc(entry.label) + '</h1><p role="status" class="note">Loading figures…</p>';
    var f = placeFacts(geoid, data);
    var actions = '<div class="actions"><a class="button-link" href="' + esc(entry.href) + '">Open the full profile</a>' +
      '<a class="button-link secondary" href="' + esc(useHref(entry)) + '">Use in project</a></div>';
    if (!f) return back + '<h1>' + esc(entry.label) + '</h1><p class="lede">This place has no row in the income and rent gap data.</p>' + actions;
    var c = f.county, countyName = c.county ? c.county.county_name : f.rec.containing_county_fips;
    var b30 = f.bands[0], b60 = f.bands[3];
    var rentVal = f.rent && f.rent.median_gross_rent != null ? money(f.rent.median_gross_rent) : null;
    var lte30 = c.chas && c.chas.renter_hh_by_ami.lte30;
    return back + '<h1>' + esc(entry.label) + '</h1>' +
      '<p class="lede">Renter housing need in ' + esc(entry.label) + ', in ' + esc(countyName) + '. Each figure names its source and year.</p>' + actions +
      '<h2>Who rents here, and what they can pay</h2><div class="metrics">' +
      card('Renter households', num(f.rec.renter_households_total), null, 'Census ACS 2020–2024', SRC.acsGap, AT.place) +
      card('Median gross rent', rentVal, rentVal ? null : 'The Census Bureau does not publish a median for this place.', 'Census ACS 2020–2024, B25064', SRC.acsRent, AT.place) +
      card('Area median income, family of four', money(f.rec.ami_4person), countyName + ' limit', 'HUD FY2026', SRC.hudIl, AT.countyLimit(countyName)) +
      card('Rent affordable at 60% AMI', money(b60.rent), '30% of the income limit, per month', 'HUD FY2026', SRC.hudIl, AT.countyLimit(countyName)) +
      '</div>' +
      '<h2>Renters and the homes priced for them</h2><div class="metrics">' +
      gapCard(b30) + gapCard(b60) +
      '</div>' + gapChart(f) +
      '<h2>Rents and existing affordable housing in ' + esc(countyName) + '</h2><div class="metrics">' +
      card('CHFA maximum rent, 2 bedrooms at 60% AMI', money(c.chfa60two), 'Gross rent, before the utility allowance', 'CHFA 2026, effective ' + data.chfa.meta.effective_date, data.chfa.meta.source_url, AT.countyLimit(countyName)) +
      card('HUD Fair Market Rent, 2 bedrooms', money(c.hud && c.hud.fmr.two_br), c.hud ? c.hud.fmr_area_name : null, 'HUD FY' + data.hud.meta.fiscal_year, data.hud.meta.url_fmr, AT.countyLimit(countyName)) +
      card('Tax credit properties in compliance, ' + countyName, num(c.properties), num(c.lowIncomeHomes) + ' low-income homes across the county', 'CHFA property list, ' + data.lihtc.fetchedAt.slice(0, 10), data.lihtc.source, AT.countyProxy(countyName)) +
      card('Renters at or below 30% AMI paying over 30% of income, ' + countyName, lte30 ? Math.round(lte30.pct_cost_burdened_30 * 100) + '%' : null, lte30 ? num(lte30.cost_burdened_30pct) + ' of ' + num(lte30.total) + ' households in the county' : null, 'HUD CHAS ' + data.chas.meta.vintage, data.chas.meta.url, AT.countyProxy(countyName)) +
      '</div>' +
      '<p class="note">Census figures are survey estimates with margins of error, which are wide for small places. ' +
      'Sources: <a href="https://data.census.gov/table/ACSDT5Y2024.B25118">Census ACS B25118</a>, ' +
      '<a href="https://www.huduser.gov/portal/datasets/il.html">HUD income limits</a>, ' +
      '<a href="' + esc(data.chfa.meta.source_url) + '">CHFA rent and income limits</a>, ' +
      '<a href="' + esc(data.hud.meta.url_fmr) + '">HUD Fair Market Rents</a>, ' +
      '<a href="' + esc(data.chas.meta.url) + '">HUD CHAS</a>.</p>';
  }

  Shell.views.places = placesView;
  Shell.views.place = placeView;
  global.LabPlaces = { entryFor: entryFor, countyEntries: countyEntries, TERMS: TERMS, bandsOwn: bandsOwn, needMap: needMap, per10: per10, MAP_BINS: MAP_BINS,
    shortfall: shortfall, netGap: netGap, gapCard: gapCard, placeFacts: placeFacts, countyFacts: countyFacts, QUESTIONS: QUESTIONS, FILES: FILES, LIVE: LIVE,
    // Shared with hna.js, which builds the place page's chapters.
    data: function () { load(); return { data: data, error: error }; }, card: card, scope: scope, AT: AT, srcLine: srcLine, SRC: SRC, gapCard: gapCard, gapChart: gapChart, ladder: ladder, useHref: useHref, num: num, money: money
  };
})(window);
