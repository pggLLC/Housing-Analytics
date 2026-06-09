#!/usr/bin/env node
/**
 * F188 — Enrich LIHTC records with CHFA's AwardYear / YR_ALLOC.
 *
 * After F185, the 106 HUD-validated records carry HUD's YR_PIS (year
 * placed in service) but not CHFA's AwardYear (year credits were
 * reserved — typically 2-3y before PIS) or YR_ALLOC. Consumers that
 * care about competition timing (CHFA QAP rounds, opportunity scoring)
 * want the award/allocation year, not just PIS.
 *
 * Strategy: for every LIHTC-tagged record in properties.json (~1,026),
 * look up the matching property in chfa-properties.json by normalized
 * project name + coordinate match within ~100m. Where matched, copy:
 *   - AwardYear → properties.json `award_year` (+ `latest_year` if newer)
 *   - YR_ALLOC  → properties.json `allocation_year`
 *
 * Idempotent. Doesn't fabricate years — if CHFA's record also has
 * null AwardYear (true for manually-added Prairie Run + a few HUD-
 * mirrored entries), the field stays null.
 *
 * Also re-runs the recency augmentation so ranking-index.json picks
 * up the enriched years.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, '..');

const PROPS_PATH    = path.join(REPO_ROOT, 'data', 'affordable-housing', 'properties.json');
const CHFA_DB_PATH  = path.join(REPO_ROOT, 'data', 'affordable-housing', 'lihtc', 'chfa-properties.json');

function _nameKey(s) {
  return String(s || '').toLowerCase()
    .replace(/\b(the|apts?|apartments?|residences?|homes?|housing|llc|lp|inc|i|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

async function main() {
  const [propsText, dbText] = await Promise.all([
    fs.readFile(PROPS_PATH, 'utf8'),
    fs.readFile(CHFA_DB_PATH, 'utf8'),
  ]);
  const props = JSON.parse(propsText);
  const db    = JSON.parse(dbText);

  // Index CHFA records by name + coordinate.
  const chfaByName = new Map();
  const chfaByCoord = new Map();
  for (const f of (db.features || [])) {
    const p = f.properties || {};
    const c = f.geometry && f.geometry.coordinates;
    const nk = _nameKey(p.PROJECT);
    if (nk) chfaByName.set(nk, p);
    if (c) chfaByCoord.set(Math.round(c[1] * 1000) + ':' + Math.round(c[0] * 1000), p);
  }

  let enrichedAward = 0;
  let enrichedAlloc = 0;
  let scanned = 0;
  const samples = [];

  for (const p of (props.properties || [])) {
    const pt = p.program_type || [];
    if (!pt.some(t => typeof t === 'string' && t.startsWith('lihtc-'))) continue;
    scanned++;

    const nk = _nameKey(p.property_name);
    const ck = Number.isFinite(p.lat)
      ? Math.round(p.lat * 1000) + ':' + Math.round(p.lng * 1000) : null;
    const hit = (ck && chfaByCoord.get(ck)) || (nk && chfaByName.get(nk));
    if (!hit) continue;

    const aw = parseInt(hit.AwardYear || hit.YR_ALLOC, 10);
    if (Number.isFinite(aw)) {
      if (p.award_year == null) {
        p.award_year = aw;
        enrichedAward++;
      }
      // `latest_year` is the highest year known for the property; tend it.
      if (p.latest_year == null || aw > p.latest_year) {
        p.latest_year = aw;
      }
    }
    const al = parseInt(hit.YR_ALLOC, 10);
    if (Number.isFinite(al) && p.allocation_year == null) {
      p.allocation_year = al;
      enrichedAlloc++;
    }

    if (samples.length < 5 && p.award_year) {
      samples.push({ name: p.property_name, city: p.city, award: p.award_year, latest: p.latest_year });
    }
  }

  await fs.writeFile(PROPS_PATH, JSON.stringify(props, null, 2) + '\n', 'utf8');

  console.log('F188 — enrich LIHTC records with CHFA AwardYear / YR_ALLOC');
  console.log('  · LIHTC records scanned:           ' + scanned);
  console.log('  · award_year populated:            ' + enrichedAward);
  console.log('  · allocation_year populated:       ' + enrichedAlloc);
  console.log('');
  if (samples.length) {
    console.log('Sample enriched records:');
    samples.forEach(s => console.log('  · ' + s.name + ' — ' + s.city + ' — award ' + s.award + ' · latest ' + s.latest));
  }
  console.log('');
  console.log('Re-running recency augmentation…');
  execSync('node ' + path.join(__dirname, 'augment_ranking_index_recency.mjs'), { stdio: 'inherit' });
}

main().catch(e => { console.error(e); process.exit(1); });
