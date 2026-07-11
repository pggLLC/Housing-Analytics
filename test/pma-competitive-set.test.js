'use strict';
/**
 * test/pma-competitive-set.test.js
 *
 * Unit tests for js/pma-competitive-set.js.
 *
 * Explicit goals:
 *   1. Regression-guard the #629 NHPD field-mapping fix (shipped in #634).
 *      Before the fix, NHPD entries surfaced with name="Unknown Property",
 *      units=0, and subsidyExpiryYear=null because the _prop* helpers only
 *      recognized LIHTC field names (PROJECT_NAME, LI_UNITS, expiryYear).
 *   2. Exercise LIHTC-side field mapping so nothing regresses there.
 *   3. Cover the buffer-radius filter, subsidy-expiry date-string parsing,
 *      at-risk flagging, and the absorption-risk calculation.
 *
 * Run: node test/pma-competitive-set.test.js
 * Zero DOM dependencies — the module exports a pure-function CommonJS
 * surface at the bottom of the file, so we can require it directly.
 */

const assert = require('node:assert/strict');

// CommonJS export surface
const PMACS = require('../js/pma-competitive-set.js');

/* ── Fixtures ───────────────────────────────────────────────────────── */

// Denver City Hall as site center
const SITE_LAT = 39.7392;
const SITE_LON = -104.9903;

// NHPD features (the real data/market/nhpd_co.geojson shape — snake_case)
const NHPD_FIXTURES = [
  {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-104.9903, 39.7392] },  // at site
    properties: {
      nhpd_id: 'NHPD-1',
      property_name: 'Mariposa Apartments',
      total_units: 210,
      assisted_units: 210,
      subsidy_type: 'HUD Section 8 PBRA',
      subsidy_expiration: '2027-09-30',
    },
  },
  {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-104.95, 39.77] },  // ~3 mi NE
    properties: {
      nhpd_id: 'NHPD-2',
      property_name: 'Aurora Gateway Residences',
      total_units: 200,
      assisted_units: 180,
      subsidy_type: 'HUD Section 8 PBRA',
      subsidy_expiration: '2028-12-31',
    },
  },
  {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-104.20, 39.74] },  // ~40 mi east — out of buffer
    properties: {
      nhpd_id: 'NHPD-3',
      property_name: 'Far Field Lofts',
      total_units: 50,
      assisted_units: 40,
      subsidy_type: 'LIHTC',
      subsidy_expiration: '2035-01-01',
    },
  },
  {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-104.9903, 39.7392] },
    properties: {
      // A property with expiry > threshold — should NOT be at-risk
      nhpd_id: 'NHPD-4',
      property_name: 'Long Horizon Houses',
      total_units: 100,
      assisted_units: 100,
      subsidy_type: 'HUD Section 8 PBRA',
      subsidy_expiration: '2050-06-30',
    },
  },
];

// LIHTC features (HUD-style field names — UPPER_SNAKE)
const LIHTC_FIXTURES = [
  {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-104.99, 39.74] },
    properties: {
      HUDID: 'HUD-LIHTC-1',
      PROJECT_NAME: 'FORUM APTS',
      LI_UNITS: 100,
      PROGRAM: 'LIHTC',
      YR_PIS: 1996,
      YR_ALLOC: 1995,
      CREDIT: '3',
    },
  },
];

/* ── Test harness ───────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
    failed++;
  }
}

function group(name, fn) {
  console.log(`\n${name}`);
  fn();
}

/* ── Tests ──────────────────────────────────────────────────────────── */

console.log('PMACompetitiveSet — regression tests for #629 / #634');

