/**
 * generate-report.js — Housing Analytics Monitoring Report Generator
 * ===================================================================
 * Scans all tracked data artifacts, produces a human-readable summary
 * and a machine-readable JSON report.
 *
 * Usage:
 *   node scripts/monitoring/generate-report.js [--json] [--output path/to/report.json]
 *
 * Outputs:
 *   - Console summary (always)
 *   - JSON report (with --json or --output)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Artifact registry — mirrors the Python data-quality-check.py definitions
// ---------------------------------------------------------------------------
const ARTIFACTS = [
  { name: 'qct-colorado',           path: 'data/qct-colorado.json',              type: 'geojson',     minFeatures: 1, required: true  },
  { name: 'dda-colorado',           path: 'data/dda-colorado.json',              type: 'geojson',     minFeatures: 1, required: true  },
  { name: 'fred-data',              path: 'data/fred-data.json',                 type: 'fred',        required: true  },
  { name: 'tract-centroids-co',     path: 'data/market/tract_centroids_co.json', type: 'json_object', required: true  },
  { name: 'acs-tract-metrics-co',   path: 'data/market/acs_tract_metrics_co.json', type: 'json_object', required: true },
  { name: 'hud-lihtc-co',           path: 'data/market/hud_lihtc_co.geojson',   type: 'geojson',     minFeatures: 1, required: true  },
  { name: 'kalshi-prediction',      path: 'data/kalshi/prediction-market.json',  type: 'any_json',    required: false },
  { name: 'manifest',               path: 'data/manifest.json',                  type: 'any_json',    required: false },
  { name: 'co-county-boundaries',   path: 'data/co-county-boundaries.json',      type: 'any_json',    required: false },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadJson(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    if (!text.trim()) return { data: null, error: 'zero-byte file' };
    return { data: JSON.parse(text), error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

function getFileMtime(filePath) {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return null;
  }
}

function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Single artifact check
// ---------------------------------------------------------------------------

function checkArtifact(spec) {
  const absPath = path.join(ROOT, spec.path);
  const result = {
    name: spec.name,
    path: spec.path,
    required: spec.required || false,
    status: 'ok',
    issues: [],
    info: {},
  };

  if (!fs.existsSync(absPath)) {
    result.status = spec.required ? 'critical' : 'warning';
    result.issues.push(`File not found: ${spec.path}`);
    return result;
  }

  const size = getFileSize(absPath);
  result.info.bytes = size;
  result.info.lastModified = getFileMtime(absPath);

  if (size === 0) {
    result.status = 'critical';
    result.issues.push(`Zero-byte file`);
    return result;
  }

  const { data, error } = loadJson(absPath);
  if (error) {
    result.status = 'critical';
    result.issues.push(`Invalid JSON: ${error}`);
    return result;
  }

  if (spec.type === 'geojson') {
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
      result.status = 'critical';
      result.issues.push('Not a valid FeatureCollection');
      return result;
    }
    const count = data.features.length;
    result.info.featureCount = count;
    const min = spec.minFeatures || 0;
    if (count < min) {
      result.status = 'warning';
      result.issues.push(`Only ${count} features (expected ≥ ${min})`);
    } else if (count === 0) {
      result.status = 'warning';
      result.issues.push('Empty FeatureCollection (0 features)');
    }

  } else if (spec.type === 'fred') {
    if (!data || typeof data !== 'object') {
      result.status = 'critical';
      result.issues.push('FRED data is not a JSON object');
      return result;
    }
    const series = data.series || {};
    result.info.seriesCount = Object.keys(series).length;
    result.info.updated = data.updated || 'unknown';
    const emptySeries = Object.entries(series).filter(([, v]) => !v.observations || v.observations.length === 0);
    if (emptySeries.length > 0) {
      result.status = 'warning';
      result.issues.push(`${emptySeries.length} series with no observations: ${emptySeries.slice(0, 3).map(([k]) => k).join(', ')}${emptySeries.length > 3 ? '…' : ''}`);
    }

  } else if (spec.type === 'json_object') {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      result.status = 'warning';
      result.issues.push('Expected a JSON object at root');
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateReport() {
  const now = new Date();
  const results = ARTIFACTS.map(checkArtifact);

  const ok = results.filter(r => r.status === 'ok').length;
  const warnings = results.filter(r => r.status === 'warning').length;
  const critical = results.filter(r => r.status === 'critical').length;

  return {
    generated: now.toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
    },
    summary: {
      total: results.length,
      ok,
      warnings,
      critical,
      passed: critical === 0,
    },
    artifacts: results,
  };
}

// ---------------------------------------------------------------------------
// Pretty-print summary
// ---------------------------------------------------------------------------

function printSummary(report) {
  const icons = { ok: '✅', warning: '⚠️ ', critical: '❌' };
  console.log('');
  console.log('━'.repeat(60));
  console.log('  Housing Analytics — Data Quality Report');
  console.log(`  ${report.generated}`);
  console.log('━'.repeat(60));

  for (const r of report.artifacts) {
    const icon = icons[r.status] || '❓';
    const infoStr = Object.entries(r.info)
      .map(([k, v]) => `${k}=${v}`)
      .join('  ');
    console.log(`${icon} ${r.path}${infoStr ? `  (${infoStr})` : ''}`);
    for (const issue of r.issues) {
      console.log(`     ⤷ ${issue}`);
    }
  }

  console.log('');
  console.log('─'.repeat(60));
  console.log(`  Total    : ${report.summary.total}`);
  console.log(`  ✅ OK       : ${report.summary.ok}`);
  console.log(`  ⚠️  Warnings : ${report.summary.warnings}`);
  console.log(`  ❌ Critical : ${report.summary.critical}`);
  console.log('─'.repeat(60));
  if (report.summary.passed) {
    console.log('  All critical checks passed ✅');
  } else {
    console.log('  One or more critical checks FAILED ❌');
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const outputIdx = args.indexOf('--output');
  const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : null;

  const report = generateReport();

  if (!jsonMode) printSummary(report);

  if (jsonMode || outputPath) {
    const reportJson = JSON.stringify(report, null, 2);
    if (outputPath) {
      fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
      fs.writeFileSync(outputPath, reportJson);
      console.log(`Report written to ${outputPath}`);
    }
    if (jsonMode) {
      process.stdout.write(reportJson + '\n');
    }
  }

  process.exit(report.summary.passed ? 0 : 1);
}

module.exports = { generateReport, checkArtifact, ARTIFACTS };
