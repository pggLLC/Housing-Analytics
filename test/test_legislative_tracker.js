/**
 * test/test_legislative_tracker.js
 * Unit tests for js/legislative-tracker.js (Phase 3 Epic #444)
 *
 * Usage:
 *   node test/test_legislative_tracker.js
 */

'use strict';

const path    = require('path');
const tracker = require(path.resolve(__dirname, '..', 'js', 'legislative-tracker'));

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log('  \u2705 PASS: ' + message);
    passed++;
  } else {
    console.error('  \u274c FAIL: ' + message);
    failed++;
  }
}

function test(name, fn) {
  console.log('\n[test] ' + name);
  try {
    fn();
  } catch (err) {
    console.error('  \u274c FAIL: threw unexpected error \u2014 ' + err.message);
    failed++;
  }
}

// ── Module exports ────────────────────────────────────────────────────────────

test('Module exports all required functions', () => {
  assert(typeof tracker.getAllBills             === 'function', 'getAllBills exported');
  assert(typeof tracker.getBill                === 'function', 'getBill exported');
  assert(typeof tracker.getBillsByTag          === 'function', 'getBillsByTag exported');
  assert(typeof tracker.getMarketImpactSummary === 'function', 'getMarketImpactSummary exported');
  assert(typeof tracker.getCraTractTargeting   === 'function', 'getCraTractTargeting exported');
  assert(typeof tracker.getLegislativeTimeline === 'function', 'getLegislativeTimeline exported');
  assert(typeof tracker.STAGES                 === 'object',   'STAGES exported');
  assert(typeof tracker.STAGE_ORDER            === 'object',   'STAGE_ORDER is an array');
});

// ── getAllBills ────────────────────────────────────────────────────────────────

test('getAllBills returns array with at least 4 bills', () => {
  const bills = tracker.getAllBills();
  assert(Array.isArray(bills), 'getAllBills returns an array');
  assert(bills.length >= 4, 'at least 4 bills tracked (got ' + bills.length + ')');
});

test('Each bill has required fields', () => {
  const bills = tracker.getAllBills();
  bills.forEach(function (bill) {
    assert(typeof bill.id               === 'string', bill.id + ': id is string');
    assert(typeof bill.title            === 'string', bill.id + ': title is string');
    assert(typeof bill.stage            === 'string', bill.id + ': stage is string');
    assert(typeof bill.stageProgress    === 'number', bill.id + ': stageProgress is number');
    assert(typeof bill.passageProbability==='number', bill.id + ': passageProbability is number');
    assert(typeof bill.combinedImpactScore==='number',bill.id + ': combinedImpactScore is number');
    assert(Array.isArray(bill.tags),                  bill.id + ': tags is array');
  });
});

test('stageProgress is between 0 and 100', () => {
  tracker.getAllBills().forEach(function (bill) {
    assert(bill.stageProgress >= 0 && bill.stageProgress <= 100,
      bill.id + ': stageProgress in [0,100] = ' + bill.stageProgress);
  });
});

test('passageProbability is between 0 and 100', () => {
  tracker.getAllBills().forEach(function (bill) {
    assert(bill.passageProbability >= 0 && bill.passageProbability <= 100,
      bill.id + ': passageProbability in [0,100] = ' + bill.passageProbability);
  });
});

test('combinedImpactScore is between 0 and 10', () => {
  tracker.getAllBills().forEach(function (bill) {
    assert(bill.combinedImpactScore >= 0 && bill.combinedImpactScore <= 10,
      bill.id + ': combinedImpactScore in [0,10] = ' + bill.combinedImpactScore);
  });
});

// ── getBill ───────────────────────────────────────────────────────────────────

test('getBill returns bill by ID', () => {
  const bill = tracker.getBill('HR6644');
  assert(bill !== null,                      'getBill HR6644 returns result');
  assert(bill.id === 'HR6644',               'id matches');
  assert(typeof bill.stageProgress === 'number', 'stageProgress computed');
});

test('getBill returns null for unknown ID', () => {
  const bill = tracker.getBill('UNKNOWN999');
  assert(bill === null, 'returns null for unknown bill ID');
});

// ── getBillsByTag ─────────────────────────────────────────────────────────────

test('getBillsByTag returns bills matching tag', () => {
  const lihtcBills = tracker.getBillsByTag('LIHTC');
  assert(lihtcBills.length >= 2, 'at least 2 LIHTC-tagged bills (got ' + lihtcBills.length + ')');
  lihtcBills.forEach(function (b) {
    assert(b.tags.indexOf('LIHTC') !== -1, b.id + ': LIHTC tag present');
  });
});

test('getBillsByTag returns bills matching CRA tag', () => {
  const craBills = tracker.getBillsByTag('CRA');
  assert(craBills.length >= 2, 'at least 2 CRA-tagged bills (got ' + craBills.length + ')');
});

test('getBillsByTag returns empty array for unknown tag', () => {
  const bills = tracker.getBillsByTag('NONEXISTENT_TAG_XYZ');
  assert(Array.isArray(bills) && bills.length === 0, 'empty array for unknown tag');
});

// ── getMarketImpactSummary ────────────────────────────────────────────────────

