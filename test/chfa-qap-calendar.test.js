#!/usr/bin/env node
// test/chfa-qap-calendar.test.js
//
// data/chfa-qap-calendar.json stores a `status` per event. It drifted: the
// 2026 R2 deadline (Aug 3) still said "upcoming" in September, and an
// estimated "2027 QAP comment period" stood long after CHFA had held its real
// hearings. These checks tie each stored field to what it has to agree with:
//
//   - `status` must agree with the event's date as of `metadata.generated`
//     (a window is past only once `date_end` has passed);
//   - every `category` must have a pill style in js/components/qap-calendar.js;
//   - the component must render a window whose end is still ahead as current,
//     a window ending today or an event dated today as current for all of that
//     day, and a stale "upcoming" whose date has passed as past;
//   - `qap_status` (draft/adopted) must agree with the QAP source it names in
//     metadata.qap_sources and with the event's own details, and the rendered
//     "Draft" badge must follow that field — on the next-deadline card, the
//     compact list and the full list — and never appear on an adopted event.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const cal = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'chfa-qap-calendar.json'), 'utf8'));
const componentSrc = fs.readFileSync(path.join(ROOT, 'js', 'components', 'qap-calendar.js'), 'utf8');

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const events = cal.events;

// ── Structure ────────────────────────────────────────────────────────
assert.ok(Array.isArray(events) && events.length > 0, 'calendar must have events to check');
assert.match(cal.metadata.generated, ISO, 'metadata.generated must be an ISO date');

const ids = new Set();
for (const e of events) {
  assert.ok(!ids.has(e.id), `duplicate event id ${e.id}`);
  ids.add(e.id);
  assert.match(e.date, ISO, `${e.id}: date must be YYYY-MM-DD`);
  if (e.date_end != null) {
    assert.match(e.date_end, ISO, `${e.id}: date_end must be YYYY-MM-DD`);
    assert.ok(e.date_end >= e.date, `${e.id}: date_end precedes date`);
  }
  if (e.date_precision != null) {
    assert.ok(['exact', 'estimated'].includes(e.date_precision), `${e.id}: unknown date_precision ${e.date_precision}`);
  }
  assert.ok(['past', 'upcoming'].includes(e.status), `${e.id}: unknown status ${e.status}`);
}

// ── status agrees with the date, as of metadata.generated ───────────
const asOf = cal.metadata.generated;
let checkedPast = 0;
let checkedUpcoming = 0;
for (const e of events) {
  const end = e.date_end || e.date;
  const expected = end < asOf ? 'past' : 'upcoming';
  assert.equal(e.status, expected,
    `${e.id}: status "${e.status}" but its ${e.date_end ? 'date_end' : 'date'} ${end} is ` +
    `${expected === 'past' ? 'before' : 'on/after'} metadata.generated ${asOf}. ` +
    'Refresh status (or metadata.generated) when you re-verify the calendar.');
  if (expected === 'past') checkedPast++; else checkedUpcoming++;
}
assert.ok(checkedPast > 0 && checkedUpcoming > 0, 'status check must exercise both past and upcoming events');

// ── every category has a pill style in the component ────────────────
// The light-mode rules are the lines that open with the pill selector; the
// dark-mode overrides (prefixed `html.dark-mode`) only recolour text, so a
// category styled only there would render as an unstyled pill.
const lightPillRules = componentSrc.split('\n')
  .filter((line) => line.trim().startsWith("'.qc-item__cat--"))
  .join('\n');
assert.ok(lightPillRules.length > 0, 'found no light-mode pill rules to check against');
const categories = new Set(events.map((e) => e.category));
for (const cat of categories) {
  assert.ok(new RegExp(`\\.qc-item__cat--${cat}[\\s,{]`).test(lightPillRules),
    `category "${cat}" has no light-mode .qc-item__cat--${cat} style in js/components/qap-calendar.js`);
}

