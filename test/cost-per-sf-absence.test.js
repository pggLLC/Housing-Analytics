#!/usr/bin/env node
/**
 * Cost per gross square foot — present when it can be computed, absent when it
 * cannot, and never invented.
 *
 * Plan pass criterion 6 asks for cost per square foot in the deal path. It
 * existed nowhere: not in js/deal-calculator.js, not in the market-study
 * engine, only as prose in one policy data file.
 *
 * $/SF is the figure a developer, lender or appraiser checks FIRST, because it
 * is the one they can compare against everything else they have seen. That
 * makes a wrong one worse than none — it is the number most likely to be
 * trusted on sight.
 *
 * Two decisions this pins, both of which could have been made the easy way:
 *
 *   1. The input has NO default. Every other field here ships a placeholder,
 *      which is right for a screening tool — but a made-up floor area produces
 *      a made-up $/SF.
 *   2. Gross area is NOT derived from unit count. Unit sizes sum to NET
 *      rentable area; dividing TDC by that overstates $/SF by whatever
 *      circulation, mechanical and common space exists — commonly 15-25%. A
 *      plausible number wrong in a consistent direction is the worst outcome
 *      available.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'deal-calculator.js'), 'utf8');

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
const test = (name, fn) => {
  try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); }
};

console.log('cost-per-sf-absence');

/* ── behavioural: the arithmetic, exercised ──────────────────────────────── */

// costPerGrossSf is module-private, so reproduce its contract against the
// source of truth rather than a copy: extract and evaluate the function.
function loadCostPerGrossSf() {
  const at = SRC.indexOf('function costPerGrossSf(');
  assert.ok(at >= 0, 'costPerGrossSf() is gone from js/deal-calculator.js');
  const end = SRC.indexOf('\n  }', at);
  const body = SRC.slice(at, end + 4);
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return costPerGrossSf;`)();
}

const costPerGrossSf = loadCostPerGrossSf();

test('a real cost and area produce the cost per square foot', () => {
  assert.strictEqual(costPerGrossSf(20000000, 62000), 20000000 / 62000);
  assert.strictEqual(Math.round(costPerGrossSf(20000000, 62000)), 323);
});

test('a missing area is null, not zero and not Infinity', () => {
  for (const sf of [undefined, null, '', NaN, 0, -1]) {
    const v = costPerGrossSf(20000000, sf);
    assert.strictEqual(v, null,
      `grossSf=${JSON.stringify(sf)} returned ${v}; an unentered floor area must be null. `
      + 'Zero would read as "this project costs nothing per foot" and Infinity would render as a figure.');
  }
});

test('a missing cost is null too', () => {
  for (const tdc of [undefined, null, NaN, 0, -5]) {
    assert.strictEqual(costPerGrossSf(tdc, 62000), null, `tdc=${JSON.stringify(tdc)} produced a number`);
  }
});

/* ── the input ───────────────────────────────────────────────────────────── */

test('the gross-area input exists and has NO default value', () => {
  assert.ok(/id="dc-gross-sf"/.test(SRC), 'the gross building area input is gone');
  const at = SRC.indexOf('id="dc-gross-sf"');
  const tag = SRC.slice(at, SRC.indexOf('>', at));
  assert.ok(!/\bvalue="/.test(tag),
    'the gross-area input has a default value again. A made-up floor area '
    + 'produces a made-up $/SF, which is the one number people trust on sight.');
  assert.ok(/placeholder=/.test(tag), 'the placeholder hint is gone');
});

test('the input asks for GROSS area, and says what that excludes', () => {
  // The distinction is the whole accuracy of the figure.
  assert.ok(/Gross building area/.test(SRC), 'the field no longer asks for gross area');
  assert.ok(/not the sum of unit sizes/.test(SRC),
    'the help text no longer warns that unit sizes are net, not gross — without '
    + 'it a reader enters net area and gets a $/SF overstated by 15-25%');
});

test('gross area is never derived from the unit count', () => {
  assert.ok(!/grossSf\s*[:=]\s*[^;\n]*units\s*\*/.test(SRC),
    'gross area is being computed from units × something. Unit sizes are NET '
    + 'rentable area; deriving gross from them overstates $/SF consistently.');
});

test('the value is read without a `|| 0` coercion', () => {
  assert.ok(/grossSf: safeVal\('dc-gross-sf'\),/.test(SRC),
    'the gross-area read changed shape; `|| 0` here would turn "not entered" '
    + 'into "entered as zero" before the engine can tell them apart');
});

/* ── the display ─────────────────────────────────────────────────────────── */

test('every status path returns the figure, so the row is never simply missing', () => {
  for (const status of ['missing-costs', 'missing-ami', 'missing-helper']) {
    const at = SRC.indexOf(`status: '${status}'`);
    assert.ok(at >= 0, `the ${status} path is gone`);
    const block = SRC.slice(at, at + 220);
    assert.ok(/tdcPerSf:/.test(block),
      `the ${status} path omits tdcPerSf; an absent key reads as "this tool does `
      + 'not do that", which is a different claim from "you have not entered an area"');
  }
});

test('the absent state explains itself rather than showing a bare dash', () => {
  // A bare "—" is the display equivalent of a coerced zero: it looks like an
  // answer and means nothing. The reader cannot tell "not supported" from
  // "you have not filled in the field right above this".
  assert.ok(/function setCostPerSf\(result\)/.test(SRC), 'the renderer is gone');
  assert.ok(/Enter gross building area above to see cost per square foot/.test(SRC),
    'the dash no longer carries its reason');
  const at = SRC.indexOf('function setCostPerSf');
  const fn = SRC.slice(at, SRC.indexOf('\n  }', at));
  assert.ok(/MoneyFormatter\.isAbsent\(v\)/.test(fn),
    'the renderer no longer routes absence through the shared absence check');
});

test('the row is rendered on both the ok and the not-ok paths', () => {
  const calls = (SRC.match(/setCostPerSf\(result\)/g) || []).length;
  assert.ok(calls >= 2,
    `setCostPerSf is called ${calls} time(s); it must run on the error path too, `
    + 'or a partially-filled form leaves a stale figure on screen');
});

test('the field triggers a recalculation', () => {
  assert.ok(/'dc-tdc', 'dc-gross-sf'/.test(SRC),
    'dc-gross-sf is not in the recalculation set, so typing an area changes nothing');
});

console.log(failures === 0
  ? '  cost-per-sf-absence: PASS'
  : `  cost-per-sf-absence: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
