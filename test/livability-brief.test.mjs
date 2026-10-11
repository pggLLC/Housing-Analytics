/**
 * The livability brief states what CHFA's QAP requires and scores. Those
 * claims are pinned to the QAP text COHO already fetches
 * (data/audit/chfa-qap-watch.json), not to the brief's wording: every quoted
 * requirement must still be in the named CHFA document, every QAP section the
 * brief's table cites must be backed by a quote and the reverse, and the point
 * value the brief states for universal design must equal the one in the QAP.
 * The Deal Calculator's link must open this brief, and the reader must render
 * every section the feed carries.
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
const ID = 'livability-universal-design-2026';
const brief = FEED.briefs.find((b) => b.id === ID);
const squash = (text) => String(text).replace(/\s+/g, ' ').trim();
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const toNumber = (word) => (/^\d+$/.test(word) ? Number(word) : WORDS[word.toLowerCase()]);

test('the brief is curated and names the QAP text it is checked against', () => {
  assert.ok(brief, `curated feed has no ${ID}`);
  assert.equal(brief.is_curated, true);
  assert.equal(brief.source_reviewed, true);
  assert.equal(brief.related_data, 'data/audit/chfa-qap-watch.json');
  assert.equal(FEED.meta.brief_count, FEED.briefs.length, 'meta.brief_count disagrees with the feed');
});

test('every quoted QAP requirement is in the named CHFA document', () => {
  const watch = JSON.parse(read(brief.related_data));
  const doc = watch.documents.find((d) => d.title === brief.qap_document);
  assert.ok(doc, `the QAP watch no longer carries "${brief.qap_document}"`);
  assert.equal(doc.fetch_ok, true, 'the named QAP document was not fetched');
  assert.notEqual(doc.text_truncated, true, 'the QAP text is truncated; a missing quote would be unprovable');
  const text = squash(doc.text);
  assert.ok(Array.isArray(brief.qap_quotes) && brief.qap_quotes.length >= 5, 'the scan has too few quotes to check');
  for (const { section, quote } of brief.qap_quotes) {
    assert.ok(text.includes(squash(quote)), `QAP ${section}: "${quote}" is not in ${brief.qap_document}`);
  }
  const pdf = brief.articles.find((a) => a.link === doc.url);
  assert.ok(pdf, 'the brief does not cite the PDF its QAP claims are checked against');
});

test('the QAP table and the quotes cite the same sections', () => {
  const table = brief.sections.find((s) => s.id === 'qap').table;
  const col = table.columns.indexOf('QAP section');
  assert.ok(col > 0 && table.rows.length > 0, 'no QAP table to check');
  const cited = new Set(table.rows.flatMap((row) => row[col].split(',').map((s) => s.trim())));
  const quoted = new Set(brief.qap_quotes.map((q) => q.section));
  for (const s of cited) assert.ok(quoted.has(s), `table cites QAP ${s} with no supporting quote`);
  for (const s of quoted) assert.ok(cited.has(s), `quote for QAP ${s} backs no row of the table`);
});

test('the universal design points the brief states equal the QAP', () => {
  const quote = brief.qap_quotes.find((q) => /Universal Design/.test(q.quote) && /points?\)/.test(q.quote));
  assert.ok(quote, 'no universal design scoring quote');
  const qapPoints = toNumber(quote.quote.match(/\((\w+) points?\)/)[1]);
  const table = brief.sections.find((s) => s.id === 'qap').table;
  const row = table.rows.find((r) => r[2] === quote.section);
  assert.ok(row, 'no table row for the universal design section');
  assert.equal(toNumber(row[1].match(/^(\w+) points?$/)[1]), qapPoints, 'table points disagree with the QAP');
  const said = squash(brief.summary).match(/awards (\w+) points? for universal design/i);
  assert.ok(said, 'the summary no longer states the universal design points');
  assert.equal(toNumber(said[1]), qapPoints, 'summary points disagree with the QAP');
});

test('the Deal Calculator links to this brief', () => {
  const doc = new JSDOM(read('deal-calculator.html')).window.document;
  const links = [...doc.querySelectorAll('#dc-edu-livability a[href^="research-brief.html"]')];
  assert.equal(links.length, 1, 'expected one brief link in the livability card');
  const id = new URLSearchParams(links[0].getAttribute('href').split('?')[1]).get('id');
  assert.ok(FEED.briefs.some((b) => b.id === id && b.is_curated), `link opens ${id}, which is not a curated brief`);
  assert.equal(id, ID);
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
  assert.ok(brief.sections.length > 0, 'no sections to check');
  for (const item of brief.sections) {
    const node = doc.querySelector(`[data-section="${item.id}"]`);
    assert.ok(node, `section ${item.id} not rendered`);
    assert.equal(node.querySelector('h2').textContent, item.heading);
    if (item.items) assert.equal(node.querySelectorAll('li').length, item.items.length, `${item.id}: list items`);
    if (item.table) {
      const rows = node.querySelectorAll(`table[data-table="${item.id}"] tbody tr`);
      assert.equal(rows.length, item.table.rows.length, `${item.id}: table rows`);
      rows.forEach((tr, i) => assert.equal(tr.firstElementChild.textContent, item.table.rows[i][0]));
    }
  }
  const verified = doc.querySelector('.brief-meta time:last-of-type');
  assert.equal(verified.dateTime, brief.verified, 'meta does not show the brief\'s own verification date');
});
