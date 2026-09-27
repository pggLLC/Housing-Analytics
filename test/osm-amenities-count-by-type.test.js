/**
 * test/osm-amenities-count-by-type.test.js
 *
 * OsmAmenities.countByType() reports what the connector actually loaded, per
 * type. test/qa-recent-changes.js compares it against
 * data/derived/market-analysis/neighborhood_access.json in a browser; that
 * harness needs puppeteer and is not in CI, so the accessor itself is pinned
 * here. (#1945: the smoke check used to call a getAll() that never existed and
 * read 0 whether or not anything loaded.)
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js/data-connectors/osm-amenities.js'), 'utf8');

const sandbox = { window: {}, console: { log() {}, warn() {} } };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const A = sandbox.window.OsmAmenities;

assert.ok(A, 'window.OsmAmenities not defined');
assert.strictEqual(typeof A.countByType, 'function', 'OsmAmenities.countByType is not exported');
assert.deepStrictEqual({ ...A.countByType() }, {}, 'before loading, counts must be empty, not zero-filled');

A.loadAmenities([
  { type: 'grocery', name: 'A', lat: 39.74, lon: -104.99 },
  { type: 'grocery', name: 'B', lat: 39.75, lon: -104.99 },
  { type: 'hospital', name: 'C', lat: 39.72, lon: -104.99 },
  { name: 'no type', lat: 39.7, lon: -104.9 }
]);
assert.deepStrictEqual({ ...A.countByType() }, { grocery: 2, hospital: 1 },
  'counts must reflect exactly the loaded records (untyped records are skipped on load)');

const first = A.countByType();
first.grocery = 999;
assert.strictEqual(A.countByType().grocery, 2, 'countByType must return a fresh object, not internal state');

A.loadAmenities([{ type: 'childcare', name: 'D', lat: 39.7, lon: -104.9 }]);
assert.deepStrictEqual({ ...A.countByType() }, { childcare: 1 }, 'a reload must replace the previous counts');

console.log('osm-amenities-count-by-type: OK');
