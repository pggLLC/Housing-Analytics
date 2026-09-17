#!/usr/bin/env node
/**
 * PMI stops at 20% down — in all three kernels, not one.
 *
 * Three places in this repo answer "what does PMI cost", and until now they
 * carried two different rules:
 *
 *   HNAUtils.computeIncomeNeeded    gated — passes pmiLtvGate:true at every
 *                                   call site, and its own fallback checks
 *                                   `downPaymentPct < 0.20` by hand
 *   OwnershipFinance DEFAULTS       ungated, documented "PMI 0.5% unconditional"
 *   HNAOwnershipNeed kernel         no gate at all — `loanShare * pmiRate / 12`
 *
 * Every one of them puts 10% down, so all three agreed and nothing was wrong
 * on screen. That is what makes it worth fixing rather than noting: a rule can
 * be missing for a long time when the only input it reacts to never changes,
 * and the day someone exposes a down-payment control the three surfaces start
 * answering the same question differently by roughly $18,000.
 *
 * The HNA's own disclosure has said "PMI 0.50% of loan/yr when down < 20%" the
 * whole time. So the gated rule is the one this site has committed to in
 * writing; the other two kernels were the ones out of step.
 *
 * ── Two models are deliberately NOT gated ──
 *
 * fha_insured pays MIP, which for most FHA loans since 2013 does not cancel at
 * 20% and runs for the life of the loan. usda_rd pays an annual guarantee fee,
 * which is not PMI either. Turning the gate on for those would not be
 * finishing this fix, it would be a new and wrong claim about two federal
 * products — so they are pinned ungated, with the reason, right here.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const OwnershipFinance = require('../js/hna/ownership-finance.js');

function ownershipNeedKernel() {
  // Loaded without a window on purpose: that is the path
  // build_jurisdiction_metrics_digest.mjs takes, and it is what produces
  // data/hna/ownership-need.json for all 546 geographies.
  const context = { window: {} };
  vm.runInNewContext(read('js/hna/hna-ownership-need.js'), context);
  return context.window.HNAOwnershipNeed;
}
const HNAOwnershipNeed = ownershipNeedKernel();

const SHARED = {
  rateAnnual: 0.065, termYears: 30, propertyTaxRate: 0.0065,
  insuranceRate: 0.0035, pmiRate: 0.005, frontEndRatio: 0.30
};

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); }
};

console.log('pmi-gate-is-one-rule');

/* ── One rule, three kernels ────────────────────────────────────────────── */

test('every kernel gives the same answer at every down payment', () => {
  // The fix, stated as the property it buys. Before it, these agreed only
  // below 20% — which is the one place they were ever asked.
  const disagreements = [];
  for (const down of [0, 0.035, 0.05, 0.10, 0.19, 0.195, 0.20, 0.25, 0.50]) {
    const finance = OwnershipFinance.maxAffordablePrice(100000, 0.80,
      Object.assign({}, SHARED, { downPaymentRate: down, pmiLtvGate: true }));
    const need = HNAOwnershipNeed.maxAffordablePrice(100000, 0.80, { downPaymentRate: down });
    if (Math.round(finance) !== Math.round(need)) {
      disagreements.push(`${(down * 100).toFixed(1)}% down: finance ${Math.round(finance)}, need ${Math.round(need)}`);
    }
  }
  assert.deepStrictEqual(disagreements, [],
    `the kernels answer differently:\n    ${disagreements.join('\n    ')}`);
});

test('the boundary is 20%, and it is a boundary', () => {
  const at = (down) => OwnershipFinance.maxAffordablePrice(100000, 0.80,
    Object.assign({}, SHARED, { downPaymentRate: down, pmiLtvGate: true }));
  const ungated = (down) => OwnershipFinance.maxAffordablePrice(100000, 0.80,
    Object.assign({}, SHARED, { downPaymentRate: down, pmiLtvGate: false }));

  // Just below: the gate must not fire.
  assert.strictEqual(Math.round(at(0.199)), Math.round(ungated(0.199)),
    'PMI was waived below 20% down');
  // At and above: it must.
  assert.ok(at(0.20) > ungated(0.20), 'PMI is still charged at exactly 20% down');
  assert.ok(at(0.25) > ungated(0.25), 'PMI is still charged at 25% down');
  // And the difference is material, so this is not a rounding argument.
  assert.ok(at(0.20) - ungated(0.20) > 10000,
    `the gate moves the answer by only $${Math.round(at(0.20) - ungated(0.20))}; check it is wired`);
});

test('nothing published today changes, because everything puts 10% down', () => {
  // The safety half. If this fails, the fix is not the no-op it claims to be
  // and the published figures moved.
  const gated = OwnershipFinance.maxAffordablePrice(100000, 0.80,
    Object.assign({}, SHARED, { downPaymentRate: 0.10, pmiLtvGate: true }));
  const ungated = OwnershipFinance.maxAffordablePrice(100000, 0.80,
    Object.assign({}, SHARED, { downPaymentRate: 0.10, pmiLtvGate: false }));
  assert.strictEqual(Math.round(gated), Math.round(ungated));
  // The golden fixture the whole engine is pinned to.
  assert.strictEqual(OwnershipFinance.maxAffordablePrice(100000, 0.80), 289983,
    'the backward-compatible kernel output moved');
});

/* ── The registry says the same thing ───────────────────────────────────── */

const REGISTRY = json('data/policy/affordability-models.json');
const modelById = Object.fromEntries(REGISTRY.models.map((m) => [m.id, m]));

