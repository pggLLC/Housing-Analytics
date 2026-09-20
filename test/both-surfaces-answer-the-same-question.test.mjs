#!/usr/bin/env node
/**
 * Step 3 and step 7 give the same answer to "how many homes are needed".
 *
 * ── What was wrong ──
 *
 * The guided path asks that question twice. Step 3 computes it live in
 * js/hna/hna-controller.js. Step 7 reads a precomputed metric,
 * future_units_needed_20yr, out of the jurisdiction digest via
 * js/workflow/recommendation-contract.js. Two producers, one question.
 *
 * #1770 fixed the live one. The precomputed one still carried resident
 * household growth alone, so on 2026-09-20 Pitkin County's digest held:
 *
 *     future_units_needed_20yr = -3
 *     workforce_gap_units      = 7554
 *
 * as ADJACENT KEYS IN THE SAME FILE, and the site published 7,554 on step 3
 * and "-3 homes over 20 years" on step 7. For Aspen, where 9,682 people
 * commute in because they cannot afford to live there.
 *
 * In build_ranking_index.py the two are computed in the same function about
 * twenty lines apart and never met.
 *
 * ── How this guard works ──
 *
 * It runs the SHIPPED _productionNeed from the controller over the committed
 * projections, and compares against the committed index for the same
 * jurisdiction. It measures the two producers against each other rather than
 * either against a pinned number, so a future data refresh moves both or
 * fails.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/hna/hna-controller.js'), 'utf8');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

function extract(name) {
  let i = SRC.indexOf('function ' + name + '(');
  assert.ok(i >= 0, `${name}() is gone — this guard is checking nothing`);
  if (SRC.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;
  let d = 0;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k += 1) {
    if (SRC[k] === '{') d += 1;
    else if (SRC[k] === '}') { d -= 1; if (!d) return SRC.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces');
}
const productionNeed = new Function(`${extract('_productionNeed')}; return _productionNeed;`)();

const index = readJson('data/hna/ranking-index.json');
const byGeoid = new Map(index.rankings.map((r) => [r.geoid, r]));

/** Counties carry their own projection file; that is where step 3 reads. */
const counties = [];
for (const f of fs.readdirSync(path.join(ROOT, 'data/hna/projections'))) {
  if (!/^\d{5}\.json$/.test(f)) continue;
  const geoid = f.slice(0, 5);
  const row = byGeoid.get(geoid);
  if (!row) continue;
  const p = readJson('data/hna/projections/' + f);
  const hn = p.housing_need || {};
  const j = (p.years || []).indexOf((p.baseYear || 2024) + 20);
  if (j < 0) continue;
  const needUnits = (hn.units_needed_dola || [])[j];
  if (needUnits == null) continue;
  counties.push({
    geoid,
    name: row.name,
    step3: productionNeed({
      needUnits: Number(needUnits),
      baseUnits: Number(p.base.housing_units),
      observedTotalVac: hn.observed_total_vacancy,
      activeVac: hn.active_market_vacancy,
      workforceGapUnits: row.metrics.workforce_gap_units ?? null,
    }),
    step7: row.metrics.future_units_needed_20yr,
    step7Reading: row.metrics.future_units_reading,
    workforce: row.metrics.workforce_gap_units ?? null,
  });
}

test('the comparison found both producers', () => {
  assert.ok(counties.length >= 55,
    `only ${counties.length} counties carry both a projection and an index row — every assertion below would pass vacuously`);
  const withReading = counties.filter((c) => c.step7Reading).length;
  assert.ok(withReading >= 55,
    `only ${withReading} index rows carry future_units_reading — the generator half of this fix is missing`);
});

test('neither surface tells a jurisdiction it has surplus housing while its workers commute in', () => {
  const lying = [];
  for (const c of counties) {
    if (!(c.workforce > 0)) continue;
    if (c.step3 && c.step3.units < 0) lying.push(`${c.name} step 3: ${Math.round(c.step3.units)}`);
    if (typeof c.step7 === 'number' && c.step7 < 0) lying.push(`${c.name} step 7: ${c.step7}`);
  }
  assert.deepEqual(lying, [],
    'these employ workers they cannot house and are told they have excess capacity:\n  ' + lying.join('\n  '));
});

test('when the workforce reading wins, both surfaces publish it', () => {
  const disagree = [];
  for (const c of counties) {
    if (!c.step3 || c.step3.basis !== 'workforce') continue;
    if (c.step7 !== c.workforce) {
      disagree.push(`${c.name}: step 3 says ${Math.round(c.step3.units)} (workforce), step 7 says ${c.step7}`);
    }
  }
  assert.deepEqual(disagree, [],
    'the guided path answers one question two ways:\n  ' + disagree.join('\n  '));
});

test('the index records which reading produced its figure', () => {
  const wrong = [];
  for (const c of counties) {
    if (typeof c.step7 !== 'number' || c.workforce == null) continue;
    const expected = c.step7 === c.workforce && c.workforce > 0 ? 'workforce' : 'resident_growth';
    // Only assert the direction the data makes unambiguous: a figure equal to
    // the workforce gap must not claim to be resident growth.
    if (expected === 'workforce' && c.step7Reading !== 'workforce') {
      wrong.push(`${c.name}: publishes ${c.step7} (= workforce gap) but labels it ${c.step7Reading}`);
    }
  }
  assert.deepEqual(wrong, [], wrong.join('\n  '));
});

test('Pitkin County, the case this was found on', () => {
  const c = counties.find((x) => x.geoid === '08097');
  assert.ok(c, 'Pitkin County has left the dataset — this guard is checking less than it claims');
  assert.equal(c.step7, 7554,
    `step 7 publishes ${c.step7}; it published -3 before this fix, against a workforce gap of ${c.workforce}`);
  assert.equal(c.step7Reading, 'workforce');
  assert.equal(Math.round(c.step3.units), c.step7, 'the two steps disagree again');
});
