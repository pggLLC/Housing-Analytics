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
  // A word broken at a line end extracts as "208/240- volt"; join it back.
  qapText[key] = norm(doc.text).replace(/(\w)- (?=\w)/g, '$1-');
}
// The PDF text renders ™ as "TM"; quotes keep the symbol.
const qnorm = (q) => norm(q).replace(/™/g, 'TM');
let qapChecked = 0;
for (const e of DOC.entries.filter((x) => x.kind === 'qap')) {
  assert.equal(e.source_url, DOC.meta.qap_documents[e.qap_doc].url, `${e.id}: a QAP record must cite its QAP document`);
  for (const q of e.quotes) {
    assert(qapText[e.qap_doc].includes(qnorm(q)), `${e.id}: quote is not in the ${e.qap_doc} QAP: "${q}"`);
    if (e.also_in_draft) assert(qapText.draft.includes(qnorm(q)), `${e.id}: says the Third Draft reads the same, but this quote is not in it: "${q}"`);
    qapChecked++;
  }
}
assert(qapChecked >= 10, 'QAP quote scan is vacuous');
// The EGC+ difference is the draft's alone; if the plan in force gains it, the card's wording is stale.
// The allowance-model lead time is read from the plan in force, and the
// "drafts lengthen it" claim holds only while the draft no longer reads the same.
{
  const ecm = DOC.entries.find((x) => x.id === 'uap-ecm-timing');
  const lead = /Energy Consumption Model must submit a request for preliminary approval.{0,200}?at least (\d+) days prior/.exec(qapText.current);
  assert(ecm && lead, 'uap-ecm-timing: the plan in force no longer states the allowance-model lead time');
  assert(ecm.finding.includes(`at least ${lead[1]} days`), `uap-ecm-timing: the plan in force says ${lead[1]} days`);
  if (/lengthen/.test(ecm.finding)) assert(!qapText.draft.includes(`at least ${lead[1]} days prior to the Housing Tax Credit Application`), 'uap-ecm-timing: the Third Draft keeps the same lead time; drop the "lengthen" sentence');
}
assert(!qapText.current.includes('PHIUS/PHI or EGC+'), 'the plan in force now names EGC+; reword qap-higher-programs-draft');
// The "without EGC+" claim holds only while the plan in force's list leaves it out.
{
  const cur = /To achieve a higher level of energy performance, the project must obtain additional certification under programs such as ([^.]*)\./.exec(qapText.current);
  assert(cur, 'the plan in force no longer lists its higher programs; re-read qap-higher-programs-current');
  assert(!/EGC\+|Green Communities Plus/.test(cur[1]), 'the plan in force now names EGC+; reword qap-higher-programs-current');
  for (const p of ['DOE Efficient New Homes', 'PHIUS', 'PHI']) assert(cur[1].includes(p), `the plan in force no longer names ${p}`);
}

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
  const instant = (iso, ms) => new w.Date(new Date(iso).getTime() + ms);
  if (e.opens_at) {
    assert(e.opens_at.startsWith(e.opens), `${e.id}: opens_at must fall on opens`);
    assert.equal(at(instant(e.opens_at, -60000)), 'watch', `${e.id}: must show no open round a minute before it opens`);
    assert.equal(at(instant(e.opens_at, 0)), 'open', `${e.id}: must show open when it opens`);
  } else if (e.opens) {
    assert.equal(at(dayAfter(e.opens, -1)), 'watch', `${e.id}: must show no open round the day before it opens`);
    assert.equal(at(e.opens), 'open', `${e.id}: must show open on the day it opens`);
  }
  if (e.deadline_at) {
    assert(e.deadline_at.startsWith(e.deadline), `${e.id}: deadline_at must fall on deadline`);
    assert.equal(at(instant(e.deadline_at, 0)), 'open', `${e.id}: must stay open up to its closing time`);
    assert.equal(at(instant(e.deadline_at, 60000)), 'closed', `${e.id}: must show closed a minute after its closing time`);
  } else if (e.deadline) {
    assert.equal(at(e.deadline), 'open', `${e.id}: must stay open on its deadline day`);
    assert.equal(at(dayAfter(e.deadline, 1)), 'closed', `${e.id}: must show closed the day after its deadline`);
    // A date-only deadline ends at midnight in Colorado, whatever the reader's zone.
    const next = dayAfter(e.deadline, 1);
    const hourAt6Z = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: '2-digit', hourCycle: 'h23' }).format(new Date(`${next}T06:00:00Z`));
    const end = Date.parse(`${next}T00:00:00${hourAt6Z === '00' ? '-06:00' : '-07:00'}`);
    assert.equal(at(new w.Date(end - 60000)), 'open', `${e.id}: must stay open until midnight in Colorado on its deadline`);
    assert.equal(at(new w.Date(end + 60000)), 'closed', `${e.id}: must close at midnight in Colorado, not the reader's midnight`);
  }
  for (const [f, re] of [['opens_at', /Opens at 9 a\.m\. Eastern time/], ['deadline_at', /Rolling application period - Closes at 11:59 p\.m\. Eastern time/]]) {
    if (e[f]) assert(re.test(e.quotes.join(' ')), `${e.id}: ${f} has a time its quotes do not give`);
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
let rentRows = 0;
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
  // Advice to go past the required certification rests on CHFA's "more competitive" line and its named programs.
  if (/competitive/i.test(row.textContent)) {
    assert(refs.includes('qap-more-competitive'), `pick row "${label}" calls a choice competitive without citing qap-more-competitive`);
    assert(/more competitive/.test(rec('qap-more-competitive').quotes.join(' ')), 'qap-more-competitive no longer quotes CHFA\'s "more competitive" line');
  }
  // Cell text without the generated "Relies on" links and source lines, whose record and source titles would
  // otherwise count as row text (a Third Draft source title names 2027 and "Draft").
  const cells = [...row.querySelectorAll('td')].map((td) => { const c = td.cloneNode(true); c.querySelectorAll('.gb-refs, .gb-pick-source').forEach((x) => x.remove()); return c.textContent; });
  // A higher program is advice for whichever plan governs the application: the plan in force for a round
  // under it, the Third Draft for the next plan's rounds. Each plan that names the program must be cited,
  // and a program only the draft names must say it belongs to the next plan.
  const higherCur = rec('qap-higher-programs-current').quotes.join(' ');
  const higherDraft = rec('qap-higher-programs-draft').quotes.join(' ');
  for (const [prog, re] of [['DOE Efficient New Homes', /DOE Efficient New Homes/], ['Phius', /Phius/i], ['EGC+', /EGC\+/]]) {
    if (!re.test(row.querySelector('td[data-label="Certification"]')?.textContent || '')) continue;
    const inCur = re.test(higherCur), inDraft = re.test(higherDraft);
    assert(inCur || inDraft, `pick row "${label}" recommends ${prog}, which neither QAP record names`);
    if (inCur) assert(refs.includes('qap-higher-programs-current'), `pick row "${label}" recommends ${prog} without citing the plan in force (qap-higher-programs-current)`);
    if (inDraft) assert(refs.includes('qap-higher-programs-draft'), `pick row "${label}" recommends ${prog} without citing the Third Draft (qap-higher-programs-draft)`);
    if (!inCur) assert(/draft|2027/i.test(label + ' ' + cells.join(' ')), `pick row "${label}" recommends ${prog}, which only the Third Draft names, without saying so`);
  }
  // A row that says the allowance carries into rent rests on the gross-rent rule and CHFA's allowance sources.
  if (cells.some((c) => c.split(/[.;]/).some((t) => /allowance/i.test(t) && /\brent\b/i.test(t)))) {
    for (const r of ['qap-ua-sources', 'cfr-ua-gross-rent']) assert(refs.includes(r), `pick row "${label}" says the allowance moves rent without citing ${r}`);
    assert(/gross rent for that unit includes the applicable utility allowance/.test(rec('cfr-ua-gross-rent').quotes.join(' ')), 'cfr-ua-gross-rent no longer quotes that the allowance is part of gross rent');
    assert(/Energy Consumption Model/.test(rec('qap-ua-sources').quotes.join(' ')), 'qap-ua-sources no longer quotes the Energy Consumption Model as an allowance source');
    rentRows++;
  }
  // Solar lowers the allowance only where residents pay a submetered electric bill (uap-solar), said in the same clause.
  if (refs.includes('uap-solar')) {
    assert(/submeter/.test(rec('uap-solar').quotes.join(' ')), 'uap-solar no longer quotes the submeter condition');
    for (const t of cells.flatMap((c) => c.split(';'))) {
      // uap-solar sets no 48E condition, so the allowance is never framed as the fallback when 48E is lost.
      if (/solar/i.test(t) && /allowance/.test(t)) assert(!/^\s*(?:otherwise|instead|if not)\b/i.test(t), `pick row "${label}" makes the solar allowance a fallback for losing 48E`);
      if (/solar/i.test(t) && /allowance/.test(t)) assert(/submetered electric bill/.test(t), `pick row "${label}" counts solar in the allowance without the submeter condition`);
    }
  }
  // A program a record fits only to small buildings may not be recommended without that limit.
  for (const r of refs) {
    const fits = rec(r).fits || '';
    if (!/small/i.test(fits) || /large/i.test(fits)) continue;
    const name = rec(r).title.split(' (')[0];
    for (const t of cells) {
      if (t.includes(name)) assert(/small/i.test(t), `pick row "${label}" recommends ${name} without its small-building limit`);
    }
  }
  // EGC or LEED alone is the advice only where the town is on the 2021 code; on older codes NGBS can cost less (hub-ngbs-older-code).
  const cert = cells[0] || '';
  if (/\b(?:EGC|LEED)\b/.test(cert) && !/\bNGBS\b/.test(cert)) {
    assert(/2021 IECC/.test(label + ' ' + cert) && refs.includes('hub-2021-iecc-gap'), `pick row "${label}" recommends EGC or LEED without the 2021-code condition and hub-2021-iecc-gap`);
  }
  if (/\bNGBS\b/.test(cert) && /2018 IECC|cost/.test(cert)) {
    assert(refs.includes('hub-ngbs-older-code'), `pick row "${label}" makes the older-code NGBS case without citing hub-ngbs-older-code`);
  }
  // The page promises each row links to what it relies on: one link per ref, each to a drawn record.
  const hrefs = [...row.querySelectorAll('.gb-refs a')].map((a) => a.getAttribute('href'));
  assert.deepEqual(hrefs, refs.map((r) => `#${w.GreenBuilding.anchorId(r)}`), `pick row "${label}" does not link each record it relies on`);
  for (const h of hrefs) {
    const target = w.document.getElementById(h.slice(1));
    assert(target && target.dataset.gbEntry, `pick row "${label}" links ${h}, which is not a drawn record`);
  }
}
assert(rentRows >= 1, 'no pick row says the allowance moves rent; the gross-rent check is vacuous');
// A quote may not stop mid-sentence on a word that needs what follows it.
for (const e of DOC.entries) {
  for (const q of e.quotes) assert(!/\b(?:the|a|an|of|to|for|by|with|using|and|or|in|on|at|from|free)$/i.test(q.trim()), `${e.id}: quote stops mid-sentence: "${q.slice(-50)}"`);
  // A tool the reader must use is named in the quotes, not only in our finding.
  for (const tool of ['Portfolio Manager', 'Energy Consumption Model']) {
    if (e.finding.includes(tool)) assert(e.quotes.join(' ').includes(tool), `${e.id}: the finding names ${tool}, but no quote does`);
  }
}
// The page promises every card shows when it is due again; hold it to that.
for (const e of DOC.entries) {
  const el = w.document.querySelector(`[data-gb-entry="${e.id}"] .gb-source`);
  assert(el, `${e.id}: no source line is drawn`);
  const due = new Date(e.review_by + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  assert(norm(el.textContent).includes(`next check due ${due}`), `${e.id}: the card does not show its next check date (${due})`);
}
// What a card promises is quoted, not only its eligibility: each claim on the
// left must appear in the finding only while its evidence on the right is quoted.
const CLAIMS = {
  'xcel-eda': [['energy modeling', 'energy modeling'], ['cash rebates', 'cash rebates'], ['gas savings', 'rebates for gas savings'], ['design fees', 'reimbursement of design fees'], ['free', 'free design assistance']],
  'eoc-multifamily': [['assessment', 'we visit your property'], ['funding help', 'financial incentives'], ['project management', 'supervise'], ['inspection', 'final evaluation']],
  'qap-ua-sources': [['gross rent', 'gross rent'], ['energy consumption model', 'energy consumption model']],
  'cfr-ua-gross-rent': [['part of gross rent', 'gross rent for that unit includes the applicable utility allowance'], ['unit size, building orientation', 'unit size, building orientation'], ['licensed engineer', 'properly licensed engineer']],
  'ccef-loans': [['nonprofit', 'non-profit community lender'], ['developers', 'developers'], ['battery storage', 'battery storage'], ['hvac', 'hvac systems'], ['ev charging', 'ev charging'], ['colorado clean energy fund', 'colorado clean energy fund dba']],
  'c-pace': [['retrofits of existing buildings', '100 percent financing for existing building retrofit projects'], ['new construction gets less', 'up to 35 percent financing for new construction'], ['15% with documented 2018', 'if seeking 15 percent financing'], ['30% if modeling', 'if seeking 30 percent financing'], ['35% when the 2021', 'comply with or exceed the applicable 2021'], ['up to 25 years', 'up to 25 years'], ['opted into the statewide district', 'must opt into the district'], ['property tax bill', 'property tax bill'], ['senior to commercial mortgages', 'senior to all commercial mortgages']],
  'hub-resource-finder': [['utility provider', 'utility provider'], ['not exhaustive', 'non-exhaustive']],
  'hub-master-meter': [['billing', 'billing function'], ['upkeep of the submeters', 'maintaining the submetering system']],
  'xcel-mfbe': [['free in-unit products', 'free energy-saving products in each unit']],
  'hub-retrofit-risk': [['rate class', 'alter utility tariffs'], ['between owner and residents', 'allocated between owners and residents'], ['main limit', 'primary constraint'], ['feeders', 'distribution feeders'], ["apartment's panel", 'dwelling unit panels'], ['utility service', 'main utility service']],
  'qap-higher-programs-current': [['doe efficient new homes', 'doe efficient new homes'], ['phius', 'phius'], ['phi,', 'phi.'], ['without egc+', 'phius, phi.']],
  'hb22-1362-rural': [['significantly assists', 'grant that significantly assists in energy code adoption and enforcement training'], ['accepting applications', 'is accepting applications'], ['thirty thousand', 'less than thirty thousand']],
  'sfa-court-rulings': [['district of columbia', 'district of columbia on tuesday ruled'], ['arbitrary and capricious', 'arbitrary and capricious'], ['all solar for all grants', 'cancellation of all solar for all grants'], ['rhode island', 'rhode island'], ['procedurally unlawful', 'procedurally unlawful'], ['appeal', 'considering options for appeal'], ['dismissed in january', 'dismissed in january']],
};
for (const [id, pairs] of Object.entries(CLAIMS)) {
  const r = rec(id); const f = r.finding.toLowerCase(); const q = r.quotes.join(' ').toLowerCase();
  let used = 0;
  for (const [said, quoted] of pairs) {
    if (!f.includes(said)) continue;
    used++;
    assert(q.includes(quoted), `${id}: the finding promises "${said}", but no quote shows it`);
  }
  assert(used > 0, `${id}: none of its checked claims is in the finding; update CLAIMS`);
}
// A title is the most-read line: one that ranks NGBS on cost must carry the
// code-edition condition the hub puts on it.
for (const e of DOC.entries) {
  if (/NGBS/.test(e.title) && /cost|cheap|budget/i.test(e.title)) assert(/older code|2018/i.test(e.title), `${e.id}: the title ranks NGBS on cost without the older-code condition`);
}
assert(!/NGBS/.test(rec('hub-energystar-cost').title) || /NGBS/.test(rec('hub-energystar-cost').quotes.join(' ')), 'hub-energystar-cost: the title compares with NGBS, which its quote never does');
// C-PACE's 100% applies to retrofits only; a card that pairs it with new
// construction must also carry the new-construction cap and the county condition.
{
  const r = rec('c-pace'); const text = `${r.finding} ${r.fits}`;
  if (/100%/.test(text)) assert(/100% of eligible costs for retrofits/.test(r.finding), 'c-pace: 100% financing is for retrofits only; say so where the 100% appears');
  assert(/new construction/i.test(r.finding) && /35%/.test(r.finding), 'c-pace: state the new-construction cap');
  assert(/opted into the statewide district/.test(r.finding) && /participating county/.test(r.fits), 'c-pace: eligibility depends on a participating county; say so in the finding and the fit');
}
// Every utility the Resource Finder card names is quoted from the finder.
for (const co of rec('hub-resource-finder').finding.match(/(?:Poudre Valley REA|United Power|Holy Cross Energy|[A-Z][\w-]*(?: [A-Z][\w-]*)* (?:Electric|Power) (?:Association|Cooperative)|San Luis Valley Rural Electric Cooperative)/g) || []) {
  assert(rec('hub-resource-finder').quotes.includes(co), `hub-resource-finder: names ${co}, which no quote shows`);
}
// The first time the page names CHFA, it spells it out.
{
  const body = norm(w.document.querySelector('main').textContent);
  const i = body.indexOf('CHFA');
  assert(i > 0 && /Colorado Housing and Finance Authority \($/.test(body.slice(Math.max(0, i - 40), i)), 'the first CHFA on the page must be spelled out');
}
// The header's check date is the data's, not a hand-typed one.
assert(!/checked (?:January|February|March|April|May|June|July|August|September|October|November|December) \d/.test(w.document.querySelector('.page-meta').textContent.replace(/Oldest source check:.*$/s, '')), 'the page header hand-types a check date; let the data fill it');
assert.equal(norm(w.document.querySelector('[data-gb-checked]').textContent), `Oldest source check: ${new Date(DOC.meta.last_verified + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, 'the header check date must come from meta.last_verified');
// The EV-ready count is only half the rule: the finding states CHFA's electrical specification, and each part is quoted.
{
  const r = rec('qap-ev-ready'); const q = r.quotes.join(' ');
  for (const spec of ['raceway', '40-ampere', '208/240-volt', 'not required']) {
    assert(r.finding.includes(spec) && q.includes(spec), `qap-ev-ready must state and quote "${spec}"`);
  }
}
// Federal programs this guide repeats from the funding tracker keep the tracker's reading.
{
  const her = rec('ceo-home-energy-rebates'); const twin = fundingPrograms['CEO-IRA-HOME-ENERGY-REBATES'];
  assert(twin, 'CEO-IRA-HOME-ENERGY-REBATES is not in data/policy/soft-funding-status.json');
  for (const size of ['small', 'large']) {
    assert.equal(new RegExp(`${size} multifamily`).test(her.fits || ''), new RegExp(`${size} multifamily`).test(twin.description), `ceo-home-energy-rebates and the funding tracker disagree on ${size} multifamily`);
  }
  const sfa = rec('epa-solar-for-all'); const sfaTwin = fundingPrograms['CEO-SOLAR-FOR-ALL'];
  const watch = json('data/policy/tax-credit-legislation.json').entries.find((x) => x.id === 'ggrf-solar-for-all-colorado-watch');
  assert(sfaTwin && sfaTwin.available === null, 'the funding tracker no longer holds Solar for All as unavailable; re-read epa-solar-for-all');
  assert(watch, 'ggrf-solar-for-all-colorado-watch is missing from tax-credit-legislation.json');
  if (!/repealed|ended/.test(watch.status)) {
    assert.notEqual(sfa.status, 'ended', `epa-solar-for-all says ended while tax-credit-legislation.json holds it at ${watch.status}`);
    assert(/on hold/.test(sfa.finding) && /court/.test(sfa.finding), 'epa-solar-for-all must say the program is on hold and name the court rulings');
    // The court claim stands on a cited report, flagged as trade press, not on our word.
    const rulings = rec('sfa-court-rulings');
    assert(/trade press/.test(sfa.finding) && /trade press/.test(rulings.title) && /trade press/.test(rulings.source_title), 'the Solar for All court claim must be flagged as trade press and cite the report');
    assert(rulings.status !== 'ended' && /do not count/.test(rulings.finding), 'sfa-court-rulings must not present the money as available');
  }
}
// A record's fit may not promise a building size its quotes do not.
for (const e of DOC.entries) {
  for (const size of ['small', 'large']) {
    if (new RegExp(`\\b${size}\\b`, 'i').test(e.fits || '')) assert(new RegExp(`\\b${size}\\b`, 'i').test(e.quotes.join(' ') + ' ' + e.finding), `${e.id}: fits names ${size} buildings, which its quotes and finding do not`);
  }
}
// Each ratio-billing condition the finding states has its own quote from the law.
{
  const r = rec('uap-rubs'); const q = r.quotes.join(' ');
  for (const [said, quoted] of [[/does not exceed/, /DOES NOT EXCEED THE TOTAL AMOUNT/], [/markup/, /MARKUP/], [/common-area/, /COMMON AREAS/], [/lease discloses/, /DISCLOSES THE METHOD OF ALLOCATION/], [/July 1, 2027/, /JULY 1, 2027/]]) {
    if (said.test(r.finding)) assert(quoted.test(q), `uap-rubs states a condition (${said}) its quotes do not carry`);
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
// The record's list is CHFA's list: read the accepted programs from the QAP text itself, and quote that passage.
for (const key of ['current', 'draft']) {
  const m = qapText[key].match(/The accepted green building certification programs are: (.+?) In addition to green building certification/);
  assert(m, `the ${key} QAP no longer lists its accepted certification programs where this check reads them`);
  const qapAbbrs = [...m[1].matchAll(/\(([A-Z+]+)\)/g)].map((x) => x[1]).sort();
  assert.deepEqual(required.map((r) => r.abbr || r.full).sort(), qapAbbrs, `qap-certification's list differs from the ${key} QAP's (${qapAbbrs.join(', ')})`);
}
assert(certRec.quotes.some((q) => /The accepted green building certification programs are:/.test(q)), 'qap-certification must quote CHFA\'s list of accepted programs');
const sameProgram = (a, b) => [a.full, a.abbr].filter(Boolean).some((n) => n === b.full || n === b.abbr);
// "No points" is read from the QAP, not from our record: green building is a threshold item, and no scoring
// criterion near the green, energy or electrification text awards points ("termination point" is EV wiring).
const scoringNearGreen = (text) => [...text.matchAll(/green|sustainab|energy|electrif/gi)]
  .map((m) => text.slice(Math.max(0, m.index - 150), m.index + 150))
  .filter((win) => /\bpoints?\b/i.test(win.replace(/termination points?/gi, '')));
for (const key of ['current', 'draft']) {
  assert(qapText[key].includes('Threshold #12 Energy Efficiency and Sustainability Requirements'), `the ${key} QAP no longer lists green building as Threshold #12; re-read qap-more-competitive`);
  const hits = scoringNearGreen(qapText[key]);
  assert.equal(hits.length, 0, `the ${key} QAP now mentions points near green-building text; re-read the "no points" claim: "${(hits[0] || '').slice(0, 200)}"`);
}
assert(rec('qap-more-competitive').quotes.some((q) => q.startsWith('Threshold #12')), 'qap-more-competitive must quote the threshold line that makes green building a requirement, not a score');
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
