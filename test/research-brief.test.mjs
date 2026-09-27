/** The reader's claims must agree with its feed and dataset, not pinned prose. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'research-brief.html'), 'utf8');
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const FEED = read('data/policy_briefs_curated.json');
const FEES = read('data/policy/fee-reductions.json');
const feeBrief = FEED.briefs.find((brief) => brief.related_data === 'data/policy/fee-reductions.json');
const normalize = (text) => text.replace(/\s+/g, ' ').trim();

async function runPage(t, { id = feeBrief.id, feed = FEED, fees = FEES, fail = '', http = 0,
  base = 'https://pggllc.github.io/Housing-Analytics/' } = {}) {
  const requests = [];
  let prints = 0;
  const dom = new JSDOM(HTML, {
    url: base + 'research-brief.html' + (id === null ? '' : '?id=' + encodeURIComponent(id)),
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = async (url) => {
        const name = String(url);
        requests.push(name);
        if (fail && name.includes(fail)) {
          if (http) return { ok: false, status: http };
          throw new Error('Network disconnected');
        }
        const payload = name.includes('policy_briefs_curated') ? feed : fees;
        return { ok: true, json: async () => structuredClone(payload) };
      };
      window.print = () => { prints++; };
    },
  });
  t.after(() => dom.window.close());
  for (let i = 0; i < 100; i++) {
    if (!dom.window.document.getElementById('brief-content').hidden) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const doc = dom.window.document;
  assert.equal(doc.getElementById('brief-content').hidden, false, 'the reader never left its loading state');
  return { doc, window: dom.window, requests, prints: () => prints };
}

function shownCount(doc, key) {
  const node = doc.querySelector(`[data-count="${key}"]`);
  assert.ok(node, `no visible ${key} count`);
  assert.equal(node.closest('[hidden]'), null);
  assert.match(node.textContent, /^\d+$/);
  return Number(node.textContent);
}

function checkGroups(doc, entries, allEntries = entries) {
  assert.ok(entries.length > 0, 'no records to check');
  for (const field of ['measure', 'kind']) {
    const table = doc.querySelector(`table[data-group="${field}"]`);
    assert.ok(table, `${field} table is missing`);
    const rows = [...table.querySelectorAll('tbody tr')];
    const expectedValues = [...new Set(allEntries.map((entry) => entry[field]))].sort();
    assert.ok(expectedValues.length > 1, 'the enum coverage scan is vacuous');
    const labels = rows.map((row) => row.dataset.value);
    for (const value of expectedValues) assert.ok(labels.includes(value), `no label for ${field}=${value}`);
    assert.equal(new Set(labels).size, rows.length, 'duplicate labels/counts');
    for (const row of rows) {
      const value = row.dataset.value;
      assert.ok(row.querySelector('th[scope="row"]').textContent.trim(), `empty label for ${value}`);
      assert.ok(row.querySelector('.brief-definition').textContent.trim(), `no plain-language definition for ${value}`);
      assert.equal(Number(row.querySelector('td').textContent),
        entries.filter((entry) => entry[field] === value).length,
        `rendered ${field}=${value} count disagrees with fee-reductions.json`);
    }
    assert.equal(rows.reduce((sum, row) => sum + Number(row.querySelector('td').textContent), 0), entries.length);
  }
}

test('every dataset measure/kind has a definition and its rendered count equals the Colorado subset', async (t) => {
  const { doc } = await runPage(t);
  const coEntries = FEES.entries.filter((entry) => entry.state === 'CO');
  const oneTime = coEntries.filter((entry) => entry.recurrence === 'one_time');
  checkGroups(doc, coEntries, FEES.entries);
  assert.equal(shownCount(doc, 'total'), coEntries.length);
  assert.equal(shownCount(doc, 'comparison'), FEES.entries.filter((entry) => entry.state !== 'CO').length);
  assert.equal(shownCount(doc, 'discretionary'), oneTime.filter((entry) => entry.eligibility.by_right === false).length);
  assert.equal(shownCount(doc, 'discretionary-total'), oneTime.length);
  assert.equal(shownCount(doc, 'backfill'), coEntries.filter((entry) => entry.backfill.method === 'not_specified').length);
  assert.equal(shownCount(doc, 'backfill-total'), coEntries.length);
  const comparison = doc.querySelector('[data-count="comparison"]');
  assert.equal(doc.querySelectorAll('[data-count="comparison"]').length, 1);
  assert.equal(comparison.parentElement.tagName, 'P');
  assert.equal(comparison.parentElement.textContent,
    `plus ${FEES.entries.length - coEntries.length} out-of-state comparison records, not counted above`);
  assert.equal(comparison.parentElement, doc.getElementById('brief-dataset').lastElementChild);
});

test('reader backfill and discretionary shares agree with the brief and its curated-test counting basis', async (t) => {
  // Same independently recomputed populations as policy-briefs-curated.test.js:
  // backfill uses all Colorado records; discretion uses one-time Colorado records.
  const coEntries = FEES.entries.filter((entry) => entry.state === 'CO');
  const oneTime = coEntries.filter((entry) => entry.recurrence === 'one_time');
  assert.ok(coEntries.length > 0 && oneTime.length > 0, 'no Colorado measures to compare');
  const { doc } = await runPage(t);
  const briefText = feeBrief.title + ' ' + feeBrief.summary + ' ' + feeBrief.implications;
  const claims = [
    { key: 'backfill', pattern: /(\d+) of (\d+) fee measures/,
      expected: [coEntries.filter((entry) => entry.backfill.method === 'not_specified').length, coEntries.length] },
    { key: 'discretionary', pattern: /(\d+) of (\d+) one-time fee measures/,
      expected: [oneTime.filter((entry) => entry.eligibility.by_right === false).length, oneTime.length] },
  ];
  for (const { key, pattern, expected } of claims) {
    const claim = briefText.match(pattern);
    assert.ok(claim, `the brief has no ${key} share to compare`);
    const briefShare = claim.slice(1).map(Number);
    const readerShare = [shownCount(doc, key), shownCount(doc, key + '-total')];
    assert.deepEqual(briefShare, expected, `${key}: brief must agree with the independently recomputed dataset`);
    assert.deepEqual(readerShare, briefShare, `${key}: reader must use the same numerator and denominator as the brief`);
    const line = doc.querySelector(`[data-count="${key}"]`).parentElement.textContent;
    assert.ok(line.startsWith(`${readerShare[0]} of ${readerShare[1]} `), `${key}: show the denominator to the reader`);
  }
});

test('counts follow changed data, including by_right null versus false, rather than hardcoded totals', async (t) => {
  const fees = structuredClone(FEES);
  // One of each value, then one additional discretionary record. Keep the
  // expected answer independent from any counting helper in the page.
  fees.entries = [...new Set(FEES.entries.map((entry) => entry.measure))]
    .map((measure) => structuredClone(FEES.entries.find((entry) => entry.measure === measure)));
  fees.entries[0].eligibility.by_right = null;
  fees.entries[0].backfill.method = 'general_fund';
  const extra = structuredClone(fees.entries[0]);
  extra.eligibility.by_right = false;
  extra.backfill.method = 'not_specified';
  extra.kind = 'project_award';
  fees.entries.push(extra);
  // Neither of these belongs in the discretionary share. The recurring CO
  // record still belongs in the Colorado tables/backfill; the WA one does not.
  fees.entries.push({ ...structuredClone(extra), recurrence: 'recurring' });
  fees.entries.push({ ...structuredClone(extra), state: 'WA', recurrence: 'one_time' });
  const { doc } = await runPage(t, { fees });
  const coEntries = fees.entries.filter((entry) => entry.state === 'CO');
  const oneTime = coEntries.filter((entry) => entry.recurrence === 'one_time');
  checkGroups(doc, coEntries, fees.entries);
  assert.equal(shownCount(doc, 'total'), coEntries.length);
  assert.equal(shownCount(doc, 'discretionary'), oneTime.filter((entry) => entry.eligibility.by_right === false).length);
  assert.equal(shownCount(doc, 'discretionary-total'), oneTime.length);
  assert.equal(shownCount(doc, 'backfill'), coEntries.filter((entry) => entry.backfill.method === 'not_specified').length);
  assert.equal(shownCount(doc, 'backfill-total'), coEntries.length);
  assert.equal(shownCount(doc, 'comparison'), fees.entries.filter((entry) => entry.state !== 'CO').length);
});

test('the full brief, published/verified dates, and sections are shown in reading order', async (t) => {
  const { doc } = await runPage(t);
  assert.equal(doc.querySelector('h1').textContent, feeBrief.title);
  assert.equal(doc.title, feeBrief.title + ' | COHO Analytics');
  assert.deepEqual([...doc.querySelectorAll('.brief-meta time')].map((node) => node.dateTime),
    [feeBrief.generated, FEES.meta.as_of]);
  assert.equal(normalize([...doc.querySelectorAll('#brief-summary p')].map((p) => p.textContent).join(' ')), normalize(feeBrief.summary));
  assert.equal(normalize([...doc.querySelectorAll('#brief-implications p')].map((p) => p.textContent).join(' ')), normalize(feeBrief.implications));
  assert.deepEqual([...doc.querySelectorAll('#brief-content > section')].map((node) => node.id), [
    'brief-takeaway', 'brief-summary', 'brief-implications', 'brief-dataset', 'brief-limitations',
    'brief-sources', 'brief-related', 'brief-appendix',
  ]);
  const firstSentences = feeBrief.summary.split(/(?<=\.)\s+(?=[A-Z])/).slice(0, 2).join(' ');
  assert.equal(doc.querySelector('#brief-takeaway p').textContent, firstSentences);
});

test('an explicit takeaway takes precedence over the summary fallback', async (t) => {
  const feed = structuredClone(FEED);
  feed.briefs.find((brief) => brief.id === feeBrief.id).takeaway = 'A short reader takeaway.';
  const { doc } = await runPage(t, { feed });
  assert.equal(doc.querySelector('#brief-takeaway p').textContent, feed.briefs.find((brief) => brief.id === feeBrief.id).takeaway);
});

test('all articles are linked, with related data and the Markdown technical appendix', async (t) => {
  for (const brief of FEED.briefs.filter((item) => item.is_curated)) {
    const { doc, window } = await runPage(t, { id: brief.id });
    const links = [...doc.querySelectorAll('#brief-sources li > a')];
    assert.ok(brief.articles.length > 1, 'need multiple source links to exercise the original omission');
    assert.deepEqual(links.map((a) => a.href), brief.articles.map((article) => new URL(article.link, window.location.href).href));
    assert.deepEqual(links.map((a) => a.textContent), brief.articles.map((article) => article.title));
    assert.equal(doc.querySelector('#brief-related a').href, new URL(brief.related_data, window.location.href).href);
    const methods = brief.articles.filter((article) => new URL(article.link).pathname.endsWith('.md'));
    assert.deepEqual([...doc.querySelectorAll('#brief-appendix a')].map((a) => a.href), methods.map((article) => article.link));
  }
});

test('screening limitations show the first five dataset gaps and their full count', async (t) => {
  const { doc } = await runPage(t);
  assert.ok(FEES.meta.known_gaps.length > 5, 'gap truncation is not exercised');
  assert.deepEqual([...doc.querySelectorAll('#brief-limitations li')].map((li) => li.textContent), FEES.meta.known_gaps.slice(0, 5));
  assert.equal(shownCount(doc, 'gaps-shown'), 5);
  assert.equal(shownCount(doc, 'gaps-total'), FEES.meta.known_gaps.length);
  // These are data-interpretation rules, not discretionary editorial copy:
  // offers are not awards; deferred fees remain owed; absence is not evidence.
  const limits = doc.querySelector('#brief-limitations').textContent;
  assert.match(limits, /offers.*not.*awarded/);
  assert.match(limits, /deferral.*still owed/i);
  assert.match(limits, /no entry.*not.*no program/);
});

test('a brief without a local dataset does not invent a verification date or fee statistics', async (t) => {
  const brief = FEED.briefs.find((item) => item.related_data !== 'data/policy/fee-reductions.json');
  const { doc, requests } = await runPage(t, { id: brief.id });
  assert.equal(requests.length, 1);
  assert.equal(doc.querySelector('[data-count]'), null);
  assert.match(doc.querySelector('.brief-meta').textContent, /Data verified date not recorded/);
});

test('untrusted titles, body text, source labels and gaps render as text; unsafe URLs are not linked', async (t) => {
  const payload = '<img src=x onerror=alert(1)>';
  const feed = structuredClone(FEED);
  const brief = feed.briefs.find((item) => item.id === feeBrief.id);
  for (const field of ['title', 'takeaway', 'summary', 'implications']) brief[field] = payload;
  brief.articles = [{ title: payload, source: payload, link: 'javascript:alert(1)' }];
  const fees = structuredClone(FEES);
  fees.meta.known_gaps = [payload];
  const { doc } = await runPage(t, { feed, fees });
  assert.equal(doc.querySelector('h1').textContent, payload);
  assert.equal(doc.querySelector('#brief-summary p').textContent, payload);
  assert.equal(doc.querySelector('#brief-limitations li').textContent, payload);
  assert.ok(doc.querySelector('#brief-sources').textContent.includes(payload));
  assert.equal(doc.querySelector('#brief-content img'), null);
  assert.equal(doc.querySelector('#brief-content [onerror]'), null);
  assert.equal(doc.querySelector('a[href^="javascript:"]'), null);
});

for (const id of ['no-such-brief', null]) {
  test(`${id === null ? 'missing' : 'unknown'} id shows Brief not found and a path back`, async (t) => {
    const { doc } = await runPage(t, { id });
    assert.equal(doc.querySelector('h1').textContent, 'Brief not found');
    assert.ok(doc.querySelector('.brief-actions a[href="policy-briefs.html"]'));
    assert.equal(doc.getElementById('brief-print').hidden, true);
    assert.equal(doc.querySelector('[data-count]'), null);
  });
}

for (const fail of ['policy_briefs_curated.json', 'fee-reductions.json']) {
  for (const http of [0, 503]) {
    test(`${fail} ${http ? 'HTTP error' : 'network failure'} shows Unavailable and reason, never zero counts`, async (t) => {
      const { doc } = await runPage(t, { fail, http });
      assert.equal(doc.querySelector('h1').textContent, 'Unavailable');
      const message = doc.getElementById('brief-content').textContent;
      assert.ok(message.includes(fail));
      assert.ok(message.includes(http ? 'HTTP 503' : 'Network disconnected'));
      assert.equal(doc.querySelector('[data-count]'), null);
      assert.equal(doc.getElementById('brief-print').hidden, true);
      assert.ok(doc.querySelector('.brief-actions a[href="policy-briefs.html"]'));
    });
  }
}

test('malformed feed or dataset is unavailable instead of fabricating an empty result', async (t) => {
  const badEnum = structuredClone(FEES);
  badEnum.entries[0].measure = 'unknown_measure';
  for (const options of [{ feed: {} }, { fees: {} }, { fees: badEnum }]) {
    const { doc } = await runPage(t, options);
    assert.equal(doc.querySelector('h1').textContent, 'Unavailable');
    assert.equal(doc.querySelector('[data-count]'), null);
  }
});

test('print control calls window.print, and the reader loads the shared head/nav and print styles', async (t) => {
  const { doc, prints } = await runPage(t);
  const sources = [...doc.querySelectorAll('script[src]')].map((script) => script.getAttribute('src'));
  for (const script of ['path-resolver', 'config', 'fetch-helper', 'navigation', 'dark-mode-toggle', 'mobile-menu']) {
    assert.ok(sources.includes(`js/${script}.js`), `${script} missing`);
  }
  assert.ok(doc.querySelector('link[href="css/print.css"]'));
  assert.ok(doc.querySelector('a.skip-link[href="#main-content"]'));
  assert.ok(doc.querySelector('main#main-content header'));
  assert.ok(doc.querySelector('footer'));
  assert.equal(doc.getElementById('brief-print').hidden, false);
  doc.getElementById('brief-print').click();
  assert.equal(prints(), 1);
});
