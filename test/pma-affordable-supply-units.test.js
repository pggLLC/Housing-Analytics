'use strict';
// Existing affordable supply counts AFFORDABLE units, counts a property that
// is in both feeds once, and discloses every departure from a plain sum.
// Each guard names what it must agree with: the source data field, the
// module constant, the CSV section, or the loaded data file's vintage.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const S = require('../js/market-analysis-supply.js');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const html = read('market-analysis.html');
const js = read('js/market-analysis.js');
const enh = read('js/market-analysis-enhancements.js');
const supplySrc = read('js/market-analysis-supply.js');
const chfa = JSON.parse(read('data/chfa-lihtc.json')).features;
const propsFile = JSON.parse(read('data/affordable-housing/properties.json')).properties;

// ── 1. Fixtures: restricted/assisted units first, total only as disclosed fallback.
const at = (lng, lat) => ({ type: 'Point', coordinates: [lng, lat] });
const lihtc = [
  { properties: { PROJECT: 'Benedict Park Place 4B', N_UNITS: 89, LI_UNITS: 62 }, geometry: at(-104.98, 39.75) },
  { properties: { PROJECT: 'Clyburn at Stableton', N_UNITS: 100, LI_UNITS: null }, geometry: at(-104.88, 39.76) },
  { properties: { PROJECT: 'Hud Schema Project', TOTAL_UNITS: '20' }, geometry: at(-105.2, 39.5) },
];
const other = [
  { property_name: 'Autumn Lake', total_units: 130, assisted_units: 64, lat: 40.39, lng: -105.07 },
  // Same building as the LIHTC "Clyburn at Stableton" (typo in one feed): duplicate.
  { property_name: 'Clyburn at Stapleton', total_units: 100, assisted_units: 100, lat: 39.76, lng: -104.88 },
  // Shares a name word but ~150 m away: kept (rule is conservative).
  { property_name: 'Clyburn Senior', total_units: 40, assisted_units: 40, lat: 39.76135, lng: -104.88 },
  // Same spot as Benedict Park Place but no distinctive shared word: kept.
  { property_name: 'Park Apartments', total_units: 30, assisted_units: 30, lat: 39.75, lng: -104.98 },
  { property_name: 'No Assisted Count', total_units: 50, assisted_units: null, lat: 38.0, lng: -104.0 },
];
const s = S.summarizeAffordableSupply(lihtc, other);
assert.strictEqual(s.lihtcCount, 3);
assert.strictEqual(s.lihtcUnits, 62 + 100 + 20, 'LIHTC counts LI_UNITS; N_UNITS/TOTAL_UNITS only when LI_UNITS is missing');
assert.strictEqual(s.lihtcUnitsFallbackCount, 2);
assert.strictEqual(s.duplicatesRemoved, 1, 'the Clyburn pair is one property');
assert.strictEqual(s.otherAssistedCount, 4);
assert.strictEqual(s.otherAssistedUnits, 64 + 40 + 30 + 50, 'other assisted counts assisted_units before total_units');
assert.strictEqual(s.otherAssistedUnitsFallbackCount, 1);
assert.strictEqual(s.unitsFallbackCount, 3);
assert.strictEqual(s.affordableCount, s.lihtcCount + s.otherAssistedCount);
assert.strictEqual(s.affordableUnitsKnown, s.lihtcUnits + s.otherAssistedUnits);
assert(/2 LIHTC projects[^]*1 other assisted project[^]*total units/.test(s.unitsFallbackReason), s.unitsFallbackReason);
assert(/^1 other assisted record is the same property as a LIHTC project/.test(s.duplicatesReason), s.duplicatesReason);
// Nothing to disclose → null reasons, zero counts (these ARE measured zeros).
const clean = S.summarizeAffordableSupply([lihtc[0]], [other[0]]);
assert.strictEqual(clean.unitsFallbackReason, null);
assert.strictEqual(clean.duplicatesReason, null);
assert.strictEqual(clean.duplicatesRemoved, 0);
// A record with no unit count at all is still unknown, not 0, and not a fallback.
const none = S.summarizeAffordableSupply([{ properties: { LI_UNITS: 0, N_UNITS: '' } }], []);
assert.strictEqual(none.lihtcUnits, null);
assert.strictEqual(none.unitsUnknownCount, 1);
assert.strictEqual(none.unitsFallbackCount, 0);

// ── 2. Agreement with the data files: every CHFA feature's unit figure is its
//    LI_UNITS whenever LI_UNITS is reported, and the scan is not vacuous.
let lessThanTotal = 0;
chfa.forEach((f) => {
  const p = f.properties;
  const li = S.reportedUnitCount(p.LI_UNITS);
  const u = S.lihtcAffordableUnits(f);
  if (li != null) {
    assert.strictEqual(u.units, li, p.PROJECT + ': units must equal LI_UNITS');
    if (li < S.reportedUnitCount(p.N_UNITS)) lessThanTotal += 1;
  } else {
    assert.strictEqual(u.fallback, u.units != null, p.PROJECT + ': fallback flagged');
  }
});
assert(lessThanTotal > 0, 'scan found CHFA projects whose LI_UNITS < N_UNITS');
let assistedLess = 0;
propsFile.forEach((p) => {
  const a = S.reportedUnitCount(p.assisted_units);
  if (a == null) return;
  assert.strictEqual(S.otherAssistedAffordableUnits(p).units, a, p.property_name + ': units must equal assisted_units');
  if (a < S.reportedUnitCount(p.total_units)) assistedLess += 1;
});
assert(assistedLess > 0, 'scan found other-assisted records whose assisted_units < total_units');
// Statewide de-dup against the same non-LIHTC filter the page applies.
const nonLihtc = propsFile.filter((p) => !(Array.isArray(p.program_type) && p.program_type.some((t) => /^lihtc/i.test(t))) &&
  p.lat != null && p.lng != null);
