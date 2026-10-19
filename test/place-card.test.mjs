// The place card on the gated Jurisdiction Report (js/whitepaper/place-card.js).
// Pins:
//   1. "Call first" ranks contacts from both sources against the next step,
//      the same person once, and says why;
//   2. a contact from the research file needs a public https source to show;
//   3. a logged discussion counts as "last talked" and moves the person up;
//   4. sites show their developer check, open sites first;
//   5. the card escapes what it shows, and the page mounts it outside the report;
//   6. Ask pggLLC, How it works and About on the developer site.
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
ok(P.coversFromRole('Executive Director', 'Chamber of Commerce').length === 0 && P.coversFromRole('Executive Director', 'Archuleta County Housing Authority').includes('land'),
  'a bare executive director is the housing lead only at a housing body');

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

{
  // Phone or email is one key: two methods never outrank a logged talk.
  const both = { name: 'A Both', role: 'Planning Director', phone: '1', email: 'a@x.org', source_url: 'https://example.org/a' };
  const one = { name: 'Z Talked', role: 'Planning Director', phone: '2', last_talked: '2026-10-01' };
  ok(P.rankContacts([one], [both], 'Ask for a zoning letter')[0].name === 'Z Talked', 'phone and email together count the same as one; a past talk breaks the tie');
}

{
  // A logged talk is one key; the relationship tier only breaks what is left.
  // Names run against the expected order, so only the keys can produce it.
  const tierOnly = { name: 'Y Tier', role: 'Planning Director', phone: '1', relationship_tier: '1' };
  const logged = { name: 'Z Logged', role: 'Planning Director', phone: '2', last_talked: '2026-10-01' };
  const plain = { name: 'A Plain', role: 'Planning Director', phone: '3' };
  const r = P.rankContacts([tierOnly, logged, plain], [], 'Ask for a zoning letter').map((c) => c.name);
  ok(r.join() === 'Z Logged,Y Tier,A Plain', 'a logged talk outranks a marked relationship, which outranks none');
  ok(/relationship you marked/.test(read('developer-methods.html')), 'the Methodology page lists the relationship as the last tie-break');
}
{
  const err = P.render({ name: 'T', geoid: '0800001', notes: null, notesState: 'error' });
  ok(/did not load/.test(err) && !/opens there/.test(err), 'a failed log load says so instead of pointing elsewhere');
  ok(/r\.status === 404 \? 'off'/.test(read('developer-brief.html')), 'only a missing log endpoint counts as off-site');
  const A = (await import('../js/whitepaper/ask-pggllc.js')).default;
  ok(/did not load/.test(A.render({ questions: null, failed: true, form: false })), 'a failed question load says so, even with no form');
}

// Codex round 2: a related place's contacts are a fallback, marked as such.
const own = { name: 'Town of T', contacts: [{ name: 'Town Planner', role: 'Planning Director', source_url: 'https://example.org/t' }] };
const county = { name: 'T County', contacts: [{ name: 'County Planner', role: 'Planning Director', source_url: 'https://example.org/c' }] };
ok(P.researchedFor(own, [county]).map((c) => c.name).join() === 'Town Planner', 'the place\'s own contacts are ranked, not its county\'s');
const fallback = P.rankContacts([], P.researchedFor({ contacts: [] }, [county]), 'Ask for a zoning letter');
ok(fallback.length === 1 && /researched for T County, not this place/.test(fallback[0].why) && !/decides/.test(fallback[0].why), 'with none of its own, the county\'s contacts show and say where they were researched');
ok(/researchedFor\(contacts, relatedContacts\)/.test(read('developer-brief.html')), 'the report page ranks with the place\'s own contacts first');

const sameName = P.mergeContacts([{ name: 'Pat Planner', role: 'Planning Director', phone: '' }],
  P.researchedFor({ contacts: [] }, [{ name: 'T County', contacts: [{ name: 'Pat Planner', role: 'County Planner', phone: '970-555-9999', source_url: 'https://example.org/c' }] }]));
