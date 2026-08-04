'use strict';

/**
 * test/ownership-finance.test.js
 * Phase 1 — shared homeownership affordability engine.
 *
 * Contract under test (docs/audits/SCOPING-FRUITA-COMMONS-REVISION-2-2026-08.md §10):
 *  - golden backward-compat: maxAffordablePrice(100000, 0.80) === 289983
 *  - parity: hna-ownership-need.js with and without the engine present
 *    returns identical values across a grid (soft-delegation correctness)
 *  - model registry loads; exactly one default; implications present
 *  - monotonicity: higher rate/HOA/tax/insurance/ground rent/debt lowers
 *    buying power; larger down payment raises max price
 *  - guardrails: recommendedModel is never the most permissive; permissive
 *    comparisons carry riskDisclosureRequired; percent/decimal mixing throws
 *  - zero-interest and negative-capacity handling
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const engine = require(path.join(ROOT, 'js/hna/ownership-finance.js'));
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/policy/affordability-models.json'), 'utf8'));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✅ ' + name);
  } catch (err) {
    failed += 1;
    console.error('  ❌ ' + name);
    console.error('     ' + err.message);
  }
}

function loadHnaKernel(withEngine) {
  const src = fs.readFileSync(path.join(ROOT, 'js/hna/hna-ownership-need.js'), 'utf8');
  const win = withEngine ? { OwnershipFinance: engine } : {};
  const sandbox = { window: win, Math, Number, Object, Array, isFinite };
  vm.runInNewContext(src, sandbox);
  return win.HNAOwnershipNeed;
}

console.log('\nOwnership finance engine (Phase 1)');
console.log('='.repeat(50));

// ---- golden backward-compat ----

test('golden fixture: maxAffordablePrice(100000, 0.80) === 289983', () => {
  assert.equal(engine.maxAffordablePrice(100000, 0.80), 289983);
});

test('two-arg default call matches the legacy kernel constants exactly', () => {
  const kernel = loadHnaKernel(false);
  [40000, 78080, 97600, 100000, 150000, 250000].forEach((ami) => {
    [0.30, 0.60, 0.80, 1.00, 1.20].forEach((pct) => {
      assert.equal(engine.maxAffordablePrice(ami, pct), kernel.maxAffordablePrice(ami, pct),
        `ami=${ami} pct=${pct}`);
    });
  });
});

test('legacy alias keys behave EXACTLY like the kernel (parity, not reinterpretation)', () => {
  // The legacy kernel merges caller assumptions over canonical-named
  // defaults, so most alias keys are shadowed by defaults (only
  // pmms30YearRate is honored). The engine must reproduce that behavior
  // bit-for-bit — the contract is parity, not alias "fixing".
  const kernel = loadHnaKernel(false);
  const aliasInput = {
    pmms30YearRate: 0.07, paymentToIncome: 0.28, downPaymentPct: 0.05,
    propertyTaxPctAnnual: 0.006, insurancePctAnnual: 0.004, pmiPctAnnual: 0.006,
  };
  assert.equal(engine.maxAffordablePrice(100000, 0.80, aliasInput),
    kernel.maxAffordablePrice(100000, 0.80, aliasInput));
  // Canonical names are fully honored.
  const canonical = {
    rateAnnual: 0.07, frontEndRatio: 0.28, downPaymentRate: 0.05,
    propertyTaxRate: 0.006, insuranceRate: 0.004, pmiRate: 0.006,
  };
  const viaCanonical = engine.maxAffordablePrice(100000, 0.80, canonical);
  assert(Number.isFinite(viaCanonical) && viaCanonical > 0);
  assert(viaCanonical !== engine.maxAffordablePrice(100000, 0.80), 'canonical overrides take effect');
});

// ---- parity: soft delegation in hna-ownership-need.js ----

test('kernel WITH engine present delegates and returns identical values', () => {
  const withEngine = loadHnaKernel(true);
  const withoutEngine = loadHnaKernel(false);
  [50000, 97600, 123400].forEach((ami) => {
    [0.50, 0.80, 1.00, 1.20].forEach((pct) => {
      assert.equal(withEngine.maxAffordablePrice(ami, pct), withoutEngine.maxAffordablePrice(ami, pct),
        `parity ami=${ami} pct=${pct}`);
    });
  });
  // custom assumptions must also stay in parity
  const custom = { pmms30YearRate: 0.075, downPaymentRate: 0.20 };
  assert.equal(withEngine.maxAffordablePrice(97600, 1.0, custom),
    withoutEngine.maxAffordablePrice(97600, 1.0, custom));
});

test('incomeNeededForHomeValue matches kernel inversion', () => {
  const kernel = loadHnaKernel(false);
  [300000, 486295, 505589].forEach((price) => {
    assert.equal(engine.incomeNeededForHomeValue(price), kernel.incomeNeededForHomeValue(price), `price=${price}`);
  });
});

// ---- model registry ----

test('registry loads with exactly one default (conservative_screening)', () => {
  engine.setRegistry(registry);
  const defaults = registry.models.filter((m) => m.default);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].id, 'conservative_screening');
  assert.equal(engine.recommendedModel().id, 'conservative_screening');
});

test('every model carries implications (who_it_fits / buyer_risk / when_not_to_use)', () => {
  registry.models.forEach((m) => {
    assert(m.implications, m.id + ' has implications');
    ['who_it_fits', 'gap_direction', 'buyer_risk', 'when_not_to_use'].forEach((k) => {
      assert(typeof m.implications[k] === 'string' && m.implications[k].length > 0, m.id + '.' + k);
    });
    assert(m.classification, m.id + ' has classification');
  });
});

test('default model params reproduce the golden fixture through the registry path', () => {
  const results = engine.compareModels(100000, 0.80, ['conservative_screening']);
  assert.equal(results[0].maxPrice, 289983);
  assert.equal(results[0].isDefault, true);
  assert.equal(results[0].riskDisclosureRequired, false);
});

test('registry params are canonicalized: conventional_dti honors its 20% down payment', () => {
  const results = engine.compareModels(97600, 1.0, ['conservative_screening', 'conventional_dti', 'fha_insured']);
  const dti = results.find((r) => r.modelId === 'conventional_dti');
  // 20% down => buyer cash = price * 0.20 (no closing costs in this model)
  assert(Math.abs(dti.buyerCashRequired - dti.maxPrice * 0.20) <= 1,
    'conventional_dti cash reflects 20% down (was shadowed by the 10% default before the modelParams fix)');
  // 43% back-end + 20% down + no PMI must out-buy the conservative default
  const cons = results.find((r) => r.modelId === 'conservative_screening');
  const fha = results.find((r) => r.modelId === 'fha_insured');
  assert(dti.maxPrice > fha.maxPrice, 'conventional 20%-down out-buys FHA (MIP drag)');
  assert(fha.maxPrice > cons.maxPrice, 'permissive models out-buy the conservative default');
});

// ---- guardrails ----

test('recommendedModel is never the most permissive model', () => {
  const all = engine.compareModels(100000, 1.0);
  const recommended = all.find((r) => r.isDefault);
  const mostPermissive = all.filter((r) => !r.error && r.permissivenessRank != null)
    .sort((a, b) => b.permissivenessRank - a.permissivenessRank)[0];
  assert.notEqual(recommended.modelId, mostPermissive.modelId,
    'default must not be the most permissive model');
});

test('permissive results carry a mandatory risk disclosure', () => {
  const results = engine.compareModels(97600, 1.0, ['conservative_screening', 'conventional_dti']);
  const dti = results.find((r) => r.modelId === 'conventional_dti');
  assert.equal(dti.riskDisclosureRequired, true, 'conventional_dti flagged');
  assert(typeof dti.riskDisclosure === 'string' && dti.riskDisclosure.length > 10, 'disclosure text present');
  const cons = results.find((r) => r.modelId === 'conservative_screening');
  assert.equal(cons.riskDisclosureRequired, false);
});

test('percent/decimal mixing throws loudly', () => {
  assert.throws(() => engine.maxAffordablePrice(100000, 0.80, { rateAnnual: 6.5 }), /decimal/);
  assert.throws(() => engine.maxAffordablePrice(100000, 0.80, { frontEndRatio: 30 }), /decimal/);
});

// ---- monotonicity ----

test('higher rate / tax / insurance / PMI each lower buying power', () => {
  const base = engine.maxAffordablePrice(100000, 1.0);
  assert(engine.maxAffordablePrice(100000, 1.0, { rateAnnual: 0.08 }) < base, 'rate');
  assert(engine.maxAffordablePrice(100000, 1.0, { propertyTaxRate: 0.012 }) < base, 'tax');
  assert(engine.maxAffordablePrice(100000, 1.0, { insuranceRate: 0.009 }) < base, 'insurance');
  assert(engine.maxAffordablePrice(100000, 1.0, { pmiRate: 0.012 }) < base, 'pmi');
});

test('HOA and ground rent lower buying power (fixed monthly costs)', () => {
  const base = engine.maxAffordablePrice(100000, 1.0);
  const hoa = engine.maxAffordablePrice(100000, 1.0, { hoaMonthly: 200 });
  const ground = engine.maxAffordablePrice(100000, 1.0, { groundRentMonthly: 100 });
  assert(hoa < base, 'HOA lowers price');
  assert(ground < base, 'ground rent lowers price');
  assert(engine.maxAffordablePrice(100000, 1.0, { hoaMonthly: 200, groundRentMonthly: 100 }) < hoa);
});

test('larger down payment raises max price', () => {
  const d10 = engine.maxAffordablePrice(100000, 1.0, { downPaymentRate: 0.10 });
  const d20 = engine.maxAffordablePrice(100000, 1.0, { downPaymentRate: 0.20 });
  assert(d20 > d10);
});

test('pmiLtvGate removes PMI at >= 20% down', () => {
  const gated = engine.maxAffordablePrice(100000, 1.0, { downPaymentRate: 0.20, pmiLtvGate: true });
  const ungated = engine.maxAffordablePrice(100000, 1.0, { downPaymentRate: 0.20, pmiLtvGate: false });
  assert(gated > ungated, 'gated PMI = 0 buys more');
});

test('borrower debt lowers back-end DTI qualification', () => {
  const noDebt = engine.maxAffordablePrice(100000, 1.0, { housingRatioType: 'back', backEndRatio: 0.43 });
  const debt = engine.maxAffordablePrice(100000, 1.0, { housingRatioType: 'back', backEndRatio: 0.43, borrowerMonthlyDebt: 600 });
  assert(debt < noDebt);
});

// ---- household size ----

test('household-size adjustment: smaller household -> lower income -> lower price; 4 = unchanged', () => {
  const base = engine.maxAffordablePrice(100000, 1.0);
  assert.equal(engine.maxAffordablePrice(100000, 1.0, { householdSize: 4 }), base, 'size 4 preserves output');
  const two = engine.maxAffordablePrice(100000, 1.0, { householdSize: 2 });
  const six = engine.maxAffordablePrice(100000, 1.0, { householdSize: 6 });
  assert(two < base, '2-person < 4-person');
  assert(six > base, '6-person > 4-person');
  assert.equal(engine.householdSizeFactor(2), 0.80);
  assert.equal(engine.householdSizeFactor(4), 1.00);
});

// ---- edge handling ----

test('zero interest handled (no NaN/Infinity)', () => {
  const price = engine.maxAffordablePrice(100000, 1.0, { rateAnnual: 0 });
  assert(Number.isFinite(price) && price > 0);
});

test('negative capacity: fixed costs exceeding budget -> price 0, not negative', () => {
  const out = engine.computeBuyerCapacity(20000, 0.30, { hoaMonthly: 5000 });
  assert.equal(out.maxPrice, 0);
});

test('unusable income -> null (matches kernel)', () => {
  assert.equal(engine.maxAffordablePrice(0, 0.80), null);
  assert.equal(engine.maxAffordablePrice(null, 0.80), null);
});

test('buyerCashRequired and maxLoan are exposed and consistent', () => {
  const out = engine.computeBuyerCapacity(100000, 0.80, { closingCostRate: 0.03 });
  assert(Number.isFinite(out.maxLoan) && out.maxLoan > 0);
  assert(Number.isFinite(out.buyerCashRequired) && out.buyerCashRequired > 0);
  assert(Math.abs(out.maxLoan - out.maxPrice * 0.90) <= 1, 'loan = price * loanShare');
  assert(Math.abs(out.buyerCashRequired - out.maxPrice * 0.13) <= 1, 'cash = price * (down + closing)');
});

// ---- HTML wiring ----

test('both consumer pages load the engine BEFORE the HNA kernel', () => {
  ['deal-calculator.html', 'housing-needs-assessment.html'].forEach((page) => {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const engineIdx = html.indexOf('js/hna/ownership-finance.js');
    const kernelIdx = html.indexOf('js/hna/hna-ownership-need.js');
    assert(engineIdx >= 0, page + ' loads ownership-finance.js');
    assert(engineIdx < kernelIdx, page + ' loads engine before kernel');
  });
});

// ---- package wiring self-check (mirrors ownership-resale.test.js pattern) ----

test('package.json wires test:ownership-finance into test:ci', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(pkg.scripts['test:ownership-finance'], 'script exists');
  assert(pkg.scripts['test:ci'].includes('test:ownership-finance'), 'wired into test:ci');
});

console.log('\nOwnership finance: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(50));
if (failed > 0) process.exit(1);
