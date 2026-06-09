#!/usr/bin/env node
/**
 * F184 — Tag CHFA preservation records as LIHTC across the affordable-
 * housing data layer.
 *
 * Root cause (discovered via the Prairie Run case): when CHFA's
 * PreservationProperties_Layer feed gets ingested into
 * properties.json, the lihtc-* tag is not preserved. So 800+ LIHTC
 * properties (Francis Heights, Gateway Village, Quigg Newton, DHA
 * Dispersed Housing, etc.) appear ONLY as preservation-candidate,
 * invisible to:
 *   - HNA LIHTC list (F174 keeps only lihtc-* records)
 *   - OF LIHTC map
 *   - Compare's LIHTC project count
 *   - ranking-index.json's lihtc_project_count + latest_lihtc_year
 *
 * High confidence: CHFA preservation source means CHFA tracks the
 * property's affordability covenant — almost always LIHTC compliance.
 * 154 HUD-MF-only records are excluded (those are Section 8 or 202/811
 * with no LIHTC layer).
 *
 * What this does:
 *   1. data/affordable-housing/properties.json — for every record
 *      sourced from "CHFA PreservationProperties" but lacking a
 *      lihtc-* tag, add `lihtc-unknown` to program_type. We tag as
 *      "unknown" rather than 9pct/4pct because we don't have the
 *      credit type from the preservation feed; consumers that need
 *      9% vs 4% specificity can still look up the property in the
 *      live CHFA portal.
 *   2. data/affordable-housing/lihtc/chfa-properties.json — mirror
 *      these records as Feature entries so the OF map shows them.
 *   3. data/chfa-lihtc.json — same mirror, since that's the per-
 *      county source the HNA controller fetches.
 *
 * Idempotent. Re-running adds nothing new for records already tagged.
 * Year fields stay null where unknown — script never fabricates a
 * YR_PIS or AwardYear.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, '..');

const PROPS_PATH     = path.join(REPO_ROOT, 'data', 'affordable-housing', 'properties.json');
const CHFA_DB_PATH   = path.join(REPO_ROOT, 'data', 'affordable-housing', 'lihtc', 'chfa-properties.json');
const CHFA_LIHTC_PATH = path.join(REPO_ROOT, 'data', 'chfa-lihtc.json');

function _isLikelyLihtc(p) {
  const pt = p.program_type || [];
  if (pt.some(t => typeof t === 'string' && t.startsWith('lihtc-'))) return false;
  if (!pt.includes('preservation-candidate')) return false;
  const src = String(p.source || '');
  return src.includes('CHFA PreservationProperties');
}

async function main() {
  const [propsText, dbText, lihtcText] = await Promise.all([
    fs.readFile(PROPS_PATH, 'utf8'),
    fs.readFile(CHFA_DB_PATH, 'utf8'),
    fs.readFile(CHFA_LIHTC_PATH, 'utf8'),
  ]);
  const props = JSON.parse(propsText);
  const db    = JSON.parse(dbText);
  const lihtc = JSON.parse(lihtcText);

  const candidates = (props.properties || []).filter(_isLikelyLihtc);

  // 1. Tag in properties.json
  let tagged = 0;
  for (const p of candidates) {
    if (!Array.isArray(p.program_type)) p.program_type = [];
    if (!p.program_type.some(t => typeof t === 'string' && t.startsWith('lihtc-'))) {
      p.program_type.push('lihtc-unknown');
      tagged++;
    }
    p._note = (p._note ? p._note + ' ' : '') +
      'F184 2026-06-09: tagged lihtc-unknown — CHFA preservation feed implies LIHTC compliance but credit-type (9%/4%/state) not surfaced by the feed.';
  }

  // 2. Mirror to chfa-properties.json (avoid duplicates)
  const dbFeats = db.features || [];
  const dbByCoord = new Set(dbFeats.map(f => {
    const c = f.geometry && f.geometry.coordinates;
    return c ? Math.round(c[1]*1000) + ':' + Math.round(c[0]*1000) : null;
  }).filter(Boolean));
  const dbByName = new Set(dbFeats.map(f => String((f.properties||{}).PROJECT||'').toLowerCase().trim()));

  let mirroredDb = 0;
  for (const p of candidates) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const coordKey = Math.round(p.lat*1000) + ':' + Math.round(p.lng*1000);
    const nameKey = String(p.property_name || '').toLowerCase().trim();
    if (dbByCoord.has(coordKey) || (nameKey && dbByName.has(nameKey))) continue;
    dbFeats.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        PROJECT:    p.property_name,
        PROJ_ADD:   p.address,
        PROJ_CTY:   p.city,
        PROJ_ST:    p.state || 'CO',
        N_UNITS:    p.total_units,
        LI_UNITS:   p.assisted_units,
        YR_PIS:     null,
        YR_ALLOC:   null,
        AwardYear:  null,
        CREDIT:     'LIHTC (preservation-implied)',
        sponsor:    p.sponsor || null,
        _source:    'F184_chfa_preservation_implied',
        _note:      'Source: CHFA PreservationProperties feed. Year + credit-type not surfaced by the preservation feed; look up the live CHFA HousingTaxCreditProperties record for specifics.',
      },
    });
    dbByCoord.add(coordKey);
    if (nameKey) dbByName.add(nameKey);
    mirroredDb++;
  }
  db.features = dbFeats;

  // 3. Mirror to chfa-lihtc.json (same set of features)
  const lFeats = lihtc.features || [];
  const lByCoord = new Set(lFeats.map(f => {
    const c = f.geometry && f.geometry.coordinates;
    return c ? Math.round(c[1]*1000) + ':' + Math.round(c[0]*1000) : null;
  }).filter(Boolean));
  let mirroredLihtc = 0;
  for (const f of dbFeats) {
    if ((f.properties || {})._source !== 'F184_chfa_preservation_implied') continue;
    const c = f.geometry && f.geometry.coordinates;
    if (!c) continue;
    const k = Math.round(c[1]*1000) + ':' + Math.round(c[0]*1000);
    if (lByCoord.has(k)) continue;
    lFeats.push(f);
    lByCoord.add(k);
    mirroredLihtc++;
  }
  lihtc.features = lFeats;

  await Promise.all([
    fs.writeFile(PROPS_PATH, JSON.stringify(props, null, 2) + '\n', 'utf8'),
    fs.writeFile(CHFA_DB_PATH, JSON.stringify(db, null, 2) + '\n', 'utf8'),
    fs.writeFile(CHFA_LIHTC_PATH, JSON.stringify(lihtc, null, 2) + '\n', 'utf8'),
  ]);

  console.log('F184 — tag CHFA preservation as LIHTC');
  console.log('  · Candidates audited: ' + candidates.length);
  console.log('  · properties.json tagged: ' + tagged);
  console.log('  · chfa-properties.json mirrored: ' + mirroredDb);
  console.log('  · chfa-lihtc.json mirrored: ' + mirroredLihtc);
}

main().catch(e => { console.error(e); process.exit(1); });
