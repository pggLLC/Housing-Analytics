'use strict';
// Agreement with actual results, committed polygons and bound source records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const read = p => fs.readFileSync(p, 'utf8');
const json = p => JSON.parse(read(p));
const tick = () => new Promise(resolve => setImmediate(resolve));
const GEO = json('data/hna/geo-config.json');
const POINTS = json('data/co-place-centroids.json').byGeoid;
const PLACES = json('data/co-place-boundaries.geojson');
const COUNTIES = json('data/co-county-boundaries.json');
const FRUITA = { geoType: 'place', geoid: '0828745', countyFips: '08077', name: 'Fruita', countyName: 'Mesa County' };
const LONGMONT = { geoType: 'place', geoid: '0845970', countyFips: '08013', name: 'Longmont', countyName: 'Boulder County' };
const WRAY = { geoType: 'place', geoid: '0886310', countyFips: '08125', name: 'Wray', countyName: 'Yuma County' };
const files = ['js/site-state.js', 'js/workflow-state-core.js', 'js/workflow-state-api.js',
  'js/components/jurisdiction-url-context.js', 'js/components/jurisdiction-boundaries.js', 'js/market-analysis-cache-fix.js',
  'js/data-connectors/hud-fmr.js', 'js/utils/format-money.js',
  'js/market-analysis/market-analysis-utils.js', 'js/market-analysis/market-report-renderers.js',
  'js/market-analysis-scoring.js', 'js/market-analysis-supply.js', 'js/market-analysis-enhancements.js',
  'js/market-analysis.js', 'js/pma-justification.js', 'js/lihtc-deal-predictor.js', 'js/pma-ui-controller.js'];
