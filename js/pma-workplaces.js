/**
 * js/pma-workplaces.js
 * "Where residents work" for the market area: the towns that employ the most of
 * the market area's working residents, from LEHD LODES 2023 primary jobs.
 *
 * Reads data/market/tract-workplaces.json (scripts/market/build_tract_workplaces.py).
 * Each tract counts by the share of it inside the market area, the same share the
 * page uses for households. Display and export only: it adds no demand and changes
 * no score. NCHMA's market-study standard asks for commuting destinations
 * (Model Content Standards v3.1, III.F.8); CHFA counts outside demand only when
 * comparable projects document it.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PMAWorkplaces = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var PATH = 'market/tract-workplaces.json';
  var SHOWN = 3;
  var _load = null;

  function load() {
    if (_load) return _load;
    var DS = typeof window !== 'undefined' ? window.DataService : null;
    var url = DS && typeof DS.baseData === 'function' ? DS.baseData(PATH) : 'data/' + PATH;
    var get = DS && typeof DS.getJSON === 'function' ? DS.getJSON(url)
      : window.fetch(url).then(function (r) { if (!r || !r.ok) throw new Error('fetch failed: ' + url); return r.json(); });
    _load = Promise.resolve(get).catch(function () { _load = null; return null; });
    return _load;
  }

  /**
   * tracts: [{ geoid, share }] (share 0–1, missing = 1).
   * Returns null when the file or every tract is missing, else
   * { workers, otherStates, noTown, top: [{ geoid, name, workers, share }], year, tractsMissing }.
   * A town's count is a floor: a tract lists only its top towns, so smaller flows are not added.
   */
  function summarize(data, tracts) {
    if (!data || !data.tracts) return null;
    var workers = 0, other = 0, noTown = 0, missing = 0;
    var by = {};
    (tracts || []).forEach(function (t) {
      var rec = t && data.tracts[String(t.geoid)];
      if (!rec) { missing++; return; }
      var s = Number.isFinite(t.share) ? Math.max(0, Math.min(1, t.share)) : 1;
      workers += rec.workers * s;
      other += rec.other_states * s;
      noTown += rec.no_town * s;
      (rec.to || []).forEach(function (p) { by[p[0]] = (by[p[0]] || 0) + p[1] * s; });
    });
    if (workers <= 0) return null;
    var top = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).slice(0, SHOWN).map(function (g) {
      return { geoid: g, name: (data.names || {})[g] || g, workers: Math.round(by[g]), share: by[g] / workers };
    });
    return { workers: Math.round(workers), otherStates: Math.round(other), noTown: Math.round(noTown), top: top,
      year: data.meta && data.meta.lodes_year || null, tractsMissing: missing };
  }

  /** The one line printed on the page and in the export. */
  function sentence(s) {
    if (!s || !s.top.length) return null;
    var bits = s.top.map(function (p, i) { return Math.round(p.share * 100) + (i ? '% in ' : '% work in ') + p.name; });
    if (s.otherStates) bits.push(Math.round(s.otherStates / s.workers * 100) + '% in another state');
    return 'About ' + s.workers.toLocaleString('en-US') + ' working residents live in the market area: ' +
      bits.slice(0, -1).join(', ') + (bits.length > 1 ? ' and ' : '') + bits[bits.length - 1] +
      ' (LEHD LODES ' + (s.year || '') + ', primary jobs).';
  }

  return { load: load, summarize: summarize, sentence: sentence, PATH: PATH };
}));
