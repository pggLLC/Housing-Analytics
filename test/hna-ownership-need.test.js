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

function entryForRenterPressure(renterCb30Share, renterCb50Share, renterShare) {
  const totalHouseholds = 10000;
  const renter = Math.round(totalHouseholds * renterShare);
  return fixtureEntry({
    renter,
    owner: totalHouseholds - renter,
    renterCb30: Math.round(renter * renterCb30Share),
    renterCb50: Math.round(renter * renterCb50Share),
    modRenter: Math.max(1, Math.round(renter * 0.20)),
    ownerCb30: 100,
    ownerCb50: 40,
    modOwnerCb: 40,
  });
}

function entryForOwnershipPressure(ownerCb30Share, ownerCb50Share, moderateOwnerCbShare) {
  return fixtureEntry({
    renter: 1000,
    owner: 1000,
    renterCb30: 100,
    renterCb50: 40,
    modRenter: 150,
    ownerCb30: Math.round(1000 * ownerCb30Share),
    ownerCb50: Math.round(1000 * ownerCb50Share),
    modOwner: 1000,
    modOwnerCb: Math.round(1000 * moderateOwnerCbShare),
  });
}

function entryForOwnershipFit(moderateRenterHouseholds, moderateRenterShare) {
  const renter = Math.round(moderateRenterHouseholds / moderateRenterShare);
  return fixtureEntry({
    renter,
    owner: 1000,
    renterCb30: Math.round(renter * 0.20),
    renterCb50: Math.round(renter * 0.06),
    modRenter: moderateRenterHouseholds,
    ownerCb30: 100,
    ownerCb50: 40,
    modOwnerCb: 40,
  });
}

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

test('acs_anchor object only downgrades when applied is true', () => {
  const notApplied = compute({
    placeChasEntry: fixtureEntry({ acsAnchor: { applied: false, acs_occupied_hh: 2000, base_hh: 1900 } }),
    amiGapEntry: amiGap,
    homeValueEntry: { value: 300000, source: 'test' },
  });
  assert.equal(notApplied.dataQuality, 'High');
  assert.equal(notApplied.caveats.some(c => c.includes('capped to ACS occupied units')), false);
  const applied = compute({
    placeChasEntry: fixtureEntry({ acsAnchor: { applied: true, acs_occupied_hh: 1800, base_hh: 2200 } }),
    amiGapEntry: amiGap,
    homeValueEntry: { value: 300000, source: 'test' },
  });
  assert.notEqual(applied.dataQuality, 'High');
  assert.ok(applied.caveats.some(c => c.includes('capped to ACS occupied units')));
});

test('county gap-source convention does not turn surplus into place fallback shortage', () => {
  const countySurplus = {
    ami_4person: 100000,
    gapSource: 'county',
    gap_units_minus_households_le_ami_pct: { 80: 1246 },
  };
  const out = compute({
    placeChasEntry: fixtureEntry(),
    geoLevel: 'place',
    countyFallback: true,
    amiGapEntry: countySurplus,
    homeValueEntry: { value: 300000, source: 'test' },
  });
  assert.equal(out.existingRentalGap, 0);
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
  assert.equal(missing.ownershipFit.tier, 'Very High');
  assert.notEqual(missing.dataQuality, 'High');
  assert.ok(missing.caveats.some(c => c.includes('home-value input was unavailable or flagged')));
});

test('max-price math matches hand-computed PITI case', () => {
  const max80 = Ownership.maxAffordablePrice(100000, 0.80);
  assert.equal(max80, 289983);
});

