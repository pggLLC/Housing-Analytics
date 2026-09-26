'use strict';

/**
 * The HNA scorecard must render for a place too small to be scored on its own.
 *
 * renderHnaScorecardPanel() explains a county fallback with `placeParts`,
 * which used to be declared only inside _scorecardScore(). Every place whose
 * renter households fall below SCORECARD_MIN_RENTER_HH (about 197 of 482,
 * e.g. Foxfield, 0828105) threw "placeParts is not defined", and because the
 * controller calls the renderer unguarded, everything rendered after it on
 * the page stayed "—".
 *
 * This runs the real renderer in jsdom against the real CHAS, place-CHAS and
 * economic-indicator files, for a small place (county fallback, with the
 * reason stated) and a large one (Fruita, place-level), plus a county.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readJson = (f) => JSON.parse(read(f));

const chasData = readJson('data/hna/chas_affordability_gap.json');
const placeChas = readJson('data/hna/place-chas.json');
const econData = readJson('data/co-county-economic-indicators.json');
const renderersSrc = read('js/hna/hna-renderers.js');

const minMatch = renderersSrc.match(/var SCORECARD_MIN_RENTER_HH = (\d+);/);
assert(minMatch, 'SCORECARD_MIN_RENTER_HH is no longer declared as expected; re-derive this test');
const MIN_RENTER_HH = Number(minMatch[1]);

function render(geoid, contextCounty) {
  const dom = new JSDOM('<!doctype html><body>' +
    '<section id="hnaDecisionStrip" hidden>' +
    '<a data-decision-key="need" href="#hnaScorecardPanel"><strong id="decisionNeedValue">—</strong><span id="decisionNeedRead">Loading</span></a>' +
    '</section>' +
    '<section id="hnaScorecardPanel"></section></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.console = { log() {}, info() {}, warn() {}, error() {} };
  w.HNAUtils = {};
  w.HNAState = {
    state: { chasData, placeChas, blsEconData: econData, contextCounty },
    els: {},
    charts: {},
  };
  w.eval(renderersSrc);
  assert(w.HNARenderers && typeof w.HNARenderers.renderHnaScorecardPanel === 'function',
    'renderers must load in jsdom');
  // No try/catch: an exception here is the defect this file guards against.
  w.HNARenderers.renderHnaScorecardPanel(geoid);
  const panel = w.document.getElementById('hnaScorecardPanel');
  return {
    text: panel.textContent.replace(/\s+/g, ' '),
    source: w.HNAState.state._scorecard_source,
    need: w.document.getElementById('decisionNeedValue').textContent,
  };
}

// The fixtures must actually be on the two sides of the threshold, or the
// cases below prove nothing.
const foxfield = placeChas.places['0828105'];
const fruita = placeChas.places['0828745'];
assert(foxfield && fruita, 'place-chas.json must carry Foxfield and Fruita');
assert(Number(foxfield.summary.total_renter_hh) < MIN_RENTER_HH,
  'Foxfield is no longer below the renter-household threshold; pick another small place');
assert(Number(fruita.summary.total_renter_hh) >= MIN_RENTER_HH,
  'Fruita is no longer above the renter-household threshold; pick another large place');

// Small place: county fallback, stated plainly with the reason.
const small = render('0828105', '08005');
assert.strictEqual(small.source, 'county', 'a small place must fall back to its county');
assert.match(small.text, /County proxy:/, 'small place must carry the county-proxy note');
assert(small.text.includes('fewer than ' + MIN_RENTER_HH + ' renter households'),
  'small place note must say it has too few renter households: ' + small.text.slice(0, 300));
assert.match(small.text, /Overall need/, 'small place scorecard must render its composite');
assert.match(small.need, /^\d+\/100$/, 'small place decision-strip need tile must be populated');

// Large place: its own score, no county-proxy note.
const large = render('0828745', '08077');
assert.strictEqual(large.source, 'place', 'Fruita must be scored at place level');
assert.match(large.text, /Place-level:/, 'Fruita must carry the place-level note');
assert.doesNotMatch(large.text, /County proxy:/, 'Fruita must not claim a county proxy');
assert.match(large.need, /^\d+\/100$/, 'Fruita decision-strip need tile must be populated');

// County: scored directly, no proxy note.
const county = render('08077', null);
assert.strictEqual(county.source, 'county_direct', 'Mesa County must be scored directly');
assert.doesNotMatch(county.text, /County proxy:|Place-level:/, 'a county needs no proxy note');
assert.match(county.need, /^\d+\/100$/, 'Mesa County decision-strip need tile must be populated');

console.log('hna-scorecard-small-place: PASS (Foxfield ' + small.need + ' via county proxy; Fruita '
  + large.need + ' place-level; Mesa County ' + county.need + ')');
