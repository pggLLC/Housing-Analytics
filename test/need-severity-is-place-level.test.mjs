#!/usr/bin/env node
/**
 * A place's need severity must describe the place, not its county.
 *
 * ── What was wrong ──
 *
 * renderHnaScorecardPanel() read every component off the containing county:
 *
 *     const s = countyRec.summary;
 *     const byAmi = countyRec.renter_hh_by_ami || {};
 *
 * So the "Need severity" tile on four HNA pages showed a place its COUNTY's
 * score, in full. Fruita displayed Mesa County's 54/100 "Elevated" — Mesa
 * ranks 32nd of 64 counties, the exact middle — while Fruita itself ranks 73
 * of 546 statewide. Every place in Mesa County showed the same 54, because
 * the panel was not looking at them.
 *
 * Two further defects in the same function:
 *
 *   - `pct != null ? pct * 25 : 0` summed four components, so an unmeasured
 *     one silently subtracted up to 25 points and read as "low need".
 *   - the peer pool was the 64 counties for every subject, so a place was
 *     percentile-ranked against county averages.
 *
 * ── How this guard works ──
 *
 * It extracts the SHIPPED functions out of js/hna/hna-renderers.js and runs
 * them against the committed data, so it measures the code rather than a
 * paraphrase of it. It then asserts PROPERTIES — that places in one county
 * differentiate, that absence does not depress a score, that a place is
 * ranked among places — rather than recomputing expected values with the
 * same arithmetic it is checking.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const SRC = fs.readFileSync(path.join(ROOT, 'js/hna/hna-renderers.js'), 'utf8');

/** Pull a named function's source out of the renderer by brace matching. */
function extract(name) {
  const i = SRC.indexOf('function ' + name + '(');
  assert.ok(i >= 0, `${name}() is gone from hna-renderers.js — this guard is checking nothing`);
  let depth = 0;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k += 1) {
    if (SRC[k] === '{') depth += 1;
    else if (SRC[k] === '}') { depth -= 1; if (!depth) return SRC.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces reading ' + name);
}

const ctx = {};
// _scorecardScore is the POLICY — subject, pool and combination rule. Pulling
// it in is what makes this guard test the shipped decisions instead of a copy
// of them living in this file.
new Function('ctx', `${extract('_scorecardComponents')}\n${extract('_percentile')}\n`
  + `${extract('_scorecardScore')}\n`
  + 'const SCORECARD_MIN_RENTER_HH = ' + (SRC.match(/SCORECARD_MIN_RENTER_HH\s*=\s*(\d+)/) || [])[1] + ';\n'
  + 'ctx.components=_scorecardComponents; ctx.percentile=_percentile; ctx.score=_scorecardScore;')(ctx);
const { components, percentile, score: scorePolicy } = ctx;

const MIN_RENTER_HH = Number((SRC.match(/SCORECARD_MIN_RENTER_HH\s*=\s*(\d+)/) || [])[1]);

const counties = readJson('data/hna/chas_affordability_gap.json').counties;
const places = readJson('data/hna/place-chas.json').places;
const econ = readJson('data/co-county-economic-indicators.json').counties;
const ranked = readJson('data/hna/ranking-index.json').rankings;

const emptyPool = () => ({ blendedBurden: [], deepNeed: [], worstCaseShare: [], affordPressure: [] });
const pools = { county: emptyPool(), place: emptyPool() };
const push = (pool, c) => {
  if (!c) return;
  if (c.blendedBurden != null) pool.blendedBurden.push(c.blendedBurden);
  if (c.deepNeed != null) pool.deepNeed.push(c.deepNeed);
  if (c.worstCase != null) pool.worstCaseShare.push(c.worstCase);
};
Object.values(counties).forEach((r) => push(pools.county, components(r, 'county')));
Object.values(places).forEach((r) => {
  const c = components(r, 'place');
  if (c && c.renterHH >= MIN_RENTER_HH) push(pools.place, c);
});
Object.values(econ).forEach((c) => {
  if (c && c.affordability_index != null) {
    pools.county.affordPressure.push(Number(c.affordability_index));
    pools.place.affordPressure.push(Number(c.affordability_index));
  }
});
for (const p of Object.keys(pools)) for (const k of Object.keys(pools[p])) pools[p][k].sort((a, b) => a - b);

function severity(geoid, countyFips) {
  const key = String(geoid).padStart(7, '0');
  const cName = String((counties[countyFips] || {}).name || '').replace(/ County$/, '');
  // Calls the renderer's own policy. Anything reimplemented here would be a
  // second opinion, and a guard's second opinion always agrees with itself.
  const r = scorePolicy(places[key], counties[countyFips], econ[cName], pools,
    String(geoid).length !== 5);
  return {
    composite: r.composite,
    n: r.present,
    usePlace: r.usePlace,
    renterHH: r.parts && r.parts.renterHH,
  };
}

const placeRows = ranked.filter((r) => r.type !== 'county' && r.containingCounty
  && counties[r.containingCounty]);

test('the guard is exercising real code and real data', () => {
  assert.ok(MIN_RENTER_HH >= 1, 'SCORECARD_MIN_RENTER_HH not found in the renderer');
  assert.ok(placeRows.length > 400, `only ${placeRows.length} ranked places resolved; check went vacuous`);
  assert.ok(pools.place.blendedBurden.length > 200, 'the place pool is empty — nothing is being ranked');
});

test('places in the same county no longer share one score', () => {
  // The defect, stated directly. Mesa County is the reported case, but any
  // county with several scorable places must show a spread.
  const byCounty = new Map();
  for (const r of placeRows) {
    const s = severity(r.geoid, r.containingCounty);
    if (s.composite == null || !s.usePlace) continue;
    if (!byCounty.has(r.containingCounty)) byCounty.set(r.containingCounty, []);
    byCounty.get(r.containingCounty).push({ name: r.name, composite: s.composite });
  }
  const multi = [...byCounty.entries()].filter(([, v]) => v.length >= 3);
  assert.ok(multi.length >= 10, `only ${multi.length} counties have 3+ place-scored members`);
  const flat = multi.filter(([, v]) => new Set(v.map((x) => x.composite)).size === 1);
  assert.deepEqual(flat.map(([c]) => c), [],
    `${flat.length} counties still give every one of their places an identical severity`);
});

test('an unmeasured component does not depress the score', () => {
  // The old composite summed `pct * 25 : 0`, so three-component geographies
  // were capped at 75 and read as lower need than they are. The mean cannot
  // do that: a geography scored on 3 components must still be able to reach
  // the top band.
  const three = placeRows.map((r) => severity(r.geoid, r.containingCounty))
    .filter((s) => s.composite != null && s.n === 3);
  const four = placeRows.map((r) => severity(r.geoid, r.containingCounty))
    .filter((s) => s.composite != null && s.n === 4);
  assert.ok(four.length > 100, 'expected most geographies to have all four components');
  if (three.length) {
    const cap = Math.max(...three.map((s) => s.composite));
    assert.ok(cap > 75,
      `every 3-component geography scores <= ${cap}; absence is still being summed as zero`);
  }
});

test('a place is ranked among places, not among counties', () => {
  // Comparing pool SIZES would pass even if the renderer handed the county
  // pool to every subject — the sizes are a property of the pools, not of
  // which one gets used. So this scores each place twice: once normally, and
  // once with the place pool replaced by the county pool. If the policy is
  // really switching pools, most places must land somewhere different.
  assert.ok(pools.place.blendedBurden.length > pools.county.blendedBurden.length,
    'there should be far more scorable places than the 64 counties');

  const countyOnly = { place: pools.county, county: pools.county };
  let compared = 0;
  let differed = 0;
  for (const r of placeRows) {
    const key = String(r.geoid).padStart(7, '0');
    const cName = String((counties[r.containingCounty] || {}).name || '').replace(/ County$/, '');
    const real = scorePolicy(places[key], counties[r.containingCounty], econ[cName], pools, true);
    if (!real.usePlace || real.composite == null) continue;
    const wrong = scorePolicy(places[key], counties[r.containingCounty], econ[cName], countyOnly, true);
    compared += 1;
    if (wrong.composite !== real.composite) differed += 1;
  }
  assert.ok(compared > 200, `only ${compared} place-scored rows to compare; check went vacuous`);
  assert.ok(differed > compared * 0.8,
    `only ${differed} of ${compared} places score differently against the county pool — `
    + 'the subject pool is probably not being switched');
});

test('a subject with too few components is refused, not scored', () => {
  // The floor, exercised directly rather than inferred from whichever
  // geographies happen to be thin today. A synthetic record carrying only a
  // cost-burden share has one component; with the county econ row it has two.
  const oneComponent = {
    summary: { renter_cb30_share: 0.4, owner_cb30_share: 0.2, total_renter_hh: 900, total_owner_hh: 900 },
    renter_hh_by_ami: {},
  };
  const noEcon = scorePolicy(oneComponent, null, null, pools, true);
  assert.equal(noEcon.composite, null,
    `a subject with ${noEcon.present} of 4 components was given a composite of ${noEcon.composite}`);
  assert.ok(noEcon.present < 3, 'the synthetic subject should be short of components');

  const withEcon = scorePolicy(oneComponent, null, { affordability_index: 6 }, pools, true);
  assert.equal(withEcon.composite, null,
    `a subject with ${withEcon.present} of 4 components was given a composite of ${withEcon.composite}`);
});

test('thin places fall back to the county rather than publishing noise', () => {
  const thin = placeRows.filter((r) => {
    const c = components(places[String(r.geoid).padStart(7, '0')], 'place');
    return c && c.renterHH < MIN_RENTER_HH;
  });
  assert.ok(thin.length > 0, 'no thin places found — the threshold may be doing nothing');
  for (const r of thin.slice(0, 40)) {
    const s = severity(r.geoid, r.containingCounty);
    assert.equal(s.usePlace, false,
      `${r.name} has under ${MIN_RENTER_HH} renter households but was scored on its own shares`);
  }
});

test('every ranked place gets a score or an explicit reason', () => {
  const unscored = placeRows.map((r) => ({ r, s: severity(r.geoid, r.containingCounty) }))
    .filter(({ s }) => s.composite == null);
  for (const { r, s } of unscored) {
    assert.ok(s.n < 3, `${r.name} is unscored with ${s.n} components — that is not a stated reason`);
  }
});

test('the renderer is actually given place CHAS on a normal render', () => {
  // THE GAP THIS FILE HAD.
  //
  // Every other test here extracts _scorecardScore and feeds it place-chas.json
  // that the TEST loads. That proves the policy is right and says nothing about
  // whether the running page ever has the data.
  //
  // It did not. #1739 read the dataset from
  // state.combinedDatasets.placeChas, and _loadCombinedDatasets() is called
  // from exactly two places, both inside the combined-geography feature. On an
  // ordinary single-jurisdiction view it was never loaded, usePlace was always
  // false, and the scorecard fell back to the containing county — the defect
  // #1739 shipped to fix. Verified in a browser: Fruita rendered Mesa County's
  // 54/100 with _scorecard_source 'county'. Every test in this file passed
  // while that was true.
  //
  // So this checks the CHAIN across both files instead of the function.
  const controller = fs.readFileSync(path.join(ROOT, 'js/hna/hna-controller.js'), 'utf8');

  const loads = /place-chas\.json['"]\s*\)\s*\n?\s*\.then\(\s*\(data\)\s*=>\s*\{\s*window\.HNAState\.state\.placeChas\s*=\s*data/.test(controller);
  assert.ok(loads,
    'the controller does not load place-chas.json into state.placeChas; the scorecard '
    + 'will silently fall back to the containing county');

  // ...and the assignment must sit OUTSIDE _loadCombinedDatasets(), which also
  // loads place-chas.json and is the path that left the normal render without
  // it. An earlier draft of this check looked at the text before the first
  // 'place-chas.json' match and found the combined loader every time — it was
  // testing the wrong occurrence.
  const assignIdx = controller.indexOf('window.HNAState.state.placeChas = data');
  assert.ok(assignIdx > 0, 'no assignment of place-chas into state.placeChas');
  const combinedStart = controller.indexOf('async function _loadCombinedDatasets');
  assert.ok(combinedStart > 0, '_loadCombinedDatasets is gone; re-derive this check');
  const combinedEnd = controller.indexOf('\n  }', combinedStart);
  assert.ok(!(assignIdx > combinedStart && assignIdx < combinedEnd),
    'state.placeChas is only assigned inside _loadCombinedDatasets, which a normal '
    + 'single-jurisdiction render never calls');

  // ...and it must be awaited before the scorecard renders, or the render wins
  // the race and falls back anyway.
  const awaitIdx = controller.indexOf('await placeChasPromise');
  const renderIdx = controller.indexOf('renderHnaScorecardPanel(');
  assert.ok(awaitIdx > 0, 'the place-chas load is never awaited');
  assert.ok(awaitIdx < renderIdx,
    'the place-chas load is awaited AFTER the scorecard renders, so the render still '
    + 'falls back to the county');

  // The renderer must read what the controller populates — in CODE. The first
  // version tested this against the whole file and matched the explanatory
  // comment two lines above the fix, so reverting the code still passed.
  const rendererCode = SRC
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
  assert.ok(/state\.placeChas/.test(rendererCode),
    'the renderer never reads state.placeChas, so the controller load is wasted');

  // Subject and peer pool must resolve from the SAME binding. Resolving them
  // separately is how the first pass at this fix left the pool empty and the
  // panel said "Not scored" while claiming source 'place'.
  // Anchored on the CALL, not the signature. The first version used
  // /_buildScorecardDistributions\(([^;]*?)\);/ which ran past the `) {` of the
  // function DEFINITION and captured its parameter list — so it checked the
  // signature, which always mentions placeChas and never combinedDatasets, and
  // passed no matter what the call site said.
  const poolCall = rendererCode.match(/=\s*_buildScorecardDistributions\(([^)\n]*)\)/);
  assert.ok(poolCall, 'the pool is no longer built by a _buildScorecardDistributions call');
  assert.ok(!/combinedDatasets/.test(poolCall[1]),
    'the peer pool resolves its own placeChas instead of sharing the subject\'s binding: '
    + poolCall[1].replace(/\s+/g, ' ').slice(0, 90));
});

test('the rendered disclosures match what the code actually does', () => {
  // Scan EXECUTABLE source only. The first version of this check matched the
  // explanatory comment that was written directly above the fix, and reported
  // the bug as still live in the code that fixed it — the same mention-vs-
  // usage mistake several guards in this repo have made.
  const code = SRC
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
  // The panel previously announced a county proxy for every place. That was
  // true then and would be a falsehood now, so the strings are checked
  // against the behaviour rather than left to drift.
  assert.ok(/Place-level:/.test(SRC),
    'nothing tells a reader when the score is the place’s own');
  assert.ok(/County proxy:/.test(SRC), 'the county-proxy disclosure is gone');
  assert.ok(/renter households, too few/.test(SRC),
    'the county fallback does not say WHY it fell back');
  assert.ok(!/vs\. all 64 CO counties/.test(code),
    'the panel still claims every subject is ranked against the 64 counties');
  assert.ok(!/0–25 contribution/.test(code),
    'the legend still describes the removed 0-25 points scheme');
});
