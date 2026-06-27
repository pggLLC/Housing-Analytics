#!/usr/bin/env node
/**
 * Backfill extended ACS profile variables into data/hna/summary/*.json.
 *
 * This keeps the browser's live Census profile request as a fallback only:
 * cached summaries get the home-value brackets, tenure-count supplements,
 * household composition, occupation, labor-force, race, ethnicity, education,
 * and income variables used by HNA extended panels.
 *
 * Mirrors the batching shape in scripts/hna/build_hna_data.py. Census API key
 * is optional; set CENSUS_API_KEY when available for higher quota.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SUMMARY_DIR = path.join(ROOT, 'data', 'hna', 'summary');

const DRY_RUN = process.argv.includes('--dry');
const CENSUS_API_KEY = process.env.CENSUS_API_KEY || '';
const START_YEAR = Number(process.env.ACS_START_YEAR || 2024);
const FALLBACK_YEARS = Number(process.env.ACS_FALLBACK_YEARS || 3);
const YEARS = Array.from({ length: FALLBACK_YEARS }, (_, i) => START_YEAR - i);
const MAX_CONCURRENT = Number(process.env.HNA_BACKFILL_CONCURRENCY || 4);
const STATE_FIPS_CO = '08';

if (!CENSUS_API_KEY) {
  throw new Error(
    'CENSUS_API_KEY is required for the extended ACS cache backfill. ' +
    'The Census profile API currently returns a 200 HTML "Missing Key" page for these batches without a key.'
  );
}

const BATCHES = [
  {
    id: 'profile-c',
    vars: [
      'DP04_0002E','DP04_0003E','DP04_0046E',
      'DP04_0080E','DP04_0081E','DP04_0082E','DP04_0083E','DP04_0084E',
      'DP04_0085E','DP04_0086E','DP04_0087E','DP04_0088E',
      'DP03_0061E',
    ],
  },
  {
    id: 'profile-d',
    vars: [
      'DP02_0001E','DP02_0002E','DP02_0004E','DP02_0006E','DP02_0007E',
      'DP02_0008E','DP02_0010E','DP02_0011E','DP02_0012E','DP02_0014E',
      'DP02_0015E','DP02_0016E','DP02_0017E','DP02_0072E',
      'DP02_0059E','DP02_0060E','DP02_0061E','DP02_0062E','DP02_0063E',
      'DP02_0064E','DP02_0065E','DP02_0066E','DP02_0067E','DP02_0068E',
      'DP03_0027E','DP03_0028E','DP03_0029E','DP03_0030E','DP03_0031E',
      'DP03_0002E','DP03_0005E','DP03_0007E',
      'DP05_0016E','DP05_0017E','DP05_0019E','DP05_0024E','DP05_0029E',
      'DP05_0033E','DP05_0037E','DP05_0038E','DP05_0039E','DP05_0047E',
      'DP05_0055E','DP05_0060E','DP05_0061E','DP05_0076E','DP05_0082E',
    ],
  },
];

const REQUIRED = new Set(BATCHES.flatMap((b) => b.vars));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function resolveGeo(record) {
  const raw = record?.acsProfile?._geoType ?? record?.geo?.type ?? null;
  const geoid = record?.geo?.geoid ?? null;
  if (!raw || !geoid) return null;
  const t = String(raw).toLowerCase();
  if (t === 'state') return { kind: 'state', geoid: String(geoid) };
  if (t === 'county') return { kind: 'county', geoid: String(geoid) };
  if (['place', 'cdp', 'city', 'town'].includes(t)) return { kind: 'place', geoid: String(geoid) };
  return null;
}

function buildUrl(kind, geoid, year, vars) {
  let forParam;
  let inParam = null;
  if (kind === 'state') {
    if (geoid.length !== 2) return null;
    forParam = `state:${geoid}`;
  } else if (kind === 'county') {
    if (geoid.length !== 5) return null;
    forParam = `county:${geoid.slice(2)}`;
    inParam = `state:${geoid.slice(0, 2)}`;
  } else if (kind === 'place') {
    if (geoid.length !== 7) return null;
    forParam = `place:${geoid.slice(2)}`;
    inParam = `state:${geoid.slice(0, 2)}`;
  } else {
    return null;
  }
  let qs = `get=${[...vars, 'NAME'].join(',')}&for=${forParam}`;
  if (inParam) qs += `&in=${inParam}`;
  if (CENSUS_API_KEY) qs += `&key=${encodeURIComponent(CENSUS_API_KEY)}`;
  return `https://api.census.gov/data/${year}/acs/acs5/profile?${qs}`;
}

async function fetchBatch(geo, batch, attempt = 0) {
  for (const year of YEARS) {
    const url = buildUrl(geo.kind, geo.geoid, year, batch.vars);
    if (!url) continue;
    const res = await fetch(url);
    if (!res.ok) {
      if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
        await sleep(res.status === 429 ? 3000 : 1200);
        return fetchBatch(geo, batch, 1);
      }
      continue;
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await res.text();
      if (/Missing Key/i.test(text)) {
        throw new Error('Census API requires CENSUS_API_KEY for this request');
      }
      continue;
    }
    let body;
    try {
      body = await res.json();
    } catch (_) {
      continue;
    }
    if (!Array.isArray(body) || body.length < 2) continue;
    const headers = body[0];
    const row = body[1];
    const out = { _acsYear: String(year), _acsSeries: 'acs5' };
    for (const v of batch.vars) {
      const idx = headers.indexOf(v);
      out[v] = idx === -1 || row[idx] == null || row[idx] === '' ? null : row[idx];
    }
    return out;
  }
  return null;
}

async function processFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  let record;
  try { record = JSON.parse(raw); }
  catch (err) { return { status: 'errored', filePath, reason: `bad JSON: ${err.message}` }; }

  const profile = record?.acsProfile;
  if (!profile || typeof profile !== 'object') return { status: 'skipped', filePath, reason: 'no acsProfile' };
  const missing = [...REQUIRED].filter((k) => !Object.prototype.hasOwnProperty.call(profile, k));
  if (!missing.length) return { status: 'skipped', filePath, reason: 'already complete' };

  const geo = resolveGeo(record);
  if (!geo) return { status: 'errored', filePath, reason: 'unknown geography' };

  const merged = { ...profile };
  const neededBatches = BATCHES.filter((batch) => batch.vars.some((v) => missing.includes(v)));
  for (const batch of neededBatches) {
    const values = await fetchBatch(geo, batch);
    if (!values) return { status: 'errored', filePath, reason: `${batch.id} unavailable` };
    for (const [k, v] of Object.entries(values)) {
      if (k.startsWith('_')) merged[k] = merged[k] || v;
      else merged[k] = v;
    }
  }

  if (!DRY_RUN) {
    record.acsProfile = merged;
    await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  }
  return { status: DRY_RUN ? 'would-fill' : 'filled', filePath, count: missing.length };
}

async function main() {
  const files = (await fs.readdir(SUMMARY_DIR))
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(SUMMARY_DIR, name))
    .sort();
  console.log(`[backfill-hna-extended] ${files.length} summary files; years=${YEARS.join(',')}; concurrency=${MAX_CONCURRENT}; ${DRY_RUN ? 'dry run' : 'write mode'}`);
  let idx = 0;
  const stats = { filled: 0, 'would-fill': 0, skipped: 0, errored: 0 };
  const errors = [];

  async function worker() {
    while (idx < files.length) {
      const current = idx++;
      const filePath = files[current];
      const result = await processFile(filePath);
      stats[result.status] = (stats[result.status] || 0) + 1;
      if (result.status === 'errored') errors.push(`${path.basename(filePath)}: ${result.reason}`);
      if ((current + 1) % 25 === 0 || current + 1 === files.length) {
        console.log(`[backfill-hna-extended] progress ${current + 1}/${files.length} (filled=${stats.filled + stats['would-fill']} skipped=${stats.skipped} errored=${stats.errored})`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, files.length) }, worker));
  console.log('\n=== backfill-hna-extended summary ===');
  console.log(`filled:  ${stats.filled}`);
  console.log(`would-fill: ${stats['would-fill']}`);
  console.log(`skipped: ${stats.skipped}`);
  console.log(`errored: ${stats.errored}`);
  if (errors.length) {
    console.log('\nErrors:');
    for (const err of errors.slice(0, 40)) console.log(`  - ${err}`);
    if (errors.length > 40) console.log(`  ... plus ${errors.length - 40} more`);
    process.exitCode = 1;
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