group('1. NHPD field mapping (regression for #629)', () => {
  const set = PMACS.buildCompetitiveSet(
    [],               // no LIHTC — isolate NHPD path
    NHPD_FIXTURES,
    SITE_LAT,
    SITE_LON,
    5
  );

  test('NHPD-only entries appear in the competitive set', () => {
    assert.ok(set.length > 0, 'expected at least one NHPD entry');
  });

  test('property_name (snake_case) maps to name', () => {
    const mariposa = set.find(p => p.id?.includes('NHPD') || p.name === 'Mariposa Apartments');
    assert.ok(mariposa, 'Mariposa not in set');
    assert.equal(mariposa.name, 'Mariposa Apartments');
  });

  test('name is NOT "Unknown Property" (the old bug)', () => {
    const unknowns = set.filter(p => p.name === 'Unknown Property');
    assert.equal(unknowns.length, 0,
      'Any "Unknown Property" entry means _propName is not reading property_name');
  });

  test('total_units (snake_case) maps to units', () => {
    const mariposa = set.find(p => p.name === 'Mariposa Apartments');
    assert.equal(mariposa.units, 210);
  });

  test('units is NOT 0 for NHPD entries with real unit counts', () => {
    const nhpdEntries = set.filter(p => p.hasNhpd);
    const zeroes = nhpdEntries.filter(p => p.units === 0);
    assert.equal(zeroes.length, 0,
      `found ${zeroes.length} NHPD entries with units=0 — _propUnits not reading total_units/assisted_units`);
  });

  test('subsidy_type maps to programType (not defaulted to "Section 8")', () => {
    const mariposa = set.find(p => p.name === 'Mariposa Apartments');
    assert.equal(mariposa.programType, 'HUD Section 8 PBRA');
  });

  test('subsidy_expiration date string parses into subsidyExpiryYear', () => {
    const mariposa = set.find(p => p.name === 'Mariposa Apartments');
    assert.equal(mariposa.subsidyExpiryYear, 2027);
  });
});

group('2. Buffer-radius filter', () => {
  const set = PMACS.buildCompetitiveSet([], NHPD_FIXTURES, SITE_LAT, SITE_LON, 5);

  test('properties inside the radius are included', () => {
    const names = set.map(p => p.name);
    assert.ok(names.includes('Mariposa Apartments'), 'Mariposa (0 mi) missing');
  });

  test('properties outside the radius are excluded', () => {
    const names = set.map(p => p.name);
    assert.ok(!names.includes('Far Field Lofts'),
      'Far Field (~40 mi) should be out of a 5mi buffer');
  });

  test('distanceMiles is populated and rounded to 1 decimal', () => {
    const p = set.find(x => x.name === 'Mariposa Apartments');
    assert.equal(p.distanceMiles, 0);
    const q = set.find(x => x.name === 'Aurora Gateway Residences');
    assert.ok(q.distanceMiles > 0 && q.distanceMiles < 5);
    assert.equal(Math.round(q.distanceMiles * 10), q.distanceMiles * 10,
      'distance should be rounded to 1 decimal');
  });
});

group('3. flagSubsidyExpiryRisk (date parsing + threshold)', () => {
  const atRisk = PMACS.flagSubsidyExpiryRisk(NHPD_FIXTURES);

  test('returns a non-empty list when expirations exist within the default threshold', () => {
    assert.ok(atRisk.length > 0,
      'expected at-risk entries from the fixture; did subsidy_expiration parsing break?');
  });

  test('Mariposa (expires 2027) is flagged at-risk', () => {
    const mariposa = atRisk.find(p => p.property === 'Mariposa Apartments');
    assert.ok(mariposa, 'Mariposa not in at-risk list');
    assert.equal(mariposa.expiryYear, 2027);
  });

  test('Long Horizon (expires 2050) is NOT flagged at-risk under default 5-year threshold', () => {
    const longHorizon = atRisk.find(p => p.property === 'Long Horizon Houses');
    assert.equal(longHorizon, undefined,
      'Long Horizon should be filtered out — threshold is 5 years, expiration is 2050');
  });

  test('atRiskUnits comes from total_units / assisted_units, not 0', () => {
    const mariposa = atRisk.find(p => p.property === 'Mariposa Apartments');
    assert.equal(mariposa.atRiskUnits, 210);
  });

  test('yearsRemaining is computed relative to current year', () => {
    const mariposa = atRisk.find(p => p.property === 'Mariposa Apartments');
    const currentYear = new Date().getFullYear();
    assert.equal(mariposa.yearsRemaining, 2027 - currentYear);
  });

  test('output is sorted by expiryYear ascending', () => {
    for (let i = 1; i < atRisk.length; i++) {
      assert.ok(atRisk[i].expiryYear >= atRisk[i - 1].expiryYear,
        `at-risk list should be sorted; found ${atRisk[i - 1].expiryYear} before ${atRisk[i].expiryYear}`);
    }
  });
});

group('4. LIHTC-side field mapping (regression guard)', () => {
  const set = PMACS.buildCompetitiveSet(LIHTC_FIXTURES, [], SITE_LAT, SITE_LON, 5);

  test('LIHTC entries keep PROJECT_NAME mapping', () => {
    const forum = set.find(p => p.name === 'FORUM APTS');
    assert.ok(forum, 'FORUM APTS missing');
  });

  test('LIHTC entries keep LI_UNITS mapping', () => {
    const forum = set.find(p => p.name === 'FORUM APTS');
    assert.equal(forum.units, 100);
  });

  test('LIHTC programType honored', () => {
    const forum = set.find(p => p.name === 'FORUM APTS');
    assert.equal(forum.programType, 'LIHTC');
  });

  test('hasNhpd is false on LIHTC-only entries', () => {
    const forum = set.find(p => p.name === 'FORUM APTS');
    assert.equal(forum.hasNhpd, false);
  });
});

