'use strict';
// "Homes short" must be one number wherever a reader sees it. The homepage
// cards and the Deal Calculator's gap line both show renter homes that are
// affordable AND available to each income group, from
// data/hna/chas_affordable_available.json (HUD CHAS Tables 15C and 14B).
// Until 2026-10-14 the gap line showed a different series from the
// homepage, so one county could read two shortfalls on two pages. This runs
// the real renderer against every record and pins both pages to the file.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const AA_PATH = 'data/hna/chas_affordable_available.json';
const aa = JSON.parse(read(AA_PATH));
const dc = read('js/deal-calculator.js');

function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert(start >= 0, 'deal-calculator.js defines ' + name);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unbalanced ' + name);
}

// The Deal Calculator loads the file the homepage reads.
assert(dc.includes(`'${AA_PATH}'`), 'the Deal Calculator loads ' + AA_PATH);
assert(read('js/index.js').includes("DS.baseData('hna/chas_affordable_available.json')"), 'the homepage cards read ' + AA_PATH);

const dom = new JSDOM('<!doctype html><body><p id="dc-fmr-note"></p><div id="dc-ami-gap-info"></div></body>', { runScripts: 'outside-only' });
const w = dom.window;
w.eval('var _chasAaData = null;' + extractFunction(dc, '_findChasRecord') + ';' + extractFunction(dc, '_homesShortFromRecord') + ';' +
  extractFunction(dc, '_renderAmiGapInfo') + ';window._render = _renderAmiGapInfo; window._setData = function (d) { _chasAaData = d; };');
w._setData(aa);

// The figures the line shows, in order (≤30, ≤50, ≤80).
function rendered(fips, placeGeoid) {
  w._render(fips, placeGeoid);
  const el = w.document.getElementById('dc-ami-gap-info');
  if (el.hidden) return null;
  const text = el.textContent;
  const m = text.match(/≤30% AMI: ([\d,—]+).*≤50% AMI: ([\d,—]+).*≤80% AMI: ([\d,—]+)/);
  assert(m, 'the gap line names the three bands: ' + text);
  return { text, values: m.slice(1).map((s) => (s === '—' ? null : Number(s.replace(/,/g, '')))) };
}

let checked = 0;
const bands = ['30', '50', '80'];
for (const [fips, rec] of Object.entries(aa.counties)) {
  const got = rendered(fips, null);
  assert.deepEqual(got.values, bands.map((b) => rec.tiers[b].homes_short_nested), `${rec.name}: Deal Calculator shows the file's nested homes short`);
  assert(got.text.includes(rec.name) && got.text.includes(aa.meta.vintage), `${rec.name}: line names the place and the CHAS vintage`);
  // The nested figure is this site's rule; the line says so whenever it differs from HUD's.
  if (bands.some((b) => rec.tiers[b].homes_short_nested !== rec.tiers[b].homes_short)) {
    assert(/not HUD/.test(got.text), `${rec.name}: line says the carried-forward shortfall is this site's rule, not HUD's`);
  }
  checked++;
}
for (const [geoid, rec] of Object.entries(aa.places)) {
  const got = rendered('08001', geoid);
  assert.deepEqual(got.values, bands.map((b) => rec.tiers[b].homes_short_nested), `${rec.name}: place record wins over the county`);
  for (const b of bands) {
    const p = rec.tiers[b].homes_per_100_households;
    if (p != null) assert(got.text.includes(`(${Math.round(p)} per 100)`), `${rec.name}: ≤${b}% per 100 shown`);
  }
  checked++;
}
assert(checked >= 546, `checked ${checked} records`);

// A record without tiers shows a dash, never 0; no record hides the line.
w._setData({ meta: aa.meta, counties: { '08001': { name: 'Bare' } }, places: {} });
assert.deepEqual(rendered('08001', null).values, [null, null, null], 'a record without tiers shows —, not 0');
assert.equal(rendered('08999', null), null, 'no record hides the line instead of showing zeros');

// The homepage cards show the same statewide record (test/homepage-claims.test.js pins the values).
console.log(`homes-short-agreement: PASS (${checked} records)`);
