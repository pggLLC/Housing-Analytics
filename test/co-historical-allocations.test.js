// test/co-historical-allocations.test.js
//
// Validates the structure and integrity of data/co-historical-allocations.json.
//
// Checks:
//   1. File exists and is valid JSON.
//   2. Top-level sentinel keys (updated, generated, state, fips) are present.
//   3. `allocations` array has correct year range (1988–2024) with all expected years.
//   4. Every entry has the required base fields with correct types.
//   5. HUD-derived entries (1988–2019) have non-zero projects and liUnits.
//   6. Allocation authority entries (2010–2024) have required authority fields.
//   7. liUnits <= totalUnits for every entry that has both.
//   8. IRS per-capita is present and positive for every entry.
//   9. `methodologyDoc` points to an existing file.
//  10. data-source-inventory.js registers the dataset.
//
// Usage:
//   node test/co-historical-allocations.test.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function test(name, fn) {
  console.log(`\n[test] ${name}`);
  try {
    fn();
  } catch (err) {
    console.error(`  ❌ FAIL: threw unexpected error — ${err.message}`);
    failed++;
  }
}

// ── Load dataset ─────────────────────────────────────────────────────────────

const DATA_PATH = path.join(ROOT, 'data', 'co-historical-allocations.json');
let dataset;

test('file exists and is valid JSON', () => {
  assert(fs.existsSync(DATA_PATH), 'data/co-historical-allocations.json exists');
  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  dataset = JSON.parse(raw);
  assert(typeof dataset === 'object' && dataset !== null, 'parsed as a non-null object');
});

// ── Sentinel keys (Rule 18) ──────────────────────────────────────────────────

test('top-level sentinel keys are present', () => {
  assert(typeof dataset.updated === 'string' && dataset.updated.length > 0,
    'updated is a non-empty string');
  assert(typeof dataset.generated === 'string' && dataset.generated.length > 0,
    'generated is a non-empty string');
  assert(dataset.state === 'Colorado', 'state is "Colorado"');
  assert(dataset.fips === '08', 'fips is "08"');
  assert(Array.isArray(dataset.allocations), 'allocations is an array');
  assert(typeof dataset.methodologyDoc === 'string', 'methodologyDoc is present');
});

// ── Year coverage ─────────────────────────────────────────────────────────────

test('allocations span 1988–2024 with no missing years', () => {
  const allocs = dataset.allocations;
  assert(allocs.length >= 37, `allocations has at least 37 entries (got ${allocs.length})`);

  const years = allocs.map(a => a.year);
  assert(Math.min(...years) === 1988, `first year is 1988 (got ${Math.min(...years)})`);
  assert(Math.max(...years) === 2024, `last year is 2024 (got ${Math.max(...years)})`);

  // Check no gaps between 1988 and 2024
  const yearSet = new Set(years);
  let gaps = 0;
  for (let y = 1988; y <= 2024; y++) {
    if (!yearSet.has(y)) {
      console.error(`    missing year: ${y}`);
      gaps++;
    }
  }
  assert(gaps === 0, `no missing years between 1988 and 2024 (${gaps} gaps found)`);

  // firstYear / lastYear metadata
  assert(dataset.firstYear === 1988, 'firstYear metadata is 1988');
  assert(dataset.lastYear === 2024, 'lastYear metadata is 2024');
});

// ── Required fields per entry ─────────────────────────────────────────────────

test('every allocation entry has required base fields with correct types', () => {
  const required = ['year', 'projects', 'liUnits', 'totalUnits',
    'credit9pct', 'credit4pct', 'hudDataStatus'];
  let failures = 0;
  for (const entry of dataset.allocations) {
    for (const field of required) {
      if (entry[field] === undefined || entry[field] === null) {
        console.error(`    year ${entry.year}: missing field "${field}"`);
        failures++;
      }
    }
    if (typeof entry.year !== 'number') {
      console.error(`    entry with year="${entry.year}": year is not a number`);
      failures++;
    }
    if (!['complete', 'partial', 'incomplete'].includes(entry.hudDataStatus)) {
      console.error(`    year ${entry.year}: invalid hudDataStatus "${entry.hudDataStatus}"`);
      failures++;
    }
  }
  assert(failures === 0, `all entries have required fields (${failures} field violations)`);
});

// ── Unit integrity ────────────────────────────────────────────────────────────

test('liUnits <= totalUnits for every entry', () => {
  let violations = 0;
  for (const entry of dataset.allocations) {
    if (entry.liUnits > entry.totalUnits) {
      console.error(`    year ${entry.year}: liUnits (${entry.liUnits}) > totalUnits (${entry.totalUnits})`);
      violations++;
    }
  }
  assert(violations === 0, `liUnits <= totalUnits for all entries (${violations} violations)`);
});