// ── qap_status agrees with its source and with the event's details ──
// Adoption status is separate from date_precision: an exact date can still
// come from a draft QAP. Every event that says it comes from a draft must be
// marked draft, and every marked event must name a source that agrees.
const qapSources = cal.metadata.qap_sources || {};
let draftEvents = 0;
let adoptedEvents = 0;
for (const e of events) {
  const saysDraft = /\bDraft\b[^.]*\(not yet adopted\)/.test(e.details || '');
  if (saysDraft) {
    assert.equal(e.qap_status, 'draft', `${e.id}: details cite a QAP draft that is not adopted, but qap_status is ${e.qap_status}`);
  }
  if (e.qap_status == null) continue;
  assert.ok(['draft', 'adopted'].includes(e.qap_status), `${e.id}: unknown qap_status ${e.qap_status}`);
  const src = qapSources[e.qap_source];
  assert.ok(src, `${e.id}: qap_source "${e.qap_source}" is not in metadata.qap_sources`);
  assert.equal(src.status, e.qap_status, `${e.id}: qap_status ${e.qap_status} disagrees with its source's status ${src.status}`);
  assert.ok(src.title && src.url, `${e.id}: its QAP source must name a title and url`);
  assert.match(src.verified, ISO, `${e.id}: its QAP source must carry a verified ISO date`);
  if (e.qap_status === 'draft') draftEvents++; else adoptedEvents++;
}
assert.ok(draftEvents > 0 && adoptedEvents > 0, 'qap_status check must exercise both draft and adopted events');

// ── component: past/current is decided by the end of a window ───────
async function renderWith(fixture, mode) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="c"></div></body></html>', {
    runScripts: 'outside-only',
  });
  const win = dom.window;
  win.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(fixture) });
  win.eval(componentSrc);
  const c = win.document.getElementById('c');
  if (mode === 'pill') win.QapCalendar.attachPillHeader(c);
  else win.QapCalendar.attach(c, { showRolling: false, compact: mode === 'compact' });
  await new Promise((r) => setTimeout(r, 20));
  return c;
}

// Local calendar date, as the component parses it. toISOString() would give
// the UTC date, which is a day off in the evening west of Greenwich.
function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

