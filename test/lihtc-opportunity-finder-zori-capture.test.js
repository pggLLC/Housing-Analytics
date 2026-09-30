#!/usr/bin/env node
/*
 * Regression coverage for LIHTC Opportunity Finder capture logic:
 * HUD FMR remains the sortable baseline, while current ZORI can rescue
 * requireCapture when lagged FMR understates market rent.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const hud = require('../data/hud-fmr-income-limits.json');

global.window = global;
global.document = {
  readyState: 'loading',
  addEventListener: function () {},
  getElementById: function () { return null; },
  querySelector: function () { return null; }
};

global.ChfaRentLimits = require('../js/chfa-rent-limits.js');
require('../js/components/zori-rent-utils.js');
require('../js/lihtc-opportunity-finder.js');

const lof = global.__LOF && global.__LOF._test;
assert(lof, 'expected LIHTC Opportunity Finder test hooks');

const zoriMeta = { vintage_month: '2026-04-30' };
lof.setZoriForTest(
  {
    '08067': {
      name: 'La Plata County',
      rent: 2034,
      yoy_change_pct: -0.9,
      vintage_month: '2026-04-30'
    }
  },
  zoriMeta,
  {
    durango: {
      name: 'Durango',
      rent: 2020,
      yoy_change_pct: 0,
      vintage_month: '2026-04-30'
    }
  }
);

const durangoMarket = {
  fmr2br: 1589,
  fmrYear: hud.meta.fiscal_year,
  lihtc60ami2br: 1448,
  captureAdvantage: 141
};

const durangoZori = lof.zoriCaptureForMarket(durangoMarket, '08067', 'Durango');
assert.strictEqual(durangoZori.captureAdvantage, 572, 'Durango ZORI capture should use current city ZORI as 2BR anchor');
assert.strictEqual(durangoZori.geography_level, 'place', 'Durango ZORI capture should prefer place coverage');

const durangoCell = lof.captureCell({
  name: 'Durango',
  containingCounty: '08067',
  market: durangoMarket,
  captureAdvantage: durangoMarket.captureAdvantage,
  zoriCapture: durangoZori,
  zoriCaptureAdvantage: durangoZori.captureAdvantage
});

assert(/>\+\$141\/mo<\/span>/.test(durangoCell), 'visible Capture pill should keep FMR +$141 baseline');
assert(durangoCell.includes('FMR: +$141') && durangoCell.includes('HUD FMR FY' + hud.meta.fiscal_year), 'tooltip should show FMR capture with the data file vintage');
assert(/current market \(Zillow ZORI place 2026-04-30\): ~\+\$572/.test(durangoCell), 'tooltip should show current-ZORI capture');

assert.strictEqual(
  lof.passesCaptureRequirement({
    captureAdvantage: -25,
    zoriCaptureAdvantage: 125
  }),
  true,
  'positive current-ZORI capture should rescue a row from requireCapture'
);

assert.strictEqual(
  lof.passesCaptureRequirement({
    captureAdvantage: -25,
    zoriCaptureAdvantage: null
  }),
  false,
  'negative FMR capture with no ZORI should remain filtered'
);

assert.strictEqual(
  lof.passesCaptureRequirement({
    captureAdvantage: null,
    zoriCaptureAdvantage: null
  }),
  true,
  'missing FMR/ZORI should preserve fail-open behavior'
);

const finderSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'lihtc-opportunity-finder.js'), 'utf8');
assert(
  /case 'captureAdvantage': return op\.captureAdvantage == null \? -Infinity : op\.captureAdvantage;/.test(finderSrc),
  'captureAdvantage sort must stay on the FMR baseline, not mixed-source ZORI'
);

console.log('LIHTC Opportunity Finder ZORI capture: PASS');

// Exercise the same builder used by loadAll, against published CHFA values.
const chfa = require('../data/chfa-income-rent-limits-2026.json');
for (const fips of ['08031', '08077', '08067', '08097']) {
  const expected = ChfaRentLimits.maxGrossRent(chfa, fips, 60, '2BR');
  assert(Number.isFinite(expected.grossRent), fips + ': real CHFA fixture');
  const hudCounty = hud.counties.find((c) => c.fips === fips);
  const market = lof.marketForCounty(chfa, fips, hudCounty, hud.meta);
  assert.strictEqual(market.lihtc60ami2br, expected.grossRent, fips + ': published CHFA limit, not HUD income arithmetic');
  assert.strictEqual(market.tableYear, expected.tableYear);
  assert.strictEqual(market.effectiveDate, expected.effectiveDate);
  const fmr = hudCounty && hudCounty.fmr.two_br;
  assert.strictEqual(market.captureAdvantage, Number.isFinite(fmr) ? fmr - expected.grossRent : null);
  const op = { market, captureAdvantage: market.captureAdvantage };
  for (const html of [lof.captureCell(op), lof.marketCaptureFacts(market)]) {
    assert(html.includes('$' + expected.grossRent.toLocaleString()), 'rendered rent agrees with CHFA');
    assert(html.includes('CHFA ' + expected.tableYear), 'source year agrees with CHFA');
  }
  assert(lof.marketCaptureFacts(market).includes(expected.effectiveDate));
  if (market.captureAdvantage > 0) assert(lof.actionReasons(op).join(' ').includes('$' + expected.grossRent.toLocaleString()));
  const zori = lof.zoriCaptureForMarket(market, '08067', 'Durango');
  assert.strictEqual(zori.captureAdvantage, Math.round(zori.rent - expected.grossRent));
}
for (const table of [null, { counties: [] }]) {
  const missing = lof.marketForCounty(table, '08031', hud.counties.find((c) => c.fips === '08031'));
  assert.strictEqual(missing.lihtc60ami2br, null);
  assert.strictEqual(missing.captureAdvantage, null);
  assert.match(lof.captureCell({ market: missing }), /CHFA 60% 2BR limit unavailable/);
  assert.match(lof.marketCaptureFacts(missing), /CHFA 60% 2BR limit unavailable/);
  assert(!lof.marketCaptureFacts(missing).includes('$0'), 'absence is not zero capture');
  assert.strictEqual(lof.zoriCaptureForMarket(missing, '08067', 'Durango'), null);
  assert.strictEqual(lof.passesCaptureRequirement(missing), true);
}
const noHud = lof.marketForCounty(chfa, '08031', null);
assert.strictEqual(noHud.captureAdvantage, null);
assert.strictEqual(noHud.fmr2br, null);
assert(Number.isFinite(noHud.lihtc60ami2br), 'CHFA coverage survives missing HUD coverage');
assert(!lof.marketCaptureFacts(noHud).includes('$0'));
const finderHtml = fs.readFileSync(path.join(__dirname, '..', 'lihtc-opportunity-finder.html'), 'utf8');
const scripts = [...finderHtml.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
assert(scripts.indexOf('js/chfa-rent-limits.js') >= 0);
assert(scripts.indexOf('js/chfa-rent-limits.js') < scripts.indexOf('js/lihtc-opportunity-finder.js'));
assert(finderSrc.includes("loadSoft('data/chfa-income-rent-limits-2026.json')"), 'load the published table');
console.log('Opportunity Finder CHFA agreement, provenance and absence: PASS (4 counties)');

// Verify the actual async loader connects the fetched CHFA file to the records.
(async () => {
  const loaded = [], counties = ['08031', '08077', '08067', '08097'];
  let tableAvailable = true;
  global.DataService = { getJSON: async (url) => {
    loaded.push(url);
    if (url === 'data/chfa-income-rent-limits-2026.json') {
      if (!tableAvailable) throw new Error('CHFA fetch unavailable');
      return chfa;
    }
    if (url === 'data/hud-fmr-income-limits.json') return hud;
    if (url === 'data/hna/geo-config.json') return { counties: counties.map((geoid) => ({ geoid, label: geoid })) };
    return {};
  } };
  await lof.loadAll();
  assert(loaded.includes('data/chfa-income-rent-limits-2026.json'));
  for (const fips of counties) {
    assert.strictEqual(lof.loadedMarket(fips).lihtc60ami2br, ChfaRentLimits.maxGrossRent(chfa, fips, 60, '2BR').grossRent);
    assert.strictEqual(lof.loadedMarket(fips).fmrYear, hud.meta.fiscal_year, 'loader retains the HUD file vintage');
  }
  tableAvailable = false;
  await lof.loadAll();
  for (const fips of counties) {
    assert.strictEqual(lof.loadedMarket(fips).lihtc60ami2br, null, 'failed reload clears prior CHFA limit');
    assert.strictEqual(lof.loadedMarket(fips).captureAdvantage, null);
  }
  const missingCounty = lof.marketForCounty(chfa, '99999', hud.counties[0]);
  assert.strictEqual(missingCounty.lihtc60ami2br, null);
  assert.strictEqual(missingCounty.captureAdvantage, null);
  assert.match(lof.captureCell({ market: missingCounty }), /CHFA 60% 2BR limit unavailable/);
  console.log('Opportunity Finder CHFA loader and failed-reload absence: PASS');
})().catch((e) => { console.error(e); process.exitCode = 1; });