ok(sameName.length === 1 && sameName[0].phone === '' && !sameName[0].source_url, 'a related place\'s contact never fills your own record by name');
ok(P.render({ name: 'T', geoid: '0800001', anti: { date_dropped: '2026-01-01', reason: 'No land', revisit_date: '2027-01-01' } }).includes('Revisit 2027-01-01'), 'a set-aside place shows when to revisit');
for (const pg of ['developer-methods.html', 'developer-about.html']) ok(read(pg).includes('href="#main-content"') && read(pg).includes('id="main-content"') && read(pg).includes('<footer id="site-footer"></footer>'), pg + ' has a skip link and a footer landmark');

// 3. A logged discussion moves the person up.
const notes = [{ id: 'a', date: '2026-10-18', contact: 'mo manager', said: 'Talked about fees.' }];
ok(P.lastTalked(notes)['mo manager'] === '2026-10-18', 'the log records the latest talk per person');
ranked = P.rankContacts(network, researched, 'Draft outreach email', notes);
const mo = ranked.find((c) => c.name === 'Mo Manager');
ok(mo.last_talked === '2026-10-18' && /you talked on 2026-10-18/.test(mo.why), 'a logged talk shows as last talked');
const twins = [
  { name: 'Mo Manager', role: 'Town Manager', email: 'mo@example.org', phone: '1', last_talked: 'never' },
  { name: 'Al Manager', role: 'Town Manager', email: 'al@example.org', phone: '2', last_talked: 'never' }
];
ok(P.rankContacts(twins, [], 'Draft outreach email', notes)[0].name === 'Mo Manager' && P.rankContacts(twins, [], 'Draft outreach email', [])[0].name === 'Al Manager',
  'between two people who fit the step equally and are equally reachable, the one you have talked to comes first');

// Codex round 4: fit to the next step outranks reach and a past talk.
const lex = P.rankContacts(
  [{ name: 'Reachable Manager', role: 'Town Manager', email: 'm@example.org', phone: '1', last_talked: '2026-10-01', relationship_tier: '1' }],
  [{ name: 'Quiet Planner', role: 'Planning Director', source_url: 'https://example.org/p' }],
  'Ask for a zoning letter');
ok(lex[0].name === 'Quiet Planner', 'the person who handles the step comes first, even with no phone on file and no past talk');

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
// The developer check has one contract: the statuses and labels the card uses
// are the ones Ready to build uses (and the Methodology page explains), in the
// same order. Each status renders its own label, and an unknown status shows none.
const R = require(path.join(ROOT, 'js/whitepaper/ripeness.js'));
const statuses = Object.keys(P.OPENING);
ok(statuses.join() === Object.keys(R.OPEN).join(), 'the card and Ready to build know the same developer-check statuses');
ok(statuses.every((k) => R.OPEN[k] === P.OPENING[k].label + '.' && R.OPEN_RANK[k] === P.OPENING[k].rank), 'each status means the same thing, and sorts the same, on both pages');
ok(statuses.every((k) => read('developer-methods.html').includes('<td>' + P.OPENING[k].label + '</td>')), 'the Methodology page explains every label the card shows');
for (const k of statuses) {
  const one = P.render({ name: 'T', geoid: '0800001', ripeness: { sites: [{ id: 'x', geoid: '0800001', name: 'L', stage: 'not_funded', opening: { status: k, why: 'w' } }] } });
  ok(one.includes('pc-open-' + k + '">' + P.OPENING[k].label) && statuses.filter((j) => j !== k).every((j) => !one.includes(P.OPENING[j].label)), k + ' renders its own label and no other');
}
{
  const unk = P.render({ name: 'T', geoid: '0800001', ripeness: { sites: [{ id: 'x', geoid: '0800001', name: 'L', stage: 'not_funded', opening: { status: 'made-up', why: 'w' } }] } });
  const none = P.render({ name: 'T', geoid: '0800001', ripeness: { sites: [{ id: 'x', geoid: '0800001', name: 'L', stage: 'not_funded' }] } });
  ok(!unk.includes('pc-open') && statuses.every((k) => !unk.includes(P.OPENING[k].label)), 'an unknown status shows none of the check labels');
  ok([unk, none].every((h) => h.includes('No developer check on file yet; treat as unclear.')), 'a site with no check, or an unknown one, says so on the card');
  const taken = P.render({ name: 'T', geoid: '0800001', ripeness: { sites: [{ id: 'x', geoid: '0800001', name: 'L', stage: 'not_funded', opening: { status: 'taken', why: 'w' } }] } });
  ok(taken.includes('No open site') && !taken.includes('No site on file<') && taken.includes('Every site on file has a developer on it'), 'a place whose sites are all taken reads "No open site", not "No site on file"');
  ok(/No developer check on file yet; treat as unclear/.test(read('developer-methods.html')), 'the Methodology page explains the no-check line');
}
{
  const R2 = require(path.join(ROOT, 'js/whitepaper/ripeness.js'));
  ok(/No developer check on file yet; treat as unclear\./.test(R2.siteLine({ name: 'L', stage: 'not_funded' })), 'Ready to build says the same for an unchecked site');
}
ok(html.indexOf(P.OPENING.open.label) < html.indexOf(P.OPENING.taken.label), 'the open site is listed before the taken one');
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

