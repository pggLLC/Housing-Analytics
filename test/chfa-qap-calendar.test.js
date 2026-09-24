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
//     and a stale "upcoming" whose date has passed as past.

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

// ── component: past/current is decided by the end of a window ───────
async function renderWith(fixture) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="c"></div></body></html>', {
    runScripts: 'outside-only',
  });
  const win = dom.window;
  win.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(fixture) });
  win.eval(componentSrc);
  const c = win.document.getElementById('c');
  win.QapCalendar.attach(c, { showRolling: false });
  await new Promise((r) => setTimeout(r, 20));
  return c;
}

function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

(async () => {
  const c = await renderWith({
    metadata: { generated: isoOffset(-60) },
    events: [
      { id: 'window', name: 'Open window', date: isoOffset(-10), date_end: isoOffset(10), category: 'qap-adoption', status: 'upcoming' },
      { id: 'stale', name: 'Stale upcoming', date: isoOffset(-5), category: 'qap-hearing', status: 'upcoming' },
    ],
  });
  const items = [...c.querySelectorAll('.qc-item')];
  assert.equal(items.length, 2, 'both fixture events must render');
  const byName = (n) => items.find((li) => li.textContent.includes(n));
  assert.ok(!byName('Open window').classList.contains('qc-item--past'),
    'a window whose date_end is still ahead must not render as past');
  assert.ok(byName('Stale upcoming').classList.contains('qc-item--past'),
    'an event whose date has passed must render as past even if status says upcoming');

  console.log(`chfa-qap-calendar: ${events.length} events, status checked against ${asOf} ` +
    `(${checkedPast} past, ${checkedUpcoming} upcoming), ${categories.size} categories styled — OK`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
