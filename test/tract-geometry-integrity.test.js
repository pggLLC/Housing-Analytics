#!/usr/bin/env node
/**
 * Tract geometry must still describe the tract TIGER describes.
 *
 * ── What went wrong ──
 *
 * market_data_build.yml simplified tract_boundaries_co.geojson whenever
 * `git diff` saw a change. On every run where TIGERweb failed, the builder fell
 * back to the committed file and rewrote it pretty-printed and bbox_fix.py
 * added bboxes, so the bytes changed and the geometry did not, and the step
 * ran another 20% Visvalingam pass over its own previous output. Weekly passes
 * took the file from 166,496 vertices (#1370's one intended pass) to 9,559.
 * Mean boundary displacement reached 10.8 km (08025969602 kept 1.8% of its
 * area); 475 tracts were off by more than 15%. #1925 was one more pass: it
 * dropped the vertex [-106.0381, 37.2252] shared by Conejos tracts 08021974800
 * and 08021974900 and cut 08021974800 to 56% of its land area. Every existing
 * check passed throughout, because none compared the geometry with anything.
 *
 * ── What this pins: agreement, not copy ──
 *
 * Each tract polygon in the committed tract geometry files must agree with two
 * references that no simplification step writes:
 *   1. its own TIGER AREALAND + AREAWATER, and
 *   2. the TIGER bbox in data/market/tract_centroids_co.json (bbox_source
 *      "tiger2020", built from the full-resolution boundaries on 2026-06-11).
 *
 * Area is compared as MEAN BOUNDARY DISPLACEMENT, |area - TIGER area| /
 * perimeter, in metres. A ratio alone cannot tell a 0.1 km² urban tract that
 * a 100 m display simplification moved by 20 m (ratio 0.5) from a 600 km²
 * rural tract that lost a vertex and moved by 2.9 km (ratio 0.56).
 *
 * Observed on the files this was written against (regenerated in one pass
 * from the full-resolution source, multipart tracts split first -- see
 * meta.simplification in the canonical file):
 *   tract_boundaries_co.geojson         max 39.4 m, bbox max 0.0023°
 *   pma_tract_display_geometry.geojson  max 47.2 m, bbox max 0.0023°
 * Failing inputs:
 *   #1925 (844ac1a26) 08021974800       2,897 m, bbox 0.0449°
 *   main before this fix                 475 tracts > 15% area error, max 10,774 m
 *   #1370's pass on the multipart source 381 m (08059060501 lost an 11 km² part)
 * Tolerances: displacement <= 150 m, bbox <= 0.01°. A 4 -> 3 decimal rounding
 * of every coordinate stays well inside both (sabotage case below).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CANONICAL = 'data/market/tract_boundaries_co.geojson';
const DISPLAY = 'data/market/pma_tract_display_geometry.geojson';
const CENTROIDS = 'data/market/tract_centroids_co.json';

const MAX_DISPLACEMENT_M = 150;
const MAX_BBOX_DEV_DEG = 0.01;
const R = 6378137;

let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures += 1; };
const ok = (m) => console.log(`  ✓ ${m}`);

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const polygonsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const rad = (d) => (d * Math.PI) / 180;

// Spherical signed ring area (m²), the d3/turf formulation. Summed with sign
// over every ring, so holes subtract whatever the winding convention.
function signedRingArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [lo1, la1] = ring[i];
    const [lo2, la2] = ring[i + 1];
    s += rad(lo2 - lo1) * (2 + Math.sin(rad(la1)) + Math.sin(rad(la2)));
  }
  return (s * R * R) / 2;
}
function areaM2(g) {
  let s = 0;
  for (const poly of polygonsOf(g)) for (const ring of poly) s += signedRingArea(ring);
  return Math.abs(s);
}
function perimeterM(g) {
  let t = 0;
  for (const poly of polygonsOf(g)) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i += 1) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[i + 1];
        const dx = rad(x2 - x1) * Math.cos(rad((y1 + y2) / 2)) * R;
        const dy = rad(y2 - y1) * R;
        t += Math.hypot(dx, dy);
      }
    }
  }
  return t;
}
function bboxOf(g) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of polygonsOf(g)) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < b[0]) b[0] = x;
        if (y < b[1]) b[1] = y;
        if (x > b[2]) b[2] = x;
        if (y > b[3]) b[3] = y;
      }
    }
  }
  return b;
}

// Returns { problems, checked, maxDisp, maxBbox } for one FeatureCollection.
// tigerArea / tigerBbox are keyed by GEOID and come from the references.
// Each problem is { geoid, severity, msg }; problems are sorted worst first.
function checkCollection(doc, tigerArea, tigerBbox) {
  const problems = [];
  let checked = 0;
  let maxDisp = { v: 0 };
  let maxBbox = { v: 0 };
  for (const f of doc.features || []) {
    const geoid = f.properties && f.properties.GEOID;
    const truth = tigerArea.get(geoid);
    const box = tigerBbox.get(geoid);
    if (!f.geometry || truth == null || !box) {
      problems.push({ geoid, severity: Infinity, msg: `${geoid}: no geometry or no TIGER reference to compare with` });
      continue;
    }
    checked += 1;
    const area = areaM2(f.geometry);
    const disp = Math.abs(area - truth) / perimeterM(f.geometry);
    const b = bboxOf(f.geometry);
    const dev = Math.max(...b.map((v, i) => Math.abs(v - box[i])));
    if (disp > maxDisp.v) maxDisp = { v: disp, geoid };
    if (dev > maxBbox.v) maxBbox = { v: dev, geoid };
    if (disp > MAX_DISPLACEMENT_M) {
      problems.push({
        geoid,
        severity: disp / MAX_DISPLACEMENT_M,
        msg: `${geoid}: boundary displaced ${disp.toFixed(0)} m on average `
          + `(area ${(area / 1e6).toFixed(2)} km² vs TIGER ${(truth / 1e6).toFixed(2)} km², ratio ${(area / truth).toFixed(3)})`,
      });
    }
    if (dev > MAX_BBOX_DEV_DEG) {
      problems.push({
        geoid,
        severity: dev / MAX_BBOX_DEV_DEG,
        msg: `${geoid}: bbox ${b.map((v) => v.toFixed(4)).join(',')} is ${dev.toFixed(4)}° from TIGER bbox ${box.join(',')}`,
      });
    }
  }
  problems.sort((x, y) => y.severity - x.severity);
  return { problems, checked, maxDisp, maxBbox };
}
const listProblems = (problems, n) => problems.slice(0, n).map((p) => p.msg).join('\n      - ')
  + (problems.length > n ? `\n      ... and ${problems.length - n} more` : '');

const canonical = readJson(CANONICAL);
const display = readJson(DISPLAY);
const centroids = readJson(CENTROIDS);

// References. AREALAND/AREAWATER are TIGER attributes carried unchanged through
// simplification; the display file does not carry them, so both files are
// checked against the canonical's attributes, joined by GEOID.
const tigerArea = new Map(canonical.features.map((f) => [
  f.properties.GEOID,
  Number(f.properties.AREALAND) + (Number(f.properties.AREAWATER) || 0),
]));
const tigerBbox = new Map((centroids.tracts || [])
  .filter((t) => t.bbox_source === 'tiger2020' && Array.isArray(t.bbox) && t.bbox.length === 4)
  .map((t) => [t.geoid, t.bbox]));

console.log('\ntract-geometry-integrity');

/* ── non-vacuity: the scan must have something to check ─────────────────── */
{
  const badAreas = [...tigerArea.values()].filter((v) => !(v > 0)).length;
  if (tigerArea.size < 1400 || badAreas) {
    fail(`TIGER area reference has ${tigerArea.size} tracts, ${badAreas} without a positive area`);
  } else if (tigerBbox.size < 1400) {
    fail(`only ${tigerBbox.size} TIGER bboxes in ${CENTROIDS} — the bbox check would pass vacuously`);
  } else {
    ok(`references: ${tigerArea.size} TIGER areas, ${tigerBbox.size} TIGER bboxes`);
  }
}