test('both conventional-PMI models gate', () => {
  for (const id of ['conservative_screening', 'prop123_dpa_eligibility']) {
    const model = modelById[id];
    assert.ok(model, `${id} is gone from the registry`);
    assert.strictEqual(model.params.pmiLtvGate, true,
      `${id} charges PMI at any down payment, while the site's own disclosure says it stops at 20%`);
    assert.ok(model.params.pmiRate > 0, `${id} has no PMI rate, so the gate is meaningless`);
  }
});

test('FHA and USDA stay ungated, on purpose', () => {
  // Pinned with the reason so this is not "completed" later by someone
  // sweeping the flag to true. MIP is not PMI and does not cancel.
  const fha = modelById.fha_insured;
  assert.ok(fha, 'fha_insured is gone from the registry');
  assert.notStrictEqual(fha.params.pmiLtvGate, true,
    'fha_insured was gated. FHA MIP runs for the life of most loans written since '
    + '2013 and does not cancel at 20% — gating it understates the buyer\'s cost');
  assert.ok(fha.params.mipAnnualPct > 0, 'fha_insured no longer charges MIP at all');

  const usda = modelById.usda_rd;
  assert.ok(usda, 'usda_rd is gone from the registry');
  assert.notStrictEqual(usda.params.pmiLtvGate, true,
    'usda_rd was gated. It pays an annual guarantee fee, not PMI');
  assert.ok(usda.params.guaranteeFeeAnnualPct > 0, 'usda_rd no longer charges a guarantee fee');

  // conventional_dti already handled it the other way — zero PMI rather than a
  // gate — and that is fine. What matters is that it does not charge PMI at
  // its 20% down.
  const conv = modelById.conventional_dti;
  assert.strictEqual(conv.params.pmiRate, 0,
    'conventional_dti is a 20%-down product and must not charge PMI');
});

/* ── The published data is unaffected ───────────────────────────────────── */

test('the gate cannot fire on any shipped geography', () => {
  // The strongest form of "this changed nothing", and deliberately NOT a
  // re-derivation of data/hna/ownership-need.json: reproducing the digest
  // builder's input assembly here would make this file a fourth producer of
  // the thing it is checking, which is the failure mode this repo keeps
  // finding.
  //
  // Instead, the property: every shipped model puts less than 20% down, so the
  // gate is unreachable and no published figure can have moved. If a model
  // ever crosses 20%, this fails and someone re-derives the data on purpose.
  // A gated model only matters if it charges PMI at all. conventional_dti is
  // gated AND puts 20% down, but sets pmiRate: 0 — it solved this the other
  // way round, and the gate cannot move a rate that is already zero.
  const gatedModels = REGISTRY.models.filter((m) => m.params && m.params.pmiLtvGate === true
    && (m.params.pmiRate ?? 0) > 0);
  assert.ok(gatedModels.length >= 2, `only ${gatedModels.length} models both gate and charge PMI`);
  const wouldFire = gatedModels.filter((m) => (m.params.downPaymentPct ?? 0) >= 0.20);
  assert.deepStrictEqual(wouldFire.map((m) => m.id), [],
    `these gated models put 20% or more down, so turning the gate on CHANGES their `
    + `published figures — re-derive the affected data deliberately: ${wouldFire.map((m) => m.id).join(', ')}`);

  // And the kernel that writes data/hna/ownership-need.json runs at 10%.
  const constants = read('js/hna/hna-ownership-need.js');
  const down = /downPaymentRate: (0\.\d+)/.exec(constants);
  assert.ok(down, 'the ownership-need kernel no longer declares a down payment');
  assert.ok(Number(down[1]) < 0.20,
    `the ownership-need kernel now puts ${down[1]} down; the gate fires and the 546 `
    + 'published records need regenerating');

  // Belt and braces: at that down payment the two settings are identical.
  const at10gated = HNAOwnershipNeed.maxAffordablePrice(100000, 0.80, { downPaymentRate: Number(down[1]) });
  const at10ungated = OwnershipFinance.maxAffordablePrice(100000, 0.80,
    Object.assign({}, SHARED, { downPaymentRate: Number(down[1]), pmiLtvGate: false }));
  assert.strictEqual(Math.round(at10gated), Math.round(at10ungated),
    'the gate changes the answer at the kernel\'s own down payment');
});

/* ── The disclosure and the rule stay attached ──────────────────────────── */

test('the disclosure that states the rule is still on the page', () => {
  // If the sentence goes, the justification for the gate goes with it and this
  // whole file is arguing from a claim nobody makes any more.
  const src = read('js/hna/hna-renderers.js');
  assert.ok(/PMI[\s\S]{0,120}when down [^<]{0,12}20%/.test(src),
    'the affordability disclosure no longer states when PMI stops');
});

test('the gate is not left decorative in any kernel', () => {
  const need = read('js/hna/hna-ownership-need.js');
  assert.ok(/pmiLtvGate: true/.test(need),
    'the ownership-need constants no longer declare the gate');
  assert.ok(/assumptions\.pmiLtvGate && downPaymentRate >= 0\.20/.test(need),
    'the ownership-need Node kernel declares the gate but never applies it');
  const finance = read('js/hna/ownership-finance.js');
  assert.ok(/a\.pmiLtvGate && a\.downPaymentRate >= 0\.20/.test(finance),
    'ownership-finance no longer applies the gate');
});

console.log(failures === 0
  ? '  pmi-gate-is-one-rule: PASS'
  : `  pmi-gate-is-one-rule: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
