'use strict';

/**
 * Guard for the CAR market section's projected-figure disclosure.
 *
 * Between published CAR reports, scripts/generate-car-placeholder.mjs writes a
 * monthly file whose figures are the previous month's grown by fixed factors
 * (+0.5%/mo median, +3.0%/mo listings). Those files still declare
 *   source: "Colorado Association of REALTORS (CAR)"
 * so rendering the attribution alone presents a projection as a published CAR
 * figure.
 *
 * ESTIMATION IS PER SCOPE. This guard used to assume one boolean per month,
 * and that assumption caused the bug it was meant to prevent. ShowingTime
 * supplies COUNTY rows and no statewide row, so once a month is populated it
 * carries 64 counties of real MLS data alongside statewide and metro figures
 * that are still the projection. With only `estimated: true|false` available,
 * both settings are false statements, and the repo shipped each in turn:
 *
 *   fc0ce5bc6  estimated: true   -> told readers 64 counties of real MLS data
 *                                   were trend-projected.
 *   #1630      key deleted       -> told readers four months of projected
 *                                   statewide figures were published CAR data.
 *
 * The second was the worse direction and went unnoticed because THIS FILE
 * demanded it: the old third test asserted `estimated !== true` for any month
 * with county rows. A guard that forces the defect is worse than no guard.
 *
 * The strongest check here is arithmetic, not declarative: a statewide block
 * that equals the previous month grown by the generator's own factors IS a
 * projection, whatever the file says about itself. That is what caught
 * 2026-05 through 2026-08 — each exactly 1.005x the month before, none
 * flagged.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'housing-needs-assessment.html');

// Must match generate-car-placeholder.mjs.
const PRICE_FACTOR = 1.005;
const LISTING_FACTOR = 1.030;

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

run('a statewide block matching the projection formula is flagged as projected', () => {
  // The load-bearing check. It does not ask the file whether it is a
  // projection; it works that out from the numbers.
  let compared = 0;
  let prev = null;
  for (const f of reports) {
    const d = load(f);
    if (prev) {
      const p = prev.statewide || {};
      const s = d.statewide || {};
      const have = [p.median_sale_price, p.active_listings, s.median_sale_price, s.active_listings]
        .every((v) => typeof v === 'number');
      if (have) {
        const looksProjected =
          s.median_sale_price === Math.round(p.median_sale_price * PRICE_FACTOR) &&
          s.active_listings === Math.round(p.active_listings * LISTING_FACTOR);
        if (looksProjected) {
          compared += 1;
          assert.equal(d.estimated_scopes.statewide, true,
            `${f} statewide equals ${prev.month} grown by the generator's own factors ` +
            `(${p.median_sale_price} x ${PRICE_FACTOR} = ${s.median_sale_price}, ` +
            `${p.active_listings} x ${LISTING_FACTOR} = ${s.active_listings}) — it is a ` +
            'projection and must be declared one, whatever the file claims about itself');
        }
      }
    }
    prev = d;
  }
  assert.ok(compared > 0,
    'precondition: expected at least one month carrying a trend-projected statewide block');
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
  // would label a genuinely published CAR month an estimate. The arithmetic
  // check above is what covers a projection the heuristics cannot see.
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
