'use strict';

/**
 * Guards for the place-vs-county comparison.
 *
 * The comparison exists because a county average hides its own spread: Boulder
 * County reports 31.2% severe renter burden while containing Louisville at
 * 18.7% and Boulder city at 41.0%. Getting that wrong in the other direction —
 * showing a comparison that is not really a comparison — would be worse than
 * showing nothing, so most of these tests are about what must NOT be compared.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const C = require('../js/hna/county-comparison.js');
const ROOT = path.resolve(__dirname, '..');
const DIGESTS = path.join(ROOT, 'data/hna/jurisdiction-metrics-digest');

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}
const load = (g) => JSON.parse(fs.readFileSync(path.join(DIGESTS, g + '.json'), 'utf8'));

console.log('hna-county-comparison');

run('a real place compares against its real containing county', () => {
  const place = load('0807850');                       // Boulder (city)
  const county = load(C.containingCountyOf(place));    // Boulder County
  const r = C.compare(place, county);
  assert.equal(r.available, true);
  assert.equal(r.county.geoid, '08013');
  assert.ok(r.rows.length >= 6, 'expected a useful set of rows, got ' + r.rows.length);
  const burden = r.rows.find((x) => x.key === 'pct_cost_burdened');
  assert.equal(burden.place.value, 63.4);
  assert.equal(burden.county.value, 56.8);
  assert.equal(burden.delta, 6.6);
  assert.equal(burden.higher, 'place');
  assert.equal(C.describeDelta(burden), 'worse than the county');
});

run('the spread the comparison exists to show is real', () => {
  // Same county, opposite readings — if this ever collapses, the feature is
  // pointless and something upstream has flattened the data.
  const county = load('08013');
  const hi = C.compare(load('0807850'), county).rows.find((r) => r.key === 'pct_renter_severe_burdened');
  const lo = C.compare(load('0846355'), county).rows.find((r) => r.key === 'pct_renter_severe_burdened');
  assert.equal(hi.higher, 'place', 'Boulder city is worse than its county');
  assert.equal(lo.higher, 'county', 'Louisville is better than the same county');
  assert.ok(Math.abs(hi.place.value - lo.place.value) > 15,
    'two towns in one county should differ substantially');
});

run('levels are never compared — only rates', () => {
  const place = load('0807850');
  const r = C.compare(place, load('08013'));
  for (const row of r.rows) {
    const m = place.metrics[row.key];
    assert.ok(m.denominator_key,
      row.key + ' has no denominator and must not be compared: a town always has ' +
      'fewer households than its county, so the delta would be arithmetic, not information');
  }
  // housing_gap_units is the tempting one — a big, quotable count.
  assert.equal(C.comparable(place.metrics.housing_gap_units, load('08013').metrics.housing_gap_units),
    'not a rate — levels scale with population and do not compare');
});

run('a value is never compared with itself', () => {
  const place = load('0807850');
  const county = load('08013');
  const masked = JSON.parse(JSON.stringify(place));
  // Simulate a place metric that is really the county's figure.
  masked.metrics.pct_cost_burdened.geography_level = 'county';
  masked.metrics.pct_cost_burdened.value = county.metrics.pct_cost_burdened.value;
  const r = C.compare(masked, county);
  assert.ok(!r.rows.some((x) => x.key === 'pct_cost_burdened'),
    'a county figure shown for a place must not appear as a 0-point delta');
  assert.ok(r.skipped.some((s) => /nothing to compare/.test(s.reason)),
    'and the reason must be stated, not silently dropped');
});

run('an unreliable denominator is excluded', () => {
  const place = JSON.parse(JSON.stringify(load('0807850')));
  place.metrics.pct_cost_burdened.denominator_floor_applied = true;
  const r = C.compare(place, load('08013'));
  assert.ok(!r.rows.some((x) => x.key === 'pct_cost_burdened'));
  assert.ok(r.skipped.some((s) => /reliability floor/.test(s.reason)));
});

run('a null value never renders as zero', () => {
  // Number(null) === 0 and isFinite(null) is true — the trap behind #1480.
  const place = JSON.parse(JSON.stringify(load('0807850')));
  place.metrics.pct_cost_burdened.value = null;
  const r = C.compare(place, load('08013'));
  assert.ok(!r.rows.some((x) => x.key === 'pct_cost_burdened'),
    'a null metric must be skipped, not compared as 0.0%');
});

run('a county is not compared with itself, and statewide has nothing above it', () => {
  const county = load('08013');
  const r = C.compare(county, county);
  assert.equal(r.available, false);
  assert.match(r.reason, /cannot be compared with itself/);
});

run('a value judgement is only offered where the data supports one', () => {
  const r = C.compare(load('0807850'), load('08013'));
  const renters = r.rows.find((x) => x.key === 'pct_renters');
  assert.equal(C.describeDelta(renters), null,
    'a higher renter share is not better or worse — it must not be labelled');
});

run('every place in the dataset produces a usable comparison', () => {
  const files = fs.readdirSync(DIGESTS).filter((f) => f.endsWith('.json'));
  let places = 0, compared = 0;
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(DIGESTS, f), 'utf8'));
    const g = d.geography || {};
    if (g.type !== 'place' && g.type !== 'cdp') continue;
    places += 1;
    const cty = C.containingCountyOf(d);
    if (!cty || !fs.existsSync(path.join(DIGESTS, cty + '.json'))) continue;
    const r = C.compare(d, load(cty));
    if (r.available) compared += 1;
    for (const row of r.rows) {
      assert.ok(Number.isFinite(row.delta), f + ' produced a non-finite delta for ' + row.key);
      assert.doesNotMatch(C.formatDelta(row.delta), /NaN|undefined/, f + ' formats badly');
    }
  }
  assert.ok(places > 400, 'expected the full place set, saw ' + places);
  // 427 of 482 compare. The other 55 are excluded solely because their
  // denominators fall below the reliability floor — small towns where a rate
  // over a handful of households would be precise-looking noise. That is the
  // guard working, so the bar is set to catch a real regression (a parsing or
  // lookup break would collapse this far below 85%) rather than to demand
  // coverage the data cannot honestly support.
  assert.ok(compared / places > 0.85,
    'only ' + compared + ' of ' + places + ' places produced a comparison');
});

run('a jurisdiction too small to compare is told why', () => {
  const files = fs.readdirSync(DIGESTS).filter((f) => f.endsWith('.json'));
  let checked = 0;
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(DIGESTS, f), 'utf8'));
    const g = d.geography || {};
    if (g.type !== 'place' && g.type !== 'cdp') continue;
    const cty = C.containingCountyOf(d);
    if (!cty || !fs.existsSync(path.join(DIGESTS, cty + '.json'))) continue;
    const r = C.compare(d, load(cty));
    if (r.available) continue;
    checked += 1;
    // Every exclusion must be the reliability floor, and must say so — a
    // silent or vague empty state is the failure mode this project keeps
    // correcting.
    assert.ok(r.reason, f + ' gives no reason for an empty comparison');
    assert.match(r.reason, /too small for a reliable rate comparison/,
      f + ' excluded for an unexpected reason: ' + r.reason);
  }
  assert.ok(checked > 20, 'expected a meaningful number of small places, saw ' + checked);
});

run('the page wires the panel and the glossary leaves table headers alone', () => {
  const html = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');
  assert.match(html, /county-comparison\.js/, 'the comparison module is loaded');
  assert.match(html, /county-comparison-view\.js/, 'the view is loaded');
  assert.match(html, /id="countyComparisonSection"[^>]*hidden/, 'the section starts hidden');
  const glossary = fs.readFileSync(path.join(ROOT, 'js/glossary.js'), 'utf8');
  assert.match(glossary, /input, abbr, th'\)/,
    'TH must be skipped by the glossary auto-linker, or definitions garble table labels');
});

if (failures) { console.error('hna-county-comparison: FAIL'); process.exitCode = 1; }
else console.log('hna-county-comparison: PASS');