assert(js.includes("pt.some(function (t) { return /^lihtc/i.test(t); })"), 'test filter mirrors _nonLihtcPropsCache');
const statewide = S.removeLihtcDuplicates(chfa, nonLihtc);
assert(statewide.duplicatesRemoved > 0, 'rule finds real duplicates statewide');
assert(statewide.duplicatesRemoved < nonLihtc.length * 0.2, 'rule stays conservative (<20% of records)');
assert.strictEqual(statewide.kept.length + statewide.duplicatesRemoved, nonLihtc.length);

// ── 3. Agreement: the page wires every new disclosure through to the note.
assert(/summarizeAffordableSupply\(nearbyLihtc, nearbyOtherAssisted\)/.test(js), 'page summarizes the PMA-filtered sets');
[['affordableUnitsFallbackReason', 'unitsFallbackReason'], ['affordableDuplicatesReason', 'duplicatesReason'],
  ['affordableDuplicatesRemoved', 'duplicatesRemoved'], ['affordableUnitsFallbackCount', 'unitsFallbackCount']].forEach(([rk, sk]) => {
  assert(Object.prototype.hasOwnProperty.call(s, sk), 'summary exposes ' + sk);
  assert(js.includes(rk + ': supply.' + sk), 'result carries ' + rk + ' from supply.' + sk);
});
const noteBlock = js.match(/var unitsNote = el\('pmaAffordableUnitsNote'\);[^]*?unitsNote\.hidden/);
assert(noteBlock, 'renderer fills #pmaAffordableUnitsNote');
['affordableUnitsUnavailableReason', 'affordableUnitsFallbackReason', 'affordableDuplicatesReason'].forEach((k) =>
  assert(noteBlock[0].includes('result.' + k), 'units note shows ' + k));

// ── 4. Agreement: card heading = the CSV export's section name; the help
//    text's de-dup distance = the module constant; no exclusion is claimed
//    that the supply module does not perform.
const section = js.match(/\['SECTION', '(Existing Affordable Supply[^']*)'\]/);
assert(section, 'CSV has an existing-affordable-supply section');
const heading = html.match(/<h2[^>]*>([^<]*)<\/h2>\s*<details class="info-tooltip">\s*<summary title="What's counted in 'supply'\?"/);
assert(heading, 'supply card heading found');
assert.strictEqual(heading[1].toLowerCase(), section[1].toLowerCase(), 'card heading matches CSV section');
const help = html.slice(heading.index, html.indexOf('</details>', heading.index));
const dist = help.match(/within (\d+)\s*m\b/);
assert(dist && +dist[1] === S.DUPLICATE_MAX_METERS, 'help text de-dup distance equals DUPLICATE_MAX_METERS');
const claimsExpiryExclusion = /expir[^.]*\b(?:are|is) (?:<strong>)?excluded\b|(?<!nothing is )(?<!not )\bexcluded\b[^.]*expir/i.test(help);
const filtersExpiry = /years_to_expiration|restrictive_expiration|risk_status|ComplianceStatus/.test(supplySrc) ||
  /lihtcInBuffer[^]{0,400}(expir|Compliance)/.test(js);
assert(!claimsExpiryExclusion || filtersExpiry, 'help text claims an expiry exclusion the code does not perform');
assert(/LI_UNITS/.test(help) && /assisted<\/strong> units/.test(help), 'help names the unit fields counted');

// ── 5. Agreement: ACS vintage labels come from the loaded tract metrics.
const acsMeta = JSON.parse(read('data/market/acs_tract_metrics_co.json')).meta;
const fnSrc = js.match(/function _acsVintageLabel\(\) \{[^]*?\n  \}/);
assert(fnSrc, '_acsVintageLabel defined');
// eslint-disable-next-line no-new-func
const label = new Function('acsMetrics', fnSrc[0] + '; return _acsVintageLabel();')({ meta: acsMeta });
const v = parseInt(acsMeta.vintage, 10);
assert.strictEqual(label, 'ACS 5-Year ' + (v - 4) + '-' + v, 'label derives from meta.vintage');
assert.strictEqual(new Function('acsMetrics', fnSrc[0] + '; return _acsVintageLabel();')({ meta: {} }), null,
  'missing vintage → null, not a guessed year');
assert(/acs:\s+r\.acsVintageLabel \|\| _acsVintageLabel\(\)/.test(js), 'PMA export uses the derived label');
assert(/acsVintage:\s+\(result && result\.acsVintageLabel\) \|\| null/.test(enh), 'enhancements export uses the derived label');
assert(js.includes('acsVintageLabel: _acsVintageLabel()'), 'result carries acsVintageLabel');
assert(!/'ACS 5-Year \d{4}-\d{4}'|'ACS \d{4} 5-Year'/.test(js + enh), 'no hard-coded ACS vintage in the PMA export');

console.log('pma-affordable-supply-units: all assertions passed (statewide duplicates: ' +
  statewide.duplicatesRemoved + ' of ' + nonLihtc.length + ')');
