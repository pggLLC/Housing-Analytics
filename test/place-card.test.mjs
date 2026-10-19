// The place card on the gated Jurisdiction Report (js/whitepaper/place-card.js).
// Pins:
//   1. "Call first" ranks contacts from both sources against the next step,
//      the same person once, and says why;
//   2. a contact from the research file needs a public https source to show;
//   3. a logged discussion counts as "last talked" and moves the person up;
//   4. sites show their developer check, open sites first;
//   5. the card escapes what it shows, and the page mounts it outside the report.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const P = require(path.join(ROOT, 'js/whitepaper/place-card.js'));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

// 1. What the next step needs, and what a role decides.
ok(P.needsFromAction('Ask the City for a zoning letter')[0] === 'zoning', 'a zoning step needs the planning side first');
ok(P.needsFromAction('Respond to the land RFP').slice(0, 2).join() === 'land,housing-authority', 'a land step needs the landholder');
ok(P.needsFromAction('Draft outreach email')[0] === 'housing-authority', 'plain outreach goes to the housing lead first');
ok(P.coversFromRole('Community Development Director').includes('zoning'), 'community development decides zoning');
ok(P.coversFromRole('Executive Director, Chaffee Housing Authority').includes('land'), 'a housing authority holds land');
ok(P.coversFromRole('City Manager').includes('management'), 'a manager runs the staff');

const network = [
  { name: 'Pat Planner', role: 'Planning Director', org: 'Town', email: '', phone: '', last_talked: 'never', relationship_tier: '3' },
  { name: 'Mo Manager', role: 'Town Manager', org: 'Town', email: 'mo@example.org', phone: '970-555-0100', last_talked: 'never', relationship_tier: '3' }
];
const researched = [
  { name: 'Pat Planner', role: 'Planning Director', phone: '970-555-0101 (Planning)', covers: ['zoning'], source_url: 'https://example.org/staff', source_label: 'Staff page', source_quote: 'x' },
  { name: 'Hal Housing', role: 'Executive Director', org: 'County Housing Authority', email: 'hal@example.org', covers: ['housing-authority', 'land'], source_url: 'https://example.org/ha', source_quote: 'y' },
  { name: 'No Source', role: 'Mayor', phone: '1', source_url: 'http://example.org' }
];
const merged = P.mergeContacts(network, researched);
ok(merged.length === 3, 'the same person from both files appears once, and a contact without an https source is dropped');
ok(merged.find((c) => c.name === 'Pat Planner').phone === '970-555-0101 (Planning)', 'a blank phone in your file is filled from the public record');

let ranked = P.rankContacts(network, researched, 'Ask for a zoning letter');
ok(ranked[0].name === 'Pat Planner', 'the planning director comes first for a zoning step');
ok(/zoning and entitlements/.test(ranked[0].why) && /phone on file/.test(ranked[0].why), 'the pick says why');
ranked = P.rankContacts(network, researched, 'Respond to the land RFP');
ok(ranked[0].name === 'Hal Housing', 'the housing authority comes first for a land step');

// 3. A logged discussion moves the person up.
const notes = [{ id: 'a', date: '2026-10-18', contact: 'mo manager', said: 'Talked about fees.' }];
ok(P.lastTalked(notes)['mo manager'] === '2026-10-18', 'the log records the latest talk per person');
ranked = P.rankContacts(network, researched, 'Draft outreach email', notes);
const mo = ranked.find((c) => c.name === 'Mo Manager');
ok(mo.last_talked === '2026-10-18' && /you talked on 2026-10-18/.test(mo.why), 'a logged talk shows as last talked');
ok(ranked.indexOf(mo) < ranked.findIndex((c) => c.name === 'Pat Planner'), 'someone you have talked to rises above a cold contact');

// 4. Sites, best first, with the developer check.
const ripeness = {
  places: { '0800001': { prop123: 'Committed', prop123_units: 30 } },
  sites: [
    { id: 's1', geoid: '0800001', name: 'Taken Site', homes: 90, stage: 'not_funded', opening: { status: 'taken', why: 'Still applying.' } },
    { id: 's2', geoid: '0800001', name: 'Open Lots', homes: 40, stage: 'land_funded', opening: { status: 'open', why: 'Town holds it.', sources: [{ url: 'https://example.org/award' }] } },
    { id: 's3', geoid: '0800002', name: 'Elsewhere', homes: 10, stage: 'land_funded' }
  ]
};
const sites = P.sitesFor(ripeness, '0800001');
ok(sites.length === 2 && sites[0].name === 'Open Lots', 'an open site sorts ahead of a taken one, and only this place\'s sites show');

const html = P.render({
  name: 'Testtown', geoid: '0800001', pipeline: { stage: 'Signal', ioi_score: '70', next_action: 'Respond to the land RFP <now>', next_action_due: '2026-11-01' },
  network, researched, signals: [{ date: '2026-10-01', signal_type: 'Funding', summary: 'Award', source_url: 'https://example.org/s' }],
  ripeness, notes, notesState: 'off'
});
ok(html.includes('id="place-card"') && html.includes('Call first') && html.includes('Sites here') && html.includes('Discussions'), 'the card has its parts');
ok(html.includes('Open: land held, no developer chosen') && html.includes('Taken: a developer is still on it'), 'each site shows its developer check');
ok(html.includes('&lt;now&gt;') && !html.includes('<now>'), 'the card escapes what it shows');
ok(html.includes('Talked about fees.') && html.includes('id="pcNoteForm"'), 'the log and its form show when the site can save');
ok(P.render({ name: 'T', geoid: '0800001', notes: null, notesState: 'off' }).includes('saved on the developer site'), 'without the site, the log says where it lives');

// Codex round 1: the dossier's step fills a blank pipeline action; the form's
// date is the local calendar day; card links are 44px tall.
const blankNext = P.render({ name: 'T', geoid: '0800009', pipeline: { stage: 'Signal', next_action: '' },
  ripeness: { sites: [{ id: 'd', geoid: '0800009', name: 'Lot', stage: 'dossier', card: { reading: 'ripening', checked: '2026-10-19', trigger: 'x', next: { date: '2027-05-05', what: 'Plat lapses' } } }] } });
ok(blankNext.includes('Plat lapses') && blankNext.includes('from the dossier') && !blankNext.includes('Add the place to the pipeline'), 'a blank pipeline action falls back to the dossier step');
ok(P.localToday(new Date(2026, 9, 19, 23, 30)) === '2026-10-19', 'the default date is the local day, not UTC');
ok(/\.pc-card a \{[^}]*min-height:44px/.test(read('developer-brief.html')), 'place card links are 44px tall');

// 5. The page mounts the card in the private block, outside the report frame.
const page = read('developer-brief.html');
ok(page.includes('<script src="js/whitepaper/place-card.js"></script>'), 'the report page loads the card');
ok(/privateSection\(name, geoid, related, researched\) \+\s*'<iframe id="reportFrame"/.test(page) && (page.match(/<div id="placeCardMount"><\/div>/g) || []).length === 2, 'the card sits in the private block, above the report frame');
ok(page.includes("fetch('api/notes?geoid="), 'the log is read from the site');

console.log('place-card: ' + checks + ' checks passed');
