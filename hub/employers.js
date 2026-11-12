// Largest employers for any town or county, in one block the HNA chapter and the IC summary share.
// It reads two Housing-Analytics files and nothing of its own, so it ports as is:
//   data/market/principal-employers.json  "Principal Employers" tables from audited annual financial
//                                         reports (State Auditor library), each with its year, counts and PDF page.
//   data/hna/local-resources.json         hand-entered majorEmployers lists per town or county.
//   data/market/public-employers.json     staff headcount of every school district and BOCES (CDE), by county.
//                                         Optional: shown only where no list exists, and never as a ranking.
//   data/market/cbp-workplace-size.json   Census County Business Patterns: private workplaces by size, by county.
//                                         Optional: one line on every page, for the county; names no employer.
//   data/market/public-jobs.json          LEHD LODES: government jobs as a share of all jobs, by county and town.
//                                         Optional: one line on every page (the town's own where published); names no employer.
// Order: a dated list for the town, then the town's own entered list, then the county's dated list, then the
// county's entered list. A list with no dated source is labelled unconfirmed. Where none exists the block
// says so plainly; jobs by industry (LEHD LODES) is the answer the page shows instead.
(function (global) {
  'use strict';

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var bare = function (s) { return String(s || '').replace(/\s*\((city|town|CDP)\)$/i, '').replace(/^(city and county of|city of|town of)\s+/i, '').trim().toLowerCase(); };
  var hasYear = function (s) { return /\b(19|20)\d\d\b/.test(String(s || '')); };
  var PATHS = { audit: 'data/market/principal-employers.json', local: 'data/hna/local-resources.json', public: 'data/market/public-employers.json', cbp: 'data/market/cbp-workplace-size.json', jobs: 'data/market/public-jobs.json' };

  // An audit table is a county's when its area names a county; otherwise it is the town it names
  // (Glenwood Springs, Steamboat Springs, Commerce City, Littleton). place_geoid, when the file carries it, wins.
  function isCountyArea(a) { return /county/i.test(a.area) && !a.place_geoid; }
  function townArea(audit, geoid, name, fips) {
    return (audit.areas || []).filter(function (a) {
      if (a.place_geoid) return String(a.place_geoid) === String(geoid);
      return !isCountyArea(a) && (a.county_fips || []).indexOf(fips) !== -1 && bare(a.area) === bare(name);
    })[0] || null;
  }
  function countyArea(audit, fips) {
    var all = (audit.areas || []).filter(function (a) { return (a.county_fips || []).indexOf(fips) !== -1; });
    return all.filter(isCountyArea)[0] || null;
  }

  function fromAudit(a, level) {
    var s = a.source || {};
    return {
      level: level, kind: 'audit', area: a.area, year: a.as_of,
      rows: (a.rows || []).map(function (r) { return { name: r.employer, count: r.employees, rank: r.rank }; }),
      source: { label: (s.filer || a.area) + ', annual financial report, “' + (a.schedule || 'Principal Employers') + '”' + (s.pdf_page ? ', PDF page ' + s.pdf_page : ''), url: s.url || null, stated: a.stated_source || null }
    };
  }
  function fromLocal(rec, level, area) {
    var src = rec._employers_source || null, rows = rec.majorEmployers || [];
    // Dated when the source line names a year, or every row's own note does.
    var dated = (src && hasYear(src.label)) || (rows.length && rows.every(function (e) { return hasYear(e.note); }));
    var year = src && (String(src.label).match(/\b(19|20)\d\d\b/) || [])[0];
    return {
      level: level, kind: dated ? 'listed' : 'unconfirmed', area: area, year: year || null,
      rows: rows.map(function (e) { return { name: e.name, url: e.url || null, note: e.note || null, housing: e.workforce_housing_url || null }; }),
      source: src ? { label: src.label, url: src.url || null } : null
    };
  }

  // pick(files, { geoid, name, countyFips, countyName }) -> { main, county } or null while a file is loading.
  function pick(files, g) {
    var audit = files.audit, local = files.local;
    if (!audit || !local) return null;
    var isCounty = String(g.geoid).length === 5, fips = isCounty ? g.geoid : g.countyFips;
    var townRec = isCounty ? null : (local['place:' + g.geoid] || local['cdp:' + g.geoid] || null);
    var cRec = fips ? local['county:' + fips] : null;
    var cAudit = fips ? countyArea(audit, fips) : null;
    var tAudit = isCounty ? null : townArea(audit, g.geoid, g.name, fips);
    var cList = cAudit ? fromAudit(cAudit, 'county') : cRec && cRec.majorEmployers && cRec.majorEmployers.length ? fromLocal(cRec, 'county', g.countyName) : null;
    // A county page with no county-wide table but a town's table inside it (Garfield: Glenwood Springs).
    if (isCounty && !cList) {
      var inside = (audit.areas || []).filter(function (a) { return !isCountyArea(a) && (a.county_fips || []).indexOf(fips) !== -1; })[0];
      if (inside) cList = fromAudit(inside, 'town-in-county');
    }
    // A county's hand-entered list beside a dated town table inside it: show that table's top rows too.
    if (isCounty) {
      var dated = cList && cList.kind === 'unconfirmed' ? (audit.areas || []).filter(function (a) { return !isCountyArea(a) && (a.county_fips || []).indexOf(fips) !== -1; })[0] : null;
      return { main: cList, county: dated ? fromAudit(dated, 'town-in-county') : null };
    }
    var main = tAudit ? fromAudit(tAudit, 'town') : townRec && townRec.majorEmployers && townRec.majorEmployers.length ? fromLocal(townRec, 'town', g.name) : null;
    if (!main) return { main: cList, county: null, fellBack: !!cList };
    // A town's own list that is unconfirmed, with a dated county table beside it: show the county's top rows too.
    return { main: main, county: main.kind === 'unconfirmed' && cList && cList.kind === 'audit' ? cList : null };
  }

  function rowsHtml(L, max) {
    var tag = L.rows.every(function (r) { return r.rank != null; }) ? 'ol' : 'ul';
    return '<' + tag + ' class="emp-list">' + L.rows.slice(0, max || 10).map(function (r) {
      var name = r.url ? '<a href="' + esc(r.url) + '" rel="noopener">' + esc(r.name) + '</a>' : esc(r.name);
      return '<li><span class="emp-name">' + name + '</span>' +
        (/\d/.test(r.count || '') ? ' <span class="emp-count">' + esc(r.count) + ' employees</span>' : '') +
        (r.housing ? ' <a class="emp-housing" href="' + esc(r.housing) + '" rel="noopener">workforce housing program</a>' : '') +
        (r.note && !r.count && L.kind !== 'audit' ? '<span class="emp-note">' + esc(r.note) + '</span>' : '') + '</li>';
    }).join('') + '</' + tag + '>';
  }
  // Counts printed as plain numbers draw as bars (site/viz.js); ranges and names-only lists stay a list.
  function counted(L) {
    var n = L.rows.map(function (r) { return /^[\d,]+$/.test(String(r.count || '').trim()) ? Number(String(r.count).replace(/,/g, '')) : null; });
    return L.kind === 'audit' && n.length && n.every(function (x) { return x != null; }) ? n : null;
  }
  function chart(L) {
    var V = global.LabViz, n = counted(L);
    if (!V || !n) return null;
    var srcP = srcHtml(L).replace(/^<p class="metric-source">|<\/p>$/g, '');
    return V.orderedBars({ title: 'Employees, as printed, ' + L.year, noShare: true, rows: L.rows.slice(0, 10).map(function (r, i) { return [r.name, n[i]]; }),
      answer: L.rows[0].name + ' is the largest, with ' + L.rows[0].count + ' employees.', source: srcP, label: 'Largest employers, ' + L.area + ', ' + L.year });
  }
  function srcHtml(L) {
    if (L.kind === 'audit') {
      var s = L.source;
      return '<p class="metric-source">' + (s.url ? '<a href="' + esc(s.url) + '" rel="noopener">' + esc(s.label) + '</a>' : esc(s.label)) + ', ' + esc(L.year) +
        (s.stated ? '. Its source: ' + esc(s.stated) : '') + (L.rows.some(function (r) { return /\d/.test(r.count || ''); }) ? '. Counts as printed; ranges stay ranges.' : '. Names only; no counts are printed.') + '</p>';
    }
    if (L.kind === 'listed') return '<p class="metric-source">' + (L.source ? (L.source.url ? '<a href="' + esc(L.source.url) + '" rel="noopener">' + esc(L.source.label) + '</a>' : esc(L.source.label)) : 'Sources and dates in each line') + '.</p>';
    return '<p class="metric-source emp-unconfirmed"><strong>Unconfirmed list.</strong> Entered by hand with no dated source on file yet' +
      (L.source ? ' (named source: ' + (L.source.url ? '<a href="' + esc(L.source.url) + '" rel="noopener">' + esc(L.source.label) + '</a>' : esc(L.source.label)) + ')' : '') + '. Check before using it.</p>';
  }
  function where(L, here) {
    if (L.level === 'county') return (L.area || 'the county') + (here ? ', the county ' + here + ' is in' : '');
    return L.area || here;
  }

  // School districts and BOCES in the county, with their staff headcount (files.public, optional).
  function schools(files, fips) {
    var P = files.public, rows = P && P.counties && P.counties[fips];
    return rows && rows.length ? { meta: P.meta || {}, rows: rows } : null;
  }
  function schoolsHtml(S, countyName) {
    var m = S.meta, src = m.source || {};
    return '<p class="emp-lead">One employer every county has: its public schools. People employed by each school district and BOCES ' +
      'with its office in ' + esc(countyName) + ', ' + esc(m.as_of) + ':</p><ul class="emp-list">' + S.rows.slice(0, 6).map(function (r) {
        return '<li><span class="emp-name">' + esc(r.employer) + '</span> <span class="emp-count">' + esc(Number(r.headcount).toLocaleString('en-US')) + ' staff</span></li>';
      }).join('') + '</ul><p class="metric-source">' + (src.url ? '<a href="' + esc(src.url) + '" rel="noopener">' + esc(src.label) + '</a>' : esc(src.label || 'Colorado Department of Education')) +
      ', headcount, all job categories, full- and part-time. District-wide counts. Not a ranking of the largest employers.</p>';
  }

  // Big private workplaces in the county (files.cbp, optional). CBP counts locations, not companies, and leaves out
  // government; where it withholds the count the line says so and gives the most there could be.
  var SHORT = { '62': 'health care', '44': 'retail', '72': 'hotels and restaurants', '31': 'manufacturing', '56': 'business support services',
    '54': 'professional services', '52': 'finance and insurance', '48': 'transportation and warehousing', '23': 'construction', '42': 'wholesale',
    '51': 'information', '61': 'private schools and colleges', '71': 'arts and recreation', '21': 'mining and oil and gas', '22': 'utilities',
    '55': 'company offices', '53': 'real estate', '81': 'other services', '11': 'farming and forestry' };
  function cbpHtml(files, fips, countyName, isTown) {
    var C = files.cbp, c = C && C.counties && C.counties[fips], m = C && C.meta;
    if (!c || !m) return '';
    var n = function (x) { return Number(x).toLocaleString('en-US'); }, where = esc(countyName) + (isTown ? ' (county-wide)' : '');
    var big = c.by_size || {}, line;
    if (c.large === null) line = 'The Census Bureau does not publish how many private workplaces in ' + where + ' have 100 or more employees; at most ' + n(c.large_at_most) + ' do.';
    else if (c.large === 0) line = 'No private workplace in ' + where + ' has 100 or more employees.';
    else {
      var top = [['500-999', '500 to 999'], ['1,000 or more', '1,000 or more']].filter(function (k) { return big[k[0]]; })
        .map(function (k) { return n(big[k[0]]) + ' with ' + k[1]; });
      var sec = (c.large_by_sector || []).slice(0, 3).map(function (x) { return (SHORT[x.naics] || x.sector.toLowerCase()) + ' (' + n(x.workplaces) + ')'; });
      line = n(c.large) + ' private workplace' + (c.large === 1 ? '' : 's') + ' in ' + where + ' had 100 or more employees' + (top.length ? ', ' + top.join(' and ') : '') + '.' +
        (sec.length ? ' By sector, where published: ' + sec.join(', ') + '.' : '');
    }
    var src = m.source || {};
    return '<p class="emp-cbp"><strong>Big private workplaces, ' + esc(m.year) + '.</strong> ' + line + '</p><p class="metric-source">' +
      (src.url ? '<a href="' + esc(src.url) + '" rel="noopener">' + esc(src.label) + '</a>' : esc(src.label || 'County Business Patterns')) +
      ', ' + esc(m.reference_week) + '. Counts locations, not companies, and names none. Leaves out government, so schools and county offices are not in it.</p>';
  }

  // Government jobs as a share of all jobs (files.jobs, optional). The town's own line where LEHD publishes enough
  // jobs for one; otherwise the county's, said so. Names no employer; CBP above leaves government out, this puts it back.
  function jobsRow(files, g) {
    var J = files.jobs; if (!J || !J.meta) return null;
    var isTown = String(g.geoid).length !== 5, fips = isTown ? g.countyFips : g.geoid;
    var t = isTown && J.places ? J.places[g.geoid] : null;
    if (t && t.shown) return { r: t, where: g.here, meta: J.meta, countyWide: false };
    var c = J.counties && J.counties[fips];
    if (c && c.shown) return { r: c, where: g.countyName || c.name || g.here, meta: J.meta, countyWide: isTown, townWhy: t && t.why_not };
    return null;
  }
  function jobsHtml(files, g) {
    var x = jobsRow(files, g); if (!x) return '';
    var r = x.r, m = x.meta, n = function (v) { return Number(v).toLocaleString('en-US'); };
    var pct = Math.round(r.government_share * 100), where = (x.countyWide ? 'county-wide in ' : 'in ') + esc(x.where);
    var line = n(r.government) + ' of ' + n(r.jobs) + ' jobs ' + where + ' (' + pct + '%) are with government: ' + n(r.state_local) +
      ' state and local, ' + n(r.federal) + ' federal.' +
      (r.private_large_firms ? ' Another ' + n(r.private_large_firms) + ' are at private companies with 500 or more employees nationwide.' : '');
    if (x.countyWide && x.townWhy) line += ' ' + esc(g.here) + ' itself has too few jobs in the LEHD count for its own share.';
    var src = m.source || {};
    return '<p class="emp-jobs"><strong>Government jobs, ' + esc(m.year) + '.</strong> ' + line + '</p><p class="metric-source">' +
      (src.url ? '<a href="' + esc(src.url) + '" rel="noopener">' + esc(src.label) + '</a>' : esc(src.label || 'LEHD LODES')) +
      '. Jobs counted where people work. Government means school districts, counties, towns, hospital and other districts, universities, state and federal agencies. ' +
      'Names no employer. Small-area counts carry Census noise, and some state employees are counted at an office address.</p>';
  }

  // block(files, g) -> HTML. g.here is the plain place name; g.searchName feeds the web-search link.
  function block(files, g) {
    var P = pick(files, g);
    var h = '<section class="emp-block" aria-labelledby="emp-h-' + esc(g.geoid) + '"><h3 id="emp-h-' + esc(g.geoid) + '">Largest employers</h3>';
    if (!P) return h + '<p role="status" class="note">Loading the employer lists…</p></section>';
    var search = 'https://www.google.com/search?q=' + encodeURIComponent('"largest employers" "' + (g.searchName || g.here) + '" Colorado');
    if (!P.main) {
      var fips = String(g.geoid).length === 5 ? g.geoid : g.countyFips;
      var chk = ((files.audit.meta || {}).checked_no_schedule || {})[fips];
      return h + '<p class="emp-none"><strong>No published list of the largest employers for ' + esc(g.here) + '.</strong> ' +
        (chk ? 'The audited annual reports filed by ' + esc(g.countyName || g.here) + ' and its towns and school districts (checked ' + esc(chk) + ') do not print one.'
          : 'None is on file from a dated source yet.') +
        (g.industries ? ' The industry chart above shows where its jobs are.' : '') + '</p>' +
        (schools(files, fips) ? schoolsHtml(schools(files, fips), g.countyName || g.here) : '') +
        cbpHtml(files, fips, g.countyName || g.here, String(g.geoid).length !== 5) + jobsHtml(files, g) +
        '<p class="note"><a href="' + esc(search) + '" rel="noopener">Search the web for its largest employers</a></p></section>';
    }
    var L = P.main;
    var lead = L.level === 'town-in-county' ? 'No county-wide table is printed. ' + esc(L.area) + ', inside the county, prints its own:'
      : P.fellBack ? 'None on file for ' + esc(g.here) + ' itself. This is the list for ' + esc(where(L)) + ':'
      : L.level === 'county' && String(g.geoid).length !== 5 ? 'County list:' : '';
    h += (lead ? '<p class="emp-lead">' + lead + '</p>' : '') + (chart(L) || rowsHtml(L) + srcHtml(L));
    if (P.county) h += '<p class="emp-lead">' + esc(P.county.area) + '’s audited table, ' + esc(P.county.year) + ', top three: ' +
      P.county.rows.slice(0, 3).map(function (r) { return esc(r.name) + (/\d/.test(r.count || '') ? ' (' + esc(r.count) + ')' : ''); }).join(', ') +
      (P.county.source.url ? ' (<a href="' + esc(P.county.source.url) + '" rel="noopener">PDF</a>)' : '') + '.</p>';
    h += cbpHtml(files, String(g.geoid).length === 5 ? g.geoid : g.countyFips, g.countyName || g.here, String(g.geoid).length !== 5) + jobsHtml(files, g);
    return h + '<p class="note">Big employers set the incomes a project should serve, and some run workforce housing programs. ' +
      '<a href="' + esc(search) + '" rel="noopener">Search further</a></p></section>';
  }

  // One line for a folded summary.
  function take(files, g) {
    var P = pick(files, g);
    if (!P) return '';
    if (!P.main) {
      var S = schools(files, String(g.geoid).length === 5 ? g.geoid : g.countyFips);
      return 'No published list of largest employers.' + (S ? ' Largest school district: ' + S.rows[0].employer + ', ' + Number(S.rows[0].headcount).toLocaleString('en-US') + ' staff (' + S.meta.as_of + ').' : '');
    }
    var L = P.main;
    return 'Largest employer' + (L.level === 'county' && String(g.geoid).length !== 5 ? ' in the county' : '') + ': ' + L.rows[0].name + (L.kind === 'unconfirmed' ? ' (unconfirmed).' : '.');
  }

  global.LabEmployers = { PATHS: PATHS, pick: pick, block: block, take: take };
  if (typeof module !== 'undefined') module.exports = global.LabEmployers;
})(typeof window !== 'undefined' ? window : globalThis);
