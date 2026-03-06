#!/usr/bin/env node
/**
 * scripts/audit/data-inventory.mjs
 *
 * Inventories all local data files under data/ and maps/ and prints a
 * human-readable report plus a machine-readable JSON summary.
 *
 * Usage:
 *   node scripts/audit/data-inventory.mjs [--json]
 *
 * With --json, writes data/manifest.json and prints the JSON to stdout.
 * Without --json, prints a formatted table to stdout.
 *
 * Reports:
 *  - File path, size (KB), type, feature/record count, geographic coverage
 *  - Flags placeholder files (0 features, stub metadata)
 *  - Summary totals
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const MAPS_DIR = path.join(ROOT, 'maps');
const MANIFEST_OUT = path.join(ROOT, 'data', 'manifest.json');

const JSON_OUTPUT = process.argv.includes('--json');

// ── helpers ──────────────────────────────────────────────────────────────────

function walk(dir, ext = ['.json', '.geojson', '.csv', '.txt']) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full, ext));
    } else if (ext.some(e => entry.name.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

function sizeKb(filePath) {
  return (fs.statSync(filePath).size / 1024).toFixed(1);
}

/**
 * Returns { type, featureCount, recordCount, geoCoverage, placeholder, note }
 * by inspecting the file contents.
 */
function inspectFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const result = {
    type: ext.replace('.', '').toUpperCase(),
    featureCount: null,
    recordCount: null,
    geoCoverage: null,
    placeholder: false,
    note: null,
  };

  if (ext === '.txt' || ext === '.csv') {
    // Just count lines
    try {
      const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
      result.recordCount = Math.max(0, lines.length - 1); // minus header
    } catch (_) { /* ignore */ }
    return result;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    result.note = 'parse error';
    return result;
  }

  // GeoJSON FeatureCollection
  if (data && data.type === 'FeatureCollection') {
    const features = Array.isArray(data.features) ? data.features : [];
    result.featureCount = features.length;
    result.placeholder = features.length === 0;

    // Try to derive geo coverage from properties
    if (features.length > 0) {
      const stateSet = new Set();
      const countySet = new Set();
      for (const f of features) {
        const p = f.properties || {};
        if (p.STATE || p.STATEFP || p.state) stateSet.add(p.STATE || p.STATEFP || p.state);
        if (p.COUNTY || p.COUNTYFP) countySet.add(p.COUNTY || p.COUNTYFP);
      }
      if (stateSet.size === 1) {
        const st = [...stateSet][0];
        result.geoCoverage = st === '08' || st === '8' ? 'Colorado' : `State ${st}`;
      } else if (stateSet.size > 1) {
        result.geoCoverage = `${stateSet.size} states`;
      }
      if (countySet.size > 0 && !result.geoCoverage) {
        result.geoCoverage = `${countySet.size} counties`;
      }
    }

    // Placeholder note
    const meta = data.meta || {};
    if (meta.note) result.note = meta.note;

    return result;
  }

  // TopoJSON
  if (data && data.type === 'Topology') {
    result.type = 'TopoJSON';
    const objKeys = Object.keys(data.objects || {});
    result.note = `objects: ${objKeys.join(', ')}`;
    return result;
  }

  // Generic JSON — try common patterns
  if (Array.isArray(data)) {
    result.recordCount = data.length;
    return result;
  }

  if (data && typeof data === 'object') {
    // series dict (FRED)
    if (data.series && typeof data.series === 'object') {
      const series = Object.values(data.series);
      result.recordCount = series.length;
      const withObs = series.filter(s => Array.isArray(s.observations) && s.observations.length > 0).length;
      const stubs = series.filter(s => s._stub).length;
      result.note = `${withObs} with observations, ${stubs} stubs`;
      result.placeholder = stubs === series.length;
      return result;
    }

    // features array under a key
    const featKey = ['features', 'jurisdictions', 'counties', 'states', 'items', 'markets', 'resources'].find(k => Array.isArray(data[k]));
    if (featKey) {
      result.recordCount = data[featKey].length;
      result.placeholder = result.recordCount === 0;
      return result;
    }

    // HNA projections / dola / lehd
    if (data.countyFips) {
      result.geoCoverage = `County ${data.countyFips}`;
      result.recordCount = 1;
      return result;
    }

    // geo-config
    if (data.counties) {
      result.recordCount = data.counties.length || Object.keys(data.counties).length;
      result.geoCoverage = 'Colorado';
      return result;
    }

    // tract metrics / centroids
    if (data.tracts) {
      const tracts = data.tracts;
      result.recordCount = Array.isArray(tracts) ? tracts.length : Object.keys(tracts).length;
      result.placeholder = result.recordCount < 10;
      return result;
    }

    // allocations
    if (data.states && typeof data.states === 'object') {
      result.recordCount = Object.keys(data.states).length;
      result.geoCoverage = 'National';
      return result;
    }

    result.recordCount = Object.keys(data).length;
    return result;
  }

  return result;
}

