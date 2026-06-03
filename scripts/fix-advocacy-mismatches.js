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
const lake    = data['county:08065']; // mislabeled state, contents = La Plata
const laPlata = data['county:08067']; // mislabeled state, contents = Lake + stray La Plata

// Idempotency check: only swap if the swap hasn't already been applied.
// A clean 08065 (Lake) should have Lake-named entries. If we already
// fixed it, skip — re-running would un-fix.
function needsLakeLaPlataSwap() {
  if (!lake || !laPlata) return false;
  const ha = (lake.housingAuthority && lake.housingAuthority[0] && lake.housingAuthority[0].name) || '';
  // If 08065's housing authority mentions "La Plata" or "Durango", the
  // swap hasn't been applied yet.
  return /la plata|durango/i.test(ha);
}

if (needsLakeLaPlataSwap()) {
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
// Fix 3: Mountain Family Center (Granby, Grand County org) was listed
// on Garfield County and New Castle (~150mi from Granby). Per
// mountainfamilycenter.org their service area is Grand + parts of
// Jackson Counties. Move them to Grand (08049); replace with a true
// Garfield-local org on Garfield + New Castle.
// ─────────────────────────────────────────────────────────────────────
function removeAdvocate(geoKey, namePattern) {
  const entry = data[geoKey];
  if (!entry || !Array.isArray(entry.advocacy)) return false;
  const before = entry.advocacy.length;
  entry.advocacy = entry.advocacy.filter(a => !namePattern.test(a.name));
  return entry.advocacy.length !== before;
}
function addAdvocate(geoKey, org) {
  if (!data[geoKey]) data[geoKey] = {};
  if (!Array.isArray(data[geoKey].advocacy)) data[geoKey].advocacy = [];
  if (data[geoKey].advocacy.some(a => a.name === org.name)) return false;
  data[geoKey].advocacy.push(org);
  return true;
}

const HABITAT_ROARING_FORK = {
  name: 'Habitat for Humanity of the Roaring Fork Valley',
  url:  'https://www.habitatroaringfork.org/'
};
const MOUNTAIN_FAMILY_CENTER = {
  name: 'Mountain Family Center',
  url:  'https://mountainfamilycenter.org/'
};
const YOUTH_ZONE = {
  name: 'YouthZone',
  url:  'https://youthzone.com/'
};

// Remove Mountain Family Center from Garfield (08045) + New Castle
// (0853395) — wrong service area.
['county:08045','place:0853395'].forEach(k => {
  if (removeAdvocate(k, /^Mountain Family Center$/i)) {
    changes.push(`Removed misplaced "Mountain Family Center" from ${k} (org serves Grand County, not Garfield)`);
  }
});

// Add Mountain Family Center to Grand County (08049) — correct service area.
if (addAdvocate('county:08049', MOUNTAIN_FAMILY_CENTER)) {
  changes.push('Added "Mountain Family Center" to county:08049 (Grand) — its actual service area');
}

// Add truly-local Roaring Fork Valley orgs to Garfield County + New
// Castle so the advocacy section reflects orgs that actually build
// affordable housing in the area.
['county:08045','place:0853395'].forEach(k => {
  if (addAdvocate(k, HABITAT_ROARING_FORK)) {
    changes.push(`Added "Habitat for Humanity of the Roaring Fork Valley" to ${k}`);
  }
  if (addAdvocate(k, YOUTH_ZONE)) {
    changes.push(`Added "YouthZone" to ${k}`);
  }
});

// Also extend Habitat Roaring Fork to other Roaring Fork Valley
// communities they actually build in: Glenwood Springs (0831660),
// Carbondale (0810835), Silt (0870975), Rifle (0863215),
// Parachute (0857300). Only adds if those entries exist.
['place:0831660','place:0810835','place:0870975','place:0863215','place:0857300','place:0808945','place:0808945'].forEach(k => {
  if (data[k] && addAdvocate(k, HABITAT_ROARING_FORK)) {
    changes.push(`Added "Habitat for Humanity of the Roaring Fork Valley" to ${k}`);
  }
});

// ─────────────────────────────────────────────────────────────────────
// Fix 4: Lift-Up of Northwest Colorado was tagged on 5 counties they
// don't actually serve (Grand, Jackson, Moffat, Rio Blanco, Routt).
// Their actual pantry footprint per lift-up.org is Garfield + parts of
// Pitkin + Eagle. Remove the false claims so users in those NW counties
// don't get pointed at an org with no presence there.
// ─────────────────────────────────────────────────────────────────────
['county:08049','county:08057','county:08081','county:08103','county:08107'].forEach(k => {
  if (removeAdvocate(k, /^Lift-Up of Northwest Colorado$/i)) {
    changes.push(`Removed "Lift-Up of Northwest Colorado" from ${k} (no pantry/footprint there per lift-up.org)`);
  }
});
// Keep Lift-Up on Garfield + New Castle (true service area). Also add
// to Pitkin (08097) where they have Aspen + Basalt pantries.
if (addAdvocate('county:08097', { name: 'Lift-Up of Northwest Colorado', url: 'https://www.lift-up.org/' })) {
  changes.push('Added "Lift-Up of Northwest Colorado" to county:08097 (Pitkin) — operates Aspen + Basalt pantries');
}

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
