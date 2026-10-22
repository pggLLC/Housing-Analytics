#!/usr/bin/env node
/**
 * Prop 123 Land Banking awards data (data/policy/prop123-land-banking-awards.json, built by
 * scripts/funding/build_land_banking_awards.py) and where it is used today: the gated
 * Jurisdiction Report. The public map page is held until the site's menu and page pattern
 * are settled (paul, 2026-10-15); its draft lives outside the repo.
 *
 * What it pins is agreement, not copy:
 *   1. the award file agrees with the award ledger it was built from: every
 *      land-banking row of ledger.json appears once with the same amount, units
 *      and round, each round adds up to the total its PDF prints (as recorded in
 *      documents.json), and the headline totals are those sums;
 *   2. every location is the Census centre of a real geography in geo-config.json;
 *   3. the public file carries no contact details and this repository carries no
 *      contacts file; the private contacts file names only real awards, covers
 *      every award, and each contact is in the row or page it quotes;
 *   4. the plain open-round summary says what its quotes say;
 *   5. the Jurisdiction Report lists the awards in a place, and in a county,
 *      with their contacts, and says so when contacts are missing;
 *   6. the gated "Where to build" scorer finds Prop 123 records for the names
 *      in its own progress file (it matched none from 2026-10-11 to 2026-10-15).
 * Every scan asserts it found something; sabotage cases mutate copies.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const clone = (o) => JSON.parse(JSON.stringify(o));
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

const DATA = json('data/policy/prop123-land-banking-awards.json');
const LEDGER = json('data/policy/funding-awards/ledger.json').awards.filter((a) => a.program === 'Prop 123 Land Banking');
const DOCS = json('data/policy/funding-awards/documents.json').documents.filter((d) => d.program === 'Prop 123 Land Banking');
// Named people's contacts live only in the private developer-site repository
// (gated/data/jurisdiction-briefs/_land-banking-contacts.json). Point
// COHO_LAND_BANKING_CONTACTS at that file to check the real one; otherwise a
// made-up stand-in built from the awards file, naming no real person, runs the
// same checks.
function standInContacts(data) {
  const printed = new Set(data.meta.rounds.filter((r) => r.prints_contacts).map((r) => r.id));
  const fromLists = [], researched = [];
  data.awards.forEach((a, i) => {
    const n = String(i).padStart(4, '0');
    const name = `Stand-in Person ${n}`, email = `person${n}@example.org`, phone = `555-010-${n}`;
    const base = { award_id: a.id, project: a.project, org: a.sponsor, geoids: a.places.map((p) => p.geoid), county_fips: a.county_fips };
    if (printed.has(a.round)) fromLists.push({ ...base, name, phone, email, source_quote: `${a.sponsor} ${a.project} ${name} ${phone} ${email}` });
    else if (!researched.length) researched.push({ ...base, name: null, email: null, phone: null, status: 'not_found', confirmed: false });
    else researched.push({ ...base, name, phone, email, source_url: 'https://example.org/staff', source_quote: `${name} ${phone} ${email}`, status: 'found', confirmed: false });
  });
  return { meta: { stand_in: true }, from_award_lists: fromLists, researched };
}
const CONTACTS_FILE = process.env.COHO_LAND_BANKING_CONTACTS || '';
const CONTACTS = CONTACTS_FILE ? JSON.parse(readFileSync(CONTACTS_FILE, 'utf8')) : standInContacts(DATA);
const GEO = json('data/hna/geo-config.json');
const CENTROIDS = json('data/co-place-centroids.json').byGeoid;
const { isSensitive } = await import(join(ROOT, 'scripts/lib/public-sensitive-patterns.mjs'));

// ---- 1. Agrees with the ledger and the PDF totals.
function ledgerAgreement(data) {
  ok(LEDGER.length > 0 && data.awards.length > 0, 'scan found land banking awards');
  const key = (src, amt, units) => `${src}|${amt}|${units}`;
  const want = {};
  for (const a of LEDGER) want[key(a.source_file, a.amount_awarded, a.total_units)] = (want[key(a.source_file, a.amount_awarded, a.total_units)] || 0) + 1;
  const have = {};
  for (const a of data.awards) have[key(a.source_file, a.amount_awarded, a.estimated_units)] = (have[key(a.source_file, a.amount_awarded, a.estimated_units)] || 0) + 1;
  assert.deepEqual(have, want, 'every ledger land-banking row appears once, with the same amount and units');
  for (const r of data.meta.rounds) {
    const doc = DOCS.find((d) => d.file === r.source_file);
    assert.ok(doc, `${r.source_file} is in documents.json`);
    const pdf = Object.fromEntries((doc.checks || []).map((c) => [c.field, c.pdf_total]));
    const rows = data.awards.filter((a) => a.round === r.id);
    assert.equal(rows.length, doc.rows, `${r.id}: award count matches the PDF`);
    assert.equal(rows.reduce((s, a) => s + a.amount_awarded, 0), pdf.amount_awarded, `${r.id}: amounts add up to the PDF total`);
    assert.equal(rows.reduce((s, a) => s + a.estimated_units, 0), pdf.total_units, `${r.id}: units add up to the PDF total`);
    assert.equal(r.sha256, doc.sha256, `${r.id}: built from the same PDF as the ledger`);
    assert.ok(rows.every((a) => a.source_url === doc.url), `${r.id}: every row links its PDF`);
  }
  assert.equal(data.meta.award_count, data.awards.length, 'headline count is the number of awards');
  assert.equal(data.meta.total_awarded, data.awards.reduce((s, a) => s + a.amount_awarded, 0), 'headline dollars are the sum');
  assert.equal(data.meta.total_estimated_units, data.awards.reduce((s, a) => s + a.estimated_units, 0), 'headline units are the sum');
  for (const a of data.awards) {
    assert.ok(a.source_quote.includes('$' + a.amount_awarded.toLocaleString('en-US')) && a.source_quote.includes(a.project) && a.source_quote.includes(a.sponsor),
      `${a.id}: the quote is the row shown`);
    assert.ok(a.amount_awarded > 0 && a.estimated_units > 0, `${a.id}: amount and units are real numbers`);
    assert.equal(a.rental, /Rental/.test(a.purpose), `${a.id}: rental flag follows the purpose`);
    assert.equal(a.homeownership, /Homeownership/.test(a.purpose), `${a.id}: for-sale flag follows the purpose`);
  }
  checks++;
}
ledgerAgreement(DATA);
{
  const bad = clone(DATA); bad.awards[0].amount_awarded += 1000;
  assert.throws(() => ledgerAgreement(bad), 'sabotage: a changed amount fails');
  const short = clone(DATA); short.awards.pop();
  assert.throws(() => ledgerAgreement(short), 'sabotage: a dropped award fails');
  checks += 2;
}
// The corrections file names only rows that exist (the builder enforces this too).
{
  const corr = json('data/policy/funding-awards/land-banking-corrections.json').corrections;
  const keys = new Set(LEDGER.map((a) => `${a.fiscal_year}|${a.name}`));
  ok(Object.keys(corr).length > 0, 'corrections scan found entries');
  for (const k of Object.keys(corr)) ok(keys.has(k), `correction ${k} matches a ledger row`);
}

// ---- 2. Every pin is a real place at its Census centre.
{
  const known = new Map(GEO.places.concat(GEO.cdps).map((p) => [p.geoid, p]));
  let pins = 0;
  for (const a of DATA.awards) {
    ok(a.places.length > 0, `${a.id}: has a place`);
    for (const p of a.places) {
      pins++;
      const g = known.get(p.geoid);
      ok(g, `${a.id}: ${p.geoid} is in geo-config`);
      ok(g.containingCounty === p.county_fips, `${a.id}: ${p.name} sits in its geo-config county`);
      const c = CENTROIDS[p.geoid];
      ok(c && Math.abs(c.lat - p.lat) < 1e-4 && Math.abs(c.lng - p.lng) < 1e-4, `${a.id}: ${p.name} pin is the Gazetteer centre`);
    }
    ok(a.county_fips.length > 0 && a.county_fips.every((f) => /^08\d{3}$/.test(f)), `${a.id}: county FIPS are 5-digit Colorado codes`);
  }
  ok(pins >= DATA.awards.length, 'pin scan found pins');
}

// ---- 3. Contacts stay out of this repository.
{
  ok(!existsSync(join(ROOT, 'data/jurisdiction-briefs/_land-banking-contacts.json')), 'this public repository carries no contacts file');
  ok(!read('scripts/funding/build_land_banking_awards.py').includes("'_land-banking-contacts.json')"), 'the builder has no in-repo contacts path');
  ok(!/_land-banking-contacts/.test(read('.github/workflows/funding-awards.yml').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')), 'the weekly job commits no contacts file');
  const pub = read('data/policy/prop123-land-banking-awards.json');
  ok(!/"(email|phone|contact_name)"\s*:/.test(pub), 'the public award file has no contact fields');
  for (const c of CONTACTS.from_award_lists) ok(!pub.includes(c.email), `the public file does not carry ${c.email}`);
  ok(!isSensitive(pub), 'the public award file passes the public-artifact guard');
  ok(read('scripts/build-public-site.mjs').includes("'data/jurisdiction-briefs'"), 'the public build still leaves data/jurisdiction-briefs out');
  const ids = new Set(DATA.awards.map((a) => a.id));
  const printed = new Set(DATA.meta.rounds.filter((r) => r.prints_contacts).map((r) => r.id));
  ok(printed.size > 0, 'at least one list prints contacts');
  const needing = DATA.awards.filter((a) => printed.has(a.round));
  ok(needing.every((a) => CONTACTS.from_award_lists.some((c) => c.award_id === a.id)), 'every award whose list printed a contact has it');
  for (const c of CONTACTS.from_award_lists) {
    ok(ids.has(c.award_id), `${c.award_id}: contact names a real award`);
    ok(c.source_quote.includes(c.email) && (!c.phone || c.source_quote.includes(c.phone)) && c.source_quote.includes(c.name), `${c.award_id}: contact is in the row it quotes`);
  }
  for (const c of CONTACTS.researched || []) {
    ok(ids.has(c.award_id), `${c.award_id}: researched contact names a real award`);
    const hasDetail = !!(c.name || c.email || c.phone);
    ok(!hasDetail || (/^https:\/\//.test(c.source_url || '') && (c.source_quote || '').length > 0), `${c.award_id}: a researched contact with details quotes its page`);
    // an address behind a mailto link is not printed text; the note must say where it came from
    ok(!c.email || c.source_quote.toLowerCase().includes(c.email.toLowerCase()) || /mailto|link|icon/i.test(c.note || '') || (c.note || '').toLowerCase().includes(c.email.toLowerCase()), `${c.award_id}: researched email is in its quote or its note says where it is`);
    ok(['found', 'partial', 'not_found'].includes(c.status), `${c.award_id}: status is recorded`);
    ok(c.confirmed === false || c.confirmed === true, `${c.award_id}: researched contacts say whether a person checked them`);
  }
  {
    const covered = new Set(CONTACTS.from_award_lists.concat(CONTACTS.researched || []).map((c) => c.award_id));
    ok(DATA.awards.every((a) => covered.has(a.id)), 'every award has a printed or researched contact entry');
  }
}

// ---- 4. The open-round summary says what its quotes say.
{
  const o = DATA.meta.open_round;
  ok(/December 31, 2026/.test(o.summary) && /December 31,\s*2026/.test(o.quote), 'the summary and quote share the closing date');
  ok(/January 2027/.test(o.summary) && /January 2027/.test(o.quote), 'the summary and quote share the statewide start');
  ok(/\$31 million/.test(o.summary) && /\$31 million/.test(o.allocation_quote), 'the summary and quote share the amount');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(o.review_by) && o.review_by >= o.checked, 'the open round carries a re-check date');
}

// ---- 5. The Jurisdiction Report lists the awards in a place with their contacts.
{
  const WP = require(join(ROOT, 'js/whitepaper/jurisdiction-whitepaper.js'));
  const FundingFit = require(join(ROOT, 'js/funding-fit.js'));
  const { loadSources } = await import(join(ROOT, 'scripts/whitepaper/build-whitepaper.mjs'));
  const src = loadSources();
  ok(!src.landBankingContacts, 'the public checkout loads no contacts');
  src.landBankingContacts = CONTACTS;
  const leadvilleGeoid = DATA.awards.find((a) => a.places.some((p) => p.name === 'Leadville')).places[0].geoid;
  const m = WP.buildModel(src, leadvilleGeoid, { FundingFit, today: '2026-10-15' });
  const here = DATA.awards.filter((a) => a.places.some((p) => p.geoid === leadvilleGeoid));
  ok(m.prop123.landBanking && m.prop123.landBanking.awards.length === here.length, 'the report lists every award in the place');
  const html = WP.renderHtml(m);
  for (const a of here) {
    const c = CONTACTS.from_award_lists.find((x) => x.award_id === a.id);
    ok(html.includes(a.project.replace(/&/g, '&amp;')), `report names ${a.project}`);
    ok(c && html.includes(c.email), `report shows the CHFA-printed contact for ${a.project}`);
  }
  const county = WP.buildModel(src, here[0].county_fips[0], { FundingFit, today: '2026-10-15' });
  ok(county.prop123.landBanking.awards.length >= here.length, 'the county report includes its towns\' awards');
  const none = clone(src); none.landBankingContacts = null;
  ok(WP.renderHtml(WP.buildModel(none, leadvilleGeoid, { FundingFit, today: '2026-10-15' })).includes('Contacts not in this copy of the data'), 'missing contacts are said, not hidden');
}

// ---- 6. "Where to build" finds Prop 123 records for its own names.
{
  const W = require(join(ROOT, 'js/where-to-build.js'));
  const dola = json('data/policy/prop123_jurisdictions.json').jurisdictions;
  const rankings = json('data/hna/ranking-index.json').rankings;
  const placeKeys = new Set(rankings.filter((r) => r.type !== 'county').map((r) => W.nameKey(r.name)));
  const countyKeys = new Set(rankings.filter((r) => r.type === 'county').map((r) => W.nameKey(r.name)));
  const towns = dola.filter((j) => j.kind === 'municipality');
  const matched = towns.filter((j) => placeKeys.has(W.nameKey(j.name))).length;
  ok(towns.length > 100 && matched === towns.length, `the scorer matches ${matched} of ${towns.length} DOLA town filings to a ranked place`);
  ok(dola.filter((j) => j.kind === 'county').every((j) => countyKeys.has(W.nameKey(j.name))), 'every DOLA county filing matches a ranked county');
  const naive = towns.filter((j) => placeKeys.has(W.prop123Key(j.name))).length;
  ok(naive < matched, 'sabotage: the old prefix-only key matches fewer');
  ok(W.nameKey('Cañon City (city)') === W.nameKey('City of Canon City') && W.nameKey('Mt. Crested Butte (town)') === W.nameKey('Town of Mount Crested Butte'),
    'accents and Mt./Mount spellings match');
}

// ---- 7. The Where to build map agrees with the awards file and keeps contacts honest.
{
  const LBM = require(join(ROOT, 'js/land-banking-map.js'));
  const GATED = { mode: 'gated', reportBase: 'developer-brief.html?geoid=' };
  const all = LBM.summarize(DATA.awards);
  ok(all.awards === DATA.meta.award_count && all.amount === DATA.meta.total_awarded && all.units === DATA.meta.total_estimated_units,
    'the map summary is the file\'s totals');
  const towns = LBM.groupByTown(DATA.awards);
  const geoids = new Set(DATA.awards.flatMap((a) => a.places.map((p) => p.geoid)));
  ok(towns.length === geoids.size && all.towns === geoids.size, `one pin per town (${towns.length})`);
  for (const a of DATA.awards) {
    for (const p of a.places) ok(towns.find((t) => t.geoid === p.geoid).awards.includes(a), `${a.id} is on the ${p.name} pin`);
  }
  const C = LBM.contactIndex(CONTACTS);
  for (const a of DATA.awards) ok(C[a.id], `${a.id} has a contact entry on the map`);
  for (const t of towns) {
    const html = LBM.popupHtml(t, DATA, C, false, GATED);
    ok(html.includes(`developer-brief.html?geoid=${t.geoid}`), `${t.name} links to its report`);
    for (const a of t.awards) ok(html.includes((a.show_project || a.project).replace(/&/g, '&amp;').replace(/'/g, '&#39;')), `${t.name} lists ${a.project}`);
  }
  // CHFA-printed contacts show as quoted; researched ones say "to confirm".
  const chfa = CONTACTS.from_award_lists[0];
  const chfaHtml = LBM.contactHtml(C[chfa.award_id], DATA, false);
  ok(chfaHtml.includes(chfa.email) && chfaHtml.includes('named on CHFA') && !chfaHtml.includes('to confirm'), 'a CHFA-printed contact is shown as CHFA\'s');
  const res = CONTACTS.researched.find((c) => c.status === 'found' && c.confirmed !== true && !CONTACTS.from_award_lists.some((x) => x.award_id === c.award_id));
  ok(res && LBM.contactHtml(C[res.award_id], DATA, false).includes('to confirm'), 'a researched contact is marked to confirm');
  const nf = CONTACTS.researched.find((c) => c.status === 'not_found');
  ok(nf && LBM.contactHtml(C[nf.award_id], DATA, false).includes('No public contact found') && LBM.contactHtml(C[nf.award_id], DATA, false).includes(DATA.meta.program_email),
    'an award with no contact points to CHFA');
  ok(LBM.contactHtml(undefined, DATA, true).includes('Contacts are not in this copy'), 'a missing contacts file is said, not hidden');
  // Sabotage: a confirmed researched contact loses the tag, and markup in a name is escaped.
  ok(!LBM.contactHtml({ ...C[res.award_id], confirmed: true }, DATA, false).includes('to confirm'), 'sabotage: confirming a contact removes the tag');
  ok(!LBM.contactHtml({ kind: 'chfa', name: '<img src=x>' }, DATA, false).includes('<img'), 'contact names are escaped');
  // Every town's tap target is at least 44px across, however small its pin.
  ok(towns.every((t) => 2 * LBM.hitRadius(t) >= 44), 'every pin has a 44px tap target');
  // Close pins: a tap goes to the nearest town, not whichever pin was drawn last.
  // Project so Denver and Thornton sit 8px apart, as they do at state zoom on a phone.
  const den = towns.find((t) => t.name === 'Denver'), tho = towns.find((t) => t.name === 'Thornton');
  ok(den && tho, 'Denver and Thornton both have pins');
  const K = 8 / Math.hypot(den.lat - tho.lat, den.lng - tho.lng);
  const proj = ([lat, lng]) => ({ x: lng * K, y: -lat * K });
  const at = (t, dx = 0) => { const p = proj([t.lat, t.lng]); return { x: p.x + dx, y: p.y }; };
  ok(LBM.nearestTown(towns, at(den), proj) === den, 'a tap on Denver points at Denver, not Thornton');
  // Every town keeps its full 44px area: a tap 21px from Denver, on the far side of Thornton,
  // still reaches Denver (in a chooser with Thornton), not Thornton alone.
  const dx = (proj([tho.lat, tho.lng]).x - proj([den.lat, den.lng]).x) >= 0 ? 1 : -1;
  const near = LBM.townsNear(towns, at(den, 21 * dx), proj);
  ok(near.includes(den) && near.includes(tho), 'a tap 21px past Denver toward Thornton still reaches Denver');
  ok(towns.every((t) => LBM.townsNear(towns, at(t, 21), proj).includes(t) && LBM.townsNear(towns, at(t, -21), proj).includes(t)), 'every town is reachable 21px either side of its pin');
  ok(LBM.nearestTown([den], at(den, 21), proj) === den && LBM.nearestTown([den], at(den, 23), proj) === null, 'the tap reaches 22px from a pin and no further');
  // An exact town search opens that town, even when a shared award keeps other towns on the map.
  const shared = DATA.awards.find((a) => a.places.length > 1);
  ok(shared, 'the file has an award shared by several towns');
  for (const p of shared.places) {
    const t = LBM.townForSearch(LBM.groupByTown(LBM.filterAwards(DATA.awards, p.name)), p.name);
    ok(t && t.geoid === p.geoid, `searching "${p.name}" opens ${p.name}`);
  }
  ok(LBM.townForSearch(towns, '') === null && LBM.townForSearch(towns, 'county') === null, 'a broad or empty search opens nothing');
  // Keyboard path: every pin's town is also a button, with its award count.
  const list = LBM.townListHtml(towns);
  ok((list.match(/<button type="button" data-lbm-town=/g) || []).length === towns.length, `every town is also a button (${towns.length})`);
  ok(towns.every((t) => list.includes(`data-lbm-town="${t.geoid}"`)), 'each button opens its own town');
  const narrowed = LBM.filterAwards(DATA.awards, 'leadville');
  ok(narrowed.length > 0 && narrowed.every((a) => /leadville/i.test([a.project, a.sponsor, a.location, ...a.places.map((p) => p.name)].join(' '))), 'search narrows to the town');

  const page = read('developer-where.html');
  ok(page.includes('data-land-banking-map') && page.includes('js/land-banking-map.js') && page.includes('data-lbm-contacts="data/jurisdiction-briefs/_land-banking-contacts.json"') && page.includes('data-lbm-report="developer-brief.html?geoid="') && page.includes('js/vendor/leaflet.js') && page.includes('data-lbm-detail'),
    'Where to build carries the map section');
  ok(page.includes('css/land-banking-map.css') && /#lbmMap \.leaflet-control-zoom a \{[^}]*width:44px;[^}]*height:44px/.test(read('css/land-banking-map.css')), 'the zoom buttons are 44px');
  ok(page.includes('data-lbm-towns') && /data-lbm-detail[^>]*tabindex="-1"/.test(page), 'the page carries the town list and a focusable details panel');
  ok(page.indexOf('id="tiers"') < page.indexOf('data-land-banking-map'), 'the shortlist stays above the map');
  // The contacts are gated: the public build leaves out the contacts file and the gated page.
  const pub = read('scripts/build-public-site.mjs');
  ok(pub.includes("'data/jurisdiction-briefs'") && pub.includes("'developer-where.html'"), 'the public build leaves out the gated page and the contacts');
}

// ---- 8. The public page: same awards, no named person, and it never asks for the contacts file.
{
  const PAGE = read('land-banking-awards.html');
  const LBM = require(join(ROOT, 'js/land-banking-map.js'));
  const LBA = require(join(ROOT, 'js/land-banking-awards.js'));
  const towns = LBM.groupByTown(DATA.awards);
  // Every value a person could be reached by, from both halves of the contacts file.
  const personal = [...CONTACTS.from_award_lists, ...CONTACTS.researched]
    .flatMap((c) => [c.name, c.email, c.phone]).filter((v) => v && String(v).length > 3 && v !== DATA.meta.program_email);
  ok(personal.length > 20, `scan found contact values to look for (${personal.length})`);
  const C = LBM.contactIndex(CONTACTS);
  const leaks = (html) => personal.filter((v) => html.includes(String(v).replace(/&/g, '&amp;').replace(/'/g, '&#39;')));
  for (const t of towns) {
    const html = LBM.popupHtml(t, DATA, C, false, { mode: 'public' });
    ok(leaks(html).length === 0, `${t.name}: the public panel names no person`);
    ok(html.includes(`housing-needs-assessment.html?geoid=${t.geoid}&amp;geoType=place&amp;auto=1`) && !html.includes('developer-brief.html'), `${t.name}: links to its public needs assessment`);
    ok(html.includes(DATA.meta.program_email), `${t.name}: points to CHFA's program contact`);
    for (const a of t.awards) ok(html.includes((a.show_sponsor || a.sponsor).replace(/&/g, '&amp;').replace(/'/g, '&#39;')), `${t.name}: names the grantee of ${a.project}`);
  }
  // Sabotage: the same panel in gated mode does name people, so the leak scan can see them.
  ok(towns.some((t) => leaks(LBM.popupHtml(t, DATA, C, false, { mode: 'gated', reportBase: 'developer-brief.html?geoid=' })).length > 0), 'sabotage: the gated panel names people and the scan sees it');

  // Booted in a page, the public map requests the awards and status files and never the contacts file.
  const dom = new JSDOM(PAGE, { runScripts: 'outside-only', url: 'https://cohoanalytics.com/land-banking-awards.html' });
  const requested = [];
  const caches = [];
  dom.window.fetch = (u, o) => { requested.push(String(u)); caches.push(o && o.cache); return Promise.resolve({ ok: true, json: () => Promise.resolve(clone(DATA)) }); };
  dom.window.LandBankingMapNoAutoStart = true;
  dom.window.eval(read('js/land-banking-map.js'));
  await dom.window.LandBankingMap.start();
  ok(requested.length === 2 && requested[0] === LBM.AWARDS && requested[1] === LBM.STATUS, `the public page requests only the awards and status files (${requested.join(', ')})`);
  ok(caches[0] === 'no-store', 'the awards file is fetched with no-store, so a data update reaches a returning browser');
  ok(dom.window.document.querySelector('[data-lbm-towns]').querySelectorAll('button').length === towns.length, 'the public town list has every town');
  // The table and the map share one request, so they always show the same snapshot.
  dom.window.eval(read('js/land-banking-awards.js'));
  await new Promise((r) => setTimeout(r, 0));
  ok(requested.length === 2, `the table reuses the map's request (${requested.length} requests)`);
  ok(dom.window.document.querySelector('[data-lb-rows]').querySelectorAll('tr').length > 1, 'the table rendered from the shared request');
  ok(!PAGE.includes('_land-banking-contacts') && !read('js/land-banking-awards.js').includes('_land-banking-contacts'), 'nothing on the public page names the contacts file');
  // Sabotage: marked gated, the same page asks for the contacts file.
  const CPATH = 'data/jurisdiction-briefs/_land-banking-contacts.json';
  const gated = new JSDOM(PAGE.replace('data-land-banking-map ', `data-land-banking-map data-lbm-contacts="${CPATH}" `), { runScripts: 'outside-only' });
  ok(gated.window.document.querySelector('[data-lbm-contacts]'), 'sabotage mutation applied');
  const asked = [];
  gated.window.fetch = (u) => { asked.push(String(u)); return Promise.resolve({ ok: true, json: () => Promise.resolve(u.includes('contacts') ? clone(CONTACTS) : clone(DATA)) }); };
  gated.window.LandBankingMapNoAutoStart = true;
  gated.window.eval(read('js/land-banking-map.js'));
  await gated.window.LandBankingMap.start();
  ok(asked.includes(CPATH), 'sabotage: a page naming a contacts file does request it');

  // Every tappable control on the public page is at least 44px tall, including the "Row as printed" toggles.
  const quoteRule = (PAGE.match(/details\.lb-quote > summary \{([^}]*)\}/) || [])[1] || '';
  ok(/min-height:\s*44px/.test(quoteRule), 'the "Row as printed" toggle is at least 44px tall');
  for (const sel of ['a[data-lb-csv]', 'button[data-lb-more]']) {
    const at = PAGE.indexOf(sel + ' {');
    const rule = at < 0 ? '' : PAGE.slice(at, PAGE.indexOf('}', at));
    ok(/min-height:\s*44px/.test(rule) && PAGE.includes(sel.replace(/^(a|button)\[(.*)\]$/, '$2')), `${sel} is at least 44px tall`);
  }
  ok(LBA.rowHtml(DATA.awards[0], DATA).includes('lb-quote'), 'the table rows use that toggle');

  // The table and its download carry every award, and the headline is the file's totals.
  const lead = LBA.leadHtml(DATA);
  ok(lead.includes(`$${(DATA.meta.total_awarded / 1e6).toFixed(1)} million`) && lead.includes(String(DATA.meta.award_count)) &&
    lead.includes(DATA.meta.total_estimated_units.toLocaleString('en-US')), 'the headline is the file\'s totals');
  const csv = LBA.csvText(DATA.awards, DATA).trim().split('\n');
  ok(csv.length === DATA.meta.award_count + 1, `the download has every award (${csv.length - 1})`);
  ok(leaks(csv.join('\n')).length === 0 && leaks(DATA.awards.map((a) => LBA.rowHtml(a, DATA)).join('')).length === 0, 'the table and download name no person');

  // Names agree: page title, heading and menu label; the page is in the sitemap and the Funding Sources card links to it.
  const h1 = (PAGE.match(/<h1[^>]*>([^<]+)<\/h1>/) || [])[1];
  const title = ((PAGE.match(/<title>([^|<]+)/) || [])[1] || '').trim();
  const nav = read('js/navigation.js').match(/label: "([^"]+)",\s*href: "land-banking-awards\.html"/);
  ok(h1 && nav && h1 === title && h1 === nav[1], `title, heading and menu label agree ("${title}" / "${h1}" / "${nav && nav[1]}")`);
  ok(read('sitemap.xml').includes('https://cohoanalytics.com/land-banking-awards.html'), 'the page is in the sitemap');
  const guide = json('data/policy/co-developer-funding-guide.json');
  const lb = guide.programs.find((p) => p.id === 'prop123-ahff-land-banking');
  ok(lb && lb.past_awards_page && existsSync(join(ROOT, lb.past_awards_page.href.split('#')[0])), 'the Funding Sources card links to a page that exists');
  ok(read('js/co-developer-funding.js').includes('pastAwardsLink(p)'), 'the card renders that link');
  const pub = read('scripts/build-public-site.mjs');
  ok(!pub.includes("'land-banking-awards.html'") && !pub.includes("'js/land-banking-map.js'"), 'the public build keeps the public page and its map');
  // Every column header carries a hover definition (site rule: the tip is on the header itself).
  const ths = (PAGE.match(/<table class="data-table lb-table">[\s\S]*?<\/thead>/) || [''])[0].match(/<th\b[^>]*>/g) || [];
  ok(ths.length === 9 && ths.every((t) => /data-tip="[^"]{20,}"/.test(t)), `every award table header has a hover definition (${ths.length})`);
  ok(/button\[data-lb-more\]\[hidden\]\s*\{\s*display:\s*none/.test(PAGE), 'the "Show all" button really hides (the .btn rule sets display)');

  // A corrected name is what readers see; the printed row stays in the quote. A "since" line is dated and sourced.
  const shown = DATA.awards.filter((a) => a.show_project || a.show_sponsor);
  ok(shown.length >= 2, 'scan found corrected names');
  for (const a of shown) {
    const row = LBA.rowHtml(a, DATA);
    ok(row.includes(a.show_project || a.show_sponsor) && a.source_quote.includes(a.project) && a.source_quote.includes(a.sponsor), `${a.id}: shows the corrected name and quotes the printed one`);
  }
  const since = DATA.awards.filter((a) => a.since);
  ok(since.length >= 1, 'scan found a "since" line');
  for (const a of since) {
    ok(/^\d{4}-\d{2}-\d{2}$/.test(a.since.checked) && a.since.sources.length && a.since.sources.every((x) => /^https:\/\//.test(x.url)), `${a.id}: "since" is dated and sourced`);
    ok(LBA.rowHtml(a, DATA).includes('Since the award:') && LBM.popupHtml({ name: 'x', awards: [a] }, DATA, {}, false, { mode: 'public' }).includes('Since the award:'), `${a.id}: table and map both show "since"`);
  }
  ok(!/Mews|Phase II of/i.test(JSON.stringify(since)), 'no "since" line names a developer project');

  // Each award's status: built from the ledger and the research notes, current, shown on both surfaces.
  const ST = json('data/policy/prop123-land-banking-status.json');
  ok(DATA.awards.every((a) => ST.status[a.id] && ST.meta.labels[ST.status[a.id].status] === ST.status[a.id].label), 'every award has a status with a known label');
  ok(Object.keys(ST.status).length === DATA.awards.length, 'the status file has no award the list lacks');
  ok(Array.isArray(ST.meta.unlinked) && ST.meta.unlinked.length === 0, `every award links to one ledger project (${(ST.meta.unlinked || []).join(', ')})`);
  const rebuilt = spawnSync('python3', [join(ROOT, 'scripts/funding/build_land_banking_status.py'), '--check'], { encoding: 'utf8' });
  ok(rebuilt.status === 0, `the status file is current (${(rebuilt.stderr || '').trim()})`);
  for (const [id, st] of Object.entries(ST.status)) {
    if (st.status === 'none' || st.status === 'none_found') continue;
    ok(st.text && st.sources.length && st.sources.every((x) => /^https:\/\//.test(x.url)), `${id}: a "${st.status}" status is sourced`);
  }
  const research = json('data/policy/funding-awards/land-banking-status-research.json');
  for (const [id, n] of Object.entries(research.entries)) {
    ok(/^\d{4}-\d{2}-\d{2}$/.test(n.checked), `${id}: research note is dated`);
    ok(!n.text || !isSensitive(n.text), `${id}: research text names no developer or person`);
  }
  ok(!/Northpointe|Southwest Community Partners|Volunteers of America|Mews/i.test(JSON.stringify(research.entries, (k, v) => (k === 'url' ? undefined : v))), 'research notes leave developer names to the linked sources');
  globalThis.LandBankingMap = LBM;
  const withStatus = LBM.attachStatus({ awards: DATA.awards.map((a) => ({ ...a })) }, ST).awards;
  const partner = withStatus.find((a) => a.status && a.status.status === 'partner');
  ok(partner && LBA.rowHtml(partner, DATA).includes('<strong>Development partner chosen</strong>') &&
    LBM.popupHtml({ name: 'x', awards: [partner] }, DATA, {}, false, { mode: 'public' }).includes('Status: Development partner chosen'), 'table and map both show the status');
  ok(LBA.csvText([partner], DATA).split('\n')[1].includes('Development partner chosen'), 'the download carries the status');
  const evil = { ...partner, status: { ...partner.status, text: '<img src=x onerror=alert(1)>', sources: [{ title: 'x', url: 'javascript:alert(1)' }] } };
  ok(!/<img|javascript:/.test(LBM.statusHtml(evil)), 'the status line escapes its text and drops non-https links');
  delete globalThis.LandBankingMap;

  ok(!/developer-|jurisdiction-briefs/.test(read('js/land-banking-map.js').replace(/\/\*[\s\S]*?\*\//g, '')), 'the shared map code names no gated path');
}

console.log(`land-banking-awards: ${checks} checks passed`);
