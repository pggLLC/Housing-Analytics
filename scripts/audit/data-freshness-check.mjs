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
 *   node scripts/audit/data-freshness-check.mjs --as-of=2026-11-01  (judge ages as of a date; tests)
 *
 * To add a new file, append a row to SLA_CONFIG with a reasonable SLA in days.
 * The SLA should be comfortably longer than the pipeline's refresh cadence —
 * fortnightly pipeline → ~18-day SLA, weekly → 9-day, annual → ~400-day.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..', '..');

// Canonical transit SLA lives in the browser's inventory. The coverage
// report is generated with the stop file and must obey the same window.
const inventoryContext = {};
vm.runInNewContext(await fs.readFile(path.join(ROOT, 'js/data-source-inventory.js'), 'utf8'), { window: inventoryContext });
const transitSlaDays = inventoryContext.DataSourceInventory.getSources().find(s => s.id === 'transit-stops-statewide-co')?.maxAgeDays;
if (!Number.isFinite(transitSlaDays) || transitSlaDays <= 0) throw new Error('Statewide transit source has no valid freshness SLA');

// SLA configuration — keyed by repo-relative path. Add new entries as
// new data files arrive. Avoid setting SLAs aggressively tight: the check
// is a *backstop* for silent staleness, not the primary refresh cadence.
const SLA_CONFIG = [
  { file: 'data/hna/ranking-index.json',                    slaDays: 9,   cadence: 'weekly (build-hna-data.yml)' },
  { file: 'data/fred-data.json',                            slaDays: 10,  cadence: 'weekly (fetch-fred-data.yml)' },
  { file: 'data/market/acs_tract_metrics_co.json',          slaDays: 400, cadence: 'annual (ACS 5-year release; meta.vintage)' },
  { file: 'data/co-county-economic-indicators.json',        slaDays: 16,  cadence: 'fortnightly (BLS LAUS refresh)' },
  { file: 'data/hud-fmr-income-limits.json',                slaDays: 400, cadence: 'annual (HUD FMR release)' },
  { file: 'data/hna/chas_affordability_gap.json',           slaDays: 400, cadence: 'annual (HUD CHAS release)' },
  { file: 'data/market/hud_lihtc_co.geojson',               slaDays: 95,  cadence: 'quarterly (HUD LIHTC DB)' },
  // NHPD now requires account registration and the repo currently ships a
  // stub fixture. Keep surfacing age drift in reports, but do not fail CI
  // until we have a reliable automated refresh path again.
  {
    file: 'data/market/nhpd_co.geojson',
    slaDays: 95,
    cadence: 'quarterly (NHPD export)',
    warnOnly: true,
    exception: 'NHPD access is registration-gated; the shipped 2026-03-13 stub vintage is disclosed wherever rendered.',
  },
  { file: 'data/co_ami_gap_by_county.json',                 slaDays: 95,  cadence: 'quarterly (AMI gap build)' },
  { file: 'data/co_ami_gap_by_place.json',                  slaDays: 95,  cadence: 'quarterly (matches county counterpart; underlying ACS + HUD income limits refresh annually)' },
  { file: 'data/market/cdphe_county_boundaries_co.geojson', slaDays: 400, cadence: 'annual (CDPHE boundary refresh)' },
  { file: 'data/market/transit_routes_co.geojson',          slaDays: 95,  cadence: 'monthly (GTFS feed refresh from Mobility Database)' },
  { file: 'data/amenities/transit_stops_statewide_co.geojson', slaDays: transitSlaDays, cadence: 'weekly (fetch-parcel-zoning-data.yml; CDOT + agency GTFS)' },
  { file: 'data/market/transit_stops_coverage_co.json', slaDays: transitSlaDays, cadence: 'weekly (paired statewide transit coverage report)' },
  { file: 'data/hna/transit-zone-by-geography.json',       slaDays: transitSlaDays, cadence: 'weekly (fetch-parcel-zoning-data.yml, after the stop file)' },
  // OEDIT's zone map (HB26-1065) is checked by hand. While it is unpublished,
  // every zone result on the site rests on "not published as of last_checked",
  // so that check has to be repeated: last_checked is the timestamp (never the
  // mtime — an edit to the note is not a check), and a missing one is stale.
  // Once status is "published" the file no longer ages (#1970, #1963).
  {
    file: 'data/policy/thiz-map-status.json',
    slaDays: 14,
    cadence: 'manual check of OEDIT\'s THIZ program page, while status is not "published"',
    timestampField: 'last_checked',
    appliesWhile: (d) => !d || d.status !== 'published',
  },
  // CHFA LIHTC — three questions, because "fetched this week" is not "current".
  // The weekly fetch can succeed every Sunday while CHFA's feed itself carries
  // no award newer than last December; on 2026-10-10 Mesa County's summary read
  // "most recent allocation: 2024" beside a 2026 Round One award in Clifton.
  //   1. Did the fetch run? (fetchedAt)
  //   2. Does the repo know about CHFA's latest round? Newest award date across
  //      the feed and the round bridge files. CHFA announces a round about every
  //      six months (Round One ~May, Round Two ~November), so 200 days with no
  //      newer award anywhere means a round was announced and not added.
  //      upstream-vintage-watch.mjs confirms it against CHFA's round pages.
  //   3. How far behind is CHFA's own feed? Warn only: the lag is upstream, the
  //      remedy is a bridge file, and question 2 fails if that is missed.
  { file: 'data/chfa-lihtc.json', slaDays: 9, cadence: 'weekly (fetch-chfa-lihtc.yml)' },
  {
    file: 'data/chfa-lihtc.json',
    label: 'newest CHFA award in the feed or a round bridge file',
    slaDays: 200,
    cadence: 'CHFA rounds ~May and ~November; bridge a round under data/affordable-housing/chfa-awards/ until the feed has it',
    timestampOf: newestChfaAward,
  },
  {
    file: 'data/chfa-lihtc.json',
    label: "newest award in CHFA's own property feed",
    slaDays: 120,
    cadence: "CHFA's property feed (updated by CHFA, irregularly)",
    timestampOf: (data) => newestFeedAward(data),
    warnOnly: true,
    exception: "CHFA's feed lags its own announcements. Rounds are bridged by data/affordable-housing/chfa-awards/*.json; 4% awards made between rounds are not bridged and are missing until the feed catches up.",
  },
];

