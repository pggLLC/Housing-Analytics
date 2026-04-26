'use strict';
/**
 * test/dc-peer-deals.test.js
 *
 * Unit tests for the pure `findPeerDeals` function exposed by
 * js/deal-calculator.js. Validates the filter + sort logic that
 * powers the new Peer Deals panel.
 *
 * Run: node test/dc-peer-deals.test.js
 */

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body><div id="dealCalcMount"></div></body>', {
  url: 'http://localhost/'
});
global.document = dom.window.document;
global.window   = dom.window;
global.HTMLElement = dom.window.HTMLElement;

require('../js/deal-calculator.js');
const dc = window.__DealCalc;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}
function test(name, fn) {
  console.log('\n[test]', name);
  try { fn(); } catch (e) { console.error('  ❌ FAIL: threw —', e.message); failed++; }
}

// ── Fixtures: shaped like real HUD LIHTC GeoJSON features ──
function feat(props) {
  return { properties: props };
}
const ADAMS_2023 = feat({
  PROJECT_NAME: 'Northpoint Apts', CITY: 'Westminster', CNTY_FIPS: '08001',
  CNTY_NAME: 'Adams', N_UNITS: 80, LI_UNITS: 80, CREDIT: '9%',
  YR_PIS: '2023', YR_ALLOC: '2021', QCT: '1', DDA: '0', NON_PROF: '1'
});
const ADAMS_2022_4PCT = feat({
  PROJECT_NAME: 'Riverside Place', CITY: 'Commerce City', CNTY_FIPS: '08001',
  CNTY_NAME: 'Adams', N_UNITS: 120, LI_UNITS: 120, CREDIT: '4%',
  YR_PIS: '2022', YR_ALLOC: '2020', QCT: '0', DDA: '1', NON_PROF: '0'
});
const ADAMS_2018 = feat({
  PROJECT_NAME: 'Old Project', CITY: 'Brighton', CNTY_FIPS: '08001',
  CNTY_NAME: 'Adams', N_UNITS: 60, LI_UNITS: 60, CREDIT: '9%',
  YR_PIS: '2018', YR_ALLOC: '2016', QCT: '0', DDA: '0', NON_PROF: '0'
});
const ADAMS_2020_SMALL = feat({
  PROJECT_NAME: 'Small One', CITY: 'Federal Heights', CNTY_FIPS: '08001',
  CNTY_NAME: 'Adams', N_UNITS: 30, LI_UNITS: 30, CREDIT: '9%',
  YR_PIS: '2020', YR_ALLOC: '2018', QCT: '0', DDA: '0', NON_PROF: '0'
});
const DENVER_2024 = feat({
  PROJECT_NAME: 'Mile High Tower', CITY: 'Denver', CNTY_FIPS: '08031',
  CNTY_NAME: 'Denver', N_UNITS: 200, LI_UNITS: 200, CREDIT: '9%',
  YR_PIS: '2024', YR_ALLOC: '2022', QCT: '1', DDA: '1', NON_PROF: '0'
});
const ARAPAHOE_2023 = feat({
  PROJECT_NAME: 'Aurora Heights', CITY: 'Aurora', CNTY_FIPS: '08005',
  CNTY_NAME: 'Arapahoe', N_UNITS: 90, LI_UNITS: 90, CREDIT: '9%',
  YR_PIS: '2023', YR_ALLOC: '2021', QCT: '0', DDA: '0', NON_PROF: '1'
});

const ALL = [ADAMS_2023, ADAMS_2022_4PCT, ADAMS_2018, ADAMS_2020_SMALL, DENVER_2024, ARAPAHOE_2023];

test('API exposed', function () {
  assert(typeof dc.findPeerDeals === 'function', 'findPeerDeals exported');
});

test('null / empty inputs → empty array', function () {
  assert(Array.isArray(dc.findPeerDeals(null)),                            'null → array');
  assert(dc.findPeerDeals(null).length === 0,                              'null → empty');
  assert(dc.findPeerDeals({}).length === 0,                                '{} → empty');
  assert(dc.findPeerDeals({ countyFips: '08001' }).length === 0,           'no features → empty');
  assert(dc.findPeerDeals({ features: ALL }).length === 0,                 'no county → empty');
});

test('filters by county FIPS', function () {
  const peers = dc.findPeerDeals({ features: ALL, countyFips: '08001', creditType: '9%' });
  assert(peers.every(p => p.countyFips === '08001'), 'all peers in Adams County');
  assert(peers.length === 3,                          '3 Adams 9% projects (Northpoint, Old Project, Small One)');
  assert(peers.find(p => p.name === 'Mile High Tower') === undefined, 'Denver project excluded');
});

