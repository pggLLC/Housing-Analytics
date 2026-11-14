// One A to Z list for every place picker (paul, 14 Nov 2026: "some of the menus are not in alphabetical order by
// jurisdiction type, so typing f doesn't take you to all f entries"). Counties, cities, towns and CDPs sit in one
// list sorted by name, so typing a letter in the picker walks every place that starts with it. The type stays in
// the label: "Mesa County", "Fruita (city)", "Fort Carson (unincorporated)" (a census-designated place, CDP, in the
// data files). This changes the order and labels only, no figure.
(function (global) {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var SUFFIX = /\s*\((city|town|CDP|unincorporated|city and county|town and county)\)\s*$/i;
  // The Census spelling, lower case for a city or town ("Commerce City city"), so "Colorado City" stays a name.
  var BARE = /\s+(city|town|CDP)$/;
  // A CDP name the Census repeats in two counties: "Twin Lakes CDP (Lake County)".
  var TWIN = /^(.+?)\s+CDP\s+\((.+ County)\)$/;
  var WORD = { city: 'city', town: 'town', cdp: 'unincorporated', place: 'city or town' };

  // The name a person reads in the list, with its type. name is as the data file gives it; kind is county, city,
  // town, cdp or place (a city or town the file does not split).
  function label(name, kind) {
    var n = String(name == null ? '' : name).replace(/, Colorado$/, '').trim();
    // "Fairmount CDP" (the Census name) reads as "Fairmount (CDP)"; a CDP is shown as unincorporated, in plain words.
    if (TWIN.test(n)) return n.replace(TWIN, '$1 (unincorporated, $2)');
    if (!SUFFIX.test(n) && BARE.test(n) && kind !== 'county') n = n.replace(BARE, ' ($1)');
    if (SUFFIX.test(n)) return n.replace(/\(CDP\)$/i, '(unincorporated)');
    if (kind === 'county') return /\bcounty$/i.test(n) ? n : n + ' County';
    return WORD[kind] ? n + ' (' + WORD[kind] + ')' : n;
  }
  // The sort key: the bare name, so "Fort Collins (city)" sits between "Fort Carson" and "Fort Garland".
  function key(text) { return String(text).replace(/\s*\([^()]*\)(\s*\(part\))?$/, '').replace(/\s+County$/i, ''); }
  function byName(a, b) {
    return key(a.text).localeCompare(key(b.text), 'en', { sensitivity: 'base' }) || a.text.localeCompare(b.text, 'en');
  }

  // items: [{ value, name, kind, extra }] → <option>s in one A to Z list. extra is added after the label, as in
  // " (part)" for a town that spans counties. picked is the value to select.
  function options(items, picked) {
    return (items || []).map(function (it) {
      return { value: String(it.value), text: label(it.name, it.kind) + (it.extra || '') };
    }).sort(byName).map(function (o) {
      return '<option value="' + esc(o.value) + '"' + (o.value === String(picked) ? ' selected' : '') + '>' + esc(o.text) + '</option>';
    }).join('');
  }

  // The HNA ranking list (data/hna/ranking-index.json) as picker items: its names already carry the type.
  function fromRanking(ranking) {
    var list = Array.isArray(ranking && ranking.rankings) ? ranking.rankings : Object.keys((ranking && ranking.rankings) || {}).map(function (k) { return ranking.rankings[k]; });
    return list.filter(function (r) { return r.type === 'county' || r.type === 'place' || r.type === 'cdp'; })
      .map(function (r) { return { value: r.geoid, name: r.name, kind: r.type }; });
  }

  global.LabPlaceList = { label: label, options: options, fromRanking: fromRanking, key: key };
})(window);