// Codex round 3: who holds a site outranks its readiness, and a taken site is
// never the suggested one; a pipeline edit redraws the card.
const mixed = { sites: [
  { id: 't', geoid: '0800003', name: 'Ripe But Taken', homes: 80, stage: 'dossier', card: { reading: 'ripe', next: null }, opening: { status: 'taken', why: 'x' } },
  { id: 'o', geoid: '0800003', name: 'Ripening And Open', homes: 30, stage: 'dossier', card: { reading: 'ripening', next: null }, opening: { status: 'open', why: 'y' } }
] };
ok(P.sitesFor(mixed, '0800003')[0].name === 'Ripening And Open', 'an open site leads a ripe site another developer holds');
ok(P.render({ name: 'T', geoid: '0800003', ripeness: mixed }).includes('Best site: Ripening And Open'), 'the card suggests the open site');
const onlyTaken = { sites: [mixed.sites[0]] };
const takenCard = P.render({ name: 'T', geoid: '0800003', ripeness: onlyTaken });
ok(!takenCard.includes('Best site') && takenCard.includes('Every site on file has a developer on it'), 'a taken site is never the best site');
const built = R.build(mixed, [{ geoid: '0800003', jurisdiction: 'T', stage: 'Signal' }], []);
ok(built.sites[0].name === 'Ripening And Open' && /Best site: Ripening And Open/.test(built.communities[0].why), 'Ready to build orders and suggests the same way');
ok(R.build(onlyTaken, [{ geoid: '0800003', jurisdiction: 'T', stage: 'Signal' }], []).communities[0].reading === 'all_taken', 'a place whose only site is taken has no suggested site and reads No open site');
ok(/onChange: \(\) => redrawPlaceCard\(\)/.test(read('developer-brief.html')) && /opts\.onChange\(\)/.test(read('js/components/pipeline-add-button.js')), 'a pipeline edit from Working tools redraws the card');

