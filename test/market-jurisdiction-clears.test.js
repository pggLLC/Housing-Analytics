'use strict';
// One market-analysis DOM, real state APIs, cache serialization, engine and
// published inputs. Check both the pending interval and each new market's run.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const read = p => fs.readFileSync(p, 'utf8');
const json = p => JSON.parse(read(p));
const plain = v => JSON.parse(JSON.stringify(v));
const tick = () => new Promise(r => setImmediate(r));
const GEO = json('data/hna/geo-config.json');
const POINTS = json('data/co-place-centroids.json').byGeoid;
const HUD = json('data/hud-fmr-income-limits.json');
const LIHTC = json('data/market/hud_lihtc_co.geojson').features;
const MARKETS = ['0828745', '0845970', '0886310'].map(geoid => {
  const place = GEO.places.find(p => p.geoid === geoid);
  assert(place && place.containingCounty && POINTS[geoid]);
  return { geoid, countyFips: place.containingCounty, name: place.label, geoType: 'place', countyName: place.containingCounty };
});
const BOULDER = { geoid: '0807850', countyFips: '08013', name: 'Boulder', geoType: 'place' };
const KEY = 'coho.subjectProject.v1';
const files = ['js/site-state.js', 'js/workflow-state-core.js', 'js/workflow-state-api.js',
  'js/market-analysis-cache-fix.js', 'js/chfa-rent-limits.js', 'js/components/subject-project.js',
  'js/housing-outcome-score.js', 'js/data-connectors/hud-fmr.js', 'js/utils/format-money.js',
  'js/market-analysis/market-analysis-utils.js', 'js/market-analysis/market-report-renderers.js',
  'js/market-analysis-scoring.js', 'js/market-analysis-supply.js', 'js/market-analysis-enhancements.js',
  'js/market-analysis.js', 'js/pma-justification.js', 'js/lihtc-deal-predictor.js', 'js/pma-ui-controller.js'];
