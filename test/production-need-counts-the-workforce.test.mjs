#!/usr/bin/env node
/**
 * A county that houses none of its workers does not have surplus housing.
 *
 * ── What was wrong ──
 *
 * The 20-year production figure — the headline answer to "how many homes are
 * needed", shown on the What-housing-exists decision strip and carried to the
 * Recommendation — was computed as:
 *
 *     incUnits = needUnits - baseUnits
 *
 * where needUnits housed projected households at the ACTIVE-MARKET vacancy and
 * baseUnits was the TOTAL housing stock. Demand measured on the active market;
 * supply counted with the second homes. In a resort county those are not the
 * same market.
 *
 * Pitkin County, measured 2026-09-20: 13,677 units at 39.3% total vacancy,
 * 6.7% active-market vacancy, 8,303 projected households.
 *     8,899 - 13,677 = -4,778  ->  "Estimated surplus of 4,937 units"
 * published for Aspen, where 9,682 people commute in because they cannot
 * afford to live there and renter cost burden is 45.2%.
 *
 * 47 of 64 Colorado counties published a surplus. Every mountain resort county
 * was among them: Summit -17,331. Eagle -6,244. Routt -4,265. San Miguel
 * -1,961.
 *
 * Second defect, same figure: resident growth cannot see a workforce that has
 * already been priced out — they are not residents, so they are not projected
 * households. #1733 built the jobs-side reading (workforce_gap_units, LODES
 * workplace-area counts against units affordable at <=60% AMI) and this page
 * never used it, so the site simultaneously held "7,554 units needed" and
 * "surplus of 4,937 units" for the same county on the same day.
 *
 * ── How this guard works ──
 *
 * It extracts the SHIPPED _productionNeed out of js/hna/hna-controller.js and
 * runs it against the committed projections and ranking index, so it measures
 * the deployed arithmetic rather than a copy of it. It asserts PROPERTIES —
 * max not blend, active stock not total stock, no surplus where a workforce
 * gap exists — rather than pinning 64 numbers that move with every data
 * refresh.
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
  assert.ok(i >= 0, `${name}() is gone from hna-controller.js — this guard is checking nothing`);
  if (SRC.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;
  let depth = 0;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k += 1) {
    if (SRC[k] === '{') depth += 1;
    else if (SRC[k] === '}') { depth -= 1; if (!depth) return SRC.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces reading ' + name);
}

const productionNeed = new Function(`${extract('_productionNeed')}; return _productionNeed;`)();

/** Every county with both a projection and a workforce reading. */
const counties = (() => {
  const idx = readJson('data/hna/ranking-index.json');
  const wf = new Map();
  const nm = new Map();
  for (const r of idx.rankings) {
    nm.set(r.geoid, r.name);
    const v = r.metrics && r.metrics.workforce_gap_units;
    if (v != null && Number.isFinite(Number(v))) wf.set(r.geoid, Number(v));
  }
  const out = [];
  const dir = path.join(ROOT, 'data/hna/projections');
  for (const f of fs.readdirSync(dir)) {
    if (!/^\d{5}\.json$/.test(f)) continue;
    const geoid = f.slice(0, 5);
    const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const hn = p.housing_need || {};
    const j = (p.years || []).indexOf((p.baseYear || 2024) + 20);
    if (j < 0) continue;
    const needUnits = (hn.units_needed_dola || [])[j];
    if (needUnits == null) continue;
    out.push({
      geoid,
      name: nm.get(geoid) || geoid,
      needUnits: Number(needUnits),
      baseUnits: Number(p.base.housing_units),
      observedTotalVac: hn.observed_total_vacancy,
      activeVac: hn.active_market_vacancy,
      workforceGapUnits: wf.get(geoid) ?? null,
    });
  }
  return out;
})();

test('the measurement found something to measure', () => {
  assert.ok(counties.length >= 55,
    `only ${counties.length} counties resolved — the fixture walk is broken and every assertion below would pass vacuously`);
  const withWf = counties.filter((c) => c.workforceGapUnits != null).length;
  assert.ok(withWf >= 40, `only ${withWf} counties carry workforce_gap_units`);
});

