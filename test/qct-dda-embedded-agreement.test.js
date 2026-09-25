'use strict';

/**
 * An embedded QCT, DDA or county boundary must be the published record.
 *
 * js/co-lihtc-map.js used to carry FALLBACK_QCT, FALLBACK_DDA and
 * FALLBACK_COUNTY and draw them whenever the data files failed to load:
 *   - 14 "QCTs" as axis-aligned rectangles. None of the 14 GEOIDs is on HUD's
 *     2026 list (data/qct-colorado.json, 224 tracts).
 *   - 10 "DDAs", five of them whole metro FMR areas (Denver, Boulder, Fort
 *     Collins, Colorado Springs, Greeley) that are not 2026 DDAs; five real
 *     ones (Crowley, Garfield, La Plata, Mineral, Ouray) were missing.
 *   - 15 of 64 counties as overlapping bounding boxes.
 * QCT and DDA decide the 30% basis boost, so a made-up boundary tells a
 * developer a site qualifies when it may not. They were removed; on failure
 * the map now marks the layer unavailable.
 *
 * js/hna/hna-utils.js had the same defect as QCT_FALLBACK_CO (27 rectangles,
 * 0 of the GEOIDs on HUD's 2026 list) and DDA_FALLBACK_CO (12 boxes). Also
 * removed; the HNA now reports status unknown instead
 * (test/hna-qct-dda-unavailable.test.js).
 *
 * The guard pins the agreement, not the removal: any embedded collection whose
 * name says QCT, DDA or COUNTY, in any client script, may contain only
 * features that exist in the corresponding data file WITH THE SAME GEOMETRY.
 * Re-embedding a real HUD tract verbatim passes; a rectangle with a real
 * GEOID fails, and so does a real name with a made-up shape.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readJson = (f) => JSON.parse(read(f));

// ── Reference data: what each kind of embedded feature must agree with ──────
const REFERENCE = {
  qct: { file: 'data/qct-colorado.json', keys: ['GEOID'] },
  dda: { file: 'data/dda-colorado.json', keys: ['DDA_CODE', 'GEOID', 'DDA_NAME'] },
  county: { file: 'data/co-county-boundaries.json', keys: ['GEOID', 'NAME'] },
};
for (const [kind, ref] of Object.entries(REFERENCE)) {
  const gj = readJson(ref.file);
  assert(Array.isArray(gj.features) && gj.features.length > 0, `${ref.file} has no features`);
  ref.byKey = new Map();
  for (const f of gj.features) {
    for (const k of ref.keys) {
      const v = f.properties && f.properties[k];
      if (v != null && v !== '') ref.byKey.set(`${k}=${v}`, f);
    }
  }
  assert(ref.byKey.size > 0, `${kind}: no keys indexed from ${ref.file}`);
}
assert.strictEqual(readJson(REFERENCE.county.file).features.length, 64, 'county reference must carry all 64 counties');

// ── Collections not yet brought into agreement ───────────────────────────────
// Each entry is a known disagreement being fixed separately. The guard asserts
// it STILL disagrees, so a fixed entry must be removed from this list.
const PENDING = {};

// ── Extraction ───────────────────────────────────────────────────────────────
const DECL = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?=\{\s*type\s*:\s*['"]FeatureCollection['"])/g;

function kindOf(name) {
  if (/QCT/i.test(name)) return 'qct';
  if (/DDA/i.test(name)) return 'dda';
  if (/COUNT(Y|IES)/i.test(name)) return 'county';
  return null;
}

// Return the balanced {...} literal starting at `start`, skipping strings.
function literalAt(src, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unbalanced literal at ' + start);
}

function embeddedCollections(src) {
  const out = [];
  DECL.lastIndex = 0;
  let m;
  while ((m = DECL.exec(src))) {
    const kind = kindOf(m[1]);
    if (!kind) continue;
    const literal = literalAt(src, DECL.lastIndex);
    out.push({ name: m[1], kind, collection: vm.runInNewContext('(' + literal + ')') });
  }
  return out;
}

// Every feature must be found in the reference by one of its keys and carry
// the reference geometry exactly.
function disagreements(kind, collection) {
  const ref = REFERENCE[kind];
  const bad = [];
  (collection.features || []).forEach((f, i) => {
    const p = f.properties || {};
    const hit = ref.keys
      .filter((k) => p[k] != null && p[k] !== '')
      .map((k) => ref.byKey.get(`${k}=${p[k]}`))
      .find(Boolean);
    const label = p.GEOID || p.DDA_CODE || p.DDA_NAME || p.NAME || `#${i}`;
    if (!hit) bad.push(`${label}: not in ${ref.file}`);
    else if (JSON.stringify(f.geometry) !== JSON.stringify(hit.geometry)) {
      bad.push(`${label}: geometry differs from ${ref.file}`);
    }
  });
  return bad;
}

// ── Self-test: the extractor and the comparison work both ways ───────────────
{
  const realQct = readJson(REFERENCE.qct.file).features[0];
  const rect = { type: 'Polygon', coordinates: [[[-105, 39], [-104.9, 39], [-104.9, 39.1], [-105, 39.1], [-105, 39]]] };
  const src = [
    `var FAKE_QCT = {type:'FeatureCollection',features:[{type:'Feature',properties:{GEOID:'08031007400'},geometry:${JSON.stringify(rect)}}]};`,
    `const REAL_QCT = {type:'FeatureCollection',features:[${JSON.stringify(realQct)}]};`,
    `var RECT_REAL_ID_QCT = {type:'FeatureCollection',features:[{type:'Feature',properties:{GEOID:'${realQct.properties.GEOID}'},geometry:${JSON.stringify(rect)}}]};`,
    `var SOMETHING_ELSE = {type:'FeatureCollection',features:[]};`,
  ].join('\n');
  const found = embeddedCollections(src);
  assert.deepStrictEqual(found.map((c) => c.name), ['FAKE_QCT', 'REAL_QCT', 'RECT_REAL_ID_QCT'], 'extractor self-test');
  assert.strictEqual(disagreements('qct', found[0].collection).length, 1, 'self-test: an invented GEOID must fail');
  assert.strictEqual(disagreements('qct', found[1].collection).length, 0, 'self-test: a verbatim HUD tract must pass');
  assert.match(disagreements('qct', found[2].collection)[0] || '', /geometry differs/, 'self-test: a rectangle under a real GEOID must fail');
}

// ── Scan every client script ─────────────────────────────────────────────────
const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.(js|mjs|html)$/.test(f))
  .filter((f) => !/^(test|tests|scripts|node_modules|docs|places)\//.test(f))
  .filter((f) => !/^js\/vendor\//.test(f));

assert(tracked.length > 200, `scan found only ${tracked.length} client files`);
['js/co-lihtc-map.js', 'colorado-deep-dive.html', 'js/hna/hna-utils.js'].forEach((f) =>
  assert(tracked.includes(f), `scan must include ${f}`));

const failures = [];
const seenPending = new Set();
let checked = 0;
for (const f of tracked) {
  for (const c of embeddedCollections(read(f))) {
    const id = `${f}#${c.name}`;
    const bad = disagreements(c.kind, c.collection);
    checked++;
    if (PENDING[id]) {
      seenPending.add(id);
      assert(bad.length > 0, `${id} now agrees with ${REFERENCE[c.kind].file} — remove it from PENDING`);
      continue;
    }
    if (bad.length) failures.push(`${id} (${c.kind}):\n    ` + bad.join('\n    '));
  }
}

for (const id of Object.keys(PENDING)) {
  assert(seenPending.has(id), `PENDING lists ${id}, which no longer exists — remove the entry`);
}
assert.deepStrictEqual(failures, [],
  'Embedded boundaries that are not the published record:\n  ' + failures.join('\n  '));

// ── The map shows "unavailable" rather than inventing a replacement ──────────
const map = read('js/co-lihtc-map.js');
['qct', 'dda', 'county'].forEach((kind) =>
  assert(new RegExp(`markOverlayUnavailable\\('${kind}'`).test(map),
    `co-lihtc-map.js must mark the ${kind} layer unavailable when its data fails to load`));

console.log(`qct-dda-embedded-agreement: ${checked} embedded collection(s) checked across ${tracked.length} files; ` +
  `${Object.keys(PENDING).length} pending; 0 disagreements outside PENDING`);
