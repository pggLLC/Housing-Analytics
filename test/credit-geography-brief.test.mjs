/**
 * The tax credit geography brief is pinned to its data, not its wording: the
 * county rows must add up to every CHFA 9% and 4% award in the ledger, every
 * county must sit in one CHFA region, the index must be what its definition
 * says, the brief and data file must be exactly what
 * scripts/policy/build_credit_geography_brief.mjs builds, and the reader must
 * load the map for this brief only.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { RETURNED } from '../scripts/funding/build_funding_vs_need.mjs';
import { build, BRIEF_ID, DATA, FEED, LEDGER, DEMO, FRONT_RANGE, REGION_BY_GEOGRAPHY, MIN_SEVERE } from '../scripts/policy/build_credit_geography_brief.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const D = json(DATA);
const feed = json(FEED);
const brief = feed.briefs.find((b) => b.id === BRIEF_ID);
const ledger = json(LEDGER).awards.filter((a) => /^LIHTC (9|4)%/.test(a.program) && !RETURNED.test(a.detail || ''));
const sec = (id) => brief.sections.find((s) => s.id === id);
const num = (s) => Number(String(s).replace(/[$,%M]/g, ''));

test('the data file and brief are what the builder makes', () => {
  assert.ok(brief, `curated feed has no ${BRIEF_ID}`);
  const files = build();
  assert.equal(files[DATA], read(DATA), 'run node scripts/policy/build_credit_geography_brief.mjs');
  assert.equal(files[FEED], read(FEED), 'run node scripts/policy/build_credit_geography_brief.mjs');
  assert.equal(brief.related_data, DATA);
  assert.equal(brief.is_curated, true);
  assert.equal(feed.meta.brief_count, feed.briefs.length);
});

test('county rows add up to every 9% and 4% award in the ledger, plus bond deals outside the rounds', () => {
  const placed = ledger.filter((a) => a.county_fips && D.counties.some((c) => c.fips === a.county_fips));
  assert.equal(placed.length + D.metadata.skipped_awards.length, ledger.length, 'every award is counted or listed as skipped');
  const is9 = (a) => a.program.startsWith('LIHTC 9%');
  const homes = (a) => a.restricted_units ?? a.total_units ?? 0;
  const sum = (k) => D.counties.reduce((s, c) => s + c[k], 0);
  assert.equal(sum('awards_9'), placed.filter(is9).length);
  assert.equal(sum('awards_4'), placed.filter((a) => !is9(a)).length);
  assert.equal(sum('homes_9'), placed.filter(is9).reduce((s, a) => s + homes(a), 0));
  assert.equal(sum('homes_4_rounds'), placed.filter((a) => !is9(a)).reduce((s, a) => s + homes(a), 0));
  for (const c of D.counties) assert.equal(c.homes_4, c.homes_4_rounds + c.homes_4_outside_rounds, `${c.name}: 4% homes`);
  // the same bond deals the Funding vs Need tab adds (data/derived/funding-vs-need.json)
  const fvn = json('data/derived/funding-vs-need.json');
  assert.equal(sum('bond_deals_outside_rounds'), fvn.statewide.bond_deals_outside_rounds);
  assert.equal(sum('homes_4_outside_rounds'), fvn.statewide.bond_units_outside_rounds);
  assert.equal(D.metadata.returned_awards.length, json(LEDGER).awards.filter((a) => /^LIHTC (9|4)%/.test(a.program) && RETURNED.test(a.detail || '')).length);
  assert.equal(sum('credit_9'), placed.filter(is9).reduce((s, a) => s + (a.federal_credit || 0), 0));
  for (const k of ['awards_9', 'homes_9', 'credit_9', 'awards_4', 'homes_4', 'homes_4_outside_rounds', 'renters_paying_half', 'renter_households']) {
    assert.equal(D.totals[k], sum(k), `totals.${k}`);
    assert.equal(D.regions.reduce((s, r) => s + r[k], 0), sum(k), `regions add to ${k}`);
    assert.equal(D.front_range[k] + D.rest_of_state[k], sum(k), `Front Range + rest = ${k}`);
  }
  for (const y of D.by_year) {
    const ys = placed.filter((a) => a.year === y.year);
    assert.equal(y.homes_9, ys.filter(is9).reduce((s, a) => s + homes(a), 0), `${y.year} 9% homes`);
    assert.equal(y.awards_9, ys.filter(is9).length, `${y.year} 9% awards`);
  }
});

test('need figures are the ACS county figures', () => {
  const demo = Object.values(json(DEMO).counties);
  for (const c of D.counties) {
    const d = demo.find((x) => x.fips === c.fips);
    assert.ok(d, `${c.name}: no ACS row`);
    assert.equal(c.renters_paying_half, d.renters_burdened_50_plus);
    assert.equal(c.renter_households, d.rent_burden_universe);
  }
});

test('all 64 counties sit in one CHFA region', () => {
  assert.equal(D.counties.length, 64);
  const regions = new Set(D.regions.map((r) => r.region));
  assert.equal(regions.size, 10);
  for (const r of FRONT_RANGE) assert.ok(regions.has(r), r);
  for (const c of D.counties) {
    assert.ok(regions.has(c.region), `${c.name}: ${c.region}`);
    if (c.region_method !== 'CHFA property list') assert.equal(c.region, REGION_BY_GEOGRAPHY[c.fips], `${c.name}: geography fallback`);
  }
  const counted = D.regions.reduce((s, r) => s + r.counties.length, 0);
  assert.equal(counted, 64);
});

test('the index is share of 9% credit over share of renters paying 50%+', () => {
  const T = D.totals;
  for (const c of [...D.counties, ...D.regions]) {
    const want = c.renters_paying_half ? (c.credit_9 / c.renters_paying_half) / (T.credit_9 / T.renters_paying_half) : 0;
    assert.equal(c.index_9, Math.round(want * 10) / 10, c.name || c.region);
  }
});

test('the brief tables are the data, row for row', () => {
  const reg = sec('regions').table.rows;
  assert.equal(reg.length, D.regions.length + 1);
  D.regions.forEach((r, i) => {
    assert.equal(reg[i][0], r.region);
    assert.equal(num(reg[i][3]), r.awards_9);
    assert.equal(num(reg[i][7]), r.index_9);
  });
  const cty = sec('within').table.rows;
  assert.equal(cty.length, 64);
  for (const row of cty) {
    const c = D.counties.find((x) => x.name === row[0]);
    assert.equal(num(row[2]), c.renters_paying_half);
    assert.equal(num(row[3]), c.awards_9);
    assert.equal(num(row[4]), c.homes_9);
    assert.equal(num(row[6]), c.homes_4);
    assert.equal(row[7], c.renters_paying_half >= MIN_SEVERE ? c.index_9.toFixed(1) : '');
  }
  const yrs = sec('years').table.rows;
  assert.deepEqual(yrs.map((r) => Number(r[0])), D.by_year.map((y) => y.year));
});

test('the brief is about rentals and renters, and says so', () => {
  const text = JSON.stringify(brief);
  assert.match(brief.sections[0].items[0], /rentals with income limits/);
  assert.match(text, /homeowners are not part of this comparison/);
  assert.doesNotMatch(text, /Fruita Mews/i, 'no single project is named');
});

test('every source is linked and dated', () => {
  for (const a of brief.articles) {
    assert.match(a.date, /^\d{4}-\d{2}-\d{2}$/, a.title);
    assert.match(a.link, /^https:\/\//, a.title);
  }
  const years = new Set(D.by_year.map((y) => y.year));
  for (const y of years) assert.ok(brief.articles.some((a) => a.title.startsWith(`${y} 9%`)), `${y} award report cited`);
});

test('the reader loads the credit geography map for this brief only', () => {
  const html = read('research-brief.html');
  assert.match(html, /item\.map === 'credit-geography'/);
  assert.match(html, /js\/credit-geography-map\.js/);
  const js = read('js/credit-geography-map.js');
  assert.ok(js.includes(DATA) && js.includes('data/boundaries/counties_co.geojson'));
  assert.match(js, /COHOBasemaps\.standard/, 'streets + satellite switch, as every site map');
  assert.ok(js.includes(`MIN_SEVERE = ${MIN_SEVERE}`), 'map and brief use the same small-county cut');
  assert.equal(feed.briefs.filter((b) => (b.sections || []).some((s) => s.map === 'credit-geography')).length, 1);
});