async function page() {
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!e.message.startsWith('Not implemented')) errors.push(e.message); });
  const w = new JSDOM(read('market-analysis.html'), { url: 'https://example.org/market-analysis.html',
    runScripts: 'outside-only', virtualConsole: vc }).window;
  w.alert = () => {};
  w.fetch = u => {
    const p = new URL(u, w.location.href).pathname.slice(1);
    const exists = fs.existsSync(p);
    return Promise.resolve({ ok: exists, json: () => Promise.resolve(exists ? json(p) : null) });
  };
  w.DataService = { baseData: p => 'data/' + p, getJSON: p => Promise.resolve(json(p)) };
  const style = w.document.createElement('style');
  style.textContent = read('css/pages/market-analysis.css'); w.document.head.appendChild(style);
  files.forEach(p => w.eval(read(p)));
  await tick(); await w.HudFmr.load(); await w.PMAEngine.whenDataReady(); await tick();
  assert.deepEqual(errors, []);
  return w;
}
function project(m) {
  return { project_name: 'Keep this project', jurisdiction_geoid: m.geoid, county_fips: m.countyFips,
    address: 'Site in ' + m.name, lat: POINTS[m.geoid].lat, lon: POINTS[m.geoid].lng,
    total_units: 8, utility_allowance_basis: { method: 'pha', reference: m.name + ' PHA schedule',
      effective_date: '2026-01-01', bound_county_fips: m.countyFips, resident_paid: ['heat'] },
    unit_mix: [{ count: 5, bedrooms: '2BR', ami_tier: 60, utility_allowance: 147 },
      { count: 3, bedrooms: '1BR', ami_tier: 'market', market_rent: HUD.counties.find(c => c.fips === m.countyFips).fmr.one_br,
        market_rent_source: m.name + ' survey', utility_allowance: 91 }] };
}
function current(w) {
  return { market: plain(w.WorkflowState.getStep('market')), site: plain(w.SiteState.getPmaResults()),
    subject: plain(w.SubjectProject.get()), result: plain(w.PMAEngine._state.getLastResult()),
    cached: plain(w.PMADataCache.loadLastResult()), scoreRun: plain(w.PMAUIController.getLastScoreRun()),
    comps: w.document.querySelector('#pmaNearbyLihtc tbody').textContent,
    pipeline: w.document.getElementById('pmaPipelineResult').textContent };
}
function seed(w, m) {
  const pt = POINTS[m.geoid];
  // Two writes allow the fresh source fields to settle before entered amounts.
  w.SubjectProject.set(project(m)); w.SubjectProject.set(project(m));
  w.PMAEngine.runAnalysis(pt.lat, pt.lng, { method: 'buffer', bufferMiles: 3 });
  const result = w.PMAEngine._state.getLastResult(); assert(result && result._tractIds.length);
  const scoreRun = w.PMAJustification.synthesizePMA({ commuting: { method: 'buffer', captureRate: null } });
  scoreRun.pma = result;
  w.PMADataCache.saveLastResult(pt.lat, pt.lng, { method: 'buffer', bufferMiles: 3 }, scoreRun);
  w.PMAUIController.restoreLastRun();
  w.WorkflowState.setStep('market', { siteLat: pt.lat, siteLon: pt.lng, siteAddress: m.name,
    pmaScore: result.overall, dimensions: { access: 71, feasibility: 72, market: 73 },
    transitEvidence: { geoid: m.geoid, marker: 'measured transit for ' + m.name }, completedAt: '2026-09-30', exportReady: true });
  w.SiteState.setPmaResults({ score: result.overall, geoid: m.geoid,
    siteScoreResult: { access_score: 71, feasibility_score: 72, market_score: 73 } });
  assert.equal(w.HousingOutcomeScore.compute().dimensions.siteQuality.available, true, 'seeded site score is measured');
  return result;
}
function assertCleared(w) {
  const market = w.WorkflowState.getStep('market');
  for (const k of ['siteLat', 'siteLon', 'siteAddress', 'pmaScore', 'dimensions', 'transitEvidence', 'completedAt']) assert.equal(market[k], null, k);
  assert.equal(market.exportReady, false);
  assert.equal(w.SiteState.getPmaResults(), null);
  assert.equal(w.PMAEngine._state.getLastResult(), null, 'no current result or county AMI to export');
  assert.equal(w.PMAUIController.getLastScoreRun(), null);
  assert.equal(w.document.getElementById('pmaJustificationNarrative').textContent, '');
  assert.equal(w.document.body.dataset.pmaResultState, 'pending');
  for (const id of ['pmaPipelineResult', 'pmaNearbyLihtc']) {
    const card = w.document.getElementById(id).closest('.pma-card');
    assert.equal(w.getComputedStyle(card).display, 'none', id + ': previous market cannot be shown while pending');
  }
  const subject = w.SubjectProject.get();
  assert.equal(subject.address, ''); assert.equal(subject.lat, null); assert.equal(subject.lon, null);
  for (const row of subject.unit_mix) {
    assert.equal(row.market_rent, null); assert.equal(row.market_rent_source, ''); assert.equal(row.utility_allowance, null);
  }
  assert.equal(subject.utility_allowance_basis.reference, ''); assert.equal(subject.utility_allowance_basis.effective_date, '');
  assert.equal(w.HousingOutcomeScore.compute().dimensions.siteQuality.available, false);
  assert.equal(w.HousingOutcomeScore.compute().dimensions.siteQuality.score, null);
}
// Independently locate the source records by distance, not by rendered names.
function distance(pt, f) {
  const [lon, lat] = f.geometry.coordinates, rad = Math.PI / 180;
  const a = Math.sin((lat - pt.lat) * rad / 2) ** 2 + Math.cos(pt.lat * rad) * Math.cos(lat * rad) * Math.sin((lon - pt.lng) * rad / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function checkMarket(w, m) {
  const result = w.PMAEngine._state.getLastResult(), pt = POINTS[m.geoid];
  const source = HUD.counties.find(c => c.fips === m.countyFips);
  const ordered = LIHTC.map(f => ({ f, d: distance(pt, f) })).sort((a, b) => a.d - b.d);
  const inside = ordered.filter(x => x.d <= 3), outside = ordered.filter(x => x.d > 3 && x.d <= 25).slice(0, 20);
  const pipeline = w.PMAEngine._state.getLastPipeline();
  const comps = [...w.document.querySelectorAll('#pmaNearbyLihtc tbody tr')].filter(r => r.children.length === 6).map(r => r.children[0].textContent);
  const names = xs => xs.map(x => x.f.properties.PROJECT || x.f.properties.proj_name || '(unnamed)');
  const pairs = [
    ['result latitude', result.lat, pt.lat], ['result longitude', result.lon, pt.lng],
    ['county AMI', result.amiUsed, source.income_limits.ami_4person],
    ['cached GEOID', w.PMADataCache.loadLastResult().jurisdiction.geoid, m.geoid],
    ['cached county', w.PMADataCache.loadLastResult().jurisdiction.countyFips, m.countyFips],
    ['restored AMI', w.PMAUIController.getLastScoreRun().pma.amiUsed, source.income_limits.ami_4person],
    ['subject county', w.SubjectProject.get().county_fips, m.countyFips],
    ['subject market rent', w.SubjectProject.get().unit_mix[1].market_rent, source.fmr.one_br],
    ['workflow site', w.WorkflowState.getStep('market').siteLat, pt.lat],
    ['SiteState geoid', w.SiteState.getPmaResults().geoid, m.geoid],
    ['pipeline total', pipeline.total, inside.length], ['comps', comps, names(outside)],
    ['pipeline names', plain(pipeline.projects.map(p => p.name)).sort(), names(inside.slice(0, 10)).sort()]
  ];
  pairs.forEach(([field, got, wanted]) => assert.deepEqual(got, wanted, m.name + ': ' + field));
  return pairs.length;
}
let failures = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  PASS ' + name); } catch (e) { failures++; console.error('  FAIL ' + name + ': ' + e.stack); } }
(async () => {
  await test('Fruita → Longmont → Wray clears pending state and binds each new run to its own published records', async () => {
    const w = await page(), counts = {}, earlier = [];
    try {
      assert.equal(new Set(MARKETS.map(m => HUD.counties.find(c => c.fips === m.countyFips).income_limits.ami_4person)).size, 3);
      for (const m of MARKETS) {
        w.WorkflowState.setJurisdiction(m);
        if (earlier.length) {
          assertCleared(w);
          w.PMAUIController.restoreLastRun();
          assertCleared(w);
          assert.equal(w.document.getElementById('pmaScoreWrap').dataset.unavailableReason, 'saved_jurisdiction_mismatch');
        }
        seed(w, m); counts[m.geoid] = checkMarket(w, m);
        const text = w.document.querySelector('#pmaNearbyLihtc tbody').textContent + w.document.getElementById('pmaPipelineResult').textContent;
        earlier.forEach(prev => prev.names.forEach(name => assert(!text.includes(name), 'stale LIHTC project ' + name)));
        earlier.push({ names: w.PMAEngine._state.getLastPipeline().projects.map(p => p.name) });
        const before = current(w);
        w.WorkflowState.setJurisdiction(m);
        assert.deepEqual(current(w), before, 'same GEOID selection preserves all location-bound state');
      }
      assert(Object.values(counts).every(n => n >= 13));
      console.log('    fields checked per market: ' + JSON.stringify(counts));
    } finally { w.close(); }
  });
  await test('same-county GEOID change clears market rents, address and allowance sources but keeps the project program', async () => {
    const w = await page();
    try {
      w.WorkflowState.setJurisdiction(MARKETS[1]); seed(w, MARKETS[1]);
      const before = w.SubjectProject.get();
      w.SubjectProject.mount(w.document.getElementById('subjectProjectMount') || w.document.body.appendChild(w.document.createElement('div')));
      await tick();
      w.WorkflowState.setJurisdiction(BOULDER); assertCleared(w);
      const s = w.SubjectProject.get();
      assert.equal(s.project_name, before.project_name); assert.equal(s.total_units, before.total_units);
      assert.deepEqual(plain(s.unit_mix.map(r => [r.count, r.bedrooms, r.ami_tier])), plain(before.unit_mix.map(r => [r.count, r.bedrooms, r.ami_tier])));
      assert.equal(s.utility_allowance_basis.method, before.utility_allowance_basis.method);
      assert.deepEqual(plain(s.utility_allowance_basis.resident_paid), plain(before.utility_allowance_basis.resident_paid));
      const notice = w.document.querySelector('[data-role="subject-location-cleared"]');
      assert(notice && !notice.hidden && notice.textContent.trim(), 'a visible clear notice accompanies the cleared fields');
      assert.equal(w.document.querySelector('[data-key="address"]').value, '');
      assert.equal(w.document.querySelector('[data-key="market_rent"]').value, '');
    } finally { w.close(); }
  });
  await test('a jurisdiction change during the subject table load cannot repaint the previous address or county', async () => {
    const w = await page();
    try {
      w.WorkflowState.setJurisdiction(MARKETS[0]); seed(w, MARKETS[0]);
      let release;
      const pending = new Promise(resolve => { release = resolve; });
      const fetch = w.fetch;
      w.fetch = url => String(url).includes('chfa-income-rent-limits') ? pending : fetch(url);
      const host = w.document.body.appendChild(w.document.createElement('div'));
      w.SubjectProject.mount(host);
      w.WorkflowState.setJurisdiction(MARKETS[1]);
      release({ json: () => Promise.resolve(json('data/chfa-income-rent-limits-2026.json')) }); await tick();
      assert.equal(host.querySelector('[data-key="address"]').value, '');
      assert.equal(host.querySelector('[data-key="county_fips"]').value, MARKETS[1].countyFips);
      assert.equal(host.querySelector('[data-key="market_rent"]').value, '');
      assertCleared(w);
    } finally { w.close(); }
  });
  await test('legacy and unrecorded-jurisdiction cached runs are blocked for every PMA method', async () => {
    const w = await page();
    try {
      w.WorkflowState.setJurisdiction(MARKETS[0]); seed(w, MARKETS[0]);
      const valid = jsonFromStorage(w);
      for (const method of ['tract', 'buffer', 'commuting', 'hybrid']) {
        const stale = plain(valid); delete stale.jurisdiction; stale.options.method = method;
        w.localStorage.setItem('pma_last_result_v1', JSON.stringify(stale));
        w.PMAUIController.restoreLastRun();
        assert.equal(w.PMAUIController.getLastScoreRun(), null);
        assert.equal(w.PMAEngine._state.getLastResult(), null);
        assert.equal(w.document.getElementById('pmaScoreWrap').dataset.unavailableReason, 'saved_jurisdiction_missing');
        for (const id of ['pmaExportJsonBtn', 'pmaExportCsvBtn', 'pmaExportAuditJson']) assert(w.document.getElementById(id).disabled);
      }
    } finally { w.close(); }
  });
  await test('render-time SiteState county sync uses the same invalidation path', async () => {
    const w = await page();
    try {
      w.WorkflowState = null;
      w.SubjectProject.set(project(MARKETS[0]));
      w.SiteState.setCounty(MARKETS[1].countyFips, MARKETS[1].countyName);
      const mount = w.document.body.appendChild(w.document.createElement('div'));
      w.SubjectProject.mount(mount); await tick();
      const s = w.SubjectProject.get();
      assert.equal(s.county_fips, MARKETS[1].countyFips); assert.equal(s.address, '');
      assert(s.unit_mix.every(r => r.market_rent === null && r.utility_allowance === null));
      assert.equal(s.utility_allowance_basis.reference, '');
      assert.equal(JSON.parse(w.localStorage.getItem(KEY)).county_fips, MARKETS[1].countyFips);
    } finally { w.close(); }
  });
  await test('a stored subject is invalidated after a jurisdiction change while the component was not loaded', async () => {
    const w = await page();
    try {
      w.WorkflowState.setJurisdiction(BOULDER);
      w.localStorage.setItem(KEY, JSON.stringify(project(MARKETS[1])));
      const s = w.SubjectProject.get();
      assert.equal(s.jurisdiction_geoid, BOULDER.geoid);
      assert.equal(s.unit_mix[1].market_rent, null); assert.equal(s.address, '');
      assert.equal(s.unit_mix[0].utility_allowance, null);
    } finally { w.close(); }
  });
  await test('legacy subject first binding preserves numbers until a recorded real jurisdiction change', async () => {
    const w = await page();
    try {
      w.WorkflowState.setJurisdiction(MARKETS[1]);
      const saved = project(MARKETS[1]); delete saved.jurisdiction_geoid;
      saved.updated_at = new Date(Date.parse(w.SiteState.get('jurisdictionChange').changedAt) + 1).toISOString();
      w.localStorage.setItem(KEY, JSON.stringify(saved));
      const bound = w.SubjectProject.get();
      assert.equal(bound.jurisdiction_geoid, MARKETS[1].geoid);
      assert.equal(bound.unit_mix[1].market_rent, saved.unit_mix[1].market_rent);
      assert.equal(bound.unit_mix[0].utility_allowance, saved.unit_mix[0].utility_allowance);
      // A legacy subject that predates a move, including within one county,
      // must be cleared on the next read even if its panel wasn't mounted.
      w.WorkflowState.setJurisdiction(BOULDER);
      delete saved.updated_at;
      w.localStorage.setItem(KEY, JSON.stringify(saved));
      const moved = w.SubjectProject.get();
      assert.equal(moved.unit_mix[1].market_rent, null);
      assert.equal(moved.unit_mix[0].utility_allowance, null);
    } finally { w.close(); }
  });
  await test('place map fallback uses its stored county, never slices a place code or borrows another jurisdiction', async () => {
    const w = await page();
    try {
      const scripts = [...w.document.scripts].map(s => s.textContent);
      const inline = scripts.find(s => s.includes('function _applyJurisdictionFly'));
      assert(inline);
      const start = inline.indexOf('var _CO_CENTROIDS'), end = inline.indexOf('function _fallbackJurisdictionTarget');
      assert(start >= 0 && end > start);
      w.eval(inline.slice(start, end) + '\nwindow.testFly = _applyJurisdictionFly; window.countyCenters = _CO_CENTROIDS;');
      const calls = [];
      w._cohoMap = { invalidateSize() {}, setView(point, zoom) { calls.push({ point: plain(point), zoom }); } };
      // Keep the place-centroid fetch pending so the real fallback is exercised.
      w.eval('_CO_PLACE_CENTROIDS = null;');
      for (const m of MARKETS) {
        w.WorkflowState.setJurisdiction(m); calls.length = 0;
        w.testFly({ kind: 'place', fips: m.geoid });
        assert.deepEqual(calls, [{ point: plain(w.countyCenters[m.countyFips]), zoom: 10 }]);
      }
      for (const ctx of [{ ...MARKETS[0], countyFips: null, fips: null }, MARKETS[1]]) {
        w.WorkflowState.setJurisdiction(ctx); calls.length = 0;
        w.testFly({ kind: 'place', fips: MARKETS[0].geoid }); assert.equal(calls.length, 0);
      }
    } finally { w.close(); }
  });
  await test('real picker uses the central clear once per final pick and preserves a same-place re-selection', async () => {
    const w = await page();
    try {
      w.WorkflowState.setJurisdiction(MARKETS[0]); seed(w, MARKETS[0]);
      const host = w.document.body.appendChild(w.document.createElement('section'));
      host.innerHTML = '<input id="citySearch"><ul id="cityResults"></ul><input id="countySearch"><ul id="countyResults"></ul>' +
        '<p id="countyHint"></p><div id="cityFieldGroup"></div><div id="sjSelection"><strong id="sjSelectionName"></strong>' +
        '<span id="sjSelectionSub"></span><button id="sjClearBtn"></button></div><button id="sjContinueBtn"></button>' +
        '<p id="sjActionNote"></p><div id="sjRecent"><div id="sjRecentList"></div></div>';
      w.eval(read('js/jurisdiction-selector.js')); await tick();
      let clears = 0, countyWrites = 0;
      const original = w.SiteState.clearPmaResults;
      w.SiteState.clearPmaResults = function () { clears++; return original.apply(this, arguments); };
      w.SiteState.subscribe('county', () => { countyWrites++; });
      async function pick(name) {
        w.document.getElementById('sjClearBtn').click();
        const input = w.document.getElementById('citySearch'); input.value = name;
        input.dispatchEvent(new w.Event('input')); await tick();
        const item = [...w.document.querySelectorAll('#cityResults li')].find(n => n.textContent.startsWith(name));
        assert(item, 'search offered ' + name);
        item.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true })); await tick();
      }
      await pick('Longmont'); assert.equal(w.WorkflowState.getJurisdiction().geoid, MARKETS[1].geoid);
      assertCleared(w); assert.equal(clears, 1); assert.equal(countyWrites, 1);
      seed(w, MARKETS[1]); const before = current(w); clears = 0;
      await pick('Longmont'); assert.equal(clears, 0); assert.deepEqual(current(w), before);
    } finally { w.close(); }
  });
  await test('new leakage guard is reached by CI', () => {
    const scripts = json('package.json').scripts;
    assert.equal(scripts['test:market-jurisdiction-clears'], 'node test/market-jurisdiction-clears.test.js');
    assert(Object.entries(scripts).some(([k, v]) => /^ci:part-/.test(k) && v.split(' && ').includes('npm run test:market-jurisdiction-clears')));
  });
  console.log(`Market jurisdiction clears: ${passed} passed, ${failures} failed`);
  if (failures) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
function jsonFromStorage(w) { return JSON.parse(w.localStorage.getItem('pma_last_result_v1')); }
