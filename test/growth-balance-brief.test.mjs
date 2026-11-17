/**
 * The "Growth and homes for local workers" brief is pinned to what it must
 * agree with, not to its wording: its fee, tax, deed-restriction and land
 * tables are the local housing funds records' own summaries, its Proposition
 * 123 counts are the DOLA-built commitments file, and every dollar, percent or
 * count in its prose sits in a recorded quote from a cited source. The reader
 * must render every section, list and table.
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
const FUNDS = json('data/policy/local-housing-funds.json');
const P123 = json('data/policy/prop123_jurisdictions.json');
const ID = 'co-growth-housing-balance-2026';
const brief = FEED.briefs.find((b) => b.id === ID);
const section = (id) => brief.sections.find((s) => s.id === id);
const squash = (t) => String(t).replace(/\s+/g, ' ').trim();
const fmt = (n) => n.toLocaleString('en-US');

test('the brief is curated and names the data it is checked against', () => {
  assert.ok(brief, `curated feed has no ${ID}`);
  assert.equal(brief.is_curated, true);
  assert.equal(brief.source_reviewed, true);
  assert.equal(brief.related_data, 'data/policy/local-housing-funds.json');
  assert.equal(FEED.meta.brief_count, FEED.briefs.length);
});

const TABLES = { linkage: ['linkage_fee'], str: ['lodging_or_str_tax'], inclusionary: ['in_lieu_fee'], deeds: ['shared_equity_or_deed_restriction'], land: ['land_bank_or_public_land'] };
for (const [id, tools] of Object.entries(TABLES)) {
  test(`the ${id} table is the local housing funds records, summary for summary`, () => {
    const records = FUNDS.entries.filter((e) => tools.includes(e.tool));
    const rows = section(id).table.rows;
    assert.ok(records.length >= 1);
    assert.equal(rows.length, records.length, `${id}: rows and records differ in number`);
    records.forEach((r, i) => {
      assert.equal(rows[i][0], r.jurisdiction);
      assert.equal(rows[i][2], r.summary, `${r.id}: summary differs`);
      assert.equal(rows[i][1] === 'In effect', r.status === 'adopted', `${r.id}: status`);
    });
    const cited = new Set(brief.articles.map((a) => a.link));
    for (const r of records) assert.ok(cited.has(r.source.url), `${r.id}: source not cited`);
  });
}

test('the Proposition 123 counts are the commitments file', () => {
  const text = section('state-money').paragraphs[0];
  assert.ok(text.includes(`${fmt(P123.jurisdictions.length)} local governments filed commitments for ${fmt(P123.total_projected_units)} homes`));
  assert.ok(text.includes(`${fmt(P123.next_cycle.filed_count)} had filed for 2027 to 2029 by the ${'November 1, 2026'} deadline`));
  assert.equal(P123.next_cycle.filing_deadline, '2026-11-01');
});

test('the right-of-first-refusal line carries the Adams County record as written', () => {
  const adams = FUNDS.entries.find((e) => e.id === 'f-adams-county-rofr-assigned-to-maiker');
  assert.ok(adams && section('investors').items[0].endsWith(adams.summary));
});

function prose() {
  const parts = [brief.takeaway, brief.summary, brief.implications];
  for (const s of brief.sections) {
    let paras = s.paragraphs || [];
    if (s.id === 'state-money') paras = paras.slice(1); // counts pinned above
    let items = s.items || [];
    if (s.id === 'investors') items = items.map((t, i) => (i === 0 ? t.split('. Adams County')[0] : t)); // record pinned above
    parts.push(...paras, ...items);
    if (s.id === 'match') for (const row of s.table.rows) parts.push(...row);
  }
  return squash(parts.join(' '));
}
const SPELLED = [[/AT LEAST ONE PERCENT/g, '1%'], [/FIVE THOUSAND/g, '5,000'], [/ONE THOUSAND/g, '1,000'], [/sixty percent/gi, '60%'], [/one hundred percent/gi, '100%'], [/thirty percent/gi, '30%'], [/TEN ONE-HUNDREDTHS/g, '10%'], [/FIFTEEN ONE-HUNDREDTHS/g, '15%'], [/TWENTY ONE-HUNDREDTHS/g, '20%'], [/NOT LESS THAN FIVE UNITS/g, 'five'], [/(\d+(?:\.\d+)?) percent/gi, '$1%'], [/nearly \$950,000/g, '$950,000'], [/2 to 4%/g, '2% 4%'], [/ONE HUNDRED UNITS AND NOT LESS THAN FIFTEEN UNITS/g, '100 15']];
const FIGURE = /\$\d[\d,]*(?:\.\d+)?(?: million)?|\d+(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+\b|\b(?!(?:19|20)\d{2}\b)[1-9]\d+\b/g;

test('every figure in the prose sits in a recorded quote from a cited source', () => {
  const cited = new Set(brief.articles.map((a) => a.link));
  for (const q of brief.source_quotes) assert.ok(cited.has(q.link), `quote from an uncited source: ${q.link}`);
  let quoted = squash(brief.source_quotes.map((q) => q.quote).join(' '));
  for (const [re, to] of SPELLED) quoted = quoted.replace(re, to);
  const figures = prose().replace(/\b[A-Z]{2}\d{2}-\d+\b/g, '').replace(/Proposition 123/g, '').match(FIGURE) || [];
  assert.ok(figures.length >= 40, `the scan found only ${figures.length} figures`);
  const missing = figures.filter((f) => !quoted.includes(f));
  assert.deepEqual(missing, [], `figures in the brief but in no source quote: ${missing.join(', ')}`);
});

test('renter and owner are named wherever the brief says who a tool helps', () => {
  const rows = section('match').table.rows;
  for (const r of rows) assert.match(r[2], /\((?:renters|owners)[^)]*\)$/i, `${r[0]}: says no tenure`);
  assert.match(section('fair').items.join(' '), /renters and owners separately/);
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
    if (item.items) assert.equal(node.querySelectorAll(':scope li').length >= item.items.length, true, `${item.id}: list items`);
    if (item.table) assert.equal(node.querySelectorAll(`table[data-table="${item.id}"] tbody tr`).length, item.table.rows.length);
  }
});
