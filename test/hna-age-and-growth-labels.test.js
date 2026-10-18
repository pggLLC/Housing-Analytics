'use strict';
/**
 * The HNA age note and the 20-year growth sentences agree with the data they
 * describe (trust sweep of the live site, 2026-10-18).
 *
 * Two things read as broken to a practitioner on Grand Junction's pages:
 *
 *  - The age charts said "place-level ACS B01001 fetch failed; falling back to
 *    county DOLA SYA ... retry or check Census API status". The published site
 *    has no Census key, so that call is never made; every place showed it.
 *  - What to do showed "6,216 new households", "1,500+ new households over 10
 *    years" and "11,248 net new units by 2044" with nothing saying how they
 *    relate. The 1,500+ was an invented example in a callout shown to every
 *    geography, and the 11,248 note said it subtracted the current stock,
 *    which the place ledger it comes from does not do.
 *
 * Each check holds a sentence to the file or input it reports on, so a
 * rewording stays green and a wrong claim fails.
 *
 * Run: node test/hna-age-and-growth-labels.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const RANKING = json('data/hna/ranking-index.json');
const GEO = json('data/hna/geo-config.json');
const COUNTY_LABEL = Object.fromEntries(GEO.counties.map((c) => [c.geoid, c.label]));
const ROWS = RANKING.rankings;
const text = (html) => String(html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ok  ' + name); } catch (e) { failures += 1; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

function narrativesContext() {
  const w = {
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(RANKING) }),
    console,
  };
  w.window = w;
  vm.createContext(w);
  vm.runInContext(read('js/hna/hna-narratives.js'), w);
  return w;
}

function takeawaysContext() {
  const w = { console, setTimeout, clearTimeout, document: { readyState: 'loading', querySelectorAll: () => [], querySelector: () => null, addEventListener() {} }, addEventListener() {} };
  w.window = w;
  vm.createContext(w);
  vm.runInContext(read('js/hna/hna-section-takeaways.js'), w);
  return w.HnaSectionTakeaways.takeaways['20-year outlook'];
}

function summaryFor(geoid) {
  const p = path.join(ROOT, 'data/hna/summary', geoid + '.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')).acsProfile : null;
}

(async () => {
  await test('the headline household count is the projection over today\'s household size, and says whose projection and how it differs', async () => {
    const w = narrativesContext();
    await w.HNANarratives._internals.loadRanking();
    let checked = 0;
    for (const row of ROWS) {
      const profile = summaryFor(row.geoid);
      const pop20 = row.metrics && row.metrics.population_projection_20yr;
      const hh = profile && Number(profile.DP02_0016E);
      if (!profile || !(pop20 > 0) || !(hh > 0) || !(Number(profile.DP05_0001E) > 0)) continue;
      const html = w.HNANarratives.buildExecutiveSummary(Object.assign({}, profile, { _geoid: row.geoid, _geoType: row.type }), row.name);
      const para = text(html).split(/(?=20-year population projection)/)[1];
      assert(para, `${row.geoid}: no 20-year sentence`);
      const want = fmtInt(Math.abs(Math.round((pop20 - Number(profile.DP05_0001E)) / hh)));
      assert(para.includes(want + ' '), `${row.geoid}: household count is not (projection - population) / ${hh} = ${want}: ${para.slice(0, 200)}`);
      // The projection is the State Demography Office's county forecast
      // (DOLA, per the ranking index's own note), allocated to places.
      assert(/DOLA/.test(RANKING.metadata.note) && /State Demography Office/.test(para), `${row.geoid}: the sentence does not say whose projection it is`);
      // Another figure on the page counts homes, so this one must say it holds
      // household size at today's level rather than leave the two to clash.
      assert(new RegExp('household size[^.]*' + "today").test(para) || /today.s household size/.test(para),
        `${row.geoid}: the sentence does not say it holds household size at today's level`);
      checked += 1;
    }
    assert(checked > 400, `the scan found ${checked} geographies with a projection`);
  });

  await test('the outlook takeaway gives the same count, and none without a household size', async () => {
    const outlook = takeawaysContext();
    let checked = 0;
    for (const row of ROWS) {
      const profile = summaryFor(row.geoid);
      const pop20 = row.metrics && row.metrics.population_projection_20yr;
      const pop = profile && Number(profile.DP05_0001E);
      const hh = profile && Number(profile.DP02_0016E);
      if (!(pop20 > 0) || !(pop > 0) || !(hh > 0)) continue;
      const line = text(outlook({ pop, pop20yr: pop20, avgHhSize: hh }));
      assert(line.includes(fmtInt(Math.abs(Math.round((pop20 - pop) / hh))) + ' '), `${row.geoid}: ${line}`);
      assert(/State Demography Office/.test(line), `${row.geoid}: the takeaway does not say whose projection it is: ${line}`);
      const none = text(outlook({ pop, pop20yr: pop20, avgHhSize: null }));
      assert(!/households/.test(none), `${row.geoid}: a household count with no household size: ${none}`);
      checked += 1;
    }
    assert(checked > 400, `the scan found ${checked} geographies`);
  });

  await test('the 20-year outlook callout, shown to every geography, states no local figure', async () => {
    const src = read('js/hna/hna-dev-context.js');
    const m = src.match(/'20-year outlook':\s*\{([\s\S]*?)\n\s*\},/);
    assert(m, 'the 20-year outlook callout was not found');
    const demand = (m[1].match(/demand:\s*'((?:[^'\\]|\\.)*)'/) || [])[1];
    assert(demand, 'the callout has no demand line');
    assert(!/\d/.test(demand), `a callout every geography shares cannot carry a number: ${demand}`);
  });

  await test('the age note names the county shown, its source and year, and the real reason', async () => {
    const dom = new JSDOM('<!doctype html><body><div class="chart-box"><canvas id="chartPyramid"></canvas></div><div class="chart-box"><canvas id="chartSenior"></canvas></div><p id="seniorNote"></p></body>', { url: 'http://localhost/', runScripts: 'outside-only' });
    const w = dom.window;
    w.Chart = class { constructor() {} destroy() {} };
    w.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
    w.HNAState = { state: { current: {} }, els: { seniorNote: w.document.getElementById('seniorNote') }, charts: {} };
    w.eval(read('js/hna/hna-utils.js'));
    w.eval(read('js/hna/hna-renderers.js'));
    let checked = 0;
    for (const place of GEO.places.filter((p) => ['0831660', '0828745'].includes(p.geoid))) {
      const county = place.containingCounty;
      const dola = json(`data/hna/dola_sya/${county}.json`);
      for (const reason of ['not_requested', 'census_failed']) {
        w.HNARenderers.renderDolaPyramid(dola, null, { geoType: 'place', geoid: place.geoid, geoLabel: place.label, contextCounty: county, placeAgeReason: reason });
        const note = w.document.getElementById('seniorNote').textContent;
        assert(note.includes(COUNTY_LABEL[county]), `${place.geoid}: the note does not name ${COUNTY_LABEL[county]}: ${note}`);
        assert(/SDO|State Demography/.test(dola.source.dataset) && /State Demography Office/.test(note), `${place.geoid}: the note does not name the file's source: ${note}`);
        assert(note.includes(String(dola.pyramidYear)), `${place.geoid}: the note does not give the file's year ${dola.pyramidYear}: ${note}`);
        assert(!/B01001|SYA|DOLA|fetch|retry|API/.test(note), `${place.geoid}: the note carries a code or an instruction a visitor cannot act on: ${note}`);
        const saysFailed = /did not load|didn.t load|failed/.test(note);
        assert.strictEqual(saysFailed, reason === 'census_failed', `${place.geoid} ${reason}: the note's reason does not match what happened: ${note}`);
        checked += 1;
      }
    }
    assert.strictEqual(checked, 4, 'Grand Junction and Fruita were both checked');
  });

  await test('the page asks for a place age table only with a key, and says so', async () => {
    // fetchAcsB01001 returns null without a key (no request is made), so the
    // reason handed to the renderer must come from the same test.
    const src = read('js/hna/hna-controller.js');
    const m = src.match(/const placeAgeReason = [\s\S]*?;\n/);
    assert(m && /censusKey\(\)\s*\?\s*'census_failed'\s*:\s*'not_requested'/.test(m[0]), 'placeAgeReason must follow whether a Census key is configured');
    assert(/renderDolaPyramid\(dola, acsCohorts, \{[^}]*placeAgeReason/.test(src), 'the reason must reach the renderer');
  });

  if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nall HNA age and growth label checks passed');
})();
