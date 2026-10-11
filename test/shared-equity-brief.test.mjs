/**
 * The shared equity brief is pinned to what it must agree with, not to its
 * wording: the deed-restriction table is the local housing funds records'
 * own summaries (data/policy/local-housing-funds.json), the resale
 * conventions it lists are the ones the For-Sale Market Study models
 * (data/policy/resale-conventions.json), and every dollar, percent, "times"
 * or "days" figure in its prose sits in a recorded source quote whose link
 * the brief cites. The pages that link to it must open this curated brief,
 * and the reader must render every section the feed carries.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const FEED = JSON.parse(read('data/policy_briefs_curated.json'));
const FUNDS = JSON.parse(read('data/policy/local-housing-funds.json'));
const CONVENTIONS = JSON.parse(read('data/policy/resale-conventions.json'));
const ID = 'shared-equity-for-sale-rental-2026';
const brief = FEED.briefs.find((b) => b.id === ID);
const section = (id) => brief.sections.find((s) => s.id === id);
const squash = (text) => String(text).replace(/\s+/g, ' ').trim();

test('the brief is curated and names the data it is checked against', () => {
  assert.ok(brief, `curated feed has no ${ID}`);
  assert.equal(brief.is_curated, true);
  assert.equal(brief.source_reviewed, true);
  assert.equal(brief.related_data, 'data/policy/resale-conventions.json');
  assert.equal(FEED.meta.brief_count, FEED.briefs.length, 'meta.brief_count disagrees with the feed');
});

test('the deed-restriction table is the local funds records, summary for summary', () => {
  const records = FUNDS.entries.filter((e) => e.tool === 'shared_equity_or_deed_restriction');
  assert.ok(records.length > 0, 'no deed-restriction records to compare against');
  const rows = section('deed-buydowns').table.rows;
  assert.equal(rows.length, records.length, 'table rows and records differ in number');
  records.forEach((record, i) => {
    assert.equal(rows[i][0], record.jurisdiction, `row ${i}: jurisdiction`);
    assert.equal(rows[i][1], record.summary, `row ${i}: summary differs from ${record.id}`);
    assert.ok(rows[i][2].includes(record.verification.checked), `row ${i}: check date`);
    assert.equal(rows[i][2].startsWith('Primary source'), record.verification.level === 'primary', `row ${i}: verification level`);
  });
});

test('the listed resale conventions are the ones the Market Study models', () => {
  const listed = section('for-sale-models').items;
  const modeled = CONVENTIONS.conventions.map((c) => `${c.label} (${c.source_program})`);
  assert.deepEqual(listed, modeled);
});

function prose() {
  const parts = [brief.takeaway, brief.summary, brief.implications];
  for (const s of brief.sections) {
    if (s.id === 'deed-buydowns') continue; // pinned to the records above
    parts.push(...(s.paragraphs || []), ...(s.items || []), s.note || '');
    if (s.table) parts.push(...s.table.rows.flat());
  }
  return squash(parts.join(' '));
}
const FIGURE = /\$\d[\d,]*|\d+(?:\.\d+)?%|\b\d[\d,.]*(?= (?:percent|times|days|properties|homes|land trusts))/g;

test('every figure in the prose sits in a recorded quote from a cited source', () => {
  const cited = new Set(brief.articles.map((a) => a.link));
  for (const q of brief.source_quotes) assert.ok(cited.has(q.link), `quote from an uncited source: ${q.link}`);
  const quoted = squash(brief.source_quotes.map((q) => q.quote).join(' ')).replace(/one hundred twenty/g, '120');
  const figures = prose().match(FIGURE) || [];
  assert.ok(figures.length >= 8, 'the scan found too few figures to check');
  for (const figure of figures) assert.ok(quoted.includes(figure), `${figure} is in the brief but in no source quote`);
});

test('the for-sale and route pages open this brief', () => {
  const pages = {
    'for-sale-market-study.html': '#msShareEquityBrief a',
    'deal-calculator.html': '#dc-shared-equity-brief',
    'select-jurisdiction.html': '#sjSharedEquityBrief a',
  };
  for (const [page, selector] of Object.entries(pages)) {
    const links = new JSDOM(read(page)).window.document.querySelectorAll(selector);
    assert.equal(links.length, 1, `${page}: expected one brief link`);
    const id = new URLSearchParams(links[0].getAttribute('href').split('?')[1]).get('id');
    assert.equal(id, ID, `${page} opens ${id}`);
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
  const doc = dom.window.document;
  for (const item of brief.sections) {
    const node = doc.querySelector(`[data-section="${item.id}"]`);
    assert.ok(node, `section ${item.id} not rendered`);
    assert.equal(node.querySelector('h2').textContent, item.heading);
    if (item.items) assert.equal(node.querySelectorAll('li').length, item.items.length, `${item.id}: list items`);
    if (item.table) {
      const rows = node.querySelectorAll(`table[data-table="${item.id}"] tbody tr`);
      assert.equal(rows.length, item.table.rows.length, `${item.id}: table rows`);
      // A prose last column must wrap, or it pushes the page wider than the screen.
      const table = node.querySelector(`table[data-table="${item.id}"]`);
      assert.equal(table.classList.contains('brief-table--wrap'), item.table.wrap === true, `${item.id}: wrap class`);
    }
  }
});
