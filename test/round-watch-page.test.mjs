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
const byRegionDesc = RW.sortItems(R, 'region', 'desc').map((i) => i.id).join(',');
ok(byRegionDesc === 'h1,m1,w1,h2', 'reversing the region sort keeps High first inside each region');
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

// New and moved tags, CHFA dates, the spreadsheet.
ok(RW.freshTag({ first_listed: '2026-11-01', band: 'High' }, '2026-11-20').text === 'New', 'a deal listed in the last 30 days is New');
ok(RW.freshTag({ first_listed: '2026-09-01', band: 'High' }, '2026-11-20') === null && RW.freshTag({ first_listed: null, band: 'High' }, '2026-11-20') === null,
  'an older deal, or one listed before tracking, is not New');
ok(RW.freshTag({ band: 'High', band_before: 'Medium', band_since: '2026-11-10' }, '2026-11-20').text === 'Up from Medium' &&
  RW.freshTag({ band: 'Watch', band_before: 'High', band_since: '2026-11-10' }, '2026-11-20').kind === 'down', 'a band change shows its direction');
ok(RW.visibleItems({ items: [Object.assign({}, R[0], { first_listed: '2026-11-01' }), R[1]] }, { level: 'all', region: 'all', fresh: 'new', asOf: '2026-11-02' })
  .map((i) => i.id).join() === 'h1', 'the New or moved filter keeps only those');
const cal = JSON.parse(read('data/chfa-qap-calendar.json'));
const r1dates = RW.roundDates({ round: '2027 Round One' }, cal);
ok(r1dates.length === 2 && r1dates[0].date === '2026-12-01' && r1dates[1].date === '2027-02-01', 'Round One shows CHFA\'s letter of intent and application dates');
const dh = RW.datesHtml({ round: '2027 Round One' }, cal, '2026-11-21');
ok(r1dates[0].url === cal.metadata.qap_sources['2027-28-qap-third-draft'].url && dh.includes('href="' + r1dates[0].url + '"'),
  'the countdown links the plan its dates come from');
ok(dh.includes('10 days to go') && dh.includes('rw-soon') && dh.includes('not yet adopted'), 'the countdown counts days, flags the last 30, and says the plan is a draft');
ok(RW.roundDates({ round: '2027 Round Two' }, cal)[0].date === '2027-06-01' && RW.roundDates({ round: 'x' }, cal).length === 0, 'Round Two has its own dates; an unknown round shows none');
ok(RW.localDate(new Date(2026, 10, 30, 19, 30)) === '2026-11-30', 'the countdown counts from the viewer\'s own date, not UTC');
ok(RW.summaryText([R[0], R[2]], 72, { region: 'Front Range' }) === 'Showing 2 of 72 deals: 1 High, 1 Medium, Front Range.' &&
  RW.summaryText([], 72, { region: 'all', fresh: 'new' }) === 'Showing 0 of 72 deals, all regions, new or moved only.',
  'the count describes only what the filters show');
const csv = RW.csvFor({ round: '2027 Round One', credit: '9%' }, [Object.assign({}, item, { name: '=HYPERLINK("x")', region: 'Front Range' })], contacts, '2026-10-18');
const lines = csv.trim().split('\r\n');
ok(lines.length === 2 && lines[0].startsWith('Round,Likelihood') && lines[1].includes('pat@org.example') && lines[1].includes('Front Range'),
  'the spreadsheet has one row per deal with its best contact');
ok(lines[1].includes('"\'=HYPERLINK(""x"")"'), 'a cell that starts like a formula is made plain text');
ok(!RW.csvFor({ round: 'R', credit: '9%' }, [item], null, '2026-10-18').includes('@'), 'without the private file the spreadsheet holds no contacts');
ok(RW.detailHtml(Object.assign({}, item, { place_geoid: '0845970' }), contacts).includes('class="rw-pab" data-pab-id="a"'), 'an open deal has a place for Add to Deal Tracker');

