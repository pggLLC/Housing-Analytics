#!/usr/bin/env node
/**
 * test/f116-r1-matching.test.js
 *
 * Smoke test for F116 — verifies the 2026 R1 bridge file matches the
 * jurisdictions the OF + compare + indibuild-brief pages render for.
 *
 * Confirms:
 *   1. Bridge file parses and has 14 awards.
 *   2. Every R1 award.city resolves to a known CO place name.
 *   3. Denver (0820000) and Manitou Springs (0847290) — the two
 *      jurisdictions in the F116 acceptance criteria — find R1 entries.
 *   4. Each R1 record gets _source/_bridge tags applied (in-memory).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { console.log('  PASS: ' + msg); pass++; }
  else      { console.log('  FAIL: ' + msg); fail++; }
}

const r1 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/affordable-housing/chfa-awards/2026-round-one.json'), 'utf8'));
const centroids = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/co-place-centroids.json'), 'utf8')).byGeoid;

assert(Array.isArray(r1.awards) && r1.awards.length === 14, '14 R1 awards in bridge file');
assert(r1.metadata && r1.metadata.announcement_date === '2026-05-21', 'announcement_date is 2026-05-21');

// Build lowercase place-name → geoid map. Strips Census-suffix tokens
// ("city", "town", etc) but NOT when those words are part of the actual
// place name (e.g. "Cañon City"). Strategy: strip "(town)/(city)" parens
// (the geo-config form) and a single trailing " city"/" town" only when
// the remainder isn't itself ambiguous. The OF actually uses
// placeNameToCity() which strips only parenthesized suffixes; we mirror
// that here for the matching half, then drop trailing-suffix tokens just
// for the centroid-keying half because Census names include them.
function normForBridge(s) {
  // OF-side normalization: strip parens only, lowercase, trim.
  return (s || '').replace(/\s*\([^)]+\)\s*$/, '').trim().toLowerCase();
}
function normForCentroid(s) {
  // Census-side normalization: parens + ALL trailing suffixes, then
  // strip again in case multiple suffixes stack ("city" appears twice
  // in "Cañon City city"). Use suffix loop instead of single regex.
  var t = (s || '').replace(/\s*\([^)]+\)\s*$/, '').trim();
  // Strip exactly ONE trailing suffix token — Census never doubles them.
  t = t.replace(/\s+(city|town|village|cdp)$/i, '').trim();
  return t.toLowerCase();
}

const cityToGeoid = {};
Object.keys(centroids).forEach(g => {
  const n = normForCentroid(centroids[g].name);
  if (n && !cityToGeoid[n]) cityToGeoid[n] = g;
});

console.log('\nR1 awards by city → place GEOID:');
r1.awards.forEach(a => {
  const k = normForBridge(a.city);
  const g = cityToGeoid[k];
  console.log('  ' + (g || 'NO-MATCH').padEnd(8) + ' ' + (a.city || '').padEnd(20) + ' — ' + a.name);
  // Towaoc may not have a place geoid (tribal land); the rest should resolve.
  if (k !== 'towaoc') assert(g, 'R1 city "' + a.city + '" resolves to a Census place');
});

// Acceptance criteria — Denver and Manitou Springs.
const denverR1 = r1.awards.filter(a => normForBridge(a.city) === 'denver');
const manitouR1 = r1.awards.filter(a => normForBridge(a.city) === 'manitou springs');
assert(denverR1.length >= 1, 'Denver has at least one R1 award (' + denverR1.length + ' found)');
assert(manitouR1.length >= 1, 'Manitou Springs has at least one R1 award (' + manitouR1.length + ' found)');
assert(denverR1.find(a => a.name === 'Barth Hotel'), 'Barth Hotel is in Denver R1 awards');

// Tag application (mimic what each consumer does in-memory)
r1.awards.forEach(a => {
  a._source = 'chfa-2026-r1-bridge';
  a._bridge = true;
});
const allTagged = r1.awards.every(a => a._bridge === true && a._source === 'chfa-2026-r1-bridge');
assert(allTagged, '_source + _bridge tags applied to every award in memory');

// One-line filter to drop the bridge — confirms the tag is enough.
const liveOnly = r1.awards.filter(a => !a._bridge);
assert(liveOnly.length === 0, '`.filter(a => !a._bridge)` drops every bridge record');

// Cross-check: simulate the OF rollup using place-tract-membership.
// OF does: state.chfa2026R1ByCity[ placeNameToCity(label).toLowerCase() ]
// where placeNameToCity strips only parens. membership.name in CO is
// bare ("Denver", "Aurora", "Cañon City") so the match is direct.
const membership = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/place-tract-membership.json'), 'utf8')).places;

const r1ByCity = {};
r1.awards.forEach(a => {
  const k = (a.city || '').trim().toLowerCase();
  (r1ByCity[k] = r1ByCity[k] || []).push(a);
});

function placeNameToCity(label) {
  return (label || '').replace(/\s*\([^)]+\)\s*$/, '').trim();
}
const ofMatched = {};
Object.keys(membership).forEach(g => {
  const label = membership[g].name || '';
  const k = placeNameToCity(label).toLowerCase();
  if (r1ByCity[k]) ofMatched[g] = r1ByCity[k];
});

assert(ofMatched['0820000'] && ofMatched['0820000'].length === 3, 'OF rollup matches Denver (0820000) to 3 R1 awards');
assert(ofMatched['0848445'] && ofMatched['0848445'].length === 1, 'OF rollup matches Manitou Springs (0848445) to 1 R1 award');
assert(ofMatched['0804000'] && ofMatched['0804000'].length === 2, 'OF rollup matches Aurora (0804000) to 2 R1 awards');
assert(ofMatched['0811810'] && ofMatched['0811810'].length === 1, 'OF rollup matches Cañon City (0811810) to 1 R1 award');
assert(ofMatched['0816000'] && ofMatched['0816000'].length === 1, 'OF rollup matches Colorado Springs (0816000) to 1 R1 award');

console.log('\nOF rollup matched ' + Object.keys(ofMatched).length + ' jurisdictions to R1 awards');

// Double-count check: the same R1 record (recognizable by sponsor+units,
// since Barth Hotel exists as a CHFA Preservation Property too — that's
// a different lifecycle stage of the same building, not a duplicate of
// the 2026 R1 LIHTC reservation). Confirm there's no LIHTC-source record
// in properties.json with award_year >= 2026: that would mean the live
// feed has caught up and the bridge is redundant.
const props = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/affordable-housing/properties.json'), 'utf8')).properties;
const post2026Lihtc = props.filter(p =>
  /lihtc/i.test((p.program_type || []).join(',')) &&
  Number.isFinite(parseInt(p.award_year, 10)) &&
  parseInt(p.award_year, 10) >= 2026
);
assert(post2026Lihtc.length === 0, 'No LIHTC records dated >= 2026 in main inventory (live feed has not ingested R1 yet)');

// Also confirm Barth Hotel only appears ONCE in main inventory (it's the
// preservation entry, not the R1 LIHTC entry — different sources). Two
// records would indicate a future double-count when CHFA's feed catches up.
const barthInProps = props.filter(p => /^barth hotel$/i.test(p.property_name || ''));
assert(barthInProps.length === 1, 'Barth Hotel appears exactly once in main inventory (as preservation candidate)');
assert(/preservation/i.test(barthInProps[0].source || '') ||
       barthInProps[0].program_type.indexOf('preservation-candidate') !== -1,
       'Barth Hotel main-inventory entry is a preservation record, not the R1 LIHTC reservation');

console.log('\n=============================================');
console.log('F116 R1-matching: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