/* ── the committed files ─────────────────────────────────────────────────── */
const base = new Map();
for (const [rel, doc] of [[CANONICAL, canonical], [DISPLAY, display]]) {
  const r = checkCollection(doc, tigerArea, tigerBbox);
  base.set(rel, new Set(r.problems.map((p) => p.msg)));
  if (r.checked < 1400) fail(`${rel}: only ${r.checked} tracts checked`);
  if (r.problems.length) {
    fail(`${rel}: ${new Set(r.problems.map((p) => p.geoid)).size} tract(s) disagree with TIGER `
      + `(worst first):\n      - ${listProblems(r.problems, 15)}`);
  } else {
    ok(`${rel}: ${r.checked} tracts agree with TIGER `
      + `(max displacement ${r.maxDisp.v.toFixed(1)} m at ${r.maxDisp.geoid}; `
      + `max bbox deviation ${r.maxBbox.v.toFixed(4)}° at ${r.maxBbox.geoid})`);
  }
}

/* ── sabotage, both ways, each mutation proven to have applied ──────────── */
// Judged against the committed file's own result, so a sabotage case reports
// only what its mutation changed.
const clone = (x) => JSON.parse(JSON.stringify(x));
const key = (c) => `${c[0]},${c[1]}`;
const newProblems = (rel, r) => r.problems.filter((p) => !base.get(rel).has(p.msg));

