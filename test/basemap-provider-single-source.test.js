#!/usr/bin/env node
/**
 * Map tiles come from one place, and that place is not anonymous CARTO.
 *
 * As of 2026-09 CARTO's keyless basemap tiles return HTTP 200 with a valid
 * 256×256 PNG that has "API KEY REQUIRED · carto.com/basemaps/apikey" painted
 * diagonally across it. Nothing throws, nothing 4xxs, no Sunset header — the
 * map simply renders defaced. A status-code check says the tiles are fine; only
 * the pixels disagree.
 *
 * Seven tile URLs across six files pointed at CARTO, plus a Folium generator
 * using "CartoDB positron". This asserts they all now route through
 * js/config/basemaps.js, and that every page which loads a map module also
 * loads it — a missing script tag means `window.COHOBasemaps` is undefined and
 * the map has no basemap at all.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = 'js/config/basemaps.js';

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
const test = (name, fn) => {
  try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); }
};

console.log('basemap-provider-single-source');

function walk(dir, pred, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, pred, out);
    else if (pred(entry.name)) out.push(full);
  }
  return out;
}

const CARTO = /basemaps\.cartocdn\.com|CartoDB positron|cartodbpositron/;

/**
 * Strip comments before scanning.
 *
 * The first version scanned raw source and fired on the comment in
 * build_co_housing_costs_insight.py that explains why it is NOT using the
 * CARTO tile set any more. A guard that fails on an accurate comment about the
 * fix is a guard someone will delete — and "a mention is not a usage" is the
 * same distinction the rest of this file is about.
 */
const PY_DOCSTRING = new RegExp('"{3}[\\s\\S]*?"{3}|\'{3}[\\s\\S]*?\'{3}', 'g');
function codeOnly(src, ext) {
  const dropLineComments = (text, marker) => text
    .split('\n')
    .map((l) => (l.trimStart().startsWith(marker) ? '' : l))
    .join('\n');
  if (ext === '.py') return dropLineComments(src, '#').replace(PY_DOCSTRING, '');
  return dropLineComments(src.replace(/\/\*[\s\S]*?\*\//g, ''), '//');
}

test('the shared basemap config exists and is the only file naming CARTO', () => {
  assert.ok(fs.existsSync(path.join(ROOT, CONFIG)), `${CONFIG} is missing`);
  const offenders = walk(path.join(ROOT, 'js'), (n) => n.endsWith('.js'))
    .map((f) => path.relative(ROOT, f))
    .filter((rel) => rel !== CONFIG)
    .filter((rel) => CARTO.test(codeOnly(fs.readFileSync(path.join(ROOT, rel), 'utf8'), '.js')));
  assert.deepStrictEqual(offenders, [],
    `these reach CARTO directly instead of going through ${CONFIG}: ${offenders.join(', ')}. `
    + 'Anonymous CARTO tiles render with an "API KEY REQUIRED" watermark.');
});

test('no build script hardcodes a CARTO basemap either', () => {
  // scripts/build_co_housing_costs_insight.py used tiles="CartoDB positron",
  // which produces eight standalone maps embedded in the costs article.
  const offenders = walk(path.join(ROOT, 'scripts'), (n) => /\.(py|mjs|js)$/.test(n))
    .map((f) => path.relative(ROOT, f))
    .filter((rel) => CARTO.test(codeOnly(fs.readFileSync(path.join(ROOT, rel), 'utf8'), path.extname(rel))));
  assert.deepStrictEqual(offenders, [],
    `these generate maps on anonymous CARTO tiles: ${offenders.join(', ')}`);
});

test('the search would actually notice — it matches a planted URL', () => {
  // Without this the two assertions above pass by having a broken pattern.
  const planted = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  assert.ok(CARTO.test(planted), 'the CARTO pattern no longer matches a CARTO URL');
  assert.ok(CARTO.test('tiles="CartoDB positron"'), 'the pattern misses the Folium spelling');
  assert.ok(!CARTO.test('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'),
    'the pattern matches the replacement provider, which would make it useless');
  // And the stripper must not strip CODE: planted usages still show.
  assert.ok(CARTO.test(codeOnly('m = folium.Map(tiles="CartoDB positron")', '.py')),
    'codeOnly() removed a real usage, not just a comment');
  assert.ok(CARTO.test(codeOnly("L.tileLayer('" + planted + "')", '.js')),
    'codeOnly() removed a real tile URL');
  assert.ok(!CARTO.test(codeOnly('# no longer on the CartoDB positron tile set', '.py')),
    'codeOnly() left a comment in place');
});

/* ── every map page must load the config ─────────────────────────────────── */

const MAP_MODULES = [
  'js/lihtc-opportunity-finder.js',
  'js/market-analysis.js',
  'js/co-lihtc-map.js',
  'js/data-explorer.js',
  'js/colorado-deep-dive.js',
  'js/hna/hna-controller.js',
];

const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));

