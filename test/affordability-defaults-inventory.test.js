#!/usr/bin/env node
/**
 * Every independent affordability default in the codebase, pinned.
 *
 * The same buyer parameter is defined in several places with different values,
 * and in two cases in different UNITS. That is not a bug this test fixes — the
 * values reach different surfaces answering different questions, and silently
 * reconciling them would change published figures without anyone deciding to.
 *
 * What this test does is stop the set from growing quietly. Every default below
 * is enumerated with its file and value. Adding a new one, or changing an
 * existing one, fails here and forces the change to be deliberate.
 *
 * The divergences as of this file's creation:
 *
 *   down payment   0.05 (financial-constants)  0.10 (hna-utils, ownership-
 *                  finance, hna-ownership-need)  20 (rent-vs-buy — a WHOLE
 *                  NUMBER percentage, divided by 100 at its use site, so it is
 *                  not comparable to the others by inspection)
 *   property tax   0.006 (financial-constants)  0.0065 (everywhere else)
 *   insurance      $2,400 FLAT ANNUAL DOLLARS (financial-constants) against
 *                  0.0035 AS A RATE OF VALUE (everywhere else). These are not
 *                  the same kind of quantity. On a $250,000 home the flat
 *                  figure is roughly 2.7x the rate-based one; near $686,000
 *                  they cross. Any surface mixing them produces a monthly
 *                  payment that is wrong in a direction depending on price.
 *
 * The registry at data/policy/affordability-models.json is the authority for
 * the HNA ownership model. js/config/financial-constants.js is NOT, and now
 * says so.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

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

console.log('affordability-defaults-inventory');

/** The parameters that describe a buyer's carrying cost. */
const PARAMS = [
  'downPaymentPct', 'downPaymentRate',
  'propertyTaxRate', 'propertyTaxPctAnnual',
  'insuranceAnnual', 'insuranceRate',
  'maxDtiRatio', 'housingCostPct', 'mortgageRate',
];

/**
 * The known set. A declaration not listed here is new and fails.
 *
 * Keyed `file:param` so two params in one file are tracked separately.
 */
const KNOWN = {
  'js/config/financial-constants.js:downPaymentPct': 0.05,
  'js/config/financial-constants.js:housingCostPct': 0.30,
  'js/config/financial-constants.js:maxDtiRatio': 0.43,
  'js/config/financial-constants.js:propertyTaxRate': 0.006,
  'js/config/financial-constants.js:insuranceAnnual': 2400,
  'js/config/financial-constants.js:mortgageRate': 0.07,
  'js/hna/hna-utils.js:downPaymentPct': 0.10,
  'js/hna/hna-utils.js:propertyTaxPctAnnual': 0.0065,
  'js/hna/ownership-finance.js:downPaymentRate': 0.10,
  'js/hna/ownership-finance.js:propertyTaxRate': 0.0065,
  'js/hna/ownership-finance.js:insuranceRate': 0.0035,
  'js/hna/hna-ownership-need.js:downPaymentRate': 0.10,
  'js/hna/hna-ownership-need.js:propertyTaxRate': 0.0065,
  'js/hna/hna-ownership-need.js:insuranceRate': 0.0035,
  'js/project-market-study/market-study-page.js:insuranceRate': 0.0035,
  'js/rent-vs-buy-breakeven.js:downPaymentPct': 20,
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'vendor') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const found = {};
for (const file of walk(path.join(ROOT, 'js'))) {
  const rel = path.relative(ROOT, file);
  const src = fs.readFileSync(file, 'utf8');
  for (const p of PARAMS) {
    // Object-literal declarations only, anchored at line start, so a read
    // (`a.propertyTaxRate`) or a fallback expression is not mistaken for a
    // declaration. A declaration is what creates a competing source of truth.
    const m = src.match(new RegExp(`^\\s*${p}:\\s*(-?[\\d.]+)\\s*,`, 'm'));
    if (m) found[`${rel}:${p}`] = Number(m[1]);
  }
}

test('no affordability default appeared or changed without being declared here', () => {
  const problems = [];
  for (const [key, value] of Object.entries(found)) {
    if (!(key in KNOWN)) {
      problems.push(`NEW: ${key} = ${value}`);
    } else if (KNOWN[key] !== value) {
      problems.push(`CHANGED: ${key} was ${KNOWN[key]}, now ${value}`);
    }
  }
  for (const key of Object.keys(KNOWN)) {
    if (!(key in found)) problems.push(`GONE: ${key} — remove it from KNOWN`);
  }
  if (!problems.length) return null;
  return `${problems.length} change(s) to the affordability defaults:\n      `
    + problems.join('\n      ')
    + '\n      Adding a competing default is a decision. If it is the right one, '
    + 'add it to KNOWN in this file with a reason.';
});

test('the inventory is not empty — the scan still finds declarations', () => {
  // A regex that stops matching would make this file pass forever while
  // checking nothing. The count is the canary.
  const n = Object.keys(found).length;
  return n >= 12 ? null
    : `only ${n} declarations found; the scan pattern has probably stopped matching`;
});

test('the registry is named as the authority for the HNA ownership model', () => {
  const f = path.join(ROOT, 'js', 'config', 'financial-constants.js');
  if (!fs.existsSync(f)) return 'js/config/financial-constants.js is missing';
  const src = fs.readFileSync(f, 'utf8');
  return /affordability-models\.json/.test(src)
    ? null
    : 'financial-constants.js does not point at data/policy/affordability-models.json, '
      + 'so a reader cannot tell it is not the authority for the HNA ownership model';
});

test('the insurance unit mismatch is disclosed where both are declared', () => {
  // The sharpest of the divergences: dollars in one file, a rate of value in
  // another. A maintainer copying one into the other produces a payment that is
  // wrong by a factor depending on the home price.
  const f = path.join(ROOT, 'js', 'config', 'financial-constants.js');
  const src = fs.readFileSync(f, 'utf8');
  return /insuranceRate|rate of value|not a rate|flat annual/i.test(src)
    ? null
    : 'financial-constants.js declares insuranceAnnual in dollars without noting '
      + 'that the HNA path uses insuranceRate as a fraction of value';
});

console.log(failures === 0
  ? '  affordability-defaults-inventory: PASS'
  : `  affordability-defaults-inventory: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
