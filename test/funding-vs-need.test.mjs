#!/usr/bin/env node
/**
 * Funding vs Need: the award ledger, the county roll-up, and the Deep Dive tab
 * that renders it must agree with each other and with the data they are built
 * from.
 *
 * Every check is relational, recomputed from an input rather than read back:
 *   - the 64 county rows are exactly the ranking index's counties, by 5-digit FIPS;
 *   - statewide round-report LIHTC units and Prop 123 dollars equal sums over
 *     the ledger, the bond deals added from CHFA's property list are exactly
 *     the 4% properties in the window that matchBondDeals leaves unmatched,
 *     each one's homes equal the feed's, and units = rounds + bond deals in
 *     every county, statewide and in the by-year rows;
 *   - every ledger row comes from a document documents.json marks usable, and
 *     the tab's "needs a person" list is exactly the documents that are not;
 *   - coverage is null with a reason wherever the gap it divides by is null or
 *     zero (an unmeasurable value is null, never 0);
 *   - each quadrant agrees with the split values the file publishes;
 *   - every outer tab button on colorado-deep-dive.html controls a panel, the
 *     toggle script derives its panels from the buttons and draws this tab, and the tab's script reads the file this builder writes;
 *   - the committed file equals a fresh build (freshness).
 * The second half sabotages copies and proves each check fires, and that each
 * mutation actually changed what it was meant to.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, matchBondDeals, nameSimilarity, RETURNED } from '../scripts/funding/build_funding_vs_need.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const OUTPUT = 'data/derived/funding-vs-need.json';
const INPUTS = {
  ledger: 'data/policy/funding-awards/ledger.json',
  documents: 'data/policy/funding-awards/documents.json',
  ranking: 'data/hna/ranking-index.json',
  permits: 'data/hna/permits.json',
  limits: 'data/chfa-income-rent-limits-2026.json',
  feed: 'data/chfa-lihtc.json',
};
const USABLE = new Set(['ok', 'no_total_line', 'accepted_by_review', 'units_withheld']);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clone = (o) => JSON.parse(JSON.stringify(o));

function checks({ out, ledger, documents, ranking, feed, html, js }) {
  const fails = [];
  const fail = (m) => fails.push(m);

  // counties: exactly the index's, as 5-digit strings
  const want = ranking.rankings.filter((r) => r.type === 'county').map((r) => r.geoid).sort();
  const got = out.counties.map((c) => c.fips).sort();
  if (want.length !== 64) fail(`ranking index has ${want.length} counties`);
  if (JSON.stringify(want) !== JSON.stringify(got)) fail('county FIPS differ from the ranking index');
  if (!got.every((f) => typeof f === 'string' && /^08\d{3}$/.test(f))) fail('a county FIPS is not a 5-digit 08xxx string');

  // statewide totals recomputed from the ledger, less awards CHFA notes as returned
  const counted = ledger.awards.filter((a) => !RETURNED.test(a.detail || ''));
  const returned = ledger.awards.filter((a) => RETURNED.test(a.detail || ''));
  if (JSON.stringify((out.meta.awards_returned || []).map((a) => a.name)) !== JSON.stringify(returned.map((a) => a.name))) fail('returned awards listed differ from the ledger notes');
  const lihtc = counted.filter((a) => a.program.startsWith('LIHTC'));
  const units = lihtc.reduce((s, a) => s + (num(a.restricted_units) ?? num(a.total_units) ?? 0), 0);
  if (out.statewide.round_report_lihtc_units !== units) fail(`statewide round-report LIHTC units ${out.statewide.round_report_lihtc_units} != ledger ${units}`);
  const w = out.meta.window;
  const bond = matchBondDeals(feed.features.map((f) => f.properties || {}), counted, { firstYear: w.first_year, lastYear: w.last_year });
  const added = out.meta.bond_deals_outside_rounds || [];
  if (JSON.stringify(added) !== JSON.stringify(bond.added)) fail(`bond deals listed (${added.length}) != unmatched feed 4% properties (${bond.added.length})`);
  const byId = new Map(feed.features.map((f) => [f.properties?.CHFA_RecordID, f.properties]));
  for (const d of added) {
    const p = byId.get(d.chfa_record_id);
    if (!p) { fail(`bond deal ${d.name}: no feed record ${d.chfa_record_id}`); continue; }
    if (d.homes !== (num(p.LI_UNITS) ?? num(p.N_UNITS))) fail(`bond deal ${d.name}: ${d.homes} homes, feed says ${p.LI_UNITS}`);
    if (!/^4%/.test(p.TypeOfCredits) || p.AwardYear < w.first_year || p.AwardYear > w.last_year) fail(`bond deal ${d.name} is not a 4% award in the window`);
  }
  if (out.meta.bond_deals_checked !== added.length + out.meta.bond_deals_matched_to_rounds) fail('bond deals checked != matched + added');
  const bondUnits = added.reduce((s, d) => s + (d.homes ?? 0), 0);
  if (out.statewide.bond_units_outside_rounds !== bondUnits || out.statewide.bond_deals_outside_rounds !== added.length) fail('statewide bond deal totals differ from the list');
  if (out.statewide.lihtc_units !== units + bondUnits) fail(`statewide LIHTC units ${out.statewide.lihtc_units} != rounds ${units} + bond deals ${bondUnits}`);
  for (const c of out.counties) {
    const f = c.funding;
    const mine = added.filter((d) => d.county_fips === c.fips);
    if (f.bond_deals_outside_rounds !== mine.length || f.bond_units_outside_rounds !== mine.reduce((s, d) => s + d.homes, 0)) fail(`${c.name}: bond deals differ from the list`);
    if (f.lihtc_units !== f.round_report_lihtc_units + f.bond_units_outside_rounds) fail(`${c.name}: units != rounds + bond deals`);
  }
  const p123 = counted.filter((a) => a.program.startsWith('Prop 123') && a.program !== 'Prop 123 Modular Finance');
  const dollars = p123.reduce((s, a) => s + (num(a.amount_awarded) ?? num(a.amount_requested) ?? 0), 0);
  if (out.statewide.prop123_dollars !== dollars) fail(`statewide Prop 123 dollars ${out.statewide.prop123_dollars} != ledger ${dollars}`);
  const placed = out.counties.reduce((s, c) => s + c.funding.lihtc_units, 0);
  const unplaced = lihtc.filter((a) => !a.county_fips).reduce((s, a) => s + (num(a.restricted_units) ?? num(a.total_units) ?? 0), 0);
  if (placed + unplaced !== units + bondUnits) fail(`county LIHTC units ${placed} + unplaced ${unplaced} != ${units + bondUnits}`);
  for (const k of ['lihtc_units', 'round_report_lihtc_units', 'bond_units_outside_rounds', 'bond_deals_outside_rounds', 'prop123_dollars', 'tax_credit_awards', 'prop123_awards']) {
    const s = out.statewide.by_year.reduce((t, y) => t + y[k], 0);
    if (s !== out.statewide[k]) fail(`by_year ${k} sums to ${s}, statewide says ${out.statewide[k]}`);
  }

  // ledger rows only from usable documents; the review list is the rest
  const status = Object.fromEntries(documents.documents.map((d) => [d.file, d.status]));
  const fromBad = ledger.awards.filter((a) => !USABLE.has(status[a.source_file]));
  if (fromBad.length) fail(`${fromBad.length} ledger rows come from documents not marked usable (${fromBad[0].source_file})`);
  if (!ledger.awards.every((a) => /^https:\/\//.test(a.source_url || ''))) fail('a ledger row has no source URL');
  const bad = documents.documents.filter((d) => !USABLE.has(d.status)).map((d) => d.file).sort();
  const listed = (out.meta.documents_needing_review || []).map((d) => d.file).sort();
  if (JSON.stringify(bad) !== JSON.stringify(listed)) fail(`review list ${listed} != unusable documents ${bad}`);

  // a document whose units column does not add up keeps its awards with null
  // units, and the page's undercount note counts exactly those awards
  const withheld = documents.documents.filter((d) => d.status === 'units_withheld').map((d) => d.file).sort();
  const withheldListed = (out.meta.documents_units_withheld || []).map((d) => d.file).sort();
  if (JSON.stringify(withheld) !== JSON.stringify(withheldListed)) fail(`units-withheld list ${withheldListed} != documents ${withheld}`);
  for (const a of ledger.awards) {
    for (const f of ['total_units', 'restricted_units']) {
      if (a[f] === 0) fail(`${a.name}: ${f} is 0, not null`);
      if (status[a.source_file] === 'units_withheld' && a[f] != null
        && documents.documents.find((d) => d.file === a.source_file).units_withheld.includes(f)) fail(`${a.name}: ${f} kept from a withheld units column`);
    }
  }
  const noUnits = lihtc.filter((a) => (num(a.restricted_units) ?? num(a.total_units)) === null).length;
  if (out.meta.lihtc_awards_without_units !== noUnits) fail(`awards without units ${out.meta.lihtc_awards_without_units} != ledger ${noUnits}`);

  // absence: null with a reason, never 0
  for (const c of out.counties) {
    const gap = c.need.gap_units_30ami;
    const cov = c.funding.lihtc_units_per_100_gap;
    if ((gap === null || gap === 0) !== (cov === null)) fail(`${c.name}: coverage ${cov} with gap ${gap}`);
    if (cov === null && !c.funding.lihtc_units_per_100_gap_unavailable_reason) fail(`${c.name}: null coverage has no reason`);
    if (c.quadrant === null && !c.quadrant_unavailable_reason) fail(`${c.name}: no quadrant and no reason`);
  }

  // quadrants agree with the published split
  const split = out.meta.quadrant_split;
  for (const c of out.counties) {
    if (!c.quadrant) continue;
    const hn = c.need.gap_per_1000_residents >= split.gap_per_1000_residents;
    const hc = c.funding.lihtc_units_per_100_gap >= split.lihtc_units_per_100_gap;
    const q = hn ? (hc ? 'aligned' : 'underserved') : (hc ? 'funded-above-need' : 'low-need-low-funding');
    // the split is rounded to 0.1; skip counties within rounding of a line
    const near = Math.abs(c.need.gap_per_1000_residents - split.gap_per_1000_residents) < 0.06
      || Math.abs(c.funding.lihtc_units_per_100_gap - split.lihtc_units_per_100_gap) < 0.06;
    if (q !== c.quadrant && !near) fail(`${c.name}: quadrant ${c.quadrant}, split says ${q}`);
  }

  // the page: every outer tab button controls a panel, and the toggle script
  // finds its panels from the buttons (#2138), so a button is all it needs
  const bar = /<div role="tablist" aria-label="Page sections" class="page-tabs">([\s\S]*?)<\/div>/.exec(html);
  if (!bar) fail('tab bar not found');
  else {
    const controls = [...bar[1].matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1]);
    if (!controls.includes('tab-need')) fail('no Funding vs Need tab button');
    // two tabs once shared tab-funding when Developer Funding and this tab landed together
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i && /^(tab|btn)-/.test(id));
    if (dup.length) fail(`duplicate tab ids: ${[...new Set(dup)].join(', ')}`);
    for (const id of controls) {
      if (!new RegExp(`role="tabpanel" id="${id}"`).test(html)) fail(`tab ${id} has no panel`);
    }
  }
  if (!/var panels = Array\.prototype\.map\.call\(tabs, function \(t\) \{\s*return document\.getElementById\(t\.getAttribute\('aria-controls'\)\)/.test(html)) {
    fail('the toggle script no longer finds its panels from the tab buttons');
  }
  if (!/targetId === 'tab-need' && window\.FundingVsNeed/.test(html)) fail('the toggle script never draws the Funding vs Need tab');
  if (!/<script[^>]+src="js\/funding-vs-need\.js"/.test(html)) fail('the page does not load js/funding-vs-need.js');
  const file = /var FILE = '([^']+)'/.exec(js);
  if (!file || 'data/' + file[1] !== OUTPUT) fail(`the tab reads ${file && file[1]}, the builder writes ${OUTPUT}`);
  return fails;
}

const real = {
  out: readJson(OUTPUT),
  ledger: readJson(INPUTS.ledger),
  documents: readJson(INPUTS.documents),
  ranking: readJson(INPUTS.ranking),
  feed: readJson(INPUTS.feed),
  html: read('colorado-deep-dive.html'),
  js: read('js/funding-vs-need.js'),
};

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

console.log('funding-vs-need');

run('the committed file equals a fresh build', () => {
  const inputs = Object.fromEntries(Object.entries(INPUTS).map(([k, p]) => [k, readJson(p)]));
  assert.equal(JSON.stringify(build(inputs), null, 1) + '\n', read(OUTPUT),
    `${OUTPUT} is stale — run node scripts/funding/build_funding_vs_need.mjs`);
});

run('the real data passes every check, and there is data to check', () => {
  assert.ok(real.ledger.awards.length > 100, 'the ledger is nearly empty');
  assert.ok(real.out.counties.some((c) => c.quadrant), 'no county was placed in a quadrant');
  assert.deepEqual(checks(real), []);
});

// Sabotage: each mutation must change the input, and the checks must catch it.
function sabotage(name, mutate, expect) {
  run('sabotage: ' + name, () => {
    const copy = clone(real);
    const before = JSON.stringify(copy);
    mutate(copy);
    assert.notEqual(JSON.stringify(copy), before, 'the mutation did not apply');
    const fails = checks(copy);
    assert.ok(fails.some((f) => expect.test(f)), `expected a failure matching ${expect}, got ${JSON.stringify(fails)}`);
  });
}

sabotage('a county dropped', (c) => { c.out.counties.pop(); }, /county FIPS differ/);
sabotage('a FIPS stored as a number', (c) => { c.out.counties[0].fips = Number(c.out.counties[0].fips); }, /5-digit|differ/);
sabotage('statewide units off by one', (c) => { c.out.statewide.lihtc_units += 1; }, /statewide LIHTC units/);
sabotage('a bond deal counted twice', (c) => {
  const d = c.out.meta.bond_deals_outside_rounds[0];
  c.out.meta.bond_deals_outside_rounds.push(clone(d));
}, /bond deals listed/);
sabotage('a bond deal the rounds already hold', (c) => {
  // give the first added deal the name, county and year of a 4% round award
  const d = c.out.meta.bond_deals_outside_rounds[0];
  const p = c.feed.features.find((f) => f.properties.CHFA_RecordID === d.chfa_record_id).properties;
  const a = c.ledger.awards.find((x) => x.federal_credit_type === '4%' && x.county_fips);
  Object.assign(p, { ReportedName: a.name, PROJECT: a.name, CNTY_FIPS: a.county_fips, AwardYear: a.year });
}, /bond deals listed/);
sabotage('bond homes left out of a county', (c) => {
  const r = c.out.counties.find((x) => x.funding.bond_units_outside_rounds > 0);
  r.funding.lihtc_units = r.funding.round_report_lihtc_units;
}, /units != rounds \+ bond deals/);
sabotage('a ledger amount changed', (c) => {
  const a = c.ledger.awards.find((x) => x.program.startsWith('Prop 123') && num(x.amount_awarded));
  a.amount_awarded += 1000;
}, /Prop 123 dollars/);
sabotage('a by-year row changed', (c) => { c.out.statewide.by_year[0].tax_credit_awards += 1; }, /by_year tax_credit_awards/);
sabotage('a mismatched document let into the ledger', (c) => {
  const d = c.documents.documents.find((x) => USABLE.has(x.status) && c.ledger.awards.some((a) => a.source_file === x.file));
  d.status = 'mismatch';
}, /not marked usable/);
// The review list can be empty, so this one makes its own unusable document.
sabotage('a review document missing from the tab list', (c) => {
  c.documents.documents.push({ file: 'sabotage-award-report.pdf', status: 'mismatch' });
}, /review list/);
// No document may have a withheld units column today, so this one withholds one.
sabotage('a withheld unit count kept in the ledger', (c) => {
  const a = c.ledger.awards.find((x) => x.total_units != null);
  const d = c.documents.documents.find((x) => x.file === a.source_file);
  d.status = 'units_withheld';
  d.units_withheld = ['total_units'];
}, /kept from a withheld units column/);
sabotage('an unknown unit count written as 0', (c) => { c.ledger.awards.find((a) => a.total_units == null).total_units = 0; }, /is 0, not null/);
sabotage('the undercount note miscounted', (c) => { c.out.meta.lihtc_awards_without_units += 1; }, /awards without units/);
sabotage('an unmeasurable coverage written as 0', (c) => {
  const r = c.out.counties.find((x) => x.funding.lihtc_units_per_100_gap === null);
  r.funding.lihtc_units_per_100_gap = 0;
}, /coverage 0 with gap/);
sabotage('a quadrant that contradicts the split', (c) => {
  const r = c.out.counties.find((x) => x.quadrant === 'underserved'
    && Math.abs(x.funding.lihtc_units_per_100_gap - c.out.meta.quadrant_split.lihtc_units_per_100_gap) > 1);
  r.quadrant = 'aligned';
}, /quadrant aligned, split says underserved/);
sabotage('the tab panel removed', (c) => {
  c.html = c.html.replace('role="tabpanel" id="tab-need"', 'role="region" id="tab-need"');
}, /tab tab-need has no panel/);
sabotage('two tabs sharing one id', (c) => {
  c.html = c.html.replace('id="btn-need" aria-selected="false" aria-controls="tab-need"', 'id="btn-funding" aria-selected="false" aria-controls="tab-need"');
}, /duplicate tab ids: btn-funding/);
sabotage('the tab never initialised on reveal', (c) => {
  c.html = c.html.replace("targetId === 'tab-need' && window.FundingVsNeed", "targetId === 'tab-ned' && window.FundingVsNeed");
}, /never draws the Funding vs Need tab/);
sabotage('the tab script reading another file', (c) => {
  c.js = c.js.replace("var FILE = 'derived/funding-vs-need.json'", "var FILE = 'derived/funding.json'");
}, /the tab reads/);

// The matcher on small cases: what it pairs and what it leaves as a bond deal.
run('matchBondDeals pairs renamed and split deals and leaves the rest', () => {
  const award = (name, county_fips, year, units, type = '4%', location = null, detail = null) => ({ program: 'LIHTC ' + type + ' + state', name, county_fips, year, restricted_units: units, federal_credit_type: type, location, detail });
  const prop = (name, CNTY_FIPS, AwardYear, LI_UNITS, TypeOfCredits = '4% Tax Exempt', PROJ_CTY = null) => ({ ReportedName: name, CNTY_FIPS, AwardYear, LI_UNITS, TypeOfCredits, PROJ_CTY, CHFA_RecordID: name + CNTY_FIPS });
  const awards = [
    award('Sheridan Station', '08059', 2017, 133),
    award('DHA 655 Broadway/Studebaker', '08031', 2019, 143),
    award('Remington fka: DMA Plaza Renovation', '08031', 2018, 124),
    award('Lowry Family Housing', '08031', 2016, 71),
    award('Thrive', '08031', 2020, 105, '9%'),
    award('Central Park II', '08031', 2021, 90, '9%'),
    award('Thistle scattered sites', '08013', 2019, 159, '4%', 'Longmont, Boulder', 'scattered site: Engish Village (32), Laguna Place (8)'),
    award('Mirasol III', '08069', 2018, 60, '4%', 'Loveland'),
    award('Indy Street Flats', '08059', 2017, 114, '4%', 'Lakewood'),
  ];
  const feedRows = [
    prop('Sheridan Station West', '08059', 2017, 133), // name
    prop('DHA 655 Broadway', '08031', 2019, 110), // one building
    prop('DHA Studebaker', '08031', 2019, 33), // the other building
    prop('DMA Plaza Renovation', '08031', 2018, 124), // fka name
    prop('Boulevard One Residences', '08031', 2016, 71), // renamed, same homes and year
    prop('Thrive 4', '08031', 2020, 105), // 4% half of a 9% twin: counted once
    prop('Sheridan Station West', '08005', 2017, 133), // same name, other county
    prop('Larkridge Apartments', '08001', 2017, 338), // a bond deal outside the rounds
    prop('Old Deal', '08001', 2012, 50), // before the window
    prop('Nine Percent Deal', '08001', 2018, 40, '9% Competitive'), // not 4%
    prop('Central Park III', '08031', 2021, 127), // another phase: added
    prop('Renova 5 English Village', '08013', 2019, 32, '4% and State', 'Longmont'), // a site, by its printed homes
    prop('Renova 5 Laguna Place', '08013', 2019, 8, '4% and State', 'Boulder'), // a site, by name
    prop('Meadows II', '08069', 2018, 59, '4% and State', 'Loveland'), // alike letters, no shared word: added
    prop('Eaton Street Apartments', '08059', 2017, 118, '4% and State', 'Westminster'), // another town: added
  ];
  const r = matchBondDeals(feedRows, awards, { firstYear: 2016, lastYear: 2026 });
  assert.equal(r.candidates, 13);
  assert.deepEqual(r.added.map((d) => d.name + ' ' + d.county_fips).sort(),
    ['Central Park III 08031', 'Eaton Street Apartments 08059', 'Larkridge Apartments 08001', 'Meadows II 08069', 'Sheridan Station West 08005']);
  assert.equal(r.matched.find((m) => m.p.ReportedName === 'Boulevard One Residences').rule, 'homes and year (renamed)');
  assert.ok(nameSimilarity('Sheridan Station', 'Sheridan Station West') >= 0.8);
  assert.ok(nameSimilarity('Academy Heights', 'Panorama Heights') < 0.8);
});

// A reworded page must stay green: the checks pin structure, not copy.
run('rewording the tab copy keeps every check green', () => {
  const copy = clone(real);
  copy.html = copy.html.replace('>Funding vs Need</button>', '>Subsidy and Need</button>')
    .replace('Funding vs need: where Colorado', 'Where Colorado');
  assert.notEqual(copy.html, real.html, 'the rewording did not apply');
  assert.deepEqual(checks(copy), []);
});

if (failures) {
  console.error(`funding-vs-need: ${failures} failed`);
  process.exit(1);
}
console.log('funding-vs-need: PASS');
