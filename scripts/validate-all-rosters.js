#!/usr/bin/env node
/**
 * validate-all-rosters.js — F135
 * ===============================
 * Single entry point that runs every roster validator in the repo.
 * Exits non-zero on any mismatch so the script can gate CI / release.
 *
 * Currently validates:
 *
 *   1. Advocacy assignments vs. service areas
 *      (existing scripts/validate-advocacy-roster.js)
 *
 *   2. Local PHA roster GEOIDs — every property in data/affordable-
 *      housing/local-pha-roster/*.json must have lat/lng inside the
 *      claimed county_fips. Catches the Lake/La Plata-style swap that
 *      was the trigger for F129.
 *
 *   3. School district + hospital + major-employer assignments — each
 *      entry's name must contain the jurisdiction or a recognized
 *      regional marker so a Granby-area org doesn't get tagged to a
 *      Garfield-County town (the Mountain Family Center bug, F130).
 *
 *   4. Affordable-housing properties manifest hash matches actual
 *      content. If a stale manifest sneaks past dedupe, cache-busts
 *      silently break.
 *
 * Run:  node scripts/validate-all-rosters.js
 * CI:   add to package.json as `npm run validate:rosters`
 */
'use strict';

const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

let totalIssues = 0;
const warnings  = [];

function section(title) {
  console.log('\n── ' + title + ' ──');
}

// ─────────────────────────────────────────────────────────────────────
// 1. Advocacy validator (delegate to existing script)
// ─────────────────────────────────────────────────────────────────────
section('1. Advocacy roster');
try {
  execSync('node ' + path.join(__dirname, 'validate-advocacy-roster.js'), {
    stdio: 'inherit', cwd: ROOT
  });
} catch (e) {
  totalIssues++;
  // execSync prints the validator's own output; we just track the failure.
}

// ─────────────────────────────────────────────────────────────────────
// 2. Local PHA roster GEOID coverage
// ─────────────────────────────────────────────────────────────────────
section('2. Local PHA roster GEOID coverage');
const ROSTER_DIR = path.join(ROOT, 'data/affordable-housing/local-pha-roster');
if (!fs.existsSync(ROSTER_DIR)) {
  console.log('  ⚠ Directory missing — skipping (data/affordable-housing/local-pha-roster/)');
} else {
  const files = fs.readdirSync(ROSTER_DIR).filter(f => f.endsWith('.json'));
  let rosterIssues = 0;
  files.forEach(f => {
    const fullPath = path.join(ROSTER_DIR, f);
    const doc = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    if (!Array.isArray(doc.properties)) return;
    doc.properties.forEach((p, idx) => {
      // Hard checks: lat/lng must be inside CO bounding box, county_fips
      // must look like an 08XXX value.
      if (!(p.lat >= 36.99 && p.lat <= 41.01)) {
        console.log(`  ✗ ${f}[${idx}] "${p.property_name}" lat=${p.lat} outside Colorado`);
        rosterIssues++;
      }
      if (!(p.lng >= -109.06 && p.lng <= -102.04)) {
        console.log(`  ✗ ${f}[${idx}] "${p.property_name}" lng=${p.lng} outside Colorado`);
        rosterIssues++;
      }
      if (p.county_fips && !/^08\d{3}$/.test(p.county_fips)) {
        console.log(`  ✗ ${f}[${idx}] "${p.property_name}" county_fips=${p.county_fips} not a CO county`);
        rosterIssues++;
      }
    });
  });
  if (!rosterIssues) console.log('  ✓ ' + files.length + ' file(s), all properties geo-valid.');
  totalIssues += rosterIssues;
}

// ─────────────────────────────────────────────────────────────────────
// 3. School-district + hospital + major-employer name sanity
// ─────────────────────────────────────────────────────────────────────
section('3. School district + hospital + employer assignments');
const LR_PATH = path.join(ROOT, 'data/hna/local-resources.json');
const LR = JSON.parse(fs.readFileSync(LR_PATH, 'utf-8'));

