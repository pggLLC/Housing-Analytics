'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'js/place-chas-lookup.js');
const REAL_CHAS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/place-chas.json'), 'utf8'));
const REAL_ALIASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/place-phantom-aliases.json'), 'utf8'));

async function loadHelper(chasDoc) {
  delete require.cache[require.resolve(MODULE)];
  global.window = {
    DataService: {
      baseData: (rel) => rel,
      getJSON: async (url) => url.includes('place-phantom-aliases') ? REAL_ALIASES : chasDoc,
    },
  };
  require(MODULE);
  await window.PlaceChas.init();
  return window.PlaceChas;
}

(async function main() {
  const helper = await loadHelper(REAL_CHAS);
  assert.equal(helper.metadata().vintage_chas, '2018-2022', 'helper exposes the committed CHAS vintage');

  const aurora = helper.disclosure('0804000');
  assert.equal(aurora.methodLabel, 'Population-share', 'Aurora gets the population-share label');
  assert.equal(aurora.areaFallback, false, 'Aurora uses population-share apportionment');
  assert(aurora.text.includes('HUD CHAS 2018-2022'), 'population-share disclosure includes CHAS vintage');
  assert(aurora.text.includes('Population-share apportionment from tract-level CHAS'), 'population-share method is explicit');
  assert(aurora.text.includes('not a direct place measurement'), 'place estimate is not presented as direct measurement');

  const commerceCity = helper.disclosure('0816495');
  assert.equal(commerceCity.methodLabel, 'Area-share fallback', 'Commerce City gets the area-share label');
  assert.equal(commerceCity.areaFallback, true, 'Commerce City uses the committed area-share fallback');
  assert(commerceCity.text.includes('Area-share fallback'), 'fallback method is explicit');
  assert(commerceCity.text.includes('population data was unavailable'), 'fallback reason is explicit');
  assert(commerceCity.text.includes('less reliable'), 'fallback reliability caveat is explicit');

  const hartsel = helper.disclosure('0834630');
  assert.equal(hartsel.methodLabel, 'Rate-only fallback', 'Hartsel gets the distinct rate-only label');
  assert.equal(hartsel.rateOnlyFallback, true, 'Hartsel is identified as rate-only fallback');
  assert(hartsel.text.includes('tract CHAS rates were applied without household-count apportionment'), 'rate-only method is explicit');
  assert(hartsel.text.includes('less reliable'), 'rate-only reliability caveat is explicit');

  const sourceCounts = Object.values(REAL_CHAS.places).reduce((counts, place) => {
    counts[place.source] = (counts[place.source] || 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(sourceCounts, {
    'population-apportionment': 473,
    'area-apportionment': 6,
    'rate-only-fallback': 3,
  }, 'all three committed source categories remain pinned');

  assert.equal(REAL_CHAS.meta.count_low_confidence, 0, 'current dataset has no low-confidence places');
  const lowCoverageDoc = JSON.parse(JSON.stringify(REAL_CHAS));
  lowCoverageDoc.places['0804000'].coverage_share = 0.75;
  lowCoverageDoc.places['0804000'].low_confidence = true;
  const lowHelper = await loadHelper(lowCoverageDoc);
  const lowAurora = lowHelper.disclosure('0804000');
  assert.equal(lowAurora.lowCoverage, true, 'low-coverage flag survives to display disclosure');
  assert(lowAurora.text.includes('75.0% of the place, below the 80% warning threshold'), 'coverage warning uses metadata threshold');

  const renderer = fs.readFileSync(path.join(ROOT, 'js/hna/hna-renderers.js'), 'utf8');
  assert(renderer.includes('placeChasDisclosureHtml(geoid)'), 'AMI-tier caption uses the shared disclosure');
  assert(renderer.includes('placeChasDisclosureHtml(placeGeoid)'), 'owner cost-burden note uses the shared disclosure');
  assert(renderer.includes('placeChasDisclosureHtml(profile._geoid)'), 'housing-gap CHAS figure uses the shared disclosure');
  assert(renderer.includes('placeChasDisclosure(selectedGeo.geoid)'), 'CHAS tier chart uses record-specific disclosure');

  const pageCases = [
    ['0804000', 'population-apportionment', 'Population-share', 'population-share apportionment'],
    ['0816495', 'area-apportionment', 'Area-share fallback', 'less-reliable area-share fallback'],
    ['0834630', 'rate-only-fallback', 'Rate-only fallback', 'without household-count apportionment'],
  ];
  for (const [geoid, source, label, caveat] of pageCases) {
    const page = fs.readFileSync(path.join(ROOT, 'places', `${geoid}.html`), 'utf8');
    assert(page.includes('"vintage_chas": "2018-2022"'), `${geoid} generated page embeds the CHAS vintage`);
    assert(page.includes(`"source": "${source}"`), `${geoid} generated page embeds its exact apportionment source`);
    const dom = new JSDOM(page, { runScripts: 'dangerously', url: `https://example.test/places/${geoid}.html` });
    assert.equal(dom.window.document.getElementById('psChasMethod').textContent, label, `${geoid} renders the correct method label`);
    assert(dom.window.document.getElementById('psChasWarning').textContent.includes(caveat), `${geoid} renders its method-specific caveat`);
    dom.window.close();
  }

  console.log('hna-chas-vintage-disclosure: PASS (Aurora population-share; Commerce City area-share; Hartsel rate-only)');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
