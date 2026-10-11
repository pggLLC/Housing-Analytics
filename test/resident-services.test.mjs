#!/usr/bin/env node
/**
 * Services in Affordable Housing (resident-services.html).
 *
 * The page's promise: every figure and rule it states is quoted from a named
 * source and dated. These checks recompute that from the committed files:
 *   1. data/policy/resident-services.json is well formed, every record has a
 *      source, a check date and a later re-check date, and the file's own
 *      dates are its records' earliest;
 *   2. every number a record states (title, finding, figure) is in its quote;
 *   3. every CHFA QAP quote is in the QAP text the weekly watch fetched;
 *   4. every award note names a real 2026 award and quotes its description;
 *   5. the rendered page draws every record, counts the awards from the award
 *      file, and marks an overdue record;
 *   6. the pages that link here, and the copy elsewhere that repeats a QAP
 *      rule, agree with the records they point at.
 * Non-vacuity is asserted on each scan.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const DOC = json('data/policy/resident-services.json');
const AWARDS = json(DOC.awards.file);
const WATCH = json('data/audit/chfa-qap-watch.json');
const KINDS = ['evidence', 'qap', 'funding', 'cost'];

// ── 1. Well formed ─────────────────────────────────────────────────────────
const ids = new Set();
const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
for (const e of DOC.entries) {
  assert(!ids.has(e.id), `duplicate id ${e.id}`); ids.add(e.id);
  assert(KINDS.includes(e.kind), `${e.id}: unknown kind ${e.kind}`);
  counts[e.kind]++;
  assert(e.title && e.finding && e.quote, `${e.id}: needs a title, a finding and a quote`);
  assert(/^https:\/\//.test(e.source_url || ''), `${e.id}: source_url must be https`);
  assert(ISO.test(e.last_verified || ''), `${e.id}: last_verified missing`);
  assert(ISO.test(e.review_by || ''), `${e.id}: review_by missing`);
  assert(e.review_by > e.last_verified, `${e.id}: review_by must come after last_verified`);
  if (e.kind === 'evidence') assert(['strong', 'moderate', 'limited'].includes(e.strength), `${e.id}: strength must be strong, moderate or limited`);
}
for (const [k, min] of Object.entries({ evidence: 5, qap: 5, funding: 3, cost: 2 })) {
  assert(counts[k] >= min, `only ${counts[k]} ${k} records; the page section would be thin and this scan vacuous`);
}
const earliest = (field) => DOC.entries.map((e) => e[field]).sort()[0];
assert.equal(DOC.meta.last_verified, earliest('last_verified'), 'meta.last_verified must be the earliest record check (the hub card shows it)');
assert.equal(DOC.meta.review_by, earliest('review_by'), 'meta.review_by must be the earliest record re-check');

// ── 2. Every number a record states is in its quote ────────────────────────
// "$1,200" and "1200" are the same figure; "15" and "fifteen" are not, so a
// title that spells a number in words is not checked (none should need to).
const numbers = (s) => (String(s || '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, ''));
let figuresChecked = 0;
for (const e of DOC.entries) {
  const inQuote = new Set(numbers(e.quote));
  for (const field of ['title', 'finding', 'figure', 'population', 'caveat', 'limits']) {
    for (const n of numbers(e[field])) {
      figuresChecked++;
      assert(inQuote.has(n), `${e.id}: ${field} states ${n}, which its quote does not`);
    }
  }
}
assert(figuresChecked >= 10, `only ${figuresChecked} figures checked; the scan is vacuous`);

// ── 3. QAP quotes are in the QAP text CHFA published ───────────────────────
const qapDoc = WATCH.documents.find((d) => d.url === DOC.meta.qap_document.url);
assert(qapDoc, 'meta.qap_document.url is not a document in data/audit/chfa-qap-watch.json');
assert(qapDoc.fetch_ok && qapDoc.text && qapDoc.text.length > 100000, 'the QAP watch holds no usable text for that document');
assert.equal(norm(qapDoc.title), norm(DOC.meta.qap_document.title), 'meta.qap_document.title must be the watch title');
const qapText = norm(qapDoc.text);
let qapChecked = 0;
for (const e of DOC.entries.filter((x) => x.kind === 'qap')) {
  assert.equal(e.source_url, DOC.meta.qap_document.url, `${e.id}: a QAP record must cite the QAP document`);
  assert(qapText.includes(norm(e.quote)), `${e.id}: quote is not in "${qapDoc.title}"`);
  qapChecked++;
}
assert(qapChecked >= 5, 'QAP quote scan is vacuous');

// ── 4. Award notes quote real awards ───────────────────────────────────────
const byName = new Map(AWARDS.awards.map((a) => [a.name, a]));
const notes = DOC.awards.items;
const EVIDENCE_OF = {
  resident_services: /\b(services|counseling|workshops)\b/i,
  older_adults: /\bservices\b/i,
  disability: /\bservices\b/i,
  community: /\b(partner(ed)? with|memberships|meals)\b/i,
};
assert(notes.length >= 5, 'award note scan is vacuous');
for (const n of notes) {
  const a = byName.get(n.name);
  assert(a, `award note ${n.name} is not in ${DOC.awards.file}`);
  assert(norm(a.description).includes(norm(n.quote)), `${n.name}: quote is not in CHFA's description`);
  assert(DOC.awards.models[n.model], `${n.name}: unknown model ${n.model}`);
  // The quote must itself show the kind of service the row is labelled with;
  // a quote that only names who lives there is not a services description.
  assert(EVIDENCE_OF[n.model], `${n.name}: no evidence rule for model ${n.model}`);
  assert(EVIDENCE_OF[n.model].test(n.quote), `${n.name}: quote does not describe ${DOC.awards.models[n.model]}`);
}
assert.deepEqual(Object.keys(DOC.awards.models).sort(), Object.keys(EVIDENCE_OF).sort(), 'every award model needs an evidence rule here');
assert.equal(new Set(notes.map((n) => n.name)).size, notes.length, 'an award is noted twice');

// ── 5. The rendered page ───────────────────────────────────────────────────
// Review warnings are dated in Denver (js/components/review-status.js), so the
// expected cutoff is too; a UTC date is a day ahead every evening.
function today(offset) {
  const denver = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const d = new Date(`${denver}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10);
}
async function renderPage(doc) {
  const dom = new JSDOM(read('resident-services.html'), { runScripts: 'outside-only', url: 'http://localhost/resident-services.html' });
  const w = dom.window;
  w.fetch = () => new Promise(() => {}); // render() is called directly below
  w.eval(read('js/provenance-label.js'));
  w.eval(read('js/components/review-status.js'));
  w.eval(read('js/resident-services.js'));
  const rootEl = w.document.querySelector('[data-resident-services]');
  assert(rootEl, 'the page has no [data-resident-services] root');
  w.ResidentServices.render(rootEl, doc, AWARDS);
  return w.document;
}
{
  const doc = await renderPage(DOC);
  const drawn = [...doc.querySelectorAll('[data-rs-entry]')].map((el) => el.dataset.rsEntry).sort();
  assert.deepEqual(drawn, DOC.entries.map((e) => e.id).sort(), 'the page does not draw exactly the records in the file');
  const lead = doc.querySelector('[data-rs-award-count]').textContent;
  assert(lead.includes(`${notes.length} of the ${AWARDS.awards.length} developments`), `award lead does not count from the files: "${lead}"`);
  assert(lead.includes(AWARDS.metadata.round), 'award lead does not name the round from the award file');
  assert.equal(doc.querySelectorAll('[data-rs-awards] tbody tr').length, notes.length, 'award table rows differ from the notes');
  assert.equal(doc.querySelectorAll('[data-review-status]').length, DOC.entries.filter((e) => e.review_by <= today(14)).length,
    'review warnings do not match the records due within 14 days');
}
{
  const late = JSON.parse(JSON.stringify(DOC));
  late.entries[0].review_by = today(-2);
  const doc = await renderPage(late);
  const card = doc.querySelector(`[data-rs-entry="${late.entries[0].id}"]`);
  assert(card.querySelector('[data-review-status="overdue"]'), 'an overdue record is not marked on its card');
}

// ── 6. Links and repeated claims agree ─────────────────────────────────────
for (const page of ['js/navigation.js', 'insights.html', 'sitemap.xml', 'lihtc-guide-for-stakeholders.html', 'hna-what-to-do.html', 'deal-calculator.html']) {
  assert(read(page).includes('resident-services.html'), `${page} does not link to resident-services.html`);
}
assert(json('data/insights/catalog.json').entries.some((e) => e.url === 'resident-services.html' && e.review_from && e.review_from.file === 'data/policy/resident-services.json'),
  'the research catalog does not list the page with its review file');
const qap = Object.fromEntries(DOC.entries.filter((e) => e.kind === 'qap').map((e) => [e.id, norm(e.quote)]));
// The Deal Calculator card says the developer fee boost must be spent on services or rent help.
const calc = read('deal-calculator.html');
const card = calc.slice(calc.indexOf('id="dc-edu-services"'), calc.indexOf('</div>', calc.indexOf('id="dc-edu-services"')));
assert(/developer fee boost CHFA requires to be spent on services or rent help/.test(card), 'the Deal Calculator services card no longer states the fee-boost rule');
assert(qap['qap-developer-fee-boost'] && qap['qap-developer-fee-boost'].includes('supportive services or a rental subsidy'),
  'the Deal Calculator states a fee-boost rule the QAP record no longer quotes');
// The page says providers need three years' experience and that MOUs must be executed and dated.
const page = norm(read('resident-services.html'));
assert(page.includes('providers with at least three years of experience'), 'page no longer states the provider-experience rule');
assert(Object.values(qap).some((q) => q.includes('minimum of three years')), 'the page states a provider-experience rule no QAP record quotes');
assert(page.includes('CHFA requires executed, dated MOUs'), 'page no longer states the MOU rule');
assert(Object.values(qap).some((q) => q.includes('executed and dated by both parties')), 'the page states an MOU rule no QAP record quotes');

console.log(`resident-services: ${DOC.entries.length} records, ${figuresChecked} figures, ${qapChecked} QAP quotes, ${notes.length} award notes checked`);
