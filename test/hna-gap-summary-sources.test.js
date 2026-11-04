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
// Claims that the renter share or median income cannot support. These are
// claims, not wording: any phrasing of them is wrong for these figures.
const banned = /direct demand|absorption|lease.?up|Median renters cannot|stress is concentrated/i;

// What each footer must agree with: the survey and period stored on the
// profile the panel read, and the CHAS file's own vintage. Reword the footer
// freely; change a period on one side only and this fails.
const U = w.HNAUtils;
const chas = JSON.parse(read('data/hna/chas_affordability_gap.json'));
const otherSeries = (sr) => (sr === 'acs1' ? /5-year/ : /1-year/);
const money = (n) => '$' + Number(n).toLocaleString('en-US');
let scanned = 0;

for (const [g, name] of [['08077', 'Mesa'], ['08031', 'Denver'], ['0828745', 'Fruita'], ['0812415', 'Castle Rock']]) {
  const p = summary(g).acsProfile;
  for (const chasData of [null, chas]) {
    const r = render(g, chasData);
    const tag = name + (chasData ? ' + CHAS' : '');
    scanned++;
    const period = U.acsSeriesText(p._acsSeries, p._acsYear);
    check(r.foot.includes(period) && /DP03/.test(r.foot) && /DP04/.test(r.foot),
      tag + ': footer names the profile period (' + period + ') for DP03/DP04');
    check(!otherSeries(p._acsSeries).test(r.foot), tag + ': footer carries no other survey period');
    if (p._b25070Series) {
      const bp = U.acsSeriesText(p._b25070Series, p._b25070Year);
      check(new RegExp(bp + '[^·]*B25070').test(r.foot), tag + ': B25070 cited with its own period (' + bp + ')');
    } else {
      check(!/B25070/.test(r.foot), tag + ': no B25070 cited when the profile has no counts');
    }
    const chasShown = r.lis.some((t) => /CHAS/.test(t));
    check(/CHAS/.test(r.foot) === chasShown, tag + ': CHAS cited exactly when its line shows (' + chasShown + ')');
    if (chasShown) check(r.foot.includes(chas.meta.vintage), tag + ': CHAS cited with the file vintage ' + chas.meta.vintage);
    // Tenure: the figure shown is the profile's renter share; no demand claim.
    check(r.text.includes(p.DP04_0047PE + '%'), tag + ': renter share shown equals DP04_0047PE (' + p.DP04_0047PE + '%)');
    check(!banned.test(r.text), tag + ': no demand, absorption or renter-affordability claim');
    // Income: the figure shown is DP03_0062E, and it is named as all households.
    const incLine = r.lis.find((t) => t.includes(money(p.DP03_0062E))) || '';
    check(incLine && /all households/i.test(incLine), tag + ': DP03_0062E (' + money(p.DP03_0062E) + ') named as all-household income');
  }
}
check(scanned === 8, 'scanned 4 places with and without CHAS loaded');

// Corrected #2668 counts unchanged.
render('08077');
// Mesa moved to the 2020-2024 5-year on 4 Nov 2026: 4,111 (25.1%) at 50%+.
check(/25\.1%/.test(el.textContent) && /4,111/.test(el.textContent), 'Mesa: 4,111 (25.1%) at 50% or more on the 2020-2024 5-year');
render('0828745');
check(/165/.test(el.textContent) && /19\.6%/.test(el.textContent), 'Fruita: corrected 165 (19.6%) unchanged');
render('0812415');
// Its 1-year profile had no B25070 counts; the 5-year has them (4 Nov 2026).
check(/1,573/.test(el.textContent) && /27\.9%/.test(el.textContent), 'Castle Rock: 1,573 (27.9%) at 50% or more on the 2020-2024 5-year');

console.log(`\n${passed} passed`);