// (a) The #1925 defect, applied to today's file: drop the interior vertices of
// the boundary 08021974800 shares with 08021974900, keeping the two junctions,
// in both tracts -- what a vertex-budget pass over a shared arc does.
{
  const mutated = clone(canonical);
  const byId = new Map(mutated.features.map((f) => [f.properties.GEOID, f]));
  const a = byId.get('08021974800');
  const b = byId.get('08021974900');
  const keysOf = (f) => new Set(polygonsOf(f.geometry).flat().flat().map(key));
  const shared = new Set([...keysOf(a)].filter((k) => keysOf(b).has(k)));
  let removed = 0;
  for (const f of [a, b]) {
    for (const poly of polygonsOf(f.geometry)) {
      for (let r = 0; r < poly.length; r += 1) {
        const body = poly[r].slice(0, -1);
        const n = body.length;
        const isShared = (i) => shared.has(key(body[(i + n) % n]));
        const kept = body.filter((c, i) => !isShared(i) || !isShared(i - 1) || !isShared(i + 1));
        removed += n - kept.length;
        poly[r] = [...kept, kept[0]];
      }
    }
  }
  const caught = newProblems(CANONICAL, checkCollection(mutated, tigerArea, tigerBbox))
    .find((p) => p.geoid === '08021974800');
  if (shared.size < 3 || removed === 0) {
    fail(`sabotage (a) did not apply: ${shared.size} shared vertices, ${removed} removed`);
  } else if (!caught) {
    fail(`sabotage (a): straightening the Conejos shared boundary (${removed} vertices removed) was NOT caught`);
  } else {
    ok(`sabotage (a): straightening the Conejos shared boundary (${removed} vertices removed) is caught — ${caught.msg}`);
  }
}

// (b) A harmless precision change must stay green: round every coordinate of
// both files to 3 decimals (~110 m), coarser than either file's precision.
for (const [rel, doc] of [[CANONICAL, canonical], [DISPLAY, display]]) {
  const mutated = clone(doc);
  let changed = 0;
  for (const f of mutated.features) {
    for (const poly of polygonsOf(f.geometry)) {
      for (const ring of poly) {
        for (const c of ring) {
          const x = Math.round(c[0] * 1e3) / 1e3;
          const y = Math.round(c[1] * 1e3) / 1e3;
          if (x !== c[0] || y !== c[1]) changed += 1;
          c[0] = x;
          c[1] = y;
        }
      }
    }
  }
  const r = checkCollection(mutated, tigerArea, tigerBbox);
  const added = newProblems(rel, r);
  if (changed < 1000) {
    fail(`sabotage (b) did not apply to ${rel}: only ${changed} coordinates changed`);
  } else if (added.length) {
    fail(`sabotage (b): rounding ${rel} to 3 decimals (${changed} coordinates) failed the guard — `
      + `the tolerance is too tight:\n      - ${listProblems(added, 5)}`);
  } else {
    ok(`sabotage (b): rounding ${rel} to 3 decimals (${changed} coordinates changed) adds no failure `
      + `(max displacement ${r.maxDisp.v.toFixed(1)} m)`);
  }
}

/* ── the workflow gate that prevents the compounding ───────────────────── */
// Agreement between the workflows and the simplifier: every simplify call in
// EVERY workflow must carry --if-geometry-changed, and the flag must turn a
// fallback run (committed geometry, rewritten bytes) into a no-op. The scan
// covers all workflows, not just market_data_build.yml: fetch-cdphe-boundaries
// and fetch-parcel-zoning-data ran the same unflagged byte-diff -> simplify
// pattern until the audit after #1990; only upstream failures had kept them
// from compounding.
{
  const WF_DIR = '.github/workflows';
  const MARKET = `${WF_DIR}/market_data_build.yml`;
  const calls = [];
  for (const name of fs.readdirSync(path.join(ROOT, WF_DIR)).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const rel = `${WF_DIR}/${name}`;
    fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n')
      .filter((l) => /node scripts\/simplify-geojson\.mjs/.test(l) && !l.trim().startsWith('#'))
      .forEach((l) => calls.push({ rel, line: l.trim() }));
  }
  const tractCall = calls.find((c) => c.rel === MARKET && c.line.includes(CANONICAL));
  const ungated = calls.filter((c) => !c.line.includes('--if-geometry-changed'));
  const files = new Set(calls.map((c) => c.rel));
  if (!tractCall) {
    fail(`${MARKET} no longer simplifies ${CANONICAL} — update this guard to follow the producer`);
  } else if (files.size < 3) {
    fail(`found simplify calls in only ${files.size} workflow(s) (${[...files].join(', ')}); `
      + 'the scan has stopped seeing the producers it exists to check');
  } else if (ungated.length) {
    fail('simplify call(s) without --if-geometry-changed would re-simplify a fallback copy:\n      - '
      + ungated.map((c) => `${c.rel}: ${c.line}`).join('\n      - '));
  } else {
    ok(`all ${calls.length} simplify calls across ${files.size} workflows carry --if-geometry-changed`);
  }
}

