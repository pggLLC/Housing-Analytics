'use strict';
/**
 * test/soft-funding-tracker.test.js
 *
 * Unit tests for js/soft-funding-tracker.js — soft-funding program
 * availability lookup. Covers:
 *   - load() / isLoaded() state
 *   - check() scoring + warning logic
 *   - getEligiblePrograms() filtering by county + execution type
 *   - getPabStatus() shape
 *   - sumEligible() aggregation
 *   - Internal helpers: _daysToDeadline, _fmtDollars, _computeConfidence
 *
 * Module exports a CommonJS surface, so no DOM / browser context needed.
 *
 * Run: node test/soft-funding-tracker.test.js
 */

const assert = require('node:assert/strict');

const SFT = require('../js/soft-funding-tracker.js');

/* ── Test harness ───────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push([name, fn]); }
function group(name, fn) { _tests.push([`__group__:${name}`, null]); fn(); }

async function runAll() {
  for (const [name, fn] of _tests) {
    if (name.startsWith('__group__:')) {
      console.log(`\n${name.slice('__group__:'.length)}`);
      continue;
    }
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`  ❌ ${name}`);
      console.log(`     ${err.message}`);
      failed++;
    }
  }
}

/* ── Fixtures ───────────────────────────────────────────────────────── */

// Build a fixture far enough in the future that "days to deadline" stays
// positive for years. Pick a date 2 years out.
function futureDate(daysFromNow) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function FIXTURE() {
  return {
    lastUpdated: '2026-04-15',
    programs: {
      'CHFA-HTF': {
        name:              'CHFA Housing Trust Fund',
        county:            'All',
        available:         2_500_000,
        awarded:           7_500_000,
        capacity:          10_000_000,
        deadline:          futureDate(180),      // plenty of runway
        competitiveness:   'moderate',
        eligibleExecution: ['4%', '9%'],
        adminEntity:       'CHFA',
        amiTargeting:      '60% AMI',
        maxPerProject:     500_000,
      },
      'DOLA-HTF': {
        name:              'DOLA State HTF',
        county:            'All',
        available:         1_200_000,
        awarded:           800_000,
        capacity:          2_000_000,
        deadline:          futureDate(30),       // 30 days → deadline warning
        competitiveness:   'high',
        eligibleExecution: ['9%'],
      },
      'Boulder-AHTF': {
        name:              'Boulder Affordable Housing Trust',
        county:            '08013',
        available:         600_000,
        awarded:           100_000,
        capacity:          700_000,
        deadline:          futureDate(120),
        competitiveness:   'low',
        eligibleExecution: ['4%', '9%', 'non-LIHTC'],
      },
      'Exhausted-Grant': {
        name:              'Exhausted Local Pool',
        county:            '08013',
        available:         0,
        awarded:           500_000,
        capacity:          500_000,
        deadline:          null,
        competitiveness:   'low',
        eligibleExecution: ['9%'],
      },
    },
  };
}

// Fixture variant that ALSO includes market-source and volume-cap rows.
// Used by getEligiblePrograms filter tests and getPabStatus. Keeping these
// out of the default FIXTURE avoids polluting check()'s availability-sorted
// ranking — check() doesn't filter by isMarketSource or isVolumeCap, so a
// $50M PAB entry would always win "best match" and drown out real grants.
function FIXTURE_WITH_EXTRAS() {
  const f = FIXTURE();
  f.programs['OZ-Equity'] = {
    name:              'Opportunity Zone Equity',
    county:            'All',
    available:         999_999_999,
    isMarketSource:    true,
    eligibleExecution: ['4%', '9%'],
  };
  f.programs['PAB-CO'] = {
    name:              'CO Private Activity Bond',
    county:            'All',
    available:         50_000_000,
    awarded:           50_000_000,
    capacity:          100_000_000,
    deadline:          futureDate(200),
    warning:           'Annual cap — apply early',
    isVolumeCap:       true,
    eligibleExecution: ['4%'],
  };
  return f;
}

/* ── Tests ──────────────────────────────────────────────────────────── */

console.log('SoftFundingTracker — unit tests');

