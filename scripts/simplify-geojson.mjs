#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error('Usage: node scripts/simplify-geojson.mjs --input <file> --keep <percent> --fields <a,b,c> [--no-repair] [--drop-empty] [--if-geometry-changed]');
  process.exit(2);
}

const args = process.argv.slice(2);
function value(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1];
}

const inputArg = value('--input');
const keep = Number(value('--keep'));
const fields = String(value('--fields') || '').split(',').map((field) => field.trim()).filter(Boolean);
const noRepair = args.includes('--no-repair');
const dropEmpty = args.includes('--drop-empty');
const ifGeometryChanged = args.includes('--if-geometry-changed');
if (!inputArg) usage('--input is required');
if (!Number.isFinite(keep) || keep <= 0 || keep > 100) usage('--keep must be greater than 0 and at most 100');
if (!fields.length) usage('--fields must contain at least one property name');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.resolve(root, inputArg);
const mapshaper = path.join(root, 'node_modules', '.bin', 'mapshaper');
if (!fs.existsSync(input)) usage(`input not found: ${inputArg}`);
if (!fs.existsSync(mapshaper)) usage('mapshaper is not installed; run npm install');

const originalText = fs.readFileSync(input, 'utf8');
const original = JSON.parse(originalText);
if (original.type !== 'FeatureCollection' || !Array.isArray(original.features)) {
  usage('input must be a GeoJSON FeatureCollection');
}
const originalCount = original.features.length;
const originalBytes = Buffer.byteLength(originalText);