// ── main ──────────────────────────────────────────────────────────────────────

function pad(s, n) {
  return String(s).padEnd(n);
}

function rpad(s, n) {
  return String(s).padStart(n);
}

function main() {
  const allFiles = [
    ...walk(DATA_DIR),
    ...walk(MAPS_DIR),
  ];

  const rows = allFiles.map(f => {
    const rel = path.relative(ROOT, f);
    const kb = sizeKb(f);
    const info = inspectFile(f);
    return { path: rel, sizeKb: parseFloat(kb), ...info };
  });

  // Separate by category
  const issues = rows.filter(r => r.placeholder);
  const byDir = {};
  for (const r of rows) {
    const dir = path.dirname(r.path);
    (byDir[dir] = byDir[dir] || []).push(r);
  }

  if (JSON_OUTPUT) {
    // Build compact manifest — aggregate HNA per-county directories
    const HNA_COUNTY_DIRS = [
      'data/hna/dola_sya',
      'data/hna/lehd',
      'data/hna/lihtc',
      'data/hna/projections',
      'data/hna/summary',
    ];

    function isHnaCounty(filePath) {
      return HNA_COUNTY_DIRS.some(d => filePath.startsWith(d + '/'));
    }

    // Aggregate HNA county directories
    const hnaAgg = {};
    const topRows = [];
    for (const r of rows) {
      const rel = r.path.replace(/\\/g, '/');
      if (isHnaCounty(rel)) {
        const dir = path.dirname(rel).replace(/\\/g, '/');
        if (!hnaAgg[dir]) hnaAgg[dir] = { fileCount: 0, totalKb: 0, emptyCount: 0 };
        hnaAgg[dir].fileCount++;
        hnaAgg[dir].totalKb += r.sizeKb;
        if (r.placeholder) hnaAgg[dir].emptyCount++;
      } else {
        topRows.push(r);
      }
    }

    const fileEntries = Object.fromEntries(
      topRows.map(r => [r.path, {
        sizeKb: r.sizeKb,
        type: r.type,
        featureCount: r.featureCount,
        recordCount: r.recordCount,
        geoCoverage: r.geoCoverage,
        placeholder: r.placeholder,
        note: r.note,
      }])
    );

    // Add HNA directory aggregates
    for (const [dir, agg] of Object.entries(hnaAgg)) {
      const hasEmpty = agg.emptyCount > 0;
      fileEntries[dir + '/*.json'] = {
        sizeKb: parseFloat(agg.totalKb.toFixed(1)),
        type: 'JSON (directory)',
        featureCount: null,
        recordCount: agg.fileCount,
        geoCoverage: 'Colorado (64 counties)',
        placeholder: hasEmpty,
        note: hasEmpty
          ? `${agg.emptyCount} of ${agg.fileCount} files empty`
          : `${agg.fileCount} county files`,
      };
    }

    const manifest = {
      generated: new Date().toISOString(),
      totalFiles: rows.length,
      totalSizeKb: parseFloat(rows.reduce((s, r) => s + r.sizeKb, 0).toFixed(1)),
      placeholders: issues.length,
      files: fileEntries,
    };
    fs.writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  // Human-readable table
  console.log('=== Housing Analytics — Local Data Inventory ===\n');
  const COL = [52, 8, 10, 8, 24, 0];
  const header = [
    pad('Path', COL[0]),
    rpad('KB', COL[1]),
    rpad('Features', COL[2]),
    rpad('Records', COL[3]),
    pad('Coverage', COL[4]),
    'Notes',
  ].join('  ');
  console.log(header);
  console.log('─'.repeat(120));

  for (const r of rows) {
    const features = r.featureCount !== null ? String(r.featureCount) : '—';
    const records  = r.recordCount  !== null ? String(r.recordCount)  : '—';
    const coverage = r.geoCoverage || '—';
    const note     = (r.placeholder ? '⚠ PLACEHOLDER  ' : '') + (r.note || '');
    const line = [
      pad(r.path, COL[0]),
      rpad(r.sizeKb.toFixed(1), COL[1]),
      rpad(features, COL[2]),
      rpad(records, COL[3]),
      pad(coverage, COL[4]),
      note,
    ].join('  ');
    console.log(line);
  }

  console.log('\n');
  console.log(`Total files : ${rows.length}`);
  console.log(`Total size  : ${rows.reduce((s, r) => s + r.sizeKb, 0).toFixed(1)} KB`);
  console.log(`Placeholders: ${issues.length}`);

  if (issues.length > 0) {
    console.log('\nFiles with 0 features / empty data (action required):');
    for (const r of issues) {
      console.log(`  ⚠ ${r.path}  (${r.sizeKb} KB)`);
      if (r.note) console.log(`     ${r.note}`);
    }
  }
}

main();
