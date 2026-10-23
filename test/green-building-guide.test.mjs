#!/usr/bin/env node
/**
 * Green Building in a Colorado Deal (green-building-guide.html).
 *
 * The page's promise: every rule, figure and program status it states is
 * quoted from a named, dated source. These checks recompute that from the
 * committed files:
 *   1. data/policy/green-building.json is well formed: every record has a
 *      section, quotes, an https source, a check date and a later re-check
 *      date, and the file's own dates are its records' earliest;
 *   2. every number a record states (title, finding, caveat, fits) is in its
 *      quotes;
 *   3. every CHFA QAP quote is in the QAP text the weekly watch fetched, and
 *      a record that says the Third Draft reads the same is in that text too;
 *   4. the rendered page draws every record once, with a status on every
 *      credit and program, and each row of the "which program" table points
 *      at records that exist;
 *   5. the menu, catalog, sitemaps and the Deal Calculator link to the page,
 *      and the Deep Dive and Deal Calculator lines that repeat the CHFA rule
 *      agree with the records: the same certification programs, "not points",
 *      and the EV-ready exemptions.
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

const PAGE = 'green-building-guide.html';
const DOC = json('data/policy/green-building.json');
const WATCH = json('data/audit/chfa-qap-watch.json');
const SECTIONS = ['requirements', 'benefits', 'deal', 'credits', 'programs'];
const NEEDS_STATUS = new Set(['credits', 'programs']);

// ── 1. Well formed ─────────────────────────────────────────────────────────
const ids = new Set();
const perSection = Object.fromEntries(SECTIONS.map((s) => [s, 0]));
for (const e of DOC.entries) {
  assert(!ids.has(e.id), `duplicate id ${e.id}`); ids.add(e.id);
  assert(SECTIONS.includes(e.section), `${e.id}: unknown section ${e.section}`);
  perSection[e.section]++;
  assert(e.title && e.finding, `${e.id}: needs a title and a finding`);
  assert(Array.isArray(e.quotes) && e.quotes.length && e.quotes.every((q) => norm(q).length > 10), `${e.id}: needs at least one quote`);
  assert(/^https:\/\//.test(e.source_url || ''), `${e.id}: source_url must be https`);
  assert(e.source_title, `${e.id}: source_title missing`);
  assert(ISO.test(e.last_verified || ''), `${e.id}: last_verified missing`);
  assert(ISO.test(e.review_by || ''), `${e.id}: review_by missing`);
  assert(e.review_by > e.last_verified, `${e.id}: review_by must come after last_verified`);
  if (NEEDS_STATUS.has(e.section)) assert(DOC.status_text[e.status], `${e.id}: a credit or program needs a known status`);
  if (e.kind === 'qap') assert(DOC.meta.qap_documents[e.qap_doc], `${e.id}: unknown qap_doc ${e.qap_doc}`);
}
for (const [s, min] of Object.entries({ requirements: 6, benefits: 4, deal: 6, credits: 4, programs: 8 })) {
  assert(perSection[s] >= min, `only ${perSection[s]} ${s} records; the section would be thin and this scan vacuous`);
}
const earliest = (field) => DOC.entries.map((e) => e[field]).sort()[0];
assert.equal(DOC.meta.last_verified, earliest('last_verified'), 'meta.last_verified must be the earliest record check');
assert.equal(DOC.meta.review_by, earliest('review_by'), 'meta.review_by must be the earliest record re-check');

// ── 2. Every number a record states is in its quotes ───────────────────────
// Names that carry digits (45L, 48E, 179D, HB22-1362, P.L. 119-21, Form 8609)
// are labels, not figures, and are taken out before comparing.
const LABELS = /\b(?:[Ss]ection \d+|HB\d{2}-\d{4}|P\.L\. \d{3}-\d+|Form \d{4}|\d+[A-Za-z]+\b(?:\([a-z0-9]+\))*)/g;
const numbers = (s) => (String(s || '').replace(LABELS, ' ').match(/\d[\d,]*(?:\.\d+)?/g) || [])
  .map((n) => n.replace(/,/g, ''));
let figuresChecked = 0;
for (const e of DOC.entries) {
  const inQuote = new Set(numbers(e.quotes.join(' ')));
  for (const field of ['title', 'finding', 'caveat', 'fits']) {
    for (const n of numbers(e[field])) {
      figuresChecked++;
      assert(inQuote.has(n), `${e.id}: ${field} states ${n}, which its quotes do not`);
    }
  }
}
assert(figuresChecked >= 40, `only ${figuresChecked} figures checked; the scan is vacuous`);

// ── 3. QAP quotes are in the QAP text CHFA published ───────────────────────
const qapText = {};
for (const [key, ref] of Object.entries(DOC.meta.qap_documents)) {
  const doc = WATCH.documents.find((d) => d.url === ref.url);
  assert(doc, `${key}: ${ref.url} is not a document in data/audit/chfa-qap-watch.json`);
  assert(doc.fetch_ok && doc.text && doc.text.length > 100000, `${key}: the QAP watch holds no usable text`);
  assert.equal(norm(doc.title), norm(ref.title), `${key}: title must be the watch title`);
  qapText[key] = norm(doc.text);
}
let qapChecked = 0;
for (const e of DOC.entries.filter((x) => x.kind === 'qap')) {
  assert.equal(e.source_url, DOC.meta.qap_documents[e.qap_doc].url, `${e.id}: a QAP record must cite its QAP document`);
  for (const q of e.quotes) {
    assert(qapText[e.qap_doc].includes(norm(q)), `${e.id}: quote is not in the ${e.qap_doc} QAP: "${q}"`);
    if (e.also_in_draft) assert(qapText.draft.includes(norm(q)), `${e.id}: says the Third Draft reads the same, but this quote is not in it: "${q}"`);
    qapChecked++;
  }
}
assert(qapChecked >= 10, 'QAP quote scan is vacuous');
// The EGC+ difference is the draft's alone; if the plan in force gains it, the card's wording is stale.
assert(!qapText.current.includes('PHIUS/PHI or EGC+'), 'the plan in force now names EGC+; reword qap-higher-programs-draft');

// ── 4. The rendered page ───────────────────────────────────────────────────
const dom = new JSDOM(read(PAGE), { runScripts: 'outside-only', url: `http://localhost/${PAGE}` });
const w = dom.window;
w.fetch = () => new Promise(() => {}); // render() is called directly below
w.eval(read('js/components/review-status.js'));
w.eval(read('js/green-building.js'));
const rootEl = w.document.querySelector('[data-green-building]');
assert(rootEl, 'the page has no [data-green-building] root');
w.GreenBuilding.render(rootEl, DOC);
const drawn = [...w.document.querySelectorAll('[data-gb-entry]')].map((el) => el.dataset.gbEntry).sort();
assert.deepEqual(drawn, DOC.entries.map((e) => e.id).sort(), 'the page does not draw exactly the records in the file');
for (const s of SECTIONS) {
  const host = w.document.querySelector(`[data-gb-section="${s}"]`);
  assert(host, `no [data-gb-section="${s}"] on the page`);
  assert.equal(host.querySelectorAll('[data-gb-entry]').length, perSection[s], `${s}: drawn count differs from the file`);
}
const statuses = w.document.querySelectorAll('[data-gb-section="credits"] [data-gb-status], [data-gb-section="programs"] [data-gb-status]');
assert.equal(statuses.length, perSection.credits + perSection.programs, 'every credit and program row must show its status');
// A record with dates is "no open round" before it opens, open through its
// deadline and closed after it; each date is in the record's quotes, and a
// deadline shared with the funding tracker agrees with it.
const fundingPrograms = json('data/policy/soft-funding-status.json').programs;
const DEADLINE_TWIN = { 'ceo-lbd-showcase': 'CEO-LBD-SHOWCASE' };
const SHORT = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dayAfter = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const quoted = (e, iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  const q = e.quotes.join(' ');
  return [LONG, SHORT].some((names) => q.includes(`${names[m - 1]} ${d}, ${y}`));
};
const dated = DOC.entries.filter((e) => e.deadline || e.opens);
assert(dated.length >= 2, 'too few dated records; the date check is vacuous');
for (const e of dated) {
  assert.equal(e.status, 'open', `${e.id}: a dated record is stored as open and the page works out the rest`);
  for (const f of ['opens', 'deadline']) {
    if (!e[f]) continue;
    assert(ISO.test(e[f]), `${e.id}: ${f} must be YYYY-MM-DD`);
    assert(quoted(e, e[f]), `${e.id}: its ${f} ${e[f]} is not in its quotes`);
  }
  const at = (t) => w.GreenBuilding.effectiveStatus(e, t);
  if (e.opens) {
    assert.equal(at(dayAfter(e.opens, -1)), 'watch', `${e.id}: must show no open round the day before it opens`);
    assert.equal(at(e.opens), 'open', `${e.id}: must show open on the day it opens`);
  }
  if (e.deadline) {
    assert.equal(at(e.deadline), 'open', `${e.id}: must stay open on its deadline day`);
    assert.equal(at(dayAfter(e.deadline, 1)), 'closed', `${e.id}: must show closed the day after its deadline`);
  }
  const twin = DEADLINE_TWIN[e.id];
  if (twin) {
    assert(fundingPrograms[twin], `${twin} is not in data/policy/soft-funding-status.json`);
    assert.equal(e.deadline, fundingPrograms[twin].deadline, `${e.id}: deadline differs from the funding tracker's ${twin}`);
  }
}
for (const id of ['irc-45l', 'irc-179d']) {
  assert.equal(DOC.entries.find((e) => e.id === id).status, 'ended', `${id} must be marked ended`);
}
const rec = (id) => { const e = DOC.entries.find((x) => x.id === id); assert(e, `record ${id} is missing`); return e; };
const pickRows = [...w.document.querySelectorAll('#gb-pick tbody tr')];
assert(pickRows.length >= 5, 'the "which program for which deal" table is too thin');
for (const row of pickRows) {
  const refs = (row.dataset.gbRef || '').split(/\s+/).filter(Boolean);
  const label = norm(row.querySelector('th').textContent);
  assert(refs.length, `pick row "${label}" points at no records`);
  for (const r of refs) assert(ids.has(r), `pick row "${label}" points at missing record ${r}`);
  // A row that drops the EV-ready count must be one the exemption names.
  if (/no EV-ready count/.test(row.textContent)) {
    assert(refs.includes('qap-ev-exempt'), `pick row "${label}" drops the EV-ready count without citing qap-ev-exempt`);
    const ex = rec('qap-ev-exempt').finding;
    const named = (/acquisition\/rehab/.test(ex) && /acquisition/i.test(label))
      || (/homelessness/.test(ex) && /Special Populations/.test(ex) && /homelessness/.test(label) && /Special Populations/.test(label));
    assert(named, `pick row "${label}" drops the EV-ready count for projects qap-ev-exempt does not name`);
  }
  // The master-meter saving is "typical" in its record; a row may not state it flatly.
  if (refs.includes('hub-master-meter') && /typically/.test(rec('hub-master-meter').quotes.join(' '))) {
    assert(/master meter (?:usually|typically|can|may)\b/i.test(row.textContent), `pick row "${label}" states the master-meter rate saving without the record's qualifier`);
  }
  // The page promises each row links to what it relies on: one link per ref, each to a drawn record.
  const hrefs = [...row.querySelectorAll('.gb-refs a')].map((a) => a.getAttribute('href'));
  assert.deepEqual(hrefs, refs.map((r) => `#${w.GreenBuilding.anchorId(r)}`), `pick row "${label}" does not link each record it relies on`);
  for (const h of hrefs) {
    const target = w.document.getElementById(h.slice(1));
    assert(target && target.dataset.gbEntry, `pick row "${label}" links ${h}, which is not a drawn record`);
  }
}
assert(!/fruita/i.test(read(PAGE) + read('data/policy/green-building.json')), 'project-specific Fruita material stays out of the public repo');

// ── 5. Links, and copy elsewhere that repeats the rule ─────────────────────
assert(read('js/navigation.js').includes(`href: "${PAGE}"`), 'the menu does not link the page');
assert(read('insights.html').includes(`href="${PAGE}"`), 'insights.html does not list the page');
assert(read('sitemap.html').includes(`href="${PAGE}"`), 'sitemap.html does not list the page');
assert(read('sitemap.xml').includes(`/${PAGE}</loc>`), 'sitemap.xml does not list the page');
const cat = json('data/insights/catalog.json').entries.find((x) => x.url === PAGE);
assert(cat && cat.review_from && cat.review_from.file === 'data/policy/green-building.json', 'the research catalog entry must review from the data file');
const calc = read('js/deal-calculator.js');
assert(calc.includes(`href="${PAGE}"`), 'the Deal Calculator does not link the page');
const deep = read('colorado-deep-dive.html');

// The Deep Dive and the Deal Calculator repeat CHFA's rule in their own words.
// What they must say is read from the records, so a record updated for a new
// plan fails this check until both copies are updated with it.
// "Enterprise Green Communities (EGC), LEED or the National Green Building Standard (NGBS)"
// -> [{full, abbr}], so a copy may use either name for each program.
const programsIn = (list) => list.replace(/^the /, '').split(/,\s*|\s+or\s+/).filter(Boolean).map((p) => {
  const m = p.trim().replace(/^the /, '').match(/^(.*?)\s*(?:\(([^)]+)\))?$/);
  return { full: m[1].trim(), abbr: m[2] || null };
});
const certRec = rec('qap-certification');
const certList = (certRec.finding.match(/certify under (.+?)\. /) || [])[1];
assert(certList, 'qap-certification no longer says "certify under ..."; update this check with the record');
const required = programsIn(certList);
assert(required.length >= 2, 'qap-certification names too few programs; the scan would be vacuous');
const sameProgram = (a, b) => [a.full, a.abbr].filter(Boolean).some((n) => n === b.full || n === b.abbr);
const noPoints = /no scoring points/.test(rec('qap-more-competitive').finding);
const exempt = rec('qap-ev-exempt').finding;
const copies = [
  { name: 'Deep Dive', text: deep, clause: /every project must earn a green building certification, and the applicant picks (.+?)\. / },
  { name: 'Deal Calculator', text: calc, clause: /every project must certify under (.+?) \(QAP Section 8/ },
];
for (const c of copies) {
  const m = c.text.match(c.clause);
  assert(m, `the ${c.name} line no longer states which certifications CHFA accepts`);
  const named = programsIn(m[1]);
  assert.equal(named.length, required.length, `the ${c.name} names ${named.length} certification programs; qap-certification names ${required.length}`);
  for (const r of required) assert(named.some((n) => sameProgram(r, n)), `the ${c.name} line leaves out ${r.full}, which qap-certification requires`);
  // The source line that holds the rule (both copies keep it on one line).
  const line = c.text.slice(c.text.lastIndexOf('\n', m.index) + 1, (c.text.indexOf('\n', m.index) + 1 || c.text.length + 1) - 1);
  if (noPoints) assert(/not points/.test(line), `the ${c.name} line no longer says this is a requirement, not points, as qap-more-competitive does`);
  if (c.name === 'Deep Dive' && /EV-ready/.test(line)) {
    for (const [phrase, re] of [['acquisition/rehab', /acquisition\/rehab/], ['homelessness', /homelessness/], ['Special Populations', /Special Populations/]]) {
      if (re.test(exempt)) assert(re.test(line), `the Deep Dive states the EV-ready rule without the ${phrase} exemption in qap-ev-exempt`);
    }
  }
}
assert(!/largest non-need amenity-point/.test(calc), 'the Deal Calculator calls green building an amenity-point category again');
assert(!/Enterprise Green Communities certification required for all 9% deals/.test(deep), 'the Deep Dive says EGC is required on 9% deals again');

console.log(`green-building-guide: PASS (${DOC.entries.length} records, ${figuresChecked} figures, ${qapChecked} QAP quotes, ${pickRows.length} deal rows)`);