test('liUnits and projects are non-negative integers', () => {
  let violations = 0;
  for (const entry of dataset.allocations) {
    if (!Number.isInteger(entry.liUnits) || entry.liUnits < 0) {
      console.error(`    year ${entry.year}: liUnits is not a non-negative integer`);
      violations++;
    }
    if (!Number.isInteger(entry.projects) || entry.projects < 0) {
      console.error(`    year ${entry.year}: projects is not a non-negative integer`);
      violations++;
    }
  }
  assert(violations === 0, `liUnits and projects are non-negative integers (${violations} violations)`);
});

// ── HUD data completeness years have non-zero activity ───────────────────────

test('complete HUD years (1988–2017) have at least one project each', () => {
  const completeYears = dataset.allocations.filter(
    a => a.hudDataStatus === 'complete' && a.year >= 1988 && a.year <= 2017
  );
  let emptyYears = 0;
  for (const entry of completeYears) {
    if (entry.projects === 0) {
      console.error(`    year ${entry.year}: hudDataStatus=complete but projects=0`);
      emptyYears++;
    }
  }
  assert(emptyYears === 0, `all complete years have at least one project (${emptyYears} empty)`);
});

// ── IRS per-capita ────────────────────────────────────────────────────────────

test('irsPerCapita is present and positive for all years with known floors', () => {
  let missing = 0;
  for (const entry of dataset.allocations) {
    if (entry.year >= 1988 && entry.year <= 2024) {
      if (typeof entry.irsPerCapita !== 'number' || entry.irsPerCapita <= 0) {
        console.error(`    year ${entry.year}: irsPerCapita missing or non-positive`);
        missing++;
      }
    }
  }
  assert(missing === 0, `irsPerCapita is a positive number for all 1988–2024 entries (${missing} missing)`);
});

// ── Allocation authority fields ───────────────────────────────────────────────

test('authority years (2010–2024) have required authority fields', () => {
  const authorityYears = dataset.allocations.filter(
    a => a.year >= 2010 && a.year <= 2024
  );
  let violations = 0;
  for (const entry of authorityYears) {
    if (typeof entry.allocationAuthority !== 'number' || entry.allocationAuthority <= 0) {
      console.error(`    year ${entry.year}: allocationAuthority missing or non-positive`);
      violations++;
    }
    if (typeof entry.perCapitaAuthority !== 'number' || entry.perCapitaAuthority <= 0) {
      console.error(`    year ${entry.year}: perCapitaAuthority missing or non-positive`);
      violations++;
    }
    if (!['confirmed', 'estimated'].includes(entry.authorityStatus)) {
      console.error(`    year ${entry.year}: invalid authorityStatus "${entry.authorityStatus}"`);
      violations++;
    }
  }
  assert(violations === 0,
    `all authority years have valid allocationAuthority, perCapitaAuthority, authorityStatus (${violations} violations)`);
});

// ── Methodology doc ───────────────────────────────────────────────────────────

test('methodologyDoc points to an existing file', () => {
  const docPath = path.join(ROOT, dataset.methodologyDoc);
  assert(fs.existsSync(docPath),
    `methodology doc exists at ${dataset.methodologyDoc}`);
  const content = fs.readFileSync(docPath, 'utf8');
  assert(content.includes('co-historical-allocations.json'),
    'methodology doc references the dataset filename');
  assert(content.includes('Allocation Authority'),
    'methodology doc explains allocation authority concept');
});

// ── data-source-inventory.js registration ────────────────────────────────────

test('data-source-inventory.js registers co-historical-allocations', () => {
  const invPath = path.join(ROOT, 'js', 'data-source-inventory.js');
  assert(fs.existsSync(invPath), 'data-source-inventory.js exists');
  const src = fs.readFileSync(invPath, 'utf8');
  assert(src.includes("id: 'co-historical-allocations'"),
    "inventory has id: 'co-historical-allocations'");
  assert(src.includes("data/co-historical-allocations.json"),
    'inventory references data/co-historical-allocations.json');
});

// ── manifest.json ─────────────────────────────────────────────────────────────

test('manifest.json includes co-historical-allocations.json', () => {
  const manifestPath = path.join(ROOT, 'data', 'manifest.json');
  assert(fs.existsSync(manifestPath), 'manifest.json exists');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = manifest.files;
  // Support both list and dict format
  const hasFile = Array.isArray(files)
    ? files.some(f => f.includes('co-historical-allocations'))
    : Object.keys(files).some(k => k.includes('co-historical-allocations'));
  assert(hasFile, 'manifest.json references co-historical-allocations.json');
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
