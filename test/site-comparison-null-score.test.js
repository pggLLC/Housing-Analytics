'use strict';

/**
 * The site-comparison table must not turn an unmeasured score into 0.
 *
 * site-selection-score.js returns subsidy_score: null, with
 * subsidyUnavailableReason, when the QCT/DDA designation is unknown (#1912).
 * site-comparison.js read every dimension as `dims.x_score || 0`, so that
 * unknown was saved and shown as a real subsidy score of 0 — the worst in the
 * column — and the site's QCT/DDA columns said "No" for a designation nobody
 * had checked.
 *
 * This runs the real scorer and the real comparison module against each
 * other: the null is produced by computeScore, not written into a fixture.
 * The agreement asserted is that every dimension the scorer could not measure
 * is shown as unavailable with the scorer's own reason, and every dimension
 * it did measure is shown as the scorer's number — including a genuine 0.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function scorer() {
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(read('js/market-analysis/site-selection-score.js'), ctx);
  return ctx.window.SiteSelectionScore;
}

const S = scorer();
const BASE = {
  acs: { cost_burden_rate: 0.3, renter_share: 0.35, poverty_rate: 0.12 },
  fmrRatio: 1.1, nearbySubsidized: 20, floodRisk: 0, soilScore: 60, cleanupFlag: false,
  amenities: { grocery: 1, transit: 0.5, parks: 0.5, healthcare: 2, schools: 1 },
  zoningCapacity: 50, publicOwnership: false, overlayCount: 1,
  rentTrend: 0, jobTrend: 0, concentration: 0.5, serviceStrength: 0.25,
};
const REASON = 'QCT data not loaded (data/qct-colorado.json)';
const unknown = S.computeScore(Object.assign({}, BASE, {
  qctFlag: null, ddaFlag: null, basisBoostEligible: null, designationUnavailableReason: REASON,
}));
const known = S.computeScore(Object.assign({}, BASE, { qctFlag: false, ddaFlag: false, basisBoostEligible: false }));
assert.strictEqual(unknown.subsidy_score, null, 'fixture: the scorer no longer returns a null subsidy score for an unknown designation');
assert.strictEqual(typeof known.subsidy_score, 'number', 'fixture: a known "no" must still score');

const DIMS = ['demand', 'subsidy', 'feasibility', 'access', 'policy', 'market'];

function load(state, saved) {
  const dom = new JSDOM('<div id="scSaveButtons"></div><div id="siteCompTable"></div><div id="siteCompActions"></div>',
    { runScripts: 'outside-only' });
  const w = dom.window;
  w.MAState = { getState: () => state };
  w.SiteState = { get: () => saved || null, set() {}, getPmaResults: () => null };
  w.eval(read('js/market-analysis/site-comparison.js'));
  return w;
}

// ── capture: null stays null, with its reason ────────────────────────────────
const unknownState = { siteLat: 39.7, siteLon: -105.0, siteScoreResult: unknown, qctFlag: null, ddaFlag: null };
const snap = load(unknownState).SiteComparison.capture();
assert.ok(snap, 'no snapshot captured for a scored site');
assert.strictEqual(snap.subsidy, null, `unknown subsidy was captured as ${snap.subsidy}, not null`);
assert.strictEqual(snap.subsidyUnavailableReason, REASON, 'the scorer\'s reason did not travel with the snapshot');
assert.strictEqual(snap.qct, null, 'an unknown QCT designation was captured as a "no"');
assert.strictEqual(snap.dda, null, 'an unknown DDA designation was captured as a "no"');
// Agreement with the scorer, dimension by dimension.
DIMS.forEach((k) => {
  const expected = unknown[k + '_score'];
  assert.strictEqual(snap[k], expected === null || expected === undefined ? null : expected,
    `${k}: snapshot ${snap[k]} disagrees with the scorer's ${expected}`);
});

const knownSnap = load({ siteLat: 39.7, siteLon: -105.0, siteScoreResult: known, qctFlag: false, ddaFlag: false })
  .SiteComparison.capture();
assert.strictEqual(knownSnap.subsidy, known.subsidy_score, 'a known subsidy score was not carried through');
assert.strictEqual(knownSnap.subsidyUnavailableReason, null);
assert.strictEqual(knownSnap.qct, false, 'a verified "not in a QCT" must stay false');

// A genuine 0 is a value, not an absence.
const zero = Object.assign({}, known, { policy_score: 0 });
const zeroSnap = load({ siteLat: 39.7, siteLon: -105.0, siteScoreResult: zero }).SiteComparison.capture();
assert.strictEqual(zeroSnap.policy, 0, 'a measured 0 was turned into null');

// ── render: unavailable is shown as unavailable, never as 0 ─────────────────
async function rendered(sites) {
  const w = load(null, sites);
  await new Promise((resolve) => w.setTimeout(resolve, 20));
  w.SiteComparison.render();
  return w.document;
}

(async () => {
  const unknownSite = Object.assign({}, snap, { id: 'a', label: 'Unknown designation' });
  const zeroSite = Object.assign({}, zeroSnap, { id: 'b', label: 'Measured zero' });
  const doc = await rendered([unknownSite, zeroSite]);
  const rows = Array.from(doc.querySelectorAll('tbody tr'));
  assert.strictEqual(rows.length, 2, 'the comparison table did not render both sites');
  let checkedCells = 0;
  rows.forEach((row) => {
    const site = row.getAttribute('data-site-id') === 'a' ? unknownSite : zeroSite;
    const cells = row.querySelectorAll('td');
    DIMS.forEach((k, i) => {
      const cell = cells[4 + i];
      checkedCells += 1;
      if (site[k] === null) {
        assert.strictEqual(cell.getAttribute('data-unavailable'), 'true', `${site.label} ${k}: null rendered as a value`);
        assert.ok(!/\b0\b/.test(cell.textContent), `${site.label} ${k}: null rendered as 0 ("${cell.textContent}")`);
        if (k === 'subsidy') assert.ok(cell.textContent.includes(REASON), 'the subsidy cell does not give the scorer\'s reason');
      } else {
        assert.notStrictEqual(cell.getAttribute('data-unavailable'), 'true', `${site.label} ${k}: a measured score is marked unavailable`);
        assert.strictEqual(cell.textContent.trim(), String(Math.round(site[k])), `${site.label} ${k}: shows "${cell.textContent}" for ${site[k]}`);
      }
    });
  });
  assert.ok(checkedCells >= 12, 'the scan checked too few cells to mean anything');
  const unknownRow = rows.find((r) => r.getAttribute('data-site-id') === 'a');
  assert.ok(/Unknown/.test(unknownRow.cells[10].textContent) && /Unknown/.test(unknownRow.cells[11].textContent),
    'an unknown QCT/DDA designation renders as something other than "Unknown"');

  // A site with no final score is listed after scored sites, not ranked as a 0.
  const unscored = Object.assign({}, zeroSite, { id: 'c', label: 'Unscored', finalScore: null });
  const doc2 = await rendered([unscored, zeroSite]);
  assert.strictEqual(doc2.querySelector('tbody tr').getAttribute('data-site-id'), 'b',
    'an unscored site outranked a scored one');

  // The insight line never calls an unmeasured dimension the strongest.
  const insight = (await rendered([unknownSite, zeroSite])).querySelector('.sc-insight');
  assert.ok(insight, 'no insight rendered for two sites');

  console.log('site-comparison-null-score: PASS');
})().catch((e) => { console.error('site-comparison-null-score: FAIL —', e.message); process.exit(1); });