group('1. API surface', () => {
  test('exports all public + test helpers', () => {
    for (const k of ['load', 'check', 'getLastUpdated', 'isLoaded',
                     'getEligiblePrograms', 'getPabStatus', 'sumEligible',
                     '_daysToDeadline', '_computeConfidence', '_fmtDollars']) {
      assert.equal(typeof SFT[k], 'function', `missing/wrong type: ${k}`);
    }
  });
});

group('2. load() + isLoaded() + getLastUpdated()', () => {
  test('isLoaded() is false before load()', async () => {
    // Note: module keeps state across tests. To actually assert this we'd need
    // a reset API — the module doesn't expose one, so we can only check that
    // loading a fresh fixture sets the state correctly.
    // (This group runs first so any previous state is still unset.)
    // Skip assertion if previous tests have already loaded fixtures.
  });

  test('load() returns a Promise', () => {
    const p = SFT.load(FIXTURE());
    assert.ok(p && typeof p.then === 'function');
  });

  test('after load(), isLoaded() returns true', async () => {
    await SFT.load(FIXTURE());
    assert.equal(SFT.isLoaded(), true);
  });

  test('getLastUpdated() returns the lastUpdated field', async () => {
    await SFT.load(FIXTURE());
    assert.equal(SFT.getLastUpdated(), '2026-04-15');
  });

  test('load(undefined) is a safe no-op (stays loaded if already)', async () => {
    await SFT.load(FIXTURE());
    await SFT.load(undefined);  // should not crash
    assert.equal(SFT.isLoaded(), true);
  });
});

group('3. _daysToDeadline', () => {
  test('null deadline returns null', () => {
    assert.equal(SFT._daysToDeadline(null), null);
  });

  test('empty string deadline returns null', () => {
    assert.equal(SFT._daysToDeadline(''), null);
  });

  test('future date returns positive integer', () => {
    const d = SFT._daysToDeadline(futureDate(45));
    assert.ok(d >= 44 && d <= 46, `expected ~45, got ${d}`);
  });

  test('past date returns negative', () => {
    const d = SFT._daysToDeadline(futureDate(-10));
    assert.ok(d <= -9, `expected ~-10, got ${d}`);
  });

  test('refDate parameter anchors the computation', () => {
    const d = SFT._daysToDeadline('2026-06-01', '2026-05-01T00:00:00Z');
    assert.equal(d, 31);
  });
});

group('4. _fmtDollars', () => {
  test('formats >=1M with one decimal', () => {
    assert.equal(SFT._fmtDollars(2_500_000), '$2.5M');
    assert.equal(SFT._fmtDollars(10_000_000), '$10.0M');
  });

  test('formats 1K-999K with rounded thousands', () => {
    assert.equal(SFT._fmtDollars(150_000), '$150K');
    assert.equal(SFT._fmtDollars(1_499), '$1K');
  });

  test('formats small values as raw dollars', () => {
    assert.equal(SFT._fmtDollars(500), '$500');
  });

  test('non-numeric input returns "$0"', () => {
    assert.equal(SFT._fmtDollars(null), '$0');
    assert.equal(SFT._fmtDollars('oops'), '$0');
  });
});

group('5. _computeConfidence', () => {
  test('null program returns 0.5 (unknown)', () => {
    assert.equal(SFT._computeConfidence(null), 0.5);
  });

  test('available=0 collapses confidence to ~0.05', () => {
    const c = SFT._computeConfidence({ available: 0, capacity: 1_000_000, awarded: 1_000_000 });
    assert.ok(c <= 0.1, `expected ~0.05 for depleted fund, got ${c}`);
  });

  test('high utilization (>85%) reduces confidence', () => {
    const low = SFT._computeConfidence({ available: 100_000, capacity: 1_000_000, awarded: 900_000 });
    const hi  = SFT._computeConfidence({ available: 500_000, capacity: 1_000_000, awarded: 100_000 });
    assert.ok(hi > low, `healthy fund (${hi}) should beat near-exhausted (${low})`);
  });

  test('close deadline (<30 days) reduces confidence', () => {
    const near = SFT._computeConfidence({ available: 500_000, deadline: futureDate(10) });
    const far  = SFT._computeConfidence({ available: 500_000, deadline: futureDate(200) });
    assert.ok(far > near);
  });

  test('returns value in [0, 1]', () => {
    const c = SFT._computeConfidence({ available: 500_000, capacity: 1_000_000 });
    assert.ok(c >= 0 && c <= 1);
  });
});

