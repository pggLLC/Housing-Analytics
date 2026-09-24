#!/usr/bin/env node
// test/hna-strip-digest-evidence.test.js
//
// The HNA decision strip must not out-claim the Recommendation page. For
// Cattle Creek (CDP, 396 people) the strip read "Affordability pressure
// 100.0% — High" and "Data confidence: High" while the Recommendation, from
// the same digest, called the rent-burden measure unusable (2026-09-24).
//  - the strip defers to the digest's grade of pct_cost_burdened, applied at
//    the end of update() so no renderer overwrites it;
//  - the predicate is the digest's own reading, exercised here on the
//    committed digests: Cattle Creek unusable, Fruita usable;
//  - the tile that grades the OWNERSHIP section's data says so in its label.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const src = read('js/hna/hna-controller.js');

// Pull the pure predicate out of the IIFE and evaluate it on its own.
const fnSrc = /function _rentBurdenEvidence\(metric\) \{[\s\S]*?\n  \}/.exec(src);
assert.ok(fnSrc, '_rentBurdenEvidence is defined');
const rentBurdenEvidence = new Function(fnSrc[0] + '; return _rentBurdenEvidence;')();
const digest = (geoid) => JSON.parse(read('data/hna/jurisdiction-metrics-digest/' + geoid + '.json')).metrics.pct_cost_burdened;

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

console.log('hna-strip-digest-evidence');

run('the predicate reads the committed digests the way the Recommendation does', () => {
  const cattleCreek = rentBurdenEvidence(digest('0812470'));
  assert.equal(cattleCreek.usable, false, 'Cattle Creek: a low-confidence rate is not evidence');
  assert.match(cattleCreek.why, /low-confidence rate on 81 renter households/);
  const fruita = rentBurdenEvidence(digest('0828745'));
  assert.equal(fruita.usable, true, 'Fruita: usable');
  const mesa = rentBurdenEvidence(digest('08077'));
  assert.equal(mesa.usable, true, 'Mesa County: usable');
  assert.equal(rentBurdenEvidence({ value: 40, confidence: 'high', denominator: 30, denominator_floor_applied: true }).usable, false, 'the floor overrides a confident-looking rate');
  assert.equal(rentBurdenEvidence({ value: null, confidence: 'missing' }).usable, false, 'missing is not evidence');
  assert.equal(rentBurdenEvidence(null), null, 'no metric, no verdict');
});

run('across all committed digests the rule is the digest\'s own grade: big counties usable, tiny ones not', () => {
  const dir = path.join(ROOT, 'data', 'hna', 'jurisdiction-metrics-digest');
  const registry = JSON.parse(read('data/hna/geography-registry.json')).geographies;
  const name = (g) => (registry.find((r) => r.geoid === g) || {}).name || g;
  const files = fs.readdirSync(dir).filter((f) => /^\d{5}\.json$|^\d{7}\.json$/.test(f));
  let flaggedPlaces = 0, places = 0; const flaggedCounties = [];
  for (const f of files) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).metrics.pct_cost_burdened;
    const ev = rentBurdenEvidence(m);
    if (f.length === 12) { places += 1; if (ev && !ev.usable) flaggedPlaces += 1; }
    else if (ev && !ev.usable) flaggedCounties.push(name(f.slice(0, 5)) + ' (' + m.denominator + ' renter HH)');
  }
  assert.ok(places > 400, 'scan saw the place digests (' + places + ')');
  assert.ok(flaggedPlaces > 50, 'a real share of places is low-evidence (' + flaggedPlaces + ')');
  for (const g of ['08031', '08041', '08005', '08077']) {
    assert.equal(rentBurdenEvidence(digest(g)).usable, true, name(g) + ' is usable');
  }
  assert.equal(rentBurdenEvidence(digest('08053')).usable, false, 'Hinsdale County (5.3% on 122 renter households) is not');
  assert.ok(flaggedCounties.length <= 12, 'only the smallest counties are flagged: ' + flaggedCounties.join(', '));
});

run('update() applies the digest verdict to the affordability tile after every renderer', () => {
  const updateStart = src.indexOf('  async function update(){');
  const snapshot = src.indexOf('window.HNARenderers.renderSnapshot(', updateStart);
  const apply = src.indexOf('await _applyDigestEvidenceToStrip(geoid)', updateStart);
  const announce = src.indexOf('__announceUpdate(`Data loaded for', updateStart);
  assert.ok(snapshot > updateStart && apply > snapshot && announce > apply, 'order: snapshot render → digest verdict → completion announcement');
  assert.match(src, /updateDecisionStrip\(\{ affordability: \{ read: 'Low evidence — ' \+ ev\.why, tone: 'unavailable' \} \}\)/, 'an unusable rate reads as low evidence with the unavailable tone');
});

run('the tile that grades the ownership section is labelled as such on every HNA page', () => {
  for (const p of ['housing-needs-assessment.html', ...fs.readdirSync(ROOT).filter((f) => /^hna-.*\.html$/.test(f))]) {
    const html = read(p);
    if (!html.includes('data-decision-key="confidence"')) continue;
    assert.match(html, /data-decision-key="confidence">\s*<span class="hna-decision-label">Ownership data<\/span>/, p + ': the ownership-data tile is not called "Data confidence"');
  }
});

if (failures) { console.error('hna-strip-digest-evidence: FAIL'); process.exitCode = 1; }
else console.log('hna-strip-digest-evidence: PASS');