async function page(boundaryResponse, search = '') {
  const errors = [], requests = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!e.message.startsWith('Not implemented')) errors.push(e.message); });
  const w = new JSDOM(read('market-analysis.html'), { url: 'https://example.org/market-analysis.html' + search,
    runScripts: 'outside-only', virtualConsole: vc }).window;
  w.alert = () => {};
  w.fetch = url => {
    const path = new URL(url, w.location.href).pathname.slice(1);
    requests.push(path);
    if (boundaryResponse && ['data/co-place-boundaries.geojson', 'data/co-county-boundaries.json'].includes(path)) return boundaryResponse(path);
    return Promise.resolve({ ok: fs.existsSync(path), json: () => Promise.resolve(fs.existsSync(path) ? json(path) : null) });
  };
  w.DataService = { baseData: p => 'data/' + p, getJSON: p => Promise.resolve(json(p)) };
  // Seed the existing workflow before loading the page's body, as a user
  // arriving from the jurisdiction picker does. Later changes use the live UI.
  const body = w.document.body.innerHTML;
  w.document.body.innerHTML = '';
  files.slice(0, 3).forEach(p => w.eval(read(p)));
  w.WorkflowState.setJurisdiction(FRUITA);
  w.document.body.innerHTML = body;
  files.slice(3).forEach(p => w.eval(read(p)));
  const boundariesChecked = [], pointInBoundary = w.PMAEngine.pointInBoundary;
  w.PMAEngine.pointInBoundary = function (lon, lat, feature) {
    boundariesChecked.push(feature.properties.geoid || feature.properties.GEOID);
    return pointInBoundary(lon, lat, feature);
  };
  const inline = [...w.document.scripts].find(s => s.textContent.includes('function updateMaJurisdictionBanner()'));
  assert(inline, 'exercise the actual banner script');
  w.eval(inline.textContent);
  await tick(); await w.HudFmr.load(); await w.PMAEngine.whenDataReady(); await w.JurisdictionUrlContext.resolve(); await tick();
  assert.deepEqual(errors, []);
  return { w, requests, errors, boundariesChecked };
}
function banner(w) { return w.document.getElementById('maJurisdictionBanner'); }
function site(w, geoid) {
  const p = POINTS[geoid]; assert(p);
  w.PMAEngine.placeSiteMarker(p.lat, p.lng);
  return { lat: p.lat, lon: p.lng };
}
function docsLink(doc, host) {
  const links = [...host.querySelectorAll('a')].filter(a => a.getAttribute('href').includes('MARKET_ANALYSIS_METHOD'));
  assert.equal(links.length, 1);
  // Public deployment copies Markdown verbatim: use the rendered repository
  // document so its heading anchor works instead of downloading a raw file.
  const target = new URL(links[0].getAttribute('href'));
  assert.equal(target.origin, 'https://github.com');
  const prefix = '/pggLLC/Housing-Analytics/blob/main/';
  assert(target.pathname.startsWith(prefix));
  const docPath = target.pathname.slice(prefix.length);
  assert(fs.existsSync(docPath)); assert(target.hash);
  const headings = read(docPath).split('\n').filter(line => /^## /.test(line)).map(line => line.slice(3));
  assert(headings.some(heading => heading.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-') === target.hash.slice(1)));
}
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  PASS ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + ': ' + e.stack); }
}
(async () => {
  await test('jurisdiction comes from WorkflowState and market area from the actual score result, not the controls', async () => {
    const { w, errors } = await page();
    try {
      w.WorkflowState.setJurisdiction(FRUITA); await tick();
      assert.equal(w.document.getElementById('maJurisdictionName').textContent, w.WorkflowState.getJurisdiction().name);
      const area = w.document.getElementById('maMarketArea');
      assert.equal(area.dataset.boundary, 'not_drawn');
      assert(!/\d/.test(area.textContent), 'no guessed mileage before a run');
      // The banner must not hide the controller's pending-tract guidance.
      const originalMap = w.PMAEngine._map;
      w.PMAEngine._map = () => ({});
      w.PMATractPicker = { init: () => Promise.resolve({ selected: [] }) };
      assert(w.PMAUIController.beginTractPma(POINTS[FRUITA.geoid].lat, POINTS[FRUITA.geoid].lng));
      w.document.dispatchEvent(new w.CustomEvent('workflow:step-updated'));
      await tick();
      assert.equal(w.document.getElementById('pmaScoreBoundary').dataset.boundary, 'pending');
      assert.equal(w.document.getElementById('pmaScoreBoundary').hidden, false);
      w.PMAEngine._map = originalMap;
      delete w.PMATractPicker;
      const p = site(w, FRUITA.geoid); await tick();
      for (const miles of [3, 5]) {
        const select = w.document.getElementById('pmaBufferSelect');
        select.value = String(miles); select.dispatchEvent(new w.Event('change')); await tick();
        const result = w.PMAEngine._state.getLastResult(); assert(result);
        assert.equal(result.bufferMiles, miles);
        assert(area.textContent.includes(result.bufferMiles.toFixed(1)));
        assert.equal(area.dataset.boundary, 'buffer');
        assert(w.document.getElementById('pmaScoreBoundary').textContent.includes(result.bufferMiles.toFixed(1)));
        // Controls are for the next run; the banner still describes this one.
        w.document.getElementById('pmaBufferSelect').value = '15';
        w.document.dispatchEvent(new w.CustomEvent('workflow:step-updated', { detail: { stepKey: 'market' } }));
        assert(area.textContent.includes(result.bufferMiles.toFixed(1)));
      }
      const candidates = w.PMAEngine._state.getLastResult()._tractIds;
      const geometry = json('data/market/tract_boundaries_co.geojson');
      for (const count of [2, 4]) {
        const geoids = candidates.slice(0, count);
        const features = geometry.features.filter(f => geoids.includes(String(f.properties.GEOID || f.properties.geoid)));
        assert.equal(features.length, count);
        w.PMAEngine.runAnalysis(p.lat, p.lon, { method: 'tract', tractGeoids: geoids, tractBoundary: { type: 'FeatureCollection', features } });
        await tick(); const result = w.PMAEngine._state.getLastResult(); assert(result);
        assert.equal(result.tractCount, count);
        assert.equal(area.dataset.boundary, 'tract');
        assert(area.textContent.includes(String(result.tractCount)));
        assert(w.document.getElementById('pmaScoreBoundary').textContent.includes(String(result.tractCount)));
      }
      docsLink(w.document, banner(w));
      w.WorkflowState.setJurisdiction(LONGMONT); await tick();
      assert.equal(w.document.getElementById('maJurisdictionName').textContent, w.WorkflowState.getJurisdiction().name);
      assert.equal(area.dataset.boundary, 'not_drawn', 'the previous result cannot label the new jurisdiction');
      assert.deepEqual(errors, []);
    } finally { w.close(); }
  });
  for (const key of ['geoid', 'fips']) for (const auto of [false, true]) {
    const search = '?' + key + '=' + LONGMONT.geoid + (auto ? '&auto=1' : '');
    await test(search + ' labels and checks Longmont while the stored project remains Fruita', async () => {
      const { w, errors, boundariesChecked } = await page(undefined, search);
      try {
        assert.equal(w.WorkflowState.getJurisdiction().geoid, FRUITA.geoid);
        const context = w.JurisdictionUrlContext.resolveSync();
        assert.equal(context.source, 'url');
        assert.equal(context.geoid, LONGMONT.geoid);
        assert.equal(w.document.getElementById('maJurisdictionName').textContent, context.displayName);
        assert.equal(context.displayName, GEO.places.find(p => p.geoid === LONGMONT.geoid).label);
        assert.equal(banner(w).dataset.jurisdictionGeoid, context.geoid);
        assert(w.document.getElementById('maJurisdictionBoundary').textContent.includes(context.geoType));
        if (auto) {
          // Let the page's actual _autoRunIfRequested timer place the site and
          // run the engine. Merely adding auto=1 without a run proves nothing.
          const deadline = Date.now() + 8000;
          while (!w.PMAEngine._state.getLastResult() && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          const result = w.PMAEngine._state.getLastResult(); assert(result, 'auto-run completed');
          assert.equal(result.lat, POINTS[LONGMONT.geoid].lat);
          assert.equal(result.lon, POINTS[LONGMONT.geoid].lng);
        } else {
          assert.equal(w.PMAEngine._state.getLastResult(), null, 'no unsolicited run');
          site(w, LONGMONT.geoid);
        }
        await tick();
        assert(boundariesChecked.length > 0, 'the polygon check actually ran');
        assert(boundariesChecked.every(geoid => geoid === LONGMONT.geoid), 'every check used Longmont geometry');
        assert.equal(banner(w).dataset.siteBoundaryCheck, 'inside');
        assert(w.document.getElementById('maSiteBoundaryNotice').hidden);
        assert(!banner(w).hasAttribute('data-site-outside-jurisdiction'));
        assert.equal(w.document.getElementById('maJurisdictionName').textContent, context.displayName);
        assert.equal(w.WorkflowState.getJurisdiction().geoid, FRUITA.geoid, 'the link never rewrites the saved jurisdiction');
        assert.deepEqual(errors, []);
      } finally { w.close(); }
    });
  }
  await test('without a geography URL, the stored jurisdiction owns the label and polygon; only counties get County', async () => {
    const { w, boundariesChecked } = await page();
    try {
      site(w, FRUITA.geoid); await tick();
      assert.equal(w.document.getElementById('maJurisdictionName').textContent, FRUITA.name);
      assert.equal(banner(w).dataset.jurisdictionGeoid, FRUITA.geoid);
      assert(boundariesChecked.length > 0 && boundariesChecked.every(geoid => geoid === FRUITA.geoid));
      assert.equal(banner(w).dataset.siteBoundaryCheck, 'inside');
      w.WorkflowState.setJurisdiction({geoType: 'county', geoid: '08077', countyFips: '08077', name: 'Mesa'});
      await tick();
      assert.equal(w.document.getElementById('maJurisdictionName').textContent, 'Mesa County');
      assert(w.document.getElementById('maJurisdictionBoundary').textContent.includes('county'));
    } finally { w.close(); }
  });
  await test('place, county and CDP checks use their actual polygons, and outside is only a notice', async () => {
    const { w, requests } = await page();
    try {
      const calls = [], pointInBoundary = w.PMAEngine.pointInBoundary;
      w.PMAEngine.pointInBoundary = function (lon, lat, feature) {
        calls.push(feature.properties.geoid || feature.properties.GEOID);
        return pointInBoundary(lon, lat, feature);
      };
      w.WorkflowState.setJurisdiction(FRUITA);
      site(w, FRUITA.geoid); await tick();
      assert.equal(banner(w).dataset.siteBoundaryCheck, 'inside');
      assert(w.document.getElementById('maSiteBoundaryNotice').hidden);
      assert(!banner(w).hasAttribute('data-site-outside-jurisdiction'));
      // Grand Junction centroid is in Mesa County but outside the Fruita polygon.
      const p = site(w, '0831660'); await tick();
      assert(pointInBoundary(p.lon, p.lat, COUNTIES.features.find(f => f.properties.GEOID === FRUITA.countyFips)));
      assert(!pointInBoundary(p.lon, p.lat, PLACES.features.find(f => f.properties.geoid === FRUITA.geoid)));
      assert.equal(banner(w).dataset.siteOutsideJurisdiction, 'true');
      assert.equal(banner(w).dataset.siteBoundaryCheck, 'outside');
      assert(!w.document.getElementById('maSiteBoundaryNotice').hidden);
      assert(w.document.getElementById('maSiteBoundaryNotice').textContent.includes(w.WorkflowState.getJurisdiction().name));
      w.PMAEngine.runAnalysis(p.lat, p.lon, { method: 'buffer', bufferMiles: 3 }); await tick();
      assert(w.PMAEngine._state.getLastResult(), 'outside-jurisdiction sites can still run');
      assert.equal(w.document.body.dataset.pmaResultState, 'current');
      assert.equal(w.document.getElementById('pmaExportJsonBtn').disabled, false);
      site(w, LONGMONT.geoid); await tick();
      assert.equal(banner(w).dataset.siteBoundaryCheck, 'outside');
      w.WorkflowState.setJurisdiction({ geoType: 'county', geoid: '08077', countyFips: '08077', name: 'Mesa County' });
      site(w, FRUITA.geoid); await tick();
      assert.equal(banner(w).dataset.siteBoundaryCheck, 'inside');
      site(w, LONGMONT.geoid); await tick();
      assert.equal(banner(w).dataset.siteBoundaryCheck, 'outside');
      const cdp = PLACES.features.find(f => f.properties.type === 'cdp' && POINTS[f.properties.geoid]); assert(cdp);
      const cdpJurisdiction = GEO.cdps.find(c => c.geoid === cdp.properties.geoid); assert(cdpJurisdiction);
      w.WorkflowState.setJurisdiction({ geoType: 'cdp', geoid: cdp.properties.geoid, countyFips: cdpJurisdiction.containingCounty, name: cdp.properties.name });
      const cp = site(w, cdp.properties.geoid); await tick();
      assert.equal(banner(w).dataset.siteBoundaryCheck, pointInBoundary(cp.lon, cp.lat, cdp) ? 'inside' : 'outside');
      assert(calls.includes(FRUITA.geoid) && calls.includes('08077') && calls.includes(cdp.properties.geoid));
      assert.equal(requests.filter(p => p === 'data/co-place-boundaries.geojson').length, 1, 'reuse the overlay cache');
      assert.equal(requests.filter(p => p === 'data/co-county-boundaries.json').length, 1);
    } finally { w.close(); }
  });
  await test('statewide skips polygon lookup and has no outside notice', async () => {
    const { w, requests } = await page();
    try {
      w.WorkflowState.setJurisdiction({ geoType: 'state', geoid: '08', name: 'Colorado', countyFips: null });
      site(w, LONGMONT.geoid); await tick();
      assert.equal(w.document.getElementById('maJurisdictionName').textContent, 'Colorado');
      assert(w.document.getElementById('maJurisdictionBoundary').textContent.includes('statewide'));
      assert.equal(banner(w).dataset.siteBoundaryCheck, 'skipped');
      assert(!banner(w).hasAttribute('data-site-outside-jurisdiction'));
      assert(w.document.getElementById('maSiteBoundaryNotice').hidden);
      assert(!requests.some(p => ['data/co-place-boundaries.geojson', 'data/co-county-boundaries.json'].includes(p)));
    } finally { w.close(); }
  });
  for (const failure of ['missing', 'failed']) await test(failure + ' polygon reports unavailable, never inside', async () => {
    const { w } = await page(() => failure === 'failed' ? Promise.reject(new Error('offline'))
      : Promise.resolve({ ok: true, json: () => Promise.resolve({ type: 'FeatureCollection', features: [] }) }));
    try {
      w.WorkflowState.setJurisdiction(FRUITA); site(w, FRUITA.geoid); await tick();
      assert.equal(banner(w).dataset.siteBoundaryCheck, 'unavailable');
      const notice = w.document.getElementById('maSiteBoundaryNotice');
      assert(!notice.hidden); assert(/unavailable/i.test(notice.textContent)); assert(!/inside/i.test(notice.textContent));
      assert(!banner(w).hasAttribute('data-site-outside-jurisdiction'));
    } finally { w.close(); }
  });
  await test('late polygon responses cannot overwrite the current site or statewide selection', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const { w } = await page(() => pending);
    try {
      const checked = [], contains = w.PMAEngine.pointInBoundary;
      w.PMAEngine.pointInBoundary = function (lon, lat, polygon) {
        checked.push([lon, lat]); return contains(lon, lat, polygon);
      };
      w.WorkflowState.setJurisdiction(FRUITA); site(w, LONGMONT.geoid); await tick();
      assert.equal(banner(w).dataset.siteBoundaryCheck, 'pending');
      site(w, FRUITA.geoid);
      release({ ok: true, json: () => Promise.resolve(PLACES) }); await tick();
      assert.deepEqual(checked, [[POINTS[FRUITA.geoid].lng, POINTS[FRUITA.geoid].lat]], 'skip the obsolete point before testing or rendering it');
      assert.equal(banner(w).dataset.siteBoundaryCheck, 'inside');
      assert(w.document.getElementById('maSiteBoundaryNotice').hidden);
      w.WorkflowState.setJurisdiction({ geoType: 'state', geoid: '08', name: 'Colorado' }); await tick();
      assert.equal(banner(w).dataset.siteBoundaryCheck, 'skipped');
    } finally { w.close(); }
  });

  const Study = require('../js/project-market-study/study-geography.js');
  const Demand = require('../js/project-market-study/effective-demand.js');
  const Page = require('../js/project-market-study/market-study-page.js');
  const Sale = require('../js/market/sale-price-evidence.js');
  const realm = { window: {} }; vm.runInNewContext(read('js/hna/hna-ownership-need.js'), realm);
  const sources = { placeChas: json('data/hna/place-chas.json'), countyChas: json('data/hna/chas_affordability_gap.json'),
    amiGapPlace: json('data/co_ami_gap_by_place.json'), amiGapCounty: json('data/co_ami_gap_by_county.json'),
    homeValueCascade: json('data/hna/home-value-cascade.json') };
  const saleSources = { tracker: json('data/market/redfin_place_market_tracker_co.json'), bridge: json('data/market/bridge_co_market_summary.json'), assessor: json('data/market/parcel_aggregates_co.json') };
  function assemble(market, overrides = {}) {
    const context = { ...market, geoLevel: market.geoType };
    const data = { ...sources, summary: json(Study.datasetPaths(context).summary), salePriceEvidence: Sale.forPlace(market.geoid, saleSources), ...overrides };
    return Study.inputs(context, data, { HNAOwnershipNeed: realm.window.HNAOwnershipNeed, EffectiveDemand: Demand });
  }
  function renderStudy(geography) {
    const doc = new JSDOM('<main id="mount"></main>').window.document;
    const scenarios = ['fruita-commons', 'fruita-commons-compact', 'fruita-commons-family', 'fruita-commons-broad-income'].map(n => json('data/fixtures/' + n + '.scenario.json'));
    const data = { scenarios, conventions: json('data/policy/resale-conventions.json'), reportAsOf: scenarios[0].meta.as_of,
      geography, localBaseline: geography.localBaseline, observed: Study.observedFor(geography, scenarios[0], Demand) };
    Page.render(doc.getElementById('mount'), Page.buildModel(data, {}), data);
    return doc;
  }
  function figureScope(doc, key, level, geoid) {
    const node = doc.querySelector('[data-study-figure="' + key + '"]'); assert(node, key);
    assert.equal(node.dataset.geographyLevel, level, key);
    assert.equal(node.dataset.geoid, geoid || '', key);
    assert(node.textContent.includes(level), key + ' visibly names source geography');
    if (geoid) assert(node.textContent.includes(geoid), key + ' visibly names the bound GEOID');
  }
  await test('Fruita, Longmont and Wray banner figures agree with each bound geography record', () => {
    const counts = {};
    for (const market of [FRUITA, LONGMONT, WRAY]) {
      const bound = assemble(market), doc = renderStudy(bound), host = doc.querySelector('.ms-geography');
      assert(host.textContent.includes(bound.context.name));
      assert.equal(host.dataset.studyGeoid, bound.context.geoid);
      const countyFips = sources.amiGapPlace.places[market.geoid].containing_county_fips;
      assert.equal(bound.context.countyFips, countyFips);
      figureScope(doc, 'ami_4person', 'county', countyFips);
      assert.equal(sources.homeValueCascade.places[market.geoid].source, bound.ownershipNeed.affordabilityTest.source);
      figureScope(doc, 'home_value', bound.context.geoLevel, bound.context.geoid);
      figureScope(doc, 'median_sale_price', bound.salePrice.value == null ? 'unavailable' : 'ZIP-allocated', bound.salePrice.value == null ? null : bound.context.geoid);
      figureScope(doc, 'buyer_pool', bound.ownershipNeed.geoLevel, bound.ownershipNeed.geographyId);
      docsLink(doc, host);
      counts[market.geoid] = host.querySelectorAll('[data-study-figure]').length;
      assert.equal(counts[market.geoid], 4);
      doc.defaultView.close();
    }
    assert(Object.values(counts).every(n => n > 0)); console.log('    labelled figures per market: ' + JSON.stringify(counts));
  });
  await test('a bound county fallback is labelled county and absent figures stay unavailable', () => {
    const county = sources.homeValueCascade.counties[FRUITA.countyFips]; assert(county && county.value);
    const fallback = { ...county, source: 'county_fallback' };
    const bound = assemble(FRUITA, { homeValueCascade: { places: { [FRUITA.geoid]: fallback } } });
    assert.equal(bound.localBaseline.home_value.value, county.value);
    assert.equal(bound.ownershipNeed.affordabilityTest.source, fallback.source);
    const doc = renderStudy(bound);
    figureScope(doc, 'home_value', 'county', bound.context.countyFips);
    assert(/fallback/i.test(doc.querySelector('[data-study-figure="home_value"]').textContent));
    doc.defaultView.close();
    const absent = assemble(FRUITA, { placeChas: { places: {} }, homeValueCascade: { places: {} }, amiGapPlace: { places: {} }, salePriceEvidence: null });
    const missingDoc = renderStudy(absent);
    for (const key of ['ami_4person', 'home_value', 'median_sale_price', 'buyer_pool']) figureScope(missingDoc, key, 'unavailable', null);
    missingDoc.defaultView.close();
  });
  await test('the new agreement guard is reached by CI', () => {
    const scripts = json('package.json').scripts;
    assert.equal(scripts['test:geography-naming'], 'node test/geography-naming.test.js');
    assert(Object.entries(scripts).some(([k, v]) => /^ci:part-/.test(k) && v.split(' && ').includes('npm run test:geography-naming')));
  });
  console.log('Geography naming: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
