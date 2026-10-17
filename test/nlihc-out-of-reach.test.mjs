/**
 * NLIHC Out of Reach: the data file, the HNA card that renders it, and the
 * housing-costs article that quotes it must agree.
 *
 * Until 2026-10-17 the file held "directional estimates" labelled 2025 (a
 * $38.42 state housing wage against NLIHC's published $36.44 for 2026), the
 * card printed a "median" renter wage NLIHC does not publish, and a missing
 * value reached `.toFixed` as the string '—'.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const DATA = JSON.parse(read('data/affordable-housing/nlihc-out-of-reach-co.json'));
const COUNTIES = JSON.parse(read('data/co_ami_gap_by_county.json'));

test('every Colorado county has a row keyed by its 5-digit FIPS', () => {
  const fips = Object.keys(DATA.by_county);
  assert.equal(fips.length, 64);
  fips.forEach((f) => assert.match(f, /^08\d{3}$/));
});

test('the gap is the housing wage minus the renter wage, and absent when the wage is', () => {
  let checked = 0;
  Object.entries(DATA.by_county).forEach(([fips, c]) => {
    if (c.renter_mean_wage == null) {
      assert.equal(c.gap_2br, null, `${fips}: no wage, so no gap`);
      assert.ok(c.renter_wage_unavailable_reason, `${fips}: says why the wage is missing`);
      return;
    }
    assert.ok(Math.abs(c.gap_2br - (c.two_br_housing_wage - c.renter_mean_wage)) < 0.011, `${fips} gap`);
    checked += 1;
  });
  assert.ok(checked >= 60, 'the scan checked most counties');
  const s = DATA.state_summary;
  assert.ok(Math.abs(s.affordability_gap_per_hour - (s.two_br_housing_wage - s.renter_mean_hourly_wage)) < 0.011);
});

test('county names and renter counts agree with the county AMI file', () => {
  let same = 0;
  COUNTIES.counties.forEach((r) => {
    const ours = DATA.by_county[r.fips];
    assert.ok(ours, `${r.fips} present`);
    assert.equal(`${ours.county_name} County`, r.county_name);
    if (ours.renter_households === r.renter_households_total) same += 1;
  });
  // Both come from ACS 2020-2024 renter households; NLIHC republishes them.
  assert.ok(same >= 60, `renter counts match for ${same} of 64 counties`);
});

test('the HNA card reads only fields the file has', () => {
  const src = read('js/hna/hna-renderers.js');
  const start = src.indexOf("fetch('data/affordable-housing/nlihc-out-of-reach-co.json')");
  assert.ok(start > 0, 'card loader found');
  const block = src.slice(start, src.indexOf('panel.appendChild(addendum)', start));
  const recKeys = new Set([...block.matchAll(/\brec\.(\w+)/g)].map((m) => m[1]));
  const stateKeys = new Set([...block.matchAll(/\bstate\.(\w+)/g)].map((m) => m[1]));
  assert.ok(recKeys.size >= 5 && stateKeys.size >= 3, 'scan found field reads');
  const countyKeys = new Set(Object.values(DATA.by_county).flatMap((c) => Object.keys(c)).concat(['notes']));
  recKeys.forEach((k) => assert.ok(countyKeys.has(k), `card reads rec.${k}, which the file lacks`));
  stateKeys.forEach((k) => assert.ok(k in DATA.state_summary, `card reads state.${k}, which the file lacks`));
  assert.doesNotMatch(block, /\(rec\.\w+ \|\| '—'\)\.toFixed/, 'a missing value never reaches toFixed as a string');
  assert.doesNotMatch(block, /Median renter wage/, 'NLIHC publishes a mean renter wage, not a median');
});

test('the housing-costs article quotes the same Out of Reach figures', () => {
  const html = read('article-co-housing-costs.html');
  const s = DATA.state_summary;
  assert.ok(html.includes(`Out of Reach ${DATA.meta.vintage}`), 'names the same report year');
  assert.ok(html.includes(`$${s.fmr_2br.toLocaleString('en-US')}/month`), 'same 2-BR Fair Market Rent');
  assert.ok(html.includes(`$${s.two_br_housing_wage.toFixed(2)}/hr`), 'same 2-BR housing wage');
});
