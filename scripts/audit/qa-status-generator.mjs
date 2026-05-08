#!/usr/bin/env node
/**
 * scripts/audit/qa-status-generator.mjs
 *
 * Generates `data/_qa-status.json` — a single canonical snapshot of the
 * repo's data-quality state. Combines the four QA layers into one machine-
 * + human-readable status object:
 *
 *   1. Schema (validate-schemas)
 *   2. Sentinel (data-sentinels-check)
 *   3. Bounds (validate-critical-data)
 *   4. Freshness (data-freshness-check)
 *
 * Plausibility (Layer 5, pytest-based) is captured by reading the most
 * recent pytest output if available, or a "not run" badge otherwise.
 *
 * Output is consumed by `dashboard-data-quality.html` to render a public
 * QA status page. Updated daily by the data-quality-check workflow.
 *
 * Exit codes:
 *   0  — generated successfully (regardless of file health)
 *   1  — internal generator error (should never fail just because data is broken)
 *
 * Usage:
 *   node scripts/audit/qa-status-generator.mjs
 *   node scripts/audit/qa-status-generator.mjs --quiet
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT_FILE = path.join(ROOT, 'data', '_qa-status.json');

const QUIET = process.argv.includes('--quiet');

function log(...args) {
  if (!QUIET) console.log(...args);
}

/**
 * Run a shell command, capture stdout, and return {success, output, error}.
 * Doesn't throw — failures are part of the QA report, not a generator error.
 */
function tryRun(cmd) {
  try {
    const output = execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { success: true, output, error: null };
  } catch (err) {
    return { success: false, output: err.stdout?.toString() || '', error: err.message };
  }
}

/**
 * Parse data-freshness-check output into structured records.
 * Output format per line: "OK  3.4d  SLA 9d   field:meta.generated  data/...json"
 */
function parseFreshnessOutput(output) {
  const records = [];
  for (const line of output.split('\n')) {
    const m = /^\s*(OK|STALE|MISSING)\s+([\d.]+)d?\s+SLA\s+(\d+)d\s+(\S+)\s+(\S+)/.exec(line);
    if (m) {
      records.push({
        status: m[1],
        ageDays: parseFloat(m[2]),
        slaDays: parseInt(m[3], 10),
        source: m[4],
        file: m[5],
      });
    }
  }
  return records;
}

/**
 * Run pytest -k pattern and parse pass/fail summary.
 * Returns { passed, failed, errors, output }.
 */
function runPytest(pattern) {
  const cmd = `python3 -m pytest tests/ -q -k "${pattern}" 2>&1 || true`;
  const r = tryRun(cmd);
  const out = r.output || '';
  const m = /(\d+) passed(?:.*?(\d+) failed)?/s.exec(out);
  const m2 = /(\d+) failed/.exec(out);
  return {
    passed: m ? parseInt(m[1], 10) : 0,
    failed: m2 ? parseInt(m2[1], 10) : 0,
    output: out.slice(-3000),  // tail for debugging
  };
}

async function main() {
  log('Generating QA status snapshot...');
  const startedAt = new Date().toISOString();

  // ── Layer 1: Schema ────────────────────────────────────────
  log('  [1/5] Schema check...');
  const schema = tryRun('node scripts/validate-schemas.js');

  // ── Layer 2: Sentinel (row counts) ─────────────────────────
  log('  [2/5] Sentinel check...');
  const sentinels = tryRun('node scripts/audit/data-sentinels-check.mjs');

  // ── Layer 3: Bounds + critical data ────────────────────────
  log('  [3/5] Bound + critical-data check...');
  const bounds = tryRun('node scripts/validate-critical-data.js');

  // ── Layer 4: Freshness ─────────────────────────────────────
  log('  [4/5] Freshness check...');
  const fresh = tryRun('node scripts/audit/data-freshness-check.mjs');
  const freshnessRecords = parseFreshnessOutput(fresh.output);

  // ── Layer 5: Cross-source plausibility ─────────────────────
  log('  [5/5] Plausibility tests...');
  const plausibility = runPytest('test_data_plausibility');

  // ── Compose status payload ─────────────────────────────────
  const payload = {
    generated_at: startedAt,
    summary: {
      schema:      schema.success      ? 'pass' : 'fail',
      sentinel:    sentinels.success   ? 'pass' : 'fail',
      bounds:      bounds.success      ? 'pass' : 'fail',
      freshness:   fresh.success       ? 'pass' : 'fail',
      plausibility: plausibility.failed === 0 ? 'pass' : 'fail',
    },
    layers: {
      schema: {
        status: schema.success ? 'pass' : 'fail',
        output_tail: (schema.output || '').slice(-2000),
        error: schema.error,
      },
      sentinel: {
        status: sentinels.success ? 'pass' : 'fail',
        output_tail: (sentinels.output || '').slice(-2000),
        error: sentinels.error,
      },
      bounds: {
        status: bounds.success ? 'pass' : 'fail',
        output_tail: (bounds.output || '').slice(-2000),
        error: bounds.error,
      },
      freshness: {
        status: fresh.success ? 'pass' : 'fail',
        files: freshnessRecords,
        ok:      freshnessRecords.filter(r => r.status === 'OK').length,
        stale:   freshnessRecords.filter(r => r.status === 'STALE').length,
        missing: freshnessRecords.filter(r => r.status === 'MISSING').length,
      },
      plausibility: {
        status: plausibility.failed === 0 ? 'pass' : 'fail',
        passed: plausibility.passed,
        failed: plausibility.failed,
        output_tail: plausibility.output,
      },
    },
    qa_doc: 'docs/CONTRIBUTING.md#qaqc-layers',
  };

  // Compute overall verdict — any layer failing = warn; all passing = ok
  const layerStatuses = Object.values(payload.summary);
  payload.overall = layerStatuses.every(s => s === 'pass') ? 'ok'
                   : layerStatuses.some(s => s === 'fail') ? 'warn'
                   : 'unknown';

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
  log(`✓ Wrote ${OUT_FILE}`);
  log(`  Overall: ${payload.overall.toUpperCase()}`);
  for (const [layer, status] of Object.entries(payload.summary)) {
    log(`    ${status === 'pass' ? '✓' : '✗'} ${layer}: ${status}`);
  }
}

main().catch(err => {
  console.error('QA status generator crashed:', err);
  process.exit(1);
});
