/**
 * The livability brief states what CHFA's QAP requires and scores. Those
 * claims are pinned to the QAP text COHO already fetches
 * (data/audit/chfa-qap-watch.json), not to the brief's wording: every quoted
 * requirement must still be in the named CHFA document, every row of the
 * brief's QAP table must be backed by a quote from each section it cites (and
 * keep any "to the extent possible" the quote carries), and the point
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
import { briefRenderedText, wordBag } from '../scripts/lib/search-index.mjs';

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

test('every row of the QAP table is backed by a quote from the section it cites', () => {
  const table = brief.sections.find((s) => s.id === 'qap').table;
  const col = table.columns.indexOf('QAP section');
  assert.ok(col > 0 && table.rows.length > 0, 'no QAP table to check');
  table.rows.forEach((row, i) => {
    const cited = row[col].split(',').map((s) => s.trim());
    const backing = brief.qap_quotes.filter((q) => q.row === i);
    assert.ok(backing.length > 0, `QAP table row "${row[0]}" has no supporting quote`);
    for (const s of cited) {
      assert.ok(backing.some((q) => q.section === s), `row "${row[0]}" cites QAP ${s} with no quote from it`);
    }
    for (const q of backing) {
      assert.ok(cited.includes(q.section), `quote from QAP ${q.section} backs row "${row[0]}", which does not cite it`);
      // A requirement the QAP qualifies must not be stated as absolute.
      if (/to the extent possible/i.test(q.quote)) {
        assert.match(row[0], /to the extent possible/i, `row "${row[0]}" drops the QAP's "to the extent possible"`);
      }
      if (/sole discretion/i.test(q.quote)) {
        assert.match(row[0], /sole discretion/i, `row "${row[0]}" drops the QAP's "sole discretion" exception`);
      }
    }
  });
  for (const q of brief.qap_quotes) {
    assert.ok(Number.isInteger(q.row) && table.rows[q.row], `quote from QAP ${q.section} backs no row of the table`);
  }
});

test('the universal design points the brief states equal the QAP', () => {
  const quote = brief.qap_quotes.find((q) => /Universal Design/.test(q.quote) && /points?\)/.test(q.quote));
  assert.ok(quote, 'no universal design scoring quote');
  const qapPoints = toNumber(quote.quote.match(/\((\w+) points?\)/)[1]);
  const table = brief.sections.find((s) => s.id === 'qap').table;
  const row = table.rows.find((r) => r[2] === quote.section);
  assert.ok(row, 'no table row for the universal design section');
  assert.equal(toNumber(row[1].match(/^(\w+) points?$/)[1]), qapPoints, 'table points disagree with the QAP');
  // The QAP is a draft, so the summary may say "would award"; the point value
  // must still equal the QAP quote.
  const said = squash(brief.summary).match(/(?:would )?awards? (\w+) points? for universal design/i);
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
    if (item.items) assert.equal(node.querySelectorAll('ul > li').length, item.items.length, `${item.id}: list items`);
    if (item.steps) {
      const steps = [...node.querySelectorAll(`figure[data-steps="${item.id}"] ol > li`)];
      assert.equal(steps.length, item.steps.items.length, `${item.id}: diagram steps`);
      steps.forEach((li, i) => assert.equal(li.querySelector('.brief-step-label').textContent, item.steps.items[i].label));
    }
    if (item.see_also) {
      const a = node.querySelector('p.brief-note a');
      assert.ok(a, `${item.id}: see-also link not rendered`);
      const url = new URL(a.href);
      assert.equal(url.pathname.split('/').pop() + url.search, item.see_also.href.split('#')[0]);
    }
    if (item.table) {
      const rows = node.querySelectorAll(`table[data-table="${item.id}"] tbody tr`);
      assert.equal(rows.length, item.table.rows.length, `${item.id}: table rows`);
      rows.forEach((tr, i) => assert.equal(tr.firstElementChild.textContent, item.table.rows[i][0]));
    }
  }
  // The search index reads the brief through briefRenderedText; every word the reader shows in
  // the long-form sections must be in it, or the sections are rendered but not searchable.
  const indexed = new Set(wordBag(briefRenderedText(brief).join(' ')).split(' '));
  const shown = [...doc.querySelectorAll('[data-section] :is(h2, h3, p, li, caption, th, td, figcaption)')].map((n) => n.textContent).join(' ');
  const unindexed = wordBag(shown).split(' ').filter((w) => w.length >= 4 && !indexed.has(w));
  assert.deepEqual(unindexed, [], 'rendered section words missing from the search text');
  const verified = doc.querySelector('.brief-meta time:last-of-type');
  assert.equal(verified.dateTime, brief.verified, 'meta does not show the brief\'s own verification date');
});

// The services page and the brief point at each other: the brief's supportive housing section links to
// a section the services page really has, and the services page links to a section the brief really has.
test('the supportive housing section and the services page link to each other', () => {
  const psh = brief.sections.find((s) => s.id === 'supportive-housing');
  assert.ok(psh && psh.see_also, 'no supportive housing section with a services link');
  const [page, hash] = psh.see_also.href.split('#');
  assert.equal(page, 'resident-services.html');
  const services = new JSDOM(read(page)).window.document;
  assert.ok(services.getElementById(hash), `resident-services.html has no #${hash}`);
  const back = services.querySelector('#rs-design-link a[href^="research-brief.html"]');
  assert.ok(back, 'resident-services.html does not link back to the brief');
  const url = new URL(back.getAttribute('href'), 'https://example.org/');
  assert.equal(url.searchParams.get('id'), ID);
  const target = url.hash.replace(/^#brief-section-/, '');
  assert.ok(brief.sections.some((s) => s.id === target), `the services link opens #brief-section-${target}, which the brief does not have`);
});

// The brief's PSH figures are the trial's own: 724 randomized, 77% housed at three years. The trial counts
// only participants who were still living, so both statements must carry that exclusion.
test('the Denver trial figures agree wherever the brief states them', () => {
  const psh = brief.sections.find((s) => s.id === 'supportive-housing').paragraphs.join(' ');
  const inSection = psh.match(/(\d+)% of those it housed, not counting those who died, were still in stable housing\s+three years later/);
  const inSummary = squash(brief.summary).match(/(\d+)% of the people it housed, not counting those who died, were still housed three years later/);
  assert.ok(inSection && inSummary, 'the three-year housing figure is missing from the section or the summary');
  assert.equal(inSection[1], inSummary[1], 'summary and section disagree on the three-year figure');
  assert.ok(brief.articles.some((a) => /Denver Supportive Housing Social Impact Bond/.test(a.title)), 'the Denver trial is not cited');
});
