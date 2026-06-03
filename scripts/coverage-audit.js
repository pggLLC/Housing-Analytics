#!/usr/bin/env node
/**
 * coverage-audit.js — F144
 * =========================
 * Automated audit that surfaces where curated data is thin. Same logic
 * that would have caught Bank of the San Juans (F142) BEFORE the user
 * had to point it out manually.
 *
 * Writes data/coverage-report.json + prints a CLI summary. Exit
 * non-zero when any "critical" gap exists, so the script can gate CI
 * and prevent silent coverage backsliding.
 *
 * Categories audited:
 *   1. County-level employer rosters       — 25/64 covered after F142
 *   2. Place-level local-resources entries  — 68/482 covered
 *   3. Capital partner regional coverage    — every CO region should
 *      have ≥1 community bank
 *   4. Place curation (schools / hospitals) — flag major places missing
 *   5. Tax abatement coverage                — top 30 jurisdictions
 *   6. Local-PHA roster gap candidates       — places with 0 federal
 *      affordable housing records
 *
 * Run:        node scripts/coverage-audit.js
 * CI-friendly: node scripts/coverage-audit.js --strict
 *              (exits 1 on any critical gap)
 * JSON only:  node scripts/coverage-audit.js --json
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const jsonOnly = args.includes('--json');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
}

const out = {
  generated:        new Date().toISOString(),
  summary:          {},
  gaps:             [],
  critical_gaps:    [],
  per_category:     {}
};

function log() { if (!jsonOnly) console.log.apply(console, arguments); }

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
// Counties small enough that no top-employer landscape is worth curating
// (population < 5k or extremely rural; not flagged as critical gaps).
const TINY_COUNTIES = new Set(['053','111','079','091','017','021','023','025','027','033','039',
  '047','055','057','061','063','073','093','095','099','103','105','115','121','125']);

const lr = readJson('data/hna/local-resources.json');
const cp = readJson('data/capital-partners.json');
const ta = readJson('data/tax-abatement-inventory.json');
const centroids = (readJson('data/co-place-centroids.json').byGeoid) || {};

// ─────────────────────────────────────────────────────────────────────
// 1. County-level employer rosters
// ─────────────────────────────────────────────────────────────────────
log('\n── 1. County employer rosters ──');
const allCountyFips = Object.keys(CO_COUNTY_NAMES);
const countiesWithEmployers = allCountyFips.filter(f =>
  Array.isArray(lr['county:08' + f] && lr['county:08' + f].majorEmployers) &&
  lr['county:08' + f].majorEmployers.length > 0
);
const countiesMissing = allCountyFips.filter(f => !countiesWithEmployers.includes(f));
const countiesMissingNonTiny = countiesMissing.filter(f => !TINY_COUNTIES.has(f));

out.per_category.county_employers = {
  covered_count:  countiesWithEmployers.length,
  total_count:    allCountyFips.length,
  coverage_pct:   Math.round(100 * countiesWithEmployers.length / allCountyFips.length),
  missing_significant: countiesMissingNonTiny.map(f => ({
    fips: '08' + f, name: CO_COUNTY_NAMES[f]
  })),
  missing_tiny_skipped: countiesMissing.filter(f => TINY_COUNTIES.has(f)).length
};
log('  ' + countiesWithEmployers.length + '/' + allCountyFips.length +
    ' counties (' + out.per_category.county_employers.coverage_pct + '%) have curated employers');
log('  ' + countiesMissingNonTiny.length + ' non-tiny counties without curation:');
countiesMissingNonTiny.forEach(f => log('    - 08' + f + ' ' + CO_COUNTY_NAMES[f]));

if (countiesMissingNonTiny.length >= 8) {
  out.critical_gaps.push({
    category: 'county-employers',
    msg: countiesMissingNonTiny.length + ' significant CO counties lack curated employer rosters'
  });
}

// ─────────────────────────────────────────────────────────────────────
// 2. Place-level local-resources coverage
// ─────────────────────────────────────────────────────────────────────
log('\n── 2. Place-level local-resources ──');
const placeEntries = Object.keys(lr).filter(k => k.startsWith('place:'));
// Major CO places (incorporated cities/towns ≥ 5k pop, plus key resort towns).
// Approximation: places with name "city" or "town" and centroid present.
const allMajorPlaces = Object.entries(centroids).filter(([g, p]) =>
  p && p.name && /\b(city|town)\b/i.test(p.name)
).map(([g, p]) => ({ geoid: g, name: p.name }));

const missing = allMajorPlaces.filter(p => !lr['place:' + p.geoid]);
out.per_category.place_local_resources = {
  covered_count: placeEntries.length,
  major_places_total: allMajorPlaces.length,
  major_places_missing_count: missing.length,
  examples_missing: missing.slice(0, 20).map(p => ({ geoid: p.geoid, name: p.name }))
};
log('  ' + placeEntries.length + ' total place entries; ' + allMajorPlaces.length + ' major places exist');
log('  ' + missing.length + ' major places (city/town) without curated entry');
if (missing.length > 0) {
  log('  First 10 missing:');
  missing.slice(0, 10).forEach(p => log('    - ' + p.name + ' (' + p.geoid + ')'));
}

// ─────────────────────────────────────────────────────────────────────
// 3. Capital partner regional coverage
// ─────────────────────────────────────────────────────────────────────
log('\n── 3. Capital partner regional coverage ──');
const PARTNER_REGIONS = [
  { label: 'Denver Metro', match: /denver|metro|front range|state-?wide|colorado statewide|national/i },
  { label: 'Front Range North (Larimer/Weld/Boulder)', match: /front range|northern|larimer|weld|boulder|state-?wide|national/i },
  { label: 'Western Slope (Garfield/Eagle/Pitkin/Mesa/Delta/Montrose)', match: /western slope|state-?wide|national|western colorado|garfield|eagle|pitkin/i },
  { label: 'SW Colorado (La Plata/Archuleta/Montezuma)', match: /southwest|four corners|durango|la plata|archuleta|montezuma|san juan|state-?wide|national/i },
  { label: 'San Luis Valley', match: /san luis|SLV|state-?wide|national/i },
  { label: 'NE Plains (Logan/Morgan/Yuma)', match: /northeast|plains|state-?wide|national/i },
  { label: 'Colorado Springs / SE', match: /pikes peak|southern colorado|colorado springs|pueblo|state-?wide|national/i },
  { label: 'Mountain Resort (Vail/Aspen/Summit/Steamboat/Telluride)', match: /resort|mountain|vail|aspen|summit|steamboat|telluride|eagle|pitkin|state-?wide|national/i }
];
out.per_category.partner_regional_coverage = PARTNER_REGIONS.map(r => {
  const matches = cp.partners.filter(p => r.match.test(p.service_area || ''));
  return { label: r.label, partner_count: matches.length, partners: matches.map(p => p.name) };
});
PARTNER_REGIONS.forEach(r => {
  const e = out.per_category.partner_regional_coverage.find(x => x.label === r.label);
  log('  ' + e.label + ' — ' + e.partner_count + ' partner(s)');
  if (e.partner_count < 3) {
    out.gaps.push({ category: 'partner-region-thin', region: r.label, count: e.partner_count });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 4. Curation gaps on existing place entries
// ─────────────────────────────────────────────────────────────────────
log('\n── 4. Curation gaps on existing place entries ──');
const placesNoSchool   = placeEntries.filter(k => !lr[k].schoolDistrict).length;
const placesNoHospital = placeEntries.filter(k => !lr[k].hospital).length;
const placesNoEmployers = placeEntries.filter(k => !Array.isArray(lr[k].majorEmployers) || !lr[k].majorEmployers.length).length;
out.per_category.place_curation_gaps = {
  total_places:      placeEntries.length,
  missing_school_district: placesNoSchool,
  missing_hospital:        placesNoHospital,
  missing_employers:       placesNoEmployers
};
log('  ' + placeEntries.length + ' place entries total');
log('  ' + placesNoSchool   + ' lack schoolDistrict (' + Math.round(100*placesNoSchool/placeEntries.length) + '%)');
log('  ' + placesNoHospital + ' lack hospital (' + Math.round(100*placesNoHospital/placeEntries.length) + '%)');
log('  ' + placesNoEmployers+ ' lack majorEmployers (' + Math.round(100*placesNoEmployers/placeEntries.length) + '%)');

// ─────────────────────────────────────────────────────────────────────
// 5. Tax abatement coverage
// ─────────────────────────────────────────────────────────────────────
log('\n── 5. Tax abatement coverage ──');
const taJurisdictions = ta.jurisdictions.length;
const taPlaceKeys = new Set();
ta.jurisdictions.forEach(j => (j.geoKeys || []).forEach(k => taPlaceKeys.add(k)));
out.per_category.tax_abatement = {
  jurisdictions: taJurisdictions,
  places_covered: Array.from(taPlaceKeys).length
};
log('  ' + taJurisdictions + ' jurisdictions covering ' + taPlaceKeys.size + ' places');
log('  (smaller jurisdictions fall back to CRS §39-3-112.5 statewide baseline)');

// ─────────────────────────────────────────────────────────────────────
// 6. Local-PHA roster — places with 0 federal affordable but pop ≥1000
// ─────────────────────────────────────────────────────────────────────
log('\n── 6. Local-PHA roster candidates (gap-fill targets) ──');
let phaCandidatesCount = '(skipped — properties.json fetch not needed)';
try {
  const props = readJson('data/affordable-housing/properties.json').properties;
  const cityCounts = {};
  props.forEach(p => {
    const c = (p.city || '').toLowerCase().trim();
    if (c) cityCounts[c] = (cityCounts[c] || 0) + 1;
  });
  // Major CO places (incorporated) with 0 properties — candidates for
  // local-PHA roster curation if they have a known PBV operator.
  const candidates = allMajorPlaces.filter(p => {
    const cityNoSuffix = p.name.replace(/\s+(town|city|CDP)\s*$/i, '').toLowerCase().trim();
    return !cityCounts[cityNoSuffix];
  });
  out.per_category.pha_roster_candidates = {
    candidate_count: candidates.length,
    note: 'Places without ANY record in properties.json — may be PBV-local gap-fill candidates',
    examples: candidates.slice(0, 15).map(p => ({ geoid: p.geoid, name: p.name }))
  };
  phaCandidatesCount = candidates.length;
  log('  ' + candidates.length + ' major CO places have 0 affordable-housing records');
  log('  (candidates for local-PHA roster curation if they have known PBV operators)');
} catch (e) {
  log('  Skipped — properties.json read failed: ' + e.message);
}

// ─────────────────────────────────────────────────────────────────────
// Output
// ─────────────────────────────────────────────────────────────────────
out.summary = {
  county_employer_coverage_pct: out.per_category.county_employers.coverage_pct,
  place_entries:                placeEntries.length,
  major_places_uncurated:       missing.length,
  capital_partners:             cp.partners.length,
  tax_abatement_jurisdictions:  taJurisdictions,
  pha_roster_gap_candidates:    typeof phaCandidatesCount === 'number' ? phaCandidatesCount : null,
  critical_gap_count:           out.critical_gaps.length,
  general_gap_count:            out.gaps.length
};

const reportPath = path.join(ROOT, 'data/coverage-report.json');
fs.writeFileSync(reportPath, JSON.stringify(out, null, 2));

log('\n══════════════════════════════════════════════════════════════');
log('Summary:');
Object.entries(out.summary).forEach(([k, v]) => log('  ' + k.padEnd(32) + ' ' + v));
log('Wrote ' + reportPath);

if (jsonOnly) console.log(JSON.stringify(out, null, 2));

if (strict && out.critical_gaps.length > 0) {
  if (!jsonOnly) {
    console.log('\n✗ ' + out.critical_gaps.length + ' critical gap(s):');
    out.critical_gaps.forEach(g => console.log('  - ' + g.category + ': ' + g.msg));
  }
  process.exit(1);
}

process.exit(0);
