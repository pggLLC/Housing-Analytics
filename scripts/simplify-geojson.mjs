#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error('Usage: node scripts/simplify-geojson.mjs --input <file> --keep <percent> --fields <a,b,c>');
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
    feature.properties = Object.fromEntries(
      Object.entries(feature.properties || {}).filter(([field]) => fields.includes(field)),
    );
    const extra = Object.keys(feature.properties || {}).filter((field) => !fields.includes(field));
    if (extra.length) throw new Error(`field-pruning guard failed: ${extra.join(', ')}`);
  }

  const finalDocument = { ...simplified };
  for (const [key, data] of Object.entries(original)) {
    if (key !== 'features' && key !== 'type' && key !== 'bbox') finalDocument[key] = data;
  }
  finalDocument.features = simplified.features;
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
    bytesBefore: originalBytes,
    bytesAfter: finalBytes,
  }, null, 2));
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