test('filters by credit type', function () {
  const peers9 = dc.findPeerDeals({ features: ALL, countyFips: '08001', creditType: '9%' });
  const peers4 = dc.findPeerDeals({ features: ALL, countyFips: '08001', creditType: '4%' });
  assert(peers9.every(p => p.creditType === '9%'), 'all 9% when filtered to 9%');
  assert(peers4.every(p => p.creditType === '4%'), 'all 4% when filtered to 4%');
  assert(peers4.length === 1,                       'one 4% Adams project');
});

test('credit type normalization handles "9%", "9", "9 %"', function () {
  const peers1 = dc.findPeerDeals({ features: ALL, countyFips: '08001', creditType: '9%' });
  const peers2 = dc.findPeerDeals({ features: ALL, countyFips: '08001', creditType: '9' });
  const peers3 = dc.findPeerDeals({ features: ALL, countyFips: '08001', creditType: ' 9 % ' });
  assert(peers1.length === peers2.length && peers2.length === peers3.length,
    'all three normalization variants produce same count');
});

test('FIPS normalization pads short codes', function () {
  // Synthetic feature with unpadded FIPS
  const feat = { properties: { CNTY_FIPS: '8001', PROJECT_NAME: 'Padded', N_UNITS: 50, CREDIT: '9%', YR_PIS: '2020' } };
  const peers = dc.findPeerDeals({ features: [feat], countyFips: '8001', creditType: '9%' });
  assert(peers.length === 1,                            'unpadded FIPS still matches');
  assert(peers[0].countyFips === '08001',               'output FIPS is padded to 5 digits');
});

test('sorts by recency (most recent year_PIS first)', function () {
  const peers = dc.findPeerDeals({ features: ALL, countyFips: '08001', creditType: '9%' });
  const years = peers.map(p => p.yearPis);
  assert(years[0] === 2023,                                  'first peer is the 2023 project');
  assert(years[years.length - 1] === 2018,                   'last peer is the 2018 project');
  // Sorted descending
  for (let i = 1; i < years.length; i++) {
    assert(years[i - 1] >= years[i], 'years monotonically decreasing at index ' + i);
  }
});

test('size proximity tiebreaks within same year', function () {
  // Add a second 2023 project of differing size to verify proximity tiebreak
  const ADAMS_2023_BIG = feat({
    PROJECT_NAME: 'Big 2023', CNTY_FIPS: '08001', N_UNITS: 200, CREDIT: '9%',
    YR_PIS: '2023', YR_ALLOC: '2021', QCT: '0', DDA: '0', NON_PROF: '0'
  });
  // Northpoint has 80 units; Big 2023 has 200. Proposed = 75 → Northpoint should rank first
  const peers = dc.findPeerDeals({
    features: ALL.concat([ADAMS_2023_BIG]),
    countyFips: '08001',
    creditType: '9%',
    proposedUnits: 75
  });
  assert(peers[0].name === 'Northpoint Apts',  'Northpoint (80 units) ranks ahead of Big 2023 (200)');
});

test('limit caps the result count', function () {
  const peers = dc.findPeerDeals({
    features: ALL,
    countyFips: '08001',
    creditType: '9%',
    limit: 2
  });
  assert(peers.length === 2, 'limit=2 returns 2');
});

test('default limit is 5', function () {
  // Synthesize 8 Adams 9% projects of varying year
  const synth = [];
  for (let i = 0; i < 8; i++) {
    synth.push(feat({
      PROJECT_NAME: 'Synth-' + i, CNTY_FIPS: '08001', N_UNITS: 50, CREDIT: '9%',
      YR_PIS: String(2024 - i), YR_ALLOC: String(2022 - i)
    }));
  }
  const peers = dc.findPeerDeals({ features: synth, countyFips: '08001', creditType: '9%' });
  assert(peers.length === 5, 'default limit returns 5');
});

test('flag normalization: QCT/DDA/NonProf bools', function () {
  const peers = dc.findPeerDeals({ features: [ADAMS_2023], countyFips: '08001', creditType: '9%' });
  assert(peers[0].isQct === true,     'QCT="1" → isQct: true');
  assert(peers[0].isDda === false,    'DDA="0" → isDda: false');
  assert(peers[0].isNonProf === true, 'NON_PROF="1" → isNonProf: true');
});

test('output shape is consistent — never returns synthesized data', function () {
  const peers = dc.findPeerDeals({ features: ALL, countyFips: '08001', creditType: '9%' });
  peers.forEach(function (p) {
    assert(typeof p.name === 'string',         'name is string');
    assert(typeof p.units === 'number',        'units is number');
    assert(typeof p.creditType === 'string',   'creditType is string');
    assert(p.yearPis === null || typeof p.yearPis === 'number', 'yearPis is number or null');
  });
});

test('no peers in unfamiliar county → empty', function () {
  // Pueblo (08101) — none of our fixtures live there
  const peers = dc.findPeerDeals({ features: ALL, countyFips: '08101', creditType: '9%' });
  assert(peers.length === 0, 'no Pueblo projects → empty');
});

console.log('\n' + '='.repeat(50));
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) process.exitCode = 1;
