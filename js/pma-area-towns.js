/**
 * js/pma-area-towns.js
 * Towns inside a tract-drawn market area, and who works there.
 *
 * 1. Other towns: a market area is built from whole Census tracts, as CHFA's
 *    Market Study Guide requires, so it can take in a second town. Each
 *    Census place's 2020 homes per tract (PL 94-171) name the main town (the
 *    place with the most homes in the area) and flag any tract where another
 *    town holds at least OTHER_TOWN_MIN_SHARE of the tract's homes (and at
 *    least OTHER_TOWN_MIN_HOMES homes) and more of them than the main town. The page does not drop a flagged tract: the analyst
 *    keeps it or drops it with the tract picker.
 * 2. Who works here: LEHD LODES 2023 tract-to-tract jobs (all jobs, JT00).
 *    Jobs in the area's tracts are split into those held by people who live
 *    in the area and those held by in-commuters, by origin town. Jobs in a
 *    flagged tract are counted apart, so another town's jobs are not added
 *    to the main town's. A dropped tract's working residents show up as
 *    in-commuters from it.
 *
 * Display only: nothing here is added to the CHFA count, capture or
 * penetration. CHFA counts demand from outside the market area only with
 * documented tenant-origin data.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PMAAreaTowns = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var PLACES_PATH = 'market/census2020-place-tract-housing-co.json';
  var OD_PATH = 'market/lodes_tract_od_co.json';
  var COUNTIES_PATH = 'hna/geo-config.json';
  var OTHER_TOWN_MIN_HOMES = 25;
  var OTHER_TOWN_MIN_SHARE = 0.10;
  // A home tract is named for a town when the town holds at least half its homes.
  var ORIGIN_TOWN_SHARE = 0.5;
  var SHOWN = 3;
  var _cache = {};

  function load(path) {
    if (_cache[path]) return _cache[path];
    var DS = typeof window !== 'undefined' ? window.DataService : null;
    var url = DS && typeof DS.baseData === 'function' ? DS.baseData(path) : 'data/' + path;
    var get = DS && typeof DS.getJSON === 'function' ? DS.getJSON(url)
      : window.fetch(url).then(function (r) { if (!r || !r.ok) throw new Error('fetch failed: ' + url); return r.json(); });
    _cache[path] = Promise.resolve(get).catch(function () { _cache[path] = null; return null; });
    return _cache[path];
  }

  function shareOf(t) {
    return Number.isFinite(t && t.share) ? Math.max(0, Math.min(1, t.share)) : 1;
  }
  function shortName(name) { return String(name || '').replace(/\s*\((town|city|CDP|city and county)\)\s*$/i, ''); }

  // tract geoid -> [{ place, name, homes }] from the place file.
  function byTract(placeDoc) {
    if (placeDoc._byTract) return placeDoc._byTract;
    var out = {};
    Object.keys(placeDoc.places || {}).forEach(function (pid) {
      var p = placeDoc.places[pid];
      (p.tracts || []).forEach(function (t) {
        if (!(t.housing_units > 0)) return;
        (out[t.tract_geoid] = out[t.tract_geoid] || []).push({ place: pid, name: p.name, homes: t.housing_units });
      });
    });
    Object.defineProperty(placeDoc, '_byTract', { value: out, enumerable: false });
    return out;
  }

  /**
   * tracts: [{ geoid, share }]. Returns null when the place file is missing, else
   * { main: { place, name, homes } | null, others: [{ place, name, homes, tracts: [{ geoid, homes, tractHomes, share }] }],
   *   flagged: { geoid: [place ids] } }.
   */
  function townsInArea(placeDoc, tracts) {
    if (!placeDoc || !placeDoc.places || !placeDoc.tract_housing_units) return null;
    var idx = byTract(placeDoc);
    var totals = {}, names = {};
    var inArea = (tracts || []).filter(function (t) { return t && shareOf(t) > 0; });
    inArea.forEach(function (t) {
      (idx[String(t.geoid)] || []).forEach(function (r) { totals[r.place] = (totals[r.place] || 0) + r.homes; names[r.place] = r.name; });
    });
    var ranked = Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; });
    var main = ranked.length ? { place: ranked[0], name: names[ranked[0]], homes: totals[ranked[0]] } : null;
    var others = {}, flagged = {};
    inArea.forEach(function (t) {
      var gid = String(t.geoid);
      var tractHomes = placeDoc.tract_housing_units[gid] || 0;
      var rows = idx[gid] || [];
      var mainHomes = 0;
      rows.forEach(function (r) { if (main && r.place === main.place) mainHomes = r.homes; });
      rows.forEach(function (r) {
        if (main && r.place === main.place) return;
        if (r.homes < OTHER_TOWN_MIN_HOMES || !(tractHomes > 0 && r.homes / tractHomes >= OTHER_TOWN_MIN_SHARE)) return;
        if (r.homes <= mainHomes) return;
        var o = others[r.place] = others[r.place] || { place: r.place, name: r.name, homes: 0, tracts: [] };
        o.homes += r.homes;
        o.tracts.push({ geoid: gid, homes: r.homes, tractHomes: tractHomes, share: shareOf(t) });
        (flagged[gid] = flagged[gid] || []).push(r.place);
      });
    });
    return {
      main: main,
      others: Object.keys(others).map(function (k) { return others[k]; }).sort(function (a, b) { return b.homes - a.homes; }),
      flagged: flagged
    };
  }

  function townsSentence(towns) {
    if (!towns || !towns.main) return null;
    if (!towns.others.length) return 'Main town: ' + shortName(towns.main.name) + '. No other town is flagged: none holds 10% or more of a tract\'s homes (and 25 or more) and more of them than ' + shortName(towns.main.name) + ' (2020 Census).';
    return 'Main town: ' + shortName(towns.main.name) + '. Also in these tracts: ' + towns.others.map(function (o) {
      return shortName(o.name) + ' (' + o.tracts.map(function (t) {
        return t.homes.toLocaleString('en-US') + ' of ' + t.tractHomes.toLocaleString('en-US') + ' homes in tract ' + t.geoid.slice(5);
      }).join('; ') + ')';
    }).join(', ') + '. CHFA requires whole tracts (\u201cThe market boundary must include entire census tracts\u201d, 2027\u201328 QAP, ' +
      'Appendix A section 4, p. 74), so keep or drop each one with the tract picker; their jobs are counted apart below (2020 Census homes).';
  }

  /**
   * Jobs in the market area and where their workers live.
   * od: lodes_tract_od_co.json; tracts: [{ geoid, share }]; towns: townsInArea();
   * counties: { fips: label }. Work-side counts are weighted by each tract's
   * share in the area; a worker lives in the area when the home tract is in it.
   */
  function inflow(od, placeDoc, tracts, towns, counties) {
    if (!od || !Array.isArray(od.pairs)) return null;
    // Without the town file no tract can be flagged or origin named, so a
    // total would look complete while mixing other towns' jobs in.
    if (!placeDoc || !placeDoc.places || !towns) {
      return { unavailable: true, reason: 'the 2020 Census town file did not load, so jobs in tracts shared with another town cannot be counted apart' };
    }
    var share = {};
    (tracts || []).forEach(function (t) { if (t && shareOf(t) > 0) share[String(t.geoid)] = shareOf(t); });
    if (!Object.keys(share).length) return null;
    var flagged = towns.flagged || {};
    var idx = byTract(placeDoc);
    var tractHomes = placeDoc.tract_housing_units || {};
    function originOf(home) {
      var homes = tractHomes[home] || 0;
      var best = null;
      (idx[home] || []).forEach(function (r) { if (!best || r.homes > best.homes) best = r; });
      if (best && homes > 0 && best.homes / homes >= ORIGIN_TOWN_SHARE) return shortName(best.name);
      var c = counties && counties[home.slice(0, 5)];
      return c ? 'rural ' + c : 'outside any town';
    }
    var jobs = 0, local = 0, inc = 0, apart = 0, by = {}, apartBy = {};
    od.pairs.forEach(function (p) {
      var s = share[p[1]];
      if (!s) return;
      var n = p[2] * s;
      if (flagged[p[1]]) { apart += n; apartBy[p[1]] = (apartBy[p[1]] || 0) + n; return; }
      jobs += n;
      if (share[p[0]]) { local += n; return; }
      inc += n;
      var o = originOf(p[0]);
      by[o] = (by[o] || 0) + n;
    });
    if (jobs <= 0 && apart <= 0) return null;
    var top = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).slice(0, SHOWN)
      .map(function (k) { return { name: k, workers: Math.round(by[k]) }; });
    var m = od.meta || {};
    return {
      jobs: Math.round(jobs), local: Math.round(local), inCommuters: Math.round(inc), top: top,
      apart: Math.round(apart),
      apartTracts: Object.keys(apartBy).map(function (g) { return { geoid: g, jobs: Math.round(apartBy[g]), places: flagged[g] }; }),
      year: m.year || null, jobType: /JT00/.test(m.source_url || '') ? 'all jobs' : 'jobs',
      coverage: m.retained_flow_share || null
    };
  }

  function inflowSentence(s, towns) {
    if (!s) return null;
    if (s.unavailable) return 'Job counts withheld: ' + s.reason + '.';
    var main = towns && towns.main ? shortName(towns.main.name) : 'the market area';
    var out = 'About ' + s.jobs.toLocaleString('en-US') + ' jobs in the ' + main + ' tracts: ' +
      s.local.toLocaleString('en-US') + ' held by people who live in the market area and ' +
      s.inCommuters.toLocaleString('en-US') + ' by in-commuters' +
      (s.top.length ? ', most from ' + s.top.map(function (t) { return t.name + ' (' + t.workers.toLocaleString('en-US') + ')'; }).join(', ') : '') + '.';
    if (s.apart > 0 && towns) {
      var names = {};
      (towns.others || []).forEach(function (o) { names[o.place] = shortName(o.name); });
      out += ' Counted apart: ' + s.apartTracts.map(function (t) {
        return t.jobs.toLocaleString('en-US') + ' jobs in tract ' + t.geoid.slice(5) + ', shared with ' +
          t.places.map(function (p) { return names[p] || p; }).join(' and ');
      }).join('; ') + '.';
    }
    return out + ' None of these is added to demand: CHFA counts people moving in only when comparable projects show it ' +
      '(2027\u201328 QAP, Appendix A section 7, p. 83). LEHD LODES ' + (s.year || '') + ', ' + s.jobType +
      (s.coverage ? ', ' + Math.round(s.coverage * 100) + '% of flows kept' : '') + '.';
  }

  return {
    load: load, townsInArea: townsInArea, townsSentence: townsSentence, inflow: inflow, inflowSentence: inflowSentence,
    PLACES_PATH: PLACES_PATH, OD_PATH: OD_PATH, COUNTIES_PATH: COUNTIES_PATH,
    OTHER_TOWN_MIN_HOMES: OTHER_TOWN_MIN_HOMES, OTHER_TOWN_MIN_SHARE: OTHER_TOWN_MIN_SHARE
  };
}));
