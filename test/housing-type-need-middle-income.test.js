'use strict';

/**
 * The middle-income rental lane (80–120% AMI) in housing-type-need.
 *
 * Before it, the 80–120% band appeared only as ownership, so the HNA could not
 * say whether a place needed middle-income rental (docs/DEVELOPER-TRACKS.md).
 *
 * Held here:
 *   1. The lane exists and scores from invented CHAS + ACS inputs to a value
 *      computed by hand below.
 *   2. An unreported 81–100% band is unknown, not an empty band: the share
 *      indicator is null, never 0 (AGENTS.md, "null, never 0").
 *   3. The lane's AMI band agrees with what the site's glossary says MIHTC
 *      covers. Reword either side alone and this fails.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

function load() {
  const dom = new JSDOM('<div></div>', { runScripts: 'outside-only', url: 'http://127.0.0.1/hna-what-to-do.html' });
  dom.window.eval(fs.readFileSync(path.join(ROOT, 'js/components/housing-type-need.js'), 'utf8'));
  return dom.window.HousingTypeNeed;
}

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

console.log('\nHousing-type need: middle-income rental lane');
console.log('='.repeat(62));

const HTN = load();
const lane = (results) => results.find((r) => r.type === 'middleIncomeRental');

// Invented: 500 renters, 50 of them at 81–100% AMI (10%), 10 of those burdened (20%).
const chas = {
  renter_hh_by_ami: {
    lte30: { total: 100, cost_burdened_30pct: 80 },
    '31to50': { total: 100, cost_burdened_30pct: 60 },
    '51to80': { total: 100, cost_burdened_30pct: 40 },
    '81to100': { total: 50, cost_burdened_30pct: 10 },
    '100plus': { total: 150, cost_burdened_30pct: 5 },
  },
};
const acs = { DP05_0001E: 20000, DP04_0047PE: 45 };

test('the lane is computed and labelled for 80–120% AMI rental', () => {
  const r = lane(HTN.compute({ acsProfile: acs, chasRows: chas }));
  assert(r, 'middleIncomeRental is among the results');
  assert.match(r.meta, /80–120% AMI/);
  assert.match(r.meta, /rent/);
});

test('score matches the hand calculation', () => {
  // share 10%  → ramp [7,35]-[12,70]   → 35 + 3/5·35   = 56
  // burden 20% → ramp [15,40]-[30,80]  → 40 + 5/15·40  = 53.33
  // renter 45% → ramp [45,75]          → 75
  // home value / MHI unavailable (no HNAUtils) → excluded, weights renormalised
  // (56·.30 + 53.33·.30 + 75·.15) / .75 = 58.73 → 59
  const r = lane(HTN.compute({ acsProfile: acs, chasRows: chas }));
  assert.strictEqual(r.score, 59);
});

test('an unreported 81–100% band is unknown, not zero', () => {
  const partial = JSON.parse(JSON.stringify(chas));
  delete partial.renter_hh_by_ami['81to100'];
  const r = lane(HTN.compute({ acsProfile: acs, chasRows: partial }));
  const names = r.signals.map((s) => s.name);
  assert(!names.includes('81–100% AMI renter share'), 'share indicator must be absent, not scored as 0%');
  assert(!names.includes('Cost burden in 81–100% AMI cohort'), 'burden indicator must be absent');
  assert.match(r.confidenceReason, /^1 of 4 indicators populated/);
});

test('lane band agrees with the glossary definition of MIHTC', () => {
  const glossary = fs.readFileSync(path.join(ROOT, 'js/components/inline-glossary.js'), 'utf8');
  const def = glossary.match(/'MIHTC':\s*'([^']+)'/);
  assert(def, 'inline glossary defines MIHTC');
  const g = def[1].match(/(\d+)% and (\d+)% AMI/);
  assert(g, 'glossary MIHTC definition names an AMI band');
  const r = lane(HTN.compute({ acsProfile: acs, chasRows: chas }));
  const m = r.meta.match(/(\d+)–(\d+)% AMI/);
  assert.deepStrictEqual([m[1], m[2]], [g[1], g[2]], 'lane band ' + m[0] + ' vs glossary ' + g[0]);
});

test('every signal the lanes report is formatted in its own unit', () => {
  // The renderer picks a unit from the signal's name. Run it over every signal
  // the seven lanes actually produce for a real county, so a new signal name
  // cannot silently land in the wrong unit (a 4.6x ratio once printed as "$5").
  const src = fs.readFileSync(path.join(ROOT, 'js/hna/hna-renderers.js'), 'utf8');
  const fnSrc = src.match(/function _htnFmtSignalValue\(name, raw\) \{[\s\S]*?\n  \}\n/);
  assert(fnSrc, 'renderer formatter found');
  const fmt = new Function(fnSrc[0] + '; return _htnFmtSignalValue;')();
  const summary = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/summary/08077.json'), 'utf8'));
  const chasAll = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/chas_affordability_gap.json'), 'utf8'));
  const win = new JSDOM('<div></div>', { runScripts: 'outside-only', url: 'http://127.0.0.1/hna-what-to-do.html' }).window;
  win.APP_CONFIG = {};
  // hna-utils resolves the home value; without it every ratio signal is null
  // and the scan below would check nothing that matters.
  win.eval(fs.readFileSync(path.join(ROOT, 'js/utils/format-money.js'), 'utf8'));
  win.eval(fs.readFileSync(path.join(ROOT, 'js/hna/hna-utils.js'), 'utf8'));
  win.eval(fs.readFileSync(path.join(ROOT, 'js/components/housing-type-need.js'), 'utf8'));
  const profile = summary.acsProfile || summary.acs || summary;
  const results = win.HousingTypeNeed.compute({ acsProfile: profile, chasRows: chasAll.counties['08077'] });
  const seen = [];
  results.forEach((r) => r.signals.forEach((sg) => seen.push([sg.name, sg.value, fmt(sg.name, sg.value)])));
  assert(seen.length >= 10, 'scan found signals to check (' + seen.length + ')');
  assert(seen.some(([name]) => /ratio/i.test(name)), 'scan includes a ratio signal');
  seen.forEach(([name, raw, out]) => {
    const lower = name.toLowerCase();
    if (/ratio| vs /.test(lower)) assert.match(out, /^\d+\.\d\dx$/, name + ' → ' + out);
    else if (/median household income/.test(lower)) assert.match(out, /^\$[\d,]+$/, name + ' → ' + out);
    else assert(!/^\$/.test(out), name + ' is not a dollar figure → ' + out);
  });
});

if (failures) { console.log('\n' + failures + ' failed'); process.exit(1); }
console.log('\nAll middle-income lane checks passed');
