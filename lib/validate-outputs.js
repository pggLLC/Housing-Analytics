#!/usr/bin/env node
/**
 * lib/validate-outputs.js
 * Post-generation validation script for COHO Analytics data pipeline.
 *
 * Checks that key data artifacts exist and contain the expected minimum number
 * of records.  Writes a machine-readable pipeline-status.json to lib/ so that
 * dashboards can surface a warning banner when the last build was incomplete.
 *
 * Usage:
 *   node lib/validate-outputs.js [--json]
 *
 * Exit codes:
 *   0 — all checks passed (status: 'success')
 *   1 — one or more checks failed (status: 'warning' or 'failure')
 *
 * The results are also available at runtime via window.dataValidationStatus
 * (set by dashboards that load lib/pipeline-status.json on page load).
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT        = path.join(__dirname, '..');
const STATUS_FILE = path.join(__dirname, 'pipeline-status.json');
const JSON_MODE   = process.argv.includes('--json');

// ---------------------------------------------------------------------------
// Artifact checks
// Each entry describes one file that must exist after the pipeline runs.
//   path      — path relative to repo root
//   minCount  — if the file contains a JSON array/object, the minimum number
//               of top-level elements (or records in a named array key).
//   arrayKey  — optional: look inside data[arrayKey] instead of root.
// ---------------------------------------------------------------------------
const CHECKS = [
  // Core manifest — minCount refers to file_count, checked via arrayKey
  { path: 'data/manifest.json',                minCount: 100, arrayKey: 'files' },

  // FRED economic data
  { path: 'data/fred-data.json',               minCount: 1,   arrayKey: 'series' },

  // CHFA / HUD LIHTC
  { path: 'data/chfa-lihtc.json',              minCount: 1,   arrayKey: 'features' },

  // AMI gap
  { path: 'data/co_ami_gap_by_county.json',    minCount: 1,   arrayKey: 'counties' },

  // LIHTC trends — counties is a dict with 64 county keys
  { path: 'data/lihtc-trends-by-county.json',  minCount: 64,  arrayKey: 'counties' },

  // CAR market report (most recent)
  { path: 'data/car-market.json',              minCount: 1 },

  // HNA ranking index
  { path: 'data/hna/ranking-index.json',       minCount: 1,   arrayKey: 'rankings' },

  // NHPD preservation
  { path: 'data/market/nhpd_co.geojson',       minCount: 1,   arrayKey: 'features' },

  // CHAS affordability gap
  { path: 'data/hna/chas_affordability_gap.json', minCount: 1 },

  // HUD FMR / income limits — counties array with 64 entries
  { path: 'data/hud-fmr-income-limits.json',   minCount: 64,  arrayKey: 'counties' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeReadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function countRecords(data, arrayKey) {
  if (!data) return 0;
  if (arrayKey) {
    const sub = data[arrayKey];
    return Array.isArray(sub) ? sub.length : (sub && typeof sub === 'object' ? Object.keys(sub).length : 0);
  }
  if (Array.isArray(data)) return data.length;
  if (typeof data === 'object') return Object.keys(data).length;
  return 1;
}

// ---------------------------------------------------------------------------
// Run checks
// ---------------------------------------------------------------------------

const now          = new Date().toISOString();
const failedSteps  = [];
const incompletePaths = [];
const recordCounts    = {};

for (const check of CHECKS) {
  const absPath = path.join(ROOT, check.path);

  if (!fs.existsSync(absPath)) {
    failedSteps.push('MISSING: ' + check.path);
    incompletePaths.push(check.path);
    if (!JSON_MODE) {
      console.error('  ❌ MISSING   ' + check.path);
    }
    continue;
  }

  const data  = safeReadJSON(absPath);
  const count = countRecords(data, check.arrayKey);
  recordCounts[check.path] = count;

  if (count < check.minCount) {
    failedSteps.push('LOW_COUNT(' + count + '<' + check.minCount + '): ' + check.path);
    incompletePaths.push(check.path);
    if (!JSON_MODE) {
      console.error('  ⚠️  LOW COUNT  ' + check.path + ' (' + count + ' < ' + check.minCount + ' expected)');
    }
  } else {
    if (!JSON_MODE) {
      console.log('  ✅ OK         ' + check.path + ' (' + count + ' records)');
    }
  }
}

// ---------------------------------------------------------------------------
// Determine overall status
// ---------------------------------------------------------------------------

let status;
if (failedSteps.length === 0) {
  status = 'success';
} else if (incompletePaths.some(p => p.includes('manifest.json') || p.includes('fred-data') || p.includes('chfa-lihtc'))) {
  status = 'failure';
} else {
  status = 'warning';
}

const result = {
  status,
  timestamp:           now,
  lastSuccessfulBuild: status === 'success' ? now : (readLastSuccess() || '1970-01-01T00:00:00.000Z'),
  failedSteps,
  incompletePaths,
  recordCounts,
};

// ---------------------------------------------------------------------------
// Persist last successful build timestamp across runs
// ---------------------------------------------------------------------------

function readLastSuccess() {
  try {
    const prev = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    return prev.lastSuccessfulBuild || null;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Write pipeline-status.json
// ---------------------------------------------------------------------------

fs.writeFileSync(STATUS_FILE, JSON.stringify(result, null, 2), 'utf8');

if (JSON_MODE) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} else {
  console.log('\n============================================================');
  if (status === 'success') {
    console.log('Pipeline status: ✅ SUCCESS — all ' + CHECKS.length + ' artifact checks passed.');
  } else {
    console.log('Pipeline status: ' + (status === 'failure' ? '❌ FAILURE' : '⚠️  WARNING') +
      ' — ' + failedSteps.length + ' issue(s) found.');
  }
  console.log('Results written to ' + STATUS_FILE);
  console.log('============================================================');
}

process.exit(status === 'success' ? 0 : 1);
