// Compare's per-place records, built the way the public site's Compare builds them (js/compare.js loadAll + buildRecord
// at the pinned commit), so the two pages give the same figures for the same town. The deal-type scores and their parts
// are left out: they stay with the member tools. qa/compare-records.test.js runs the pinned compare.js on every town and
// fails when a field here differs.
// Counties: the public Compare takes towns and CDPs only. For a county each row says how it is counted (the county's
// own tracts, its own CHFA and preservation records by county code, its own scorecard and bond allocation), or that the
// file has no county figure. Nothing is estimated.
(function (global) {
  'use strict';

  // The files the public Compare reads, at the same paths.
  var FILES = {
    qct: 'data/qct-colorado.json', dda: 'data/dda-colorado.json', lihtc: 'data/chfa-lihtc.json',
    membership: 'data/hna/place-tract-membership.json', ami: 'data/co_ami_gap_by_place.json', geo: 'data/hna/geo-config.json',
    scorecard: 'data/policy/housing-policy-scorecard.json', props: 'data/affordable-housing/properties.json',
    pab: 'data/policy/pab-allocations.json', od: 'data/hna/place-od-flows.json',
    r1: 'data/affordable-housing/chfa-awards/2026-round-one.json', watch: 'data/policy/chfa-watchlist.json',
    guide: 'data/policy/co-developer-funding-guide.json', acs: 'data/hna/acs-reliability.json',
    lehd: 'data/hna/place-lehd.json', aliases: 'data/hna/place-phantom-aliases.json'
  };
  var CURRENT_YEAR = new Date().getFullYear();
  var TARGET_EXECUTION = { '9pct': '9%', '4pct': '4%' };

  // The indexes compare.js builds once its files load.
  function index(d) {
    var st = { qctTractIds: new Set(), ddaCountyFips: new Set(), countyName: {}, placeMeta: {}, preservationByCity: {}, preservationByCounty: {}, chfa2026R1ByCity: {}, watchlistByGeoid: {} };
    st.acsGeos = (d.acs && d.acs.geos) || {};
    (d.qct.features || []).forEach(function (f) { if (f.properties && f.properties.GEOID) st.qctTractIds.add(f.properties.GEOID); });
    (d.dda.features || []).forEach(function (f) { if (f.properties && f.properties.GEOID && f.properties.GEOID.length === 5) st.ddaCountyFips.add(f.properties.GEOID); });
    st.projects = (d.lihtc.features || []).filter(function (f) {
      var y = parseInt(f.properties && (f.properties.AwardYear || f.properties.YR_ALLOC), 10);
      return Number.isFinite(y) && y >= 1980 && y <= 2030;
    });
    st.placeMembership = d.membership.places || {};
    st.placeFromAmi = d.ami.places || {};
    st.geoConfig = d.geo || {};
    (st.geoConfig.counties || []).forEach(function (c) { st.countyName[c.geoid] = c.label; });
    [].concat(st.geoConfig.featured || [], st.geoConfig.places || [], st.geoConfig.cdps || []).forEach(function (p) {
      if (!p.geoid) return;
      var lower = (p.label || '').toLowerCase(), type = 'place';
      if (lower.indexOf('cdp') !== -1) type = 'cdp'; else if (lower.indexOf('city') !== -1) type = 'city'; else if (lower.indexOf('town') !== -1) type = 'town'; else if (p.type) type = p.type;
      st.placeMeta[p.geoid] = { label: p.label, containingCounty: p.containingCounty, type: type };
    });
    st.policyScores = (d.scorecard && d.scorecard.scores) || {};
    if (d.props && Array.isArray(d.props.properties)) {
      d.props.properties.forEach(function (p) {
        if (p.program_type.indexOf('preservation-candidate') === -1) return;
        var soon = Number.isFinite(p.years_to_expiration) && p.years_to_expiration >= 0 && p.years_to_expiration <= 5;
        var city = (p.city || '').toUpperCase().trim();
        if (city) { var r = st.preservationByCity[city] || { total: 0, urgent5y: 0 }; r.total++; if (soon) r.urgent5y++; st.preservationByCity[city] = r; }
        var cf = String(p.county_fips || '');
        if (/^\d{5}$/.test(cf)) { var c = st.preservationByCounty[cf] || { total: 0, urgent5y: 0 }; c.total++; if (soon) c.urgent5y++; st.preservationByCounty[cf] = c; }
      });
    }
    st.pabByGeoid = (d.pab && d.pab.allocations) || {};
    st.pabMeta = (d.pab && d.pab.metadata) || null;
    st.placeOdFlows = (d.od && d.od.places) || {};
    st.odMeta = (d.od && (d.od.meta || d.od.metadata)) || {};
    if (d.r1 && Array.isArray(d.r1.awards)) {
      st.chfa2026R1Meta = d.r1.metadata || null;
      d.r1.awards.forEach(function (a) { var key = (a.city || '').trim().toLowerCase(); if (key) (st.chfa2026R1ByCity[key] = st.chfa2026R1ByCity[key] || []).push(a); });
    }
    if (d.watch && Array.isArray(d.watch.entries)) d.watch.entries.forEach(function (e) { if (e && e.place_geoid) st.watchlistByGeoid[e.place_geoid] = e; });
    st.watchMeta = (d.watch && (d.watch.metadata || d.watch.meta)) || {};
    st.fundingGuide = (d.guide && Array.isArray(d.guide.programs)) ? d.guide : null;
    // js/place-lehd-lookup.js: a place's LEHD aggregate, after its alias.
    var lehd = (d.lehd && d.lehd.places) || {}, aliases = (d.aliases && d.aliases.aliases) || {};
    st.lehdLookup = function (g) { var e = lehd[aliases[g] || g]; return e && e.lehd ? e.lehd : null; };
    return st;
  }

  function fundingQuery(target, county, place) {
    return { execution: TARGET_EXECUTION[target] || undefined, projectType: target === 'preservation' ? 'preservation' : undefined, county: county || undefined, place: place || undefined, openOnly: true };
  }
  function fundingFit(st, target, county, place) {
    var F = global.FundingFit;
    if (!F || !st.fundingGuide) return null;
    return F.select(st.fundingGuide, fundingQuery(target, county, place)).length;
  }
  function acsPop(st, g) {
    var e = st.acsGeos[g] && st.acsGeos[g].DP05_0001E;
    var v = e && Number.isFinite(Number(e.e)) ? Math.round(Number(e.e)) : null;
    return { value: v, vintage: v != null && e.y ? 'ACS ' + (e.s === 'acs1' ? e.y + ' 1-year' : (e.y - 4) + '-' + e.y + ' 5-year') : null };
  }
  function labor(within, inflow, outflow, jobs, src) {
    var residents = (within || 0) + (outflow || 0);
    var outflowPct = residents > 0 ? Math.round(100 * (outflow || 0) / residents) : null;
    var character = outflowPct == null ? null : outflowPct >= 70 ? 'bedroom' : outflowPct >= 40 ? 'mixed' : 'self-contained';
    return { within: within, inflow: inflow, outflow: outflow, jobs: jobs, outflowPct: outflowPct, character: character, source: src };
  }
  var fin = function (v) { return Number.isFinite(v) ? v : null; };

  // compare.js buildRecord, without the scores.
  function placeRecord(st, placeGeoid, target) {
    var membership = st.placeMembership[placeGeoid];
    if (!membership) return null;
    var meta = st.placeMeta[placeGeoid] || {};
    var label = (membership.name || meta.label || placeGeoid).replace(/\s*\([^)]+\)\s*$/, '').trim();
    var containingCounty = meta.containingCounty;
    if (!containingCounty) { var t0 = (membership.tracts || [])[0]; if (t0 && t0.tract_geoid) containingCounty = t0.tract_geoid.substring(0, 5); }
    var cityUpper = label.toUpperCase();
    var qctTracts = (membership.tracts || []).filter(function (t) {
      if (!st.qctTractIds.has(t.tract_geoid)) return false;
      var sp = +t.share_of_place_area || 0, sh = +t.share_of_tract_area || 0;
      return sp > 0.05 || sh > 0.20;
    });
    var inside = st.projects.filter(function (p) { return ((p.properties.PROJ_CTY || '').toUpperCase().trim()) === cityUpper; });
    var r1Awards = st.chfa2026R1ByCity[label.toLowerCase()] || [];
    var r1Units = r1Awards.reduce(function (s, a) { return s + (+a.total_units || 0); }, 0);
    var lastAwardYear = inside.reduce(function (m, p) { var y = parseInt(p.properties.AwardYear || p.properties.YR_ALLOC, 10); return (Number.isFinite(y) && y > m) ? y : m; }, -Infinity);
    if (lastAwardYear === -Infinity) lastAwardYear = null;
    var bridgeYear = null;
    if (r1Awards.length && st.chfa2026R1Meta) {
      var rm = /(\d{4})/.exec(st.chfa2026R1Meta.round || '');
      if (rm) bridgeYear = parseInt(rm[1], 10);
      if (bridgeYear == null && typeof st.chfa2026R1Meta.announcement_date === 'string') { var rm2 = /^(\d{4})/.exec(st.chfa2026R1Meta.announcement_date); if (rm2) bridgeYear = parseInt(rm2[1], 10); }
    }
    var lastYear = lastAwardYear;
    if (bridgeYear != null && (lastYear == null || bridgeYear > lastYear)) lastYear = bridgeYear;
    var ownCivic = st.policyScores[placeGeoid];
    var civic = ownCivic || (containingCounty ? st.policyScores[containingCounty] : null);
    var prec = st.preservationByCity[cityUpper] || { total: 0, urgent5y: 0 };
    var ownPab = st.pabByGeoid[placeGeoid], countyPab = containingCounty ? st.pabByGeoid[containingCounty] : null;
    var pabDirect = (ownPab && ownPab.directAllocation) || null, pabIsCounty = false;
    if (pabDirect == null && countyPab && countyPab.directAllocation) { pabDirect = countyPab.directAllocation; pabIsCounty = true; }
    var od = st.placeOdFlows[placeGeoid], lehd = st.lehdLookup(placeGeoid), lab = labor(null, null, null, null, undefined);
    if (od) lab = labor(fin(od.within), fin(od.inflow), fin(od.outflow), fin(od.jobs), 'block-od');
    else if (lehd) lab = labor(fin(lehd.within), fin(lehd.inflow), fin(lehd.outflow), fin(lehd.C000), lehd.flows_source || 'tract-lodes');
    var wl = st.watchlistByGeoid[placeGeoid] || null, pop = acsPop(st, placeGeoid);
    var ys = [lastYear, lastAwardYear]; if (r1Awards.length) ys.push(2026);
    var latest = ys.filter(function (y) { return Number.isFinite(y); }).reduce(function (a, b) { return a > b ? a : b; }, -Infinity);
    return {
      geoid: placeGeoid, county: false, name: label, type: meta.type || 'place', countyFips: containingCounty, countyName: st.countyName[containingCounty] || '—',
      hasQct: qctTracts.length > 0, qctCount: qctTracts.length, hasDda: !!(containingCounty && st.ddaCountyFips.has(containingCounty)),
      civicRawScore: civic && Number.isFinite(civic.totalScore) ? civic.totalScore : null, civicIsCounty: !ownCivic && !!civic,
      projectCount: inside.length, lastYear: lastYear, lastAwardYear: lastAwardYear, r1Count: r1Awards.length, r1Units: r1Units,
      latestChfaActivityYear: latest === -Infinity ? null : latest,
      droughtYears: wl && Number.isFinite(wl.drought_years) ? wl.drought_years : (lastYear == null ? null : Math.max(0, CURRENT_YEAR - lastYear)),
      watchSignal: (wl && wl.signal) || null, watchTracked: true,
      pabDirect: pabDirect, pabIsCounty: pabIsCounty,
      preservationCount: prec.total, preservationUrgent5y: prec.urgent5y,
      labor: lab, fundingProgramsFit: fundingFit(st, target, containingCounty, placeGeoid),
      acsPopulation: pop.value, acsPopulationVintage: pop.vintage
    };
  }

  // A county, counted by its own code. Rows the files carry for towns only are null with towns-only flags.
  function countyRecord(st, fips, target) {
    if (!/^\d{5}$/.test(fips)) return null;
    var qct = 0; st.qctTractIds.forEach(function (t) { if (t.indexOf(fips) === 0) qct++; });
    var inside = st.projects.filter(function (p) { return String(p.properties.CNTY_FIPS || '') === fips; });
    var lastAwardYear = inside.reduce(function (m, p) { var y = parseInt(p.properties.AwardYear || p.properties.YR_ALLOC, 10); return (Number.isFinite(y) && y > m) ? y : m; }, -Infinity);
    if (lastAwardYear === -Infinity) lastAwardYear = null;
    var civic = st.policyScores[fips], prec = st.preservationByCounty[fips] || { total: 0, urgent5y: 0 }, pab = st.pabByGeoid[fips], pop = acsPop(st, fips);
    return {
      geoid: fips, county: true, name: st.countyName[fips] || fips, type: 'county', countyFips: fips, countyName: st.countyName[fips] || '—',
      hasQct: qct > 0, qctCount: qct, hasDda: st.ddaCountyFips.has(fips),
      civicRawScore: civic && Number.isFinite(civic.totalScore) ? civic.totalScore : null, civicIsCounty: false,
      projectCount: inside.length, lastYear: lastAwardYear, lastAwardYear: lastAwardYear, r1Count: null, r1Units: null,
      latestChfaActivityYear: lastAwardYear, droughtYears: lastAwardYear == null ? null : Math.max(0, CURRENT_YEAR - lastAwardYear),
      watchSignal: null, watchTracked: false,
      pabDirect: (pab && pab.directAllocation) || null, pabIsCounty: false,
      preservationCount: prec.total, preservationUrgent5y: prec.urgent5y,
      labor: null, fundingProgramsFit: fundingFit(st, target, fips, undefined),
      acsPopulation: pop.value, acsPopulationVintage: pop.vintage
    };
  }

  function record(st, geoid, target) { return String(geoid).length === 5 ? countyRecord(st, String(geoid), target) : placeRecord(st, String(geoid), target); }

  // The funding programs panel: statewide or regional programs that fit the deal type, then city funds for the places picked.
  function fundingPanel(st, target, picked) {
    var F = global.FundingFit;
    if (!F || !st.fundingGuide) return null;
    var statewide = F.select(st.fundingGuide, fundingQuery(target)).filter(function (r) { return ((r.program.fit || {}).geography || {}).scope !== 'local'; });
    var local = [];
    picked.forEach(function (g) {
      var meta = st.placeMeta[g] || {}, county = meta.containingCounty || (String(g).length === 5 ? String(g) : null);
      F.select(st.fundingGuide, fundingQuery(target, county, g)).forEach(function (r) {
        if (((r.program.fit || {}).geography || {}).scope !== 'local') return;
        if (local.some(function (x) { return x.r.program.id === r.program.id; })) return;
        local.push({ r: r, where: meta.label || st.countyName[g] || g });
      });
    });
    return { statewide: statewide, local: local, execution: TARGET_EXECUTION[target] };
  }

  // js/rent-burden-reliability.js reads its two files from data/ beside the page; in the lab they sit in the pinned copy.
  // Only those two paths are pointed there.
  var RBR_PATHS = { 'data/metadata/rent_burden_sources.json': 1, 'data/processed/rent_burden_crosscheck.json': 1 };
  if (typeof global.fetch === 'function' && global.LAB_VENDOR && !global.fetch.__labRbr) {
    var f0 = global.fetch, wrapped = function (u, o) { return f0.call(global, typeof u === 'string' && RBR_PATHS[u] ? global.LAB_VENDOR + u : u, o); };
    wrapped.__labRbr = true; global.fetch = wrapped;
  }

  global.LabCompareRecords = { FILES: FILES, index: index, record: record, placeRecord: placeRecord, countyRecord: countyRecord, fundingPanel: fundingPanel, fundingQuery: fundingQuery, CURRENT_YEAR: CURRENT_YEAR };
})(typeof window !== 'undefined' ? window : this);
