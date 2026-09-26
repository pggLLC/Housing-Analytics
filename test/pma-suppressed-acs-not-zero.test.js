'use strict';

// A median the Census did not publish is unavailable, never $0 — in the tract
// builder, in the PMA average, in the rent-pressure score, on screen and in
// the exports.
//
// Found 2026-09-26: scripts/market/build_public_market_data.py ran median
// rent and median income through safe_int(), which turns the Census
// suppression sentinels (-666666666, ...) and empty cells into 0. The
// committed tract file carries 98 tracts with median_gross_rent 0 and 24 with
// median_hh_income 0. aggregateAcs() in js/market-analysis.js averaged those
// zeros in over every tract, and a PMA with no published rent scored "no rent
// pressure" (ratio 0) instead of leaving the dimension out.
//
// The builder needs the Census API, so the committed file keeps its zeros
// until the next scheduled rebuild; the aggregator treats a 0 median exactly
// like null, and the checks below hold for both.
//
// Everything here runs the production code: the builder through a stubbed
// Census response, and js/market-analysis.js, its report renderer and the
// money formatter loaded together in jsdom, with the real export buttons
// clicked.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

// ── Load the page's modules ──────────────────────────────────────────────
const dom = new JSDOM(
  '<!doctype html><body>' +
  '<button id="pmaExportCsvBtn"></button><button id="pmaExportJsonBtn"></button><button id="pmaExportCsv"></button>' +
  '<div id="maMarketDemandContent"></div></body>',
  { url: 'http://localhost/market-analysis.html', runScripts: 'outside-only' });
const w = dom.window;
const downloads = [];
w.Blob = function (parts) { downloads.push(parts.join('')); };
w.URL.createObjectURL = () => 'blob:test';
w.URL.revokeObjectURL = () => {};
w.HTMLAnchorElement.prototype.click = () => {};
w.alert = () => {};
// The page's own startup (map, data fetches) has nothing to load here; keep
// its console noise out of the test output.
const quiet = { log: console.log, warn: console.warn, error: console.error, info: console.info };
console.warn = console.error = console.info = () => {};
w.console.log = w.console.warn = w.console.error = w.console.info = () => {};
[
  'js/utils/format-money.js',
  'js/market-analysis/market-analysis-utils.js',
  'js/market-analysis/market-report-renderers.js',
  'js/market-analysis-scoring.js',
  'js/market-analysis.js',
].forEach((rel) => w.eval(read(rel)));

const E = w.PMAEngine;
const R = w.MARenderers;
assert(E && typeof E.aggregateAcs === 'function' && typeof E.computePma === 'function', 'PMAEngine did not load');
assert(R && typeof R.renderMarketDemand === 'function', 'MARenderers did not load');

// ── Fixtures ─────────────────────────────────────────────────────────────
const tract = (geoid, rent, income, over) => Object.assign({
  geoid, pop: 1000, renter_hh: 200, total_hh: 400, vacant: 20,
  median_gross_rent: rent, median_hh_income: income,
  cost_burden_rate: 0.4, vacancy_rate: 0.05,
}, over);
const aggregate = (tracts) => {
  const idx = {};
  tracts.forEach((t) => { idx[t.geoid] = t; });
  return E.aggregateAcs(tracts.map((t) => ({ geoid: t.geoid, share: 1 })), idx);
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Every count in a string (dollar amounts aside). The disclosures are read
// for the counts they state, not their wording, so a rewording does not
// break the check.
const numbersIn = (s) => (s.match(/(?<![$\d,])\d[\d,]*/g) || []).map((n) => Number(n.replace(/,/g, '')));

function renderDemand(agg) {
  // The field names runAnalysis() hands the report renderer (MAState.acs).
  R.renderMarketDemand({
    med_gross_rent: agg.median_gross_rent,
    med_hh_income: agg.median_hh_income,
    med_gross_rent_excluded_tracts: agg.median_gross_rent_excluded_tracts || 0,
    med_hh_income_excluded_tracts: agg.median_hh_income_excluded_tracts || 0,
    renter_hh: agg.renter_hh, total_hh: agg.total_hh, pop: agg.pop,
  });
  const box = w.document.getElementById('maMarketDemandContent');
  const rows = {};
  box.querySelectorAll('*').forEach((node) => {
    const kids = Array.from(node.children);
    if (kids.length === 2 && !kids[0].children.length && !kids[1].children.length) {
      rows[kids[0].textContent.trim()] = kids[1].textContent.trim();
    }
  });
  const note = box.querySelector('.ma-median-basis-note');
  return { rows, note: note ? note.textContent : '' };
}

function exportResult(agg) {
  const result = Object.assign(E.computePma(agg, 10, 0, 39.74, -104.99, [], 95000, [], {}),
    { acs: agg, lat: 39.74, lon: -104.99, bufferMiles: 3, tractCount: agg.tract_count });
  E._setLastResultForTest(result);
  downloads.length = 0;
  w.document.getElementById('pmaExportJsonBtn').click();
  w.document.getElementById('pmaExportCsvBtn').click();
  w.document.getElementById('pmaExportCsv').click();
  assert.strictEqual(downloads.length, 3, 'the export buttons did not produce a JSON and two CSV downloads');
  const json = JSON.parse(downloads[0]);
  const table = (text) => {
    const out = {};
    text.split('\n').forEach((line) => {
      const m = line.match(/^"?([^",]*)"?,"?(.*?)"?\r?$/);
      if (m) out[m[1]] = m[2];
    });
    return out;
  };
  return { json, csv: table(downloads[1]), rawCsv: table(downloads[2]) };
}
// A row the check reads must exist, or "shows no number" passes vacuously.
function cell(rows, key, where) {
  assert(Object.prototype.hasOwnProperty.call(rows, key), where + ' has no "' + key + '" row');
  return rows[key];
}

