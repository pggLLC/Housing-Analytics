// Investor summary (#/ic-summary?g=<geoid>): one place's facts laid out for an investment committee, from the files the
// live page reads (js/ic-summary.js): the HNA ranking, renters against homes priced for them by AMI, tax credit
// properties nearby (CHFA), HUD's QCTs and DDAs, the county's awards against need, and the local housing
// contacts on record. Named people are never shown; the organisations are. The second half reads the files the live
// page's components read: anchor employers (local-resources), capital partners, tax breaks and fee waivers, the CHFA
// round calendar, resort housing programs, peers in the county (place-lehd) and the affordable properties list.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI;
  var esc = Shell.esc, num = UI.num, money = UI.money;
  var LIVE = 'https://cohoanalytics.com/';
  var SRC = LIVE + 'ic-summary.html';
  var FILES = {
    ranking: 'data/hna/ranking-index.json', amiPlace: 'data/co_ami_gap_by_place.json', amiCounty: 'data/co_ami_gap_by_county.json',
    lihtc: 'data/chfa-lihtc.json', centroids: 'data/co-place-centroids.json', local: 'data/hna/local-resources.json',
    dda: 'data/dda-colorado.json', qct: 'data/qct-colorado.json', fvn: 'data/derived/funding-vs-need.json',
    counties: 'data/boundaries/counties_co.geojson'
  };
  // The live page's second-half components, loaded after the top of the page draws.
  var MORE = {
    props: 'data/affordable-housing/properties.json', capital: 'data/capital-partners.json', tax: 'data/tax-abatement-inventory.json',
    fees: 'data/policy/fee-reductions.json', qap: 'data/chfa-qap-calendar.json', resort: 'data/resort-workforce-housing-programs.json',
    lehd: 'data/hna/place-lehd.json', audit: 'data/market/principal-employers.json', geo: 'data/hna/geo-config.json', bridge: 'data/affordable-housing/chfa-awards/2026-round-one.json'
  };
  // The live page's capital partner scope (js/ic-summary.js renderCapitalPartners).
  var DEAL_TYPES = ['lihtc-4pct', 'lihtc-state', 'preservation', 'prop123', 'soft-debt', 'equity-syndication'];
  var COMP_RADIUS = 25, COMP_SINCE = 2015;
  // Program labels come from the live map layer's own categories (js/components/affordable-housing-layer.js),
  // loaded when this page opens. Its path is in index.html's LAB_LAZY_VENDOR list so the preview carries it.
  var ahl = null;
  function needAhl() {
    if (global.AffordableHousingLayer || ahl) return;
    ahl = document.createElement('script');
    ahl.src = (global.LAB_VENDOR) + 'js/components/affordable-housing-layer.js';
    ahl.onload = ahl.onerror = function () { Shell.render(); };
    document.body.appendChild(ahl);
  }
  // CHFA's 2026 round-one awards, merged as the live layer merges them until CHFA's feed lists them.
  function withBridge(P, B) {
    var extra = ((B && B.awards) || []).filter(function (a) { return a.lat !== null && a.lat !== '' && isFinite(a.lat) && a.lon !== null && a.lon !== '' && isFinite(a.lon); }).map(function (a) {
      var pt = ['chfa-2026-r1-bridge'];
      if (a.federal_9pct_credit) pt.push('lihtc-9pct');
      if (a.federal_4pct_credit) pt.push('lihtc-4pct');
      if (a.state_credit) pt.push('lihtc-state-paired');
      if (a.mihtc_credit) pt.push('lihtc-mihtc');
      return { property_name: a.name, city: a.city, lat: +a.lat, lng: +a.lon, program_type: pt, total_units: a.total_units };
    });
    return { metadata: P.metadata, properties: (P.properties || []).concat(extra) };
  }
  function programOf(p) {
    var A = global.AffordableHousingLayer, c = A && A.categorize ? A.categorize(p) : null;
    return c ? c.label : '';
  }

  // Curated notes sometimes name the build's own files; readers get the sentence without them.
  function clean(t) {
    return String(t || '').split(/(?<=[.;])\s+/).filter(function (x) { return !/data\/|\.json|pinned|word for word|verbatim/i.test(x); }).join(' ');
  }
  function link(name, url) { return url ? '<a href="' + esc(url) + '">' + esc(name) + '</a>' : esc(name); }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function longDate(iso) {
    var p = String(iso || '').split('-');
    return p.length === 3 ? new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : String(iso || '');
  }
  var RADIUS = 15;
  var TYPE = { county: 'County', place: 'Town or city', cdp: 'Unincorporated place (CDP)' };
  function cleanName(n) { return String(n || '').replace(/ \((city|town|CDP)\)$/i, ''); }
  function pct1(v) { return v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1) + '%'; }
  function miles(a, b, c, d) {
    var R = 3958.8, r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2);
    return 2 * R * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y));
  }
  function metric(label, value, detail) {
    return '<div class="metric"><p class="metric-label">' + esc(label) + '</p><p class="metric-value">' + esc(value == null ? '—' : value) + '</p>' + (detail ? '<p class="metric-detail">' + esc(detail) + '</p>' : '') + '</div>';
  }
  function picker(list, g) {
    var groups = [['county', 'Counties'], ['place', 'Towns and cities'], ['cdp', 'Unincorporated places (CDPs)']];
    return '<form class="search sc-pick" onsubmit="return false"><label for="ic-g">Pick a place</label><select id="ic-g" data-ic-pick="1"><option value="">Choose a county, town or CDP</option>' +
      groups.map(function (gr) {
        return '<optgroup label="' + gr[1] + '">' + list.filter(function (r) { return r.type === gr[0]; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; }).map(function (r) {
          return '<option value="' + esc(r.geoid) + '"' + (r.geoid === g ? ' selected' : '') + '>' + esc(cleanName(r.name)) + '</option>';
        }).join('') + '</optgroup>';
      }).join('') + '</select></form>';
  }

  // ── The live page's second half ──────────────────────────────────────────────────────────────────────────────

  // Long lists fold shut on the page: the title and a one-line answer show, the list opens on tap (LabTpl.fold).
  function fold(html, take) { return T && T.foldHtml ? T.foldHtml(html, esc(take)) : html; }

  // Anchor institutions: school district, hospital and the largest employers, from the place's local record or,
  // failing that, its county's (as the live page does).
  function anchors(L, g, fips, isCounty, audit, name, cname) {
    var own = !isCounty ? L['place:' + g] || L['cdp:' + g] : null, rec = own || L['county:' + fips] || null;
    var fallback = !isCounty && !own ? ' (county record)' : '';
    var h = '<h2>Anchor employers and workforce housing partners</h2>';
    var E = global.LabEmployers, files = { audit: audit, local: L };
    // School district staff counts are optional: a missing file leaves the rest of the block as it is.
    if (E && UI.load) { var PS = UI.load({ public: E.PATHS.public }), PC = UI.load({ cbp: E.PATHS.cbp }), PJ = UI.load({ jobs: E.PATHS.jobs }); files.public = PS.data ? PS.data.public : null; files.cbp = PC.data ? PC.data.cbp : null; files.jobs = PJ.data ? PJ.data.jobs : null; }
    var gx = { geoid: g, name: name, here: name, searchName: name, countyFips: fips, countyName: cname };
    var emp = E ? E.block(files, gx) : '';
    // School district and hospital come from the town's record, or the county's when the town has none of its own.
    var pickF = function (f) { return own && own[f] && own[f].name ? [own[f], ''] : !isCounty && L['county:' + fips] && L['county:' + fips][f] && L['county:' + fips][f].name ? [L['county:' + fips][f], ' (county record)'] : rec && rec[f] && rec[f].name ? [rec[f], fallback] : null; };
    var sd = pickF('schoolDistrict'), hs = pickF('hospital');
    return fold(h + '<p>The biggest employers set the incomes to design for. Hospitals, ski areas and universities often run workforce housing programs a developer can lease homes to.</p>' +
      '<dl class="ic-civic"><dt>School district</dt><dd>' + (sd ? link(sd[0].name, sd[0].url) + sd[1] : 'Not on file') + '</dd>' +
      '<dt>Hospital</dt><dd>' + (hs ? link(hs[0].name, hs[0].url) + hs[1] : 'Not on file') + '</dd></dl>' + emp,
      [sd ? 'School district: ' + sd[0].name + '.' : null, hs ? 'Hospital: ' + hs[0].name + '.' : null, E ? E.take(files, gx) : null].filter(Boolean).join(' '));
  }


  function capital(C) {
    var list = (C.partners || []).filter(function (p) { return (p.deal_types || []).some(function (t) { return DEAL_TYPES.indexOf(t) !== -1; }); });
    return fold('<h2>Capital partners for a tax credit or preservation deal</h2>' +
      '<p>Lenders, equity investors and funders active in Colorado for a 4% tax credit, state credit, preservation or Prop 123 deal. Each name links to the partner’s own page.</p>' +
      UI.table('ic-capital', 'Capital partners for the usual Colorado tax credit and preservation stack', [
        { key: 'name', label: 'Partner', href: function (x) { return x.url; } }, { key: 'category', label: 'Kind' },
        { key: 'service_area', label: 'Works in' }, { key: 'notes', label: 'What they fund', fmt: clean }
      ], list, { noun: 'partners', placeholder: 'Partner or kind' }) +
      T.source('COHO capital partner list, from each partner’s public pages', SRC, C.metadata && (C.metadata.generated || C.metadata.updated)),
      num(list.length) + ' lenders, equity investors and funders active in Colorado, each linked to its own page.');
  }

  // Tax breaks and fee waivers: the jurisdiction's own programs, then the two statewide exemptions. A fee waiver is
  // shown only through the verified fee list, as the live page does.
  function taxBreaks(TA, F, g, isCounty, name) {
    var key = (isCounty ? 'county:' : 'place:') + g;
    var entry = (TA.jurisdictions || []).filter(function (j) { return (j.geoKeys || []).indexOf(key) !== -1; })[0];
    var fees = F.entries || [];
    function item(p) {
      if (p.category === 'fee-waiver') {
        var ids = p.fee_reductions_ids || [], backed = fees.filter(function (e) { return ids.indexOf(e.id) !== -1; });
        var here = backed.filter(function (e) { return e.geoid === g; });
        if (here.length) return here.map(function (e) {
          return '<li><strong>' + link(e.jurisdiction + ': ' + String(e.fee_category || 'fee').replace(/_/g, ' ') + ' ' + (e.measure || ''), e.source && e.source.url) + '</strong>' +
            '<p>' + esc(clean(e.summary)) + '</p><p class="hint">Checked ' + esc(e.verification && e.verification.checked || '') + ' against ' + esc(e.source && e.source.label || 'the code') + '.</p></li>';
        }).join('');
        return '<li><strong>' + esc(p.name) + '</strong> <span class="tag">Not yet checked</span><p class="hint">' +
          esc(backed.length ? 'Checked fee measures in this group are for other places; none yet for this one.' : 'Listed in an older inventory and not yet checked against the jurisdiction’s own code.') + '</p></li>';
      }
      return '<li><strong>' + link(p.name, p.url) + '</strong>' + (p.category ? ' <span class="tag">' + esc(p.category.replace(/-/g, ' ')) + '</span>' : '') +
        (p.summary ? '<p>' + esc(clean(p.summary)) + '</p>' : '') + (p.magnitude ? '<p class="ic-mag">' + esc(clean(p.magnitude)) + '</p>' : '') + '</li>';
    }
    var sb = TA.metadata && TA.metadata.state_baseline;
    var nLocal = entry && entry.programs ? entry.programs.length : 0;
    return fold('<h2>Property tax breaks, PILOTs and fee waivers</h2>' +
      (entry && entry.programs && entry.programs.length ? '<p>Programs on record for ' + esc(entry.name) + '. They change yearly; check each before underwriting.</p><ul class="ic-programs">' + entry.programs.map(item).join('') + '</ul>' :
        '<p>No local tax break on record for ' + esc(name) + '. The statewide exemptions below are the tools that apply.</p>') +
      (sb ? '<p class="ic-baseline"><strong>Statewide exemptions.</strong> ' + esc(sb.note) + ' <a href="' + esc(sb.url) + '">Colorado Division of Property Taxation ↗</a>' + (sb.checked ? ', checked ' + esc(sb.checked) : '') + '.</p>' : '') +
      T.source('Local ordinances and fee schedules; C.R.S. §39-3-112 and §29-4-227', sb && sb.url, TA.metadata && TA.metadata.generated),
      (nLocal ? nLocal + (nLocal === 1 ? ' local program' : ' local programs') + ' on record for ' + entry.name : 'No local tax break on record for ' + name) + ', plus the statewide exemptions.');
  }

  // CHFA rounds: what is still ahead, the next deadline with days to go, and the programs open all year.
  function qapCalendar(Q) {
    var today = ymd(new Date()), MS = 864e5;
    var ahead = (Q.events || []).filter(function (e) { return (e.date_end || e.date) >= today && e.status !== 'past'; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var next = ahead.filter(function (e) { return /deadline|comment|loi/.test(e.category || '') && e.date >= today; })[0];
    var days = next ? Math.round((new Date(next.date + 'T00:00:00') - new Date(today + 'T00:00:00')) / MS) : null;
    var rows = ahead.map(function (e) {
      return { date: e.date, when: longDate(e.date) + (e.date_end ? ' to ' + longDate(e.date_end) : ''), name: e.name, url: e.url,
        status: e.qap_status === 'draft' ? 'Draft plan' : e.date_precision === 'estimated' ? 'Estimated' : 'Set' };
    });
    var src = Q.metadata && Q.metadata.source_url;
    return '<h2>Tax credit calendar: the next CHFA deadlines</h2>' +
      (next ? '<div class="metrics">' + metric('Next deadline', longDate(next.date), next.name) + metric('Days to go', num(days)) + '</div>' : '<p class="note">No CHFA deadline on the calendar yet.</p>') +
      (rows.length ? UI.table('ic-qap', 'CHFA rounds and hearings still ahead', [
        { key: 'when', label: 'Date' }, { key: 'name', label: 'What', href: function (x) { return x.url; } }, { key: 'status', label: 'Date is', tip: 'Draft plan: from a plan CHFA had not adopted when checked. Estimated: CHFA has not published it; inferred from past rounds.' }
      ], rows, { noun: 'dates', placeholder: 'Round or program' }) + T.source('CHFA dates and deadlines, and its allocation plan', src, Q.metadata && Q.metadata.generated) : '') +
      ((Q.rolling_programs || []).length ? '<h3>Open all year</h3><ul class="ic-programs">' + Q.rolling_programs.map(function (p) {
        return '<li><strong>' + link(p.name, p.url) + '</strong><p>' + esc(clean(p.description)) + '</p></li>';
      }).join('') + '</ul>' : '') +
      '<p class="hint">Check dates on CHFA’s site 60 to 90 days ahead.</p>' +
      T.source('CHFA dates and deadlines, and its allocation plan', src, Q.metadata && Q.metadata.generated);
  }

  var RESTRICTION = {
    'occupancy-only': 'Occupancy only: keeps the home for local workers, does not cap its price', 'price-capped': 'Price-capped resale',
    either: 'Owner’s choice: occupancy only, or price-capped resale for a larger payment', unverified: 'Restriction terms not confirmed'
  };
  function resort(R, g, fips, isCounty, name) {
    var all = R.authorities || [];
    var m = all.filter(function (a) { return isCounty ? a.county_fips === fips : (a.serves_place_geoids || []).indexOf(g) !== -1; });
    var h = '<h2>Resort housing authorities and workforce programs</h2>';
    if (!m.length) return h + '<p>No resort housing authority serves ' + esc(name) + '. Colorado’s ' + num(all.length) + ' are ' +
      all.map(function (a) { return link(a.name, a.url); }).join(', ') + '.</p>';
    return fold(h + '<p>Resort towns and counties run their own programs: deed restriction buy-downs, town-owned rentals, seasonal housing and mitigation rules. Each line is checked against the program’s own source.</p>' +
      m.map(function (a) {
        var ps = (a.key_programs || []).concat(a.funding || []);
        return '<h3>' + link(a.name, a.url) + '</h3>' + (a.service_area ? '<p class="hint">' + esc(a.service_area) + '</p>' : '') +
          '<ul class="ic-programs">' + ps.map(function (p) {
            return '<li><strong>' + esc(p.name) + '</strong>' + (RESTRICTION[p.restriction_type] ? ' <span class="tag">' + esc(RESTRICTION[p.restriction_type]) + '</span>' : '') +
              (p.summary ? '<p>' + esc(clean(p.summary)) + '</p>' : '') + (p.magnitude ? '<p class="ic-mag">' + esc(clean(p.magnitude)) + '</p>' : '') +
              (p.source_url ? '<p class="hint">Source: <a href="' + esc(p.source_url) + '">' + esc(p.source_label || 'program page') + '</a>' + (p.verified_on ? ', checked ' + esc(p.verified_on) : '') + '</p>' : '') + '</li>';
          }).join('') + '</ul>';
      }).join('') + T.source('Each housing authority’s, town’s or county’s own pages and code', null, R.metadata && R.metadata.generated),
      m.map(function (a) { return a.name; }).join(', ') + ': ' + m.reduce(function (t, a) { return t + (a.key_programs || []).length + (a.funding || []).length; }, 0) + ' programs, each checked against its own source.');
  }

  // Peers: for a town, the other towns and CDPs in its county, largest first, as the live page lists them.
  function countyPeers(M, d, g, fips, cname) {
    var geo = M.geo, lehd = M.lehd.places || {};
    var rows = (geo.places || []).concat(geo.cdps || []).filter(function (p) { return p.containingCounty === fips && p.geoid !== g; }).map(function (p) {
      var L = lehd[p.geoid], a = d.amiPlace.places[p.geoid], city = cleanName(p.label).toUpperCase(), n = 0;
      d.lihtc.features.forEach(function (f) { if (String(f.properties.PROJ_CTY || '').trim().toUpperCase() === city) n++; });
      var w = L && L.lehd ? +L.lehd.within || 0 : 0, out = L && L.lehd ? +L.lehd.outflow || 0 : 0, share = w + out > 0 ? 100 * out / (w + out) : null;
      return { geoid: p.geoid, name: cleanName(p.label), pop: L && L.place_pop, demand: a && a.households_le_ami_pct ? +a.households_le_ami_pct['100'] : null, lihtc: n,
        labor: share == null ? null : share >= 70 ? 'Bedroom town' : share >= 40 ? 'Mixed' : 'Self-contained' };
    }).filter(function (x) { return x.pop != null; }).sort(function (a, b) { return b.pop - a.pop; }).slice(0, 6);
    if (!rows.length) return '<h2>Peers in ' + esc(cname) + '</h2><p class="note">No other town in ' + esc(cname) + ' has figures on file.</p>';
    return '<h2>Peers in ' + esc(cname) + '</h2>' + UI.table('ic-peers', 'Other towns and places in ' + cname + ', largest first', [
      { key: 'name', label: 'Place', href: function (x) { return '#/ic-summary?g=' + x.geoid; } }, { key: 'pop', label: 'People', num: true, fmt: num, tip: 'Census population, apportioned to the town by LEHD' },
      { key: 'demand', label: 'Renters at or below 100% AMI', num: true, fmt: num }, { key: 'lihtc', label: 'Tax credit properties in town', num: true, fmt: num },
      { key: 'labor', label: 'Labor market', tip: 'Bedroom town: 70% or more of working residents commute out. Mixed: 40 to 70%. Self-contained: under 40%.' }
    ], rows, { noun: 'places', placeholder: 'Place' }) + T.source('LEHD LODES, Census ACS and CHFA', 'https://lehd.ces.census.gov/data/', String(M.lehd.meta && (M.lehd.meta.generated_at || M.lehd.meta.generated || M.lehd.meta.generatedAt) || '').slice(0, 10) || null);
  }

  // Every CHFA tax credit award in the town or its county, newest first (the live page's award history).
  function awardHistory(P, name, fips, isCounty, cname) {
    var city = name.toLowerCase(), rows = (P.properties || []).filter(function (p) {
      if (!(p.program_type || []).some(function (t) { return t.indexOf('lihtc-') === 0; })) return false;
      return (!isCounty && String(p.city || '').toLowerCase().trim() === city) || p.county_fips === fips;
    }).filter(function (p) { return p.award_year || p.year_placed_in_service || p.latest_year; }).map(function (p) {
      return { year: p.award_year || p.year_placed_in_service || p.latest_year, name: p.property_name || 'Unnamed', city: p.city, units: p.total_units || p.assisted_units || 0,
        credit: p.type_of_credits, nine: (p.program_type || []).indexOf('lihtc-9pct') !== -1, four: (p.program_type || []).indexOf('lihtc-4pct') !== -1 };
    }).sort(function (a, b) { return b.year - a.year; });
    var h = '<h2>CHFA tax credit award history</h2>';
    if (!rows.length) return h + '<p class="note">No CHFA tax credit awards on file for ' + esc(isCounty ? name : name + ' or ' + cname) + '.</p>';
    var units = rows.reduce(function (t, x) { return t + x.units; }, 0);
    return fold(h + '<div class="metrics">' + metric('Awards', num(rows.length), isCounty ? 'In ' + name : 'In ' + name + ' and the rest of ' + cname) + metric('Homes', num(units)) +
      metric('9% awards', num(rows.filter(function (x) { return x.nine; }).length)) + metric('4% awards', num(rows.filter(function (x) { return x.four; }).length)) + '</div>' +
      awardsByYear(rows, isCounty ? name : name + ' and ' + cname) +
      UI.table('ic-awards', 'CHFA tax credit awards, newest first', [
        { key: 'year', label: 'Year', num: true }, { key: 'name', label: 'Property' }, { key: 'city', label: 'Town' },
        { key: 'units', label: 'Homes', num: true, fmt: num }, { key: 'credit', label: 'Credit' }
      ], rows, { noun: 'awards', placeholder: 'Property or town' }) +
      T.source('CHFA tax credit properties, merged with HUD and USDA records', 'https://www.chfainfo.com/rental-housing/housing-credit', String(P.metadata && (P.metadata.generated || P.metadata.generatedAt) || '').slice(0, 10) || null),
      num(rows.length) + ' awards and ' + num(units) + ' homes. Latest: ' + rows[0].name + (rows[0].city ? ', ' + rows[0].city : '') + ', ' + rows[0].year + '.');
  }

  // Homes in CHFA tax credit awards, by year, for the most recent twelve years with an award.
  function awardsByYear(rows, where) {
    if (!global.LabViz) return '';
    var by = {};
    rows.forEach(function (x) { by[x.year] = (by[x.year] || 0) + (x.units || 0); });
    var years = Object.keys(by).map(Number).filter(isFinite).sort(function (a, b) { return a - b; }).slice(-12);
    if (years.length < 2) return '';
    return global.LabViz.orderedBars({ title: 'Homes in CHFA tax credit awards, by year', answer: where + ', the most recent ' + years.length + ' years with an award.', noShare: true,
      rows: years.map(function (y) { return [String(y), by[y]]; }) });
  }

  // The five nearest affordable properties of any program, and CHFA's recent awards within 25 miles.
  function comps(P, d, g, fips, name) {
    var c = d.centroids.byGeoid[g];
    var near = c ? (P.properties || []).filter(function (p) { return isFinite(p.lat) && isFinite(p.lng); }).map(function (p) {
      var fact = p.pbv_contract_sunset ? 'Vouchers end ' + p.pbv_contract_sunset : isFinite(p.years_to_expiration) && p.years_to_expiration !== null ?
        (p.years_to_expiration < 0 ? 'Restriction ended ' + (-p.years_to_expiration) + ' years ago' : p.years_to_expiration <= 5 ? 'Restriction ends within ' + p.years_to_expiration + ' years' : num(p.years_to_expiration) + ' years left on the restriction') : '';
      return { mi: miles(c.lat, c.lng, p.lat, p.lng), name: p.property_name || 'Unnamed', city: p.city, program: programOf(p), units: p.total_units || p.assisted_units || 0,
        year: p.year_placed_in_service || p.award_year || p.latest_year || null, credit: [p.type_of_credits, fact].filter(Boolean).join('. ') };
    }).sort(function (a, b) { return a.mi - b.mi; }).slice(0, 5) : [];
    // CHFA comparables: awarded since 2015, within 25 miles of the place's middle (a county without one uses the
    // middle of its own tax credit properties, as the live page does).
    var anchor = c && c.lat ? c : null;
    if (!anchor) {
      var pts = d.lihtc.features.filter(function (f) { return String(f.properties.CNTY_FIPS || '').padStart(5, '0') === fips && f.geometry; }).map(function (f) { return f.geometry.coordinates; });
      if (pts.length) anchor = { lat: pts.reduce(function (t, x) { return t + x[1]; }, 0) / pts.length, lng: pts.reduce(function (t, x) { return t + x[0]; }, 0) / pts.length };
    }
    var nowY = new Date().getFullYear(), recent = anchor ? d.lihtc.features.map(function (f) {
      var p = f.properties || {}, co = f.geometry && f.geometry.coordinates, y = parseInt(p.AwardYear || p.YR_ALLOC, 10);
      if (!co || !isFinite(y) || y < COMP_SINCE || y > nowY + 1) return null;
      var mi = miles(anchor.lat, anchor.lng, co[1], co[0]);
      return mi <= COMP_RADIUS ? { name: p.PROJECT, city: String(p.PROJ_CTY || '').toLowerCase().replace(/\b\w/g, function (x) { return x.toUpperCase(); }), year: y, units: +p.LI_UNITS || 0, credit: p.CREDIT, mi: mi } : null;
    }).filter(Boolean).sort(function (a, b) { return b.year - a.year || b.units - a.units; }).slice(0, 12) : [];
    return '<h2>Five nearest affordable properties</h2>' +
      (near.length ? '<p>Any program: tax credit, CHFA preservation, HUD multifamily, USDA Rural Development and local voucher homes. Distance from the middle of ' + esc(name) + '. CHFA’s usual market area runs 5 miles in a city and up to 30 in rural places.</p>' +
        (global.LabViz ? global.LabViz.orderedBars({ title: 'How far each one is', answer: 'Miles from the middle of ' + name + '.', noShare: true, color: 'var(--c-blue)',
          fmt: function (v) { return v.toFixed(1) + ' mi'; }, rows: near.map(function (x) { return [x.name + (x.city ? ', ' + x.city : ''), x.mi]; }) }) : '') +
        UI.table('ic-comps', 'The five nearest affordable properties, nearest first', [
          { key: 'mi', label: 'Miles', num: true, fmt: function (v) { return v.toFixed(1); } }, { key: 'name', label: 'Property' }, { key: 'city', label: 'Town' }, { key: 'program', label: 'Program' },
          { key: 'units', label: 'Homes', num: true, fmt: num }, { key: 'year', label: 'Year', num: true }, { key: 'credit', label: 'Credit and restriction' }
        ], near, { noun: 'properties', placeholder: 'Property or town' }) + T.source('CHFA, HUD multifamily, USDA Rural Development and local housing authority records', 'https://www.chfainfo.com/rental-housing/housing-credit', String(P.metadata && (P.metadata.generated || P.metadata.generatedAt) || '').slice(0, 10) || null) :
        '<p class="note">' + esc(name) + ' has no single middle point on file, so the nearest properties are not ranked. The award history above lists the county’s.</p>') +
      '<h3>Recent CHFA tax credit awards within ' + COMP_RADIUS + ' miles</h3>' +
      (recent.length ? UI.table('ic-recent', 'CHFA tax credit awards since ' + COMP_SINCE + ' within ' + COMP_RADIUS + ' miles, newest first', [
        { key: 'name', label: 'Property' }, { key: 'city', label: 'Town' }, { key: 'year', label: 'Award year', num: true, tip: 'The year CHFA awarded the credits. A property usually opens two to three years later.' },
        { key: 'units', label: 'Affordable homes', num: true, fmt: num }, { key: 'credit', label: 'Credit' }, { key: 'mi', label: 'Miles', num: true, fmt: function (v) { return v.toFixed(1); } }
      ], recent, { noun: 'awards', placeholder: 'Property or town' }) : '<p class="note">No CHFA tax credit award within ' + COMP_RADIUS + ' miles since ' + COMP_SINCE + '.</p>') +
      T.source('CHFA housing tax credit properties', d.lihtc.source, String(d.lihtc.fetchedAt).slice(0, 10));
  }

  function view(params) {
    var title = 'Investor summary';
    var head = function (answer, meta) {
      return T.head({ kind: 'tool', crumbs: T.trail('deal', title), title: title, answer: answer || 'One Colorado place’s market, need, competition and local partners on one page, for lenders and investors.', meta: meta });
    };
    var s = UI.load(FILES);
    if (s.error) return head() + '<p class="callout">' + esc(s.error) + '</p>';
    if (!s.data) return head() + '<p role="status" class="note">Loading the data…</p>';
    var d = s.data, list = Array.isArray(d.ranking.rankings) ? d.ranking.rankings : Object.keys(d.ranking.rankings).map(function (k) { return d.ranking.rankings[k]; });
    var g = params.get('g') || '';
    var r = list.filter(function (x) { return x.geoid === g; })[0];
    if (!r) return head() + picker(list, '') + '<p class="lede">Pick a place to see its summary. For example <a href="#/ic-summary?g=0828745">Fruita</a>, <a href="#/ic-summary?g=0853395">New Castle</a> or <a href="#/ic-summary?g=08045">Garfield County</a>.</p>';
    var m = r.metrics || {}, isCounty = r.type === 'county', name = cleanName(r.name), fips = isCounty ? r.geoid : r.containingCounty;
    var cf = d.counties.features.filter(function (f) { return f.properties.GEOID === fips; })[0], cname = cf ? cf.properties.NAME + ' County' : 'its county';

    // Renters against homes priced for them.
    var amiRec = isCounty ? d.amiCounty.counties.filter(function (c) { return c.fips === g; })[0] : d.amiPlace.places[g];
    var bands = (d.amiPlace.bands || []).map(String).filter(function (b) { return +b <= 100; });
    var amiRows = amiRec ? bands.map(function (b) {
      var hh = amiRec.households_le_ami_pct[b], u = amiRec.units_priced_affordable_le_ami_pct[b];
      return { band: b + '% AMI', rent: amiRec.affordable_rent_monthly[b], hh: hh, units: u, short: hh != null && u != null ? hh - u : null };
    }) : [];
    var at60 = amiRows.filter(function (x) { return x.band === '60% AMI'; })[0];

    // Tax credit properties: in the place by city name, in the county, and, for a town, within 15 miles of its
    // middle. A county lists its own properties instead: one point cannot stand for a whole county.
    var c = isCounty ? null : d.centroids.byGeoid[g];
    var up = name.toUpperCase(), inPlace = { n: 0, u: 0 }, inCounty = { n: 0, u: 0 }, near = [];
    d.lihtc.features.forEach(function (f) {
      var p = f.properties || {}, units = +p.LI_UNITS || 0, co = f.geometry && f.geometry.coordinates;
      if (String(p.CNTY_FIPS || '').padStart(5, '0') === fips) { inCounty.n++; inCounty.u += units; if (isCounty) near.push({ name: p.PROJECT, town: p.PROJ_CTY, units: units, year: p.YR_PIS, credit: p.CREDIT, mi: null }); }
      if (!isCounty && String(p.PROJ_CTY || '').trim().toUpperCase() === up) { inPlace.n++; inPlace.u += units; }
      if (c && co) { var mi = miles(c.lat, c.lng, co[1], co[0]); if (mi <= RADIUS) near.push({ name: p.PROJECT, town: p.PROJ_CTY, units: units, year: p.YR_PIS, credit: p.CREDIT, mi: mi }); }
    });
    var nearUnits = near.reduce(function (t, x) { return t + x.units; }, 0);
    var recent = near.filter(function (x) { return x.year >= new Date().getFullYear() - 10; }).length;

    // Basis boost: QCT tracts in the county, and whether the county is a non-metro DDA.
    var qcts = d.qct.features.filter(function (f) { return String(f.properties.GEOID || '').slice(0, 5) === fips; }).length;
    var dda = d.dda.features.filter(function (f) { return (f.properties.GEOID || '') === fips; })[0];
    var ddaText = dda ? (/NM/.test(String(dda.properties.DDA_TYPE || dda.properties.DDATYPE)) ? cname + ' is a non-metro difficult development area, so the whole county qualifies for the 30% basis boost.' :
      cname + ' holds a small-area difficult development area, set by ZIP code. Check the site’s ZIP on HUD’s map.') : cname + ' is not a difficult development area in ' + (d.dda.designationYear || 'this year') + '.';

    // The county's tax credit and Prop 123 awards against its need.
    var fc = d.fvn.counties.filter(function (x) { return x.fips === fips; })[0], w = d.fvn.meta.window;
    var QUAD = { underserved: 'high need, little funding', aligned: 'high need, funded', 'funded-above-need': 'funded beyond need', 'low-need-low-funding': 'low need, little funding', 'not-computable': 'not computable' };

    // Local housing organisations on record (organisations only; never named people).
    var lr = (!isCounty && d.local['place:' + g]) || d.local[(r.type === 'cdp' ? 'cdp:' : 'place:') + g] || d.local['county:' + fips] || null;
    var lrCounty = lr && lr === d.local['county:' + fips] && !isCounty;
    var orgs = lr ? (lr.housingAuthority || []).map(function (h) { return [h.name, h.url]; }).concat(lr.housingLead && lr.housingLead.name ? [[lr.housingLead.name, lr.housingLead.url]] : [])
      .filter(function (x, i, a) { return a.map(function (y) { return y[0]; }).indexOf(x[0]) === i; }) : [];
    var plans = lr && lr.housingPlans || [];

    // Peers: the same kind of place in the same region, closest in size.
    var peers = list.filter(function (x) { return x.type === r.type && x.region === r.region && x.geoid !== g && x.metrics && x.metrics.population; })
      .sort(function (a, b) { return Math.abs(a.metrics.population - m.population) - Math.abs(b.metrics.population - m.population); }).slice(0, 5)
      .map(function (x) { var k = x.metrics; return { geoid: x.geoid, name: cleanName(x.name), pop: k.population, rent: k.gross_rent_median, burden: k.pct_cost_burdened, gap: k.housing_gap_units, rank: x.rank }; });

    // The second half waits for its own files (about 4 MB), so the top of the page draws first.
    var M = UI.load(MORE);
    needAhl();
    function second() {
      if (M.error) return '<p class="callout">' + esc(M.error) + '</p>';
      if (!M.data) return '<p role="status" class="note">Loading employers, partners, programs and nearby properties…</p>';
      var x = M.data;
      return anchors(d.local, g, fips, isCounty, x.audit, name, cname) + capital(x.capital) + taxBreaks(x.tax, x.fees, g, isCounty, name) + qapCalendar(x.qap) +
        resort(x.resort, g, fips, isCounty, name) +
        (isCounty ? (peers.length ? '<h2>Peer counties in the ' + esc(r.region || 'same') + ' region</h2>' + UI.table('ic-peers', 'Counties in the ' + (r.region || 'same') + ' region, closest in size', [
          { key: 'name', label: 'County', href: function (y) { return '#/ic-summary?g=' + y.geoid; } }, { key: 'pop', label: 'People', num: true, fmt: num },
          { key: 'rent', label: 'Median rent', num: true, fmt: money }, { key: 'burden', label: 'Renters paying 30%+', num: true, fmt: pct1 },
          { key: 'gap', label: 'Homes short at 30% AMI', num: true, fmt: num }, { key: 'rank', label: 'Need rank', num: true }
        ], peers, { noun: 'counties', placeholder: 'County' }) : '') : countyPeers(x, d, g, fips, cname)) +
        awardHistory(x.props, name, fips, isCounty, cname) + comps(withBridge(x.props, x.bridge), d, g, fips, name);
    }

    var where = isCounty ? 'in ' + name : 'within ' + RADIUS + ' miles';
    var finding = name + ' ranks ' + num(r.rank) + ' of ' + num(list.length) + ' Colorado counties, towns and CDPs on housing need. ' +
      (at60 && at60.short != null ? (at60.short > 0 ? num(at60.short) + ' more renter households at or below 60% AMI than homes priced for them. ' : 'At 60% AMI, homes priced for renters outnumber renter households. ') : '') +
      num(near.length) + ' tax credit ' + (near.length === 1 ? 'property' : 'properties') + ' (' + num(nearUnits) + ' affordable homes) ' + (near.length === 1 ? 'sits ' : 'sit ') + where + '.';
    var survey = d.amiPlace.meta.acs_year ? 'ACS ' + (d.amiPlace.meta.acs_year - 4) + '–' + d.amiPlace.meta.acs_year : 'ACS five-year';
    return head('A one-page view of ' + name + ' for lenders and investors: market, need, competition and local partners.',
      '<span class="scope-tag">' + esc(TYPE[r.type]) + (isCounty ? '' : ' in ' + esc(cname)) + '</span> ' + esc(r.region || '') + ' region. Every figure links to its public source.') +
      picker(list, g) + T.printBar() + UI.intro('Is there a case for affordable rental homes in ' + name + '?', finding) +
      '<h2>Profile</h2><div class="metrics">' +
      metric('People', num(m.population)) + metric('Median household income', money(m.median_hh_income)) + metric('Median rent', money(m.gross_rent_median), 'Rent plus utilities, a month') +
      metric('Renters paying 30%+', pct1(m.pct_cost_burdened)) + metric('Households renting', pct1(m.pct_renters)) +
      metric('Homes needed in 20 years', num(m.future_units_needed_20yr), m.incommuter_need_units != null ? num(m.future_units_growth_20yr) + ' for growth, ' + num(m.incommuter_need_units) + ' for in-commuters' : '') + '</div>' +
      T.source('HNA ranking: Census ACS, State Demography Office, HUD CHAS, LEHD', '#/place/' + g, String(d.ranking.metadata.generatedAt).slice(0, 10)) +
      '<h2>Demand by income</h2>' + (amiRows.length ? UI.table('ic-ami', 'Renter households against homes priced for them, at or below each income', [
        { key: 'band', label: 'Income' }, { key: 'rent', label: 'Rent they can pay', num: true, fmt: money },
        { key: 'hh', label: 'Renter households', num: true, fmt: num }, { key: 'units', label: 'Homes priced for them', num: true, fmt: num },
        { key: 'short', label: 'Short', num: true, fmt: function (v) { return v > 0 ? num(v) : 'None'; }, tip: 'Renter households less homes priced for them; none means homes outnumber households' }
      ], amiRows, { noun: 'income bands', placeholder: 'Income' }) + '<p class="note metric-source">' + esc(survey) + ' with HUD ' + esc(d.amiPlace.meta.hud_income_limits_year) + ' income limits for ' + esc(cname) + '. Each band includes the ones below it.</p>' :
        '<p class="note">No income-band figures on file for ' + esc(name) + '.</p>') +
      '<h2>Workers and commuting</h2><div class="metrics">' + metric('People who commute in', num(m.in_commuters)) + metric('Jobs held by in-commuters', pct1(m.commute_ratio), 'Of all jobs here') + metric('Low-wage jobs here', num(m.local_low_wage_jobs), 'Paying $1,250 a month or less') + '</div>' +
      T.source('LEHD LODES origin-destination data', 'https://lehd.ces.census.gov/data/', null) +
      '<h2>Competition</h2><div class="metrics">' + (isCounty ? '' : metric('Tax credit properties in ' + name, num(inPlace.n), num(inPlace.u) + ' affordable homes')) +
      metric('In ' + cname, num(inCounty.n), num(inCounty.u) + ' affordable homes' + (isCounty ? ', ' + num(recent) + ' in service in the last ten years' : '')) +
      (isCounty ? '' : metric('Within ' + RADIUS + ' miles', num(near.length), num(nearUnits) + ' affordable homes, ' + num(recent) + ' in service in the last ten years')) + '</div>' +
      (near.length ? UI.table('ic-near', isCounty ? 'Tax credit properties in ' + name + ', newest first' : 'Tax credit properties within ' + RADIUS + ' miles, nearest first', [
        { key: 'name', label: 'Property' }, { key: 'town', label: 'Town' }].concat(isCounty ? [] : [{ key: 'mi', label: 'Miles', num: true, fmt: function (v) { return v.toFixed(1); } }]).concat([
        { key: 'units', label: 'Affordable homes', num: true, fmt: num }, { key: 'year', label: 'In service', num: true }, { key: 'credit', label: 'Credit' }
      ]), near.sort(function (a, b) { return isCounty ? (b.year || 0) - (a.year || 0) : a.mi - b.mi; }), { noun: 'properties', placeholder: 'Property or town' }) : '') +
      T.source('CHFA housing tax credit properties', d.lihtc.source, String(d.lihtc.fetchedAt).slice(0, 10)) +
      '<h2>Basis boost</h2><div class="metrics">' + metric('Qualified census tracts in ' + cname, num(qcts), 'HUD ' + (d.dda.designationYear || '')) + metric('Difficult development area', dda ? 'Yes' : 'No') + '</div>' +
      '<p>' + esc(ddaText) + ' A building in a qualified census tract also qualifies; check the site’s tract on <a href="#/data/map?layer=qct">the data map</a>.</p>' +
      T.source('HUD qualified census tracts and difficult development areas', 'https://www.huduser.gov/portal/sadda/sadda_qct.html', String(d.qct.fetchedAt).slice(0, 10)) +
      (fc ? '<h2>Awards in ' + esc(cname) + '</h2><div class="metrics">' + metric('Tax credit awards, ' + w.first_year + '–' + w.last_year, num(fc.funding.tax_credit_awards), num(fc.funding.lihtc_units) + ' homes' + (fc.funding.bond_deals_outside_rounds ? ', with ' + num(fc.funding.bond_deals_outside_rounds) + ' 4% bond deals outside the rounds' : '')) +
        metric('Prop 123 awards', num(fc.funding.prop123_awards), money(fc.funding.prop123_dollars)) + metric('Homes short at 30% AMI', num(fc.need.gap_units_30ami), num(fc.funding.lihtc_units_per_100_gap) + ' tax credit homes per 100 short') + '</div>' +
        '<p>Against the other counties, ' + esc(cname) + ' is ' + esc(QUAD[fc.quadrant] || fc.quadrant) + '. <a href="#/places/deep-dive">How counties compare →</a></p>' +
        T.source('CHFA and OEDIT award lists', '#/money?county=' + fips, String(d.fvn.meta.generatedAt).slice(0, 10)) : '') +
      '<h2>Local partners</h2>' + (lr ? '<dl class="ic-civic"><dt>Prop 123 commitment</dt><dd>' + (lr.prop123 ? '<a href="' + esc(lr.prop123.link) + '">' + esc(lr.prop123.status) + '</a>' : 'Not on file') + (lrCounty ? ' (county record)' : '') + '</dd>' +
        '<dt>Housing organisations</dt><dd>' + (orgs.length ? orgs.map(function (o) { return o[1] ? '<a href="' + esc(o[1]) + '">' + esc(o[0]) + '</a>' : esc(o[0]); }).join(', ') : 'None on file') + '</dd>' +
        '<dt>Housing plans</dt><dd>' + (plans.length ? plans.slice(0, 4).map(function (p) { return (p.url ? '<a href="' + esc(p.url) + '">' + esc(p.name || p.type) + '</a>' : esc(p.name || p.type)) + (p.year ? ' (' + esc(p.year) + ')' : ''); }).join('; ') : 'None on file') + '</dd></dl>' +
        '<p><a href="#/places/incentives/' + esc(g) + '">Local housing incentives on record →</a></p>' : '<p class="note">No local housing records on file for ' + esc(name) + '.</p>') +
      second() +
      T.source('Investor summary (IC summary) on cohoanalytics.com', SRC + '?geoid=' + g) +
      T.next('Next', [{ href: '#/deal-calculator', label: 'Run the deal →' }, { href: '#/market?g=' + g, label: 'Market check', secondary: true }, { href: '#/report?g=' + g, label: 'Free report', secondary: true }]);
  }
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (el.dataset && el.dataset.icPick && el.value) location.hash = '#/ic-summary?g=' + encodeURIComponent(el.value);
  });

  Shell.views['ic-summary'] = view;
  global.LabIcSummary = { view: view, FILES: FILES, RADIUS: RADIUS };
})(window);
