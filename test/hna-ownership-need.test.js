'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function loadModule() {
  const src = fs.readFileSync(path.join(ROOT, 'js/hna/hna-ownership-need.js'), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'hna-ownership-need.js' });
  return sandbox.window.HNAOwnershipNeed;
}

const Ownership = loadModule();
const compute = Ownership.computeOwnershipNeed;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✅ ' + name);
  } catch (err) {
    failed += 1;
    console.error('  ❌ ' + name);
    console.error('     ' + err.message);
  }
}

function walkNoBadNumbers(value, trail) {
  trail = trail || 'output';
  if (value === undefined) throw new Error(trail + ' is undefined');
  if (typeof value === 'number' && Number.isNaN(value)) throw new Error(trail + ' is NaN');
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkNoBadNumbers(v, trail + '[' + i + ']'));
  } else if (value && typeof value === 'object') {
    Object.keys(value).forEach(k => walkNoBadNumbers(value[k], trail + '.' + k));
  }
}

function band(total, cb30, cb50) {
  return {
    total,
    cost_burdened_30pct: cb30,
    cost_burdened_50pct: cb50,
    pct_cost_burdened_30: total ? cb30 / total : 0,
    pct_cost_burdened_50: total ? cb50 / total : 0,
  };
}

function fixtureEntry(opts) {
  opts = Object.assign({
    name: 'Fixture',
    renter: 1000,
    owner: 1000,
    renterCb30: 400,
    renterCb50: 200,
    ownerCb30: 200,
    ownerCb50: 80,
    modRenter: 300,
    modOwner: 300,
    modOwnerCb: 80,
    lowConfidence: false,
    acsAnchor: false,
  }, opts || {});
  return {
    name: opts.name,
    low_confidence: opts.lowConfidence,
    acs_anchor: opts.acsAnchor,
    summary: {
      total_renter_hh: opts.renter,
      total_owner_hh: opts.owner,
      renter_cb30_count: opts.renterCb30,
      renter_cb30_share: opts.renter ? opts.renterCb30 / opts.renter : 0,
      renter_cb50_count: opts.renterCb50,
      renter_cb50_share: opts.renter ? opts.renterCb50 / opts.renter : 0,
      owner_cb30_count: opts.ownerCb30,
      owner_cb30_share: opts.owner ? opts.ownerCb30 / opts.owner : 0,
      owner_cb50_count: opts.ownerCb50,
      owner_cb50_share: opts.owner ? opts.ownerCb50 / opts.owner : 0,
    },
    renter_hh_by_ami: {
      lte30: band(250, Math.min(opts.renterCb30, 230), Math.min(opts.renterCb50, 180)),
      '31to50': band(250, 120, 30),
      '51to80': band(opts.modRenter * 0.6, 60, 8),
      '81to100': band(opts.modRenter * 0.4, 30, 0),
      '100plus': band(Math.max(0, opts.renter - 500 - opts.modRenter), 20, 0),
    },
    owner_hh_by_ami: {
      lte30: band(150, 110, 75),
      '31to50': band(150, 90, 35),
      '51to80': band(opts.modOwner * 0.6, opts.modOwnerCb * 0.65, 20),
      '81to100': band(opts.modOwner * 0.4, opts.modOwnerCb * 0.35, 5),
      '100plus': band(Math.max(0, opts.owner - 300 - opts.modOwner), 20, 0),
    },
  };
}

const amiGap = {
  ami_4person: 100000,
  gap_units_minus_households_le_ami_pct: { 80: 120 },
};

console.log('Affordable Ownership Need — unit tests');

test('null/missing entry returns unavailable without NaN or undefined', () => {
  const out = compute({});
  assert.equal(out.dataQuality, 'Unavailable');
  assert.equal(out.tenureMixRecommendation, 'Insufficient data - verify locally');
  walkNoBadNumbers(out);
});

test('zero renter or owner households do not divide by zero', () => {
  const out = compute({
    placeChasEntry: fixtureEntry({ renter: 0, owner: 0, renterCb30: 0, renterCb50: 0, ownerCb30: 0, ownerCb50: 0, modRenter: 0, modOwner: 0, modOwnerCb: 0 }),
    amiGapEntry: amiGap,
    homeValueEntry: { value: 200000, source: 'test' },
  });
  walkNoBadNumbers(out);
  assert.ok(out.rentalPressure);
});

test('missing owner_hh_by_ami degrades quality and fit gracefully', () => {
  const entry = fixtureEntry();
  delete entry.owner_hh_by_ami;
  const out = compute({ placeChasEntry: entry, amiGapEntry: amiGap, homeValueEntry: { value: 250000, source: 'test' } });
  assert.notEqual(out.dataQuality, 'High');
  assert.ok(out.caveats.some(c => c.includes('AMI band detail is partial')));
  walkNoBadNumbers(out);
});

