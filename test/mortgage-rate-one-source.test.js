'use strict';
// One mortgage rate for every homeownership affordability figure.
//
// Before this, the HNA headline card used 7.40% (HNAUtils.AFFORD) while the
// ownership-need kernel, every registry model and the jurisdiction digest used
// a 6.5% placeholder, so Fruita showed two different incomes needed for the
// same home. The rate now lives once, as OwnershipFinance.MORTGAGE_RATE. These
// checks pin agreement (with the FRED file, and between the surfaces), never a
// particular rate, so refreshing the week needs no test edit.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const engine = require('../js/hna/ownership-finance.js');
const RATE = engine.MORTGAGE_RATE;

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log('  ok ' + name); }

function loadKernel(withEngine) {
  const sandbox = { window: withEngine ? { OwnershipFinance: engine } : {} };
  vm.runInNewContext(read('js/hna/hna-ownership-need.js'), sandbox);
  return sandbox.window.HNAOwnershipNeed;
}

function loadUtils(withEngine) {
  const win = withEngine ? { OwnershipFinance: engine } : {};
  win.MoneyFormatter = require('../js/utils/format-money.js');
  const doc = {
    readyState: 'complete', getElementById: () => null, querySelector: () => null,
    querySelectorAll: () => [], addEventListener: () => {},
    createElement: () => ({ style: {}, appendChild: () => {}, setAttribute: () => {} }),
  };
  win.document = doc;
  vm.runInNewContext(read('js/hna/hna-utils.js'), {
    window: win, document: doc, console,
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: {}, location: { search: '', href: '', pathname: '/' },
    URLSearchParams, URL, setTimeout, clearTimeout,
  });
  return win.HNAUtils;
}