test('getMarketImpactSummary returns expected shape', () => {
  const summary = tracker.getMarketImpactSummary();
  assert(typeof summary === 'object',                            'summary is object');
  assert(typeof summary.activeBillCount === 'number',            'activeBillCount is number');
  assert(typeof summary.weightedLihtcImpactScore === 'number',   'weightedLihtcImpactScore is number');
  assert(typeof summary.weightedCraImpactScore === 'number',     'weightedCraImpactScore is number');
  assert(Array.isArray(summary.keyLihtcProvisions),              'keyLihtcProvisions is array');
  assert(Array.isArray(summary.keyCraProvisions),                'keyCraProvisions is array');
  assert(typeof summary.marketOutlook === 'string',              'marketOutlook is string');
});

test('getMarketImpactSummary has positive impact scores', () => {
  const summary = tracker.getMarketImpactSummary();
  assert(summary.weightedLihtcImpactScore > 0, 'LIHTC impact score > 0');
  assert(summary.weightedCraImpactScore > 0,   'CRA impact score > 0');
  assert(summary.activeBillCount > 0,          'activeBillCount > 0');
});

test('getMarketImpactSummary has provisions from bills', () => {
  const summary = tracker.getMarketImpactSummary();
  assert(summary.keyLihtcProvisions.length >= 3, 'at least 3 LIHTC provisions listed');
  assert(summary.keyCraProvisions.length >= 2,   'at least 2 CRA provisions listed');
});

// ── getCraTractTargeting ──────────────────────────────────────────────────────

test('getCraTractTargeting returns data for known tract types', () => {
  ['lmi', 'distressed', 'rural', 'opportunity_zone', 'non_lmi'].forEach(function (type) {
    const targeting = tracker.getCraTractTargeting(type);
    assert(targeting !== null,                            type + ': targeting is not null');
    assert(typeof targeting.label === 'string',           type + ': label is string');
    assert(typeof targeting.craWeight === 'string',       type + ': craWeight is string');
    assert(typeof targeting.lihtcSynergy === 'string',    type + ': lihtcSynergy is string');
    assert(typeof targeting.description === 'string',     type + ': description is string');
  });
});

test('LMI tract has high CRA weight', () => {
  const lmi = tracker.getCraTractTargeting('lmi');
  assert(lmi.craWeight === 'high',           'LMI tract CRA weight is high');
  assert(lmi.lihtcSynergy === 'very-high',   'LMI tract LIHTC synergy is very-high');
});

test('getCraTractTargeting returns null for unknown type', () => {
  const result = tracker.getCraTractTargeting('unknown_tract_type_xyz');
  assert(result === null, 'returns null for unknown tract type');
});

// ── getLegislativeTimeline ────────────────────────────────────────────────────

test('getLegislativeTimeline returns sorted timeline array', () => {
  const timeline = tracker.getLegislativeTimeline();
  assert(Array.isArray(timeline), 'timeline is array');
  assert(timeline.length >= 4,   'at least 4 timeline events');
  timeline.forEach(function (entry) {
    assert(typeof entry.date  === 'string', 'entry has date string');
    assert(typeof entry.event === 'string', 'entry has event description');
    assert(typeof entry.stage === 'string', 'entry has stage');
  });
});

test('Timeline includes H.R. 6644 passage event', () => {
  const timeline = tracker.getLegislativeTimeline();
  const passed   = timeline.find(function (e) { return /390-9/i.test(e.event); });
  assert(passed !== undefined, 'House 390-9 passage event found in timeline');
  assert(passed.billId === 'HR6644', 'passage event linked to HR6644');
});

// ── STAGES constants ──────────────────────────────────────────────────────────

test('STAGES object has all required stage names', () => {
  const required = ['INTRODUCED', 'COMMITTEE', 'HOUSE_PASSED', 'SENATE_COMMITTEE',
                    'SENATE_PASSED', 'CONFERENCE', 'ENROLLED', 'SIGNED', 'FAILED'];
  required.forEach(function (key) {
    assert(typeof tracker.STAGES[key] === 'string', 'STAGES.' + key + ' is string');
  });
});

test('STAGE_ORDER is an ordered array', () => {
  const order = tracker.STAGE_ORDER;
  assert(Array.isArray(order),  'STAGE_ORDER is array');
  assert(order.length >= 7,     'STAGE_ORDER has at least 7 stages');
  assert(order[0] === tracker.STAGES.INTRODUCED, 'first stage is INTRODUCED');
  assert(order[order.length - 1] === tracker.STAGES.SIGNED, 'last stage is SIGNED');
});

// ── H.R. 6644 specific checks ─────────────────────────────────────────────────

test('H.R. 6644 is in Conference stage with high passage probability', () => {
  const bill = tracker.getBill('HR6644');
  assert(bill !== null,                          'HR6644 found');
  assert(bill.stage === tracker.STAGES.CONFERENCE, 'HR6644 is in Conference stage');
  assert(bill.passageProbability >= 80,          'passage probability >= 80% for Conference + bipartisan bill');
  assert(bill.houseVote === '390-9',             'house vote recorded');
});

test('AHCIA has high LIHTC impact score', () => {
  const bill = tracker.getBill('AHCIA');
  assert(bill !== null,                      'AHCIA found');
  assert(bill.lihtcImpact !== null,          'AHCIA has lihtcImpact');
  assert(bill.lihtcImpact.score >= 9,        'AHCIA LIHTC impact score >= 9');
  assert(bill.lihtcImpact.provisions.length >= 3, 'at least 3 LIHTC provisions');
});

// ── Results ───────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
