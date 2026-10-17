#!/usr/bin/env node
'use strict';
// Numbers a reader saw disagree on the 2026-10-14 Western Slope walk, each
// pinned here to the figure it has to agree with rather than to its wording.
//
// 1. The Opportunity Finder's "Population" was households at or below 100%
//    AMI × 2.5 (Glenwood Springs 5,853); it must be the ACS population the
//    ranking index carries (10,241), and null where none is on file.
// 2. The finder's "would move up if" line said "currently neither" for a
//    place with a DDA; it must agree with the place's own QCT/DDA flags.
// 3. The HNA Executive Snapshot gave Glenwood's renter burden as 42.1% (place
//    CHAS) while the score cards on the same page said 47.6% (ranking index);
//    the narrative must use the ranking index figure the cards show.
// 4. The HNA selector said "482 municipalitys available".
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const ranking = readJson('data/hna/ranking-index.json').rankings;
const byGeoid = Object.fromEntries(ranking.map((r) => [r.geoid, r]));

// ── 1 and 2: the finder's pure helpers ─────────────────────────────────────
global.window = global;
global.document = {
  readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelector() { return null; },
};
global.ChfaRentLimits = require('../js/chfa-rent-limits.js');
require('../js/components/zori-rent-utils.js');
require('../js/lihtc-opportunity-finder.js');
const lof = global.__LOF && global.__LOF._test;
assert(lof && lof.populationFromRanking && lof.basisMoveUp, 'finder exposes its population and basis helpers');

let withPop = 0;
for (const row of ranking) {
  const v = row.metrics && row.metrics.population;
  if (typeof v === 'number' && v > 0) {
    assert.equal(lof.populationFromRanking(row.metrics), Math.round(v), `${row.name}: finder population is the ranking index's ACS population`);
    withPop++;
  }
}
assert(withPop > 400, `checked ${withPop} places with an ACS population`);
assert.equal(lof.populationFromRanking({ population: null }), null, 'no population on file stays null, never 0');
assert.equal(lof.populationFromRanking({ population: 0 }), null, 'a population of 0 is unknown, not a place of nobody');
assert.equal(lof.populationFromRanking(undefined), null);

const say = (hasQct, hasDda) => lof.basisMoveUp({ hasQct, hasDda });
assert(!/neither/.test(say(false, true)) && /QCT/.test(say(false, true)), 'a DDA place is not told it has neither');
assert(!/neither/.test(say(true, false)) && /DDA/.test(say(true, false)), 'a QCT place is not told it has neither');
assert(/neither/.test(say(false, false)), 'a place with neither designation is told so');
assert(!/is added/.test(say(true, true)), 'a place with both has nothing left to add');

// ── 3: the narrative's renter burden is the page's figure ──────────────────
function narrativeBurden(geoid) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://127.0.0.1/housing-needs-assessment.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.APP_CONFIG = {};
  w.HNAState = { state: {} };
  w.HNARanking = { _get: () => ({ allEntries: ranking }) };
  const place = readJson('data/hna/place-chas.json').places[geoid];
  w.PlaceChas = { lookup: (g) => (g === geoid ? place : null) };
  for (const f of ['js/utils/format-money.js', 'js/hna/hna-utils.js', 'js/hna/hna-narratives.js']) {
    w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  }
  const summary = readJson(`data/hna/summary/${geoid}.json`);
  const profile = Object.assign({}, summary.acsProfile, { _geoType: summary.geo.type, _geoid: geoid });
  return { ctx: w.HNANarratives._internals.gatherContext(profile, summary.geo.name || geoid), chas: place };
}
const glenwood = narrativeBurden('0830780');
assert.equal(glenwood.ctx.renterCb30, byGeoid['0830780'].metrics.pct_cost_burdened,
  'Glenwood Springs: the narrative renter burden is the figure the score cards show');
assert.notEqual(Math.round(glenwood.chas.summary.renter_cb30_share * 1000) / 10, glenwood.ctx.renterCb30,
  'fixture: place CHAS still differs from the ranking figure, so this check can fail');

// ── 4: the selector's plural ───────────────────────────────────────────────
const controller = fs.readFileSync(path.join(ROOT, 'js/hna/hna-controller.js'), 'utf8');
const dom = new JSDOM('<!doctype html><body><p id="geoSelectHint"></p></body>', { runScripts: 'outside-only' });
const announce = controller.match(/function _announceGeoOptions\(count, typeName\) \{[\s\S]*?\n  \}/);
assert(announce, 'found the selector hint function');
dom.window.eval(announce[0] + '; window._announce = _announceGeoOptions;');
for (const [n, type, want] of [[482, 'municipality', '482 municipalities available'], [64, 'county', '64 counties available'],
  [1, 'municipality', '1 municipality available'], [210, 'census-designated place', '210 census-designated places available']]) {
  dom.window._announce(n, type);
  assert.equal(dom.window.document.getElementById('geoSelectHint').textContent, want);
}

