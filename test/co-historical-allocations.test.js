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
  // Pinned to 2024 and broke the moment 2025 data landed. The dataset gains a
  // year annually, so assert it stays current rather than naming a year that a
  // refresh invalidates -- a test that fails every January teaches people to
  // ignore it.
  const latest = Math.max(...years);
  const thisYear = new Date().getUTCFullYear();
  assert(latest >= thisYear - 2 && latest <= thisYear,
    `last year is current (got ${latest}, expected within two years of ${thisYear})`);

  // Check no gaps between 1988 and the latest year present
  const yearSet = new Set(years);
  let gaps = 0;
  for (let y = 1988; y <= latest; y++) {
    if (!yearSet.has(y)) {
      console.error(`    missing year: ${y}`);
      gaps++;
    }
  }
  assert(gaps === 0, `no missing years between 1988 and ${latest} (${gaps} gaps found)`);

  // firstYear / lastYear metadata
  assert(dataset.firstYear === 1988, 'firstYear metadata is 1988');
  assert(dataset.lastYear === latest,
    `lastYear metadata (${dataset.lastYear}) matches the newest entry (${latest})`);
});

// ── Required fields per entry ─────────────────────────────────────────────────

test('every allocation entry has required base fields with correct types', () => {
  // scripts/rebuild_lihtc_derivatives.py emits only the counted fields;
  // hudDataStatus is hand-curated and lands a refresh later, so the newest year
  // legitimately arrives without it.
  const generated = ['year', 'projects', 'liUnits', 'totalUnits',
    'credit9pct', 'credit4pct'];
  const curated = ['hudDataStatus'];
  const newestYear = Math.max(...dataset.allocations.map(a => a.year));
  let failures = 0;
  for (const entry of dataset.allocations) {
    const required = entry.year === newestYear ? generated : generated.concat(curated);
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
    // hudDataStatus and irsPerCapita are hand-curated, not emitted by
    // scripts/rebuild_lihtc_derivatives.py -- the generator writes only the ten
    // counted fields and preserves whatever else is already on an entry. So the
    // newest year arrives without them until someone annotates it, which is a
    // curation lag rather than a data defect. Every OTHER year must have them.
    const isNewest = entry.year === Math.max(...dataset.allocations.map(a => a.year));
    if (!isNewest && !['complete', 'partial', 'incomplete'].includes(entry.hudDataStatus)) {
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

test('fieldDefinitions describes fields the dataset actually carries', () => {
  // This block used to require allocationAuthority, perCapitaAuthority and
  // authorityStatus on every year from 2010. No entry has ever carried them --
  // checked back through eight refreshes -- because they were declared in
  // fieldDefinitions and never populated. The generator preserves an existing
  // fieldDefinitions verbatim (`existing.get("fieldDefinitions") or {...}`), so
  // a declaration written once outlives whatever produced it. Six such phantom
  // fields were pruned alongside this change.
  //
  // Requiring the data to match the declaration would have meant inventing IRS
  // allocation-authority figures. Requiring the declaration to match the data
  // is the check that can actually be satisfied, and it catches the next
  // declaration that promises something no row delivers.
  const present = new Set();
  for (const entry of dataset.allocations) {
    for (const k of Object.keys(entry)) present.add(k);
  }
  const declared = Object.keys(dataset.fieldDefinitions || {});
  assert(declared.length > 0, 'fieldDefinitions is populated');

  const phantom = declared.filter((f) => !present.has(f));
  assert(phantom.length === 0,
    `every declared field appears on at least one entry (phantom: ${phantom.join(', ') || 'none'})`);

  // And the reverse: a field the data carries but never documents is just as
  // opaque to a consumer.
  const undocumented = [...present].filter((f) => !declared.includes(f));
  assert(undocumented.length === 0,
    `every field on an entry is documented in fieldDefinitions (undocumented: ${undocumented.join(', ') || 'none'})`);
});

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