test('B25075 owner-value supply series is non-vacuous and labeled', () => {
  const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/summary/08045.json'), 'utf8')).acsProfile;
  const series = Ownership.ownerValueSupplySeries(profile);
  assert.ok(series, 'Garfield County B25075 supply series should compute');
  assert.equal(series.source, 'ACS B25075');
  assert.equal(series.sourceLabel, 'ACS B25075 owner-occupied units by value');
  assert.equal(series.dataQuality, 'High');
  assert.equal(series.bands.length, Ownership.OWNER_VALUE_BINS.length);
  assert.ok(series.totalOwnerOccupiedUnits > 10000, 'Garfield owner-occupied denominator is non-vacuous');
  assert.ok(series.summedBandUnits > 10000, 'Garfield owner-value bins are non-vacuous');
  assert.ok(series.bands.some((band) => band.code === 'B25075_023E' && band.ownerOccupiedUnits > 0), 'high-value owner band is populated');
  const empty = { B25075_001E: profile.B25075_001E };
  Ownership.OWNER_VALUE_BINS.forEach((bin) => { empty[bin[0]] = 0; });
  assert.equal(Ownership.ownerValueSupplySeries(empty), null, 'empty owner-value bins must not produce a supply series');
});

test('county affordability classification uses FHFA-backed county cascade anchor', () => {
  const countyChas = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/chas_affordability_gap.json'), 'utf8')).counties;
  const gaps = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/co_ami_gap_by_county.json'), 'utf8')).counties;
  const cascade = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/home-value-cascade.json'), 'utf8'));
  const geoid = '08045';
  const gap = gaps.find((row) => row.fips === geoid);
  assert.equal(cascade.counties[geoid].source, 'fhfa_county_hpi_anchor');
  assert.equal(cascade.counties[geoid].confidence, 'medium');
  assert.ok(cascade.counties[geoid].fhfa_hpi && cascade.counties[geoid].fhfa_hpi.source_level === 'fhfa_county_direct');
  const out = compute({
    geographyId: geoid,
    geographyName: 'Garfield County',
    geoLevel: 'county',
    countyChasEntry: countyChas[geoid],
    amiGapEntry: gap,
    homeValueEntry: cascade.counties[geoid],
    ownerValueSupplyProfile: JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/summary/08045.json'), 'utf8')).acsProfile,
  });
  assert.ok(out.affordabilityTest, 'F4 county-null benchmark is resolved for Garfield County');
  assert.ok(['market-attainable', 'stretch', 'priced-out'].includes(out.affordabilityTest.classification));
  assert.equal(out.affordabilityTest.medianHomeValue, cascade.counties[geoid].value);
  assert.ok(out.ownerValueSupply && out.ownerValueSupply.totalOwnerOccupiedUnits > 0, 'county ownership result carries B25075 supply context');
});

test('price-band screen binds AMI ceiling labels to maxAffordablePrice helper', () => {
  const countyChas = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/chas_affordability_gap.json'), 'utf8')).counties;
  const gaps = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/co_ami_gap_by_county.json'), 'utf8')).counties;
  const cascade = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/home-value-cascade.json'), 'utf8'));
  const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/summary/08045.json'), 'utf8')).acsProfile;
  const geoid = '08045';
  const gap = gaps.find((row) => row.fips === geoid);
  const out = compute({
    geographyId: geoid,
    geographyName: 'Garfield County',
    geoLevel: 'county',
    countyChasEntry: countyChas[geoid],
    amiGapEntry: gap,
    homeValueEntry: cascade.counties[geoid],
    ownerValueSupplyProfile: profile,
  });
  assert.ok(out.priceBandScreen, 'price-band screen is present');
  assert.equal(out.priceBandScreen.label, Ownership.PRICE_BAND_SCREEN_LABEL);
  assert.equal(out.priceBandScreen.noConversionMultiplierApplied, true, 'potential buyer pool applies no renter-to-buyer conversion multiplier');
  assert(out.priceBandScreen.rows.length >= 3, 'price-band rows are non-vacuous');
  out.priceBandScreen.rows.forEach((row) => {
    assert.equal(
      row.maxAffordablePrice,
      Ownership.maxAffordablePrice(gap.ami_4person, row.amiCeiling / 100),
      row.key + ' maxAffordablePrice follows its displayed AMI ceiling'
    );
  });
});

