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
  assert.ok(vals.length >= 400, `only ${vals.length} usable values; check went vacuous`);
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
