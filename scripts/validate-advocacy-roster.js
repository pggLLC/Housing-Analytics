#!/usr/bin/env node
/**
 * validate-advocacy-roster.js — F129 guard
 * =========================================
 * Sanity-checks advocacy/nonprofit assignments in
 * data/hna/local-resources.json against a curated service-area roster.
 * Flags assignments where an org's name implies a region that doesn't
 * include the assigned jurisdiction.
 *
 * The roster is intentionally CONSERVATIVE — it only encodes orgs whose
 * names contain unambiguous geographic markers (e.g. "of Metro Denver",
 * "of Colorado Springs", "Northwest Colorado", "Pikes Peak"). Statewide
 * orgs and orgs without geographic markers in their name are skipped.
 *
 * Exit codes:
 *   0 — no issues, or warnings only
 *   1 — at least one definite mismatch found
 *
 * Run:  node scripts/validate-advocacy-roster.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'data/hna/local-resources.json');
const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));

// ─────────────────────────────────────────────────────────────────────
// Service-area roster. Each entry maps an org name (or substring match)
// to a list of county FIPS where the org plausibly serves. Statewide
// orgs are flagged separately.
//
// Counties (08XXX):
//   Diocese of Pueblo  = Pueblo (101), Las Animas (071), Huerfano (055),
//                       Otero (089), Crowley (025), Bent (011), Baca (009),
//                       Prowers (099), Kiowa (061), Cheyenne (017),
//                       Kit Carson (063), Lincoln (073), Custer (027),
//                       Fremont (043), Saguache (109), Mineral (079),
//                       Alamosa (003), Rio Grande (105), Conejos (021),
//                       Costilla (023), Dolores (033), Montezuma (083)
//   Diocese of CO Spgs = El Paso (041), Teller (119), Park (093), Lake (065),
//                       Chaffee (015)
//   Diocese of Denver  = Adams (001), Arapahoe (005), Boulder (013),
//                       Broomfield (014), Clear Creek (019), Denver (031),
//                       Douglas (035), Eagle (037), Elbert (039), Gilpin (047),
//                       Grand (049), Jackson (057), Jefferson (059),
//                       Larimer (069), Lake (065 — split), Logan (075),
//                       Morgan (087), Phillips (095), Sedgwick (115),
//                       Weld (123), Yuma (125)
// ─────────────────────────────────────────────────────────────────────
const PUEBLO_DIOCESE = ['101','071','055','089','025','011','009','099','061','017','063','073','027','043','109','079','003','105','021','023','033','083'];
const COS_DIOCESE    = ['041','119','093','065','015'];
const DENVER_METRO   = ['001','005','031','035','059'];
const PIKES_PEAK     = ['041','119'];
const FRONT_RANGE_NORTH = ['069','123'];      // Larimer + Weld
const NW_COLORADO    = ['045','049','057','081','103','107'];  // Garfield, Grand, Jackson, Moffat, Rio Blanco, Routt
const SLV            = ['003','021','023','079','105','109'];
const GRAND_VALLEY   = ['077'];               // Mesa County
const SW_COLORADO    = ['007','033','067','083','111','113'];  // Archuleta, Dolores, La Plata, Montezuma, San Juan, San Miguel
const WEST_SLOPE     = ['029','085','091'];   // Delta, Montrose, Ouray
const BOULDER_BROOM  = ['013','014'];

const ROSTER = [
  { match: /^Catholic Charities of Southern Colorado$/i,           area: PUEBLO_DIOCESE,        label: 'Diocese of Pueblo' },
  { match: /^Catholic Charities of Central Colorado$/i,            area: COS_DIOCESE,           label: 'Diocese of Colorado Springs' },
  { match: /^Catholic Charities of Denver$/i,                      area: DENVER_METRO.concat(['013','014','059']), label: 'Archdiocese of Denver — Metro Denver counties' },
  { match: /^Catholic Charities of Northern Colorado$/i,           area: FRONT_RANGE_NORTH,     label: 'Northern Colorado (Larimer + Weld)' },
  { match: /^Pikes Peak United Way$/i,                             area: PIKES_PEAK,            label: 'Pikes Peak region' },
  { match: /^Lift-Up of Northwest Colorado$/i,                     area: NW_COLORADO,           label: 'Northwest Colorado' },
  { match: /^San Luis Valley Housing Coalition$/i,                 area: SLV,                   label: 'San Luis Valley' },
  { match: /^HomewardBound of the Grand Valley$/i,                 area: GRAND_VALLEY,          label: 'Grand Valley (Mesa County)' },
  { match: /^Grand Valley Catholic Outreach$/i,                    area: GRAND_VALLEY,          label: 'Grand Valley' },
  { match: /^Habitat for Humanity of Metro Denver$/i,              area: DENVER_METRO,          label: 'Metro Denver' },
  { match: /^Habitat for Humanity of the St\.? Vrain Valley$/i,    area: BOULDER_BROOM,         label: 'St. Vrain Valley (Boulder + Broomfield)' },
  { match: /^Habitat for Humanity of Colorado Springs$/i,          area: PIKES_PEAK,            label: 'Colorado Springs' },
  { match: /^Habitat for Humanity Pueblo$/i,                       area: ['101'],               label: 'Pueblo' },
  { match: /^Habitat for Humanity of La Plata County$/i,           area: ['067'],               label: 'La Plata County' },
  { match: /^Habitat for Humanity of the San Luis Valley$/i,       area: SLV,                   label: 'San Luis Valley' },
  { match: /^Housing Resources of Western Colorado$/i,             area: WEST_SLOPE,            label: 'Western Slope (Delta/Montrose/Ouray)' },
  { match: /^Mental Health Partners$/i,                            area: BOULDER_BROOM,         label: 'Boulder + Broomfield' },
  { match: /^Arapahoe\/Douglas Works!$/i,                          area: ['005','035','039'],   label: 'Arapahoe/Douglas/Elbert' },
  { match: /^Foothills United Way$/i,                              area: ['019','047','059','093'], label: 'Clear Creek/Gilpin/Jefferson/Park' },
  { match: /^NE Colorado Health/i,                                 area: ['075','087','095','115','121','125'], label: 'NE plains (Logan, Morgan, Phillips, Sedgwick, Washington, Yuma)' },
  { match: /^Boulder Shelter for the Homeless$/i,                  area: ['013'],               label: 'Boulder County' },
  { match: /^Aspen Hope Center$/i,                                 area: ['097'],               label: 'Pitkin County' },
  { match: /^Eagle Valley Behavioral Health$/i,                    area: ['037'],               label: 'Eagle County' },
  { match: /^Mile High United Way$/i,                              area: DENVER_METRO.concat(['013','014','059']),    label: 'Metro Denver' },
];

const STATEWIDE = [
  /^Housing Colorado$/i,
  /^Colorado Coalition for the Homeless$/i,
  /^Mercy Housing Mountain Plains$/i,
  /^Colorado Rural Housing Development Corp/i,
  /^Volunteers of America Colorado$/i,
];

function isStatewide(name) {
  return STATEWIDE.some(rx => rx.test(name));
}
function findRule(name) {
  return ROSTER.find(r => r.match.test(name));
}

const issues = [];
Object.entries(data).forEach(([key, entry]) => {
  if (!key.startsWith('county:08')) return;  // only audit county-level rows
  if (!entry || !Array.isArray(entry.advocacy)) return;
  const fips3 = key.slice(-3);
  entry.advocacy.forEach(a => {
    const rule = findRule(a.name);
    if (!rule) return;  // org not in our roster — skip
    if (!rule.area.includes(fips3)) {
      issues.push({
        key, name: a.name, expected: rule.label, fips: fips3
      });
    }
  });
});

if (!issues.length) {
  console.log('✓ Advocacy roster: no mismatches found across audited orgs.');
  process.exit(0);
}

console.log('✗ Advocacy roster mismatches:');
issues.forEach(i => {
  console.log(`  • ${i.key} (FIPS 08${i.fips}) has "${i.name}" — expected service area: ${i.expected}`);
});
console.log(`\n${issues.length} mismatch(es). Fix in scripts/fix-advocacy-mismatches.js or edit data/hna/local-resources.json directly.`);
process.exit(1);
