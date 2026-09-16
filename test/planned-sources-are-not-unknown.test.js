#!/usr/bin/env node
/**
 * "We don't have this yet" and "we have it and don't know how fresh" are
 * different facts. They were one bucket.
 *
 * 13 of 63 registry sources resolved to `unknown`. Eleven of them are declared
 * but never integrated — their own descriptions say "Planned … No committed
 * local snapshot is present" — and they carried maxAgeDays of 45, 120, 365,
 * 400 and 730 that nothing could ever measure, because lastUpdated is null.
 * The other two had real data on disk and simply declared no cadence.
 *
 * A reader counting unknowns could not tell eleven absent datasets from two
 * unmeasured ones. Same shape as everything else in this repo: one value
 * standing for two meanings, with no way to tell which you are looking at.
 *
 *   before   47 current · 13 unknown · 1 unavailable · 1 curated · 2 live
 *   after    47 current · 11 planned · 2 unavailable · 1 curated · 2 live
 *            0 unknown
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const INV = path.join(ROOT, 'js', 'data-source-inventory.js');
const SRC = fs.readFileSync(INV, 'utf8');

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
const test = (name, fn) => {
  try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); }
};

console.log('planned-sources-are-not-unknown');

function loadInventory() {
  const stub = () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} });
  const win = {
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: stub },
    addEventListener() {}, location: { search: '' }, fetch: () => Promise.resolve({ ok: false }),
  };
  win.window = win;
  const ctx = vm.createContext(win);
  ctx.console = { log() {}, warn() {}, error() {} };
  vm.runInContext(SRC, ctx, { timeout: 10000 });
  if (!win.DataSourceInventory) throw new Error('DataSourceInventory did not load');
  return win.DataSourceInventory;
}

const API = loadInventory();
// Spread into THIS realm's array. getSources() returns an array built inside
// the vm context, and anything derived from it with filter/map inherits that
// realm's Array.prototype — so assert.deepStrictEqual fails the prototype
// check even when both sides are empty. It reports `[] !== []`, which is a
// deeply unhelpful way to spend ten minutes.
const rows = [...API.getSources()];
const local = (xs) => [...xs];

test('the inventory loads and has sources', () => {
  // Without this every assertion below passes over an empty list.
  assert.ok(rows.length >= 50, `only ${rows.length} sources`);
});

test('"planned" is a declared maintenance mode, not an ad-hoc string', () => {
  assert.ok(API.MAINTENANCE_MODES && API.MAINTENANCE_MODES.planned,
    'planned is missing from MAINTENANCE_MODES, so maintenanceMode() falls back to '
    + '"automated" and these run through the age thresholds again');
});

test('no source is left in the unknown bucket', () => {
  const unknown = rows.filter((r) => r.status === 'unknown').map((r) => r.id);
  assert.deepStrictEqual(local(unknown), [],
    `these have no declared state: ${unknown.join(', ')}. Either the data exists and `
    + 'its cadence should be declared, or it does not and the source is planned.');
});

test('every source describing itself as Planned is marked planned', () => {
  // Read from the descriptions rather than a list here, so a new planned entry
  // cannot be added without being declared.
  const described = rows.filter((r) => /^Planned /.test(r.description || ''));
  assert.ok(described.length >= 10, `only ${described.length} sources describe themselves as planned`);
  const undeclared = described.filter((r) => r.status !== 'planned').map((r) => r.id);
  assert.deepStrictEqual(local(undeclared), [],
    `these say "Planned" in prose but do not declare maintenance 'planned': ${undeclared.join(', ')}`);
});

test('a planned source claims no age limit it cannot be measured against', () => {
  const planned = rows.filter((r) => r.status === 'planned');
  const withWindow = planned.filter((r) => r.maxAgeDays != null)
    .map((r) => `${r.id} (${r.maxAgeDays}d)`);
  assert.deepStrictEqual(local(withWindow), [],
    `these have no snapshot and no lastUpdated, so a maxAgeDays is dead config that `
    + `reads like a live threshold: ${withWindow.join(', ')}`);
});

test('a planned source has no snapshot — otherwise it is not planned', () => {
  // The honest direction of the claim. If a file appears, the source has been
  // integrated and should be declared with a real cadence instead.
  const wrong = rows.filter((r) => r.status === 'planned')
    .filter((r) => r.localFile && fs.existsSync(path.join(ROOT, r.localFile)))
    .map((r) => `${r.id} → ${r.localFile}`);
  assert.deepStrictEqual(local(wrong), [],
    `these are marked planned but their data is on disk; declare the real cadence: ${wrong.join(', ')}`);
});

test('a source with data on disk is never marked planned by mistake', () => {
  const kalshi = rows.find((r) => r.id === 'kalshi-housing');
  assert.ok(kalshi, 'kalshi-housing is gone');
  assert.notStrictEqual(kalshi.status, 'planned', 'kalshi-housing has data and a weekly refresher');
  assert.strictEqual(kalshi.updateFrequency, 'Weekly',
    'kalshi-housing declares a cadence other than the one its workflow runs');
});

test('the declared cadence matches the workflow that actually runs', () => {
  // The 14-day window is one missed Sunday, derived from the cron rather than
  // chosen. If the schedule changes, this fails instead of quietly drifting.
  const wf = path.join(ROOT, '.github', 'workflows', 'fetch-kalshi.yml');
  assert.ok(fs.existsSync(wf), 'fetch-kalshi.yml is gone; kalshi-housing should no longer claim Weekly');
  const cron = /cron:\s*'([^']+)'/.exec(fs.readFileSync(wf, 'utf8'));
  assert.ok(cron, 'fetch-kalshi.yml has no cron; the Weekly claim is no longer evidenced');
  assert.ok(/^\S+\s+\S+\s+\*\s+\*\s+\S+$/.test(cron[1]),
    `fetch-kalshi.yml runs "${cron[1]}", which is not a weekly schedule`);
});

test('a deferred paid source says why, and when it was last good', () => {
  const regrid = rows.find((r) => r.id === 'regrid-parcels');
  assert.ok(regrid, 'regrid-parcels is gone');
  assert.strictEqual(regrid.status, 'unavailable',
    'regrid-parcels is a deliberately unfunded paid source (#1612), not an unknown one');
  assert.ok((regrid.maintenanceNote || '').length >= 40, 'no reason given for the deferral');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(String(regrid.lastKnownGood || '')),
    'no lastKnownGood recorded');
});

/* ── the UI must be able to say it ───────────────────────────────────────── */

test('the review hub can render and filter the planned status', () => {
  // A status with no badge falls through to "Unknown" in the UI, which would
  // undo the whole distinction. The existing maintenance-declarations guard
  // caught exactly this when planned was first added.
  const hub = fs.readFileSync(path.join(ROOT, 'js', 'data-review-hub.js'), 'utf8');
  assert.ok(/planned: '<span/.test(hub), 'statusBadge() has no planned badge');
  const page = fs.readFileSync(path.join(ROOT, 'data-review-hub.html'), 'utf8');
  assert.ok(/data-value="planned"/.test(page), 'the review hub has no planned filter button');
});

test('the freshness monitor knows the mode too', () => {
  // The monitor computes status independently and falls back to its own mode
  // list when the inventory has not loaded. A mode missing there degrades to
  // 'automated' and the source runs through the thresholds again.
  const mon = fs.readFileSync(path.join(ROOT, 'js', 'data-freshness-monitor.js'), 'utf8');
  assert.ok(/FALLBACK_MODES = \{[^}]*planned/.test(mon),
    'planned is missing from FALLBACK_MODES in js/data-freshness-monitor.js');
});

console.log(failures === 0
  ? '  planned-sources-are-not-unknown: PASS'
  : `  planned-sources-are-not-unknown: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
