// Guards for year-over-year changes and labels on the economic dashboard,
// the census snapshot and the Market Signals statewide figures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');
const html = read('economic-dashboard.html');
const fred = JSON.parse(read('data/fred-data.json'));

// Pull the change helpers out of the page and run them on the cached data.
function extract(name) {
  const start = html.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `${name} should exist in economic-dashboard.html`);
  const end = html.indexOf('\n  }\n', start);
  return html.slice(start, end + 4);
}
const ctx = {};
vm.runInNewContext(['yearAgoIndex', 'pickChange', 'yoyPct'].map(extract).join('\n') +
  '\nthis.yearAgoIndex = yearAgoIndex; this.pickChange = pickChange; this.yoyPct = yoyPct;', ctx);

function series(id) {
  return fred.series[id].observations
    .filter(o => o && o.value !== '.' && o.value !== null && o.date)
    .map(o => ({ date: o.date, value: Number(o.value) }))
    .filter(o => isFinite(o.value));
}
function yearBefore(date) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

for (const id of ['DGS10', 'ECIALLCIV', 'HOUST', 'ICSA', 'UNRATE']) {
  const s = series(id);
  const i = ctx.yearAgoIndex(s);
  assert.ok(i >= 0, `${id}: a year-earlier observation is found`);
  const target = yearBefore(s[s.length - 1].date);
  assert.ok(s[i].date <= target, `${id}: comparison date ${s[i].date} is not after ${target}`);
  assert.ok(i === s.length - 1 || s[i + 1].date > target, `${id}: comparison is the closest date not after ${target}`);
  const c = ctx.pickChange(s);
  assert.equal(c.label, 'YoY', `${id}: change is labelled YoY`);
  assert.equal(c.base, s[i].value, `${id}: change is measured against the year-earlier value`);
}

// A series shorter than a year falls back to the previous point, labelled "chg".
const short = [{ date: '2026-08-01', value: 10 }, { date: '2026-09-01', value: 12 }];
const sc = ctx.pickChange(short);
assert.equal(sc.label, 'chg');
assert.equal(sc.delta, 2);

// Headline and card values are computed from full history, not a short tail.
assert.ok(!/length\s*-\s*13/.test(html), 'no fixed 13-observation lookback remains');
assert.ok(html.includes('pickChange(history)'), 'indicator cards compute change on full history');

// Construction strip labels match the series they show.
assert.ok(!html.includes('UNDCON5MUSA') && !html.includes('COMPU5MUSA'), 'strip cites the series actually loaded');
assert.ok(html.includes('series/UNDCONTSA" target="_blank" rel="noopener">FRED UNDCONTSA'));
assert.ok(html.includes('series/COMPUTSA" target="_blank" rel="noopener">FRED COMPUTSA'));

// Card values carry their FRED units.
assert.ok(html.includes('" thousand"') && html.includes('" million"'), 'thousands and $ millions units are shown');

const geo = read('js/census-geo.js');
assert.ok(!geo.includes('All multifamily'), 'UNDCONTSA is all housing units, not multifamily');
assert.ok(!/COMPUTSA[\s\S]{0,200}5\+ unit/.test(geo.slice(geo.indexOf('id:    "COMPUTSA"'))), 'COMPUTSA is not labelled 5+ units');
assert.ok(geo.includes('r.built_2020_or_later') && geo.includes('r.built_2010_to_2019'), 'built 2010+ = B25034_002E + B25034_003E');
assert.ok(!geo.includes('r.built_2010_or_later'), 'B25034_010E (built 1940-1949) is not used');

const acs = JSON.parse(read('data/census-acs-state.json'));
assert.ok(!('B25034_010E' in acs.meta.variables), 'snapshot does not map B25034_010E to built 2010 or later');
assert.ok(acs.data.every(r => !('built_2010_or_later' in r)), 'no mislabelled built_2010_or_later values remain');

const mi = read('js/market-intelligence.js');
assert.ok(mi.includes("resolveData('census-acs-state.json')"), 'statewide price and income use the statewide ACS estimate');
assert.ok(!/median_home_price:\s*avg\(/.test(mi) && !/median_hh_income:\s*avg\(/.test(mi), 'no average of county medians');
assert.equal((mi.match(/B25070_011E/g) || []).length >= 4, true, '"Not computed" renters leave the cost-burden denominator');

console.log('Economic dashboard YoY change and label guard passed.');
