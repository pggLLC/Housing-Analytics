#!/usr/bin/env node
/**
 * scripts/validate-hna-lehd.js
 *
 * Validates all JSON files in data/hna/lehd/ to ensure:
 *   1. Each file contains valid JSON.
 *   2. Each file has the required base fields (countyFips, updated).
 *   3. WAC-enriched fields are present (annualEmployment, annualWages, industries).
 *   4. Warns (and exits 1) if more than half the files are missing WAC fields,
 *      indicating the data build workflow has not been run yet.
 *
 * Usage:
 *   node scripts/validate-hna-lehd.js
 *
 * Exit code 0 = all files valid and fully enriched.
 * Exit code 1 = invalid JSON, missing base fields, or majority of files lack WAC fields.
 *
 * To regenerate enriched files run:
 *   python3 scripts/hna/build_hna_data.py
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const LEHD_DIR  = path.join(ROOT, 'data', 'hna', 'lehd');
const WAC_FIELDS = ['annualEmployment', 'annualWages', 'industries'];

let passed  = 0;
let failed  = 0;
let warned  = 0;
let wacMissingCount = 0;
let totalFiles = 0;

if (!fs.existsSync(LEHD_DIR)) {
  console.error('ERROR: data/hna/lehd/ directory not found. Run: python3 scripts/hna/build_hna_data.py');
  process.exit(1);
}

const files = fs.readdirSync(LEHD_DIR).filter(function(f) { return f.endsWith('.json'); });

if (files.length === 0) {
  console.error('ERROR: No JSON files found in data/hna/lehd/. Run: python3 scripts/hna/build_hna_data.py');
  process.exit(1);
}

console.log('Validating ' + files.length + ' LEHD county files in ' + LEHD_DIR + ' …\n');
totalFiles = files.length;

for (const file of files) {
  const abs = path.join(LEHD_DIR, file);

  // 1. Read file
  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8').trim();
  } catch (err) {
    console.error('  ERROR Cannot read ' + file + ': ' + err.message);
    failed++;
    continue;
  }

  if (!raw) {
    console.error('  ERROR Empty file: ' + file);
    failed++;
    continue;
  }

  // 2. Parse JSON
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.error('  ERROR Invalid JSON in ' + file + ': ' + err.message);
    failed++;
    continue;
  }

  // 3. Required base fields
  const missingBase = [];
  if (!json.countyFips) missingBase.push('countyFips');
  if (!json.updated)    missingBase.push('updated');

  if (missingBase.length > 0) {
    console.error('  ERROR ' + file + ' missing required base fields: ' + missingBase.join(', '));
    failed++;
    continue;
  }

  // 4. Validate FIPS is 5-digit string (Rule 1)
  if (typeof json.countyFips !== 'string' || json.countyFips.length !== 5) {
    console.error('  ERROR ' + file + ' countyFips must be a 5-digit string; got: ' + JSON.stringify(json.countyFips));
    failed++;
    continue;
  }

  // 5. WAC-enriched fields check
  const missingWac = WAC_FIELDS.filter(function(f) { return !json[f]; });
  if (missingWac.length > 0) {
    console.warn('  WARN ' + file + ' missing WAC-enriched fields: ' + missingWac.join(', '));
    warned++;
    wacMissingCount++;
  } else {
    // Spot-check: annualEmployment must be a non-empty object
    var empYears = Object.keys(json.annualEmployment || {});
    var hasEmptyFields = empYears.length === 0 || !Array.isArray(json.industries) || json.industries.length === 0;
    if (hasEmptyFields) {
      console.warn('  WARN ' + file + ' WAC fields present but empty (annualEmployment years: ' + empYears.length + ', industries: ' + (Array.isArray(json.industries) ? json.industries.length : 0) + ')');
      warned++;
      wacMissingCount++;
    } else {
      console.log('  OK  ' + file + ' (WAC years: ' + empYears.join(', ') + '; industries: ' + json.industries.length + ')');
      passed++;
    }
  }
}

console.log('\n── Results ──────────────────────────────────────────');
console.log('  Files checked:   ' + totalFiles);
console.log('  Fully enriched:  ' + passed);
console.log('  WAC fields warn: ' + wacMissingCount);
console.log('  Errors (fatal):  ' + failed);

if (failed > 0) {
  console.error('\nFAIL ' + failed + ' file(s) have invalid JSON or missing base fields.');
  process.exit(1);
}

// Warn loudly if more than half the files are missing WAC enrichment
if (wacMissingCount > totalFiles / 2) {
  console.warn(
    '\nWARN ' + wacMissingCount + ' of ' + totalFiles + ' LEHD county files are missing WAC-enriched fields\n' +
    '     (annualEmployment, annualWages, industries).\n' +
    '     Trend charts in the HNA Economic Indicators section will show fallback messages.\n' +
    '     To populate, run:\n' +
    '       python3 scripts/hna/build_hna_data.py'
  );
  process.exit(1);
}

if (wacMissingCount > 0) {
  console.warn('\nWARN ' + wacMissingCount + ' file(s) lack WAC-enriched fields. Run: python3 scripts/hna/build_hna_data.py');
} else {
  console.log('\nPASS All ' + passed + ' LEHD county files are fully WAC-enriched.');
}