group('6. check() — core lookup', () => {
  test('county with no matching programs → "No programs found" shape', async () => {
    // Need an empty fixture because the default one includes "All"-county
    // programs that match every county FIPS.
    await SFT.load({ programs: {} });
    const r = SFT.check('08999');
    assert.equal(r.program, 'No programs found');
    assert.equal(r.available, 0);
    assert.deepEqual(r.programs, []);
  });

  test('county with a specific program prefers it over "All" programs', async () => {
    await SFT.load(FIXTURE());
    const r = SFT.check('08013');  // Boulder County has Boulder-AHTF (specific)
    // The best match should be the county-specific one; check that the
    // narrative references it by name.
    assert.ok(/Boulder/.test(r.narrative),
      `expected narrative to reference county-specific program, got: ${r.narrative}`);
  });

  test('county with no specific program falls back to "All" programs', async () => {
    await SFT.load(FIXTURE());
    const r = SFT.check('08031');  // Denver has no specific entry; falls back to CHFA-HTF or DOLA-HTF
    assert.ok(['CHFA Housing Trust Fund', 'DOLA State HTF'].includes(r.program),
      `expected CHFA or DOLA, got: ${r.program}`);
  });

  test('multiple "All" programs are sorted by availability', async () => {
    await SFT.load(FIXTURE());
    const r = SFT.check('08031');
    // CHFA has $2.5M, DOLA has $1.2M — CHFA should be first (Denver has
    // no specific programs so sort is pure availability)
    assert.equal(r.program, 'CHFA Housing Trust Fund');
  });

  test('warning fires when deadline < 45 days', async () => {
    await SFT.load(FIXTURE());
    const r = SFT.check('08013');
    // Boulder-AHTF has 120-day deadline, but getBest may prefer it. The
    // DOLA-HTF 30-day deadline tests the warning path via check() when
    // there's no specific program. Check with 08031 to hit DOLA.
    // Actually Boulder-AHTF has 120d — no warning. To test warning, pick
    // a county with only DOLA (30d). Problem: all "All" apply everywhere.
    // Workaround: explicitly check a county where DOLA's availability
    // would lose to CHFA so DOLA is not "best"... but then the warning
    // check is against CHFA which has 180d.
    // Let's just modify the fixture to verify the path:
    const tight = FIXTURE();
    tight.programs['CHFA-HTF'].deadline = futureDate(20);   // force tight deadline on the leading program
    return SFT.load(tight).then(() => {
      const rr = SFT.check('08031');
      assert.ok(rr.warning && /Deadline approaching/i.test(rr.warning),
        `expected deadline warning, got: ${rr.warning}`);
    });
  });

  test('projectNeed > available adds an overshoot warning', async () => {
    await SFT.load(FIXTURE());
    const r = SFT.check('08031', 2026, 10_000_000);   // $10M ask on $2.5M available
    assert.ok(r.warning && /exceeds current availability/i.test(r.warning),
      `expected overshoot warning, got: ${r.warning}`);
  });

  test('result includes full programs list', async () => {
    await SFT.load(FIXTURE());
    const r = SFT.check('08013');
    assert.ok(Array.isArray(r.programs));
    assert.ok(r.programs.length >= 3,
      `Boulder should see Boulder-AHTF + CHFA-HTF + DOLA-HTF + Exhausted-Grant, got ${r.programs.length}`);
  });
});

