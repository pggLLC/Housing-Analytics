#!/usr/bin/env node
/**
 * The ranking index may not publish an invented zero.
 *
 * `int(safe_float(acs.get("DP03_0062E")))` mapped a missing ACS value to 0,
 * which is `Number(null) === 0` in another language, on the line that sets
 * median household income. Before the fix:
 *
 *     median_hh_income     0 in  83 geographies
 *     median_home_value    0 in  52
 *     gross_rent_median    0 in 170
 *
 * Every one read as a measured figure. A $0 median home value is not a cheap
 * town; it is a town the source did not publish.
 *
 * The distinction this file enforces is between a zero the SOURCE reported and
 * a zero the PIPELINE invented. Ten CDPs — Wolcott, Norrie, Fulford among them
 * — carry population 0 because ACS DP05_0001E is literally 0 for them. Those
 * stay 0. The rule is "do not invent", not "second-guess the source".
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'data', 'hna', 'ranking-index.json');
const BUILDER = path.join(ROOT, 'scripts', 'hna', 'build_ranking_index.py');

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
const test = (name, fn) => {
  try {
    const why = fn();
    if (why) fail(`${name} — ${why}`); else pass(name);
  } catch (e) {
    fail(`${name} — threw: ${e.message}`);
  }
};

console.log('ranking-index-no-coerced-zeros');

if (!fs.existsSync(INDEX)) { fail('ranking-index.json is missing'); process.exit(1); }
const doc = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const rows = doc.rankings || [];

/**
 * Fields where zero cannot be a measurement.
 *
 * A median is a value drawn from a real distribution of occupied homes; it
 * cannot be zero unless the distribution is empty, in which case the right
 * answer is null. Population and household counts are NOT on this list —
 * ACS reports a genuine 0 for unpopulated CDPs.
 */
const ZERO_IS_IMPOSSIBLE = [
  'median_hh_income',
  'median_home_value',
  'gross_rent_median',
];

test('no median is published as zero', () => {
  const offenders = [];
  for (const field of ZERO_IS_IMPOSSIBLE) {
    const hits = rows.filter((r) => r.metrics && r.metrics[field] === 0);
    if (hits.length) {
      offenders.push(`${field}: ${hits.length} geograph${hits.length === 1 ? 'y' : 'ies'} `
        + `(e.g. ${hits.slice(0, 3).map((h) => h.name || h.geoid).join(', ')})`);
    }
  }
  return offenders.length
    ? `a zero median is a missing value wearing a measurement's clothes:\n      ${offenders.join('\n      ')}`
    : null;
});

test('those fields are present and mostly populated, so the check is not vacuous', () => {
  // If the fields were renamed away, every "=== 0" check above would pass
  // while checking nothing.
  const missing = ZERO_IS_IMPOSSIBLE.filter(
    (f) => !rows.some((r) => r.metrics && r.metrics[f] !== undefined),
  );
  if (missing.length) return `field(s) absent from every row: ${missing.join(', ')}`;
  const thin = ZERO_IS_IMPOSSIBLE.filter((f) => {
    const populated = rows.filter((r) => typeof (r.metrics || {})[f] === 'number').length;
    return populated < 100;
  });
  return thin.length
    ? `field(s) populated in fewer than 100 of ${rows.length} rows: ${thin.join(', ')}`
    : null;
});

test('absence is represented as null, not by omitting the key', () => {
  // Dropping the key entirely is the other way to lose the distinction: a
  // consumer reading `metrics.median_hh_income` gets undefined either way, but
  // an explicit null survives JSON round-trips and says "asked, not answered".
  const offenders = [];
  for (const field of ZERO_IS_IMPOSSIBLE) {
    const absent = rows.filter((r) => r.metrics && !(field in r.metrics));
    if (absent.length) offenders.push(`${field}: key missing from ${absent.length} row(s)`);
  }
  return offenders.length ? offenders.join('; ') : null;
});

test('the builder reads published scalars through acs_or_none, not safe_float', () => {
  // The call site is the thing. safe_float's 0.0 default is correct for the
  // dozens of accumulating call sites and wrong for a published scalar, so the
  // guard is on WHICH helper the published reads use.
  if (!fs.existsSync(BUILDER)) return 'build_ranking_index.py is missing';
  const src = fs.readFileSync(BUILDER, 'utf8');
  if (!/def acs_or_none\(/.test(src)) return 'acs_or_none() is gone from the builder';
  const bad = [];
  for (const field of ['DP03_0062E', 'DP04_0134E', 'DP04_0089E']) {
    const re = new RegExp(`safe_float\\(\\s*acs\\.get\\("${field}"\\)\\s*\\)`);
    if (re.test(src)) bad.push(`${field} is read through safe_float, which coerces a miss to 0`);
  }
  return bad.length ? bad.join('; ') : null;
});

test('a genuinely reported zero is still published as zero', () => {
  // The other half of the rule, and the one a careless fix breaks: ACS reports
  // DP05_0001E = 0 for a handful of unpopulated CDPs. Mapping those to null
  // would be inventing an absence, which is the same sin pointing the other
  // way.
  const zeroPop = rows.filter((r) => r.metrics && r.metrics.population === 0);
  return zeroPop.length > 0 ? null
    : 'no geography carries population 0 — if the unpopulated CDPs became null, '
      + 'the fix has started discarding measurements the source did report';
});

console.log(failures === 0
  ? '  ranking-index-no-coerced-zeros: PASS'
  : `  ranking-index-no-coerced-zeros: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