test('no jurisdiction with a workforce shortfall is told it has surplus housing', () => {
  const lying = [];
  for (const c of counties) {
    if (!(c.workforceGapUnits > 0)) continue;
    const r = productionNeed(c);
    if (r && r.units < 0) lying.push(`${c.name}: ${Math.round(r.units)} units while ${c.workforceGapUnits} workers need homes`);
  }
  assert.deepEqual(lying, [],
    'these employ workers they cannot house and are told they have excess capacity:\n  ' + lying.join('\n  '));
});

test('the answer is the larger reading, never a blend', () => {
  // A blend lets a place average away a need it is already exporting, which is
  // the owner's standing rule for this metric and the reason #1733 used max().
  for (const c of counties) {
    const r = productionNeed(c);
    if (!r) continue;
    const parts = [r.growthUnits, r.workforceUnits].filter((v) => v != null);
    if (!parts.length) continue;
    const biggest = Math.max(...parts);
    assert.equal(Math.round(r.units), Math.round(biggest),
      `${c.name}: published ${Math.round(r.units)} but the readings were ` +
      `growth=${r.growthUnits == null ? 'n/a' : Math.round(r.growthUnits)} ` +
      `workforce=${r.workforceUnits == null ? 'n/a' : r.workforceUnits} — a blend, not a max`);
  }
});

test('supply is counted on the market demand was measured in', () => {
  // Demand houses households at the ACTIVE-MARKET vacancy. Subtracting the
  // total stock counts second homes as available supply.
  const seasonal = counties.filter((c) =>
    c.observedTotalVac != null && c.activeVac != null && c.observedTotalVac > c.activeVac + 0.05);
  assert.ok(seasonal.length >= 5,
    `only ${seasonal.length} counties have a seasonal split — this assertion needs them to mean anything`);
  for (const c of seasonal) {
    const r = productionNeed(c);
    assert.equal(r.stockBasis, 'active_market_stock',
      `${c.name} has ${(c.observedTotalVac * 100).toFixed(1)}% total vs ${(c.activeVac * 100).toFixed(1)}% active vacancy but supply was counted as ${r.stockBasis}`);
    assert.ok(r.activeStock < c.baseUnits,
      `${c.name}: active stock ${Math.round(r.activeStock)} should be below total stock ${c.baseUnits}`);
    // The label is not the arithmetic. An earlier version of this guard
    // asserted only stockBasis, and reverting the subtraction to the TOTAL
    // stock passed it — the label is computed separately and stayed correct
    // while the number went back to being wrong. Assert the relationship the
    // label claims.
    assert.ok(Math.abs(r.growthUnits - (c.needUnits - r.activeStock)) < 1,
      `${c.name}: growth reading is ${Math.round(r.growthUnits)} but needUnits - activeStock is ` +
      `${Math.round(c.needUnits - r.activeStock)} — the figure was not computed against the stock ` +
      `its own stockBasis says it used`);
    assert.ok(Math.abs(r.growthUnits - (c.needUnits - c.baseUnits)) > 1,
      `${c.name}: growth reading equals needUnits - TOTAL stock, which is the original defect`);
  }
});

test('a jurisdiction with no workforce reading still gets an answer', () => {
  // The workforce half is an augmentation. Losing it must degrade to the
  // resident-growth reading, not to nothing.
  const c = counties[0];
  const r = productionNeed({ ...c, workforceGapUnits: null });
  assert.ok(r && r.units != null, 'dropping the workforce reading produced no answer at all');
  assert.equal(r.basis, 'resident_growth');
});

test('the resort counties this was found on are no longer told they have surplus', () => {
  // Named because a property test can hold while the case that motivated it
  // regresses. These are the four largest surpluses measured on 2026-09-20.
  const named = { '08117': 'Summit', '08037': 'Eagle', '08097': 'Pitkin', '08107': 'Routt' };
  for (const [geoid, label] of Object.entries(named)) {
    const c = counties.find((x) => x.geoid === geoid);
    assert.ok(c, `${label} County (${geoid}) has left the dataset — this guard is checking less than it claims`);
    const r = productionNeed(c);
    assert.ok(r.units > 0,
      `${label} County publishes ${Math.round(r.units)} units of need — it was -${Math.abs(Math.round(c.needUnits - c.baseUnits))} before this fix and must not return to a surplus`);
  }
});