(async () => {
  const c = await renderWith({
    metadata: { generated: isoOffset(-60) },
    events: [
      { id: 'window', name: 'Open window', date: isoOffset(-10), date_end: isoOffset(10), category: 'qap-adoption', status: 'upcoming' },
      { id: 'stale', name: 'Stale upcoming', date: isoOffset(-5), category: 'qap-hearing', status: 'upcoming' },
      { id: 'ends-today', name: 'Window ending today', date: isoOffset(-3), date_end: isoOffset(0), category: 'qap-adoption', status: 'upcoming' },
      { id: 'today', name: 'Hearing today', date: isoOffset(0), category: 'qap-hearing', status: 'upcoming' },
    ],
  });
  const items = [...c.querySelectorAll('.qc-item')];
  assert.equal(items.length, 4, 'every fixture event must render');
  const byName = (n) => items.find((li) => li.textContent.includes(n));
  assert.ok(!byName('Open window').classList.contains('qc-item--past'),
    'a window whose date_end is still ahead must not render as past');
  // The data check above treats date_end === today as upcoming; the
  // component must agree for the whole of that day, not only until 00:00.
  assert.ok(!byName('Window ending today').classList.contains('qc-item--past'),
    'a window whose date_end is today must not render as past during that day');
  assert.ok(!byName('Hearing today').classList.contains('qc-item--past'),
    'an event dated today must not render as past during that day');
  assert.ok(byName('Stale upcoming').classList.contains('qc-item--past'),
    'an event whose date has passed must render as past even if status says upcoming');

  // ── draft badge follows qap_status, in every view ─────────────────
  const DRAFT_TEXT = /Draft — may change until CHFA adopts the QAP/;
  const hasBadge = (el) => !!el.querySelector('.qc-draft[data-qap-status="draft"]') && DRAFT_TEXT.test(el.textContent);

  // Real data, full list: badge on exactly the events marked draft.
  const full = await renderWith(cal, 'full');
  const fullItems = [...full.querySelectorAll('.qc-item')];
  assert.equal(fullItems.length, events.length, 'full list must render every event');
  let badgedReal = 0;
  for (const e of events) {
    const li = fullItems.find((x) => x.querySelector('.qc-item__name').textContent === e.name);
    assert.ok(li, `${e.id}: not rendered`);
    assert.equal(hasBadge(li), e.qap_status === 'draft',
      `${e.id}: draft badge ${hasBadge(li) ? 'shown' : 'missing'} but qap_status is ${e.qap_status}`);
    if (hasBadge(li)) badgedReal++;
  }
  assert.equal(badgedReal, draftEvents, 'every draft event in the data must be badged in the full list');

  // Fixture: identical events except for qap_status. The badge must come from
  // the field, not from the name, details or date_precision.
  const src = { status: 'draft', title: 'Test QAP Draft', url: 'https://example.org/qap', verified: isoOffset(-2) };
  const adoptedSrc = { status: 'adopted', title: 'Test Adopted QAP', url: 'https://example.org/adopted', verified: isoOffset(-3) };
  function fixtureFor(qapStatus) {
    const s = qapStatus === 'draft' ? 'd' : 'a';
    return {
      metadata: { generated: isoOffset(-1), qap_sources: { d: src, a: adoptedSrc } },
      events: [
        { id: 'loi', name: 'Round X LOI', date: isoOffset(20), date_precision: 'exact', category: '9pct-r1-loi', status: 'upcoming', qap_status: qapStatus, qap_source: s },
        { id: 'app', name: 'Round X application', date: isoOffset(80), date_precision: 'exact', category: '9pct-r1-deadline', status: 'upcoming', qap_status: qapStatus, qap_source: s },
      ],
    };
  }
  for (const qs of ['draft', 'adopted']) {
    const want = qs === 'draft';
    for (const mode of ['full', 'compact']) {
      const el = await renderWith(fixtureFor(qs), mode);
      const lis = [...el.querySelectorAll('.qc-item')];
      assert.equal(lis.length, 2, `${mode}: both fixture events must render`);
      for (const li of lis) assert.equal(hasBadge(li), want, `${mode} list, qap_status ${qs}: badge ${want ? 'missing' : 'shown'}`);
    }
    for (const mode of ['full', 'pill']) {
      const el = await renderWith(fixtureFor(qs), mode);
      const card = el.querySelector('.qc-next');
      assert.ok(card, `${mode}: next-deadline card must render`);
      assert.equal(hasBadge(card.querySelector('.qc-next__event')), want, `${mode} next-deadline card, qap_status ${qs}: badge ${want ? 'missing' : 'shown'}`);
      // The card names the source and verification date the data carries.
      const s = want ? src : adoptedSrc;
      const line = card.querySelector('.qc-next__source');
      assert.ok(line, `${mode}: next-deadline card must show its source`);
      assert.ok(line.textContent.includes(s.title), `${mode}: card source must be ${s.title}, got "${line.textContent}"`);
      assert.equal(line.querySelector('a').getAttribute('href'), s.url, `${mode}: card source link must be the data's url`);
      const [y, m, d] = s.verified.split('-').map(Number);
      const verifiedText = new Date(y, m - 1, d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      assert.ok(line.textContent.includes('verified ' + verifiedText), `${mode}: card must show verified ${verifiedText}`);
    }
  }

  // Real data, next-deadline card: badged iff the event it shows is a draft.
  const pill = await renderWith(cal, 'pill');
  const realCard = pill.querySelector('.qc-next');
  if (realCard) {
    const shownName = realCard.querySelector('.qc-next__event a, .qc-next__event').textContent;
    const shown = events.find((e) => shownName.startsWith(e.name));
    assert.ok(shown, 'next-deadline card must show a calendar event');
    assert.equal(hasBadge(realCard.querySelector('.qc-next__event')) && !!realCard.querySelector('.qc-next__event > .qc-draft'), shown.qap_status === 'draft',
      `next-deadline card for ${shown.id}: badge disagrees with qap_status ${shown.qap_status}`);
    assert.ok(realCard.querySelector('.qc-next__source'), 'real next-deadline card must show its source');
  }

  console.log(`chfa-qap-calendar: ${draftEvents} draft / ${adoptedEvents} adopted events badged per qap_status in full, compact and next-deadline views`);
  console.log(`chfa-qap-calendar: ${events.length} events, status checked against ${asOf} ` +
    `(${checkedPast} past, ${checkedUpcoming} upcoming), ${categories.size} categories styled — OK`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
