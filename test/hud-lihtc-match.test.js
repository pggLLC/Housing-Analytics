'use strict';

/**
 * HUD LIHTC database fields on CHFA's records.
 *
 * data/hud-lihtc-co-match.json pairs CHFA records with HUD's LIHTC database
 * (built offline by scripts/hud/build_hud_lihtc_match.py, because huduser.gov
 * refuses automated downloads) and scripts/fetch-chfa-lihtc.js copies the
 * pair's nonprofit-sponsor and basis-boost values onto data/chfa-lihtc.json.
 *
 * Guards: each pair still names the same project; one HUD project never feeds
 * two CHFA records; unmatched records stay null rather than guessed; and HUD's
 * QCT/DDA flags, which use the placed-in-service year's list, never reach the
 * QCT/DDA columns, where a reader takes them as the designation that set the
 * deal's boost (that turns on the list in force at allocation).
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const match = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hud-lihtc-co-match.json'), 'utf8'));
const feed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'chfa-lihtc.json'), 'utf8'));
const features = feed.features || [];

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

console.log('hud-lihtc-match');

const byId = new Map(features.map((f) => [String(f.properties.CHFA_RecordID), f.properties]));
const records = match.records || {};

run('the match file names its source and counts its records', () => {
  assert.equal(match.source.label, 'HUD LIHTC database');
  assert.match(match.source.url, /^https:\/\/www\.huduser\.gov\//);
  assert.match(match.source.downloaded, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Number.isInteger(match.source.placed_in_service_through));
  assert.equal(match.matched, Object.keys(records).length);
});

run('every CHFA record carries its CHFA record id, once', () => {
  assert.ok(features.length > 0);
  assert.equal(byId.size, features.length, 'CHFA_RecordID is missing or repeated');
});

run('each pair still names the same CHFA project', () => {
  for (const [id, m] of Object.entries(records)) {
    const p = byId.get(id);
    assert.ok(p, 'match file names CHFA record ' + id + ', which the feed no longer has');
    assert.equal(p.PROJECT, m.chfa_project, 'CHFA record ' + id + ' was renamed since the match');
  }
});

run('one HUD project never feeds two CHFA records', () => {
  const seen = new Map();
  for (const [id, m] of Object.entries(records)) {
    assert.ok(!seen.has(m.hud_id), m.hud_id + ' is matched to ' + seen.get(m.hud_id) + ' and ' + id);
    seen.set(m.hud_id, id);
  }
});

run('matched records carry HUD values; unmatched records stay unknown', () => {
  let applied = 0;
  for (const f of features) {
    const p = f.properties;
    const m = records[String(p.CHFA_RecordID)];
    assert.ok([0, 1, null].includes(p.NON_PROF), p.PROJECT + ': NON_PROF ' + p.NON_PROF);
    if (!m) {
      assert.equal(p.NON_PROF, null, p.PROJECT + ' has no HUD match but a NON_PROF value');
      assert.equal(p.HUD, undefined, p.PROJECT + ' has no HUD match but HUD fields');
      continue;
    }
    applied += 1;
    const yn = (c) => (c === 1 ? 1 : c === 2 ? 0 : null);
    assert.equal(p.NON_PROF, yn(m.non_prof), p.PROJECT + ': NON_PROF');
    assert.equal(p.HUD.basis, yn(m.basis), p.PROJECT + ': basis');
    assert.equal(p.HUD.hud_id, m.hud_id);
  }
  assert.equal(applied, Object.keys(records).length,
    'every match should be applied — rerun node scripts/fetch-chfa-lihtc.js');
});

run('HUD placed-in-service QCT/DDA flags never fill the QCT/DDA columns', () => {
  for (const f of features) {
    const p = f.properties;
    assert.equal(p.QCT, null, p.PROJECT + ': QCT filled');
    assert.equal(p.DDA, null, p.PROJECT + ': DDA filled');
  }
});

if (failures) {
  console.error('\n' + failures + ' hud-lihtc-match guard(s) failed');
  process.exit(1);
}
console.log('  all hud-lihtc-match guards passed');
