#!/usr/bin/env node
/**
 * A blocked deal calculation must not produce a number.
 *
 * `if (unitMixError) { annualRents = 0; }` was written to "block downstream
 * calc by zeroing rents" — the comment said block, the code said zero. Zero is
 * finite, so NOI, DSCR, break-even occupancy and the funding gap were all
 * computed from it and rendered as figures. On a 40-unit entry with a 50-unit
 * AMI mix the page showed $0 rents, a negative NOI, a 0.00 DSCR and a
 * multi-million-dollar funding gap — none of which were computed from anything.
 *
 * Unlike a wrong planning figure, this one is a financing go/no-go.
 *
 * Where possible these are BEHAVIOURAL, not textual: computeDscrStressScenarios
 * is reachable on window.__DealCalc, so the guard is exercised rather than
 * grepped. The call-site assertions that cannot be executed without the DOM are
 * pinned by source, and each one names the exact edit that would break it.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'deal-calculator.js'), 'utf8');

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
// Named `test` deliberately, not `run`: scripts/paper/build-paper-figures.mjs
// counts absence assertions by matching `test|it|describe` on the assertion
// NAME. Under the old name this file — the clearest example of the discipline
// the paper describes — contributed 0 to that figure.
const test = (name, fn) => {
  try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); }
};

console.log('deal-calc-absence-semantics');

/* ── behavioural: load the module far enough to reach the exported maths ──── */

function loadDealCalc() {
  const stubEl = () => ({
    value: '', textContent: '', innerHTML: '', hidden: true, checked: false,
    classList: { add() {}, remove() {}, toggle() {} },
    style: {}, appendChild() {}, setAttribute() {}, removeAttribute() {},
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  });
  const doc = {
    getElementById: () => stubEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => stubEl(),
    addEventListener() {},
    body: stubEl(),
    readyState: 'complete',
  };
  const win = {
    document: doc,
    addEventListener() {},
    location: { search: '', href: 'http://localhost/' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) }),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    DealCalculatorMath: {
      mortgageConstant: () => 0.06,
      computeApplicableFraction: () => 1,
    },
  };
  win.window = win;
  const ctx = vm.createContext(win);
  ctx.console = { log() {}, warn() {}, error() {}, info() {} };
  ctx.setTimeout = () => 0;
  ctx.clearTimeout = () => {};
  ctx.setInterval = () => 0;
  ctx.clearInterval = () => {};
  ctx.requestAnimationFrame = () => 0;
  try {
    vm.runInContext(SRC, ctx, { timeout: 10000 });
  } catch (e) {
    // The module does DOM work on load; a partial evaluation is fine as long
    // as the export landed. If it did not, the behavioural tests say so
    // rather than silently degrading to source-grepping.
    if (!win.__DealCalc) throw new Error(`module did not expose __DealCalc: ${e.message}`);
  }
  return win.__DealCalc;
}

let API = null;
test('the calculator exposes its stress maths for testing', () => {
  API = loadDealCalc();
  assert.ok(API, 'window.__DealCalc is absent');
  assert.strictEqual(typeof API.computeDscrStressScenarios, 'function',
    'computeDscrStressScenarios is not exported');
});

const baseInputs = {
  vacancyPct: 0.07,
  annualOpex: 400000,
  annualRepReserve: 30000,
  netPropTax: 20000,
  annualDebtService: 500000,
};

test('a real rent roll still produces stress scenarios', () => {
  assert.ok(API, 'the module never loaded — these assertions would otherwise pass vacuously');
  const out = API.computeDscrStressScenarios({ ...baseInputs, annualRents: 1200000 });
  assert.ok(out, 'a valid deal produced no scenarios — the guard is too aggressive');
});

test('an unknown rent roll produces NO scenarios, rather than a 0.00 DSCR', () => {
  assert.ok(API, 'the module never loaded — these assertions would otherwise pass vacuously');
  // NaN is what the unit-mix error path now assigns. Before the fix this was 0,
  // which sailed through `annualRents <= 0` being false for NaN and, when it
  // was literally 0, produced a full set of stress numbers off a $0 rent roll.
  const out = API.computeDscrStressScenarios({ ...baseInputs, annualRents: NaN });
  assert.strictEqual(out, null,
    'an unknown rent roll produced stress scenarios; a DSCR computed from an '
    + 'unknown rent is a number nobody measured');
});

