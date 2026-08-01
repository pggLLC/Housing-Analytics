#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const MIB = 1024 * 1024;
const defaultLimit = 5 * MIB;

// Temporary, bounded exceptions. Geometry exceptions preserve every source
// feature; non-geometry exceptions predate Sprint 3A and are Batch 3 inputs.
const exceptions = new Map([
  ['data/market/natural_barriers_co.geojson', 11 * MIB],
  ['data/market/flood_zones_co.geojson', 7 * MIB],
  ['data/hna/source/dola_sya_county.csv', 21 * MIB],
  ['data/market/lodes_tract_od_co.json', 15 * MIB],
]);

const listed = spawnSync('git', ['ls-files', '-z', '--', 'data'], { encoding: 'utf8' });
if (listed.status !== 0) {
  process.stderr.write(listed.stderr);
  process.exit(listed.status || 1);
}

const failures = [];
for (const file of listed.stdout.split('\0').filter(Boolean)) {
  const bytes = fs.statSync(file).size;
  const limit = exceptions.get(file) || defaultLimit;
  if (bytes > limit) failures.push({ file, bytes, limit });
}

if (failures.length) {
  console.error('Tracked data files exceed their size ceilings:');
  for (const { file, bytes, limit } of failures) {
    console.error(`  ${file}: ${(bytes / MIB).toFixed(2)} MiB > ${(limit / MIB).toFixed(2)} MiB`);
  }
  process.exit(1);
}

console.log(`Data size guard passed: 5 MiB default ceiling; ${exceptions.size} bounded temporary exceptions.`);