test('deep affordability recommendation requires rate, count, and total-household share', () => {
  const tinyBand = fixtureEntry({ renter: 9000, owner: 878, renterCb30: 500, renterCb50: 130, modRenter: 1800 });
  tinyBand.renter_hh_by_ami.lte30 = band(150, 140, 130);
  const out = compute({ placeChasEntry: tinyBand, amiGapEntry: amiGap, homeValueEntry: { value: 300000, source: 'test' } });
  assert.notEqual(out.tenureMixRecommendation, 'Deep affordability priority');
  const materialBand = fixtureEntry({ renter: 4000, owner: 1000, renterCb30: 500, renterCb50: 200, modRenter: 1800 });
  materialBand.renter_hh_by_ami.lte30 = band(300, 250, 200);
  const material = compute({ placeChasEntry: materialBand, amiGapEntry: amiGap, homeValueEntry: { value: 300000, source: 'test' } });
  assert.equal(material.tenureMixRecommendation, 'Deep affordability priority');
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
    'absorption ' + ('fore' + 'cast'),
    'homeownership ' + 'prediction',
    'fore' + 'cast',
    'time-' + 'phasing',
    'time ' + 'phasing',
    'capture ' + 'rate',
    'capture ' + 'rates',
  ].forEach(phrase => assert.equal(src.includes(phrase), false, phrase + ' should be absent'));
});

test('ownership screening tiers flip at the EPS benchmark threshold boundaries', () => {
  [
    ['rentalPressure', 'Low', 'Moderate',
      entryForRenterPressure(0.349, 0.149, 0.239),
      entryForRenterPressure(0.351, 0.151, 0.241)],
    ['rentalPressure', 'Moderate', 'High',
      entryForRenterPressure(0.419, 0.209, 0.279),
      entryForRenterPressure(0.421, 0.211, 0.281)],
    ['rentalPressure', 'High', 'Very High',
      entryForRenterPressure(0.469, 0.239, 0.319),
      entryForRenterPressure(0.471, 0.241, 0.321)],
    ['ownershipPressure', 'Low', 'Moderate',
      entryForOwnershipPressure(0.189, 0.079, 0.179),
      entryForOwnershipPressure(0.191, 0.081, 0.181)],
    ['ownershipPressure', 'Moderate', 'High',
      entryForOwnershipPressure(0.209, 0.089, 0.289),
      entryForOwnershipPressure(0.211, 0.091, 0.291)],
    ['ownershipPressure', 'High', 'Very High',
      entryForOwnershipPressure(0.249, 0.099, 0.359),
      entryForOwnershipPressure(0.251, 0.101, 0.361)],
    ['ownershipFit', 'Low', 'Moderate',
      entryForOwnershipFit(199, 0.299),
      entryForOwnershipFit(201, 0.301)],
    ['ownershipFit', 'Moderate', 'High',
      entryForOwnershipFit(499, 0.329),
      entryForOwnershipFit(501, 0.331)],
    ['ownershipFit', 'High', 'Very High',
      entryForOwnershipFit(1399, 0.359),
      entryForOwnershipFit(1401, 0.361)],
  ].forEach(([field, belowTier, aboveTier, belowEntry, aboveEntry]) => {
    const below = compute({ placeChasEntry: belowEntry, amiGapEntry: amiGap });
    const above = compute({ placeChasEntry: aboveEntry, amiGapEntry: amiGap });
    assert.equal(below[field].tier, belowTier, `${field} below-boundary fixture stays ${belowTier}`);
    assert.equal(above[field].tier, aboveTier, `${field} above-boundary fixture becomes ${aboveTier}`);
  });

  const belowFit = compute({
    placeChasEntry: entryForOwnershipPressure(0.251, 0.101, 0.361),
    amiGapEntry: amiGap,
  });
  assert.notEqual(belowFit.tenureMixRecommendation, 'Ownership-supportive strategy');

  const fitModerate = entryForOwnershipFit(201, 0.301);
  fitModerate.summary.owner_cb30_count = 251;
  fitModerate.summary.owner_cb30_share = 0.251;
  fitModerate.summary.owner_cb50_count = 101;
  fitModerate.summary.owner_cb50_share = 0.101;
  fitModerate.owner_hh_by_ami['51to80'] = band(600, 217, 20);
  fitModerate.owner_hh_by_ami['81to100'] = band(400, 144, 5);
  const aboveFit = compute({ placeChasEntry: fitModerate, amiGapEntry: amiGap });
  assert.equal(aboveFit.tenureMixRecommendation, 'Ownership-supportive strategy',
    'recommendation flips once the moderate-income renter base crosses the fit boundary');

  const benchmark = fs.readFileSync(path.join(ROOT, 'docs/audits/OWNERSHIP-BENCHMARK-EPS-PHASE2-2026-07.md'), 'utf8');
  const methodology = fs.readFileSync(path.join(ROOT, 'docs/methodology/AFFORDABLE-OWNERSHIP-METHODOLOGY.md'), 'utf8');
  assert.ok(benchmark.includes('EPS #243156'));
  assert.match(benchmark, /June 16,\s+2026/);
  assert.ok(benchmark.includes('The constants are NOT invalidated'));
  assert.match(benchmark, /keep them,\s+keep the screening\s+caveat/);
  assert.ok(benchmark.includes('Pitkin County'));
  assert.ok(benchmark.includes('Garfield County'));
  assert.ok(benchmark.includes('Parachute'));
  assert.match(benchmark, /F1[\s\S]*tenure mix is biased by tract apportionment/);
  assert.match(benchmark, /Before Tier 1 item 4[\s\S]*F1\/F2 tenure-mix fix/);
  assert.ok(methodology.includes('OWNERSHIP-BENCHMARK-EPS-PHASE2-2026-07.md'));
  assert.ok(methodology.includes('The benchmark did not invalidate the constants'));
});