test('every page loading a map module also loads the basemap config', () => {
  const missing = [];
  for (const page of pages) {
    const src = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const usesMap = MAP_MODULES.some((m) => src.includes(`src="${m}"`));
    if (usesMap && !src.includes(CONFIG)) missing.push(page);
  }
  assert.deepStrictEqual(missing, [],
    `these load a map module without ${CONFIG}, so window.COHOBasemaps is `
    + `undefined and the map draws no basemap: ${missing.join(', ')}`);
});

test('the page scan finds map pages at all', () => {
  const found = pages.filter((p) => {
    const src = fs.readFileSync(path.join(ROOT, p), 'utf8');
    return MAP_MODULES.some((m) => src.includes(`src="${m}"`));
  });
  assert.ok(found.length >= 8,
    `only ${found.length} map pages found; the module list or the src spelling has drifted`);
});

test('the config loads BEFORE the map module that reads it', () => {
  for (const page of pages) {
    const src = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const firstModule = MAP_MODULES
      .map((m) => src.indexOf(`src="${m}"`))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0];
    if (firstModule === undefined) continue;
    const cfg = src.indexOf(CONFIG);
    assert.ok(cfg >= 0 && cfg < firstModule,
      `${page}: ${CONFIG} is loaded after the map module`);
  }
});

/* ── the module itself ───────────────────────────────────────────────────── */

const cfgSrc = fs.readFileSync(path.join(ROOT, CONFIG), 'utf8');

test('labelled basemaps pair a base with a label overlay', () => {
  // Esri splits place names into a transparent Reference layer. Dropping it
  // leaves a basemap with no town names on it — legible, and useless for a
  // planner trying to find their jurisdiction.
  assert.ok(/World_Dark_Gray_Reference|prefix \+ 'Reference'/.test(cfgSrc),
    'the label overlay is gone from the labelled basemaps');
});

test('zoom past Esri\'s native limit upsamples rather than going blank', () => {
  // Esri Canvas has no tiles above z16 and serves a grey "Map data not yet
  // available" tile instead. maxNativeZoom keeps Leaflet stretching z16.
  assert.ok(/maxNativeZoom/.test(cfgSrc),
    'maxNativeZoom is gone — zooming past 16 will show Esri\'s grey '
    + '"Map data not yet available" tiles, which read as a broken map');
  assert.ok(/NATIVE_MAX\s*=\s*16/.test(cfgSrc), 'the native zoom ceiling is no longer 16');
});

test('a CARTO key, if ever set, is the only way back to CARTO', () => {
  assert.ok(/COHO_CARTO_API_KEY/.test(cfgSrc),
    'the keyed-CARTO path is gone; there is now no way to restore CARTO short '
    + 'of editing every call site again');
  assert.ok(/api_key=/.test(cfgSrc), 'the key is never appended to the tile URL');
});

console.log(failures === 0
  ? '  basemap-provider-single-source: PASS'
  : `  basemap-provider-single-source: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