const byContact = RW.sortItems([{ name: 'A', _contact: { name: 'Zed' } }, { name: 'B', _contact: null }, { name: 'C', _contact: { org: 'Acme' } }], 'contact', 'asc');
ok(byContact.map((i) => i.name).join() === 'C,A,B', 'the First contact column sorts by the name it shows, deals without one last');
ok(RW.sortItems(byContact, 'contact', 'desc').map((i) => i.name).join() === 'A,C,B', 'deals without a contact stay last when the sort is reversed');

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
const bt2 = { bands: { High: { listed: 4, applied: 3, awarded: 1 } }, caught: 5, applicants: 10, below_list: 1, no_sign_before: 4, signals: {},
  rounds: [{ round: '2026 Round One', credit: '9%', applicants: 10, caught: 5, awarded: 4, undecided: 0,
             bands: { High: { listed: 2, applied: 2, awarded: 1 }, Medium: { listed: 1, applied: 0, awarded: 0 }, Watch: { listed: 1, applied: 0, awarded: 0 } },
             picks: [{ name: '<P>', band: 'High', outcome: 'awarded', source_url: 'https://example.com/r.pdf', decision_url: 'https://example.com/award.pdf' }, { name: 'Q', band: 'High', outcome: 'not_awarded' }] },
           { round: '2026 Round Two', credit: '4%', applicants: 3, caught: 1, awarded: 0, undecided: 3,
             bands: { High: { listed: 2, applied: 1, awarded: 0 }, Medium: { listed: 0, applied: 0, awarded: 0 }, Watch: { listed: 0, applied: 0, awarded: 0 } },
             picks: [{ name: 'R', band: 'High', outcome: 'pending' }] }] };
const bth = RW.backtestHtml(bt2);
ok(bth.includes('2 of 2 applied') && bth.includes('1 awarded') && bth.includes('awards not yet announced'), 'the backtest shows who was awarded, and says when CHFA has not decided');
ok(bth.includes('&lt;P&gt;: <strong>Awarded</strong>') && bth.includes('Q: <strong>Not funded</strong>') && bth.includes('R: <strong>Awaiting CHFA</strong>'),
  'each listed deal that applied shows what CHFA decided');
ok(bth.includes('href="https://example.com/award.pdf" target="_blank" rel="noopener">award report</a>'), 'a decision links to the award report');
const st2 = RW.statsHtml({ rounds: [{ round: 'R', credit: '9%', applications_due: 'February', counts: { High: 1 }, undecided_last_round: 0 }], backtest: bt2 });
ok(st2.includes('1 were awarded credit and 1 await CHFA'), 'the headline counts awarded High picks and those still waiting');
ok(stats.includes('5 of 10') && stats.includes('1 had a weaker sign and 4 showed no sign we score'), 'the stats split weak signs from no sign');

// 4. Gating.
const page = read('developer-round-watch.html');
ok(Nav.PAGES.some((p) => p.href === 'developer-round-watch.html'), 'the developer menu lists the page');
ok(read('scripts/build-public-site.mjs').includes("'developer-round-watch.html'"), 'the public build leaves the page out');
ok((read('scripts/audit/public-artifact-guard.mjs').match(/'developer-round-watch\.html'/g) || []).length === 2, 'the public artifact guard blocks the page and links to it');
ok(/<meta name="robots" content="noindex, nofollow">/.test(page) && page.includes('js/whitepaper/round-watch.js'), 'the page is noindex and loads its script');
ok(page.includes('js/vendor/leaflet.js') && page.indexOf('js/vendor/leaflet.js') < page.indexOf('js/whitepaper/round-watch.js') && page.includes('id="rwMap"'),
  'the page loads the map library before its script');
ok(page.includes('js/components/pipeline-store.js') && page.includes('js/components/pipeline-add-button.js'), 'the page loads the Deal Tracker scripts');
ok(/id="rwCount" aria-live="polite" aria-atomic="true"/.test(page), 'a filter change is announced to screen readers');
const built = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/jurisdiction-briefs/_round-watch.json'), 'utf8'));
const all = built.rounds.flatMap((r) => r.items);
ok(all.every((i) => i.region === null || RW.REGIONS.includes(i.region)) && all.filter((i) => typeof i.lat === 'number').length >= all.length * 0.9,
  'the data file gives each deal a site region and nearly all a town location');
ok(!fs.existsSync(path.join(ROOT, 'data/jurisdiction-briefs/_round-watch-contacts.json')), 'no contacts file in this repository');
ok(/Contacts are kept only on the private developer site/.test(fs.readFileSync(path.join(ROOT, 'data/jurisdiction-briefs/_round-watch.json'), 'utf8')),
  'the data file says where contacts live');

console.log(`round-watch-page: ${checks} checks passed`);
