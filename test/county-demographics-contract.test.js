#!/usr/bin/env node
/**
 * county-demographics-contract — data/co-county-demographics.json must carry
 * the fields its consumers actually read.
 *
 * scripts/fetch-county-demographics.js had been a no-op for months: keyless
 * Census requests answer 302, the script exited 0 anyway, and the workflow's
 * validator only checked that the file was SHAPED like an object. Giving it a
 * key woke the live path up, and the live path emits DIFFERENT field names than
 * the stale committed file everyone had been reading. One green workflow run
 * renamed every field and blanked the county KPIs on market-intelligence.html.
 *
 * This asserts the contract from the consumer side, so the next schema change
 * fails here instead of in a chart.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'data/co-county-demographics.json';

// field -> the consumers that read it, so a failure names who breaks
const CONTRACT = {
  median_gross_rent:        ['js/market-intelligence.js'],
  median_household_income:  ['js/market-intelligence.js', 'js/housing-need-projector.js'],
  households:               ['js/market-intelligence.js', 'js/housing-need-projector.js', 'housing-needs-assessment.html'],
  cost_burdened_pct:        ['js/market-intelligence.js', 'js/housing-need-projector.js'],
  severely_burdened_pct:    ['js/market-intelligence.js', 'js/housing-need-projector.js'],
  total_housing_units:      ['js/market-intelligence.js'],
  overcrowded:              ['js/market-intelligence.js'],
};

let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };

console.log('\ncounty-demographics contract');
const doc = JSON.parse(fs.readFileSync(path.join(ROOT, FILE), 'utf8'));
const counties = doc.counties || {};
const names = Object.keys(counties);
if (names.length < 60) fail(`${FILE} has ${names.length} counties; Colorado has 64 (+1 statewide row)`);

for (const [field, readers] of Object.entries(CONTRACT)) {
  const present = names.filter((n) => counties[n] && counties[n][field] != null).length;
  if (present === 0) {
    fail(`every county is missing "${field}" — read by ${readers.join(', ')}`);
  } else if (present < names.length * 0.5) {
    fail(`"${field}" is set on only ${present}/${names.length} counties — read by ${readers.join(', ')}`);
  }
}

// A rate that is really a different quantity is worse than a missing one: the
// chart renders and lies. Overcrowding above ~10% statewide is not credible.
const rates = names.map((n) => counties[n] && counties[n].overcrowding_rate).filter((v) => typeof v === 'number');
const overMax = rates.length ? Math.max(...rates) : null;
if (overMax !== null && overMax > 0.15) {
  const worst = names.find((n) => counties[n] && counties[n].overcrowding_rate === overMax);
  fail(`overcrowding_rate peaks at ${(overMax * 100).toFixed(1)}% (${worst}). Above ~15% means the numerator `
     + `is not an overcrowding count — B25014_008E is "Renter occupied: total", not a bucket.`);
}

if (failures) { console.error(`\ncounty-demographics-contract: FAIL (${failures})`); process.exit(1); }
console.log(`  ✓ ${Object.keys(CONTRACT).length} consumer-read fields present across ${names.length} counties`);
console.log(`  ✓ overcrowding_rate peaks at ${(overMax * 100).toFixed(1)}% — plausible`);
console.log('county-demographics-contract: PASS');