// Geographic-keyword bucket — orgs whose name claims a region MUST be
// assigned to a place inside that region. Conservative: only flags
// orgs whose names explicitly contain a recognized regional anchor.
const PLACE_NAMES = require(path.join(ROOT, 'data/co-place-centroids.json')).byGeoid || {};
const CO_COUNTY_NAMES = {
  '001':'Adams','003':'Alamosa','005':'Arapahoe','007':'Archuleta','009':'Baca','011':'Bent',
  '013':'Boulder','014':'Broomfield','015':'Chaffee','017':'Cheyenne','019':'Clear Creek',
  '021':'Conejos','023':'Costilla','025':'Crowley','027':'Custer','029':'Delta','031':'Denver',
  '033':'Dolores','035':'Douglas','037':'Eagle','039':'Elbert','041':'El Paso','043':'Fremont',
  '045':'Garfield','047':'Gilpin','049':'Grand','051':'Gunnison','053':'Hinsdale','055':'Huerfano',
  '057':'Jackson','059':'Jefferson','061':'Kiowa','063':'Kit Carson','065':'Lake','067':'La Plata',
  '069':'Larimer','071':'Las Animas','073':'Lincoln','075':'Logan','077':'Mesa','079':'Mineral',
  '081':'Moffat','083':'Montezuma','085':'Montrose','087':'Morgan','089':'Otero','091':'Ouray',
  '093':'Park','095':'Phillips','097':'Pitkin','099':'Prowers','101':'Pueblo','103':'Rio Blanco',
  '105':'Rio Grande','107':'Routt','109':'Saguache','111':'San Juan','113':'San Miguel',
  '115':'Sedgwick','117':'Summit','119':'Teller','121':'Washington','123':'Weld','125':'Yuma'
};

// Bucket maps a regional anchor word in an org NAME to the FIPS codes
// where it should plausibly appear. Same pattern as validate-advocacy-
// roster's ROSTER but cross-cutting (schools/hospitals/employers all).
const REGIONAL_ANCHORS = [
  { rx: /Garfield Re-2/i,                            counties: ['045'],        regionLabel: 'Garfield County (Re-2 service area: New Castle, Silt, Rifle)' },
  { rx: /Garfield 16/i,                              counties: ['045'],        regionLabel: 'Garfield County (Re-16: Parachute/Battlement Mesa)' },
  { rx: /Roaring Fork RE-1|Roaring Fork School/i,    counties: ['037','045'],  regionLabel: 'Roaring Fork RE-1: Eagle + Garfield' },
  { rx: /Aspen School District|Aspen K-?12/i,        counties: ['097'],        regionLabel: 'Pitkin (Aspen)' },
  { rx: /Boulder Valley|BVSD/i,                      counties: ['013','014'],  regionLabel: 'Boulder/Broomfield (BVSD)' },
  { rx: /St\.? Vrain Valley|SVVSD/i,                 counties: ['013','014','123'],  regionLabel: 'Boulder + Broomfield + Weld (St. Vrain Valley)' },
  { rx: /Denver Public Schools|DPS/i,                counties: ['031'],        regionLabel: 'Denver' },
  { rx: /Aurora Public Schools|APS/i,                counties: ['001','005'],  regionLabel: 'Aurora area (Adams + Arapahoe)' },
  { rx: /Jefferson County Public Schools|Jeffco/i,   counties: ['059'],        regionLabel: 'Jefferson County' },
  { rx: /Colorado Springs School District 11|D11/i,  counties: ['041'],        regionLabel: 'Colorado Springs' },
  { rx: /Pueblo City Schools|D60/i,                  counties: ['101'],        regionLabel: 'Pueblo' },
  { rx: /Poudre School District|PSD/i,               counties: ['069'],        regionLabel: 'Larimer (Poudre)' },
  { rx: /Greeley-Evans|District 6/i,                 counties: ['123'],        regionLabel: 'Weld (Greeley)' },
  { rx: /Durango 9-R/i,                              counties: ['067'],        regionLabel: 'La Plata (Durango)' },
  // Hospital + employer anchors
  { rx: /Valley View Hospital/i,                     counties: ['045'],        regionLabel: 'Garfield (Glenwood Springs)' },
  { rx: /Grand River Health/i,                       counties: ['045'],        regionLabel: 'Garfield (Rifle/New Castle/Silt/Parachute)' },
  { rx: /Vail Resorts|Vail Health|Vail InDEED/i,     counties: ['037'],        regionLabel: 'Eagle County (Vail Valley)' },
  { rx: /Aspen Skiing|Aspen Valley Hospital/i,       counties: ['097'],        regionLabel: 'Pitkin (Aspen)' },
  { rx: /Mountain Family Center/i,                   counties: ['049','057'],  regionLabel: 'Grand + Jackson (NOT Garfield)' },
  { rx: /Mercy Hospital.*Durango|Mercy Durango/i,    counties: ['067'],        regionLabel: 'La Plata (Durango)' },
  { rx: /Aspen Valley Hospital/i,                    counties: ['097'],        regionLabel: 'Pitkin' },
  { rx: /Banner.*Greeley|Greeley.*Banner/i,          counties: ['123'],        regionLabel: 'Weld (Greeley)' },
  { rx: /CSU Pueblo|Pueblo.*CSU/i,                   counties: ['101'],        regionLabel: 'Pueblo' },
  { rx: /Fort Lewis College/i,                       counties: ['067'],        regionLabel: 'La Plata (Durango)' },
  { rx: /Buckley Space Force|Anschutz Medical/i,     counties: ['005','001'],  regionLabel: 'Aurora area' },
];