group('5. calculateAbsorptionRisk', () => {
  const set = PMACS.buildCompetitiveSet(LIHTC_FIXTURES, NHPD_FIXTURES, SITE_LAT, SITE_LON, 5);

  test('returns an object with risk + captureRate keys', () => {
    const r = PMACS.calculateAbsorptionRisk(set, 100);
    assert.ok(r);
    assert.ok('risk' in r);
    assert.ok('captureRate' in r);
  });

  test('totalCompetitiveUnits is sum of units across the set', () => {
    const r = PMACS.calculateAbsorptionRisk(set, 100);
    const expected = set.reduce((s, p) => s + (p.units || 0), 0);
    assert.equal(r.totalCompetitiveUnits, expected);
  });

  test('risk value is one of low/moderate/high (string)', () => {
    const r = PMACS.calculateAbsorptionRisk(set, 100);
    assert.ok(['low', 'moderate', 'high'].includes(r.risk),
      `unexpected risk value: ${r.risk}`);
  });

  // Regression guard for #1150: the risk-tier assertion above previously
  // checked ['low', 'medium', 'high'] against code that actually returns
  // 'moderate' for the middle tier -- a typo that passed for years only
  // because no fixture here ever landed in that branch (this file's main
  // `set` always resolves to 'high', captureRate 0.14). This synthetic
  // set is sized so captureRate falls at 100/1300 ~= 0.077, inside
  // [SATURATION_LIMIT * 0.5, SATURATION_LIMIT) = [0.05, 0.10), to
  // actually exercise the 'moderate' branch instead of just not-yet-
  // having-broken on it.
  test('risk is moderate when captureRate falls inside the middle band', () => {
    const moderateSet = [{ units: 1200 }];
    const r = PMACS.calculateAbsorptionRisk(moderateSet, 100);
    assert.equal(r.captureRate, 0.08);
    assert.equal(r.risk, 'moderate');
  });

  // Label guard for #1148: calculateAbsorptionRisk()'s output is a
  // supply-÷-supply ratio and must be rendered as "competitive supply
  // share", never "capture rate" — that term is reserved for the
  // demand-pool metric (units ÷ income-qualified renter HH) documented in
  // docs/PMA_SCORING.md. Scope the greps to the absorption block only:
  // "capture rate" legitimately appears elsewhere in both files for the
  // real metric.
  test('absorption-risk UI surfaces use "competitive supply share", not "capture rate"', () => {
    const fs = require('node:fs');
    const path = require('node:path');

    const ui = fs.readFileSync(
      path.resolve(__dirname, '..', 'js', 'pma-ui-controller.js'), 'utf8');
    const uiStart = ui.indexOf('scoreRun.absorptionRisk');
    const uiEnd = ui.indexOf('pmaIncentiveBadges', uiStart);
    assert.ok(uiStart !== -1 && uiEnd > uiStart, 'absorption render block found in pma-ui-controller.js');
    const uiBlock = ui.slice(uiStart, uiEnd);
    assert.ok(!/capture rate/i.test(uiBlock),
      'absorption block must not label its value "capture rate"');
    assert.ok(/competitive supply share/i.test(uiBlock),
      'absorption block labels its value "competitive supply share"');

    const html = fs.readFileSync(
      path.resolve(__dirname, '..', 'market-analysis.html'), 'utf8');
    const cardStart = html.indexOf('pmaAbsorptionRiskWrap');
    const cardEnd = html.indexOf('pmaAbsorptionRiskBody', cardStart);
    assert.ok(cardStart !== -1 && cardEnd > cardStart, 'absorption card found in market-analysis.html');
    const cardBlock = html.slice(cardStart, cardEnd);
    assert.ok(!/capture/i.test(cardBlock),
      'absorption card heading must not say "capture"');
    assert.ok(/Competitive Supply Share/.test(cardBlock),
      'absorption card heading uses "Competitive Supply Share"');
  });
});

/* ── Summary ───────────────────────────────────────────────────────── */

console.log('\n=============================================');
console.log(`PMACompetitiveSet: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
