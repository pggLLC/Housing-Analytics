// Two free pages that finish the seven steps (paul, 30 Oct "build finder and recommendation").
//   #/finder           Opportunity Finder lite: every Colorado town and CDP on the facts that matter for 4% and 9%
//                      tax credit deals, sortable and filterable. It sets no score: the live Finder's weighted
//                      opportunity score (js/lihtc-opportunity-finder.js SCORE_WEIGHTS) stays on the live page,
//                      and places with thin survey data always sort after the rest, never among the first.
//                      QCT and DDA status follow the live Finder: a QCT tract that overlaps the place
//                      (data/hna/place-tract-membership.json), a nonmetro county DDA, or a Small Area DDA ZIP
//                      that reaches into the place. Awards match the CHFA list by city name, as the live Finder does.
//   #/recommendation   Step 7: the public site's own recommendation contract (js/workflow/recommendation-contract.js,
//                      RecommendationContract.build) on the place's HNA digest, with the transit zone summary
//                      (js/transit-zone.js, TransitZone.areaSummary). The lab passes no project into it.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI, Pl = global.LabPlaces, M = global.LabMarket;
  var esc = Shell.esc, num = Pl.num;
  var LIVE = Pl.LIVE;
  var FILES = { members: 'data/hna/place-tract-membership.json', qct: 'data/qct-colorado.json', dda: 'data/dda-colorado.json', counties: 'data/boundaries/counties_co.geojson', centroids: 'data/co-place-centroids.json' };
  var REC_FILES = { transit: 'data/hna/transit-zone-by-geography.json', thiz: 'data/policy/thiz-map-status.json' };
  var STRENGTH = { strong: 'Strong', mixed: 'Mixed', thin: 'Thin' };

  // ---- Finder lite --------------------------------------------------------------------------------
  // The live Finder's city key (js/lihtc-opportunity-finder.js _cityKey), so award matches agree with it.
  function cityKey(name) {
    var k = String(name || '');
    if (k.normalize) k = k.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return k.toUpperCase().replace(/\bFT\b\.?/g, 'FORT').replace(/\bST\b\.?/g, 'SAINT').replace(/\s+/g, ' ').trim();
  }
  function shortName(label) { return String(label || '').replace(/ (town|city|CDP)$/, ''); }
  function ddaZip(f) {
    var p = (f && f.properties) || {}, zip = String(p.ZCTA5 || '');
    return (p.DDA_KIND === 'zip' || p.DDA_TYPE === 'SA' || p.DDATYPE === 'SA') && /^\d{5}$/.test(zip) ? zip : null;
  }

  var rowsCache = null;
  function buildRows(d, x) {
    if (rowsCache) return rowsCache;
    var qct = {}; x.qct.features.forEach(function (f) { if (f.properties && f.properties.GEOID) qct[f.properties.GEOID] = true; });
    var ddaCounty = {}, ddaZips = [];
    x.dda.features.forEach(function (f) { if (ddaZip(f)) ddaZips.push(f); else if (f.properties && String(f.properties.GEOID || '').length === 5) ddaCounty[f.properties.GEOID] = true; });
    var awards = {};
    d.lihtc.features.forEach(function (f) {
      var p = f.properties, k = cityKey(p.PROJ_CTY), y = parseInt(p.AwardYear, 10);
      if (!k) return;
      var a = awards[k] = awards[k] || { count: 0, last: null };
      a.count++; if (y && (!a.last || y > a.last)) a.last = y;
    });
    var now = new Date().getFullYear();
    rowsCache = Object.keys(d.gapPlace.places).map(function (g) {
      var entry = Pl.entryFor(g), f = Pl.placeFacts(g, d);
      if (!entry || !f) return null;
      var name = shortName(entry.label), fips = f.rec.containing_county_fips;
      var mem = x.members.places[g], qn = mem ? mem.tracts.filter(function (t) { return qct[t.tract_geoid]; }).length : null;
      var zips = ddaZips.filter(function (z) { var pl = z.properties.PLACE_GEOIDS; return Array.isArray(pl) && pl.indexOf(g) > -1; }).map(ddaZip);
      var a = awards[cityKey(name)] || null;
      var tally = global.LabStrength.tally(g);
      var county = Pl.countyFacts(fips, d);
      return {
        g: g, label: entry.label, name: name, cdp: / CDP$/.test(entry.label), fips: fips,
        county: county.county ? county.county.county_name : '', nonmetro: !METRO[fips],
        renters: f.rec.renter_households_total, short60: f.bands[3].shortfall,
        qct: qn, ddaCounty: !!ddaCounty[fips], ddaZips: zips,
        boost: (qn > 0) || !!ddaCounty[fips] || zips.length > 0,
        awards: a ? a.count : 0, last: a ? a.last : null, since: a && a.last ? now - a.last : null,
        strength: global.LabStrength.grade(tally)
      };
    }).filter(Boolean);
    return rowsCache;
  }
  // Colorado's 17 metropolitan counties (OMB Bulletin 23-01), as the live Finder lists them (METRO_COUNTY_FIPS):
  // CHFA's QAP gives priority points to non-metro counties.
  var METRO = {}; ['08001', '08005', '08013', '08014', '08019', '08031', '08035', '08039', '08041', '08047', '08059', '08069', '08077', '08093', '08101', '08119', '08123'].forEach(function (f) { METRO[f] = true; });

  var COLS = [
    ['name', 'Place', 'Town, city or CDP, and its county.'],
    ['short60', 'Renters short at 60% AMI', 'Renter households at or below 60% of area income, minus the homes priced for them. Census ACS 2020–2024.'],
    ['qct', 'QCT tracts', 'Qualified Census Tracts that overlap the place. A site in one can get a 30% basis boost.'],
    ['dda', 'DDA', 'Difficult Development Area: the whole county (nonmetro) or ZIPs that reach into the place (Small Area DDA).'],
    ['last', 'Last award', 'Most recent CHFA tax credit award in a project listed under this city.'],
    ['since', 'Years since', 'Years since that award. No award on record sorts as the longest wait.'],
    ['strength', 'Data strength', 'How certain the survey figures are, from their margins of error. Places with thin data are listed after the rest.']
  ];
  var DEFAULT_SORT = { '9': 'since', '4': 'short60' };
  var STRENGTH_ORDER = { strong: 3, mixed: 2, thin: 1 };

  function finderHref(p, change) {
    var o = { t: p.get('t') || '9', sort: p.get('sort') || '', boost: p.get('boost') || '', nm: p.get('nm') || '', thin: p.get('thin') || '', q: p.get('q') || '' };
    Object.keys(change || {}).forEach(function (k) { o[k] = change[k]; });
    var qs = Object.keys(o).filter(function (k) { return o[k] !== ''; }).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&');
    return '#/finder' + (qs ? '?' + qs : '');
  }

  // The places the filters leave, as dots on the county outlines: size by renters short at 60% AMI, blue where a
  // basis boost (QCT or DDA) reaches the place, hollow where the survey data are thin. The first eight in the
  // current sort carry numbers that key to the list under the map. Census Gazetteer centroids, so a dot is the
  // middle of the place, not a site.
  // Statewide frame and projection from site/map-kit.js.
  var K = global.LabMap, MAP_W = K.W, MAP_H = K.H;
  function mx(lon) { return K.x(lon).toFixed(1); }
  function my(lat) { return K.y(lat).toFixed(1); }
  function townMap(rows, x, sortedBy) {
    var cen = (x.centroids || {}).byGeoid || {}, feats = (x.counties || {}).features || [];
    var shown = rows.filter(function (r) { return cen[r.g]; });
    if (!shown.length || !feats.length) return '';
    var max = Math.max.apply(null, shown.map(function (r) { return r.short60 || 0; })) || 1;
    var size = function (r) { return (3 + 13 * Math.sqrt(Math.max(0, r.short60 || 0) / max)).toFixed(1); };
    var outline = feats.map(function (f) {
      var g = f.geometry; return '<path d="' + (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(function (pg) { return pg.map(function (ring) { return 'M' + ring.map(function (c) { return mx(c[0]) + ' ' + my(c[1]); }).join('L') + 'Z'; }).join(''); }).join('') + '"/>';
    }).join('');
    var top = shown.slice(0, 8);
    // Biggest first, so small dots sit on top and stay tappable.
    var dots = shown.slice().sort(function (a, b) { return (b.short60 || 0) - (a.short60 || 0); }).map(function (r) {
      var c = cen[r.g], thin = r.strength === 'thin', col = r.boost ? 'var(--c-blue)' : 'var(--c-green)';
      var lab = r.name + ', ' + r.county + ': ' + (r.short60 == null ? 'renters short not published' : num(r.short60) + ' renters short at 60% AMI') + (r.boost ? ', basis boost' : '') + (thin ? ', thin data' : '');
      return '<a href="#/place/' + esc(r.g) + '" aria-label="' + esc(lab) + '"><circle cx="' + mx(c.lng) + '" cy="' + my(c.lat) + '" r="' + size(r) + '" fill="' + (thin ? 'none' : col) + '" fill-opacity="0.75" stroke="' + col + '" stroke-width="' + (thin ? 2 : 1) + '"><title>' + esc(lab) + '</title></circle></a>';
    }).join('');
    var nums = top.map(function (r, i) {
      var c = cen[r.g], X = +mx(c.lng), Y = +my(c.lat) - +size(r) - 18;
      return '<g aria-hidden="true"><circle cx="' + X + '" cy="' + Y + '" r="17" fill="var(--ink)"/><text x="' + X + '" y="' + (Y + 7) + '" font-size="20" font-weight="700" fill="var(--card)" text-anchor="middle">' + (i + 1) + '</text></g>';
    }).join('');
    // Map kit part 2: the finding is the title, and a size key says what the dot sizes mean.
    var big = shown.filter(function (r) { return r.short60 != null; }).sort(function (a, b) { return b.short60 - a.short60; });
    var finding = big.length ? big[0].name + ' has the most renters short at 60% AMI (' + num(big[0].short60) + ')' + (big[1] ? ', then ' + big[1].name + ' (' + num(big[1].short60) + ')' : '') : 'Where the places are';
    var keyVals = [max, max / 4, max / 16].map(function (v) { return Math.max(1, Math.round(v / (v > 1000 ? 100 : 10)) * (v > 1000 ? 100 : 10)); });
    var sizeKey = '<li class="mk-size"><svg width="96" height="40" viewBox="0 0 96 40" aria-hidden="true">' + keyVals.map(function (v, i) {
      var r = 3 + 13 * Math.sqrt(v / max) * 0.62, cx = [18, 52, 80][i]; return '<circle cx="' + cx + '" cy="' + (36 - r) + '" r="' + r.toFixed(1) + '" fill="none" stroke="var(--ink)" stroke-width="1.2"/>';
    }).join('') + '</svg><span>' + keyVals.map(num).join(', ') + ' renters short</span></li>';
    return '<figure class="pres-map finder-map"><figcaption><span class="cc-kicker">Where the places are</span><strong>' + esc(finding) + '</strong><span class="note">' + num(shown.length) + ' places as filtered. Bigger dots have more renters short at 60% AMI. Numbers mark the first eight in the list below, sorted by ' + esc(sortedBy.toLowerCase()) + '.</span></figcaption>' +
      '<div class="pm-frame"><svg viewBox="0 0 ' + MAP_W + ' ' + MAP_H + '" role="group" aria-label="' + esc((global.LabTpl && global.LabTpl.alt || function (f, s) { return f + '. Source: ' + s + '.'; })(finding, 'Census ACS, HUD')) + '">' +
      '<g fill="var(--map-empty)" stroke="var(--card)" stroke-width="1.5">' + outline + '</g>' + dots + nums + K.metroBox() + K.cities() + '</svg></div>' +
      '<ul class="mk-legend"><li><i style="background:var(--c-blue)"></i>Basis boost (QCT or DDA)</li><li><i style="background:var(--c-green)"></i>No boost</li><li><i style="background:none;border:2px solid var(--muted)"></i>Thin survey data</li>' + sizeKey + '</ul>' +
      // Map kit part 3: the Denver metro close-up, the same dots at the same sizes, so the Front Range separates.
      K.inset({ features: feats, dots: shown.slice().sort(function (a, b) { return (b.short60 || 0) - (a.short60 || 0); }).map(function (r) {
        var c = cen[r.g], thin = r.strength === 'thin', col = r.boost ? 'var(--c-blue)' : 'var(--c-green)';
        return { lon: c.lng, lat: c.lat, r: +size(r) * 1.3, fill: thin ? 'none' : col, href: '#/place/' + esc(r.g), label: esc(r.name + ', ' + r.county + ': ' + (r.short60 == null ? 'renters short not published' : num(r.short60) + ' renters short at 60% AMI')),
          attrs: ' fill-opacity="0.75" stroke="' + col + '" stroke-width="' + (thin ? 2 : 1) + '"' };
      }) }) +
      '<ol class="finder-map-top">' + top.map(function (r) { return '<li><a href="#/place/' + esc(r.g) + '">' + esc(r.name) + '</a> <span class="finder-sub">' + esc(r.county) + (r.short60 == null ? '' : ' · ' + num(r.short60) + ' short at 60%') + '</span></li>'; }).join('') + '</ol>' +
      '<p class="metric-source">' + Pl.srcLine([['Census 2024 Gazetteer place centroids', 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html'], ['Census TIGER county boundaries', 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html']]) + '</p>' +
      (global.LabVizData ? global.LabVizData.block('Places as filtered', ['Place', 'County', 'Renters short at 60% AMI', 'Basis boost (QCT or DDA)', 'Data strength'],
        shown.map(function (r) { return [r.name, r.county, r.short60, r.boost ? 'Yes' : 'No', r.strength || '']; })) : '') + '</figure>';
  }

  function finder(params) {
    var t = params.get('t') === '4' ? '4' : '9';
    var headFor = function (dated) { return T.head({
      kind: 'tool', crumbs: T.trail('opportunities', 'Opportunity Finder lite'), title: 'Opportunity Finder lite',
      answer: 'Every Colorado town and CDP on the facts that matter for a ' + t + '% tax credit deal. Free. It sets no score: sort by what matters to you.',
      dated: dated
    }); };
    var head = headFor();
    var shared = Pl.data(), x = UI.load(FILES), st = global.LabStrength.load();
    var err = shared.error || x.error || st.error;
    if (err) return head + '<p class="callout">' + esc(err) + '</p>';
    if (!shared.data || !x.data || !st.file) return head + '<p role="status" class="note">Loading the public data…</p>';
    var all = buildRows(shared.data, x.data);
    var sort = COLS.some(function (c) { return c[0] === params.get('sort'); }) ? params.get('sort') : DEFAULT_SORT[t];
    var boost = params.get('boost') === '1', nm = params.get('nm') === '1', hide = params.get('thin') === 'hide', q = (params.get('q') || '').toLowerCase();
    var thinCount = all.filter(function (r) { return r.strength === 'thin'; }).length;
    var rows = all.filter(function (r) {
      return (!hide || r.strength !== 'thin') && (!boost || r.boost) && (!nm || r.nonmetro) && (!q || (r.label + ' ' + r.county).toLowerCase().indexOf(q) > -1);
    });
    var key = function (r) {
      if (sort === 'name') return r.label;
      if (sort === 'dda') return (r.ddaCounty ? 2 : 0) + (r.ddaZips.length ? 1 : 0);
      if (sort === 'since') return r.since == null ? 1e6 : r.since;
      if (sort === 'last') return r.last || 0;
      if (sort === 'strength') return STRENGTH_ORDER[r.strength];
      return r[sort] == null ? -1 : r[sort];
    };
    // Thin-data places go after the rest whatever the column, so a small sample never tops the list.
    rows.sort(function (a, b) {
      var ta = a.strength === 'thin' ? 1 : 0, tb = b.strength === 'thin' ? 1 : 0;
      if (ta !== tb && sort !== 'strength') return ta - tb;
      var ka = key(a), kb = key(b);
      if (sort === 'name') return ka < kb ? -1 : ka > kb ? 1 : 0;
      return kb - ka || (b.short60 || 0) - (a.short60 || 0);
    });

    var sortedBy = COLS.filter(function (c) { return c[0] === sort; })[0][1];
    var toggles = '<div class="finder-controls">' +
      '<nav class="region-nav" aria-label="Deal type">' + [['9', '9% competitive'], ['4', '4% with bonds']].map(function (o) {
        return '<a href="' + esc(finderHref(params, { t: o[0], sort: '' })) + '"' + (o[0] === t ? ' aria-current="true"' : '') + '>' + o[1] + '</a>';
      }).join('') + '</nav>' +
      '<nav class="region-nav" aria-label="Filters">' +
      '<a href="' + esc(finderHref(params, { boost: boost ? '' : '1' })) + '"' + (boost ? ' aria-current="true"' : '') + '>Basis boost (QCT or DDA)</a>' +
      '<a href="' + esc(finderHref(params, { nm: nm ? '' : '1' })) + '"' + (nm ? ' aria-current="true"' : '') + '>Non-metro counties</a>' +
      '<a href="' + esc(finderHref(params, { thin: hide ? '' : 'hide' })) + '"' + (hide ? ' aria-current="true"' : '') + '>Hide thin-data places (' + thinCount + ')</a></nav>' +
      '<form class="search" role="search" data-finder="1"><label for="finder-q">Filter by place or county</label><input id="finder-q" name="q" type="search" autocomplete="off" value="' + esc(params.get('q') || '') + '" placeholder="For example Mesa or Salida"></form></div>';
    var why = t === '9'
      ? 'For a 9% deal, CHFA weighs need, a place that has waited longest for an award, the 30% basis boost and non-metro priority. Sorted by years since the last award.'
      : 'For a 4% deal with bonds, the deal needs a deep renter pool and benefits from the basis boost. Sorted by renters short at 60% AMI.';
    var table = '<div class="table-scroll" role="region" aria-label="Places" tabindex="0"><table class="finder-table"><thead><tr>' + COLS.map(function (c) {
      var on = c[0] === sort;
      return '<th scope="col"' + (c[0] !== 'name' ? ' class="num"' : '') + (on ? ' aria-sort="descending"' : '') + ' title="' + esc(c[2]) + '"><a href="' + esc(finderHref(params, { sort: c[0] })) + '">' + esc(c[1]) + (on ? ' ▼' : '') + '</a></th>';
    }).join('') + '</tr></thead><tbody>' + rows.slice(0, 150).map(function (r) {
      return '<tr' + (r.strength === 'thin' ? ' class="finder-thin"' : '') + '><th scope="row"><a href="#/place/' + esc(r.g) + '">' + esc(r.name) + '</a><span class="finder-sub">' + esc(r.county) + (r.cdp ? ' · unincorporated' : '') + '</span></th>' +
        '<td class="num">' + (r.short60 == null ? '—' : num(r.short60)) + '</td>' +
        '<td class="num">' + (r.qct == null ? '—' : r.qct) + '</td>' +
        '<td class="num"' + (r.ddaZips.length && !r.ddaCounty ? ' title="' + esc('ZIP ' + r.ddaZips.join(', ')) + '"' : '') + '>' + esc(r.ddaCounty ? 'County' : r.ddaZips.length ? r.ddaZips.length + (r.ddaZips.length === 1 ? ' ZIP' : ' ZIPs') : '—') + '</td>' +
        '<td class="num">' + (r.last || 'None on record') + '</td>' +
        '<td class="num">' + (r.since == null ? '—' : r.since) + '</td>' +
        '<td class="num"><span class="tier tier-' + (r.strength === 'strong' ? 'good' : r.strength === 'mixed' ? 'fair' : 'use_with_caution') + '">' + STRENGTH[r.strength] + '</span></td></tr>';
    }).join('') + '</tbody></table></div>';

    return headFor(Object.assign({}, x.data, shared.data)) + global.LabHna.stepPath(true, '#/finder') + toggles + '<p class="chapter-finding">' + esc(why) + '</p>' +
      '<p class="count" role="status">' + (rows.length > 150 ? 'Showing 150 of ' + rows.length : rows.length) + ' places, sorted by ' + esc(sortedBy.toLowerCase()) + '.' + (hide ? ' ' + thinCount + ' places with thin survey data are hidden.' : ' Places with thin survey data come after the rest.') + '</p>' + townMap(rows, x.data, sortedBy) + table +
      '<p class="metric-source">' + Pl.srcLine([['HUD QCT and DDA designations, ' + esc(String(x.data.dda.designationYear || '')), 'https://www.huduser.gov/portal/datasets/qct.html'], ['CHFA Housing Tax Credit property list, ' + String(shared.data.lihtc.fetchedAt).slice(0, 10), shared.data.lihtc.source], ['Census ACS 2020–2024', Pl.SRC.acsGap], ['Census TIGER 2024 place and tract boundaries', 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html']]) + '</p>' +
      '<div class="callout">These are facts, not a ranking or a prediction of CHFA points. A Small Area DDA counts only for a site inside the ZIP. Awards match by city name, so a project listed under a neighboring city is not counted here. The full Opportunity Finder adds COHO’s weighted screen, maps and local support.</div>' +
      T.next('Next', [{ href: '#/market', label: 'Market check a place' }, { href: LIVE + 'lihtc-opportunity-finder.html' + (/^\d{5,7}$/.test(params.get('g') || '') ? '?geoid=' + params.get('g') : ''), label: 'Full Opportunity Finder ↗', secondary: true }]);
  }
  document.addEventListener('input', function (ev) {
    var form = ev.target.form;
    if (!form || !form.dataset || !form.dataset.finder) return;
    var p = new URLSearchParams((location.hash.split('?')[1]) || '');
    history.replaceState(null, '', finderHref(p, { q: ev.target.value }));
    Shell.render();
  });

  // ---- Recommendation ------------------------------------------------------------------------------
  var STATE_WORD = { established: 'Established', provisional: 'Provisional', insufficient: 'Insufficient evidence' };
  function chip(s) { return '<span class="rec-chip rec-' + esc(s) + '">' + esc(STATE_WORD[s] || s) + '</span>'; }
  // As the live page formats a value (js/workflow/recommendation-page.js formatValue).
  function fmt(item) {
    if (item.value === null || item.value === undefined) return 'no figure';
    if (typeof item.value === 'number') return item.unit === 'pct' ? item.value + '%' : item.value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return String(item.value);
  }

  // Where each of the contract's project steps is done in the lab, or on the live site where the lab has no page yet.
  function stepHref(key, g) {
    var q = encodeURIComponent(g);
    return { jurisdiction: '#/places', hsa: '#/place/' + q, market: '#/market?g=' + q, deal: '#/deal-calculator?g=' + q }[key] || null;
  }
  // The contract's own record of each project step, as the live page lists it under the same heading.
  function recorded(r, g, mine) {
    var steps = (r.project || []).map(function (st) {
      var href = stepHref(st.key, g), live = !href ? 'https://cohoanalytics.com/' + st.href : null;
      var first = st.fields && st.fields[0];
      return '<li class="rec-step rec-step-' + esc(st.status) + '"><span class="rec-step-name">' + esc(st.label) + '</span>' +
        (st.status === 'not_run' ? '<span class="rec-step-state">Not run</span>'
          : '<span class="rec-step-state">' + (first ? esc(first.label) + ': ' + esc(fmt(first)) : st.savedElsewhere ? 'Saved for another place' : 'Recorded') +
            (st.recordedAt ? ', ' + esc(String(st.recordedAt).slice(0, 10)) : '') + '</span>') +
        '<a href="' + esc(href || live) + '">' + (st.status === 'not_run' ? 'Open this step' : 'Reopen this step') + (live ? ' ↗' : '') + '</a></li>';
    }).join('');
    return '<section class="rec-project"><h2>What you have recorded</h2>' +
      '<p>The steps a project records for this place. Each answer above covers only the steps that are recorded.</p>' +
      '<ol class="rec-steps">' + steps + '</ol>' +
      (mine.length ? '<p>Projects saved in this browser for this place:</p><ul class="route-list">' + mine.map(function (p) { return '<li><a href="#/project/' + esc(p.projectId) + '">' + esc(p.name) + '</a></li>'; }).join('') + '</ul>'
        : '<p class="note">No project is saved in this browser for this place. Projects built on these pages are not read here yet, so every step reads as not run.</p>') + '</section>';
  }
  // Every source the conclusions drew on, with its date, named as the rest of the lab names it.
  function figureSources(r, g) {
    var list = r.sources || [];
    if (!list.length) return '';
    return '<section class="rec-sourcelist"><h2>Where the figures come from</h2><ul>' + list.map(function (it) {
      var name = global.LabHna.sourceOf({ source_id: it.source, as_of: it.asOf }, { geoid: g }) || it.source;
      return '<li>' + esc(name) + (it.asOf && String(name).indexOf(String(it.asOf)) === -1 ? ', ' + esc(it.asOf) : '') + '</li>';
    }).join('') + '</ul></section>';
  }

  function ladderFor(g) {
    var sh = Pl.data && Pl.data();
    if (!sh || !sh.data || !Pl.ladder || !Pl.placeFacts) return '';
    var place = Pl.placeFacts(g, sh.data);
    return place ? Pl.ladder(place) : '';
  }

  function recommendation(params) {
    var g = params.get('g');
    if (!g) return M.picker('recommendation', 'Recommendation', 'What the public data says a Colorado town or county needs, one conclusion at a time, and how sure it is. Free.', params.get('q'), 'deal');
    var entry = Pl.entryFor(g), title = 'Recommendation';
    var headOnly = function (body) { return T.head({ kind: 'tool', crumbs: T.trail('deal', title), title: title }) + body; };
    if (!entry) return headOnly('<p class="callout">No Colorado place has the ID ' + esc(g) + '.</p>');
    var RC = global.RecommendationContract, TZ = global.TransitZone;
    if (!RC) return headOnly('<p class="callout">The site’s recommendation engine did not load.</p>');
    var c = global.LabHna.loadPlace(g), x = UI.load(REC_FILES);
    if (c.error || x.error) return headOnly('<p class="callout">' + esc(c.error || x.error) + '</p>');
    if (!c.digest || !x.data) return headOnly('<p role="status" class="note">Loading the public data for ' + esc(entry.label) + '…</p>');
    var tz = TZ ? TZ.areaSummary(x.data.transit, g, x.data.thiz, new Date()) : null;
    var r = RC.build({ digest: c.digest, project: null, transitZone: tz, generatedAt: new Date().toISOString() });
    var h = r.headline;
    var cards = r.conclusions.map(function (k) {
      return '<article class="rec-card rec-card-' + esc(k.state) + '"><p class="rec-q">' + esc(k.question) + '</p>' +
        '<h3>' + (k.verdict ? esc(k.verdict) : '<span class="rec-none">No answer from public data</span>') + ' ' + chip(k.state) + '</h3>' +
        (k.plain ? '<p>' + esc(k.plain) + '</p>' : '') +
        (k.blocking && k.blocking.length ? '<ul class="rec-blocking">' + k.blocking.map(function (b) { return '<li>' + esc(b.label + ': ' + (b.why || 'no figure')) + '</li>'; }).join('') + '</ul>' : '') +
        '<details><summary>Evidence (' + k.usableCount + ' of ' + k.evidenceCount + ' usable)</summary><div class="table-scroll"><table><thead><tr><th scope="col">Measure</th><th scope="col">Value</th><th scope="col">Standing</th><th scope="col">Source</th></tr></thead><tbody>' +
        k.evidence.map(function (e) {
          return '<tr><th scope="row">' + esc(e.label) + '</th><td>' + esc(fmt(e)) + (e.borrowedFrom ? ' <span class="note">from ' + esc(e.borrowedFrom.replace(/_/g, ' ')) + '</span>' : '') + '</td><td>' + chip(e.state) + '</td>' +
            '<td>' + esc(global.LabHna.sourceOf({ source_id: e.source, as_of: e.asOf }, { geoid: g }) || e.source || 'source not recorded') + (e.why ? '<span class="note"> ' + esc(e.why) + '</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div></details></article>';
    }).join('');
    var mine = global.LabProjects ? global.LabProjects.list().filter(function (p) { return p.jurisdiction && p.jurisdiction.geoid === String(g); }) : [];
    return T.head({
      kind: 'tool', crumbs: T.trail('deal', title, [{ label: 'Pick a place', href: '#/recommendation' }]), title: 'Recommendation: ' + entry.label,
      answer: 'What the public data says ' + esc(shortName(entry.label)) + ' needs, one question at a time. Each answer says how much weight it can bear.',
      // Gemini round 16, page 06 (paul 11-06 "fix the gaps"): the first phone screen shows the gap the place's
      // homes leave at each income, the same ladder as its county overview, read from the same gap files.
      strip: ladderFor(g)
    }) + T.printBar() + global.LabHna.stepPath(true, '#/recommendation', g) +
      '<section class="rec-headline rec-card-' + esc(h.state) + '"><p class="rec-q">The direction</p><h2>' + esc(h.verdict) + ' ' + chip(h.state) + '</h2><p>' + esc(h.plain) + '</p></section>' +
      '<div class="rec-cards">' + cards + '</div>' +
      recorded(r, g, mine) + figureSources(r, g) +
      '<p class="metric-source">Assembled by the site’s recommendation contract from the HNA digest' + (c.digest.generated_from && c.digest.generated_from.ranking_index_generated_at ? ', built ' + esc(String(c.digest.generated_from.ranking_index_generated_at).slice(0, 10)) : '') + '. Transit: CDOT and transit agency stops, OEDIT zone status.</p>' +
      T.next('Next', [{ href: '#/report?g=' + encodeURIComponent(g), label: 'Free report for ' + shortName(entry.label) }, { href: '#/deal-calculator?g=' + encodeURIComponent(g), label: 'Deal Calculator', secondary: true }, { href: '#/market?g=' + encodeURIComponent(g), label: 'Market check', secondary: true }]);
  }

  Shell.views.finder = finder;
  Shell.views.recommendation = recommendation;
  global.LabFinder = { finder: finder, recommendation: recommendation, cityKey: cityKey, METRO: METRO, buildRows: buildRows };
})(window);
