'use strict';

// The Market Analysis page has one primary score (audit F2).
//
// Found 2026-09-24: Fruita showed 58 "Marginal", 55 "Moderate" and 60 "Low".
// The PMA score and the site-selection index are two models whose bands use
// different cut-offs, and the scenario table scored its rows without the
// site, tracts, AMI or CHAS data, so its baseline disagreed with the
// headline. Nothing marked which number was the answer.
//
// The rendered agreement (one score marked primary, the scenario table's
// no-project row equal to it, each scale showing its own legend) is held in
// the browser by scripts/audit/core-rendered-smoke.mjs, run by site-audit on
// every PR. This file holds the pieces that do not need a browser.

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

function load(rel) {
  const abs = path.join(ROOT, rel);
  delete require.cache[require.resolve(abs)];
  return require(abs);
}

console.log('\nOne primary PMA score; the others are named and scaled apart');

global.window = {};
const scoring = load('js/market-analysis-scoring.js');
load('js/market-analysis/market-analysis-utils.js');
const MAUtils = global.window.MAUtils;

test('the PMA legend is read off scoreTier itself, so it agrees with every label', () => {
  const src = require('fs').readFileSync(path.join(ROOT, 'js/market-analysis.js'), 'utf8');
  const m = src.match(/function scoreScaleLegend\(\) \{[\s\S]*?\n  \}/);
  assert(m, 'scoreScaleLegend() is gone from js/market-analysis.js');
  const legend = new Function('scoreTier', m[0] + '; return scoreScaleLegend();')(scoring.scoreTier);
  const spans = legend.split(' \u00b7 ').map((x) => { const r = x.match(/^(\S+) (\d+)\u2013(\d+)$/); return r && { label: r[1], lo: +r[2], hi: +r[3] }; });
  assert(spans.length >= 3 && spans.every(Boolean), 'legend: ' + legend);
  for (let v = 0; v <= 100; v++) {
    const span = spans.find((t) => v >= t.lo && v <= t.hi);
    assert(span && span.label === scoring.scoreTier(v).label, `the legend says ${span && span.label} for ${v}; the score reads ${scoring.scoreTier(v).label}`);
  }
});

test('the site-selection bands are read from their own table, and differ from the PMA tiers', () => {
  const bands = MAUtils.OPPORTUNITY_BANDS;
  assert(Array.isArray(bands) && bands.length >= 2, 'OPPORTUNITY_BANDS is not exported');
  for (const b of bands) {
    if (b.min === -Infinity) continue;
    assert.strictEqual(MAUtils.opportunityBand(b.min), b.label, `an index of ${b.min} is not ${b.label}`);
  }
  const differs = [...Array(101).keys()].some((v) => {
    const b = MAUtils.opportunityBand(v); const t = scoring.scoreTier(v).label;
    return (b === 'High') !== (t === 'Strong') || (b === 'Lower') !== (t === 'Weak');
  });
  assert(differs, 'the two scales cut at the same points; they would not need separate legends');
});

test('no score is no band, never "Lower"', () => {
  for (const v of [null, undefined, NaN, '57']) {
    assert.strictEqual(MAUtils.opportunityBand(v), null, `${String(v)} was banded as ${MAUtils.opportunityBand(v)}`);
  }
});

test('the scenario table scores its rows with the scorer it is given', () => {
  const calls = [];
  global.window.PMAEngine = {
    computePma: () => ({ overall: 99, dimensions: {}, flags: [] }),
    simulateCapture: (den, units) => ({ proposedUnits: units, captureRate: den ? Math.round(units / den * 1000) / 10 : 0, risk: 'Low' }),
  };
  const ENH = (load('js/market-analysis-enhancements.js'), global.window.PMAEnhancements);
  const scorer = (units) => { calls.push(units); return { overall: 60 - units / 100, dimensions: {}, flags: [] }; };
  const rows = ENH.generateScenarios({ renter_hh: 991 }, 10,
    [{ label: 'none', proposedUnits: 0, amiMix: { ami60: 0 } }].concat(ENH.defaultScenarios(100)), 598, scorer);
  assert.strictEqual(rows[0].overall, scorer(0).overall, 'the no-project row is not the scorer\'s score for 0 units');
  assert(calls.includes(0) && calls.includes(100), 'the scorer was not called for every row: ' + calls.join(','));
  assert(!rows.some((r) => r.overall === 99), 'a row used the input-less computePma');
});

delete global.window;
console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed ✅');
process.exit(failures ? 1 : 0);