const CHFA_AWARDS_DIR = 'data/affordable-housing/chfa-awards';

function newestFeedAward(data) {
  let best = null;
  for (const f of (data && data.features) || []) {
    const v = f && f.properties && f.properties.AwardDate;
    const t = typeof v === 'string' ? Date.parse(v) : NaN;
    if (Number.isFinite(t) && (best == null || t > best.t)) best = { t, value: v };
  }
  return best && { value: best.value, source: 'feed AwardDate' };
}

async function newestChfaAward(data) {
  let best = newestFeedAward(data);
  let names = [];
  try { names = (await fs.readdir(path.join(ROOT, CHFA_AWARDS_DIR))).filter(n => n.endsWith('.json')); } catch { /* none */ }
  for (const n of names) {
    const meta = ((await readJsonSafe(`${CHFA_AWARDS_DIR}/${n}`)) || {}).metadata || {};
    const v = meta.announcement_date;
    if (typeof v === 'string' && Number.isFinite(Date.parse(v)) && (!best || Date.parse(v) > Date.parse(best.value))) {
      best = { value: v, source: `${n} announcement_date` };
    }
  }
  return best;
}

// Fields to probe for an in-file "updated" timestamp, in priority order.
// Many of our JSON outputs stamp one of these; we prefer them over mtime
// because mtime can be reset by a git checkout or backup restore. Names
// cover the variants we've seen in this repo — ranking-index uses
// generatedAt, HNA summary uses updated, CHAS uses meta.generated, etc.
const TIMESTAMP_FIELDS = [
  'updated',
  'generated',
  'generatedAt',
  'fetchedAt',
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
    asOf:  (args.find(a => a.startsWith('--as-of=')) || '').slice('--as-of='.length) || null,
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

async function checkOne(entry, nowMs) {
  const full = path.join(ROOT, entry.file);
  let stat;
  try {
    stat = await fs.stat(full);
  } catch {
    return { ...entry, present: false };
  }

  if (entry.timestampOf) {
    // Computed from the content: a missing date is stale, never mtime.
    const found = await entry.timestampOf(await readJsonSafe(entry.file));
    const t = found ? Date.parse(found.value) : NaN;
    const { timestampOf, ...row } = entry;
    if (!Number.isFinite(t)) return { ...row, present: true, source: 'no dated award', asOf: null, ageDays: null, stale: true };
    const ageDays = (nowMs - t) / 86_400_000;
    return { ...row, present: true, asOf: new Date(t).toISOString(), source: found.source,
             ageDays: Math.round(ageDays * 10) / 10, stale: ageDays > entry.slaDays };
  }

  // Prefer an in-file timestamp when available.
  let recordedTs = null;
  let source     = 'mtime';
  if (entry.timestampField) {
    // A named field is the only evidence: no mtime fallback.
    const data = await readJsonSafe(entry.file);
    if (entry.appliesWhile && !entry.appliesWhile(data)) {
      return { ...entry, present: true, notApplicable: true, source: entry.timestampField, stale: false };
    }
    const v = data && data[entry.timestampField];
    const t = typeof v === 'string' ? Date.parse(v) : NaN;
    if (!Number.isFinite(t)) {
      return { ...entry, present: true, source: entry.timestampField, asOf: null, ageDays: null, stale: true };
    }
    const ageDays = (nowMs - t) / 86_400_000;
    return { ...entry, present: true, asOf: new Date(t).toISOString(), source: entry.timestampField,
             ageDays: Math.round(ageDays * 10) / 10, stale: ageDays > entry.slaDays };
  }
  if (entry.file.endsWith('.json') || entry.file.endsWith('.geojson')) {
    const data = await readJsonSafe(entry.file);
    const found = findTimestamp(data);
    if (found) {
      recordedTs = new Date(found.value);
      source = found.source;
    }
  }
  const asOf = recordedTs || new Date(stat.mtime);
  const ageMs = nowMs - asOf.getTime();
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
  if (result.notApplicable) return `  N/A           SLA ${result.slaDays}d`.padEnd(30) + `  ${result.file}  (published; no longer ages)`;
  const badge = result.stale
    ? (result.warnOnly ? 'WARN    ' : 'STALE   ')
    : '  OK    ';
  const age   = result.ageDays === null ? '    ?d' : `${String(result.ageDays).padStart(5)}d`;
  const sla   = `SLA ${result.slaDays}d`;
  const src   = result.source === 'mtime' ? 'mtime' : `field:${result.source}`;
  return `${badge}  ${age}  ${sla.padEnd(10)}  ${src.padEnd(22)}  ${result.file}${result.label ? `  [${result.label}]` : ''}`;
}

async function main() {
  const { quiet, json, asOf } = parseArgs();
  const nowMs = asOf ? Date.parse(asOf) : Date.now();
  if (!Number.isFinite(nowMs)) throw new Error(`--as-of is not a date: ${asOf}`);
  const results = [];
  for (const entry of SLA_CONFIG) {
    results.push(await checkOne(entry, nowMs));
  }

  const missing       = results.filter(r => !r.present);
  const stale         = results.filter(r => r.present && r.stale);
  const blockingStale = stale.filter(r => !r.warnOnly);
  const warningStale  = stale.filter(r => r.warnOnly);
  const ok            = results.filter(r => r.present && !r.stale);

  if (json) {
    console.log(JSON.stringify({
      checkedAt:   new Date().toISOString(),
      total:       results.length,
      ok:          ok.length,
      blockingStale: blockingStale.length,
      warningStale:  warningStale.length,
      stale:       stale.length,
      missing:     missing.length,
      results,
    }, null, 2));
  } else {
    if (!quiet) {
      for (const r of results) console.log(format(r));
      console.log('');
    }
    console.log(
      `Summary: ${ok.length} ok, ${blockingStale.length} blocking stale, ${warningStale.length} warning stale, ${missing.length} missing (of ${results.length})`,
    );

    if (stale.length) {
      console.log('\nStale files (past SLA):');
      for (const r of stale) {
        console.log(
          `  [${r.warnOnly ? 'warning' : 'blocking'} · ${r.ageDays === null ? 'undated' : r.ageDays + 'd'} past SLA of ${r.slaDays}d]  ${r.file}${r.label ? ` [${r.label}]` : ''}  (cadence: ${r.cadence})`,
        );
        if (r.exception) console.log(`    exception: ${r.exception}`);
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
  if (blockingStale.length) process.exit(1);
  process.exit(0);
}

main().catch(err => {
  console.error('data-freshness-check crashed:', err);
  process.exit(2);
});
