// The Local discussion panel on the gated place card (js/whitepaper/local-discussion.js).
// Pins:
//   1. executive view first: four key numbers, what it means, the next step;
//   2. the panel says plainly how the place is read (automatic, partly, by hand);
//   3. dates to check carry their rule and source, and say when unconfirmed;
//   4. the panel escapes what it shows and links only https sources;
//   5. it is mounted on the gated page only, and no discussion data is in this repository.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const L = require(path.join(ROOT, 'js/whitepaper/local-discussion.js'));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

const result = {
  geoid: '0899999', name: 'Testville', updated: '2026-10-21', starting_place: true,
  how_read: { level: 'partly', text: 'The commission is read automatically; council agendas are checked by hand.' },
  documents_read: 12, history_since: '2024-10-22',
  sources: [{ label: 'Testville Agenda Center', url: 'https://example.org/AgendaCenter', ok: true, new_docs: 3 }],
  numbers: {
    items_90d: 4,
    next_check: { body: 'Town Board', meeting: '2026-11-03', check_on: '2026-10-29', url: 'https://example.org/agendas' },
    rising: { term: 'attainable', from: 8, to: 31, quarter: '2026-Q3' },
    hearing: null
  },
  lexicon: { quarters: ['2026-Q2', '2026-Q3'], counts: { '2026-Q2': { affordable: 20, attainable: 2 }, '2026-Q3': { affordable: 9, attainable: 4 } },
    flags: [{ kind: 'shift', term: 'attainable', quarter: '2026-Q3', from: 8, to: 31,
      before: { quote: 'affordable housing for <locals>', date: '2026-04-01', title: 'Board: minutes', url: 'javascript:alert(1)' },
      after: { quote: 'attainable homes for our workforce', date: '2026-09-01', title: 'Board: agenda', url: 'https://example.org/a.pdf' } }] },
  terms: [{ term: 'affordable', group: 'How housing is named' }, { term: 'attainable', group: 'How housing is named' }, { term: 'parking', group: 'Form' }],
  check_here: [
    { body: 'Town Board', meeting: '2026-11-03', check_on: '2026-10-29', url: 'https://example.org/agendas', rule: 'First and third Tuesday. Unconfirmed: from a 2017 notice.', confirmed: false, source_url: 'https://example.org/notice', source_quote: 'two meetings per month', page: { status: 'blocked', note: 'The page refuses automated reads (HTTP 403). Check it by hand.' } }
  ],
  timeline: [{ date: '2026-09-01', title: 'Board: agenda', url: 'https://example.org/a.pdf', quotes: [{ text: 'attainable homes for our workforce' }] }],
  news: [{ date: '2026-10-03', title: 'Testville seeks housing credits', source: 'Local Voice', url: 'https://example.org/n', blocked: false }]
};

// 1. Executive view first.
const nums = L.keyNumbers(result);
ok(nums.length === 4, 'four key numbers');
ok(/90 days/.test(nums[0].text) && nums[0].big === '4', 'housing items in 90 days');
ok(/Oct 29, 2026/.test(nums[1].big) && /Town Board meets Nov 3, 2026/.test(nums[1].text), 'next date to check, with the meeting');
ok(/attainable/.test(nums[2].big) && /8%.*31%/.test(nums[2].text), 'fastest-rising word with before and after shares');
ok(nums[3].big === 'None', 'no hearing says so');
ok(/attainable/.test(L.meaning(result)), 'what it means names the rising word');
const html = L.render({ geoid: '0899999', name: 'Testville', result, watched: true, watchState: 'ok', links: [] });
ok(html.indexOf('ld-numbers') < html.indexOf('<details'), 'numbers come before anything folded');
ok(html.indexOf('Next step:') < html.indexOf('<details'), 'the next step is above the fold');

// 2. How the place is read.
ok(/Partly automatic/.test(html) && /checked by hand/.test(html), 'says how the place is read');
ok(L.LEVEL.reads && L.LEVEL.partly && L.LEVEL.hand, 'three plain levels');

// 3. Dates to check.
ok(/Unconfirmed/.test(html) && /two meetings per month/.test(html) && /refuses automated reads/.test(html), 'rule, source quote and page status shown');

// 4. Escaping and links.
ok(!/<locals>/.test(html) && /&lt;locals&gt;/.test(html), 'quotes are escaped');
ok(!/javascript:/.test(html), 'only https links');
ok(/data-tip=/.test(html), 'table headers explain themselves');

// Counts are numbers, a missing count is not a zero, and a shift states its rule.
const hostile = JSON.parse(JSON.stringify(result));
hostile.lexicon.counts['2026-Q3'].attainable = '<img src=x onerror=alert(1)>';
hostile.sources[0].new_docs = '<b>9</b>';
const hostileHtml = L.render({ geoid: '0899999', name: 'Testville', result: hostile, watched: true, watchState: 'ok', links: [] });
ok(!/<img|<b>9/.test(hostileHtml), 'backend counts never reach the page as markup');
const missing = Object.assign({}, result, { numbers: Object.assign({}, result.numbers, { items_90d: undefined }) });
ok(L.keyNumbers(missing)[0].big === 'Not counted' && !/quiet/.test(L.meaning(Object.assign({}, missing, { numbers: { items_90d: null } }))), 'a missing count is not shown as zero');
const junk = Object.assign({}, result, { documents_read: null, numbers: Object.assign({}, result.numbers, { items_90d: 'abc', rising: { term: 'attainable', from: null, to: 31, quarter: '2026-Q3' } }) });
const junkHtml = L.render({ geoid: '0899999', name: 'Testville', result: junk, watched: true, watchState: 'ok', links: [] });
ok(L.keyNumbers(junk)[0].big === 'Not counted' && !/quiet/.test(L.meaning(junk)), 'a malformed 90-day count is unknown in both places');
ok(L.keyNumbers(junk)[2].big === 'Steady' && !/moving toward/.test(L.meaning(junk)), 'a rising word without both shares is not shown');
ok(/document count not available/.test(junkHtml) && !/0 documents on file/.test(junkHtml), 'a missing document count is not zero');
ok(/past 4 quarters/.test(html) && /at least 20 words/.test(L.keyNumbers(result)[2].text), 'a shown shift states the rule');

// Not watched and not read yet.
const empty = L.render({ geoid: '0899999', name: 'Testville', result: null, watched: false, watchState: 'ok', links: [] });
ok(/Mark as planning to submit/.test(empty) && /aria-pressed="false"/.test(empty), 'switch offered');
const unmarked = L.render({ geoid: '0899999', name: 'Testville', result: Object.assign({}, result, { starting_place: false }), watched: false, watchState: 'ok', links: [] });
ok(/will not be updated/.test(unmarked), 'an unmarked place says its read is not updated');

// 5. Gated page only; no data here.
const page = read('developer-brief.html');
ok(/js\/whitepaper\/local-discussion\.js/.test(page) && /localDiscussionMount/.test(page), 'mounted on the gated report');
ok(/'js\/whitepaper'/.test(read('scripts/build-public-site.mjs')), 'the public build leaves js/whitepaper out');
ok(!fs.existsSync(path.join(ROOT, 'data/local-discussion')), 'no local discussion data in this repository');
const src = read('js/whitepaper/local-discussion.js');
ok(!/\b(AI|repo|repository|GitHub|Claude)\b/.test(src.replace(/^\s*(\/\/|\/?\*).*$/gm, '')), 'no tool or repository words on screen');

console.log(`local-discussion: ${checks} checks passed`);
