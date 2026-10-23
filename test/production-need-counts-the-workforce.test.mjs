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
 * Third defect, 2026-10-20: the fix for the second was max(growth,
 * workforce_gap_units), and the jobs reading counts one job as one home,
 * including jobs held by people who already live here. It won for most
 * places and put a present shortfall in the 20-year slot (Aspen 4,447 against
 * 73 of growth). The figure is now resident growth PLUS today's in-commuters
 * who would move closer, counted as households (data/hna/workforce-need.json,
 * a quarter of in-commuter households at or below 120% AMI). Removing the max exposed
 * the active-stock subtraction: Summit's ACS rental vacancy is 41.9%, short-
 * term rentals included, so its "active stock" exceeded the homes it needs
 * and it read -6,712. Resident growth is now the rise in homes needed from
 * the base year, DOLA's own incremental form, with no stock count in it.
 *
 * ── How this guard works ──
 *
 * It extracts the SHIPPED _productionNeed out of js/hna/hna-controller.js and
 * runs it against the committed projections and in-commuter file, so it
 * measures the deployed arithmetic rather than a copy of it. It asserts
 * PROPERTIES rather than pinning 64 numbers that move with every refresh.
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

const workforceNeed = readJson('data/hna/workforce-need.json');

/** Every county with a projection, its stored need at both ends, and its in-commuter need. */
const counties = (() => {
  const idx = readJson('data/hna/ranking-index.json');
  const nm = new Map(idx.rankings.map((r) => [r.geoid, r.name]));
  const out = [];
  const dir = path.join(ROOT, 'data/hna/projections');
  for (const f of fs.readdirSync(dir)) {
    if (!/^\d{5}\.json$/.test(f)) continue;
    const geoid = f.slice(0, 5);
    const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const hn = p.housing_need || {};
    const j = (p.years || []).indexOf((p.baseYear || 2024) + 20);
    const b = (p.years || []).indexOf(p.baseYear || 2024);
    if (j < 0 || b < 0) continue;
    const needUnits = (hn.units_needed_dola || [])[j];
    const baseNeedUnits = (hn.units_needed_dola || [])[b];
    if (needUnits == null || baseNeedUnits == null) continue;
    const inc = workforceNeed.counties[geoid] && workforceNeed.counties[geoid].present_incommuter_need;
    out.push({
      geoid,
      name: nm.get(geoid) || geoid,
      needUnits: Number(needUnits),
      baseNeedUnits: Number(baseNeedUnits),
      baseUnits: Number(p.base.housing_units),
      dolaIncremental: (hn.incremental_units_needed_dola || [])[j],
      incommuterUnits: inc ? inc.move_closer_25 : null,
    });
  }
  return out;
})();

test('the measurement found something to measure', () => {
  assert.ok(counties.length >= 55,
    `only ${counties.length} counties resolved — the fixture walk is broken and every assertion below would pass vacuously`);
  const withInc = counties.filter((c) => c.incommuterUnits != null).length;
  assert.ok(withInc >= 55, `only ${withInc} counties carry an in-commuter need`);
});

test('the figure is resident growth plus today’s in-commuters, and both parts are kept', () => {
  for (const c of counties) {
    const r = productionNeed(c);
    assert.ok(r, `${c.name}: no figure`);
    if (c.incommuterUnits == null) continue;
    assert.equal(r.basis, 'resident_growth_plus_incommuters', `${c.name}: basis ${r.basis}`);
    assert.equal(r.incommuterUnits, c.incommuterUnits, `${c.name}: in-commuter part ${r.incommuterUnits}, file ${c.incommuterUnits}`);
    assert.ok(Math.abs(r.units - (r.growthUnits + r.incommuterUnits)) < 1e-9,
      `${c.name}: published ${r.units}, but growth ${r.growthUnits} + in-commuters ${r.incommuterUnits} — a max or a blend, not a sum`);
  }
});

test('resident growth is the rise in homes needed, and no stock count enters it', () => {
  // The stock subtraction is what told Pitkin (total stock) and then Summit
  // (an active stock inflated by short-term rentals) that they had surplus.
  // Growth must equal DOLA's own stored incremental figure, and moving the
  // housing stock must not move it.
  for (const c of counties) {
    const r = productionNeed(c);
    assert.ok(Math.abs(r.growthUnits - Number(c.dolaIncremental)) < 1,
      `${c.name}: growth ${Math.round(r.growthUnits)} but DOLA's stored incremental units are ${Math.round(c.dolaIncremental)}`);
    const moved = productionNeed({ ...c, baseUnits: c.baseUnits * 2, observedTotalVac: 0.6, activeVac: 0.4 });
    assert.equal(moved.units, r.units, `${c.name}: the figure moved with the housing stock`);
  }
});

test('a surplus is published only where projected households fall', () => {
  const wrong = counties.map((c) => ({ c, r: productionNeed(c) }))
    .filter(({ r }) => r.units < 0 && !(r.growthUnits < 0))
    .map(({ c, r }) => `${c.name}: ${Math.round(r.units)} with growth ${Math.round(r.growthUnits)}`);
  assert.deepEqual(wrong, [], 'told they have excess capacity while households grow:\n  ' + wrong.join('\n  '));
});

test('a jurisdiction with no in-commuter record still gets an answer, and says what it counts', () => {
  const c = counties[0];
  const r = productionNeed({ ...c, incommuterUnits: null });
  assert.ok(r && r.units != null, 'dropping the in-commuter part produced no answer at all');
  assert.equal(r.basis, 'resident_growth');
  assert.equal(r.units, r.growthUnits);
});

test('no growth projection, no figure: a sum with an unknown part is unknown', () => {
  const r = productionNeed({ needUnits: null, baseNeedUnits: null, incommuterUnits: 500 });
  assert.equal(r, null, 'an in-commuter number alone was published as the 20-year figure');
});

test('the resort counties this was found on are not told they have surplus', () => {
  // Named because a property test can hold while the case that motivated it
  // regresses: the four largest surpluses measured on 2026-09-20, and Grand,
  // which the active-stock form read as a surplus on 2026-10-20.
  const named = { '08117': 'Summit', '08037': 'Eagle', '08097': 'Pitkin', '08107': 'Routt', '08049': 'Grand' };
  for (const [geoid, label] of Object.entries(named)) {
    const c = counties.find((x) => x.geoid === geoid);
    assert.ok(c, `${label} County (${geoid}) has left the dataset — this guard is checking less than it claims`);
    const r = productionNeed(c);
    assert.ok(r.units > 0, `${label} County publishes ${Math.round(r.units)} units of need`);
  }
});
