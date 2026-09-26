'use strict';

// The pages that read the statewide transit-stop file must read what the file
// actually holds (#1937 Phase 1). The TOD check compares `reliability` to
// 'unconfirmed' and the data-map browser pops up agency / sources /
// reliability; rename a property in the builder and those comparisons go
// silently false (every stop "confirmed", every popup blank) with nothing red.
// So this pins the agreement between the consumers and the committed file,
// not either side's wording.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ── The file the consumers point at ─────────────────────────────────────────
const ma = read('js/market-analysis.js');
const layerSrc = (ma.match(/transitStops:\s*\{\s*src:\s*'([^']+)'/) || [])[1];
assert.ok(layerSrc, 'transitStops layer source not found in js/market-analysis.js');

const dmb = read('data-map-browser.html');
const dmbBlock = (dmb.match(/\{ key: 'transit', name: 'Transit stops'[\s\S]*?\} \},/) || [])[0];
assert.ok(dmbBlock, 'transit-stops layer not found in data-map-browser.html');
const dmbUrl = (dmbBlock.match(/url: '([^']+)'/) || [])[1];

assert.equal('data/' + layerSrc, dmbUrl, 'the market-analysis page and the data-map browser read different stop files');
const stops = JSON.parse(read(dmbUrl));
assert.ok(Array.isArray(stops.features) && stops.features.length > 0, `${dmbUrl} holds no stops`);

// Every property either consumer reads must exist on the file's features.
const props = new Set();
const values = {};
for (const f of stops.features) {
  for (const [k, v] of Object.entries(f.properties || {})) {
    props.add(k);
    if (typeof v === 'string') (values[k] = values[k] || new Set()).add(v);
    if (Array.isArray(v)) v.forEach((x) => (values[k] = values[k] || new Set()).add(x));
  }
}

const dmbProps = [...dmbBlock.matchAll(/\bp\.([a-z_]+)/g)].map((m) => m[1]);
assert.ok(dmbProps.length >= 3, 'data-map-browser popup reads too few properties to be checking anything');
for (const p of dmbProps) assert.ok(props.has(p), `data-map-browser reads p.${p}, which no stop has`);

// The source labels the popup maps must be the source values the file uses.
const srcKeys = [...(dmbBlock.match(/var SRC = \{([^}]*)\}/) || ['', ''])[1].matchAll(/(\w+):/g)].map((m) => m[1]);
assert.deepEqual(srcKeys.sort(), [...values.sources].sort(), 'popup source labels disagree with the file\'s source values');

// ── The TOD check ───────────────────────────────────────────────────────────
const todFn = (ma.match(/function _highlightTodTransit[\s\S]*?\n  \}\n/) || [])[0];
assert.ok(todFn, '_highlightTodTransit not found');
const compared = [...todFn.matchAll(/f\.properties\.(\w+) === '([^']+)'/g)].map((m) => [m[1], m[2]]);
assert.ok(compared.length > 0, 'the TOD check compares no stop property — the scan found nothing to check');
for (const [k, v] of compared) {
  assert.ok(values[k] && values[k].has(v), `the TOD check compares ${k} to '${v}', a value no stop in ${dmbUrl} has`);
}
// And the value it singles out must be the one the builder writes for OSM-only stops.
const builder = read('scripts/market/build_transit_stops_co.py');
assert.match(builder, /\["osm"\], "unconfirmed"/, 'the builder no longer marks OpenStreetMap-only stops "unconfirmed"');

console.log(`transit-stops-consumers: ${stops.features.length} stops; ${dmbProps.length} popup fields and ${compared.length} TOD comparison(s) agree with ${dmbUrl} — OK`);
