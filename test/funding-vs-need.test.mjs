#!/usr/bin/env node
/**
 * Funding vs Need: the award ledger, the county roll-up, and the Deep Dive tab
 * that renders it must agree with each other and with the data they are built
 * from.
 *
 * Every check is relational, recomputed from an input rather than read back:
 *   - the 64 county rows are exactly the ranking index's counties, by 5-digit FIPS;
 *   - statewide LIHTC units and Prop 123 dollars equal sums over the ledger,
 *     and the by-year rows add up to them;
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
import { build } from '../scripts/funding/build_funding_vs_need.mjs';

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
};
const USABLE = new Set(['ok', 'no_total_line', 'accepted_by_review']);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clone = (o) => JSON.parse(JSON.stringify(o));

function checks({ out, ledger, documents, ranking, html, js }) {
  const fails = [];
  const fail = (m) => fails.push(m);

  // counties: exactly the index's, as 5-digit strings
  const want = ranking.rankings.filter((r) => r.type === 'county').map((r) => r.geoid).sort();
  const got = out.counties.map((c) => c.fips).sort();
  if (want.length !== 64) fail(`ranking index has ${want.length} counties`);
  if (JSON.stringify(want) !== JSON.stringify(got)) fail('county FIPS differ from the ranking index');
  if (!got.every((f) => typeof f === 'string' && /^08\d{3}$/.test(f))) fail('a county FIPS is not a 5-digit 08xxx string');

  // statewide totals recomputed from the ledger
  const lihtc = ledger.awards.filter((a) => a.program.startsWith('LIHTC'));
  const units = lihtc.reduce((s, a) => s + (num(a.restricted_units) ?? num(a.total_units) ?? 0), 0);
  if (out.statewide.lihtc_units !== units) fail(`statewide LIHTC units ${out.statewide.lihtc_units} != ledger ${units}`);
  const p123 = ledger.awards.filter((a) => a.program.startsWith('Prop 123') && a.program !== 'Prop 123 Modular Finance');
  const dollars = p123.reduce((s, a) => s + (num(a.amount_awarded) ?? num(a.amount_requested) ?? 0), 0);
  if (out.statewide.prop123_dollars !== dollars) fail(`statewide Prop 123 dollars ${out.statewide.prop123_dollars} != ledger ${dollars}`);
  const placed = out.counties.reduce((s, c) => s + c.funding.lihtc_units, 0);
  const unplaced = lihtc.filter((a) => !a.county_fips).reduce((s, a) => s + (num(a.restricted_units) ?? num(a.total_units) ?? 0), 0);
  if (placed + unplaced !== units) fail(`county LIHTC units ${placed} + unplaced ${unplaced} != ${units}`);
  for (const k of ['lihtc_units', 'prop123_dollars', 'tax_credit_awards', 'prop123_awards']) {
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
    if (!controls.includes('tab-funding')) fail('no Funding vs Need tab button');
    for (const id of controls) {
      if (!new RegExp(`role="tabpanel" id="${id}"`).test(html)) fail(`tab ${id} has no panel`);
    }
  }
  if (!/var panels = Array\.prototype\.map\.call\(tabs, function \(t\) \{\s*return document\.getElementById\(t\.getAttribute\('aria-controls'\)\)/.test(html)) {
    fail('the toggle script no longer finds its panels from the tab buttons');
  }
  if (!/targetId === 'tab-funding' && window\.FundingVsNeed/.test(html)) fail('the toggle script never draws the Funding vs Need tab');
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
sabotage('a ledger amount changed', (c) => {
  const a = c.ledger.awards.find((x) => x.program.startsWith('Prop 123') && num(x.amount_awarded));
  a.amount_awarded += 1000;
}, /Prop 123 dollars/);
sabotage('a by-year row changed', (c) => { c.out.statewide.by_year[0].tax_credit_awards += 1; }, /by_year tax_credit_awards/);
sabotage('a mismatched document let into the ledger', (c) => {
  const d = c.documents.documents.find((x) => USABLE.has(x.status) && c.ledger.awards.some((a) => a.source_file === x.file));
  d.status = 'mismatch';
}, /not marked usable/);
sabotage('a review document dropped from the tab list', (c) => { c.out.meta.documents_needing_review.pop(); }, /review list/);
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
  c.html = c.html.replace('role="tabpanel" id="tab-funding"', 'role="region" id="tab-funding"');
}, /tab tab-funding has no panel/);
sabotage('the tab never initialised on reveal', (c) => {
  c.html = c.html.replace("targetId === 'tab-funding' && window.FundingVsNeed", "targetId === 'tab-fund' && window.FundingVsNeed");
}, /never draws the Funding vs Need tab/);
sabotage('the tab script reading another file', (c) => {
  c.js = c.js.replace("var FILE = 'derived/funding-vs-need.json'", "var FILE = 'derived/funding.json'");
}, /the tab reads/);

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
