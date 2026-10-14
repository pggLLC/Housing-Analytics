/**
 * The "Local workforce housing without tax credits" brief is pinned to what it
 * must agree with, not to its wording: the seasonal table is recomputed from
 * data/hna/second-homes-str.json, the tax table is the local-housing-funds
 * lodging records' own summaries, the program table is the resort program
 * records' own summaries and restriction types, the ballot measures it names
 * are the lodging/STR measures in the 2026 ballot data, and every dollar,
 * percent or count in its prose sits in a recorded quote from a cited source.
 * The pages that link to it must open it, and the reader must render it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const FEED = json('data/policy_briefs_curated.json');
const SHS = json('data/hna/second-homes-str.json');
const FUNDS = json('data/policy/local-housing-funds.json');
const RESORT = json('data/resort-workforce-housing-programs.json');
const ID = 'workforce-housing-without-tax-credits-2026';
const brief = FEED.briefs.find((b) => b.id === ID);
const section = (id) => brief.sections.find((s) => s.id === id);
const squash = (t) => String(t).replace(/ﬀ/g, 'ff').replace(/\s+/g, ' ').trim();

test('the brief is curated and names the data it is checked against', () => {
  assert.ok(brief, `curated feed has no ${ID}`);
  assert.equal(brief.is_curated, true);
  assert.equal(brief.source_reviewed, true);
  assert.equal(brief.related_data, 'data/resort-workforce-housing-programs.json');
  assert.equal(FEED.meta.brief_count, FEED.briefs.length);
});

test('the seasonal table is the second homes data: every reliable estimate at 40% or more, in order', () => {
  const expected = Object.values(SHS.geographies)
    .filter((r) => r.seasonal_homes && r.seasonal_homes.reliability === 'reliable' && r.seasonal_homes.share_of_housing_units >= 0.40)
    .sort((a, b) => b.seasonal_homes.share_of_housing_units - a.seasonal_homes.share_of_housing_units || a.name.localeCompare(b.name));
  const rows = section('second-homes').table.rows;
  assert.ok(expected.length >= 5, 'too few rows to compare');
  assert.equal(rows.length, expected.length, 'table rows and qualifying geographies differ in number');
  expected.forEach((r, i) => {
    const s = r.seasonal_homes;
    assert.equal(rows[i][0], r.name, `row ${i}`);
    assert.ok(rows[i][1].startsWith(s.units.toLocaleString('en-US')), `${r.name}: count`);
    assert.ok(rows[i][2].startsWith(`${Math.round(s.share_of_housing_units * 100)}%`), `${r.name}: share`);
    const own = (r.lodging_taxes || []).some((t) => t.status === 'adopted');
    const cty = (r.county_lodging_taxes || []).some((t) => t.status === 'adopted');
    assert.equal(rows[i][3], own ? 'Yes' : cty ? 'County tax' : 'None on record', `${r.name}: tax column`);
  });
});

test('the tax table is the lodging tax records, summary for summary', () => {
  const records = FUNDS.entries.filter((e) => e.tool === 'lodging_or_str_tax');
  const rows = section('taxes').table.rows;
  assert.equal(rows.length, records.length);
  records.forEach((r, i) => {
    assert.equal(rows[i][0], r.jurisdiction);
    assert.equal(rows[i][3], r.summary, `${r.id}: summary differs`);
    assert.equal(rows[i][2] === 'In effect', r.status === 'adopted', `${r.id}: status`);
  });
  const cited = new Set(brief.articles.map((a) => a.link));
  for (const r of records) assert.ok(cited.has(r.source.url), `${r.id}: source not cited`);
});

test('the program table is the resort program records, summary and rule for summary and rule', () => {
  const all = RESORT.authorities.flatMap((a) => (a.key_programs || []).concat(a.funding || []));
  const key = { 'occupancy-only': 'Occupancy only', 'price-capped': 'Price-capped', unverified: 'not confirmed', 'n/a': 'Not a deed restriction' };
  const rows = section('toolkit').table.rows;
  assert.ok(rows.length >= 10);
  for (const [, name, summary, rule] of rows) {
    const p = all.find((x) => x.name === name);
    assert.ok(p, `${name} is not a program record`);
    assert.equal(summary, p.summary, `${name}: summary differs from the record`);
    assert.ok(rule.includes(key[p.restriction_type]), `${name}: rule "${rule}" vs ${p.restriction_type}`);
  }
});

test('the 2026 ballot measures it names are the lodging/STR measures in the ballot data', () => {
  const named = new Set();
  for (const r of Object.values(SHS.geographies)) for (const b of r.ballot_measures || []) named.add(b.jurisdiction.replace(/ \((town|city)\)$/, ''));
  assert.ok(named.size >= 1, 'no ballot measures in the data');
  const text = section('taxes').paragraphs.join(' ');
  for (const n of named) assert.ok(text.includes(n.replace(' County', '')), `${n} is on the ballot but not named`);
});

function prose() {
  const parts = [brief.takeaway, brief.summary, brief.implications];
  for (const s of brief.sections) {
    if (['second-homes', 'taxes', 'toolkit'].includes(s.id)) { parts.push(...(s.paragraphs || [])); continue; } // tables pinned above
    parts.push(...(s.paragraphs || []), ...(s.items || []));
  }
  return squash(parts.join(' '));
}
const FIGURE = /\$\d[\d,]*|\d+(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+\b|\b(?!(?:19|20)\d{2}\b)[1-9]\d+\b/g;

test('every figure in the prose sits in a recorded quote from a cited source', () => {
  const cited = new Set(brief.articles.map((a) => a.link));
  for (const q of brief.source_quotes) assert.ok(cited.has(q.link), `quote from an uncited source: ${q.link}`);
  const quoted = squash(brief.source_quotes.map((q) => q.quote).join(' '))
    .replace(/(\d+(?:\.\d+)?) percent/gi, '$1%').replace(/\((\d+%)\)/g, '$1').replace(/two percent/gi, '2%').replace(/TEN PERCENT/g, '10%');
  const figures = prose().replace(/\b[A-Z]{2}\d{2}-\d+\b/g, '').match(FIGURE) || []; // bill numbers are names
  assert.ok(figures.length >= 15, `the scan found only ${figures.length} figures`);
  for (const f of figures) assert.ok(quoted.includes(f), `${f} is in the brief but in no source quote`);
});

test('the second homes panel, resort panel, route page and incentives page open this brief', () => {
  for (const file of ['js/components/second-homes-panel.js', 'js/components/resort-wfh.js']) {
    assert.ok(read(file).includes(ID), `${file} does not link the brief`);
  }
  const pages = { 'select-jurisdiction.html': '#sjWorkforceBrief a', 'local-incentives.html': '#liWorkforceBrief a' };
  for (const [page, sel] of Object.entries(pages)) {
    const links = new JSDOM(read(page)).window.document.querySelectorAll(sel);
    assert.equal(links.length, 1, `${page}: expected one brief link`);
    assert.equal(new URLSearchParams(links[0].getAttribute('href').split('?')[1]).get('id'), ID);
  }
});

test('the reader renders every section, list and table the feed carries', async (t) => {
  const dom = new JSDOM(read('research-brief.html'), {
    url: 'https://pggllc.github.io/Housing-Analytics/research-brief.html?id=' + ID,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = async () => ({ ok: true, json: async () => structuredClone(FEED) });
      window.print = () => {};
    },
  });
  t.after(() => dom.window.close());
  const host = dom.window.document.getElementById('brief-content');
  for (let i = 0; i < 100 && host.hidden; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(host.hidden, false, 'the reader never rendered');
  for (const item of brief.sections) {
    const node = dom.window.document.querySelector(`[data-section="${item.id}"]`);
    assert.ok(node, `section ${item.id} not rendered`);
    if (item.items) assert.equal(node.querySelectorAll('li').length, item.items.length);
    if (item.table) assert.equal(node.querySelectorAll(`table[data-table="${item.id}"] tbody tr`).length, item.table.rows.length);
  }
});
