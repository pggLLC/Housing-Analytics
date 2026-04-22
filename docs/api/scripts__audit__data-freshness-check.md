# `scripts/audit/data-freshness-check.mjs`

## Symbols

### `findTimestamp(obj)`

data-freshness-check.mjs — verify critical data files haven't gone stale.
Partial closeout of issue #656 (data-freshness monitoring + alerting)
from the #447 epic decomposition.

What it does:
  1. Checks each file in SLA_CONFIG.
  2. For each file: prefer an in-file `updated` / `generated` /
     `metadata.generated` timestamp (many of our pipelines stamp one);
     fall back to the file's mtime if none is present.
  3. Fails non-zero if any file is older than its SLA.

Exit codes:
  0  — every file within its SLA (or warn-only)
  1  — at least one file past its SLA (hard stale)
  2  — internal script error (e.g. missing required file)

Usage:
  node scripts/audit/data-freshness-check.mjs
  node scripts/audit/data-freshness-check.mjs --json      (machine output)
  node scripts/audit/data-freshness-check.mjs --quiet     (only print failures)

To add a new file, append a row to SLA_CONFIG with a reasonable SLA in days.
The SLA should be comfortably longer than the pipeline's refresh cadence —
fortnightly pipeline → ~18-day SLA, weekly → 9-day, annual → ~400-day.
/

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

/** Walk an object one level deep looking for a known timestamp field.
