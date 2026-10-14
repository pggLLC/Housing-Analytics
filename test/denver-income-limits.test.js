'use strict';
// The Deep Dive's Denver income-limit table must show the figures and year in
// data/hud-fmr-income-limits.json, not numbers typed into the page. It used to
// read "(2025)" over sixteen figures that matched no HUD release.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'colorado-deep-dive.html'), 'utf8');
const hud = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hud-fmr-income-limits.json'), 'utf8'));
const denver = hud.counties.find((c) => c.fips === '08031');
assert(denver && denver.income_limits, 'Denver (08031) is in the HUD file');

// No dollar figure is typed into the table: every cell starts as a placeholder.
const doc0 = new JSDOM(html).window.document;
const table0 = doc0.getElementById('denverIncomeLimits');
assert(table0, 'the Denver income-limit table exists');
const typed = [...table0.querySelectorAll('td')].filter((td) => /\$\d/.test(td.textContent));
assert.equal(typed.length, 0, 'no dollar figure is typed into the Denver table');
assert(!/AMI Breakdown \(20\d\d\)/.test(html), 'no typed year in the Denver table heading');

const dom = new JSDOM(html);
global.window = dom.window;
global.document = dom.window.document;
const { render } = require(path.join(ROOT, 'js', 'components', 'denver-income-limits.js'));
render(hud);

const table = dom.window.document.getElementById('denverIncomeLimits');
let checked = 0;
for (const tier of ['30', '50', '60', '80']) {
  const cells = table.querySelectorAll(`tr[data-il-tier="${tier}"] td`);
  [1, 2, 3, 4].forEach((size, i) => {
    const v = denver.income_limits[`il${tier}_${size}person`];
    assert.equal(cells[i].textContent, '$' + v.toLocaleString('en-US'), `${tier}% AMI, ${size} person matches the data file`);
    checked += 1;
  });
}
assert.equal(checked, 16, 'all sixteen cells were checked');
const years = [...dom.window.document.querySelectorAll('[data-denver-il-year]')].map((e) => e.textContent);
assert(years.length >= 2 && years.every((y) => y === 'FY' + hud.meta.income_limits_fiscal_year), 'every year label names the data file\'s Income Limits year');

// A missing figure stays a dash; nothing is estimated.
const partial = JSON.parse(JSON.stringify(hud));
delete partial.counties.find((c) => c.fips === '08031').income_limits.il50_2person;
render(partial);
assert.equal(table.querySelector('tr[data-il-tier="50"] td:nth-of-type(2)').textContent, '—', 'a missing limit renders as a dash');

console.log('denver-income-limits: PASS');
