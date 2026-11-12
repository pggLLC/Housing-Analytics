// A town for the quick estimate (paul 11-05, "Build it after #151"; 11-06 "Quick deals free should include towns too").
// The county still sets the income and rent limits: HUD sets income limits by county or metro area and CHFA's rent
// limits follow them, so a town inside a county has that county's limits. What a town changes is the market read: the
// renters behind the suggested home sizes, and the town's own rent beside the county's.
// How far the town's own survey figures can be used goes by its population, on two lines the Census Bureau draws
// (https://www.census.gov/programs-surveys/acs/geography-acs/areas-published.html, checked 2026-11-05): 1-year
// supplemental estimates are published for areas of 20,000 or more, and below that only the 5-year average exists.
//   20,000 or more  large: the town's figures are used.
//   5,000 to 19,999 mid-size: the town's figures are used where its renter count rates good or fair; otherwise the county's.
//   under 5,000     small: the county's figures are used, with a list of local data to collect.
// Each figure keeps the site's own margin rating (data/hna/acs-reliability.json: CV = (MOE / 1.645) / estimate; good up
// to 15%, fair 15-30%, use with caution over 30%). Nothing here changes a result except which tracts count renters, and
// nothing becomes a score. All files are the public site's own; this file adds no data.
(function (global) {
  'use strict';

  var VENDOR = global.LAB_VENDOR;
  var FILES = { rel: 'data/hna/acs-reliability.json', geo: 'data/hna/geo-config.json',
    cross: 'data/hna/cross-county-places.json', tracts: 'data/hna/place-tract-membership.json' };
  var AREAS_URL = 'https://www.census.gov/programs-surveys/acs/geography-acs/areas-published.html';
  var LARGE = 20000, MID = 5000;
  var TIER = { good: 'good', fair: 'fair', use_with_caution: 'use with caution', zero_in_sample: 'none in the sample' };
  var USABLE = { good: true, fair: true };

  var files = null, failed = null, asked = false;
  function load(onDone) {
    if (asked) return;
    asked = true;
    var keys = Object.keys(FILES);
    Promise.all(keys.map(function (k) { return fetch(VENDOR + FILES[k]).then(function (r) { if (!r.ok) throw new Error(FILES[k] + ' ' + r.status); return r.json(); }); }))
      .then(function (r) { files = {}; keys.forEach(function (k, i) { files[k] = r[i]; }); if (onDone) onDone(); })
      .catch(function (e) { failed = e.message; if (onDone) onDone(); });
  }

  // Cities, towns and unincorporated communities (CDPs) with land in the county, a town that spans counties
  // listed under each. Each entry: { geoid, name, kind: 'town' | 'cdp', part: true when only part lies here }.
  function townsIn(f, county) {
    if (!f || !county) return [];
    var cross = f.cross && f.cross.places || {};
    var list = [];
    [['places', 'town'], ['cdps', 'cdp']].forEach(function (g) {
      (f.geo[g[0]] || []).forEach(function (p) {
        var x = cross[p.geoid], inCounty = x ? (x.all_counties || []).some(function (c) { return c.fips === county; }) : p.containingCounty === county;
        if (!inCounty) return;
        list.push({ geoid: p.geoid, name: String(p.label || '').replace(/\s*\((city|town|CDP|city and county)\)\s*$/i, ''), kind: g[1], part: !!(x && x.all_counties.length > 1) });
      });
    });
    return list.sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function fig(f, geoid, key) {
    var r = f && f.rel && f.rel.geos[geoid] && f.rel.geos[geoid][key];
    // One period for every place: a 1-year figure (large places) reads its 5-year twin, so town and county compare like for like.
    if (r && r.s === 'acs1' && r.five) r = r.five;
    return r ? { e: r.e, m: r.m, t: r.t || null, y: r.y, s: r.s } : null;
  }

  // The town's size band and what the estimate does with it.
  function read(f, geoid, county) {
    if (!f || !geoid) return null;
    var pop = fig(f, geoid, 'DP05_0001E'), n = pop && pop.e;
    var band = n >= LARGE ? 'large' : n >= MID ? 'mid' : 'small';
    var renters = fig(f, geoid, 'DP04_0047E');
    var renterOk = !!(renters && USABLE[renters.t]);
    var tracts = (f.tracts.places[geoid] && f.tracts.places[geoid].tracts || [])
      .map(function (t) { return { geoid: t.tract_geoid, _bufferShare: t.share_of_tract_area }; })
      .filter(function (t) { return t._bufferShare > 0; });
    var useTown = tracts.length > 0 && (band === 'large' || (band === 'mid' && renterOk));
    return { geoid: geoid, county: county, pop: n == null ? null : n, popYear: pop && pop.y, band: band, useTown: useTown, tracts: useTown ? tracts : null,
      rent: fig(f, geoid, 'DP04_0134E'), countyRent: fig(f, county, 'DP04_0134E'), renters: renters, countyRenters: fig(f, county, 'DP04_0047E'),
      year: f.rel.meta && f.rel.meta.acs_year, checked: String(f.rel.meta && f.rel.meta.generated || '').slice(0, 10) };
  }

  var money = function (v) { return '$' + Math.round(v).toLocaleString('en-US'); };
  var count = function (v) { return Math.round(v).toLocaleString('en-US'); };
  function figure(x, fmt) {
    if (!x || x.e == null) return 'not published';
    return fmt(x.e) + (x.m > 0 ? ' ±' + fmt(x.m) : '') + (x.t && TIER[x.t] ? ' (' + TIER[x.t] + ')' : '');
  }

  var BAND = {
    large: { label: 'Large town (20,000 or more)', says: 'The homes are sized to its own renters.' },
    mid: { label: 'Mid-size town (5,000 to 19,999)' },
    small: { label: 'Small town (under 5,000)', says: 'Small towns carry wide survey margins, so this estimate sizes the homes to the county’s renters.' }
  };
  // The local data to collect before relying on a small town's figures, or a mid-size town's that fell back to the county.
  var COLLECT = [
    'Rents at nearby comparable rentals, by bedroom size. A CHFA market study needs these anyway.',
    'Vacancy and waiting lists from the local housing authority and any tax credit properties nearby.',
    'The utility allowance from the local housing authority.',
    'Tap, impact and permit fees from the town’s current fee schedule.'
  ];

  // The block under the county picker: town picker, size line, rents, and the list when county figures stand in.
  function field(o) {
    // o: { esc, county, countyName, place, help }
    var esc = o.esc;
    if (!o.county) return '';
    if (!files && !failed) { load(o.render); return '<p class="note" role="status">Loading the towns in this county…</p>'; }
    if (failed) return '<p class="note" role="status">The town list did not load (' + esc(failed) + '). The estimate uses the county.</p>';
    var towns = townsIn(files, o.county);
    if (!towns.length) return '';
    var opt = function (t) { return '<option value="' + esc(t.geoid) + '"' + (t.geoid === o.place ? ' selected' : '') + '>' + esc(t.name + (t.part ? ' (part)' : '')) + '</option>'; };
    var picker = '<div class="field-wrap"><label class="field">City or town (optional)<select name="quick:place"><option value="">Whole county</option>' +
      '<optgroup label="Cities and towns">' + towns.filter(function (t) { return t.kind === 'town'; }).map(opt).join('') + '</optgroup>' +
      (towns.some(function (t) { return t.kind === 'cdp'; }) ? '<optgroup label="Unincorporated communities">' + towns.filter(function (t) { return t.kind === 'cdp'; }).map(opt).join('') + '</optgroup>' : '') +
      '</select></label>' +
      o.help('place', 'Pick a town to size the homes to its renters and see its rents. The income limits and rent limits stay the county’s, because HUD and CHFA set them by county. ' +
        'Census survey samples shrink with population, so a small town’s figures carry wide margins. Large towns (20,000 or more) use their own figures; mid-size towns use theirs where the renter count is reliable enough; small towns use the county’s.',
        'Census Bureau, <a href="' + AREAS_URL + '">areas published</a> (1-year supplemental estimates for areas of 20,000 or more; 5-year for all areas); margins from ACS 5-year estimates. A town that spans counties is listed in each, marked “part”.') + '</div>';
    var r = o.place ? read(files, o.place, o.county) : null;
    if (!r) return picker;
    var name = (towns.filter(function (t) { return t.geoid === o.place; })[0] || {}).name || 'This town';
    var b = BAND[r.band];
    var says = b.says || (r.useTown ? 'Its renter count is reliable enough, so the homes are sized to its own renters.' : 'Its renter count is too uncertain, so this estimate sizes the homes to the county’s renters.');
    var span = r.popYear ? 'ACS ' + (r.popYear - 4) + '–' + r.popYear + ' 5-year' : 'ACS 5-year';
    var lines = '<div class="quick-town" role="note" data-town-band="' + esc(r.band) + '" data-town-uses="' + (r.useTown ? 'town' : 'county') + '">' +
      '<p><strong>' + esc(name) + ': ' + esc(b.label) + '.</strong> ' + esc(says) + (r.pop != null ? ' Population ' + esc(count(r.pop)) + '.' : '') + '</p>' +
      '<p>Median rent paid: ' + esc(name) + ' ' + esc(figure(r.rent, money)) + '; ' + esc(o.countyName || 'county') + ' ' + esc(figure(r.countyRent, money)) + '. ' +
        'Renter households: ' + esc(figure(r.renters, count)) + '.</p>' +
      (r.useTown ? '' : '<details class="quick-collect"><summary>Local data to collect before relying on this</summary><ul>' +
        COLLECT.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></details>') +
      '<p class="note">Census ' + esc(span) + ' estimates with their 90% margin of error, checked ' + esc(r.checked) + '. Rated good up to 15%, fair to 30%, use with caution above. Median rent paid covers all sizes and ages of homes, so it reads low next to new construction.</p></div>';
    return picker + lines;
  }

  // The tracts the market mix counts, with each tract's share inside the town, or null for the whole county.
  function mixTracts(place, county) {
    var r = files && place ? read(files, place, county) : null;
    return r && r.useTown ? r.tracts : null;
  }
  // Whether the town's own figures size the homes, for the note under the home sizes.
  function status(place, county) {
    return files && place ? read(files, place, county) : null;
  }

  global.LabDealTown = { field: field, mixTracts: mixTracts, status: status, townsIn: townsIn, read: read, COLLECT: COLLECT,
    _files: function (f) { files = f; asked = true; } };
})(window);
