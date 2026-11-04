// test/hna-gap-summary-sources.test.js
//
// The housing gap summary on "What households can afford" cited ACS 2025
// 1-year B25070 in its paragraph but ended with a fixed "ACS 5-year DP03/DP04
// (vintage 2020-2024) · HUD CHAS Table 7" footer. It also turned the renter
// share into "direct demand" or "longer absorption", and compared median rent
// with all-household income as if it were renter income. Each source now
// names its own survey and period, CHAS is cited only when its line shows,
// and the tenure and income lines say only what the figures measure.
//
// Run: node test/hna-gap-summary-sources.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const summary = (g) => JSON.parse(read(`data/hna/summary/${g}.json`));

const dom = new JSDOM('<!doctype html><body><div id="housingGapSummary"></div></body>',
  { url: 'http://127.0.0.1/hna-what-households-can-afford.html', runScripts: 'outside-only' });
const w = dom.window;
w.APP_CONFIG = {};
w.HNAState = { state: {} };
for (const f of ['js/utils/format-money.js', 'js/hna/hna-utils.js', 'js/hna/hna-renderers.js']) w.eval(read(f));

let passed = 0;
function check(cond, msg) { assert.ok(cond, msg); console.log('  ✅ PASS: ' + msg); passed++; }

const el = w.document.getElementById('housingGapSummary');
function render(g, chas) {
  const s = summary(g);
  w.HNAState.state.chasData = chas || null;
  w.HNARenderers.renderHousingGapSummary(Object.assign({}, s.acsProfile, { _geoType: s.geo.type, _geoid: g }), s.geo.type);
  const lis = [...el.querySelectorAll('li')].map((li) => li.textContent);
  const foot = el.querySelector('p') ? el.querySelector('p').textContent : '';
  return { text: el.textContent, lis, foot };
}
const banned = /direct demand|absorption|Median renters cannot|stress is concentrated/i;

// Mesa County: 2025 1-year profile and counts.
let r = render('08077');
check(/ACS 2025 1-year profile DP03 and DP04/.test(r.foot), 'Mesa footer: 2025 1-year DP03 and DP04');
check(/ACS 2025 1-year table B25070/.test(r.foot), 'Mesa footer: 2025 1-year B25070');
check(!/5-year|2020.2024/.test(r.foot), 'Mesa footer: no 5-year label');
check(!/CHAS/.test(r.foot), 'Mesa footer: no CHAS without its line');
check(/29\.5%<\/strong> of occupied homes are rented|29\.5% of occupied homes are rented/.test(el.innerHTML), 'Mesa: 29.5% rented, number kept');
check(!banned.test(r.text), 'Mesa: no demand or absorption claim');
check(/all households, owners and renters together/.test(r.text) && /\$82,490/.test(r.text), 'Mesa: income named as all households');
check(/38\.7%/.test(r.text), 'Mesa: corrected 38.7% at 50% or more unchanged');

// Same with CHAS county data loaded: CHAS cited, with its vintage.
const chas = JSON.parse(read('data/hna/chas_affordability_gap.json'));
r = render('08077', chas);
const chasLine = r.lis.some((t) => /HUD CHAS county data/.test(t));
check(chasLine === /HUD CHAS 2018-2022 for the 50% AMI line only/.test(r.foot), 'Mesa + CHAS: CHAS in footer exactly when its line shows');

// Denver: 2025 1-year.
r = render('08031');
check(/ACS 2025 1-year profile DP03 and DP04/.test(r.foot) && /ACS 2025 1-year table B25070/.test(r.foot), 'Denver footer: 2025 1-year');
check(/53\.2%/.test(r.text) && !banned.test(r.text), 'Denver: 53.2% rented, no "direct demand"');
check(/vacancy, comparable rents and a market study/.test(r.text), 'Denver: points to vacancy, rents and a market study');

// Fruita: 2020-2024 5-year.
r = render('0828745');
check(/ACS 2020-2024 5-year profile DP03 and DP04/.test(r.foot) && /ACS 2020-2024 5-year table B25070/.test(r.foot), 'Fruita footer: 2020-2024 5-year');
check(!/1-year/.test(r.foot), 'Fruita footer: no 1-year label');
check(/165/.test(r.text) && /19\.6%/.test(r.text), 'Fruita: corrected 165 (19.6%) unchanged');

// Castle Rock: 2025 1-year profile with no B25070 counts.
r = render('0812415');
check(/ACS 2025 1-year profile DP03 and DP04/.test(r.foot), 'Castle Rock footer: 2025 1-year profile');
check(!/B25070/.test(r.foot), 'Castle Rock footer: no B25070 when counts are missing');
check(/not available/.test(r.text), 'Castle Rock: severe figure marked not available');
check(!banned.test(r.text), 'Castle Rock: no demand or absorption claim');

console.log(`\n${passed} passed`);
