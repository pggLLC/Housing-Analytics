#!/usr/bin/env node
/**
 * map-container-resize — every Leaflet map must re-measure after init.
 *
 * Leaflet computes its tile grid from the container's size at `L.map()` time.
 * A container that is 0x0 at that moment -- inside a `display:none` tab panel,
 * a collapsed accordion, a `<details>` -- yields a grid sized for nothing, and
 * the map comes up with fewer tiles than it needs. The missing tiles do NOT
 * error: they are never requested. That is why this failure mode reads as a
 * broken basemap and sends people to check the CDN, which is always fine.
 *
 * PREVENTIVE. No page in this repo is currently affected -- #1661 reported one
 * and was closed as a false positive after measuring actual coverage (sample a
 * grid of points, ask whether each is under a loaded tile) rather than counting
 * tiles against a worst-case formula. But maps DO already live inside collapsed
 * containers here; only their current dimensions keep that benign.
 *
 * The remedy is `map.invalidateSize()` once the container has a size. This
 * asserts the pairing exists; it deliberately does not mandate HOW, so a
 * ResizeObserver, a tab hook or an explicit call all satisfy it.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Files that construct a Leaflet map. Discovered rather than hardcoded so a new
// map file cannot join the repo without being covered.
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const INIT = /(?:^|[^.\w])L\s*\.\s*map\s*\(|window\.L\s*\.\s*map\s*\(/;
const REMEASURE = /invalidateSize|ResizeObserver/;

let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };

console.log('\nmap-container-resize');

const files = walk(path.join(ROOT, 'js'), []);
const mapFiles = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  // Strip comments so an explanatory mention of L.map() doesn't count as an init.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (INIT.test(code)) mapFiles.push({ rel: path.relative(ROOT, f), code });
}

if (mapFiles.length < 3) {
  fail(`only found ${mapFiles.length} files constructing a Leaflet map — the `
     + `detection regex has probably drifted; this guard would pass vacuously`);
}

for (const { rel, code } of mapFiles) {
  if (!REMEASURE.test(code)) {
    fail(`${rel} constructs a Leaflet map but never calls invalidateSize() nor `
       + `observes its container for resize. If that map is ever placed inside a `
       + `hidden or collapsed element it will render a short tile grid, and the `
       + `missing tiles will not error — they will simply never be requested.`);
  }
}

if (failures) {
  console.error(`\nmap-container-resize: FAIL (${failures})`);
  process.exit(1);
}
console.log(`  ✓ all ${mapFiles.length} Leaflet map files re-measure after init`);
console.log('map-container-resize: PASS');
