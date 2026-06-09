#!/usr/bin/env node
/**
 * F189 + F190 — Stamp LIHTC provenance + lock in F185 validation.
 *
 * F189 (lock the gate, future-work item 1):
 *   Going forward, the canonical "is this record LIHTC?" decision is
 *   made here. The old F184 script (tag every CHFA preservation record
 *   as LIHTC) is intentionally not re-run; this script implements the
 *   F185-corrected logic as the standing rule:
 *     - in HUD LIHTC database          → tag + copy HUD's year + credit
 *     - in CHFA live feed              → already tagged (CHFA build sets this)
 *     - in 2026 R1 bridge file         → already tagged
 *     - manually confirmed             → already tagged
 *     - ONLY in CHFA preservation feed → NOT tagged (insufficient evidence)
 *
 * F190 (data-quality badge, future-work item 2):
 *   Stamps each LIHTC-tagged record with `_lihtc_source` indicating
 *   provenance:
 *     'chfa-live'         — in CHFA HousingTaxCreditProperties_view
 *     'hud-validated'     — in HUD LIHTC database (F185 added these)
 *     'r1-bridge'         — 2026 R1 bridge (CHFA Award Report PDF)
 *     'manual-confirmed'  — added with explicit user/sponsor confirmation
 *     'chfa-preservation-plus-hud'  — in preservation feed AND HUD LIHTC
 *
 *   Consumers (HNA list, OF list, Compare) read _lihtc_source to render
 *   a small "via CHFA live" / "via HUD validation" / etc. tag next to
 *   each row so users see the provenance at a glance.
 *
 * Idempotent. Re-running with the same input produces the same output.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, '..');

const PROPS_PATH    = path.join(REPO_ROOT, 'data', 'affordable-housing', 'properties.json');
const CHFA_DB_PATH  = path.join(REPO_ROOT, 'data', 'affordable-housing', 'lihtc', 'chfa-properties.json');
const HUD_LIHTC_PATH = path.join(REPO_ROOT, 'data', 'market', 'hud_lihtc_co.geojson');

function _nameKey(s) {
  return String(s || '').toLowerCase()
    .replace(/\b(the|apts?|apartments?|residences?|homes?|housing|llc|lp|inc|i|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

async function main() {
  const [propsText, dbText, hudText] = await Promise.all([
    fs.readFile(PROPS_PATH, 'utf8'),
    fs.readFile(CHFA_DB_PATH, 'utf8'),
    fs.readFile(HUD_LIHTC_PATH, 'utf8'),
  ]);
  const props = JSON.parse(propsText);
  const db    = JSON.parse(dbText);
  const hud   = JSON.parse(hudText);

  // Index CHFA (chfa-properties.json) — origin "chfa-live" unless _source flag says otherwise.
  const chfaLive  = new Set();
  const chfaR1    = new Set();
  const chfaManual = new Set();
  for (const f of (db.features || [])) {
    const p = f.properties || {};
    const c = f.geometry && f.geometry.coordinates;
    const nk = _nameKey(p.PROJECT);
    const ck = c ? Math.round(c[1] * 1000) + ':' + Math.round(c[0] * 1000) : null;
    const src = p._source || '';
    if (src === 'chfa-2026-r1-bridge') {
      if (nk) chfaR1.add(nk);
      if (ck) chfaR1.add(ck);
    } else if (src === 'manual_addition_2026-06-09' || /manual/i.test(src)) {
      if (nk) chfaManual.add(nk);
      if (ck) chfaManual.add(ck);
    } else {
      if (nk) chfaLive.add(nk);
      if (ck) chfaLive.add(ck);
    }
  }

  // Index HUD LIHTC
  const hudSet = new Set();
  for (const f of (hud.features || [])) {
    const p = f.properties || {};
    const c = f.geometry && f.geometry.coordinates;
    const nk = _nameKey(p.PROJECT);
    if (nk) hudSet.add(nk);
    if (c) hudSet.add(Math.round(c[1] * 1000) + ':' + Math.round(c[0] * 1000));
  }

  // Provenance counts
  const counts = {
    'chfa-live': 0,
    'hud-validated': 0,
    'r1-bridge': 0,
    'manual-confirmed': 0,
    'chfa-preservation-plus-hud': 0,
    'untagged-after-validation': 0,
  };

  let touched = 0;
  for (const p of (props.properties || [])) {
    const pt = p.program_type || [];
    const isLihtc = pt.some(t => typeof t === 'string' && t.startsWith('lihtc-'));
    if (!isLihtc) continue;
    touched++;

    const nk = _nameKey(p.property_name);
    const ck = Number.isFinite(p.lat)
      ? Math.round(p.lat * 1000) + ':' + Math.round(p.lng * 1000) : null;
    const isPres = pt.includes('preservation-candidate');
    const inLive   = (nk && chfaLive.has(nk))    || (ck && chfaLive.has(ck));
    const inR1     = (nk && chfaR1.has(nk))      || (ck && chfaR1.has(ck));
    const inManual = (nk && chfaManual.has(nk))  || (ck && chfaManual.has(ck));
    const inHud    = (nk && hudSet.has(nk))      || (ck && hudSet.has(ck));

    let src;
    if (inManual)            src = 'manual-confirmed';
    else if (inR1)           src = 'r1-bridge';
    else if (isPres && inHud) src = 'chfa-preservation-plus-hud';
    else if (inLive)         src = 'chfa-live';
    else if (inHud)          src = 'hud-validated';
    else {
      // No supporting evidence found — this is the F189 gate. Strip
      // the LIHTC tag, leave preservation-candidate or other tags.
      counts['untagged-after-validation']++;
      p.program_type = pt.filter(t => !t.startsWith('lihtc-'));
      p._note = (p._note ? p._note + ' ' : '') +
        'F189 2026-06-09: lihtc-* tag REMOVED — no supporting evidence in CHFA live / HUD LIHTC / R1 bridge / manual roster. Keeping non-LIHTC tags intact.';
      delete p._lihtc_source;
      continue;
    }

    p._lihtc_source = src;
    counts[src]++;
  }

  await fs.writeFile(PROPS_PATH, JSON.stringify(props, null, 2) + '\n', 'utf8');

  console.log('F189 + F190 — LIHTC provenance stamping + gate enforcement');
  console.log('  · LIHTC-tagged records scanned: ' + touched);
  console.log('');
  console.log('Provenance distribution:');
  for (const [k, v] of Object.entries(counts)) {
    if (v > 0) console.log('  · ' + k.padEnd(35) + ' ' + v);
  }
  if (counts['untagged-after-validation'] === 0) {
    console.log('');
    console.log('Gate: no records had to be rolled back. All currently-tagged LIHTC records have supporting evidence.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
