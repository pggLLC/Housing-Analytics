'use strict';

/**
 * Guard for the CAR market section's projected-month disclosure.
 *
 * Between published CAR reports, scripts/generate-car-placeholder.mjs writes a
 * monthly file whose figures are the previous month's projected forward by
 * fixed growth factors. Those files still declare
 *   source: "Colorado Association of REALTORS (CAR)"
 * so rendering the attribution alone presents a projection as a published CAR
 * figure. data/car-market-report-2026-09.json was displayed on the HNA market
 * section as "Denver Metro CAR — Median sale price: $577k" with nothing
 * marking it as projected.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

const reports = fs.readdirSync(path.join(ROOT, 'data'))
  .filter((f) => /^car-market-report-\d{4}-\d{2}\.json$/.test(f))
  .sort();

console.log('car-estimate-disclosure');

run('every CAR report file is classifiable as published or projected', () => {
  assert.ok(reports.length >= 3, 'expected a monthly CAR series');
  for (const f of reports) {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
    const projectedNote = /\bestimated\b[\s\S]*\btrend-projection\b/i.test(String(d.notes || '')) ||
                          /^placeholder for /i.test(String(d.notes || ''));
    if (projectedNote) {
      assert.equal(d.estimated, true,
        `${f} reads as projected in its notes but does not set estimated: true — ` +
        'surfaces cannot label what they cannot detect');
      assert.ok(d.estimate_basis, `${f} must say what the projection was based on`);
    }
  }
});

run('a projected month never claims real county rows', () => {
  for (const f of reports) {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
    if (d.estimated === true) {
      assert.equal(Object.keys(d.counties || {}).length, 0,
        `${f} is projected but carries county rows — those come from ShowingTime and are real`);
    }
  }
});

run('published reports are not mislabelled as projected', () => {
  // 2026-05..07 carry 64 ShowingTime county rows and must stay unflagged.
  const published = reports.filter((f) => {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
    return Object.keys(d.counties || {}).length > 0;
  });
  assert.ok(published.length >= 1, 'expected at least one published report with county rows');
  for (const f of published) {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
    assert.notEqual(d.estimated, true, `${f} has real county rows and must not be flagged projected`);
  }
});

run('the generator flags what it produces', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/generate-car-placeholder.mjs'), 'utf8');
  assert.match(src, /estimated:\s*true/, 'generator must mark its output as estimated');
  assert.match(src, /estimate_basis/, 'generator must record the projection basis');
});

run('the page detects the flag and warns before the numbers', () => {
  const html = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');
  assert.match(html, /carEstimateNotice/, 'the notice element exists');
  assert.match(html, /car\.estimated === true/, 'the page reads the machine-readable flag');
  assert.match(html, /projected, not a published report/, 'the attribution distinguishes projections');
  // The notice must precede the cards: a caveat under figures the reader has
  // already taken at face value is not a caveat.
  const notice = html.indexOf('id="carEstimateNotice"');
  const grid = html.indexOf('id="bridgeRegionGrid"');
  assert.ok(notice > 0 && grid > 0 && notice < grid,
    'the notice must appear before the region cards in the DOM');
});

run('the inventory does not point at a projected month', () => {
  const inv = fs.readFileSync(path.join(ROOT, 'js/data-source-inventory.js'), 'utf8');
  const m = /localFile: '(data\/car-market-report-\d{4}-\d{2}\.json)'/.exec(inv);
  assert.ok(m, 'the CAR source declares a localFile');
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, m[1]), 'utf8'));
  assert.notEqual(d.estimated, true,
    `${m[1]} is projected — the inventory must cite a published report as the series`);
});

if (failures) { console.error('car-estimate-disclosure: FAIL'); process.exitCode = 1; }
else console.log('car-estimate-disclosure: PASS');
