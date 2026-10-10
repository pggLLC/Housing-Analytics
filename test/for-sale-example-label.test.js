'use strict';

/**
 * The for-sale study's built-in scenarios are an example, so the page and the
 * report call them one (owner decision, 2026-10-10).
 *
 * Agreement, not copy: whatever the fixtures and the report title say, they
 * must not name the place the example's inputs came from (the fixture's own
 * jurisdiction.name), and both must call it an example. Reword either freely.
 * A reader who chose that place itself still gets its project's own title;
 * test/for-sale-study-follows-jurisdiction.test.mjs holds that side.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(ROOT, 'for-sale-market-study.html'), 'utf8');
const files = [...page.matchAll(/'([a-z0-9-]+\.scenario\.json)'/g)].map((m) => m[1]);
const Report = require(path.join(ROOT, 'js/project-market-study/market-study-report.js'));

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

console.log('\nFor-sale study: the example is labelled as an example');
console.log('='.repeat(62));

test('the page loads example scenarios', () => {
  assert(files.length >= 1, 'scan found the scenario files the page loads');
});

files.forEach((file) => {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/fixtures', file), 'utf8'));
  const place = doc.jurisdiction && doc.jurisdiction.name;
  test(file + ': its name says example and not "' + place + '"', () => {
    assert(place, 'fixture names the place its inputs came from');
    assert.match(doc.meta.name, /example/i);
    assert(!doc.meta.name.includes(place), doc.meta.name);
  });
  test(file + ': the report title with no place chosen says example and not "' + place + '"', () => {
    const title = Report.reportTitle(doc, null, null);
    assert.match(title, /example/i);
    assert(!title.includes(place), title);
  });
});

if (failures) { console.log('\n' + failures + ' failed'); process.exit(1); }
console.log('\nAll example-label checks passed');
