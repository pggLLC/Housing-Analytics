#!/usr/bin/env node
/**
 * No page may present an unconfirmed, closed or stale funding program as eligible.
 *
 * Until 2026-10 the Opportunity Finder listed every row of
 * data/policy/soft-funding-status.json under "Soft-funding programs · N eligible",
 * Compare counted them, and the soft-funding tracker returned them, including 19
 * legacy labels the file itself marked VERIFY ("the current lending directory does
 * not establish this named product") and rounds that had closed. Every check passed,
 * because the 2026-10-09 recheck gave those rows a fresh date.
 *
 * What this pins is agreement between what a surface calls eligible and what the
 * data says about each program:
 *   - the tracker (Deal Calculator breakdown, Market Analysis concept card) returns
 *     only programs the catalog marks confirmed, for every county and deal type;
 *   - the Opportunity Finder and Compare read the verified guide through
 *     js/funding-fit.js with open rounds only, and no longer read the older catalog;
 *   - the daily audit's check (scripts/lib/funding-program-audit.js) reports
 *     unconfirmed labels and rounds whose dates have all passed.
 * The sabotage half proves each check fires.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SOFT = JSON.parse(read('data/policy/soft-funding-status.json'));
const GUIDE = JSON.parse(read('data/policy/co-developer-funding-guide.json'));
const GEO = JSON.parse(read('data/hna/geo-config.json'));
const TRACKER_SRC = read('js/soft-funding-tracker.js');
const F = require('../js/funding-fit.js');
const { fundingProgramFindings, fundingWatchFindings, CONFIRMED_SOFT_STATUSES, SETTLED_SOFT_STATUSES } = require('../scripts/lib/funding-program-audit.js');

const COUNTIES = GEO.counties.map((c) => c.geoid);
const EXECUTIONS = [undefined, '9%', '4%', 'non-LIHTC'];

// A fresh tracker from source, so a sabotaged copy can be loaded the same way.
function trackerFrom(src) {
  const sandbox = { module: { exports: {} }, self: undefined };
  vm.runInNewContext(src, sandbox);
  return sandbox.module.exports;
}

// Every key the tracker would show as eligible, anywhere in Colorado, for any deal type.
function trackerEligibleKeys(tracker, soft) {
  tracker.load(soft);
  const keys = new Set();
  for (const c of COUNTIES) {
    for (const ex of EXECUTIONS) {
      tracker.getEligiblePrograms(c, ex, { includeMarket: true, includeVolumeCap: true }).forEach((p) => keys.add(p.key));
    }
    (tracker.check(c, 2026).programs || []).forEach((p) => keys.add(p.key));
  }
  return keys;
}

function trackerErrors(tracker, soft) {
  const errors = [];
  for (const key of trackerEligibleKeys(tracker, soft)) {
    const p = soft.programs[key];
    if (!CONFIRMED_SOFT_STATUSES.includes(p.status)) errors.push(`${key} (${p.status}) is offered as eligible`);
  }
  return errors;
}

// Every program the shared matcher lists as open for any county and deal type.
function finderErrors(guide) {
  const errors = [];
  for (const c of COUNTIES) {
    for (const ex of [undefined, '9%', '4%', 'rental', 'for-sale']) {
      for (const r of F.select(guide, { county: c, execution: ex, openOnly: true })) {
        if (!F.isOpenOrScheduled(r.program)) errors.push(`${r.program.id} (${r.program.status}) is listed as open`);
      }
    }
  }
  return [...new Set(errors)];
}

let passed = 0;
function ok(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }

console.log('funding-eligibility-claims');

ok('the tracker offers only confirmed programs, for every county and deal type', () => {
  const tracker = trackerFrom(TRACKER_SRC);
  assert.deepEqual(trackerErrors(tracker, SOFT), []);
  // Non-vacuity on the scan: it looked at real catalog rows and found some eligible.
  assert.ok(trackerEligibleKeys(trackerFrom(TRACKER_SRC), SOFT).size > 0, 'the scan found no eligible program at all');
  assert.ok(Object.keys(SOFT.programs).length >= 10, 'the catalog the scan reads is nearly empty');
  assert.deepEqual([...tracker.CONFIRMED_STATUSES], CONFIRMED_SOFT_STATUSES, 'tracker and audit agree on what "confirmed" means');
});

ok('the shared finder lists only open or scheduled rounds when asked for open programs', () => {
  assert.deepEqual(finderErrors(GUIDE), []);
  const listed = F.select(GUIDE, { openOnly: true }).length;
  const closed = GUIDE.programs.filter((p) => !F.isOpenOrScheduled(p)).length;
  assert.ok(listed > 0 && closed > 0, `scan needs both open (${listed}) and closed (${closed}) programs to mean anything`);
});

ok('the Opportunity Finder and Compare read the verified guide, open rounds only', () => {
  for (const file of ['js/lihtc-opportunity-finder.js', 'js/compare.js']) {
    const src = read(file);
    assert.doesNotMatch(src, /loadSoft\('data\/policy\/soft-funding-status\.json'\)|soft\('data\/policy\/soft-funding-status\.json'\)/,
      `${file} no longer loads the older catalog`);
    assert.match(src, /data\/policy\/co-developer-funding-guide\.json/, `${file} loads the verified guide`);
    assert.match(src, /openOnly: true/, `${file} asks the matcher for open rounds`);
    assert.match(src, /\.select\(/, `${file} lists programs through FundingFit.select`);
  }
});

ok('the daily audit reports unconfirmed labels and passed rounds', () => {
  const findings = fundingProgramFindings({ guide: GUIDE, soft: SOFT, today: '2026-10-14' });
  const unconfirmed = Object.values(SOFT.programs).filter((p) => !SETTLED_SOFT_STATUSES.includes(p.status) && !CONFIRMED_SOFT_STATUSES.includes(p.status));
  if (unconfirmed.length) {
    const f = findings.find((x) => /not confirmed on any official page/.test(x.description));
    assert.ok(f, 'unconfirmed labels are reported');
    for (const p of unconfirmed) assert.ok(f.description.includes(p.name), `${p.name} is named in the finding`);
  }
  const audit = read('test/audit-modules/data-integrity.js');
  assert.match(audit, /\.\.\.checkFundingPrograms\(\),/, 'the daily audit runs the funding check');
});

// ── Sabotage: each mutation must apply, and must be caught ──
ok('sabotage: a VERIFY row in the catalog is never offered, even with funds', () => {
  const soft = JSON.parse(JSON.stringify(SOFT));
  soft.programs['INVENTED-LEGACY'] = { name: 'INVENTED legacy label', county: 'All', status: 'VERIFY', available: 9e6, eligibleExecution: ['9%', '4%', 'non-LIHTC'] };
  assert.ok(soft.programs['INVENTED-LEGACY'], 'mutation applied');
  assert.ok(!trackerEligibleKeys(trackerFrom(TRACKER_SRC), soft).has('INVENTED-LEGACY'));
});

ok('sabotage: a tracker that trusts VERIFY rows is caught', () => {
  const src = TRACKER_SRC.replace("var CONFIRMED_STATUSES = ['active'];", "var CONFIRMED_STATUSES = ['active', 'VERIFY'];");
  assert.notEqual(src, TRACKER_SRC, 'mutation applied');
  assert.ok(trackerErrors(trackerFrom(src), SOFT).length > 0);
});

ok('sabotage: a matcher that lists closed rounds as open is caught', () => {
  const guide = JSON.parse(JSON.stringify(GUIDE));
  const closed = guide.programs.find((p) => p.status === 'closed' && p.fit && p.fit.role === 'capital');
  const realSelect = F.select;
  // Mutate the matcher's open-only filter, not the data.
  const brokenSelect = (g, q) => realSelect(g, Object.assign({}, q, { openOnly: false }));
  F.select = brokenSelect;
  try {
    assert.notEqual(F.select, realSelect, 'mutation applied');
    assert.ok(finderErrors(guide).some((e) => e.startsWith(closed.id)));
  } finally {
    F.select = realSelect;
  }
});

ok('sabotage: a periodic round whose dates have all passed is reported', () => {
  const guide = JSON.parse(JSON.stringify(GUIDE));
  const p = guide.programs.find((x) => x.status === 'rounds');
  const before = p.application_cycle;
  p.application_cycle = 'INVENTED: the only round ran January 5, 2026 to February 6, 2026.';
  assert.notEqual(p.application_cycle, before, 'mutation applied');
  const findings = fundingProgramFindings({ guide, soft: SOFT, today: '2026-10-14' });
  assert.ok(findings.some((f) => f.description.startsWith(p.name) && /every date in its application cycle has passed/.test(f.description)));
  // A round named only by month stays upcoming until that month ends.
  p.application_cycle = 'INVENTED: next round the first business day of November 2026.';
  assert.ok(!fundingProgramFindings({ guide, soft: SOFT, today: '2026-10-14' }).some((f) => f.description.startsWith(p.name)));
});

ok('sabotage: a confirmed program past its deadline is reported', () => {
  const soft = JSON.parse(JSON.stringify(SOFT));
  const [key, p] = Object.entries(soft.programs).find(([, x]) => x.status === 'active');
  p.deadline = '2026-01-02';
  assert.equal(soft.programs[key].deadline, '2026-01-02', 'mutation applied');
  const findings = fundingProgramFindings({ guide: GUIDE, soft, today: '2026-10-14' });
  assert.ok(findings.some((f) => f.description.includes('deadline 2026-01-02 has passed')));
});

ok('the daily audit reports a program whose own page changed after it was last checked', () => {
  const prog = { catalog: 'guide', id: 'doh-grant', name: 'DOH Grant', last_checked: '2026-10-10' };
  const page = { url: 'https://doh.localhost/p', programs: [prog], last_changed_at: '2026-10-12T05:34:00Z' };
  const findings = fundingWatchFindings({ watch: { pages: [page] } });
  assert.equal(findings.length, 1);
  assert.match(findings[0].description, /^DOH Grant: its page changed on 2026-10-12, after the program was last checked \(2026-10-10\)/);
  // non-vacuity both ways: rechecked after the change, or a page never changed (baseline), says nothing
  assert.deepEqual(fundingWatchFindings({ watch: { pages: [{ ...page, programs: [{ ...prog, last_checked: '2026-10-12' }] }] } }), []);
  assert.deepEqual(fundingWatchFindings({ watch: { pages: [{ ...page, last_changed_at: null }] } }), []);
  assert.deepEqual(fundingWatchFindings({ watch: null }), [], 'no watch file yet: nothing to report');
});

ok('the daily audit reports a program page blocked for days, never as no change', () => {
  const page = { url: 'https://usda.localhost/p', programs: [{ catalog: 'guide', id: 'usda-515', name: 'USDA 515', last_checked: '2026-10-10' }],
    last_changed_at: null, unverifiable: true, first_failed_at: '2026-10-13T05:34:00Z', error: 'HTTP Error 403' };
  const [f] = fundingWatchFindings({ watch: { pages: [page] } });
  assert.match(f.description, /USDA 515 could not be read since 2026-10-13/);
  assert.deepEqual(fundingWatchFindings({ watch: { pages: [{ ...page, unverifiable: false }] } }), []);
  // An agency announcement page holds no programs, and a blocked one is still reported (Codex review).
  const agency = { url: 'https://dlg.localhost/eiaf', agency: 'DOLA Division of Local Government', programs: [],
    unverifiable: true, first_failed_at: '2026-10-13T05:34:00Z', error: 'HTTP Error 403' };
  const [a] = fundingWatchFindings({ watch: { pages: [agency] } });
  assert.match(a.description, /DOLA Division of Local Government \(agency page\) could not be read since 2026-10-13/);
  assert.deepEqual(fundingWatchFindings({ watch: { pages: [{ ...agency, unverifiable: false }] } }), []);
  // A federal search failing for days is reported every day, not only in the one tracker issue (Codex review).
  const fed = { 'grants.gov': { ok: false, unverifiable: true, first_failed_at: '2026-10-13T05:34:00Z',
    endpoint: 'https://grants.localhost/search2', error: 'HTTP Error 503' },
  'federalregister.gov': { ok: true, unverifiable: false } };
  const fedFindings = fundingWatchFindings({ watch: { pages: [], federal_sources: fed } });
  assert.equal(fedFindings.length, 1);
  assert.match(fedFindings[0].description, /grants\.gov search for new federal funding notices has failed since 2026-10-13/);
  assert.deepEqual(fundingWatchFindings({ watch: { pages: [], federal_sources: { 'grants.gov': { ...fed['grants.gov'], unverifiable: false } } } }), []);
  const audit = read('test/audit-modules/data-integrity.js');
  assert.match(audit, /fundingWatchFindings\(\{ watch \}\)/, 'the daily audit runs the watch check');
  assert.match(audit, /'audit', 'funding-watch\.json'/, 'and reads the file the watcher writes');
});

console.log(`funding-eligibility-claims: ${passed} passed`);