test('a zero rent roll also produces no scenarios', () => {
  assert.ok(API, 'the module never loaded — these assertions would otherwise pass vacuously');
  const out = API.computeDscrStressScenarios({ ...baseInputs, annualRents: 0 });
  assert.strictEqual(out, null, 'a $0 rent roll produced stress scenarios');
});

test('a missing rent roll is not silently defaulted', () => {
  assert.ok(API, 'the module never loaded — these assertions would otherwise pass vacuously');
  for (const v of [undefined, null, '']) {
    const out = API.computeDscrStressScenarios({ ...baseInputs, annualRents: v });
    assert.strictEqual(out, null, `annualRents=${JSON.stringify(v)} produced scenarios`);
  }
});

/* ── source-pinned: the call sites the DOM would be needed to execute ────── */

test('a broken unit mix assigns NaN, not 0', () => {
  assert.ok(/if \(unitMixError\) \{\s*\n\s*annualRents = NaN;/.test(SRC),
    'the unit-mix error path no longer assigns NaN — if it assigns 0 again, '
    + 'NOI, DSCR and the funding gap resume computing from a rent roll that '
    + 'was never calculated');
  assert.ok(!/if \(unitMixError\) \{\s*\n\s*annualRents = 0;/.test(SRC),
    'the unit-mix error path assigns 0 again');
});

test('a deal with no county has an unknown rent roll, not a $0 one', () => {
  // Units are priced at the county's AMI rent ceilings; with no county there
  // are none, and the sum used to read $0 — an NOI of -$399,000, a $0 first
  // mortgage and $0 sensitivity bars for anyone arriving without a
  // jurisdiction (G3 dry run, 2026-09-25).
  assert.ok(/if \(!_amiLimits && !_amiLimitsByBr\) \{\s*\n\s*annualRents = NaN;/.test(SRC),
    'the no-county path no longer marks the rent roll unknown');
});

test('a blank manual NOI is unknown, not $0', () => {
  assert.ok(!/noi = safeVal\('dc-noi'\) \|\| 0;/.test(SRC),
    "manual NOI is read with `|| 0` again, so a blank field sizes a $0 mortgage");
});

test('an unknown NOI sizes an unknown mortgage, not a $0 one', () => {
  // `NaN > 0` is false, so `(mc > 0 && noi > 0) ? ... : 0` turned an unknown
  // NOI into a computed-looking $0 in Sources & Uses, and a funding gap equal
  // to TDC minus equity.
  assert.ok(/var mortgage = !isFinite\(noi\) \? NaN/.test(SRC),
    'mortgage sizing no longer keeps an unknown NOI unknown');
});

test('auto-balance does not call an uncomputable gap balanced', () => {
  assert.ok(/if \(autoBalance && !isFinite\(gapBeforeDeferred\)\)/.test(SRC),
    'an unknown gap falls through to "Deal is balanced without deferring fee"');
});

test('the sensitivity chart is not drawn from an unknown NOI', () => {
  assert.ok(/var sensitivityKnown = isFinite\(noi\) && annualRents > 0;/.test(SRC),
    'the sensitivity gate is gone');
  assert.ok(/window\.TornadoSensitivity && tdc > 0 && sensitivityKnown/.test(SRC),
    'the chart renders without checking NOI and rents are known — its bars '
    + 'coerce them with `|| 0` and draw $0 ranges');
});

test('the absence messages name the cause, not always "select a county"', () => {
  // A county can be selected and NOI still unknown (a blank manual NOI, a
  // broken unit mix). Telling that reader to select a county sends them to
  // fix something that is not broken (Codex review, #1905).
  assert.ok(/'Enter NOI, or turn on auto-compute\.'/.test(SRC), 'manual-NOI cause is not named');
  assert.ok(/unitMixError\s*\?\s*'Fix the unit mix/.test(SRC), 'unit-mix cause is not named');
  for (const [what, re] of [
    ['auto-balance note', /Nothing to balance yet[^;]*;/],
    ['sensitivity note', /Sensitivity needs a known NOI[^;]*;/],
  ]) {
    const m = SRC.match(re);
    assert.ok(m, `${what} not found`);
    assert.ok(!/Select a county/.test(m[0]), `${what} hard-codes the no-county remedy`);
    assert.ok(/UnknownReason/.test(m[0]), `${what} does not use the carried reason`);
  }
});

test('percent labels on the sensitivity chart are rounded before printing', () => {
  // vacFrac() * 100 turns 7% into 7.000000000000001, which was printed as
  // "Vacancy 5.000000000000001% to 9%". Executed, not grepped: take the label
  // expression from the source and run it on the value that exposed the bug.
  const m = SRC.match(/note: ('Vacancy ' \+[\s\S]*?'%'),\n/);
  assert.ok(m, 'could not find the vacancy label expression');
  const label = vm.runInNewContext(m[1], { vu: 0.07 * 100, Math });
  assert.strictEqual(label, 'Vacancy 5% to 9%', `label printed as "${label}"`);
});

test('the rents input is not re-coerced by a || 0 default', () => {
  // `+inputs.annualRents || 0` turns NaN back into 0 and undoes the fix one
  // function away from where it was made.
  assert.ok(!/var annualRents\s*=\s*\+inputs\.annualRents \|\| 0;/.test(SRC),
    'annualRents is read with `|| 0`, which resurrects the zeroed deal');
});

test('the rents guard catches NaN, not just <= 0', () => {
  // `NaN <= 0` is false, so a bare `<= 0` lets an unknown rent roll straight
  // through. The inverted form catches missing, zero, negative and NaN.
  assert.ok(/!\(annualRents > 0\)/.test(SRC),
    'the rents guard uses a bare comparison that NaN passes');
});

test('an empty units field does not become a 60-unit project', () => {
  // Quote-agnostic, and not tied to reading the element inline: the original
  // form of this assertion only matched single quotes, so rewriting the same
  // defect with double quotes slipped past it.
  const unitsDefault = /dc-units[\s\S]{0,160}?\|\|\s*60\b/;
  assert.ok(!unitsDefault.test(SRC),
    'the units field defaults to 60 again — a plausible-looking default is '
    + 'harder to notice than a zero, and the predictor applies its own 60 '
    + 'on top');
  // And the positive form, so deleting the read entirely does not pass.
  assert.ok(/Number\.isFinite\(_unitsRaw\) && _unitsRaw > 0 \? _unitsRaw : NaN/.test(SRC),
    'the guarded units read is gone');
});

test('the predictor is not asked a question with no unit count in it', () => {
  // js/lihtc-deal-predictor.js applies its OWN _num(inputs.proposedUnits, 60),
  // so passing the unknown through simply resurrects 60 one layer down.
  assert.ok(/if \(!Number\.isFinite\(units\)\) \{/.test(SRC),
    'the predictor is called without checking the unit count is known');
  assert.ok(/No prediction is shown/.test(SRC),
    'nothing tells the user why no prediction appeared');
});

test('the predictor default that made this necessary still exists', () => {
  // Pins the reason the guard above is written the way it is. If the predictor
  // ever stops defaulting to 60, this test should be revisited rather than
  // left asserting a rationale that no longer holds.
  const pred = path.join(ROOT, 'js', 'lihtc-deal-predictor.js');
  if (!fs.existsSync(pred)) return;
  const src = fs.readFileSync(pred, 'utf8');
  assert.ok(/_num\(inputs\.proposedUnits, 60\)/.test(src),
    'the predictor no longer defaults proposedUnits to 60 — the call-site '
    + 'guard may now be redundant, or may need to change shape');
});

console.log(failures === 0
  ? '  deal-calc-absence-semantics: PASS'
  : `  deal-calc-absence-semantics: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
