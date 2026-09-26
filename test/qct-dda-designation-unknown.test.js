'use strict';

/**
 * An unknown QCT/DDA designation must stay unknown on the market-analysis path.
 *
 * HudEgis.checkDesignation() used to return in_qct:false / in_dda:false when
 * the QCT/DDA layers had not loaded (or loaded with no features). Downstream
 * that "no" unticked the deal calculator's basis-boost box and cost the site
 * its QCT/DDA subsidy points — a data gap scored as a real answer.
 *
 * This runs every layer between the resolver and the screen:
 *   1. hud-egis.js checkDesignation — null + unavailableReason when a layer is
 *      missing or globally empty; real true/false once both layers have data.
 *   2. site-selection-score.js computeScore — an unknown designation drops the
 *      subsidy dimension (weight redistributed, reason reported) instead of
 *      scoring it without the bonus; a known "no" still scores as before.
 *   3. market-analysis-controller.js — an unknown designation never reaches
 *      the deal calculator's setDesignationContext.
 *   4. market-report-renderers.js — unknown renders "Unknown", not "No", and a
 *      null component score renders as a dash, not 0.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ── 1. checkDesignation ──────────────────────────────────────────────────────
function loadHudEgis() {
  const ctx = {
    console: { log() {}, info() {}, warn() {} },
    document: { readyState: 'complete', addEventListener() {} },
    setTimeout() {}, // never auto-load: the test decides what is loaded
    window: {},
  };
  vm.createContext(ctx);
  vm.runInContext(read('js/data-connectors/hud-egis.js'), ctx);
  return ctx.window.HudEgis;
}

// A unit square around (39.5, -105.5), and one far away.
const square = (lon, lat) => ({
  type: 'Feature', properties: {},
  geometry: { type: 'Polygon', coordinates: [[[lon - 0.5, lat - 0.5], [lon + 0.5, lat - 0.5], [lon + 0.5, lat + 0.5], [lon - 0.5, lat + 0.5], [lon - 0.5, lat - 0.5]]] },
});
const fc = (...features) => ({ type: 'FeatureCollection', features });
const SITE = [39.5, -105.5];

function checkResolver() {
  // Nothing loaded → unknown, never false.
  let H = loadHudEgis();
  let r = H.checkDesignation(...SITE);
  assert.strictEqual(r.in_qct, null, 'no QCT data: in_qct must be null (unknown), not false');
  assert.strictEqual(r.in_dda, null, 'no DDA data: in_dda must be null (unknown), not false');
  assert.strictEqual(r.basis_boost_eligible, null, 'no data: basis_boost_eligible must be null');
  assert.match(r.unavailableReason || '', /QCT data not loaded/, 'unknown must carry a reason');

  // Globally empty layers → unknown.
  H = loadHudEgis();
  H.loadLocalQct(fc());
  H.loadLocalDda(fc());
  r = H.checkDesignation(...SITE);
  assert.strictEqual(r.in_qct, null, 'QCT features: [] cannot show the site is outside a QCT');
  assert.strictEqual(r.in_dda, null, 'DDA features: [] cannot show the site is outside a DDA');
  assert.strictEqual(r.basis_boost_eligible, null, 'globally empty layers: basis boost unknown');
  assert.match(r.unavailableReason || '', /no QCT features/, 'empty layer reason must say so');

  // One layer known-true is enough for the (single) basis-boost election.
  H = loadHudEgis();
  H.loadLocalQct(fc(square(-105.5, 39.5)));
  r = H.checkDesignation(...SITE);
  assert.strictEqual(r.in_qct, true);
  assert.strictEqual(r.in_dda, null, 'DDA still unknown');
  assert.strictEqual(r.basis_boost_eligible, true, 'in a QCT → eligible even with DDA unknown');

  // One layer known-false, the other unknown → still unknown overall.
  H = loadHudEgis();
  H.loadLocalQct(fc(square(-100, 38)));
  r = H.checkDesignation(...SITE);
  assert.strictEqual(r.in_qct, false, 'loaded non-empty QCT layer, site outside → a real false');
  assert.strictEqual(r.basis_boost_eligible, null, 'not in QCT but DDA unknown → eligibility unknown');

  // Both known, site in neither → a real "no" with no reason.
  H.loadLocalDda(fc(square(-100, 38)));
  r = H.checkDesignation(...SITE);
  assert.deepStrictEqual([r.in_qct, r.in_dda, r.basis_boost_eligible, r.unavailableReason], [false, false, false, null],
    'both layers loaded, site in neither → verified false');
}

// ── 2. computeScore ──────────────────────────────────────────────────────────
function checkScore() {
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(read('js/market-analysis/site-selection-score.js'), ctx);
  const S = ctx.window.SiteSelectionScore;
  const base = {
    acs: { cost_burden_rate: 0.3, renter_share: 0.35, poverty_rate: 0.12 },
    fmrRatio: 1.1, nearbySubsidized: 20, floodRisk: 0, soilScore: 60, cleanupFlag: false,
    amenities: { grocery: 1, transit: 0.5, parks: 0.5, healthcare: 2, schools: 1 },
    zoningCapacity: 50, publicOwnership: false, overlayCount: 1,
    rentTrend: 0, jobTrend: 0, concentration: 0.5, serviceStrength: 0.25,
  };

  const unknown = S.computeScore({ ...base, qctFlag: null, ddaFlag: null, basisBoostEligible: null,
    designationUnavailableReason: 'QCT data not loaded (data/qct-colorado.json)' });
  const known   = S.computeScore({ ...base, qctFlag: false, ddaFlag: false, basisBoostEligible: false });
  const inQct   = S.computeScore({ ...base, qctFlag: true, ddaFlag: null, basisBoostEligible: true });

  assert.strictEqual(unknown.subsidy_score, null, 'unknown designation: subsidy_score must be null, not scored as "no bonus"');
  assert(unknown.unavailableDimensions.includes('subsidy'), 'unknown designation: subsidy must be listed unavailable');
  assert.strictEqual(unknown.dimensionsAvailable, 5, 'unknown designation: scored on 5 of 6 dimensions');
  assert.match(unknown.subsidyUnavailableReason || '', /QCT data not loaded/, 'the reason must be carried through');
  assert.match(unknown.narrative, /subsidy data unavailable/, 'the narrative must disclose it');

  // Known "no" keeps its historical behavior exactly.
  const direct = Math.round(S.scoreSubsidy(false, false, base.fmrRatio, base.nearbySubsidized, false));
  assert.strictEqual(known.subsidy_score, direct, 'verified "not in QCT/DDA" still scores the subsidy dimension');
  assert(!known.unavailableDimensions.includes('subsidy'));
  assert.strictEqual(known.subsidyUnavailableReason, null);

  // A known "yes" on one layer scores the full bonus despite the other being unknown.
  assert.strictEqual(inQct.subsidy_score, Math.round(S.scoreSubsidy(true, null, base.fmrRatio, base.nearbySubsidized, true)));

  // Callers that never pass the flags (undefined) are unchanged.
  const legacy = S.computeScore(base);
  assert.strictEqual(legacy.subsidy_score, direct, 'undefined flags keep the historical "no bonus" meaning');

  // The point of the fix: the missing +30 QCT points must not drag the
  // composite down as though the site were verified outside a QCT.
  // The composite must be the other five dimensions, re-weighted.
  const W = S.COMPONENT_WEIGHTS;
  const keys = ['demand', 'feasibility', 'access', 'policy', 'market'];
  const wsum = keys.reduce((s, k) => s + W[k], 0);
  const expected = Math.round(keys.reduce((s, k) => s + unknown[k + '_score'] * W[k], 0) / wsum);
  assert.strictEqual(unknown.final_score, expected,
    'unknown designation: composite must redistribute the subsidy weight, not score subsidy without its bonus');
}

// ── 3. Controller never pushes an unknown into the deal calculator ──────────
function checkController() {
  const src = read('js/market-analysis/market-analysis-controller.js');
  const i = src.indexOf('setDesignationContext(flags.basisBoostEligible)');
  assert(i > 0, 'controller must still notify the deal calculator of a known designation');
  const guard = src.slice(Math.max(0, i - 400), i);
  assert.match(guard, /typeof flags\.basisBoostEligible === 'boolean'/,
    'setDesignationContext must only be called with a known (boolean) designation');
  assert.doesNotMatch(src, /return \{ qctFlag: false, ddaFlag: false, basisBoostEligible: false \}/,
    'HudEgis-unavailable fallback must not report the designation as false');
}

// ── 4. Renderer ──────────────────────────────────────────────────────────────
function checkRenderer() {
  const dom = new JSDOM('<!doctype html><body><div id="maSubsidyOppContent"></div><div id="maExecSummaryContent"></div></body>',
    { runScripts: 'outside-only' });
  const w = dom.window;
  w.console = { log() {}, info() {}, warn() {}, error() {} };
  w.eval(read('js/market-analysis/market-report-renderers.js'));
  const R = w.MARenderers;
  assert(R && typeof R.renderSubsidyOpportunities === 'function', 'renderers must load');
  const box = w.document.getElementById('maSubsidyOppContent');

  R.renderSubsidyOpportunities({ qctFlag: null, ddaFlag: null, basisBoostEligible: null,
    designationUnavailableReason: 'QCT data not loaded', fmrRatio: 1.1, nearbySubsidized: 3, subsidy_score: null });
  assert.match(box.textContent, /\(QCT\)Unknown/, 'unknown QCT must render "Unknown"');
  assert.match(box.textContent, /\(DDA\)Unknown/, 'unknown DDA must render "Unknown"');
  assert.doesNotMatch(box.textContent, /\(QCT\)No/, 'unknown QCT must not render "No"');

  R.renderSubsidyOpportunities({ qctFlag: false, ddaFlag: false, basisBoostEligible: false, subsidy_score: 40 });
  assert.match(box.textContent, /\(QCT\)No/, 'verified false still renders "No"');
}

(async () => {
  checkResolver();
  checkScore();
  checkController();
  checkRenderer();
  console.log('qct-dda-designation-unknown: PASS (unknown QCT/DDA stays null through resolver, score, deal-calc hand-off and renderer)');
})().catch((e) => { console.error(e); process.exit(1); });
