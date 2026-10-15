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
 *   3. the public file carries no contact details; the gated contacts file names
 *      only real awards, covers every award, and each contact is in the row or
 *      page it quotes;
 *   4. the plain open-round summary says what its quotes say;
 *   5. the Jurisdiction Report lists the awards in a place, and in a county,
 *      with their contacts, and says so when contacts are missing;
 *   6. the gated "Where to build" scorer finds Prop 123 records for the names
 *      in its own progress file (it matched none from 2026-10-11 to 2026-10-15).
 * Every scan asserts it found something; sabotage cases mutate copies.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const CONTACTS = json('data/jurisdiction-briefs/_land-banking-contacts.json');
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

// ---- 3. Contacts stay in the gated file.
{
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
  const page = read('developer-where.html');
  const fn = page.match(/function prop123Key\(name\) \{[\s\S]*?\n  \}/);
  ok(fn, 'found the scorer\'s Prop 123 name key');
  const prop123Key = new Function(fn[0] + '; return prop123Key;')();
  const dola = new Set(json('data/policy/prop123_jurisdictions.json').jurisdictions.map((j) => prop123Key(j.name)));
  const prog = Object.values(json('data/policy/jurisdiction-housing-progress.json').by_geoid);
  const matched = prog.filter((r) => dola.has(prop123Key(r.name))).length;
  ok(prog.length > 0 && matched >= prog.length - 2, `the scorer matches ${matched} of ${prog.length} progress names to DOLA's list`);
  const naive = prog.filter((r) => new Set(json('data/policy/prop123_jurisdictions.json').jurisdictions.map((j) => j.name.toLowerCase())).has(r.name.toLowerCase())).length;
  ok(naive < matched, 'sabotage: the old lowercase-only lookup matches fewer');
  ok(/prop123Map\[prop123Key\(rec\.name\)\]/.test(page) && /prop123Key\(p\.jurisdiction \|\| p\.name\)/.test(page), 'both sides of the lookup use the key');
}

// ---- 7. The Where to build map agrees with the awards file and keeps contacts honest.
{
  const LBM = require(join(ROOT, 'js/whitepaper/land-banking-map.js'));
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
    const html = LBM.popupHtml(t, DATA, C, false);
    ok(html.includes(`developer-brief.html?geoid=${t.geoid}`), `${t.name} links to its report`);
    for (const a of t.awards) ok(html.includes(a.project.replace(/&/g, '&amp;').replace(/'/g, '&#39;')), `${t.name} lists ${a.project}`);
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
  const narrowed = LBM.filterAwards(DATA.awards, 'leadville');
  ok(narrowed.length > 0 && narrowed.every((a) => /leadville/i.test([a.project, a.sponsor, a.location, ...a.places.map((p) => p.name)].join(' '))), 'search narrows to the town');

  const page = read('developer-where.html');
  ok(page.includes('data-land-banking-map') && page.includes('js/whitepaper/land-banking-map.js') && page.includes('js/vendor/leaflet.js') && page.includes('data-lbm-detail'),
    'Where to build carries the map section');
  ok(page.indexOf('id="tiers"') < page.indexOf('data-land-banking-map'), 'the shortlist stays above the map');
  // The contacts are gated: the module ships only inside js/whitepaper, which the public build leaves out.
  const pub = read('scripts/build-public-site.mjs');
  ok(pub.includes("'js/whitepaper'") && pub.includes("'data/jurisdiction-briefs'") && pub.includes("'developer-where.html'"), 'the public build leaves out the map, its page and the contacts');
}

console.log(`land-banking-awards: ${checks} checks passed`);
