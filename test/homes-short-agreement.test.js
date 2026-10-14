'use strict';
// "Homes short" must be one number wherever a reader sees it. The homepage
// cards render the matched shortfall (a home counts only for households who
// can afford its rent); until 2026-10-14 the Deal Calculator's gap line
// rendered the pooled gap as "units needed", so a county could read 120,000
// short at ≤30% AMI on one page and fewer at ≤60% on the other. This pins
// the Deal Calculator line to the same data field the homepage reads.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const county = JSON.parse(read('data/co_ami_gap_by_county.json'));
const place = JSON.parse(read('data/co_ami_gap_by_place.json'));
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

const dom = new JSDOM('<!doctype html><body><p id="dc-fmr-note"></p><div id="dc-ami-gap-info"></div></body>', { runScripts: 'outside-only' });
const w = dom.window;
w.eval(extractFunction(dc, '_homesShortFromRecord') + ';' + extractFunction(dc, '_renderAmiGapInfo') +
  ';window._render = _renderAmiGapInfo; window._findAmiGapPlace = null; window._findAmiGapCounty = null;' +
  'function _findAmiGapPlace(g) { return window._findAmiGapPlace(g); }' +
  'function _findAmiGapCounty(f) { return window._findAmiGapCounty(f); }');

// The figures the line shows, in order (≤30, ≤50, ≤60).
function rendered(rec, kind) {
  w._findAmiGapPlace = () => (kind === 'place' ? rec : null);
  w._findAmiGapCounty = () => (kind === 'county' ? rec : null);
  w._render('x', kind === 'place' ? 'y' : null);
  const text = w.document.getElementById('dc-ami-gap-info').textContent;
  const m = text.match(/≤30% AMI: ([\d,—]+).*≤50% AMI: ([\d,—]+).*≤60% AMI: ([\d,—]+)/);
  assert(m, 'the gap line names the three bands: ' + text);
  return m.slice(1).map((s) => (s === '—' ? null : Number(s.replace(/,/g, ''))));
}

let checked = 0;
for (const [kind, rows] of [['county', county.counties], ['place', Object.values(place.places)]]) {
  for (const rec of rows) {
    const want = ['30', '50', '60'].map((b) => rec.min_shortfall_matched_le_ami_pct[b]);
    assert.deepEqual(rendered(rec, kind), want, `${rec.county_name || rec.place_name}: Deal Calculator shows the matched shortfall`);
    checked++;
  }
}
assert(checked > 500, `checked ${checked} records`);

// A record without the field shows a dash, never 0.
const bare = Object.assign({}, county.counties[0]);
delete bare.min_shortfall_matched_le_ami_pct;
assert.deepEqual(rendered(bare, 'county'), [null, null, null], 'a record without the matched shortfall shows —, not 0');

// The homepage reads the same field (its own test pins the values it shows).
assert(/statewide\.min_shortfall_matched_le_ami_pct/.test(read('js/index.js')), 'the homepage cards read the matched shortfall too');

console.log(`homes-short-agreement: PASS (${checked} records)`);
