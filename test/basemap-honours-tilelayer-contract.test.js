#!/usr/bin/env node
/**
 * A basemap must behave like a basemap, whatever it is made of.
 *
 * CARTO bundled place names into one tile layer. Esri splits them into a base
 * and a transparent reference overlay, so #1700 made labelled basemaps an
 * L.LayerGroup — and a LayerGroup is not a TileLayer. Two things broke:
 *
 *   bringToBack()  js/hna/hna-controller.js calls it after every basemap swap.
 *                  Threw "activeBase.bringToBack is not a function", reported
 *                  from the live site.
 *   tile events    a LayerGroup emits none, so `once('tileerror')` — the
 *                  fallback to OSM when a provider is unreachable — could
 *                  never fire. That one threw NOTHING. The fallback simply
 *                  stopped existing, which is the worse of the two and would
 *                  have gone unnoticed until a tile host went down.
 *
 * The lesson is the shape of the change, not the method list: swapping one
 * object for another that is "close enough" silently drops whatever the old
 * one promised. So this pins the contract the call sites actually rely on.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'config', 'basemaps.js'), 'utf8');

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
const test = (name, fn) => {
  try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); }
};

console.log('basemap-honours-tilelayer-contract');

/** Every method/event a call site uses on a basemap, found by reading them. */
const CALLERS = [
  { file: 'js/hna/hna-controller.js', uses: ['bringToBack', 'tileerror'] },
];

test('the call sites still use what we think they use', () => {
  // If a caller starts using another TileLayer method, this fails and the
  // contract below has to grow. Without it the list silently goes stale.
  for (const c of CALLERS) {
    const src = fs.readFileSync(path.join(ROOT, c.file), 'utf8');
    for (const u of c.uses) {
      assert.ok(src.includes(u), `${c.file} no longer uses ${u} — re-derive this list`);
    }
  }
  const extra = /activeBase\.(\w+)\(/g;
  const hna = fs.readFileSync(path.join(ROOT, 'js', 'hna', 'hna-controller.js'), 'utf8');
  const used = new Set();
  let m;
  while ((m = extra.exec(hna)) !== null) used.add(m[1]);
  const known = new Set(['bringToBack', 'bringToFront', 'setOpacity', 'addTo', 'once', 'on', 'off', 'remove']);
  const unknown = [...used].filter((u) => !known.has(u));
  assert.deepStrictEqual(unknown, [],
    `hna-controller.js calls activeBase.${unknown.join('/')}() — a LayerGroup may not have it; `
    + 'add it to asBasemap() in js/config/basemaps.js');
});

test('a labelled basemap is given the TileLayer methods a caller expects', () => {
  assert.ok(/function asBasemap\(base, reference\)/.test(SRC),
    'asBasemap() is gone; labelled basemaps are a bare LayerGroup again and '
    + 'bringToBack() will throw on every basemap swap');
  // Defined is not the same as used. Reverting labelled() to a bare
  // layerGroup() left asBasemap() sitting there unused, and this assertion
  // passed — the regression was caught incidentally by an unrelated check
  // comparing string offsets, which is not a guard, it is luck.
  const labelledAt = SRC.indexOf('function labelled(');
  const labelledBody = SRC.slice(labelledAt, SRC.indexOf('\n  }', labelledAt));
  assert.ok(/return asBasemap\(/.test(labelledBody),
    'labelled() no longer returns asBasemap(...) — it builds a bare LayerGroup, '
    + 'so bringToBack() throws on every basemap swap and tileerror never fires');
  assert.ok(!/return global\.L\.layerGroup\(/.test(labelledBody),
    'labelled() returns a raw L.layerGroup again');
  for (const method of ['bringToBack', 'bringToFront', 'setOpacity']) {
    assert.ok(new RegExp(`group\\.${method} = function`).test(SRC),
      `${method} is not provided, so a caller treating the basemap as a tile layer breaks`);
  }
});

test('labels stay above the base when sent to the back', () => {
  // bringToBack puts a layer behind everything, so the LAST one sent back ends
  // up furthest back. Labels first, then base. Reversed, the labels are buried
  // and the map looks unlabelled — which reads as a rendering bug, not an
  // ordering one.
  const at = SRC.indexOf('group.bringToBack = function');
  const body = SRC.slice(at, at + 220);
  const refAt = body.indexOf('reference.bringToBack');
  const baseAt = body.indexOf('base.bringToBack');
  assert.ok(refAt >= 0 && baseAt >= 0, 'bringToBack no longer moves both layers');
  assert.ok(refAt < baseAt,
    'the base is sent back after the labels, which buries the labels underneath it');
});

test('tile events reach the caller, so the provider fallback still exists', () => {
  assert.ok(/\['tileerror', 'tileload', 'load'\]/.test(SRC),
    'tile events are no longer re-emitted; once(\'tileerror\') can never fire and '
    + 'the fallback to OSM silently stops existing');
  assert.ok(/base\.on\(evt, function \(e\) \{ group\.fire\(evt, e\); \}\)/.test(SRC),
    'the events are not forwarded from the base layer to the group');
  // Only the base is watched: a missing label tile is not a reason to switch
  // providers.
  assert.ok(!/reference\.on\('tileerror'/.test(SRC),
    'the label overlay also triggers the provider fallback; a missing label tile '
    + 'should not switch the basemap');
});

test('a keyed CARTO basemap stays a single tile layer', () => {
  // With a key, CARTO bundles labels, so there is no group and nothing to
  // shim — the contract is native. This guards against wrapping it anyway.
  const at = SRC.indexOf('function labelled(');
  const body = SRC.slice(at, at + 400);
  assert.ok(/if \(cartoKey\(\)\) return carto\(/.test(body),
    'the keyed-CARTO path no longer returns a plain tile layer');
  // Explicit about both offsets: indexOf returns -1 when absent, and `-1 < n`
  // is true, so a missing asBasemap() made this assertion pass by accident in
  // one direction and fail confusingly in the other.
  const keyAt = body.indexOf('cartoKey()');
  const wrapAt = body.indexOf('asBasemap(');
  assert.ok(keyAt >= 0, 'labelled() no longer checks for a CARTO key');
  assert.ok(wrapAt >= 0, 'labelled() no longer wraps the Esri pair');
  assert.ok(keyAt < wrapAt, 'asBasemap() runs before the CARTO key is checked');
});

console.log(failures === 0
  ? '  basemap-honours-tilelayer-contract: PASS'
  : `  basemap-honours-tilelayer-contract: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