test('high rental plus high ownership pressure recommends rental + ownership mix', () => {
  const out = compute({
    placeChasEntry: fixtureEntry({ renterCb30: 560, renterCb50: 280, ownerCb30: 310, ownerCb50: 130, modRenter: 1600, modOwner: 500, modOwnerCb: 220 }),
    amiGapEntry: amiGap,
    homeValueEntry: { value: 700000, source: 'test' },
  });
  assert.equal(out.tenureMixRecommendation, 'Rental + ownership mix');
});

test('high rental plus low fit recommends rental priority', () => {
  const out = compute({
    placeChasEntry: fixtureEntry({ renterCb30: 560, renterCb50: 280, ownerCb30: 120, ownerCb50: 20, modRenter: 80, modOwner: 200, modOwnerCb: 20 }),
    amiGapEntry: amiGap,
    homeValueEntry: { value: 250000, source: 'test' },
  });
  assert.equal(out.tenureMixRecommendation, 'Rental priority');
});

test('ownership pressure plus moderate fit recommends ownership-supportive strategy', () => {
  const out = compute({
    placeChasEntry: fixtureEntry({ renterCb30: 250, renterCb50: 80, ownerCb30: 300, ownerCb50: 125, modRenter: 650, modOwner: 500, modOwnerCb: 210 }),
    amiGapEntry: amiGap,
    homeValueEntry: { value: 430000, source: 'test' },
  });
  assert.equal(out.tenureMixRecommendation, 'Ownership-supportive strategy');
});

test('low_confidence and acs_anchor downgrade quality with caveats', () => {
  const low = compute({ placeChasEntry: fixtureEntry({ lowConfidence: true }), amiGapEntry: amiGap, homeValueEntry: { value: 300000, source: 'test' } });
  assert.notEqual(low.dataQuality, 'High');
  assert.ok(low.caveats.some(c => c.includes('low confidence')));
  const anchored = compute({ placeChasEntry: fixtureEntry({ acsAnchor: true }), amiGapEntry: amiGap, homeValueEntry: { value: 300000, source: 'test' } });
  assert.notEqual(anchored.dataQuality, 'High');
  assert.ok(anchored.caveats.some(c => c.includes('capped to ACS occupied units')));
});

test('affordability test classifies cheap, stretch, expensive, and missing home values', () => {
  const cheap = compute({ placeChasEntry: fixtureEntry({ modRenter: 1600 }), amiGapEntry: amiGap, homeValueEntry: { value: 180000, source: 'test' } });
  assert.equal(cheap.affordabilityTest.classification, 'market-attainable');
  assert.equal(cheap.ownershipFit.tier, 'Moderate');
  assert.ok(cheap.caveats.some(c => c.includes('down-payment assistance')));
  const stretch = compute({ placeChasEntry: fixtureEntry({ modRenter: 1600 }), amiGapEntry: amiGap, homeValueEntry: { value: 335000, source: 'test' } });
  assert.equal(stretch.affordabilityTest.classification, 'stretch');
  const pricey = compute({ placeChasEntry: fixtureEntry({ modRenter: 1600 }), amiGapEntry: amiGap, homeValueEntry: { value: 700000, source: 'test' } });
  assert.equal(pricey.affordabilityTest.classification, 'priced-out');
  const missing = compute({ placeChasEntry: fixtureEntry({ modRenter: 1600 }), amiGapEntry: amiGap, homeValueEntry: { value: 700000, review_flags: ['manual'] } });
  assert.equal(missing.affordabilityTest, null);
  assert.notEqual(missing.dataQuality, 'High');
});

test('max-price math matches hand-computed PITI case', () => {
  const max80 = Ownership.maxAffordablePrice(100000, 0.80);
  assert.equal(max80, 276715);
});

test('copy contains screening framing and avoids banned phrases', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/hna/hna-ownership-need.js'), 'utf8').toLowerCase();
  assert.ok(src.includes('screening estimate'));
  [
    'qualified ' + 'buyer',
    'qualified ' + 'buyers',
    'mortgage' + '-ready',
    'buyer ' + 'qualification',
    'guaranteed ' + 'demand',
    'investment ' + 'opportunity',
    'absorption ' + 'forecast',
    'homeownership ' + 'prediction',
  ].forEach(phrase => assert.equal(src.includes(phrase), false, phrase + ' should be absent'));
});

test('real place-CHAS smoke has no throws, NaN, or undefined', () => {
  const placeChas = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/place-chas.json'), 'utf8'));
  const gaps = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/co_ami_gap_by_place.json'), 'utf8'));
  const homeValues = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/home-value-cascade.json'), 'utf8'));
  for (const [geoid, entry] of Object.entries(placeChas.places || {})) {
    const out = compute({
      geographyId: geoid,
      geographyName: entry.name,
      geoLevel: 'place',
      placeChasEntry: entry,
      amiGapEntry: gaps.places && gaps.places[geoid],
      homeValueEntry: homeValues.places && homeValues.places[geoid],
    });
    walkNoBadNumbers(out, 'place ' + geoid);
  }
});

if (failed) {
  console.error(`\nAffordable Ownership Need: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`\nAffordable Ownership Need: ${passed} passed, 0 failed`);