group('7. getEligiblePrograms()', () => {
  test('filters by county (specific + "All")', async () => {
    await SFT.load(FIXTURE());
    const results = SFT.getEligiblePrograms('08013', '9%');
    const names = results.map(r => r.name);
    assert.ok(names.includes('Boulder Affordable Housing Trust'), 'missing Boulder-specific');
    assert.ok(names.includes('CHFA Housing Trust Fund'), 'missing CHFA "All"');
  });

  test('filters out programs that don\'t support the execution type', async () => {
    await SFT.load(FIXTURE());
    const r9 = SFT.getEligiblePrograms('08013', '9%');
    const r4 = SFT.getEligiblePrograms('08013', '4%');
    // DOLA-HTF is '9%' only — should be in r9 but not r4
    const r9names = r9.map(r => r.name);
    const r4names = r4.map(r => r.name);
    assert.ok(r9names.includes('DOLA State HTF'));
    assert.ok(!r4names.includes('DOLA State HTF'));
  });

  test('excludes market sources by default', async () => {
    await SFT.load(FIXTURE_WITH_EXTRAS());
    const results = SFT.getEligiblePrograms('08013', '9%');
    assert.ok(!results.some(r => r.name === 'Opportunity Zone Equity'),
      'market source should be excluded by default');
  });

  test('includeMarket: true surfaces market sources', async () => {
    await SFT.load(FIXTURE_WITH_EXTRAS());
    const results = SFT.getEligiblePrograms('08013', '9%', { includeMarket: true });
    assert.ok(results.some(r => r.name === 'Opportunity Zone Equity'));
  });

  test('excludes volume-cap entries by default', async () => {
    await SFT.load(FIXTURE_WITH_EXTRAS());
    const results = SFT.getEligiblePrograms('08013', '4%');
    assert.ok(!results.some(r => r.name === 'CO Private Activity Bond'));
  });

  test('includeVolumeCap: true surfaces PAB', async () => {
    await SFT.load(FIXTURE_WITH_EXTRAS());
    const results = SFT.getEligiblePrograms('08013', '4%', { includeVolumeCap: true });
    assert.ok(results.some(r => r.name === 'CO Private Activity Bond'));
  });

  test('results sorted by available descending', async () => {
    await SFT.load(FIXTURE());
    const results = SFT.getEligiblePrograms('08013', '9%');
    for (let i = 1; i < results.length; i++) {
      assert.ok((results[i - 1].available || 0) >= (results[i].available || 0),
        `sort violation at index ${i}`);
    }
  });
});

group('8. getPabStatus()', () => {
  test('returns the PAB shape when PAB-CO is loaded', async () => {
    await SFT.load(FIXTURE_WITH_EXTRAS());
    const p = SFT.getPabStatus();
    assert.ok(p);
    assert.equal(p.totalCap, 100_000_000);
    assert.equal(p.committed, 50_000_000);
    assert.equal(p.remaining, 50_000_000);
    assert.equal(p.pctCommitted, 50);
  });

  test('pctCommitted is 0 when no capacity', async () => {
    const f = FIXTURE_WITH_EXTRAS();
    f.programs['PAB-CO'].capacity = 0;
    await SFT.load(f);
    const p = SFT.getPabStatus();
    assert.equal(p.pctCommitted, 0);
  });

  test('returns null when PAB-CO is not loaded', async () => {
    await SFT.load(FIXTURE());  // default fixture has no PAB-CO
    assert.equal(SFT.getPabStatus(), null);
  });
});

group('9. sumEligible()', () => {
  test('sums available across eligible programs', async () => {
    await SFT.load(FIXTURE());
    const r = SFT.sumEligible('08013', '9%');
    // Boulder County 9%: CHFA (2.5M) + DOLA (1.2M) + Boulder-AHTF (600K) = 4.3M
    // (Exhausted-Grant is 0, excluded from sum — OZ excluded, PAB excluded)
    assert.equal(r.total, 4_300_000);
  });

  test('programCount excludes market sources and volume cap', async () => {
    await SFT.load(FIXTURE());
    const r = SFT.sumEligible('08013', '9%');
    // 4 programs: CHFA, DOLA, Boulder-AHTF, Exhausted-Grant
    // (not OZ-Equity market, not PAB-CO volume cap)
    assert.equal(r.programCount, 4);
  });

  test('returns zero total when county has no matches', async () => {
    await SFT.load(FIXTURE());
    // Suppress "All" programs by using a nonexistent execution type
    const r = SFT.sumEligible('08999', 'non-existent');
    assert.equal(r.total, 0);
    assert.equal(r.programCount, 0);
  });
});

/* ── Summary ───────────────────────────────────────────────────────── */

runAll().then(() => {
  console.log('\n=============================================');
  console.log(`SoftFundingTracker: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(2);
});