// ── 5: a burden signal's label names the threshold its value measures ─────
// The workforce card fed the 30%-or-more share under "severe, 35%+", so
// Glenwood's page showed 47.6% under that heading and 39.3% (the true 35%+
// share) on the next card.
{
  const w = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' }).window;
  w.eval(fs.readFileSync(path.join(ROOT, 'js/components/housing-type-need.js'), 'utf8'));
  let burdenSignals = 0;
  const geoids = ['0830780', '0820000', '0819850', '0862000', '08045', '08077', '08101', '0827425', '0812815', '0831660'];
  for (const geoid of geoids) {
    const file = path.join(ROOT, `data/hna/summary/${geoid}.json`);
    if (!fs.existsSync(file)) continue;
    const p = JSON.parse(fs.readFileSync(file, 'utf8')).acsProfile;
    const pct35 = p.DP04_0142PE, pct30 = p.DP04_0141PE + p.DP04_0142PE;
    for (const cat of w.HousingTypeNeed.compute({ acsProfile: p })) {
      for (const sig of cat.signals) {
        if (!/^Renter cost burden/.test(sig.name)) continue;
        burdenSignals++;
        if (/35%/.test(sig.name)) assert.equal(sig.value, pct35, `${geoid} "${sig.name}" shows the 35%+ share`);
        else if (/30%/.test(sig.name)) assert.ok(Math.abs(sig.value - pct30) < 0.05, `${geoid} "${sig.name}" shows the 30%+ share`);
      }
    }
  }
  assert(burdenSignals > 0, 'the scan found renter-burden signals to check');
}

// ── 6: the finder's need percentile ranks places on the counties' own scale ─
// County CHAS shares are 0-1; the place side was converted to percent and the
// county side was not, so all 482 places outranked all 64 counties and every
// place read "100p". Recompute each percentile here from the two source files
// (independently of the finder's code) and require the finder to agree.
{
  const counties = readJson('data/hna/chas_affordability_gap.json').counties;
  const places = readJson('data/hna/place-chas.json').places;
  const composite = (renter, owner, rcb30, ocb30, rcb50) =>
    ((rcb30 * renter + ocb30 * owner) / (renter + owner)) * 100 * 0.7 + rcb50 * 100 * 0.3;
  const dist = Object.values(counties).map((c) => c.summary)
    .filter((s) => s && s.total_renter_hh + s.total_owner_hh > 0 && s.pct_renter_cb30 != null && s.pct_owner_cb30 != null && s.pct_renter_cb50 != null)
    .map((s) => composite(s.total_renter_hh, s.total_owner_hh, s.pct_renter_cb30, s.pct_owner_cb30, s.pct_renter_cb50));
  assert.equal(dist.length, 64, 'all 64 counties form the reference distribution');
  const pctl = (v) => Math.round(dist.reduce((n, d) => n + (d < v ? 1 : d === v ? 0.5 : 0), 0) / dist.length * 100);

  lof.setChasForTest(counties, places);
  const finderDist = lof.buildNeedDistribution();
  let checked = 0;
  const seen = new Set();
  for (const [geoid, rec] of Object.entries(places)) {
    const s = rec.summary;
    if (!s || rec.low_confidence || !(s.total_renter_hh + s.total_owner_hh > 0)) continue;
    const want = pctl(composite(s.total_renter_hh, s.total_owner_hh, s.renter_cb30_share, s.owner_cb30_share, s.renter_cb50_share));
    const got = lof.needScoreFor(null, finderDist, geoid);
    assert.equal(got.source, 'place', `${geoid} need comes from place CHAS`);
    assert(Math.abs(got.score - want) <= 1, `${geoid} (${rec.name}) need percentile ${got.score} must equal the source-derived ${want}`);
    seen.add(got.score);
    checked++;
  }
  assert(checked >= 400, `the scan checked the place records (${checked})`);
  assert(seen.size > 20, `place need percentiles spread across the range (${seen.size} distinct values)`);

  // A county's own composite lands inside the county distribution, not above it.
  const denver = lof.needScoreFor('08031', finderDist, null);
  assert(denver.score > 0 && denver.score < 100, `a county ranks inside its own distribution (Denver p${denver.score})`);

  // No CHAS for the place or its county: no need score, and the composite is
  // built from the remaining components rather than an invented need value.
  lof.setChasForTest({}, {});
  const none = lof.needScoreFor('08077', [], '0828745');
  assert.equal(none.score, null, 'absent CHAS gives no need score (not a default)');
  const withoutNeed = lof.compositeScore(50, null, 60, 40, 30, '9pct', 'town');
  assert(Number.isFinite(withoutNeed) && withoutNeed >= 0 && withoutNeed <= 100, `composite without need stays on the 0-100 scale (${withoutNeed})`);
}

console.log(`finder-and-narrative-agree: PASS (${withPop} finder populations, Glenwood narrative burden, selector plurals, need percentiles)`);
