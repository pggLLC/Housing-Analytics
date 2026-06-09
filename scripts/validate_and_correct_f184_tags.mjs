#!/usr/bin/env node
/**
 * F185 — Validate + correct the F184 bulk LIHTC tagging.
 *
 * F184 tagged 773 records as lihtc-unknown based on the assumption that
 * everything in CHFA's PreservationProperties feed must be LIHTC. That
 * was wrong. Cross-validation against HUD's LIHTC database
 * (data/market/hud_lihtc_co.geojson — the gold-standard registry):
 *
 *   773 records tagged in F184
 *   106 confirmed in HUD LIHTC (real LIHTC with known YR_PIS + CREDIT)
 *   667 NOT in HUD LIHTC (uncertain — many tiny SRO / supportive / HUD-only)
 *
 * The 667 uncertain records include 1-9 unit properties like "2851 Champa"
 * (2 units), "1241 Stuart Street Apartments" (1 unit), "1467 N Detroit St
 * - Empowerment Program" (4 units, supportive). These are subsidized
 * affordable housing — but not necessarily LIHTC.
 *
 * This script:
 *
 * 1. data/affordable-housing/properties.json
 *    - For the 106 HUD-validated records: keep lihtc-unknown tag, copy
 *      YR_PIS + CREDIT + sponsor from HUD so they have real years.
 *      Upgrade the tag from lihtc-unknown to lihtc-9pct / lihtc-4pct /
 *      etc. based on HUD's CREDIT field.
 *    - For the 667 unverified: REMOVE lihtc-unknown tag. They stay
 *      preservation-candidate (CHFA's preservation tracking is still
 *      valid info; we just shouldn't claim LIHTC).
 *
 * 2. data/affordable-housing/lihtc/chfa-properties.json
 *    - Remove F184 mirrored features whose _source is
 *      F184_chfa_preservation_implied AND that aren't in HUD LIHTC.
 *    - For the 106 validated, replace with the actual HUD record
 *      (which has YR_PIS + CREDIT).
 *
 * 3. data/chfa-lihtc.json — same scrub.
 *
 * 4. Exempts the 2 manually-confirmed Prairie Run records (F183) —
 *    those were added with explicit user confirmation, not auto-tagged.
 *
 * Idempotent. Re-running with the same input produces the same output.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, '..');

const PROPS_PATH      = path.join(REPO_ROOT, 'data', 'affordable-housing', 'properties.json');
const CHFA_DB_PATH    = path.join(REPO_ROOT, 'data', 'affordable-housing', 'lihtc', 'chfa-properties.json');
const CHFA_LIHTC_PATH = path.join(REPO_ROOT, 'data', 'chfa-lihtc.json');
const HUD_LIHTC_PATH  = path.join(REPO_ROOT, 'data', 'market', 'hud_lihtc_co.geojson');

function _nameKey(s) {
  return String(s || '').toLowerCase()
    .replace(/\b(the|apts?|apartments?|residences?|homes?|housing|llc|lp|inc|i|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function _creditToTag(credit) {
  const c = String(credit || '').toUpperCase();
  const tags = [];
  if (c.includes('MIHTC') && !c.includes('%')) tags.push('lihtc-mihtc');
  if (c.includes('9%'))                         tags.push('lihtc-9pct');
  if (c.includes('4%') || c.includes('TAX EXEMPT')) tags.push('lihtc-4pct');
  if (c.includes('STATE'))                      tags.push('lihtc-state-paired');
  if (c.includes('TOC'))                        tags.push('lihtc-toc-paired');
  if (!tags.length) tags.push('lihtc-unknown');
  return Array.from(new Set(tags));
}

async function main() {
  const [propsText, dbText, lihtcText, hudText] = await Promise.all([
    fs.readFile(PROPS_PATH, 'utf8'),
    fs.readFile(CHFA_DB_PATH, 'utf8'),
    fs.readFile(CHFA_LIHTC_PATH, 'utf8'),
    fs.readFile(HUD_LIHTC_PATH, 'utf8'),
  ]);
  const props = JSON.parse(propsText);
  const db    = JSON.parse(dbText);
  const lihtc = JSON.parse(lihtcText);
  const hud   = JSON.parse(hudText);

  // Build HUD LIHTC lookup
  const hudByName = new Map();
  const hudByCoord = new Map();
  for (const f of (hud.features || [])) {
    const p = f.properties || {};
    const k = _nameKey(p.PROJECT);
    if (k) hudByName.set(k, p);
    const c = f.geometry && f.geometry.coordinates;
    if (c) hudByCoord.set(Math.round(c[1] * 1000) + ':' + Math.round(c[0] * 1000), p);
  }

  function _lookupHud(p) {
    const ck = Number.isFinite(p.lat) ? Math.round(p.lat * 1000) + ':' + Math.round(p.lng * 1000) : null;
    const nk = _nameKey(p.property_name || p.PROJECT);
    return (ck && hudByCoord.get(ck)) || (nk && hudByName.get(nk)) || null;
  }

  // ── 1. Correct properties.json ──
  let upgraded = 0, rolledBack = 0, kept = 0;
  for (const p of (props.properties || [])) {
    const pt = p.program_type || [];
    if (!pt.includes('lihtc-unknown')) continue;

    // Exempt the 2 manually-confirmed Prairie Run records (F183) —
    // they have a sponsor field set + the explicit F183 _note.
    if (String(p._note || '').includes('F183') ||
        /prairie run/i.test(p.property_name || '')) {
      kept++;
      continue;
    }

    const hudHit = _lookupHud(p);
    if (hudHit) {
      // Validated. Upgrade lihtc-unknown → specific tag(s) based on HUD CREDIT.
      // Drop lihtc-unknown; add the credit-specific tag(s).
      const idx = pt.indexOf('lihtc-unknown');
      if (idx !== -1) pt.splice(idx, 1);
      const newTags = _creditToTag(hudHit.CREDIT);
      for (const t of newTags) if (!pt.includes(t)) pt.push(t);
      p.program_type = pt;
      // Populate year + credit fields from HUD (the preservation feed didn't have them).
      if (p.latest_year == null && hudHit.YR_PIS) p.latest_year = parseInt(hudHit.YR_PIS, 10) || null;
      if (!p.type_of_credits && hudHit.CREDIT)    p.type_of_credits = hudHit.CREDIT;
      if (!p.sponsor && hudHit.Sponsor)           p.sponsor = hudHit.Sponsor;
      p._note = (p._note ? p._note + ' ' : '') +
        'F185 2026-06-09: HUD LIHTC validated; year + credit-type copied from hud_lihtc_co.geojson.';
      upgraded++;
    } else {
      // Not in HUD LIHTC. F184 was wrong to tag this. Roll back.
      const idx = pt.indexOf('lihtc-unknown');
      if (idx !== -1) pt.splice(idx, 1);
      p.program_type = pt;
      p._note = (p._note ? p._note + ' ' : '') +
        'F185 2026-06-09: lihtc-unknown tag REMOVED — not in HUD LIHTC database; CHFA preservation feed alone is insufficient evidence of LIHTC.';
      rolledBack++;
    }
  }

  // ── 2 + 3. Clean F184 mirrored features from chfa-properties.json + chfa-lihtc.json ──
  function _cleanFeats(file, kind) {
    const original = file.features || [];
    const kept = original.filter(f => (f.properties || {})._source !== 'F184_chfa_preservation_implied');
    const removed = original.length - kept.length;
    // For validated records, add a proper feature from HUD's data so they
    // STAY visible on the map with real year + credit info.
    let added = 0;
    const existingCoord = new Set(kept.map(f => {
      const c = f.geometry && f.geometry.coordinates;
      return c ? Math.round(c[1] * 1000) + ':' + Math.round(c[0] * 1000) : null;
    }).filter(Boolean));
    for (const f of (hud.features || [])) {
      const p = f.properties || {};
      const c = f.geometry && f.geometry.coordinates;
      if (!c) continue;
      const k = Math.round(c[1] * 1000) + ':' + Math.round(c[0] * 1000);
      if (existingCoord.has(k)) continue;
      // Only add HUD records that map to one of the F184 candidates
      const nk = _nameKey(p.PROJECT);
      const wasF184 = (props.properties || []).some(pp =>
        String(pp._note || '').includes('F185 2026-06-09: HUD LIHTC validated') &&
        _nameKey(pp.property_name) === nk
      );
      if (!wasF184) continue;
      kept.push({
        type: 'Feature',
        geometry: f.geometry,
        properties: Object.assign({}, p, { _source: 'F185_hud_lihtc_validated' }),
      });
      existingCoord.add(k);
      added++;
    }
    file.features = kept;
    console.log('  · ' + kind + ': removed ' + removed + ' F184 ghosts, added ' + added + ' HUD-validated records');
  }
  console.log('Cleaning mirrored databases:');
  _cleanFeats(db, 'chfa-properties.json');
  _cleanFeats(lihtc, 'chfa-lihtc.json');

  await Promise.all([
    fs.writeFile(PROPS_PATH, JSON.stringify(props, null, 2) + '\n', 'utf8'),
    fs.writeFile(CHFA_DB_PATH, JSON.stringify(db, null, 2) + '\n', 'utf8'),
    fs.writeFile(CHFA_LIHTC_PATH, JSON.stringify(lihtc, null, 2) + '\n', 'utf8'),
  ]);

  console.log('');
  console.log('F185 — F184 validation summary:');
  console.log('  · upgraded (HUD-validated, year + credit copied): ' + upgraded);
  console.log('  · rolled back (lihtc-unknown removed):            ' + rolledBack);
  console.log('  · kept (Prairie Run manual entries):              ' + kept);
}

main().catch(e => { console.error(e); process.exit(1); });
