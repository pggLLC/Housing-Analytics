#!/usr/bin/env node
/**
 * data-freshness-check.mjs — verify critical data files haven't gone stale.
 * Partial closeout of issue #656 (data-freshness monitoring + alerting)
 * from the #447 epic decomposition.
 *
 * What it does:
 *   1. Checks each file in SLA_CONFIG.
 *   2. For each file: prefer an in-file `updated` / `generated` /
 *      `metadata.generated` timestamp (many of our pipelines stamp one);
 *      fall back to the file's mtime if none is present.
 *   3. Fails non-zero if any file is older than its SLA.
 *
 * Exit codes:
 *   0  — every file within its SLA (or warn-only)
 *   1  — at least one file past its SLA (hard stale)
 *   2  — internal script error (e.g. missing required file)
 *
 * Usage:
 *   node scripts/audit/data-freshness-check.mjs
 *   node scripts/audit/data-freshness-check.mjs --json      (machine output)
 *   node scripts/audit/data-freshness-check.mjs --quiet     (only print failures)
 *
 * To add a new file, append a row to SLA_CONFIG with a reasonable SLA in days.
 * The SLA should be comfortably longer than the pipeline's refresh cadence —
 * fortnightly pipeline → ~18-day SLA, weekly → 9-day, annual → ~400-day.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..', '..');

// SLA configuration — keyed by repo-relative path. Add new entries as
// new data files arrive. Avoid setting SLAs aggressively tight: the check
// is a *backstop* for silent staleness, not the primary refresh cadence.
const SLA_CONFIG = [
  { file: 'data/hna/ranking-index.json',                    slaDays: 9,   cadence: 'weekly (build-hna-data.yml)' },
  { file: 'data/fred-data.json',                            slaDays: 10,  cadence: 'weekly (fetch-fred-data.yml)' },
  { file: 'data/market/acs_tract_metrics_co.json',          slaDays: 32,  cadence: 'monthly (market-data workflow)' },
  { file: 'data/co-county-economic-indicators.json',        slaDays: 16,  cadence: 'fortnightly (BLS LAUS refresh)' },
  { file: 'data/hud-fmr-income-limits.json',                slaDays: 400, cadence: 'annual (HUD FMR release)' },
  { file: 'data/hna/chas_affordability_gap.json',           slaDays: 400, cadence: 'annual (HUD CHAS release)' },
  { file: 'data/market/hud_lihtc_co.geojson',               slaDays: 95,  cadence: 'quarterly (HUD LIHTC DB)' },
  { file: 'data/market/nhpd_co.geojson',                    slaDays: 95,  cadence: 'quarterly (NHPD export)' },
  { file: 'data/co_ami_gap_by_county.json',                 slaDays: 95,  cadence: 'quarterly (AMI gap build)' },
];

// Fields to probe for an in-file "updated" timestamp, in priority order.
// Many of our JSON outputs stamp one of these; we prefer them over mtime
// because mtime can be reset by a git checkout or backup restore. Names
// cover the variants we've seen in this repo — ranking-index uses
// generatedAt, HNA summary uses updated, CHAS uses meta.generated, etc.
const TIMESTAMP_FIELDS = [
  'updated',
  'generated',
  'generatedAt',
  'last_updated',
  'lastUpdated',
  'timestamp',
];
const TIMESTAMP_PARENTS = ['metadata', 'meta'];

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    quiet: args.includes('--quiet'),
    json:  args.includes('--json'),
  };
}

/** Walk an object one level deep looking for a known timestamp field. */
function findTimestamp(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of TIMESTAMP_FIELDS) {
    if (typeof obj[key] === 'string' && Date.parse(obj[key])) {
      return { source: key, value: obj[key] };
    }
  }
  for (const parent of TIMESTAMP_PARENTS) {
    const sub = obj[parent];
    if (sub && typeof sub === 'object') {
      for (const key of TIMESTAMP_FIELDS) {
        if (typeof sub[key] === 'string' && Date.parse(sub[key])) {
          return { source: `${parent}.${key}`, value: sub[key] };
        }
      }
    }
  }
  return null;
}

async function readJsonSafe(relPath) {
  try {
    const txt = await fs.readFile(path.join(ROOT, relPath), 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function checkOne(entry) {
  const full = path.join(ROOT, entry.file);
  let stat;
  try {
    stat = await fs.stat(full);
  } catch {
    return { ...entry, present: false };
  }

  // Prefer an in-file timestamp when available.
  let recordedTs = null;
  let source     = 'mtime';
  if (entry.file.endsWith('.json')) {
    const data = await readJsonSafe(entry.file);
    const found = findTimestamp(data);
    if (found) {
      recordedTs = new Date(found.value);
      source = found.source;
    }
  }
  const asOf = recordedTs || new Date(stat.mtime);
  const ageMs = Date.now() - asOf.getTime();
  const ageDays = ageMs / 86_400_000;
  return {
    ...entry,
    present: true,
    asOf:    asOf.toISOString(),
    source,
    ageDays: Math.round(ageDays * 10) / 10,
    stale:   ageDays > entry.slaDays,
  };
}

function format(result) {
  if (!result.present) return `MISSING       ${result.file}  (SLA ${result.slaDays}d)`;
  const badge = result.stale ? 'STALE   ' : '  OK    ';
  const age   = `${String(result.ageDays).padStart(5)}d`;
  const sla   = `SLA ${result.slaDays}d`;
  const src   = result.source === 'mtime' ? 'mtime' : `field:${result.source}`;
  return `${badge}  ${age}  ${sla.padEnd(10)}  ${src.padEnd(22)}  ${result.file}`;
}

async function main() {
  const { quiet, json } = parseArgs();
  const results = [];
  for (const entry of SLA_CONFIG) {
    results.push(await checkOne(entry));
  }

  const missing = results.filter(r => !r.present);
  const stale   = results.filter(r => r.present && r.stale);
  const ok      = results.filter(r => r.present && !r.stale);

  if (json) {
    console.log(JSON.stringify({
      checkedAt:   new Date().toISOString(),
      total:       results.length,
      ok:          ok.length,
      stale:       stale.length,
      missing:     missing.length,
      results,
    }, null, 2));
  } else {
    if (!quiet) {
      for (const r of results) console.log(format(r));
      console.log('');
    }
    console.log(`Summary: ${ok.length} ok, ${stale.length} stale, ${missing.length} missing (of ${results.length})`);

    if (stale.length) {
      console.log('\nStale files (past SLA):');
      for (const r of stale) {
        console.log(`  [${r.ageDays}d past SLA of ${r.slaDays}d]  ${r.file}  (cadence: ${r.cadence})`);
      }
    }
    if (missing.length) {
      console.log('\nMissing files:');
      for (const r of missing) console.log(`  ${r.file}`);
    }
  }

  // Missing = internal-config error (file was in SLA list but isn't on disk).
  if (missing.length) process.exit(2);
  // Stale = operational failure; CI should fail.
  if (stale.length) process.exit(1);
  process.exit(0);
}

main().catch(err => {
  console.error('data-freshness-check crashed:', err);
  process.exit(2);
});
