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
 * Since 2026-10-20 both producers add the same two parts: resident growth
 * (the rise in homes needed, DOLA's incremental form) and homes for a quarter
 * of today's lower- and middle-wage in-commuters (data/hna/workforce-need.json).
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
const workforceNeed = readJson('data/hna/workforce-need.json');

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
  const b = (p.years || []).indexOf(p.baseYear || 2024);
  if (j < 0 || b < 0) continue;
  const needUnits = (hn.units_needed_dola || [])[j];
  const baseNeedUnits = (hn.units_needed_dola || [])[b];
  if (needUnits == null || baseNeedUnits == null) continue;
  const inc = workforceNeed.counties[geoid] && workforceNeed.counties[geoid].present_incommuter_need;
  counties.push({
    geoid,
    name: row.name,
    // At the county's own target vacancy, which is where the page's vacancy
    // control starts for a county and what the stored figure was built at.
    step3: productionNeed({
      needUnits: Number(needUnits),
      baseNeedUnits: Number(baseNeedUnits),
      incommuterUnits: inc ? inc.move_closer_25 : null,
    }),
    step7: row.metrics.future_units_needed_20yr,
    step7Reading: row.metrics.future_units_reading,
    step7Growth: row.metrics.future_units_growth_20yr,
    step7Incommuters: row.metrics.incommuter_need_units,
    jobsReading: row.metrics.workforce_gap_units ?? null,
  });
}

test('the comparison found both producers', () => {
  assert.ok(counties.length >= 55,
    `only ${counties.length} counties carry both a projection and an index row — every assertion below would pass vacuously`);
  const withReading = counties.filter((c) => c.step7Reading).length;
  assert.ok(withReading >= 55,
    `only ${withReading} index rows carry future_units_reading — the generator half of this fix is missing`);
});

test('both surfaces give the same 20-year figure, from the same two parts', () => {
  const disagree = [];
  for (const c of counties) {
    if (!c.step3 || typeof c.step7 !== 'number') { disagree.push(`${c.name}: step 3 ${c.step3 && c.step3.units}, step 7 ${c.step7}`); continue; }
    if (Math.abs(c.step3.units - c.step7) > 1) disagree.push(`${c.name}: step 3 says ${Math.round(c.step3.units)}, step 7 says ${c.step7}`);
    if (c.step3.basis !== c.step7Reading) disagree.push(`${c.name}: step 3 counts ${c.step3.basis}, step 7 ${c.step7Reading}`);
    if (c.step3.incommuterUnits !== (c.step7Incommuters ?? null)) disagree.push(`${c.name}: in-commuters ${c.step3.incommuterUnits} vs ${c.step7Incommuters}`);
    if (Math.abs(c.step3.growthUnits - c.step7Growth) > 1) disagree.push(`${c.name}: growth ${Math.round(c.step3.growthUnits)} vs ${c.step7Growth}`);
  }
  assert.deepEqual(disagree, [], 'the guided path answers one question two ways:\n  ' + disagree.join('\n  '));
});

test('the index publishes growth plus in-commuters, never the jobs reading', () => {
  const wrong = [];
  for (const c of counties) {
    if (c.step7Reading === 'resident_growth_plus_incommuters') {
      if (c.step7 !== c.step7Growth + c.step7Incommuters) wrong.push(`${c.name}: ${c.step7} is not ${c.step7Growth} + ${c.step7Incommuters}`);
    } else if (c.step7Reading === 'resident_growth') {
      if (c.step7 !== c.step7Growth) wrong.push(`${c.name}: ${c.step7} labelled resident growth but growth is ${c.step7Growth}`);
    } else {
      wrong.push(`${c.name}: reading ${c.step7Reading}`);
    }
  }
  assert.deepEqual(wrong, [], wrong.join('\n  '));
});

test('neither surface tells a county it has surplus housing while its households grow', () => {
  const lying = counties.filter((c) => c.step7 < 0 && !(c.step7Growth < 0)).map((c) => `${c.name}: ${c.step7}`);
  assert.deepEqual(lying, [], lying.join('\n  '));
});

test('Pitkin County, the case this was found on', () => {
  const c = counties.find((x) => x.geoid === '08097');
  assert.ok(c, 'Pitkin County has left the dataset — this guard is checking less than it claims');
  assert.ok(c.step7 > 0, `step 7 publishes ${c.step7}; it published -3 before #1771`);
  assert.equal(c.step7Reading, 'resident_growth_plus_incommuters');
  assert.notEqual(c.step7, c.jobsReading, 'step 7 publishes the jobs reading again');
  assert.equal(Math.round(c.step3.units), c.step7, 'the two steps disagree again');
});
