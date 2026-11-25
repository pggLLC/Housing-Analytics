#!/usr/bin/env node
'use strict';
// CHFA basis boost sizing (2027-28 QAP 3.M.2) and the workbook-style deal checks list.
// Every deal figure here is INVENTED (test/helpers/deal-engine-inputs.cjs).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { computeDeal, sizeChfaBoost, dealChecks } = require('../js/deal-engine.js');
const { inputsFor } = require('./helpers/deal-engine-inputs.cjs');

function inputs(edit) { const i = inputsFor('A'); if (edit) edit(i.fields); return i; }

test('a small gap is closed by a sized boost, rounded up to 0.1%', () => {
  const i = inputs((f) => { f['dc-equity-price'] = '0.7'; });
  const before = computeDeal(i);
  assert.ok(before.gap > 0, 'the invented deal has a gap');
  const s = sizeChfaBoost(i);
  assert.equal(s.status, 'sized', s.reason);
  assert.ok(s.pct > 0 && s.pct <= 30);
  assert.equal(Math.round(s.pct * 10), s.pct * 10, 'rounded to 0.1');
  assert.equal(s.citation, 'QAP 3.M.2');
  // The sized boost closes the gap; 0.1 less does not.
  const at = (pct) => computeDeal(Object.assign({}, i, { fields: Object.assign({}, i.fields, {
    'dc-boost-designation': 'chfa', 'dc-boost-evidence': 'test', 'dc-boost-pct': String(pct) }) })).gap;
  assert.ok(at(s.pct) <= 0.5, 'gap closed at ' + s.pct);
  if (s.pct > 0.1) assert.ok(at(Math.round((s.pct - 0.1) * 10) / 10) > 0.5, 'not closed below ' + s.pct);
});

test('a large gap reports what is still short at the most CHFA awards', () => {
  const s = sizeChfaBoost(inputs((f) => { f['dc-equity-price'] = '0.6'; }));
  assert.equal(s.status, 'not-enough', s.reason);
  assert.ok(s.gapAtMost > 0);
  assert.equal(s.maxPct, 30);
  assert.ok(['round', 'cost limit', 'basis', 'need'].includes(s.setBy));
});

test('no gap means no boost needed; 4% deals are not eligible', () => {
  const base = inputs();
  const r = computeDeal(base);
  if (r.gap <= 0.5) assert.equal(sizeChfaBoost(base).status, 'not-needed');
  const fourIn = inputs((f) => { f['dc-equity-price'] = '0.6'; });
  fourIn.creditRate = 0.04;
  const four = sizeChfaBoost(fourIn);
  assert.equal(four.status, 'na', four.reason);
});

test('the checks list covers each workbook check with a status and counts that add up', () => {
  const r = computeDeal(inputs((f) => { f['dc-equity-price'] = '0.6'; }));
  const c = dealChecks(r);
  const ids = c.items.map((x) => x.id);
  for (const id of ['gap', 'min_dcr', 'operating_reserve', 'deferred_fee', 'developer_fee', 'cost_limit', 'set_aside', 'reserve_drawn', 'market_test']) {
    assert.ok(ids.includes(id), 'has ' + id);
  }
  assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
  for (const x of c.items) {
    assert.ok(['pass', 'look', 'fail', 'na'].includes(x.status), x.id + ' status');
    assert.ok(x.label, x.id + ' has a label');
    if (x.status !== 'pass') assert.ok(x.detail, x.id + ' says why');
  }
  assert.equal(c.items.find((x) => x.id === 'gap').status, 'fail', 'a gap is a fail');
  assert.equal(c.items.find((x) => x.id === 'market_test').status, 'na', 'market test is not run here');
  const sum = c.counts.pass + c.counts.look + c.counts.fail + c.counts.na;
  assert.equal(sum, c.items.length);
});

test('the page has the boost line and the checks panel', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'deal-calculator.js'), 'utf8');
  for (const id of ['dc-boost-sizing', 'dc-checks-panel', 'dc-checks-summary', 'dc-checks-list']) {
    assert.ok(src.includes('id="' + id + '"'), id);
  }
  assert.ok(/renderWorkbookChecks\(result/.test(src), 'rendered with each result');
});

test('cash flow check needs all 15 years measured before it passes', () => {
  const full = dealChecks(computeDeal(inputs())).items.find((x) => x.id === 'reserve_drawn');
  assert.ok(full && full.status !== 'na', 'measured with full inputs: ' + (full && full.status));
  const noGrowth = dealChecks(computeDeal(inputs((f) => { f['pf-rent-growth'] = ''; }))).items.find((x) => x.id === 'reserve_drawn');
  assert.ok(noGrowth.status === 'na' || noGrowth.status === 'look', 'missing growth: ' + noGrowth.status);
  const five = dealChecks(computeDeal(inputs((f) => { f['pf-years'] = '5'; }))).items.find((x) => x.id === 'reserve_drawn');
  assert.ok(five.status === 'na' || five.status === 'look', 'five-year projection: ' + five.status);
});
