'use strict';

// A suppressed ACS median is null, never $0 — at the builder, in the PMA
// buffer average, and in what the page and its exports show.
//
// Found 2026-09-26: scripts/market/build_public_market_data.py ran the ACS
// median rent and median income through safe_int(), which turns the Census
// suppression sentinels (-666666666, ...) and empty cells into 0. 98
// Colorado tracts carry median_gross_rent 0 — Denver 08031001000 among them,
// with 888 renter households. aggregateAcs() in js/market-analysis.js then
// averaged those zeros in (`m.median_gross_rent || 0`), pulling a Denver
// buffer's median rent from $1,779 to $1,759 with nothing on screen to say so.
//
// The builder needs the Census API, so data/market/acs_tract_metrics_co.json
// still carries the old zeros until its next scheduled rebuild. The
// aggregator therefore treats a 0 median exactly like null. The checks below
// run against the COMMITTED file, so they hold before and after that rebuild.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const maSrc = fs.readFileSync(path.join(ROOT, 'js/market-analysis.js'), 'utf8');
const renderSrc = fs.readFileSync(path.join(ROOT, 'js/market-analysis/market-report-renderers.js'), 'utf8');
const tracts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/market/acs_tract_metrics_co.json'), 'utf8')).tracts;

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

function extract(name) {
  const m = maSrc.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}'));
  assert(m, name + '() is gone from js/market-analysis.js');
  return new Function(m[0] + '; return ' + name + ';')();
}

const aggregateAcs = extract('aggregateAcs');
const idx = {};
tracts.forEach((t) => { idx[t.geoid] = t; });
const suppressed = (v) => v == null || !(Number(v) > 0);

console.log('\nA suppressed ACS median is null, never $0');

test('the scan has something to check: the committed file has tracts, some with no published median rent', () => {
  // Non-vacuity on the scan. After the builder fix is rebuilt this count
  // is of nulls rather than zeros; either way it must be found.
  assert(tracts.length > 1000, 'only ' + tracts.length + ' tracts');
  assert(tracts.some((t) => suppressed(t.median_gross_rent)), 'no suppressed median rent found to test against');
});