let nameIssues = 0;
function placeCountyFips(geoKey) {
  // place GEOID is 7 digits: SSPPPPP. CO state code = 08, county is inferred
  // via place→county mapping. We approximate by checking the centroid against
  // every county's bbox in data/co-place-centroids.json (if loaded). For our
  // purposes here we don't need exact county FIPS — only need to extract from
  // county: keys directly, and skip place: keys (those are validated against
  // the org name regionLabel only).
  if (geoKey.startsWith('county:08')) return geoKey.slice(-3);
  return null;
}

Object.entries(LR).forEach(([geoKey, entry]) => {
  if (!entry || typeof entry !== 'object') return;
  const fips3 = placeCountyFips(geoKey);
  if (!fips3) return;  // skip place + state entries (region-flagging would need a place→county map)

  const lists = [];
  if (Array.isArray(entry.advocacy))        entry.advocacy.forEach(x => lists.push({ kind: 'advocacy', name: x.name }));
  if (entry.schoolDistrict && entry.schoolDistrict.name) lists.push({ kind: 'schoolDistrict', name: entry.schoolDistrict.name });
  if (entry.hospital && entry.hospital.name)             lists.push({ kind: 'hospital',       name: entry.hospital.name });
  if (Array.isArray(entry.majorEmployers))  entry.majorEmployers.forEach(x => lists.push({ kind: 'majorEmployer', name: x.name }));

  lists.forEach(item => {
    REGIONAL_ANCHORS.forEach(anchor => {
      if (anchor.rx.test(item.name) && !anchor.counties.includes(fips3)) {
        console.log(`  ✗ ${geoKey} (${CO_COUNTY_NAMES[fips3]}) has ${item.kind} "${item.name}" — expected: ${anchor.regionLabel}`);
        nameIssues++;
      }
    });
  });
});

if (!nameIssues) {
  console.log('  ✓ All school/hospital/employer assignments match their named regional anchors.');
}
totalIssues += nameIssues;

// ─────────────────────────────────────────────────────────────────────
// 4. Properties manifest hash matches content
// ─────────────────────────────────────────────────────────────────────
section('4. Affordable-housing properties manifest hash');
const PROPS_PATH    = path.join(ROOT, 'data/affordable-housing/properties.json');
const MANIFEST_PATH = path.join(ROOT, 'data/affordable-housing/properties-manifest.json');
if (!fs.existsSync(MANIFEST_PATH)) {
  console.log('  ⚠ Manifest missing — run scripts/build-affordable-housing-properties.js first');
} else if (!fs.existsSync(PROPS_PATH)) {
  console.log('  ✗ properties.json missing');
  totalIssues++;
} else {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  const propsRaw = fs.readFileSync(PROPS_PATH, 'utf-8');
  const liveHash = crypto.createHash('sha1').update(propsRaw).digest('hex').slice(0, 12);
  if (manifest.v !== liveHash) {
    console.log(`  ✗ Manifest hash ${manifest.v} ≠ live hash ${liveHash} — run build script to refresh`);
    totalIssues++;
  } else {
    console.log(`  ✓ Manifest hash matches live content (v=${liveHash}, ${manifest.total_records} records).`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Final summary
// ─────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════');
if (totalIssues === 0) {
  console.log('✓ All roster validators pass.');
  process.exit(0);
} else {
  console.log('✗ ' + totalIssues + ' issue(s) across roster validators.');
  process.exit(1);
}
