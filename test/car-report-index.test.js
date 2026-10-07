#!/usr/bin/env node
/**
 * The CAR loaders request only reports that exist (#2053).
 *
 * The HNA pages and js/housing-data-integration.js used to guess the newest
 * report from the calendar, starting with the current month. On the 1st of
 * every month that file does not exist until car-data-update.yml lands (~3h
 * after its cron), so each page load logged a 404 and the rendered smoke failed
 * six flows on every PR and on main for about a third of a day.
 *
 * Two agreements are pinned here:
 *   1. data/car-market-reports.json lists exactly the reports in data/.
 *   2. Each loader, run with its clock on the 1st of the month AFTER the newest
 *      report (the exact window that failed), requests only files in data/.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── 1. the index agrees with data/ ─────────────────────────────────────────
const check = spawnSync('node', ['scripts/build-car-report-index.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
assert.equal(check.status, 0, check.stdout + check.stderr);
const index = JSON.parse(read('data/car-market-reports.json'));
const onDisk = fs.readdirSync(path.join(ROOT, 'data')).filter((f) => /^car-market-report-\d{4}-\d{2}\.json$/.test(f));
assert(onDisk.length > 0, 'no CAR reports on disk to check against');
assert.equal(index.months.length, onDisk.length);
assert.equal(index.latest, index.months[0]);

// The window that failed: the 1st of the month after the newest report.
const [y, m] = index.latest.split('-').map(Number);
const FIRST_OF_NEXT = Date.UTC(y, m, 1, 2, 0, 0); // 02:00 UTC on the 1st, before the cron lands
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [FIRST_OF_NEXT])); }
  static now() { return FIRST_OF_NEXT; }
}

const exists = (url) => {
  const rel = String(url).replace(/^\.?\//, '').replace(/^.*?\/(data\/)/, '$1');
  return fs.existsSync(path.join(ROOT, rel));
};
function fakeFetch(requested) {
  return async (url) => {
    requested.push(String(url));
    if (!exists(url)) return { ok: false, status: 404, json: async () => null };
    const body = JSON.parse(fs.readFileSync(path.join(ROOT, String(url)), 'utf8'));
    return { ok: true, status: 200, json: async () => body };
  };
}

// ── 2a. both HNA pages ─────────────────────────────────────────────────────
async function checkPage(file, county) {
  const html = read(file);
  const start = html.indexOf('(function () {\n  function fmtK');
  assert.notEqual(start, -1, `${file}: market-data script not found`);
  const end = html.indexOf('\n}());', start);
  const script = html.slice(start, end + '\n}());'.length);
  const window = { HNAState: { state: { current: county ? { geoType: 'county', geoid: county, contextCounty: county } : null } } };
  const document = { addEventListener() {}, getElementById: () => null, querySelector: () => null };
  const requested = [];
  new Function('window', 'document', 'fetch', 'Date', script)(window, document, fakeFetch(requested), FrozenDate);
  await window.__HNA_CAR_TEST__.tryLoadCARFallback({ render() {} });
  return requested;
}

// ── 2b. js/housing-data-integration.js ─────────────────────────────────────
async function checkIntegration() {
  const requested = [];
  const context = { console: { warn() {}, log() {} }, fetch: fakeFetch(requested), Date: FrozenDate };
  context.window = context; context.self = context; context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read('js/housing-data-integration.js'), context);
  const hdi = context.HousingDataIntegration;
  assert(hdi && typeof hdi.loadCARData === 'function', 'HousingDataIntegration.loadCARData not exposed');
  const car = await hdi.loadCARData();
  assert(car, 'loadCARData returned nothing on the 1st');
  return requested;
}

(async () => {
  const runs = {
    'housing-needs-assessment.html (county)': await checkPage('housing-needs-assessment.html', '08031'),
    'housing-needs-assessment.html (no county)': await checkPage('housing-needs-assessment.html', null),
    'hna-where-its-heading.html (county)': await checkPage('hna-where-its-heading.html', '08031'),
    'js/housing-data-integration.js': await checkIntegration(),
  };
  for (const [name, requested] of Object.entries(runs)) {
    assert(requested.length > 0, `${name}: requested nothing; the scan checked nothing`);
    const missing = requested.filter((u) => !exists(u));
    assert.deepEqual(missing, [], `${name} requested files that do not exist: ${missing.join(', ')}`);
  }
  console.log(`car-report-index: PASS (${index.months.length} reports; clock ${new RealDate(FIRST_OF_NEXT).toISOString()}; `
    + Object.entries(runs).map(([n, r]) => `${n}: ${r.length} requests`).join('; ') + ')');
})().catch((err) => { console.error(err); process.exitCode = 1; });