test('the builder writes null for a suppressed or sentinel median, and keeps a real one', () => {
  // Drives build_acs_metrics() with a stubbed Census response, so this is
  // the builder's own code path, not a copy of it.
  const py = `
import json, sys, importlib.util
spec = importlib.util.spec_from_file_location("b", "scripts/market/build_public_market_data.py")
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
hdr = list(b.ACS_VARIABLES) + ["state", "county", "tract"]
def row(rent, inc, tract):
    r = ["100"] * len(b.ACS_VARIABLES) + ["08", "031", tract]
    r[hdr.index("B25064_001E")] = rent
    r[hdr.index("B19013_001E")] = inc
    return r
rows = [hdr, row("-666666666", "49549", "001000"), row(None, "-888888888", "001001"), row("0", "", "001002"), row("1450", "61000", "001003")]
b.fetch_url = lambda *a, **k: json.dumps(rows)
out = b.build_acs_metrics({})
print(json.dumps([[t["median_gross_rent"], t["median_hh_income"]] for t in out["tracts"]]))
`;
  const got = JSON.parse(execFileSync('python3', ['-c', py], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').pop());
  assert.deepStrictEqual(got, [[null, 49549], [null, null], [null, null], [1450, 61000]],
    'builder medians: ' + JSON.stringify(got));
});

test('the buffer average leaves suppressed tracts out and counts them (Denver County)', () => {
  const denver = tracts.filter((t) => t.geoid.startsWith('08031')).map((t) => ({ geoid: t.geoid }));
  const agg = aggregateAcs(denver, idx);
  const pub = tracts.filter((t) => t.geoid.startsWith('08031') && !suppressed(t.median_gross_rent));
  const want = pub.reduce((s, t) => s + Number(t.median_gross_rent), 0) / pub.length;
  assert(denver.length > pub.length, 'Denver has no suppressed tract to exclude');
  assert(Math.abs(agg.median_gross_rent - want) < 1e-6,
    `buffer median rent ${agg.median_gross_rent} is not the mean over the ${pub.length} tracts with a published median (${want})`);
  assert.strictEqual(agg.median_gross_rent_excluded_tracts, denver.length - pub.length,
    'the excluded-tract count does not match the tracts left out');
});

test('the Denver tract with 888 renter households and no published rent does not pull the average down', () => {
  const t = idx['08031001000'];
  assert(t && suppressed(t.median_gross_rent), '08031001000 no longer has a suppressed median rent; pick another fixture');
  const neighbour = tracts.find((x) => x.geoid.startsWith('08031') && !suppressed(x.median_gross_rent));
  const agg = aggregateAcs([{ geoid: '08031001000' }, { geoid: neighbour.geoid }], idx);
  assert.strictEqual(agg.median_gross_rent, Number(neighbour.median_gross_rent),
    `a two-tract buffer reads $${agg.median_gross_rent}, not the one published median $${neighbour.median_gross_rent}`);
  assert.strictEqual(agg.median_gross_rent_excluded_tracts, 1);
  assert.strictEqual(agg.renter_hh, t.renter_hh + neighbour.renter_hh, 'the suppressed tract\'s renters must still count');
});

test('a buffer with no published median reads null, not $0', () => {
  const agg = aggregateAcs([{ geoid: 'x' }], { x: { geoid: 'x', renter_hh: 10, median_gross_rent: null, median_hh_income: 0 } });
  assert.strictEqual(agg.median_gross_rent, null);
  assert.strictEqual(agg.median_hh_income, null);
  assert.strictEqual(agg.median_hh_income_excluded_tracts, 1);
});

test('rent pressure is excluded, not scored as zero pressure, when there is no rent', () => {
  // The page's own wrapper (js/market-analysis-scoring.js is hash-pinned by
  // test/pma-scoring.test.js, so the guard lives in market-analysis.js).
  const PMAScoring = require(path.join(ROOT, 'js/market-analysis-scoring.js'));
  const m = maSrc.match(/function scoreRentPressure\([\s\S]*?\n  \}/);
  assert(m, 'scoreRentPressure() is gone from js/market-analysis.js');
  const scoreRentPressure = new Function('PMAScoring', m[0] + '; return scoreRentPressure;')(PMAScoring);
  const r = scoreRentPressure({ median_gross_rent: null }, 95000);
  assert.strictEqual(r.unavailable, true, 'no rent scored as ' + r.score);
  assert.strictEqual(r.score, null);
  assert(/suppressed/.test(r.unavailableReason), 'no reason carried: ' + r.unavailableReason);
  assert.strictEqual(scoreRentPressure({ median_gross_rent: 1500 }, 95000).unavailable, false);
});

test('what is shown discloses the exclusion, and the renter count is not coerced', () => {
  // The count the aggregator returns is the count the page renders.
  assert(/med_gross_rent_excluded_tracts:\s*acs\.median_gross_rent_excluded_tracts/.test(maSrc),
    'the excluded-tract count is not handed to the report renderer');
  assert(/_suppressedMedianNote\(acs\)/.test(renderSrc) && /acs\.med_gross_rent_excluded_tracts/.test(renderSrc),
    'the Market Demand card no longer discloses suppressed tracts');
  assert(/\['median_gross_rent_excluded_tracts', r\.acs\.median_gross_rent_excluded_tracts/.test(maSrc),
    'the CSV export no longer carries the excluded-tract count');
  assert(!/pmaRenterHh', \(result\.acs\.renter_hh \|\| 0\)/.test(maSrc), 'pmaRenterHh coerces a missing count to 0');
  assert(!/median_gross_rent\s*\|\|\s*0/.test(maSrc) && !/median_hh_income\s*\|\|\s*0/.test(maSrc),
    'a median is coerced with || 0 again');
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed ✅');
process.exit(failures ? 1 : 0);
