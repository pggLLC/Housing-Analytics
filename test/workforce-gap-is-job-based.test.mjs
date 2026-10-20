#!/usr/bin/env node
/**
 * The housing gap must not be something a jurisdiction can zero out by
 * pricing its workforce into the next town.
 *
 * ── What was wrong ──
 *
 * `housing_gap_units` counts affordable units against renter households who
 * LIVE in a place. Both terms stop at the municipal boundary, so the gap has
 * a trivial solution: export the households. 190 of 546 geographies carried a
 * resident gap of exactly 0, and every one of those zeros was arithmetically
 * correct. Snowmass Village read 0 at every AMI tier while 2,833 people
 * commuted in to work there.
 *
 * Exporting a workforce is not evidence that housing need was met. The
 * commute IS the unmet need.
 *
 * ── What replaced it ──
 *
 * A second reading of the same question, from the jobs side:
 *
 *     workforce_gap_units = local_low_wage_jobs - affordable_units_lte60
 *
 * Jobs are workplace-side LODES (CE01 + CE02, up to $3,333/month). A place
 * cannot export the jobs it hosts the way it can export its residents.
 *
 * `gap_pressure_score` is then the MAX of the resident and workforce
 * readings, which is the property most of this file defends: a maximum can
 * only raise a need score, never lower one, so no geography lost standing
 * because this metric arrived.
 *
 * ── Why this guard recomputes from source ──
 *
 * It reads data/hna/place-lehd.json and data/co_ami_gap_by_place.json
 * directly and rebuilds the arithmetic, rather than checking the index's own
 * published inputs against its own published output. A guard fed by the thing
 * it is checking agrees with that thing's bugs. The sign convention in the
 * gap file is the specific trap: its key is named
 * `gap_units_minus_households_le_ami_pct` and it holds households minus
 * units, the reverse. A guard that trusted the key name would confirm a
 * builder that also trusted it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const index = read('data/hna/ranking-index.json');
const rows = index.rankings;
const lehd = read('data/hna/place-lehd.json').places;
const gapFile = read('data/co_ami_gap_by_place.json');
const gapPlaces = gapFile.places || gapFile;

const m = (r) => r.metrics || {};
const pad7 = (g) => String(g).padStart(7, '0');

test('the scan has something to check — a pass over nothing is not a pass', () => {
  assert.ok(rows.length > 500, `expected the full state, got ${rows.length} rows`);
  const withGap = rows.filter((r) => m(r).workforce_gap_units !== undefined);
  assert.equal(withGap.length, rows.length,
    'every row must carry the workforce gap field, even if its value is null');
});

test('the workforce gap is computed, not defaulted, across the state', () => {
  const populated = rows.filter((r) => typeof m(r).workforce_gap_units === 'number');
  assert.ok(populated.length >= 500,
    `only ${populated.length} of ${rows.length} rows have a workforce gap; `
    + 'the metric is supposed to cover places (place LODES) and counties (county LODES)');
});

test('absence is null, never zero, and always says so', () => {
  for (const r of rows) {
    const g = m(r).workforce_gap_units;
    const basis = m(r).workforce_gap_basis;
    if (g === null) {
      assert.equal(basis, null,
        `${r.name}: gap is null but basis is ${JSON.stringify(basis)} — an unknown must not claim a source`);
    } else {
      assert.equal(typeof g, 'number', `${r.name}: gap is neither a number nor null`);
      assert.ok(typeof basis === 'string' && basis.length > 0,
        `${r.name}: has a gap of ${g} but no basis — an unattributed number is the thing this metric replaced`);
    }
  }
});

test('the arithmetic matches an independent recomputation from source', () => {
  let checked = 0;
  const wrong = [];
  for (const r of rows) {
    if (m(r).workforce_gap_basis !== 'place_lodes_wac_vs_units_lte60') continue;
    const g7 = pad7(r.geoid);
    const blob = (lehd[g7] || {}).lehd;
    const gapRec = gapPlaces[g7];
    if (!blob || !gapRec) continue;
    const { CE01, CE02 } = blob;
    const hh = (gapRec.households_le_ami_pct || {})['60'];
    // The key says units-minus-households. It holds households-minus-units.
    const stored = (gapRec.gap_units_minus_households_le_ami_pct || {})['60'];
    if ([CE01, CE02, hh, stored].some((v) => v === undefined || v === null)) continue;
    const units = Math.max(0, Number(hh) - Number(stored));
    const expected = Math.max(0, Math.round(Number(CE01) + Number(CE02) - units));
    const actual = m(r).workforce_gap_units;
    checked += 1;
    if (Math.abs(expected - actual) > 1) wrong.push(`${r.name}: expected ~${expected}, got ${actual}`);
  }
  assert.ok(checked >= 400, `only recomputed ${checked} places; the check went vacuous`);
  assert.deepEqual(wrong.slice(0, 5), [], `workforce gap disagrees with source arithmetic (${wrong.length} rows)`);
});

test('gap pressure is the MAX of the two readings — it can never lower a score', () => {
  const lowered = [];
  for (const r of rows) {
    const gp = m(r).gap_pressure_score;
    const resident = m(r).resident_gap_pressure_score;
    const workforce = m(r).workforce_gap_pressure_score;
    if (typeof gp !== 'number' || typeof resident !== 'number') continue;
    // The published composite must be at least the resident-only reading.
    // If this ever fails, adding the workforce signal has taken need AWAY
    // from a place, which inverts the entire point of the change.
    if (gp < resident - 0.05) lowered.push(`${r.name}: composite ${gp} < resident ${resident}`);
    if (typeof workforce === 'number' && gp < workforce - 0.05) {
      lowered.push(`${r.name}: composite ${gp} < workforce ${workforce}`);
    }
  }
  assert.deepEqual(lowered.slice(0, 5), [],
    `gap pressure fell below one of its own inputs (${lowered.length} rows) — max() semantics broken`);
});

test('the percentage is a percentage, and is suppressed on thin denominators', () => {
  for (const r of rows) {
    const pct = m(r).workforce_gap_pct;
    if (pct === null || pct === undefined) continue;
    assert.ok(pct >= 0 && pct <= 100, `${r.name}: workforce_gap_pct ${pct} is outside 0-100`);
    const jobs = m(r).local_low_wage_jobs;
    assert.ok(typeof jobs === 'number' && jobs >= 50,
      `${r.name}: publishes a percentage on ${jobs} jobs; below 50 it must be suppressed`);
  }
});

test('the metric discriminates — it did not just raise everything', () => {
  // An over-correction passes every "no false zeros" assertion above while
  // destroying the metric's ability to separate places. A real zero has to
  // still be reachable, and the top must not be saturated.
  const vals = rows.map((r) => m(r).workforce_gap_pct).filter((v) => typeof v === 'number');
  // 354 of 546 on 2026-10-19. It was 406 while each town's wage tiers were
  // its county's jobs scaled by population, which gave small bedroom towns
  // more low-wage jobs than they host; now under 50 is suppressed for real.
  assert.ok(vals.length >= 300, `only ${vals.length} usable values; check went vacuous`);
  const zero = vals.filter((v) => v === 0).length;
  const maxed = vals.filter((v) => v === 100).length;
  assert.ok(zero >= 10,
    `only ${zero} places have a zero workforce gap — a metric nobody can satisfy is not measuring anything`);
  assert.ok(maxed < vals.length * 0.5,
    `${maxed} of ${vals.length} places are at 100% — the metric is saturated`);
  const sorted = [...vals].sort((a, b) => a - b);
  const spread = sorted[Math.floor(sorted.length * 0.75)] - sorted[Math.floor(sorted.length * 0.25)];
  assert.ok(spread > 20, `interquartile spread is only ${spread} points; the metric is flat`);
});

test('a place cannot read as satisfied while its workforce commutes in', () => {
  // The whole point, stated as a rule. A place with a resident gap of zero
  // AND substantial low-wage employment it has not housed must not also
  // report a zero workforce gap.
  const contradictions = [];
  for (const r of rows) {
    const resident = m(r).housing_gap_units;
    const jobs = m(r).local_low_wage_jobs;
    const units = m(r).affordable_units_lte60;
    const wf = m(r).workforce_gap_units;
    if (resident !== 0 || typeof jobs !== 'number' || typeof units !== 'number') continue;
    if (jobs - units > 100 && wf === 0) {
      contradictions.push(`${r.name}: ${jobs} low-wage jobs, ${units} affordable units, workforce gap 0`);
    }
  }
  assert.deepEqual(contradictions.slice(0, 5), [],
    `${contradictions.length} places report no need on either reading while employing an unhoused workforce`);
});

test('the new metrics are documented in the index catalogue', () => {
  const ids = new Set((index.metrics || []).map((d) => d.id));
  for (const id of ['local_low_wage_jobs', 'affordable_units_lte60',
    'workforce_gap_units', 'workforce_gap_pct', 'workforce_gap_basis']) {
    assert.ok(ids.has(id), `${id} is published on every row but absent from the metric catalogue`);
  }
});

test("a town's wage tiers count its own jobs, not its county's", () => {
  // Fruita read 2,735 low- and middle-wage jobs located there against 3,087
  // jobs in total: the tiers were Mesa County's, scaled by Fruita's share of
  // the county's people, and the workforce reading turned the excess into
  // "2,302 homes needed". The tiers must add up to the place's own job count.
  const lehd = read('data/hna/place-lehd.json').places;
  const off = [];
  for (const [geoid, p] of Object.entries(lehd)) {
    const l = p.lehd || {};
    if (!(l.C000 > 0) || l.CE01 == null) continue;
    const tiers = l.CE01 + l.CE02 + l.CE03;
    if (tiers === 0 && Object.values(l.annualEmployment || {}).every((v) => !v)) continue;
    if (Math.abs(tiers - l.C000) > 2) off.push(`${p.name} (${geoid}): tiers ${tiers} vs jobs ${l.C000}`);
    const ae = l.annualEmployment || {};
    const yrs = Object.keys(ae).sort();
    if (yrs.length && ae[yrs[yrs.length - 1]] !== l.C000) {
      off.push(`${p.name} (${geoid}): latest yearly jobs ${ae[yrs[yrs.length - 1]]} vs jobs ${l.C000}`);
    }
  }
  assert.deepEqual(off.slice(0, 10), [], `${off.length} places disagree with their own job count`);
});

test('a place\'s job count, wage mix and yearly series are one LODES year', () => {
  // The OD flows can be rebuilt for any year; rescaling another year's count
  // into the latest year of the series would publish it under the wrong year.
  const wacYear = String(read('data/market/lodes_co.json').meta.vintage);
  const odYear = String((read('data/hna/place-od-flows.json').meta || {}).year);
  const lehd = read('data/hna/place-lehd.json').places;
  let checked = 0;
  const bad = [];
  for (const p of Object.values(lehd)) {
    const years = Object.keys((p.lehd || {}).annualEmployment || {}).sort();
    if (!years.length) continue;
    checked++;
    if (years[years.length - 1] !== wacYear) bad.push(`${p.name}: series ends ${years[years.length - 1]}, wage mix is ${wacYear}`);
    if (p.lehd.flows_source === 'block-od' && p.lehd.wac_source === 'block-scaled' && odYear !== wacYear) {
      bad.push(`${p.name}: block count from ${odYear} used with ${wacYear} wages`);
    }
  }
  assert.ok(checked > 400, `only ${checked} places carry a yearly series`);
  assert.deepEqual(bad, []);
});

test('small places keep an honest history: one wage mix, no zero-job inventions, no county stand-in', () => {
  // Three cases Codex found on #2385, pinned so they cannot come back.
  const lehd = read('data/hna/place-lehd.json').places;
  const od = read('data/hna/place-od-flows.json');
  const odPlaces = od.places || od;
  const problems = [];
  for (const [geoid, p] of Object.entries(lehd)) {
    const l = p.lehd || {};
    const ae = l.annualEmployment || {};
    const aw = l.annualWages || {};
    // 1. Every year splits its jobs with the same wage mix. Rescaling counts
    //    that were already rounded turned Lakeside's 2020-22 into {0, 0, 530}
    //    and then switched to the local mix in 2023: a wage shift that never
    //    happened.
    const years = Object.keys(aw).sort();
    if (years.length && l.C000 > 0) {
      const latest = aw[years[years.length - 1]];
      const latestTotal = latest.low + latest.medium + latest.high;
      for (const y of years) {
        const t = aw[y];
        const total = t.low + t.medium + t.high;
        if (Math.abs(total - (ae[y] || 0)) > 2) problems.push(`${p.name} ${y}: tiers ${total} vs jobs ${ae[y]}`);
        if (total >= 100 && latestTotal >= 100) {
          const share = t.low / total;
          const latestShare = latest.low / latestTotal;
          if (Math.abs(share - latestShare) > 0.02) {
            problems.push(`${p.name} ${y}: low-wage share ${share.toFixed(3)} vs ${latestShare.toFixed(3)} in ${years[years.length - 1]}`);
          }
        }
      }
    }
    // 2. A block count of zero jobs is a count, not a gap to fill with the
    //    tract estimate (Goldfield read 106 jobs against a block count of 0).
    const b = odPlaces[geoid];
    if (b && b.jobs === 0 && (l.C000 !== 0 || l.CE01 || l.CE02 || l.CE03)) {
      problems.push(`${p.name}: block count is 0 jobs but C000 ${l.C000}, tiers ${l.CE01}/${l.CE02}/${l.CE03}`);
    }
  }
  // 3. No local wage mix means unknown, not the county's mix (Hartsel,
  //    population 0, read 19/23/51 from Park County's split). Which places
  //    have no mix is derived from the builder's own inputs: the tracts a
  //    place overlaps, weighted by place_pop x share_of_place_area / tract pop,
  //    carry no high-wage jobs.
  const membership = read('data/hna/place-tract-membership.json').places;
  const tractPop = new Map(read('data/market/acs_tract_metrics_co.json').tracts.map((t) => [String(t.geoid), Number(t.pop) || 0]));
  const lodes = new Map(read('data/market/lodes_co.json').tracts.map((t) => [String(t.geoid), t]));
  let noMix = 0;
  for (const [geoid, p] of Object.entries(lehd)) {
    const l = p.lehd || {};
    if (!(l.C000 > 0)) continue;
    let high = 0;
    let weighted = false;
    for (const t of (membership[geoid] || {}).tracts || []) {
      const lt = lodes.get(t.tract_geoid);
      const tp = tractPop.get(t.tract_geoid) || 0;
      const sop = Number(t.share_of_place_area) || 0;
      if (!lt || tp <= 0 || sop <= 0) continue;
      weighted = true;
      high += (Number(lt.high_wage) || 0) * Math.min(1, (p.place_pop * sop) / tp);
    }
    if (!weighted || high > 0) continue;
    noMix++;
    if (l.CE01 !== null || l.CE02 !== null || l.CE03 !== null || Object.keys(l.annualWages || {}).length) {
      problems.push(`${p.name}: no local wage mix, but tiers ${l.CE01}/${l.CE02}/${l.CE03} and ${Object.keys(l.annualWages || {}).length} years of wage split`);
    }
  }
  assert.ok(noMix >= 1, 'no place without a local wage mix was found, so the no-county-mix rule went unchecked');
  assert.deepEqual(problems.slice(0, 10), [], `${problems.length} small-place history problems`);
});