test('renderer ownership lookups resolve phantom GEOIDs to canonical IDs', () => {
  const rendererSrc = fs.readFileSync(path.join(ROOT, 'js/hna/hna-renderers.js'), 'utf8');
  const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/place-phantom-aliases.json'), 'utf8')).aliases;
  const gaps = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/co_ami_gap_by_place.json'), 'utf8')).places;
  const homeValues = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/home-value-cascade.json'), 'utf8')).places;
  const phantom = '0855745';
  const canonical = aliases[phantom];
  assert.equal(canonical, '0862000');
  assert.equal(Boolean(gaps[phantom]), false);
  assert.ok(gaps[canonical], 'canonical Pueblo AMI-gap record exists');
  assert.equal(Boolean(homeValues[phantom]), false);
  assert.ok(homeValues[canonical], 'canonical Pueblo home-value record exists');
  assert.ok(rendererSrc.includes('function _ownCanonicalGeoid'));
  assert.ok(rendererSrc.includes('_ownFindPlaceAmiGap(stateRef.acsAmiGapPlaceData, canonicalGeoid)'));
  assert.ok(rendererSrc.includes('homeValueData.places[canonical]'));
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

test('deep affordability recommendation stays below 10 percent of real place records', () => {
  const placeChas = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/place-chas.json'), 'utf8'));
  let total = 0;
  let deep = 0;
  for (const [geoid, entry] of Object.entries(placeChas.places || {})) {
    const out = compute({
      geographyId: geoid,
      geographyName: entry.name,
      geoLevel: 'place',
      placeChasEntry: entry,
      amiGapEntry: amiGap,
      homeValueEntry: { value: 300000, source: 'test' },
    });
    total += 1;
    if (out.tenureMixRecommendation === 'Deep affordability priority') deep += 1;
  }
  assert.ok(total > 0);
  assert.ok(deep / total < 0.10, `deep affordability count ${deep}/${total} should be under 10%`);
});

if (failed) {
  console.error(`\nAffordable Ownership Need: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`\nAffordable Ownership Need: ${passed} passed, 0 failed`);
