// test/source-maintenance-declarations.test.js
// 1D — Every data source must declare how it is maintained, and a source
// with no refresh cadence must never render a current-looking finding.
//
// Two defects motivated this. `nhpd-co` declared a 'Semi-annual' cadence
// while its upstream API answered HTTP 404, so a 20-project stub aged
// through the ordinary thresholds as though a refresh were merely overdue.
// `market-reference-projects` declared 'Quarterly' with no generator script
// anywhere in the repo — a cadence nothing performs. In both cases the
// dashboard reported a state nobody had verified.
//
// The agreement check (below) is the load-bearing one: status is produced
// TWICE, by computeStatus() in the inventory and buildSourceReport() in the
// freshness monitor. They have diverged before. This test calls both real
// functions rather than reimplementing either, so a fix applied to one and
// not the other fails here instead of on the page.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function loadBrowserModules() {
  const sandbox = {
    window: {}, document: undefined, console,
    sessionStorage: { getItem() { return null; }, setItem() {} },
    Blob: function () {}, URL: { createObjectURL() {}, revokeObjectURL() {} }
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const rel of ['js/data-source-inventory.js', 'js/data-freshness-monitor.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
  }
  return sandbox.window;
}

const win = loadBrowserModules();
const inventory = win.DataSourceInventory;
const monitor = win.DataFreshnessMonitor;

assert.ok(inventory && typeof inventory.getSources === 'function',
  'DataSourceInventory did not load');
assert.ok(monitor && typeof monitor.buildSourceReport === 'function',
  'DataFreshnessMonitor did not load');

const SOURCES = inventory.getSources();
const MODES = inventory.MAINTENANCE_MODES;

// A cadence word in updateFrequency is a promise that something refreshes
// the file on that schedule. Sources with no such mechanism must not use one.
const CADENCE_WORDS = /\b(daily|weekly|monthly|quarterly|semi-?annual|annual|biennial|nightly|hourly)\b/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NO_CADENCE_MODES = ['curated', 'unavailable', 'archived'];

const failures = [];
function check(cond, msg) { if (!cond) failures.push(msg); }

// ── Floor: the suite must actually have sources to check ──────────────────
assert.ok(SOURCES.length >= 50,
  `expected the inventory to hold the full source set, saw ${SOURCES.length}`);
assert.ok(MODES && MODES.automated && MODES.unavailable,
  'MAINTENANCE_MODES is not exported from the inventory');

// ── 1. Declared modes must be real modes ──────────────────────────────────
for (const s of SOURCES) {
  if (s.maintenance === undefined) continue;   // absent means 'automated'
  check(Object.prototype.hasOwnProperty.call(MODES, s.maintenance),
    `${s.id}: unknown maintenance mode ${JSON.stringify(s.maintenance)} ` +
    `(expected one of ${Object.keys(MODES).join(', ')})`);
}

// ── 2. A source with no cadence must say so, everywhere ───────────────────
const noCadence = SOURCES.filter((s) => NO_CADENCE_MODES.indexOf(s.maintenance) !== -1);

for (const s of noCadence) {
  check(typeof s.maintenanceNote === 'string' && s.maintenanceNote.trim().length >= 40,
    `${s.id}: maintenance '${s.maintenance}' needs a user-visible maintenanceNote ` +
    `explaining why (at least a sentence)`);

  check(s.maxAgeDays === null || s.maxAgeDays === undefined,
    `${s.id}: maintenance '${s.maintenance}' must not declare maxAgeDays ` +
    `(saw ${s.maxAgeDays}) — there is no cadence to measure against`);

  check(!CADENCE_WORDS.test(String(s.updateFrequency || '')),
    `${s.id}: updateFrequency ${JSON.stringify(s.updateFrequency)} names a refresh ` +
    `cadence, but maintenance is '${s.maintenance}' — nothing performs that refresh`);

  // The status must be the mode, not a date-derived verdict.
  check(s.status === s.maintenance,
    `${s.id}: computeStatus returned '${s.status}' for maintenance '${s.maintenance}'`);

  // Absence is not zero: a 0% bar claims "measured, and fully stale".
  check(s.freshnessScore === null,
    `${s.id}: freshnessScore must be null with no cadence, saw ${s.freshnessScore}`);
}

