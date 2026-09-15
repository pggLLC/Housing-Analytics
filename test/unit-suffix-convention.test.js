#!/usr/bin/env node
/**
 * A field's suffix must tell you its scale.
 *
 * The convention: `_pct` is 0–100, `_rate` and `_share` are 0–1. Before #1657
 * that was only half true — `vacancy_rate` meant a fraction in the demographics
 * files and a percentage in the HNA ranking payloads, both internally
 * consistent, so nothing rendered wrong and nothing caught it. The next person
 * to wire one family into the other would have inherited a 100x error that no
 * range check can see, because 2.6 and 0.026 are both plausible vacancy rates.
 *
 * This scans the published data and fails when a name disagrees with its values.
 * It is deliberately a check on the ARTIFACT rather than the generator: the
 * generators were each self-consistent; it was the published files that
 * disagreed with one another.
 *
 * Detection is by distribution, not by a single value. A `_rate` field holding
 * 0.85 is a fine fraction; a `_rate` field where many values exceed 1 is a
 * percentage wearing the wrong name.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');

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

console.log('unit-suffix-convention');

/**
 * Files to scan. The whole of data/ is far too slow and most of it is
 * geometry; these are the published payloads a consumer actually wires into a
 * surface, which is where a unit mismatch does its damage.
 */
const FILES = [
  'hna/ranking-index.json',
  'co-county-demographics.json',
  'co-demographics.json',
];

/**
 * Names exempted, each with a reason. An exemption is a decision that a field
 * may lie about its scale, so it costs a line here and a justification.
 */
const EXEMPT = new Set([
  // A ratio of value to income — legitimately exceeds 1 and is not a share.
  'home_value_to_income',
  'rent_to_income',
  'value_to_income',
  // In-commuters per resident worker; exceeds 1 wherever jobs outnumber workers.
  'commute_ratio',
  // Interest rates are quoted as fractions but named without a suffix upstream.
  'mortgage_rate',
]);

const SUFFIX_RULES = [
  { re: /_pct$/, name: '_pct', min: 0, max: 100, expectFraction: false },
  { re: /_(rate|share)$/, name: '_rate/_share', min: 0, max: 1, expectFraction: true },
];

/** Walk an object, yielding [dottedPath, leafKey, value] for every number. */
function* numbers(obj, prefix = '') {
  if (obj === null || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const v of obj) yield* numbers(v, prefix);
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      yield [prefix ? `${prefix}.${k}` : k, k, v];
    } else if (v && typeof v === 'object') {
      yield* numbers(v, prefix ? `${prefix}.${k}` : k);
    }
  }
}

const scanned = [];
for (const rel of FILES) {
  const p = path.join(DATA, rel);
  if (!fs.existsSync(p)) continue;
  let doc;
  try { doc = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }

  // Group every numeric leaf by its field name so the check sees a
  // distribution rather than one value.
  const byField = new Map();
  for (const [, key, value] of numbers(doc)) {
    if (EXEMPT.has(key)) continue;
    const rule = SUFFIX_RULES.find((r) => r.re.test(key));
    if (!rule) continue;
    if (!byField.has(key)) byField.set(key, { rule, values: [] });
    byField.get(key).values.push(value);
  }
  scanned.push({ file: rel, byField });
}

test('the scan actually found suffixed fields to check', () => {
  const total = scanned.reduce((n, s) => n + s.byField.size, 0);
  return total >= 8 ? null
    : `only ${total} suffixed field(s) found across ${scanned.length} file(s); `
      + 'the scan has probably stopped matching and this file is checking nothing';
});

test('every _rate / _share field holds fractions, not percentages', () => {
  const offenders = [];
  for (const { file, byField } of scanned) {
    for (const [key, { rule, values }] of byField) {
      if (!rule.expectFraction) continue;
      const over = values.filter((v) => v > 1);
      // One value over 1 could be a genuine outlier or a ratio. A meaningful
      // share of them over 1 means the field is a percentage in disguise.
      if (over.length > Math.max(3, values.length * 0.05)) {
        const mx = Math.max(...values);
        offenders.push(`${file}: ${key} — ${over.length}/${values.length} values exceed 1 `
          + `(max ${mx}); a _rate/_share must be a fraction, or rename it _pct`);
      }
    }
  }
  return offenders.length ? offenders.join('\n      ') : null;
});

test('every _pct field holds percentages, not fractions', () => {
  const offenders = [];
  for (const { file, byField } of scanned) {
    for (const [key, { rule, values }] of byField) {
      if (rule.expectFraction) continue;
      const nonZero = values.filter((v) => v !== 0);
      if (nonZero.length < 20) continue;      // too few to judge a distribution
      // A percentage field whose every non-zero value sits under 1 is a
      // fraction wearing the wrong name — the mirror of the bug above.
      if (nonZero.every((v) => v < 1)) {
        offenders.push(`${file}: ${key} — all ${nonZero.length} non-zero values are below 1; `
          + 'a _pct field should be 0–100, or rename it _rate');
      }
      const over = values.filter((v) => v > 100);
      if (over.length) {
        offenders.push(`${file}: ${key} — ${over.length} value(s) exceed 100 (max ${Math.max(...values)})`);
      }
    }
  }
  return offenders.length ? offenders.join('\n      ') : null;
});

test('the vacancy families no longer share a name across scales', () => {
  // The specific regression #1657 fixed, pinned by name so it cannot come back
  // quietly under a different generator.
  const ranking = scanned.find((s) => s.file === 'hna/ranking-index.json');
  if (!ranking) return 'ranking-index.json was not scanned';
  if (ranking.byField.has('vacancy_rate')) {
    return 'ranking-index.json publishes `vacancy_rate` again — the HNA family is '
      + 'percent-scaled and must use `vacancy_rate_pct`';
  }
  if (!ranking.byField.has('vacancy_rate_pct')) {
    return 'ranking-index.json publishes neither vacancy_rate_pct nor vacancy_rate; '
      + 'the field has moved and this guard needs updating';
  }
  return null;
});

console.log(failures === 0
  ? '  unit-suffix-convention: PASS'
  : `  unit-suffix-convention: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
