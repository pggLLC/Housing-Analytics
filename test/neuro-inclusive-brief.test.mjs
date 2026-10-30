/**
 * The neuro-inclusive housing brief is pinned to its sources, not its wording:
 * every quoted CHFA requirement must still be in the QAP text COHO fetches
 * (data/audit/chfa-qap-watch.json), every figure in its prose must sit in a
 * recorded quote from a cited source (or a checked QAP quote), its links to
 * the deal summaries must name deals we have, the livability brief and the
 * resident services page must open it, and the reader must render it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const FEED = JSON.parse(read('data/policy_briefs_curated.json'));
const ID = 'neuro-inclusive-housing-colorado-2026';
const brief = FEED.briefs.find((b) => b.id === ID);
const squash = (t) => String(t).replace(/\s+/g, ' ').trim();

test('the brief is curated and names the QAP text it is checked against', () => {
  assert.ok(brief, `curated feed has no ${ID}`);
  assert.equal(brief.is_curated, true);
  assert.equal(brief.source_reviewed, true);
  assert.equal(brief.related_data, 'data/audit/chfa-qap-watch.json');
  assert.equal(FEED.meta.brief_count, FEED.briefs.length);
});

test('every quoted QAP requirement is in the named CHFA document', () => {
  const watch = JSON.parse(read(brief.related_data));
  const doc = watch.documents.find((d) => d.title === brief.qap_document);
  assert.ok(doc, `the QAP watch no longer carries "${brief.qap_document}"`);
  assert.equal(doc.fetch_ok, true);
  assert.notEqual(doc.text_truncated, true);
  const text = squash(doc.text);
  assert.ok(brief.qap_quotes.length >= 5);
  for (const { section, quote } of brief.qap_quotes) {
    assert.ok(text.includes(squash(quote)), `QAP ${section}: "${quote}" is not in ${brief.qap_document}`);
  }
  assert.ok(brief.articles.some((a) => a.link === doc.url), 'the brief does not cite the QAP PDF');
});

// Statute, regulation and program names carry numbers that are not figures.
const CITES = /\b\d+ U\.S\.C\. [\w().]+|\b\d+ CFR [\d.()a-z]+(?: and [\d.]+)?|C\.R\.S\. [\d.-]+|Section 811|\b811\b|\b\d{4}-\d{2}\b/g;
const FIGURE = /\$\d+(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+\b|\b(?!(?:19|20)\d{2}\b)[1-9]\d+\b/g;
function prose() {
  const parts = [brief.takeaway, brief.summary, brief.implications];
  for (const s of brief.sections) {
    parts.push(...(s.paragraphs || []), ...(s.items || []));
    if (s.table) parts.push(...s.table.rows.flat());
  }
  return squash(parts.join(' ')).replace(CITES, '');
}

test('every figure in the prose sits in a recorded quote from a cited source', () => {
  const cited = new Set(brief.articles.map((a) => a.link));
  for (const q of brief.source_quotes) assert.ok(cited.has(q.link), `quote from an uncited source: ${q.link}`);
  const quoted = squash(brief.source_quotes.concat(brief.qap_quotes).map((q) => q.quote).join(' '))
    .replace(/(\d+(?:\.\d+)?) percent/gi, '$1%').replace(/Fifteen/g, '15');
  const figures = prose().match(FIGURE) || [];
  assert.ok(figures.length >= 25, `the scan found only ${figures.length} figures`);
  for (const f of figures) assert.ok(quoted.includes(f), `${f} is in the brief but in no source quote`);
});

test('the brief keeps meeting statements and private names out', () => {
  const all = JSON.stringify(brief);
  assert.doesNotMatch(all, /focus group|zoom/i, 'meeting notes belong on the member site');
  assert.doesNotMatch(all, /indi\W?build/i);
});

test('deal links open deal summaries we have', () => {
  for (const s of brief.sections) {
    const href = s.see_also && s.see_also.href;
    if (!href || !href.startsWith('deal-summary.html')) continue;
    const slug = new URLSearchParams(href.split('?')[1]).get('d');
    assert.ok(fs.existsSync(path.join(ROOT, 'data/deals', `${slug}.json`)), `no deal summary for ${slug}`);
  }
});

test('the livability brief and resident services page open this brief', () => {
  const liv = FEED.briefs.find((b) => b.id === 'livability-universal-design-2026');
  const ni = liv.sections.find((s) => s.id === 'neuro-inclusive');
  assert.equal(new URLSearchParams(ni.see_also.href.split('?')[1]).get('id'), ID);
  const links = new JSDOM(read('resident-services.html')).window.document.querySelectorAll('#rs-ni-link a');
  assert.equal(links.length, 1);
  assert.equal(new URLSearchParams(links[0].getAttribute('href').split('?')[1]).get('id'), ID);
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
