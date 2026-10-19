/**
 * The data map's county housing-cost layers, and the article figures that
 * restate them, must agree with the sources they name.
 *
 * data/processed/co_county_housing_indicators.geojson was built once, on
 * 2026-06-09, from caches that still held placeholder values, and nothing
 * rebuilt it. For four months the map showed Summit County vacancy at 9%
 * (ACS 2020–2024: 61%), Hinsdale at 18.5% (62%), Denver median household
 * income at $69,000 ($94,718) and an FHFA change for every county, including
 * the seven FHFA publishes no index for. The article beside it carried three
 * figures marked "unconfirmed" that were each wrong once checked.
 *
 * Each assertion names the file the value must agree with, so a refresh of
 * either side without the other fails here. update-co-housing-costs.yml runs
 * this file before it commits, because data commits skip CI: a new FHFA or
 * QCEW year moves the map's window, and the refresh holds until the article
 * moves with it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));

const GEO = json('data/processed/co_county_housing_indicators.geojson');
const DEMO = json('data/co-county-demographics.json');
const props = GEO.features.map((f) => f.properties);
const byName = Object.fromEntries(props.map((p) => [p.NAME, p]));

test('every county carries the Census API figures for its vintage', () => {
  assert.equal(props.length, 64, 'all 64 Colorado counties');
  const mapYear = GEO.meta.vintages.acs;
  const demoYears = new Set(Object.values(DEMO.counties).map((c) => c.acs_year));
  assert.equal(demoYears.size, 1, 'the Census API file holds one vintage');
  const [demoYear] = demoYears;
  // A new ACS release reaches the weekly Census file before the monthly map
  // refresh; one release of lag is allowed, more is a map nobody rebuilds.
  assert.ok(mapYear >= demoYear - 1, `map ACS ${mapYear} is within one release of the Census file's ${demoYear}`);
  if (mapYear !== demoYear) return;

  let compared = 0;
  for (const [name, c] of Object.entries(DEMO.counties)) {
    const p = byName[name];
    assert.ok(p, `${name} is on the map`);
    assert.equal(p.acs_year, c.acs_year, `${name} vintage`);
    assert.equal(p.median_gross_rent, c.median_gross_rent, `${name} median gross rent`);
    assert.equal(p.median_hh_income, c.median_hh_income, `${name} median household income`);
    assert.ok(Math.abs(p.vacancy_rate - c.vacancy_rate) < 0.00051, `${name} vacancy ${p.vacancy_rate} vs ${c.vacancy_rate}`);
    assert.ok(Math.abs(p.rent_burden_30_plus - c.cost_burden_share) < 0.00051,
      `${name} rent burden ${p.rent_burden_30_plus} vs ${c.cost_burden_share}`);
    assert.equal(p.population, c.population, `${name} population (the permits denominator)`);
    compared++;
  }
  assert.equal(compared, 64, 'the comparison covered every county');
});

test('an unpublished value stays null, never zero', () => {
  for (const p of props) {
    for (const key of ['median_gross_rent', 'median_hh_income', 'population', 'qcew_avg_annual_wage']) {
      assert.ok(p[key] == null || p[key] > 0, `${p.NAME} ${key} is null or positive (saw ${p[key]})`);
    }
    if (p.renters_burdened_30_plus != null) {
      assert.ok(Math.abs(p.renters_burdened_30_plus / p.renter_households - p.rent_burden_30_plus) < 0.00051,
        `${p.NAME} rent burden share follows from its counts`);
    }
    if (p.bps_permits_per_1k_5yr_avg != null) assert.ok(p.population > 0, `${p.NAME} permit rate has a population`);
  }
  // FHFA publishes no county index where sales are too few, and BLS withholds
  // small counties; both gaps must reach the map as gaps.
  const hpiGaps = props.filter((p) => p.fhfa_hpi_change_10y == null).length;
  const wageGaps = props.filter((p) => p.qcew_avg_annual_wage == null).length;
  assert.ok(hpiGaps > 0 && hpiGaps < 64, `some counties have no FHFA index (${hpiGaps})`);
  assert.ok(wageGaps > 0 && wageGaps < 64, `some counties have no published QCEW wage (${wageGaps})`);
});

test('the layer years come from the features, and the features agree on them', () => {
  const v = GEO.meta.vintages;
  assert.equal(v.fhfa_hpi.latest - v.fhfa_hpi.base, 10, 'the FHFA window is ten years');
  assert.equal(v.bps_permits.last - v.bps_permits.first, 4, 'the permits window is five survey years');
  for (const p of props) {
    assert.equal(p.fhfa_base_year, v.fhfa_hpi.base, `${p.NAME} FHFA base year`);
    assert.equal(p.fhfa_latest_year, v.fhfa_hpi.latest, `${p.NAME} FHFA latest year`);
    assert.equal(p.qcew_year, v.qcew, `${p.NAME} QCEW year`);
    assert.equal(p.bps_first_year, v.bps_permits.first, `${p.NAME} permits window`);
  }
  const page = read('data-map-browser.html');
  for (const field of ['p.fhfa_base_year', 'p.fhfa_latest_year', 'p.bps_first_year', 'p.qcew_year']) {
    assert.ok(page.includes(field), `the map popup reads ${field}`);
  }
  assert.ok(!/2014\s*(→|->|–)\s*2024/.test(page), 'no fixed FHFA window is written into the map page');
});

test('the article states the statewide figures its sources give', () => {
  const html = read('article-co-housing-costs.html');
  assert.ok(!/unconfirmed: not yet re-checked/.test(html), 'no finding is left marked unconfirmed');

  // Rent burden: the county counts summed, which is the state figure.
  const st = GEO.meta.statewide;
  assert.equal(st.renter_households, props.reduce((t, p) => t + p.renter_households, 0), 'statewide renters are the county sum');
  assert.equal(st.renters_burdened_30_plus, props.reduce((t, p) => t + p.renters_burdened_30_plus, 0), 'statewide burdened renters are the county sum');
  const acsState = json('data/census-acs-state.json').data.find((r) => r.state_fips === '08');
  if (acsState.year === GEO.meta.vintages.acs) {
    assert.equal(st.renter_households, acsState.renter_occupied, 'county renters sum to the state table');
  }
  // Each finding is found by its label and read for its numbers, so the
  // sentence around them can be reworded freely.
  const finding = (label) => {
    const m = html.match(new RegExp(`<li><strong>([^<]*${label}[^<]*)</strong>([^]*?)</li>`));
    assert.ok(m, `the Key Findings list has a "${label}" item`);
    return { head: m[1], body: m[2] };
  };
  const n = (s) => Number(String(s).replace(/,/g, ''));

  const rb = finding('Rent Burden');
  const rbPct = rb.body.match(/(\d+\.\d)%/);
  const rbCounts = [...rb.body.matchAll(/\b\d{1,3}(?:,\d{3})+\b/g)].map((x) => n(x[0]));
  assert.ok(rbPct && rbCounts.length === 2, 'the rent-burden finding states its share and both counts');
  assert.equal(rbPct[1], (st.rent_burden_30_plus * 100).toFixed(1), 'stated share equals the map statewide share');
  assert.equal(Math.min(...rbCounts), st.renters_burdened_30_plus, 'burdened count equals the map');
  assert.equal(Math.max(...rbCounts), st.renter_households, 'renter count equals the map');
  if (DEMO.statewide.acs_year === GEO.meta.vintages.acs) {
    assert.equal(rbPct[1], (DEMO.statewide.cost_burden_share * 100).toFixed(1), 'and the Census API file statewide share');
  }

  // FHFA: the state index at Q4 of each end year of the county maps' window.
  const hpi = finding('House Price Index');
  const hpiYears = hpi.head.match(/Q4 (\d{4})\D+Q4 (\d{4})/);
  const hpiPct = hpi.body.match(/(\d+\.\d)%/);
  const hpiVals = [...hpi.body.matchAll(/\b(\d{3,4}\.\d{2})\b/g)].map((x) => Number(x[1]));
  assert.ok(hpiYears && hpiPct && hpiVals.length === 2, 'the FHFA finding states its window, change and both index values');
  const [y0, y1] = [Number(hpiYears[1]), Number(hpiYears[2])];
  const [v0, v1] = hpiVals;
  assert.equal(y0, GEO.meta.vintages.fhfa_hpi.base, 'window starts where the county maps start');
  assert.equal(y1, GEO.meta.vintages.fhfa_hpi.latest, 'window ends where the county maps end');
  const obs = json('data/fred-data.json').series.COSTHPI.observations;
  const q4 = (y) => obs.find((o) => o.date === `${y}-10-01`);
  assert.ok(q4(y0) && q4(y1), `fred-data.json holds COSTHPI for Q4 ${y0} and Q4 ${y1}`);
  assert.equal(Number(q4(y0).value), v0, `COSTHPI Q4 ${y0} = ${v0}`);
  assert.equal(Number(q4(y1).value), v1, `COSTHPI Q4 ${y1} = ${v1}`);
  assert.equal(((v1 / v0 - 1) * 100).toFixed(1), hpiPct[1], 'stated change follows from the two values');

  // QCEW: the county wage map's year ends the window, and the change follows.
  const w = finding('Construction Wages');
  const wYears = w.head.match(/(\d{4})\D+(\d{4})\)/);
  const wPct = w.body.match(/(\d+\.\d)%/);
  const wVals = [...w.body.matchAll(/\$([\d,]+)/g)].map((x) => n(x[1]));
  assert.ok(wYears && wPct && wVals.length === 2, 'the wage finding states its window, change and both values');
  assert.equal(Number(wYears[2]), GEO.meta.vintages.qcew, 'window ends at the county wage map year');
  assert.equal(Number(wYears[2]) - Number(wYears[1]), 10, 'a ten-year window, like the price index');
  assert.equal(((wVals[1] / wVals[0] - 1) * 100).toFixed(1), wPct[1], 'stated wage change follows from the two values');
});

test('the monthly refresh rebuilds and checks the map layers before it commits', () => {
  const wf = read('.github/workflows/update-co-housing-costs.yml');
  const pipeline = wf.indexOf('build_co_housing_costs_insight.py --refresh');
  const csv = wf.indexOf('python scripts/build_article_full_indicators.py');
  const geo = wf.indexOf('node scripts/build_article_indicator_geojson.mjs');
  const check = wf.indexOf('node --test test/county-housing-indicators-sourced.test.mjs');
  const commit = wf.indexOf('scripts/commit-with-derived-chain.sh');
  assert.ok(pipeline > 0 && csv > pipeline && geo > csv && check > geo && commit > check,
    'refresh caches, then the CSV, then the GeoJSON, then this check, then commit');
  assert.ok(wf.slice(commit).includes('data/processed/co_county_housing_indicators.geojson'),
    'the commit step names the GeoJSON');
});