{
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  const abs = path.join(ROOT, CANONICAL);
  const head = spawnSync('git', ['show', `HEAD:${CANONICAL}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 30 });
  const working = fs.readFileSync(abs, 'utf8');
  // What a fallback run hands the simplifier: the committed geometry,
  // pretty-printed by the builder, with a bbox on every feature from bbox_fix.
  const fallback = clone(canonical);
  for (const f of fallback.features) f.bbox = bboxOf(f.geometry);
  const fallbackText = JSON.stringify(fallback, null, 2);
  const args = ['scripts/simplify-geojson.mjs', '--keep', '20', '--fields', 'GEOID,AREALAND,AREAWATER'];
  const vertices = (doc) => doc.features.reduce((n, f) => n + polygonsOf(f.geometry).flat(2).length, 0);

  if (head.status !== 0 || head.stdout !== working) {
    // Only on an uncommitted local edit of the file: never overwrite someone's
    // work. A CI checkout is always clean, so there a skip would be vacuous.
    const msg = `the fallback replay needs ${CANONICAL} to match HEAD, and it does not in this checkout`;
    if (process.env.CI) fail(msg);
    else console.log(`  - skipped: ${msg} (commit it and rerun)`);
  } else {
    try {
      fs.writeFileSync(abs, fallbackText);
      if (fs.readFileSync(abs, 'utf8') === working) throw new Error('fallback rewrite did not change the bytes');
      const run = spawnSync(process.execPath, [...args, '--input', CANONICAL, '--if-geometry-changed'], { cwd: ROOT, encoding: 'utf8' });
      const after = fs.readFileSync(abs, 'utf8');
      if (run.status !== 0) fail(`--if-geometry-changed replay exited ${run.status}: ${run.stderr}`);
      else if (after !== working) fail('--if-geometry-changed simplified a fallback copy instead of restoring the committed bytes');
      else ok('fallback replay: rewritten bytes + bboxes, same geometry -> committed bytes restored, no pass run');
    } finally {
      fs.writeFileSync(abs, working);
    }
    // Same geometry but a real data update (#1990 review): the pass is still
    // skipped, and the update is kept -- never replaced by the committed copy.
    try {
      const updated = clone(fallback);
      const target = updated.features[0];
      const before = target.properties.AREALAND;
      target.properties.AREALAND = Number(before) + 1;
      fs.writeFileSync(abs, JSON.stringify(updated, null, 2));
      const run = spawnSync(process.execPath, [...args, '--input', CANONICAL, '--if-geometry-changed'], { cwd: ROOT, encoding: 'utf8' });
      const out = run.status === 0 ? JSON.parse(fs.readFileSync(abs, 'utf8')) : null;
      if (!out) fail(`--if-geometry-changed with a property update exited ${run.status}: ${run.stderr}`);
      else if (out.features[0].properties.AREALAND !== Number(before) + 1) fail('--if-geometry-changed discarded a property update on unchanged geometry');
      else if (vertices(out) !== vertices(canonical)) fail(`--if-geometry-changed ran a simplify pass on unchanged geometry (${vertices(canonical)} -> ${vertices(out)} vertices)`);
      else if (JSON.stringify(out.features[0].geometry) !== JSON.stringify(canonical.features[0].geometry)) fail('--if-geometry-changed altered unchanged geometry');
      else ok('property update on unchanged geometry: update kept, no simplify pass, geometry untouched');
    } finally {
      fs.writeFileSync(abs, working);
    }
    // The other way: without the flag, the same input loses vertices -- the
    // defect the flag exists to stop. Run outside the repo so nothing tracked
    // is touched.
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tract-geom-')), 'fallback.geojson');
    try {
      fs.writeFileSync(tmp, fallbackText);
      const run = spawnSync(process.execPath, [...args, '--input', tmp], { cwd: ROOT, encoding: 'utf8' });
      const before = vertices(canonical);
      const afterV = run.status === 0 ? vertices(JSON.parse(fs.readFileSync(tmp, 'utf8'))) : NaN;
      if (!(afterV < before)) fail(`ungated replay did not simplify (status ${run.status}, ${before} -> ${afterV} vertices): the no-op above proves nothing`);
      else ok(`ungated replay (the old gate): ${before} -> ${afterV} vertices, the compounding the flag prevents`);
    } finally {
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
  }
}

console.log(failures === 0
  ? '  tract-geometry-integrity: PASS'
  : `  tract-geometry-integrity: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
