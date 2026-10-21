// The gated Next round watch page (developer-round-watch.html, js/whitepaper/round-watch.js).
// Pins:
//   1. contacts show best first (CHFA's named contact, then land banking, then
//      the main office), and only with a public https source;
//   2. everything shown is escaped;
//   3. a project row opens to its reasons, sources and contacts; Watch stays
//      folded until asked for; region and likelihood filter the list and the
//      map alike; the first contact shows in the list;
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
const folded = RW.tableHtml(round, contacts, { sort: 'band', dir: 'asc', level: 'hm', open: {} });
ok(!folded.includes('Weak') && RW.tableHtml(round, contacts, { sort: 'band', dir: 'asc', level: 'all', open: {} }).includes('Weak'),
  'Watch deals stay folded until asked for');
ok((folded.match(/<th [^>]*data-tip="[^"]{20,}"/g) || []).length === 7, 'every list header has a definition');
ok(folded.includes('data-sort="region"') && folded.includes('data-sort="contact"'), 'the list sorts by region and by first contact');

// Region and likelihood filters; the map follows them.
const R = [
  { id: 'h1', name: 'H1', band: 'High', score: 60, region: 'Front Range', city: 'Denver', place_geoid: '0820000', lat: 39.7, lng: -105, why: [] },
  { id: 'h2', name: 'H2', band: 'High', score: 55, region: 'Southwest', city: 'Durango', place_geoid: '0822035', lat: 37.3, lng: -107.9, why: [] },
  { id: 'm1', name: 'M1', band: 'Medium', score: 30, region: 'Front Range', city: 'Denver', place_geoid: '0820000', lat: 39.7, lng: -105, why: [] },
  { id: 'w1', name: 'W1', band: 'Watch', score: 10, region: 'Front Range', city: null, place_geoid: null, lat: null, lng: null, why: [] }
];
const ids = (st) => RW.visibleItems({ items: R }, st).map((i) => i.id).join(',');
ok(ids({ level: 'high', region: 'all' }) === 'h1,h2', 'High only shows High deals');
ok(ids({ level: 'hm', region: 'Front Range' }) === 'h1,m1', 'a region shows only its deals');
ok(ids({ level: 'all', region: 'all' }) === 'h1,h2,m1,w1', 'All shows Watch too');
const byRegion = RW.sortItems(R, 'region', 'asc').map((i) => i.id).join(',');
ok(byRegion === 'h2,h1,m1,w1', 'sorting by region runs west to east and keeps likelihood order inside a region');
const g = RW.townsFor(R);
ok(g.towns.length === 2 && g.unmapped.length === 1 && g.unmapped[0].id === 'w1', 'deals share their town\'s pin; a deal with no town is named apart');
const denver = g.towns.find((t) => t.name === 'Denver');
ok(denver.band === 'High' && denver.items[0].id === 'h1', 'a town pin takes its strongest deal\'s colour');
const near = RW.townsNear(g.towns, { x: 0, y: 0 }, (ll) => ({ x: ll[1] === -105 ? 15 : 300, y: 0 }));
ok(near.length === 1 && near[0].name === 'Denver', 'a tap within 22px of a pin opens its town');
const panel = RW.townPanelHtml([Object.assign({}, denver, { name: '<x>' })]);
ok(panel.includes('data-open="h1"') && panel.includes('&lt;x&gt;') && !panel.includes('<x>'), 'the town panel opens each deal in the list and escapes the town');
const ctl = RW.controlsHtml({ rounds: [{ round: 'R', credit: '9%', items: R }] }, { round: 0, level: 'hm', region: 'Southwest' });
ok(ctl.includes('<option value="Southwest" selected>') && !ctl.includes('value="Eastern Plains"'), 'the region menu lists only regions with deals');

// First contact in the list.
ok(RW.firstContactCell(item, contacts).includes('Pat') && RW.firstContactCell(item, contacts).includes('mailto:pat@org.example'),
  'the list shows the best contact and how to reach them');
ok(RW.firstContactCell(item, null).includes('Developer site only') && RW.firstContactCell({ id: 'none' }, contacts).includes('None found yet'),
  'without the private file or a contact, the cell says so');
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
ok(page.includes('js/vendor/leaflet.js') && page.indexOf('js/vendor/leaflet.js') < page.indexOf('js/whitepaper/round-watch.js') && page.includes('id="rwMap"'),
  'the page loads the map library before its script');
const built = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/jurisdiction-briefs/_round-watch.json'), 'utf8'));
const all = built.rounds.flatMap((r) => r.items);
ok(all.every((i) => i.region === null || RW.REGIONS.includes(i.region)) && all.filter((i) => typeof i.lat === 'number').length >= all.length * 0.9,
  'the data file gives each deal a site region and nearly all a town location');
ok(!fs.existsSync(path.join(ROOT, 'data/jurisdiction-briefs/_round-watch-contacts.json')), 'no contacts file in this repository');
ok(/Contacts are kept only on the private developer site/.test(fs.readFileSync(path.join(ROOT, 'data/jurisdiction-briefs/_round-watch.json'), 'utf8')),
  'the data file says where contacts live');

console.log(`round-watch-page: ${checks} checks passed`);