// Keep a feature's allowed properties only (the same pruning a simplify pass
// applies), so a skipped pass and a real one write the same shape of file.
function pruneProperties(properties) {
  return Object.fromEntries(
    Object.entries(properties || {}).filter(([field, fieldValue]) => (
      fields.includes(field) && (!dropEmpty || fieldValue !== '')
    )),
  );
}
// Top-level members other than the collection itself carry over as they are.
function withTopLevel(features) {
  const document = { type: 'FeatureCollection', features };
  for (const [key, data] of Object.entries(original)) {
    if (key !== 'features' && key !== 'type' && key !== 'bbox') document[key] = data;
  }
  return document;
}
// Structural equality that ignores key order.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// --if-geometry-changed: simplify only when the geometry differs from the
// committed copy. When it does not, skip the lossy pass but keep everything
// else the producer wrote (properties, metadata): only the geometry pass is
// withheld, never a data update (#1990 review).
//
// Simplification is lossy and not idempotent: every pass removes a share of
// whatever vertices are left. The market-data workflow gated this call on
// `git diff --quiet`, but when an upstream fetch fails the builder falls back
// to the committed (already simplified) file and rewrites it pretty-printed,
// and bbox_fix.py then adds a bbox to every feature. The bytes differ, the
// geometry does not, and the gate ran a second 20% pass over the previous
// output. Weekly, that took tract_boundaries_co.geojson from 166,496 vertices
// (#1370's one intended pass) to 9,559 and moved tract boundaries by up to
// 10 km -- the #1925 drop of the vertex shared by Conejos tracts 08021974800
// and 08021974900 was just the latest pass. Comparing geometry, not bytes,
// makes the step a no-op on a fallback run.
if (ifGeometryChanged) {
  const rel = path.relative(root, input);
  const head = spawnSync('git', ['show', `HEAD:${rel}`], {
    cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (head.status === 0) {
    const committed = JSON.parse(head.stdout);
    const sameGeometry = Array.isArray(committed.features)
      && committed.features.length === originalCount
      && committed.features.every((feature, index) => (
        JSON.stringify(feature.geometry) === JSON.stringify(original.features[index].geometry)
      ));
    if (sameGeometry) {
      const unsimplified = withTopLevel(original.features.map((feature) => ({
        type: 'Feature',
        geometry: feature.geometry,
        properties: pruneProperties(feature.properties),
      })));
      const text = `${JSON.stringify(unsimplified)}\n`;
      // Nothing but formatting or per-feature bboxes changed: keep the
      // committed bytes exactly, so a fallback run commits no churn.
      const unchanged = canonical(unsimplified) === canonical(committed);
      fs.writeFileSync(input, unchanged ? head.stdout : text);
      console.log(JSON.stringify({
        file: rel,
        skipped: true,
        reason: unchanged
          ? 'geometry and data identical to HEAD; committed bytes restored'
          : 'geometry identical to HEAD, so no simplification pass; updated properties/metadata kept',
      }, null, 2));
      process.exit(0);
    }
  }
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coho-mapshaper-'));
try {
  const geometryGroup = (feature) => {
    const type = feature.geometry?.type || 'unknown';
    if (type.includes('Polygon')) return 'polygon';
    if (type.includes('LineString')) return 'line';
    if (type.includes('Point')) return 'point';
    return type;
  };
  const groups = new Map();
  original.features.forEach((feature, index) => {
    const group = geometryGroup(feature);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({
      ...feature,
      properties: { ...(feature.properties || {}), __coho_index: index },
    });
  });

  const simplifiedFeatures = new Array(originalCount);
  for (const [group, featuresForGroup] of groups) {
    const groupInput = path.join(tempDir, `${group}-input.geojson`);
    const groupOutput = path.join(tempDir, `${group}-output.geojson`);
    fs.writeFileSync(groupInput, JSON.stringify({ type: 'FeatureCollection', features: featuresForGroup }));
    const simplifyArgs = [groupInput, '-simplify', 'visvalingam', `${keep}%`, 'keep-shapes'];
    if (noRepair) simplifyArgs.push('no-repair');
    simplifyArgs.push('-o', 'format=geojson', groupOutput);
    const result = spawnSync(mapshaper, simplifyArgs, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.status !== 0) {
      console.error(result.stdout);
      console.error(result.stderr);
      process.exit(result.status || 1);
    }
    const groupDocument = JSON.parse(fs.readFileSync(groupOutput, 'utf8'));
    for (const feature of groupDocument.features || []) {
      const index = feature.properties?.__coho_index;
      if (!Number.isInteger(index) || index < 0 || index >= originalCount) {
        throw new Error(`feature identity guard failed for ${group}`);
      }
      delete feature.properties.__coho_index;
      simplifiedFeatures[index] = feature;
    }
  }

  const simplified = { type: 'FeatureCollection', features: simplifiedFeatures };
  if (!Array.isArray(simplified.features) || simplified.features.length !== originalCount) {
    throw new Error(`feature-count guard failed: ${originalCount} -> ${simplified.features?.length ?? 'invalid'}`);
  }
  let restoredDegenerateGeometries = 0;
  for (let index = 0; index < simplified.features.length; index += 1) {
    const feature = simplified.features[index];
    if (!feature || feature.type !== 'Feature') {
      throw new Error('feature guard failed after simplification');
    }
    // Mapshaper represents already-degenerate one-point/zero-length lines as
    // null. They did not render before, but retain their original coordinates
    // so simplification never removes geometry from any source feature.
    if (!feature.geometry) {
      feature.geometry = original.features[index].geometry;
      restoredDegenerateGeometries += 1;
    }
    feature.properties = pruneProperties(feature.properties);
    const extra = Object.keys(feature.properties || {}).filter((field) => !fields.includes(field));
    if (extra.length) throw new Error(`field-pruning guard failed: ${extra.join(', ')}`);
  }

  const finalDocument = withTopLevel(simplified.features);
  const finalText = `${JSON.stringify(finalDocument)}\n`;
  fs.writeFileSync(input, finalText);
  const finalBytes = Buffer.byteLength(finalText);
  console.log(JSON.stringify({
    file: path.relative(root, input),
    method: 'visvalingam',
    keepPercent: keep,
    keepShapes: true,
    repairIntersections: !noRepair,
    featuresBefore: originalCount,
    featuresAfter: simplified.features.length,
    restoredDegenerateGeometries,
    fields,
    dropEmpty,
    bytesBefore: originalBytes,
    bytesAfter: finalBytes,
  }, null, 2));
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