function run() {
Object.assign(console, quiet);
console.log('\nA median the Census did not publish is unavailable, never $0');

// ── Aggregation ──────────────────────────────────────────────────────────
test('a suppressed median rent (null or 0) is left out, not averaged in as $0', () => {
  for (const missing of [null, 0, undefined]) {
    const agg = aggregate([tract('a', 1500, 60000), tract('b', missing, 60000)]);
    assert.strictEqual(agg.median_gross_rent, 1500, `rent ${missing} averaged in: ${agg.median_gross_rent}`);
    assert.strictEqual(agg.median_gross_rent_excluded_tracts, 1);
  }
});

test('a suppressed median income (null or 0) is left out, not averaged in as $0', () => {
  for (const missing of [null, 0, undefined]) {
    const agg = aggregate([tract('a', 1500, 60000), tract('b', 1500, missing)]);
    assert.strictEqual(agg.median_hh_income, 60000, `income ${missing} averaged in: ${agg.median_hh_income}`);
    assert.strictEqual(agg.median_hh_income_excluded_tracts, 1);
  }
});

test('a mix of measured and suppressed tracts divides by the measured tracts only', () => {
  const agg = aggregate([tract('a', 1200, 50000), tract('b', 1800, 70000), tract('c', 0, 0), tract('d', null, null)]);
  assert.strictEqual(agg.median_gross_rent, mean([1200, 1800]));
  assert.strictEqual(agg.median_hh_income, mean([50000, 70000]));
  assert.strictEqual(agg.median_gross_rent_excluded_tracts, 2);
  assert.strictEqual(agg.median_hh_income_excluded_tracts, 2);
  // Counts the suppressed tracts still contribute are unchanged.
  assert.strictEqual(agg.renter_hh, 800);
  assert.strictEqual(agg.tract_count, 4);
});

test('rent and income keep separate denominators', () => {
  const agg = aggregate([tract('a', 1400, null), tract('b', null, 80000), tract('c', 1000, 40000)]);
  assert.strictEqual(agg.median_gross_rent, mean([1400, 1000]), 'rent divided by a tract with no rent');
  assert.strictEqual(agg.median_hh_income, mean([80000, 40000]), 'income divided by a tract with no income');
  assert.strictEqual(agg.median_gross_rent_excluded_tracts, 1);
  assert.strictEqual(agg.median_hh_income_excluded_tracts, 1);
});

test('every tract suppressed: rent is null, not $0', () => {
  const agg = aggregate([tract('a', null, 60000), tract('b', 0, 50000)]);
  assert.strictEqual(agg.median_gross_rent, null);
  assert.strictEqual(agg.median_gross_rent_excluded_tracts, 2);
  assert.strictEqual(agg.median_hh_income, 55000);
});

test('every tract suppressed: income is null, not $0', () => {
  const agg = aggregate([tract('a', 1500, null), tract('b', 1300, 0)]);
  assert.strictEqual(agg.median_hh_income, null);
  assert.strictEqual(agg.median_hh_income_excluded_tracts, 2);
  assert.strictEqual(agg.median_gross_rent, 1400);
});

test('a measured median is kept exactly, with nothing excluded', () => {
  const agg = aggregate([tract('a', 1537, 61234)]);
  assert.strictEqual(agg.median_gross_rent, 1537);
  assert.strictEqual(agg.median_hh_income, 61234);
  assert.strictEqual(agg.median_gross_rent_excluded_tracts, 0);
  assert.strictEqual(agg.median_hh_income_excluded_tracts, 0);
});

test('the committed tract file: Denver County averages only its published medians and counts the rest', () => {
  const tracts = JSON.parse(read('data/market/acs_tract_metrics_co.json')).tracts;
  const published = (v) => v != null && Number(v) > 0;
  const denver = tracts.filter((t) => t.geoid.startsWith('08031'));
  const withRent = denver.filter((t) => published(t.median_gross_rent));
  // Non-vacuity on the scan: the real file must still hold a Denver tract
  // with no published rent for this to test anything.
  assert(denver.length > withRent.length, 'no Denver tract without a published median rent to test against');
  const agg = aggregate(denver);
  assert(Math.abs(agg.median_gross_rent - mean(withRent.map((t) => Number(t.median_gross_rent)))) < 1e-6,
    `Denver median rent ${agg.median_gross_rent} is not the mean of its ${withRent.length} published tract medians`);
  assert.strictEqual(agg.median_gross_rent_excluded_tracts, denver.length - withRent.length);
});

// ── Scoring ──────────────────────────────────────────────────────────────
test('no published rent does not score as zero rent pressure: the dimension is excluded and the overall renormalized', () => {
  const base = aggregate([tract('a', 1500, 60000), tract('b', 1700, 70000)]);
  const noRent = aggregate([tract('a', null, 60000), tract('b', 0, 70000)]);
  const withRent = E.computePma(base, 10, 0, 39.74, -104.99, [], 95000, [], {});
  const without = E.computePma(noRent, 10, 0, 39.74, -104.99, [], 95000, [], {});
  assert.notStrictEqual(withRent.dimensions.rentPressure, null, 'the fixture with rent should score rent pressure');
  assert.strictEqual(without.dimensions.rentPressure, null, 'no rent scored rent pressure as ' + without.dimensions.rentPressure);
  assert.strictEqual(without.dimensionDataAvailable.rentPressure, false);
  assert(without.fallback_reasons && without.fallback_reasons.rent_pressure, 'no reason given for the excluded dimension');
  assert(!/defaulted to 0/.test(without.fallback_reasons.rent_pressure), without.fallback_reasons.rent_pressure);
  assert(without.flags.some((f) => /rent/i.test(f.text) && /unavailable/i.test(f.text)), 'no flag says rent pressure is unavailable');
  // Overall = the other dimensions' weighted mean, rent's weight redistributed.
  const W = E.WEIGHTS, d = without.dimensions;
  const others = [['demand', W.demand], ['captureRisk', W.captureRisk], ['landSupply', W.landSupply], ['workforce', W.workforce]]
    .filter(([k]) => d[k] != null);
  const want = Math.round(others.reduce((a, [k, wt]) => a + d[k] * wt, 0) / others.reduce((a, [, wt]) => a + wt, 0));
  assert.strictEqual(without.overall, want, `overall ${without.overall} is not the renormalized ${want}`);
});

test('a missing county AMI still reports its own reason, not the rent one', () => {
  const r = E.computePma(aggregate([tract('a', 1500, 60000)]), 10, 0, 39.74, -104.99, [], null, [], {});
  assert.strictEqual(r.dimensions.rentPressure, null);
  assert(/AMI/.test(r.fallback_reasons.rent_pressure), r.fallback_reasons.rent_pressure);
});

// ── Screen and exports ───────────────────────────────────────────────────
test('screen and both exports agree on the medians and the excluded-tract counts', () => {
  const agg = aggregate([tract('a', 1201, 50001), tract('b', 1800, null), tract('c', 0, 70002)]);
  const screen = renderDemand(agg);
  const { json, csv, rawCsv } = exportResult(agg);
  const dollars = (s) => Number(String(s).replace(/[$,]/g, ''));
  const rent = Math.round(agg.median_gross_rent), income = Math.round(agg.median_hh_income);
  assert.strictEqual(dollars(cell(screen.rows, 'Median Gross Rent', 'screen')), rent, 'screen rent ' + screen.rows['Median Gross Rent']);
  assert.strictEqual(dollars(cell(screen.rows, 'Median HH Income', 'screen')), income, 'screen income ' + screen.rows['Median HH Income']);
  assert.strictEqual(Math.round(json.acsAggregates.medianGrossRent), rent);
  assert.strictEqual(Math.round(json.acsAggregates.medianHhIncome), income);
  assert.strictEqual(dollars(cell(csv, 'Median Gross Rent', 'CSV')), rent, 'CSV rent ' + csv['Median Gross Rent']);
  assert.strictEqual(dollars(cell(csv, 'Median Household Income', 'CSV')), income, 'CSV income ' + csv['Median Household Income']);
  assert.strictEqual(Math.round(Number(cell(rawCsv, 'median_gross_rent', 'result CSV'))), rent);
  assert.strictEqual(Math.round(Number(cell(rawCsv, 'median_hh_income', 'result CSV'))), income);
  assert.strictEqual(Number(cell(rawCsv, 'median_gross_rent_excluded_tracts', 'result CSV')), 1);
  assert.strictEqual(Number(cell(rawCsv, 'median_hh_income_excluded_tracts', 'result CSV')), 1);
  // Counts: 1 tract left out for rent, 1 for income, on every surface.
  assert.strictEqual(json.acsAggregates.medianGrossRentExcludedTracts, 1);
  assert.strictEqual(json.acsAggregates.medianHhIncomeExcludedTracts, 1);
  const csvCounts = Object.keys(csv).filter((k) => /Tracts Left Out/i.test(k)).map((k) => Number(csv[k]));
  assert.deepStrictEqual(csvCounts, [1, 1], 'CSV excluded-tract rows: ' + JSON.stringify(csvCounts));
  assert.deepStrictEqual(numbersIn(screen.note), [1, 1], 'the screen note states ' + screen.note);
});

test('with no published median anywhere, screen and exports show unavailable, never $0', () => {
  const agg = aggregate([tract('a', null, 0), tract('b', 0, null)]);
  const screen = renderDemand(agg);
  const { json, csv, rawCsv } = exportResult(agg);
  for (const [where, v] of [
    ['screen rent', cell(screen.rows, 'Median Gross Rent', 'screen')],
    ['screen income', cell(screen.rows, 'Median HH Income', 'screen')],
    ['CSV rent', cell(csv, 'Median Gross Rent', 'CSV')],
    ['CSV income', cell(csv, 'Median Household Income', 'CSV')],
    ['result CSV rent', cell(rawCsv, 'median_gross_rent', 'result CSV')],
    ['result CSV income', cell(rawCsv, 'median_hh_income', 'result CSV')]]) {
    assert(!/\d/.test(v), `${where} shows a number for an unavailable median: "${v}"`);
  }
  assert.strictEqual(json.acsAggregates.medianGrossRent, null);
  assert.strictEqual(json.acsAggregates.medianHhIncome, null);
  assert.deepStrictEqual(numbersIn(screen.note), [2, 2], 'the screen note states ' + screen.note);
});

test('with every median published, the note states no exclusion', () => {
  const agg = aggregate([tract('a', 1500, 60000)]);
  const screen = renderDemand(agg);
  assert.deepStrictEqual(numbersIn(screen.note), [], 'a note with nothing excluded states ' + screen.note);
});

// ── Builder ──────────────────────────────────────────────────────────────
test('the builder writes null for a suppressed, sentinel or empty median and keeps a real one', () => {
  // Drives build_acs_metrics() with a stubbed Census response: the builder's
  // own code path, not a copy of it.
  const py = `
import json, importlib.util
spec = importlib.util.spec_from_file_location("b", "scripts/market/build_public_market_data.py")
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
hdr = list(b.ACS_VARIABLES) + ["state", "county", "tract"]
def row(rent, inc, tract):
    r = ["100"] * len(b.ACS_VARIABLES) + ["08", "031", tract]
    r[hdr.index("B25064_001E")] = rent
    r[hdr.index("B19013_001E")] = inc
    return r
rows = [hdr, row("-666666666", "49549", "001000"), row(None, "-888888888", "001001"),
        row("0", "", "001002"), row("1450", "61000", "001003")]
b.fetch_url = lambda *a, **k: json.dumps(rows)
out = b.build_acs_metrics({})
print(json.dumps([[t["median_gross_rent"], t["median_hh_income"], t["renter_hh"]] for t in out["tracts"]]))
`;
  const got = JSON.parse(execFileSync('python3', ['-c', py], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').pop());
  assert.deepStrictEqual(got.map(([rent, inc]) => [rent, inc]),
    [[null, 49549], [null, null], [null, null], [1450, 61000]], 'builder medians: ' + JSON.stringify(got));
  // A count that really is a count still comes through as a number.
  assert(got.every(([, , renters]) => typeof renters === 'number'), 'renter_hh stopped being numeric');
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed ✅');
process.exit(failures ? 1 : 0);
}

// The page binds its export buttons on DOMContentLoaded; run once it has.
if (w.document.readyState === 'complete') run();
else w.addEventListener('load', run);