test('the rate is the FRED MORTGAGE30US reading for the week it names', () => {
  assert.match(RATE.week, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(RATE.series, 'MORTGAGE30US');
  const fred = JSON.parse(read('data/fred-data.json')).series.MORTGAGE30US;
  const obs = fred.observations.find((o) => o.date === RATE.week);
  assert.ok(obs, 'data/fred-data.json has no MORTGAGE30US reading for ' + RATE.week);
  assert.equal(Math.round(Number(obs.value) * 100), Math.round(RATE.rateAnnual * 10000),
    `MORTGAGE_RATE ${RATE.rateAnnual} vs FRED ${obs.value}% for ${RATE.week}`);
  // The printed source names the same week, so a reader sees which survey it is.
  const shown = new Date(RATE.week + 'T00:00:00Z').toLocaleDateString('en-US',
    { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  assert.ok(RATE.source.includes(shown), `source "${RATE.source}" does not name the week ${shown}`);
});

test('the HNA headline card reads the shared rate, and withholds without it', () => {
  const withEngine = loadUtils(true);
  assert.equal(withEngine.AFFORD.rateAnnual, RATE.rateAnnual);
  assert.equal(withEngine.AFFORD.rateSource, RATE.source);
  const without = loadUtils(false);
  assert.equal(without.AFFORD.rateAnnual, null);
  assert.equal(without.computeIncomeNeeded(400000), null, 'no rate, no income figure');
});

test('the headline card and the narrative give the same income for the same home', () => {
  // Headline: HNAUtils.computeIncomeNeeded (closed form). Narrative and
  // ownership strategy: incomeNeededForHomeValue under the default model at a
  // 4-person household (a binary search, so agreement is to the dollar).
  const utils = loadUtils(true);
  engine.setRegistry(JSON.parse(read('data/policy/affordability-models.json')));
  for (const price of [250000, 396000, 486295, 750000]) {
    const headline = utils.computeIncomeNeeded(price).annualIncome;
    const narrative = engine.incomeNeededForHomeValue(price, { modelId: 'conservative_screening', householdSize: 4 });
    assert.ok(Math.abs(headline - narrative) <= 1, `$${price}: headline ${Math.round(headline)} vs narrative ${Math.round(narrative)}`);
  }
});

test('the ownership-need kernel uses the same rate, with or without the engine', () => {
  const k = loadKernel(true).CONSTANTS.affordabilityAssumptions;
  assert.equal(k.pmms30YearRate, RATE.rateAnnual);
  assert.equal(k.pmmsDate, RATE.week);
  assert.equal(k.pmmsSource, RATE.source);
  // The vm fallback literal (engine-less contexts) must equal the shared rate.
  const bare = loadKernel(false).CONSTANTS.affordabilityAssumptions;
  assert.equal(bare.pmms30YearRate, RATE.rateAnnual, 'fallback literal in hna-ownership-need.js drifted');
  assert.equal(bare.pmmsDate, RATE.week);
  assert.equal(bare.pmmsSource, RATE.source);
  assert.equal(loadKernel(true).maxAffordablePrice(100000, 0.8), engine.maxAffordablePrice(100000, 0.8));
  assert.equal(loadKernel(false).maxAffordablePrice(100000, 0.8), engine.maxAffordablePrice(100000, 0.8));
});

test('no registry model carries its own rate', () => {
  const registry = JSON.parse(read('data/policy/affordability-models.json'));
  const own = registry.models.filter((m) => m.params && m.params.rateAnnual != null);
  assert.deepEqual(own.map((m) => m.id), []);
  engine.setRegistry(registry);
  for (const m of registry.models.filter((x) => x.id !== 'custom')) {
    const viaModel = engine.computeBuyerCapacity(100000, 0.8, m.id);
    const atRate = engine.computeBuyerCapacity(100000, 0.8, { modelId: m.id, rateAnnual: RATE.rateAnnual });
    assert.equal(viaModel.maxPrice, atRate.maxPrice, m.id + ' resolves to MORTGAGE_RATE');
  }
});

test('the jurisdiction digest builds at the shared rate', () => {
  const src = read('scripts/hna/build_jurisdiction_metrics_digest.mjs');
  assert.ok(/rateAnnual: OwnershipFinance\.MORTGAGE_RATE\.rateAnnual/.test(src), 'digest assumptions do not read MORTGAGE_RATE');
  assert.ok(/window: \{ OwnershipFinance \}/.test(src), 'digest kernel sandbox does not carry the engine');
});

// Every script that reads MORTGAGE_RATE at load, with the fewest pages expected to load it.
const RATE_READERS = [['js/hna/hna-utils.js', 6], ['js/hna/hna-comparison.js', 1]];

test('every page that loads a rate reader loads ownership-finance.js before it', () => {
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  for (const [reader, min] of RATE_READERS) {
    const users = pages.filter((p) => read(p).includes(reader));
    assert.ok(users.length >= min, `only ${users.length} pages load ${reader}`);
    for (const p of users) {
      const html = read(p);
      const fin = html.indexOf('src="js/hna/ownership-finance.js"');
      const at = html.indexOf('src="' + reader + '"');
      assert.ok(fin >= 0 && fin < at, p + ' loads ' + reader + ' before ownership-finance.js');
    }
  }
});

test('the place comparison prices purchases at the shared rate, and withholds without it', () => {
  const src = read('js/hna/hna-comparison.js');
  assert.match(src, /window\.OwnershipFinance\.MORTGAGE_RATE/);
  assert.ok(!/Based on 7% rate/.test(src), 'the comparison note still hard-codes 7%');
  assert.match(src, /if \(!Number\.isFinite\(MORTGAGE_RATE\)\) return null;/);
});

test('no 6.5% placeholder rate is left on an ownership affordability path', () => {
  for (const rel of ['js/hna/hna-utils.js', 'js/hna/hna-ownership-need.js', 'js/hna/hna-renderers.js',
    'js/hna/hna-ownership-strategy.js', 'js/hna/hna-comparison.js', 'scripts/hna/build_jurisdiction_metrics_digest.mjs']) {
    assert.ok(!/(rateAnnual|pmms30YearRate)\s*:\s*0\.065\b/.test(read(rel)), rel + ' still sets a 6.5% rate');
    assert.ok(!/\|\|\s*0\.07\d\b/.test(read(rel)), rel + ' falls back to a literal rate');
    assert.ok(!/(MORTGAGE_RATE|rateAnnual)[^\n;]*\|\|\s*0\.\d/.test(read(rel)), rel + ' gives the mortgage rate a literal fallback');
    assert.ok(!/mortgageRate\s*\|\|/.test(read(rel)), rel + ' falls back to COHO_DEFAULTS.mortgageRate');
  }
});

console.log(`mortgage-rate-one-source: ${passed} passed`);