// ── 3. 'unavailable' must carry a last-known-good date ────────────────────
for (const s of SOURCES.filter((s) => s.maintenance === 'unavailable')) {
  check(ISO_DATE.test(String(s.lastKnownGood || '')),
    `${s.id}: maintenance 'unavailable' requires an ISO lastKnownGood date, ` +
    `saw ${JSON.stringify(s.lastKnownGood)}`);
}

// ── 4. The two status producers must agree, source by source ──────────────
let compared = 0;
for (const s of SOURCES) {
  const report = monitor.buildSourceReport(s);
  compared++;
  check(report.status === s.status,
    `${s.id}: producers disagree — inventory computeStatus='${s.status}' but ` +
    `DataFreshnessMonitor.buildSourceReport='${report.status}'`);
  if (s.freshnessScore === null) {
    check(report.freshnessScore === null,
      `${s.id}: inventory scores null but the monitor scores ${report.freshnessScore}`);
  }
}
assert.strictEqual(compared, SOURCES.length,
  'the producer-agreement loop skipped sources');

// ── 5. A cadence-claiming source must have a file to refresh ──────────────
let cadenceChecked = 0;
for (const s of SOURCES) {
  if (!s.localFile) continue;
  if (!CADENCE_WORDS.test(String(s.updateFrequency || ''))) continue;
  cadenceChecked++;
  // Declaring a cadence obliges declaring the window it is measured against.
  // Without this, a 'Weekly' source that omits maxAgeDays silently reports
  // 'unknown' forever instead of ever going stale.
  check(Number.isFinite(s.maxAgeDays) && s.maxAgeDays > 0,
    `${s.id}: declares cadence '${s.updateFrequency}' but no maxAgeDays ` +
    `(saw ${s.maxAgeDays}) — it can never be measured as stale`);
  check(fs.existsSync(path.join(ROOT, s.localFile)),
    `${s.id}: declares cadence '${s.updateFrequency}' but ${s.localFile} does not exist — ` +
    `either repair the source or declare a maintenance mode`);
}

// ── 6. Every status that actually occurs must be filterable and badged ────
// A status the inventory can produce but the hub has no button or badge for
// is invisible to anyone narrowing the list — the reader sees a shorter set
// of options than the data contains and cannot tell that anything is absent.
const hubHtml = fs.readFileSync(path.join(ROOT, 'data-review-hub.html'), 'utf8');
const hubJs = fs.readFileSync(path.join(ROOT, 'js/data-review-hub.js'), 'utf8');

// Scope the badge check to statusBadge()'s own map. Matching the whole file
// would let an unrelated `current: 0` in a counts object satisfy the rule
// for a status that has no badge at all — the guard would pass on a proxy
// instead of the thing it is checking.
const badgeMapMatch = hubJs.match(/function statusBadge\([\s\S]*?\n  \}/);
assert.ok(badgeMapMatch, 'could not locate statusBadge() in js/data-review-hub.js');
const badgeMap = badgeMapMatch[0];
const occurring = Array.from(new Set(SOURCES.map((s) => s.status))).sort();

for (const status of occurring) {
  check(hubHtml.indexOf('data-value="' + status + '"') !== -1,
    `status '${status}' occurs in the inventory but data-review-hub.html has no ` +
    `filter button for it`);
  check(new RegExp('\\b' + status + ':\\s').test(badgeMap),
    `status '${status}' occurs in the inventory but statusBadge() in ` +
    `js/data-review-hub.js has no badge for it — it would fall back to "Unknown"`);
}

// ── Vacuous-pass floors ───────────────────────────────────────────────────
// Each of these guards is worthless if it silently finds nothing to inspect.
assert.ok(noCadence.length >= 2,
  `expected at least the two known no-cadence sources, saw ${noCadence.length} — ` +
  `if they were repaired, lower this floor deliberately`);
assert.ok(cadenceChecked >= 30,
  `expected to check many cadence-claiming sources, only saw ${cadenceChecked}`);
assert.ok(occurring.length >= 4,
  `expected several distinct statuses to check for UI coverage, saw ${occurring.join(', ')}`);

if (failures.length) {
  console.error('\nSource maintenance declaration failures:\n');
  failures.forEach((f) => console.error('  ✗ ' + f));
  console.error('');
  process.exit(1);
}

console.log(`✓ source maintenance declarations: ${SOURCES.length} sources, ` +
  `${noCadence.length} without a cadence, ${cadenceChecked} cadence-claiming files present, ` +
  `${compared} producer-agreement comparisons`);
