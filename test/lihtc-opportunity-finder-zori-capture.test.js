#!/usr/bin/env node
/*
 * Regression coverage for LIHTC Opportunity Finder capture logic:
 * HUD FMR remains the sortable baseline, while current ZORI can rescue
 * requireCapture when lagged FMR understates market rent.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

global.window = global;
global.document = {
  readyState: 'loading',
  addEventListener: function () {},
  getElementById: function () { return null; },
  querySelector: function () { return null; }
};

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
assert(/FMR: \+\$141 \(HUD FY25, ~2022-23 data\)/.test(durangoCell), 'tooltip should show FMR capture with vintage caveat');
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
