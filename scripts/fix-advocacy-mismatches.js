#!/usr/bin/env node
/**
 * fix-advocacy-mismatches.js — F129
 * ==================================
 * Surgical fix for two classes of bug in data/hna/local-resources.json:
 *
 *   1. Lake/La Plata FIPS swap. The entire contents of county:08065 (Lake)
 *      and county:08067 (La Plata) were authored against the wrong FIPS —
 *      08065 holds La Plata housing authority + Durango advocates, 08067
 *      holds Lake County HA + advocates plus stray La Plata plans. This
 *      script untangles them.
 *
 *   2. Catholic Charities of Southern Colorado misassigned to El Paso
 *      (08041, Colorado Springs Diocese) and Teller (08119, also CO
 *      Springs Diocese). CCSC serves the Diocese of Pueblo, NOT the
 *      Diocese of Colorado Springs. The correct local org is Catholic
 *      Charities of Central Colorado.
 *
 * Run:  node scripts/fix-advocacy-mismatches.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'data/hna/local-resources.json');
const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));

const dryRun = process.argv.includes('--dry-run');
const changes = [];

// ─────────────────────────────────────────────────────────────────────
// Fix 1: Lake (08065) ↔ La Plata (08067) — full swap with field merge.
// 08065 currently holds 100% La Plata content (HA, advocacy, lead).
// 08067 holds Lake content (HA, advocacy, lead) PLUS stray La Plata
// content (housingPlans + contacts) that someone tried to add later.
// ─────────────────────────────────────────────────────────────────────
const lake    = data['county:08065']; // mislabeled, contents = La Plata
const laPlata = data['county:08067']; // mislabeled, contents = Lake + stray La Plata

if (lake && laPlata) {
  // New 08067 (La Plata): all from old 08065 (which was La Plata data) +
  // any stray La Plata-tagged fields already present in old 08067.
  const newLaPlata = Object.assign({}, lake);
  // Preserve La Plata plans + contacts that were stuck in 08067
  if (laPlata.housingPlans) newLaPlata.housingPlans = laPlata.housingPlans;
  if (laPlata.contacts)     newLaPlata.contacts     = laPlata.contacts;

  // New 08065 (Lake): keep only Lake content from old 08067.
  const newLake = {};
  ['prop123','housingAuthority','advocacy','housingLead'].forEach(field => {
    if (laPlata[field] !== undefined) newLake[field] = laPlata[field];
  });

  data['county:08065'] = newLake;
  data['county:08067'] = newLaPlata;
  changes.push('Swapped county:08065 (Lake) ↔ county:08067 (La Plata) — full content untangled');
}

// ─────────────────────────────────────────────────────────────────────
// Fix 2: Replace CCSC with Catholic Charities of Central Colorado on
// El Paso (08041) + Teller (08119). CCSC's official service area is the
// Diocese of Pueblo, which does NOT include the Diocese of Colorado
// Springs (carved out 1983). El Paso + Teller are CO Springs Diocese.
// ─────────────────────────────────────────────────────────────────────
const CCCC = {
  name: 'Catholic Charities of Central Colorado',
  url:  'https://www.ccharitiescc.org/'
};
['county:08041','county:08119'].forEach(geoKey => {
  const entry = data[geoKey];
  if (!entry || !Array.isArray(entry.advocacy)) return;
  const before = entry.advocacy.length;
  entry.advocacy = entry.advocacy.filter(a => a.name !== 'Catholic Charities of Southern Colorado');
  // Add CCCC if not already present
  if (!entry.advocacy.some(a => a.name === CCCC.name)) entry.advocacy.push(CCCC);
  if (entry.advocacy.length !== before || entry.advocacy.some(a => a.name === CCCC.name)) {
    changes.push(`Replaced 'Catholic Charities of Southern Colorado' with '${CCCC.name}' on ${geoKey}`);
  }
});

// ─────────────────────────────────────────────────────────────────────
// Report + write
// ─────────────────────────────────────────────────────────────────────
console.log('Advocacy mismatch fixes:');
changes.forEach(c => console.log('  • ' + c));

if (!changes.length) {
  console.log('  (no changes — data already clean)');
  process.exit(0);
}

if (dryRun) {
  console.log('\n--dry-run: no file written.');
  process.exit(0);
}

fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
console.log(`\nWrote ${FILE}`);
