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

// ---- Codex QA corrections (PR #1388 re-review) ----

console.log('\n  -- Codex QA corrections --');

test('C1: modelId string is a working third argument (repro: conventional_dti !== 289983)', () => {
  const viaId = engine.maxAffordablePrice(100000, 0.80, 'conventional_dti');
  assert.notEqual(viaId, 289983, 'model id must not silently fall back to the default model');
  const viaComparator = engine.compareModels(100000, 0.80, ['conventional_dti'])[0].maxPrice;
  assert.equal(viaId, viaComparator, 'direct model-id call matches the comparator');
  // { modelId, ...overrides } form: overrides win over model params
  const withHoa = engine.maxAffordablePrice(100000, 0.80, { modelId: 'conventional_dti', hoaMonthly: 300 });
  assert(withHoa < viaId, 'override merges on top of the model');
  assert.throws(() => engine.maxAffordablePrice(100000, 0.80, 'no_such_model'), /unknown model/);
});

test('C1: Node lazily loads the production registry (no setRegistry call needed)', () => {
  const enginePath = require.resolve(path.join(ROOT, 'js/hna/ownership-finance.js'));
  const cached = require.cache[enginePath];
  delete require.cache[enginePath];
  try {
    const fresh = require(enginePath);
    assert.equal(fresh.getRegistry(), null, 'fresh instance starts with no registry');
    const price = fresh.maxAffordablePrice(100000, 0.80, 'conventional_dti');
    assert(Number.isFinite(price) && price !== 289983, 'model id works via lazy require of ' + fresh.REGISTRY_PATH);
    assert(fresh.getRegistry(), 'registry auto-loaded');
  } finally {
    require.cache[enginePath] = cached;
  }
});

test('C2: deal-calculator.js prefers the shared engine in its resolution chain', () => {
  const dcSrc = fs.readFileSync(path.join(ROOT, 'js/deal-calculator.js'), 'utf8');
  const chainIdx = dcSrc.indexOf('window.OwnershipFinance && window.OwnershipFinance.maxAffordablePrice');
  const kernelIdx = dcSrc.indexOf('window.HNAOwnershipNeed && window.HNAOwnershipNeed.maxAffordablePrice');
  assert(chainIdx >= 0, 'engine appears in the chain');
  assert(chainIdx < kernelIdx, 'engine is preferred over the kernel fallback');
});

function loadHnaUtils(withEngine) {
  const src = fs.readFileSync(path.join(ROOT, 'js/hna/hna-utils.js'), 'utf8');
  const win = withEngine ? { OwnershipFinance: engine } : {};
  const documentStub = {
    readyState: 'complete',
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ style: {}, appendChild: () => {}, setAttribute: () => {} }),
  };
  const sandbox = {
    window: win, document: documentStub, console,
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: {}, Math, Number, Object, Array, JSON, Promise, isFinite, setTimeout, clearTimeout,
    URLSearchParams, URL, Date, RegExp, String, parseFloat, parseInt, Map, Set,
    location: { search: '', href: '', pathname: '/' },
  };
  sandbox.window.document = documentStub;
  vm.runInNewContext(src, sandbox);
  return win.HNAUtils;
}

test('C2: HNAUtils.computeIncomeNeeded delegates to the engine with EXACT parity', () => {
  const utilsWith = loadHnaUtils(true);
  const utilsWithout = loadHnaUtils(false);
  [250000, 486295, 750000].forEach((price) => {
    const a = utilsWith.computeIncomeNeeded(price);
    const b = utilsWithout.computeIncomeNeeded(price);
    assert(Math.abs(a.annualIncome - b.annualIncome) < 1e-6, `annualIncome parity at ${price}`);
    assert(Math.abs(a.payment - b.payment) < 1e-6, `payment parity at ${price}`);
    assert(Math.abs(a.components.pAndI - b.components.pAndI) < 1e-6, `pAndI parity at ${price}`);
    assert.equal(a.down, b.down);
    assert.equal(a.loan, b.loan);
  });
  // and the delegated path really is the engine's closed form
  const viaEngine = engine.incomeRequiredForPrice(486295, { pmiLtvGate: true });
  assert(Math.abs(utilsWith.computeIncomeNeeded(486295).annualIncome - viaEngine.annualIncome) < 1e-6);
});

function loadPanel(withEngine, fredRate) {
  const src = fs.readFileSync(path.join(ROOT, 'js/affordability-metrics-panel.js'), 'utf8');
  const win = withEngine ? { OwnershipFinance: engine } : {};
  const documentStub = {
    readyState: 'complete',
    getElementById: () => null,
    addEventListener: () => {},
    querySelectorAll: () => [],
  };
  const sandbox = {
    window: win, document: documentStub, console,
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) }),
    Math, Number, Object, Array, JSON, Promise, isFinite, setTimeout,
  };
  vm.runInNewContext(src, sandbox);
  return win.AffordabilityMetrics;
}

test('C2: affordability panel sources required_hhi_for_home from the engine when present', () => {
  const rec = { median_home_price: 500000, median_hh_income: 90000 };
  const withEngine = loadPanel(true).compute(rec, 1750);
  const withoutEngine = loadPanel(false).compute(rec, 1750);
  const expected = engine.incomeRequiredForPrice(500000, { rateAnnual: withEngine.mortgage_rate / 100 }).annualIncome;
  assert(Math.abs(withEngine.required_hhi_for_home - expected) < 1e-6, 'engine path used');
  // legacy proxy (P&I × 1.25 / 0.30) still works engine-less and differs by design
  assert(Number.isFinite(withoutEngine.required_hhi_for_home));
  assert.notEqual(Math.round(withEngine.required_hhi_for_home), Math.round(withoutEngine.required_hhi_for_home),
    'engine component model deliberately replaces the ×1.25 proxy');
});

