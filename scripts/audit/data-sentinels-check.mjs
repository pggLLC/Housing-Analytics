#!/usr/bin/env node
/**
 * data-sentinels-check.mjs — verify critical data artifacts haven't
 * regressed in row count. Partial closeout of issue #657 (row-count
 * sentinels) from epic #447.
 *
 * Companion to data-freshness-check.mjs:
 *   - freshness-check: are files RECENT enough?
 *   - sentinels-check: do files have ENOUGH ROWS?
 *
 * Both questions matter: a fresh file with 50 of an expected 500 entries
 * is just as broken as a 90-day-stale one. The two checks together give
 * us "is the pipeline healthy" coverage that neither catches alone.
 *
 * For each configured artifact the script:
 *   1. Loads the file (JSON parse, GeoJSON parse, or filesystem listing
 *      for directory-style artifacts like data/hna/summary/).
 *   2. Counts entries via an extractor function (config-driven).
 *   3. Fails non-zero if the count is below the configured minimum.
 *
 * Thresholds are deliberately set COMFORTABLY below the current row
 * count — the sentinel catches sudden cratering, not normal drift. As
 * of 2026-04-21 every artifact is well above its floor:
 *   - ranking-index: 547 entries, floor 540
 *   - HNA summary dir: 548 files, floor 540
 *   - HUD LIHTC: 1000+ features, floor 500
 *   - ACS tract metrics: 1400+ tracts, floor 1300
 *   - CO county demographics: 64 counties, floor 64 (all CO counties)
 *
 * Exit codes:
 *   0  — every sentinel passed
 *   1  — at least one sentinel regressed below floor
 *   2  — internal script error (e.g. a configured file is missing)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..', '..');

/**
 * Sentinel configuration. Each entry describes one artifact and how to
 * count its rows. The `expect` counter receives the parsed JSON (or the
 * list of filenames for directory artifacts) and returns an integer.
 */
const SENTINELS = [
  {
    kind:    'file',
    path:    'data/hna/ranking-index.json',
    minRows: 540,
    label:   'HNA ranking entries',
    count:   (json) => (json && Array.isArray(json.rankings)) ? json.rankings.length : 0,
  },
  {
    kind:    'directory',
    path:    'data/hna/summary',
    minRows: 540,
    label:   'HNA per-geography summary files',
    filter:  (name) => name.endsWith('.json') && /^0?8[0-9]{3,}\.json$/.test(name),
    count:   (names) => names.length,
  },
  {
    kind:    'file',
    path:    'data/market/hud_lihtc_co.geojson',
    minRows: 500,
    label:   'HUD LIHTC project features',
    count:   (gj) => (gj && Array.isArray(gj.features)) ? gj.features.length : 0,
  },
  {
    kind:    'file',
    path:    'data/market/acs_tract_metrics_co.json',
    minRows: 1300,
    label:   'ACS census-tract metric rows',
    count:   (json) => {
      if (!json) return 0;
      if (Array.isArray(json.tracts)) return json.tracts.length;
      if (Array.isArray(json)) return json.length;
      return 0;
    },
  },
  {
    kind:    'file',
    path:    'data/co-county-demographics.json',
    minRows: 64,
    label:   'Colorado county demographic entries',
    // `counties` is an object keyed by county name, not an array —
    // accept either shape so the sentinel survives future schema tweaks.
    count:   (json) => {
      const c = json && json.counties;
      if (!c) return 0;
      if (Array.isArray(c)) return c.length;
      if (typeof c === 'object') return Object.keys(c).length;
      return 0;
    },
  },
];

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    quiet: args.includes('--quiet'),
    json:  args.includes('--json'),
  };
}

async function readJsonSafe(relPath) {
  try {
    const txt = await fs.readFile(path.join(ROOT, relPath), 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function listDir(relPath, filter) {
  try {
    const entries = await fs.readdir(path.join(ROOT, relPath));
    return filter ? entries.filter(filter) : entries;
  } catch {
    return null;
  }
}

async function checkOne(entry) {
  let data;
  let present = true;
  if (entry.kind === 'file') {
    data = await readJsonSafe(entry.path);
    if (data === null) present = false;
  } else if (entry.kind === 'directory') {
    data = await listDir(entry.path, entry.filter);
    if (data === null) present = false;
  } else {
    throw new Error(`Unknown sentinel kind: ${entry.kind}`);
  }

  const rows = present ? entry.count(data) : 0;
  return {
    path:    entry.path,
    label:   entry.label,
    minRows: entry.minRows,
    rows,
    present,
    below:   present && rows < entry.minRows,
  };
}

function format(r) {
  if (!r.present) return `MISSING       ${r.path}  (${r.label}; floor ${r.minRows})`;
  const badge = r.below ? 'BELOW   ' : '  OK    ';
  return `${badge}  ${String(r.rows).padStart(6)} / floor ${String(r.minRows).padStart(5)}  ${r.label.padEnd(40)}  ${r.path}`;
}

async function main() {
  const { quiet, json } = parseArgs();
  const results = [];
  for (const entry of SENTINELS) {
    results.push(await checkOne(entry));
  }

  const missing = results.filter(r => !r.present);
  const below   = results.filter(r => r.present && r.below);
  const ok      = results.filter(r => r.present && !r.below);

  if (json) {
    console.log(JSON.stringify({
      checkedAt: new Date().toISOString(),
      total:     results.length,
      ok:        ok.length,
      below:     below.length,
      missing:   missing.length,
      results,
    }, null, 2));
  } else {
    if (!quiet) {
      for (const r of results) console.log(format(r));
      console.log('');
    }
    console.log(`Summary: ${ok.length} ok, ${below.length} below floor, ${missing.length} missing (of ${results.length})`);

    if (below.length) {
      console.log('\nBelow floor (suspected pipeline regression):');
      for (const r of below) {
        console.log(`  ${r.rows} rows vs floor of ${r.minRows}  —  ${r.path}  (${r.label})`);
      }
    }
    if (missing.length) {
      console.log('\nMissing artifacts:');
      for (const r of missing) console.log(`  ${r.path}`);
    }
  }

  if (missing.length) process.exit(2);
  if (below.length) process.exit(1);
  process.exit(0);
}

main().catch(err => {
  console.error('data-sentinels-check crashed:', err);
  process.exit(2);
});
