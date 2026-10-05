'use strict';

/** Estimated tracking scopes must stay labelled; their prices are never published. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'housing-needs-assessment.html');

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

const reports = fs.readdirSync(path.join(ROOT, 'data'))
  .filter((f) => /^car-market-report-\d{4}-\d{2}\.json$/.test(f))
  .sort();

const load = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const countyCount = (d) => Object.keys(d.counties || {}).length;

console.log('car-estimate-disclosure');

run('every report declares which scopes are estimated', () => {
  assert.ok(reports.length >= 3, 'expected a monthly CAR series');
  for (const f of reports) {
    const d = load(f);
    assert.ok(d.estimated_scopes && typeof d.estimated_scopes === 'object',
      `${f} has no estimated_scopes. A single boolean cannot describe a month ` +
      'whose county rows are published while its statewide figures are projected.');
    for (const scope of ['counties', 'statewide', 'metro']) {
      assert.equal(typeof d.estimated_scopes[scope], 'boolean',
        `${f} estimated_scopes.${scope} must be a boolean, got ${JSON.stringify(d.estimated_scopes[scope])}`);
    }
  }
});

run('estimated statewide and metro prices are absent, with a reason', () => {
  let checked = 0;
  for (const f of reports) {
    const d = load(f);
    const rows = [...(d.estimated_scopes.statewide ? [d.statewide] : []),
      ...(d.estimated_scopes.metro ? Object.values(d.metro_areas || {}) : [])];
    for (const row of rows) {
      checked++;
      assert.equal(row.median_sale_price, null, f + ': estimated sale price must be absent');
      assert.equal(row.median_price_per_sqft, null, f + ': estimated price/sqft must be absent');
      assert.equal(row.estimated_reason, 'price_not_published_by_car');
    }
  }
  assert(checked > 0, 'checked a non-empty set of estimated scopes');
});

run('real ShowingTime county rows are never labelled projected', () => {
  for (const f of reports) {
    const d = load(f);
    if (countyCount(d) > 0) {
      assert.equal(d.estimated_scopes.counties, false,
        `${f} carries ${countyCount(d)} county rows from ShowingTime — those are ` +
        'published MLS data and must not be flagged projected');
    }
  }
});

run('a month with no county rows has nothing published to claim', () => {
  for (const f of reports) {
    const d = load(f);
    if (countyCount(d) === 0) {
      assert.equal(d.estimated_scopes.counties, true,
        `${f} has no county rows, so its county scope cannot be published data`);
    }
  }
});

run('the summary flag and the basis agree with the scopes', () => {
  for (const f of reports) {
    const d = load(f);
    const any = Object.values(d.estimated_scopes).some(Boolean);
    assert.equal(d.estimated, any,
      `${f} estimated must be the any-scope summary (scopes: ` +
      `${JSON.stringify(d.estimated_scopes)}, estimated: ${d.estimated})`);
    if (any) {
      assert.ok(d.estimate_basis, `${f} must say what the projection was based on`);
    }
  }
});

run('the page discloses per scope, and keeps the old detection as a fallback', () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  // Match the ASSIGNMENT, not the bare identifier. An earlier version of this
  // assertion looked for /estimated_scopes/ anywhere in the file and passed
  // when the read was replaced with `var carScopes = null;` — because the
  // identifier still appeared in the comment right above it. A guard that a
  // comment can satisfy guards nothing.
  assert.match(html, /var\s+carScopes\s*=\s*car\.estimated_scopes\s*;/,
    'the market section must actually read car.estimated_scopes, not just ' +
    'mention it — the boolean alone cannot say that county rows are real ' +
    'while statewide is not');
  assert.match(html, /projectedScopes\.push\(/,
    'the notice must build the list of projected scopes, not just name the variable');
  assert.match(html, /projectedScopes\.join\(/,
    'the notice must render which scopes are projected');
  // When the field is absent, the page must still apply the detection it used
  // before it existed — the old boolean plus the notes heuristics — so no
  // month the previous version flagged goes quiet. Note this is NOT
  // "assume projected": over-warning is the other half of this bug, and it
  // would label a genuinely published CAR month an estimate. The price-absence
  // check above covers every committed estimated scope.
  assert.match(html, /if \(!carScopes\) \{[\s\S]{0,600}legacyAll/,
    'a file without estimated_scopes must still be run through the previous ' +
    'detection, or dropping the field silently turns the disclosure off');
  assert.match(html, /trend-projection[\s\S]{0,200}placeholder for/i,
    'the fallback must keep BOTH notes heuristics — projected months and ' +
    'placeholder months were detected by different wording');
});

console.log(failures === 0
  ? '  car-estimate-disclosure: PASS'
  : '  car-estimate-disclosure: FAIL (' + failures + ')');
process.exit(failures === 0 ? 0 : 1);