test('C2: colorado-deep-dive.html loads the engine before the panel', () => {
  const html = fs.readFileSync(path.join(ROOT, 'colorado-deep-dive.html'), 'utf8');
  const engineIdx = html.indexOf('js/hna/ownership-finance.js');
  const panelIdx = html.indexOf('js/affordability-metrics-panel.js');
  assert(engineIdx >= 0 && engineIdx < panelIdx);
});

test('C3: custom model with aggressive OVERRIDES gets the risk disclosure (resolved-assumption ranking)', () => {
  const results = engine.compareModels(100000, 1.0, ['custom'], {
    overrides: { frontEndRatio: 0.60, downPaymentRate: 0 },
  });
  assert.equal(results[0].riskDisclosureRequired, true,
    'permissiveness must be judged on resolved assumptions, not static registry params');
  assert(results[0].riskDisclosure && results[0].riskDisclosure.length > 0);
  // and mild custom overrides stay un-flagged
  const mild = engine.compareModels(100000, 1.0, ['custom'], {
    overrides: { frontEndRatio: 0.28, downPaymentRate: 0.15 },
  });
  assert.equal(mild[0].riskDisclosureRequired, false);
});

test('C4: compareModels returns the signed gap against a target price', () => {
  const target = 486295;
  const results = engine.compareModels(97600, 1.0, ['conservative_screening', 'conventional_dti'], {
    targetPrice: target,
  });
  const cons = results.find((r) => r.modelId === 'conservative_screening');
  const dti = results.find((r) => r.modelId === 'conventional_dti');
  assert.equal(cons.targetPrice, target);
  assert.equal(cons.gapVsTargetPrice, cons.maxPrice - target, 'signed: negative = shortfall');
  assert(cons.gapVsTargetPrice < 0, 'conservative buyer falls short of the Fruita median');
  assert.equal(cons.subsidyNeededPerUnit, target - cons.maxPrice);
  assert(dti.gapVsTargetPrice > 0, 'permissive model shows headroom (positive)');
  assert.equal(dti.subsidyNeededPerUnit, 0);
  // no target → null, not 0
  const noTarget = engine.compareModels(97600, 1.0, ['conservative_screening'])[0];
  assert.equal(noTarget.gapVsTargetPrice, null);
  assert.equal(noTarget.subsidyNeededPerUnit, null);
});

test('C5: negative income inputs return null, never 0', () => {
  assert.equal(engine.maxAffordablePrice(-100000, 0.80), null);
  assert.equal(engine.maxAffordablePrice(100000, -0.80), null);
  assert.equal(engine.computeBuyerCapacity(-1, 1), null);
  const kernel = loadHnaKernel(true);
  assert.equal(kernel.maxAffordablePrice(-100000, 0.80), null, 'delegated kernel path agrees');
});

test('C6: engine DEFAULTS match kernel CONSTANTS.affordabilityAssumptions field-by-field', () => {
  const kernel = loadHnaKernel(false);
  const k = kernel.CONSTANTS.affordabilityAssumptions;
  assert.equal(engine.DEFAULTS.rateAnnual, k.pmms30YearRate, 'rateAnnual vs pmms30YearRate');
  assert.equal(engine.DEFAULTS.termYears, k.termYears, 'termYears');
  assert.equal(engine.DEFAULTS.frontEndRatio, k.frontEndRatio, 'frontEndRatio');
  assert.equal(engine.DEFAULTS.downPaymentRate, k.downPaymentRate, 'downPaymentRate');
  assert.equal(engine.DEFAULTS.propertyTaxRate, k.propertyTaxRate, 'propertyTaxRate');
  assert.equal(engine.DEFAULTS.insuranceRate, k.insuranceRate, 'insuranceRate');
  assert.equal(engine.DEFAULTS.pmiRate, k.pmiRate, 'pmiRate');
});

test('C7: USDA front-end cap (29%) binds — housing budget is capped below the 41% back-end', () => {
  const capped = engine.maxAffordablePrice(97600, 1.0, 'usda_rd');
  const uncapped = engine.maxAffordablePrice(97600, 1.0, {
    modelId: 'usda_rd', frontEndRatioCap: null,
  });
  assert(capped < uncapped, 'cap lowers the max price');
  // 29/41: capped budget ratio ≈ 29/41 of uncapped (fee terms identical)
  assert(Math.abs(capped / uncapped - 0.29 / 0.41) < 0.001, '29/41 ratio reflected');
});

test('C7: FHA/USDA upfront fees are financed into the loan (lower price, larger loan share)', () => {
  const fhaWith = engine.computeBuyerCapacity(97600, 1.0, 'fha_insured');
  const fhaWithout = engine.computeBuyerCapacity(97600, 1.0, { modelId: 'fha_insured', mipUpfrontPct: 0 });
  assert(fhaWith.maxPrice < fhaWithout.maxPrice, 'upfront MIP reduces buying power');
  assert(fhaWith.maxLoan > fhaWith.maxPrice * (1 - 0.035), 'financed fee makes loan exceed price×(1−down)');
  const usdaWith = engine.computeBuyerCapacity(97600, 1.0, 'usda_rd');
  const usdaWithout = engine.computeBuyerCapacity(97600, 1.0, { modelId: 'usda_rd', guaranteeFeeUpfrontPct: 0 });
  assert(usdaWith.maxPrice < usdaWithout.maxPrice, 'upfront guarantee fee reduces buying power');
  assert(usdaWith.maxLoan > usdaWith.maxPrice, '0-down USDA loan exceeds price once the fee is financed');
});

console.log('\nOwnership finance: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(50));
if (failed > 0) process.exit(1);