// 5. The page mounts the card in the private block, outside the report frame.
const page = read('developer-brief.html');
ok(page.includes('<script src="js/whitepaper/place-card.js"></script>'), 'the report page loads the card');
ok(/privateSection\(name, geoid, related, researched\) \+\s*'<iframe id="reportFrame"/.test(page) && (page.match(/<div id="placeCardMount"><\/div>/g) || []).length === 2, 'the card sits in the private block, above the report frame');
ok(page.includes("fetch('api/notes?geoid="), 'the log is read from the site');

// 6. Ask pggLLC: the card links to the question form for its place; the
// developer site has Methods and About pages in its menu and outside the public build.
ok(html.includes('developer-about.html?place=Testtown#ask'), 'the card links to Ask pggLLC for its place');
const A = require(path.join(ROOT, 'js/whitepaper/ask-pggllc.js'));
const qs = [
  { id: '1', asked: '2026-10-01', question: 'Old answered', answer: 'Yes.', answered: '2026-10-02' },
  { id: '2', asked: '2026-10-03', question: 'Why <ripening>?', answer: '' }
];
ok(A.order(qs)[0].id === '2', 'unanswered questions come first');
const ask = A.render({ questions: qs, place: 'Buena Vista', canAnswer: true });
ok(ask.includes('id="askForm"') && ask.includes('value="Buena Vista"') && ask.includes('ask-answer-form'), 'the form fills the place and open questions can be answered');
ok(ask.includes('&lt;ripening&gt;') && !ask.includes('<ripening>'), 'questions are escaped');
ok(/Nothing is emailed/.test(ask), 'the form says nothing is emailed');
ok(!A.render({ questions: null }).includes('askForm'), 'off the developer site the form says where questions are kept');
ok(!A.render({ questions: qs, form: false, canAnswer: true }).includes('ask-answer-form'), 'the home page list is read-only');
ok(!A.render({ questions: qs }).includes('ask-answer-form') && A.render({ questions: qs }).includes('Waiting for an answer'), 'only pggLLC\'s sign-ins see the answer form; everyone else sees the question waiting');
const nav = read('js/whitepaper/developer-nav.js'), build = read('scripts/build-public-site.mjs');
for (const pg of ['developer-methods.html', 'developer-about.html']) {
  ok(fs.existsSync(path.join(ROOT, pg)) && nav.includes("'" + pg + "'") && build.includes("'" + pg + "'"), pg + ' is in the menu and kept out of the public build');
  ok(read(pg).includes('noindex') && read(pg).includes('js/developer-gate.js') && read(pg).includes('id="devNav"'), pg + ' is a gated developer page');
}
{
  // The home page's opening is a heading, then numbered steps whose links all
  // go to pages in the developer menu, then a search that opens the report page.
  const menu = [...nav.matchAll(/href: '([^']+)'/g)].map((m) => m[1]);
  const home = read('developer.html');
  const hero = (home.match(/<div class="ib-hero">([\s\S]*?)<\/form>/) || [])[1] || '';
  const steps = (hero.match(/<ol class="ib-start">([\s\S]*?)<\/ol>/) || [])[1] || '';
  const links = [...steps.matchAll(/href="([^"#]+)/g)].map((m) => m[1]);
  ok(/^\s*<h1>[^<]+<\/h1>/.test(hero) && (steps.match(/<li>/g) || []).length >= 3, 'developer home opens with a heading and numbered steps');
  ok(links.length && links.every((h) => menu.includes(h)), 'every step links to a page in the developer menu');
  ok(/<form action="([^"]+)"/.test(hero) && menu.includes(hero.match(/<form action="([^"]+)"/)[1]), 'the opening search goes to a page in the menu');
  ok(home.includes('id="askMount"'), 'developer home shows the questions');
}
ok(/tel:9705550101"/.test(P.render({ name: 'T', geoid: '0800001', network: [{ name: 'Area Code', role: 'Planning Director', phone: '(970) 555-0101' }], researched: [] }))
  && /tel:9705550102"/.test(P.render({ name: 'T', geoid: '0800001', network: [{ name: 'Noted', role: 'Planning Director', phone: '970-555-0102 (Planning)' }], researched: [] })), 'phone links keep an area code in brackets and drop a worded note');
// Codex round 2: a slow save can't be sent twice.
const askSrc = read('js/whitepaper/ask-pggllc.js');
{
  // A fake form: two submits before the save settles post once.
  let handler = null, posts = 0;
  const field = (v) => ({ value: v });
  const btn = { disabled: false };
  const form = {
    elements: { date: field('2026-10-19'), contact: field('Mo'), said: field('Hi'), next: field(''), next_date: field('') },
    addEventListener: (t, fn) => { handler = fn; },
    querySelector: (q) => (q === '.pc-note-status' ? { textContent: '' } : btn)
  };
  const root = { querySelector: () => form, querySelectorAll: () => [] };
  P.wireNotes(root, '0800001', () => { posts++; return new Promise(() => {}); }, () => {});
  handler({ preventDefault() {} }); handler({ preventDefault() {} });
  ok(posts === 1 && btn.disabled, 'the log form ignores a second submit while saving');
}
const spaceNext = P.render({ name: 'T', geoid: '0800009', pipeline: { stage: 'Signal', next_action: '   ' },
  ripeness: { sites: [{ id: 'd', geoid: '0800009', name: 'Lot', stage: 'dossier', card: { reading: 'ripening', checked: '2026-10-19', trigger: 'x', next: { date: '2027-05-05', what: 'Plat lapses' } } }] } });
ok(spaceNext.includes('Plat lapses') && spaceNext.includes('from the dossier'), 'a whitespace-only pipeline action counts as blank');
{
  // A save redraws the card; the new status line announces it and takes focus.
  let handler = null, focused = false;
  const field = (v) => ({ value: v });
  const form = {
    elements: { date: field('2026-10-19'), contact: field(''), said: field('Hi'), next: field(''), next_date: field('') },
    addEventListener: (t, fn) => { handler = fn; },
    querySelector: (q) => (q === '.pc-note-status' ? { textContent: '' } : { disabled: false })
  };
  const fresh = { textContent: '', focus() { focused = true; } };
  let drawn = false;
  const root = { querySelector: (q) => (q === '#pcNoteForm' ? form : drawn ? fresh : null), querySelectorAll: () => [] };
  P.wireNotes(root, '0800001', () => Promise.resolve([]), () => { drawn = true; });
  handler({ preventDefault() {} });
  await new Promise((r) => setTimeout(r, 0));
  ok(drawn && fresh.textContent === 'Saved to the log.' && focused, 'a saved discussion is announced on the redrawn card and focus lands there');
}
{
  // A failed removal says so in the status line.
  let click = null;
  const status = { textContent: '', focus() {} };
  const rm = { disabled: false, getAttribute: () => 'n1', addEventListener: (t, fn) => { click = fn; } };
  const root = { querySelector: (q) => (q === '.pc-note-status' ? status : null), querySelectorAll: (q) => (q === '.pc-note-remove' ? [rm] : []) };
  globalThis.window = Object.assign(globalThis.window || {}, { confirm: () => true });
  P.wireNotes(root, '0800001', () => Promise.reject(new Error('x')), () => {});
  click();
  await new Promise((r) => setTimeout(r, 0));
  ok(/Not removed/.test(status.textContent) && !rm.disabled, 'a failed removal is reported and the button comes back');
}
ok(/class="pc-note-status" role="status" aria-live="polite" tabindex="-1"/.test(read('js/whitepaper/place-card.js')), 'the log status line is a live region that can take focus');
ok(/class="ask-status" role="status" aria-live="polite"/.test(askSrc) && /body\.innerHTML = render/.test(askSrc) && /saved\('Sent to pggLLC/.test(askSrc), 'a save is announced in a status line that is not redrawn, and focus moves there or back to the form');
ok((askSrc.match(/if \(b(tn)?\.disabled\) return;/g) || []).length === 2, 'the question and answer forms ignore a second submit while saving');
ok(read('developer-about.html').includes('id="ask"') && read('developer-about.html').includes('ask-pggllc.js'), 'the About page carries the form');

console.log('place-card: ' + checks + ' checks passed');
