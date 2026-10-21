// The gated Next round watch page (developer-round-watch.html, js/whitepaper/round-watch.js).
// Pins:
//   1. contacts show best first (CHFA's named contact, then land banking, then
//      the main office), and only with a public https source;
//   2. everything shown is escaped;
//   3. a project row opens to its reasons, sources and contacts; Watch stays
//      folded until asked for;
//   4. the page is gated: in the developer menu, out of the public build and
//      the public artifact guard, its headers carry definitions, and no
//      contacts file is in this repository.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const RW = require(path.join(ROOT, 'js/whitepaper/round-watch.js'));
const Nav = require(path.join(ROOT, 'js/whitepaper/developer-nav.js'));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

// 1. Contacts.
const contacts = { contacts: { a: [
  { kind: 'org_office', org: 'Org', phone: '303-555-0100', source_url: 'https://example.com/contact', source_label: 'Website' },
  { kind: 'chfa_applicant', org: 'Org', name: 'Pat', email: 'pat@org.example', source_url: 'https://example.com/chfa-report.pdf', source_label: 'CHFA report' },
  { kind: 'land_banking', org: 'Org', name: 'Lee', source_url: 'http://example.com/insecure', source_label: 'x' }
] } };
const cs = RW.contactsFor(contacts, 'a');
ok(cs.length === 2, 'a contact without an https source is dropped');
ok(cs[0].kind === 'chfa_applicant' && cs[1].kind === 'org_office', 'CHFA\'s named contact comes first');
ok(RW.contactsFor(null, 'a').length === 0 && RW.contactsFor(contacts, 'missing').length === 0, 'no file or no entry shows none');

// 2 and 3. Rows.
const item = {
  id: 'a', name: '<b>Deal</b>', city: 'Longmont', county: 'Boulder County', homes: 40, sponsor: 'Sponsor & Co', band: 'High', score: 80,
  why: [{ kind: 'lost_last_same', text: 'CHFA did not fund it in 2026 Round One. 14 of 19 came back.', source_url: 'https://example.com/chfa-report.pdf', quote: 'Name: <Deal>' },
        { kind: 'land', text: 'Land banking.', source_url: 'javascript:alert(1)', quote: 'q' }],
  applications: [{ round_label: '2026 Round One', credit_type: '9%', outcome: 'not_awarded', source_url: 'https://example.com/chfa-report.pdf' }]
};
const rows = RW.rowsHtml([item], contacts, {});
ok(!rows.includes('<b>Deal</b>') && rows.includes('&lt;b&gt;Deal&lt;/b&gt;'), 'the project name is escaped');
ok(rows.includes('Sponsor &amp; Co'), 'the sponsor is escaped');
ok(!rows.includes('javascript:'), 'a non-https source is never linked');
ok(/<tr class="rw-detail-row" id="rw-d-a" hidden>/.test(rows), 'details start folded');
ok(RW.rowsHtml([item], contacts, { a: true }).includes('id="rw-d-a">'), 'an opened row shows its details');
ok(rows.includes('pat@org.example') && rows.includes('To confirm before outreach'), 'the card lists contacts, marked to confirm');
ok(RW.detailHtml(item, null).includes('kept only on the private developer site'), 'without the private file the card says where contacts live');
const round = { items: [item, Object.assign({}, item, { id: 'w', name: 'Weak', band: 'Watch', score: 10 })] };
const folded = RW.tableHtml(round, contacts, { sort: 'band', dir: 'asc', showWatch: false, open: {} });
ok(!folded.includes('Weak') && RW.tableHtml(round, contacts, { sort: 'band', dir: 'asc', showWatch: true, open: {} }).includes('Weak'),
  'Watch deals stay folded until asked for');
ok((folded.match(/<th [^>]*data-tip="[^"]{20,}"/g) || []).length === 5, 'every list header has a definition');
const sorted = RW.sortItems([{ name: 'B', band: 'Medium', score: 30, homes: 10 }, { name: 'A', band: 'High', score: 50, homes: 90 }], 'homes', 'desc');
ok(sorted[0].name === 'A', 'the list sorts by homes');
const stats = RW.statsHtml({ rounds: [{ round: '2027 Round One', credit: '9%', applications_due: 'February 2027', counts: { High: 3 }, undecided_last_round: 0 }],
  backtest: { bands: { High: { listed: 4, applied: 2 } }, caught: 5, applicants: 10, below_list: 1, no_sign_before: 4, rounds: [{}, {}, {}] } });
ok(stats.includes('3 rounds tested'), 'the stats count the rounds the backtest ran');
ok(stats.includes('5 of 10') && stats.includes('1 had a weaker sign and 4 showed no sign we score'), 'the stats split weak signs from no sign');

// 4. Gating.
const page = read('developer-round-watch.html');
ok(Nav.PAGES.some((p) => p.href === 'developer-round-watch.html'), 'the developer menu lists the page');
ok(read('scripts/build-public-site.mjs').includes("'developer-round-watch.html'"), 'the public build leaves the page out');
ok((read('scripts/audit/public-artifact-guard.mjs').match(/'developer-round-watch\.html'/g) || []).length === 2, 'the public artifact guard blocks the page and links to it');
ok(/<meta name="robots" content="noindex, nofollow">/.test(page) && page.includes('js/whitepaper/round-watch.js'), 'the page is noindex and loads its script');
ok(!fs.existsSync(path.join(ROOT, 'data/jurisdiction-briefs/_round-watch-contacts.json')), 'no contacts file in this repository');
ok(/Contacts are kept only on the private developer site/.test(fs.readFileSync(path.join(ROOT, 'data/jurisdiction-briefs/_round-watch.json'), 'utf8')),
  'the data file says where contacts live');

console.log(`round-watch-page: ${checks} checks passed`);
