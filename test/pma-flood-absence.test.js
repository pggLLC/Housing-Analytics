'use strict';

/**
 * A failed flood lookup must not produce a flood score.
 *
 * fetchFEMAFloodData returned hazardPercent: 0.05 at four separate sites when
 * it had no data. 0.05 is finite, so it survived every isFinite() check and
 * became floodScore 95/100 -- rendered as "Flood Risk 95/100 (FEMA NFHL)",
 * attributing a fabricated number to a named federal source.
 *
 * The scorecard's own stub detection compared against the magic value 0.05,
 * which failed in both directions: a genuine 5% reading was discarded as
 * missing, and any other fabricated default passed through as real.
 *
 * The same class of bug was fixed for floodRiskScore in the 2026-04-23 origin
 * audit (issue #712); this is the sibling field that was left behind.
 * Audit item 15 (P0).
 */

const assert = require('assert');
const path = require('path');
const PI = require(path.join(__dirname, '..', 'js', 'pma-infrastructure.js'));

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ✅ PASS: ' + msg); }
  else { failed++; console.log('  ❌ FAIL: ' + msg); }
}
const build = PI.buildInfrastructureScorecard;

console.log('[test] PMA flood: absence must not become a score');

// --- 1. Absent flood data yields no score at all. ---
{
  const sc = build({ floodZones: [], hazardPercent: null, _stub: true,
                     unavailableReason: 'FEMA down' }, {}, {}, {});
  check(sc.floodScore === null, 'floodScore is null when the lookup failed (got ' + sc.floodScore + ')');
  check(sc.floodRiskPercent === null, 'floodRiskPercent is null, not 0.05 (got ' + sc.floodRiskPercent + ')');
  check(sc.floodUnavailableReason === 'FEMA down', 'the reason is carried through for display');
  check(sc._dataAvailability.stubSources.indexOf('flood') !== -1, 'flood is counted as a stub source');
  check(sc._dataAvailability.realSources.indexOf('flood') === -1, 'flood is NOT counted as real');
  check(sc.flags.highFloodRisk === null, 'highFloodRisk is null, not false — unknown is not "safe"');
}

// --- 2. The old fabricated default, if it ever returns, is still absence. ---
{
  const sc = build({ floodZones: [], hazardPercent: null, _stub: true }, {}, {}, {});
  check(sc.floodScore !== 95, 'a failed lookup never yields the old 95/100');
  check(typeof sc.floodUnavailableReason === 'string' && sc.floodUnavailableReason.length > 10,
    'a default reason is supplied when the caller gave none');
}

// --- 3. A genuine 5% reading is REAL data and must survive. ---
//     The old magic-number test threw this away.
{
  const sc = build({ floodZones: [{ id: 1 }], hazardPercent: 0.05 }, {}, {}, {});
  check(sc.floodRiskPercent === 0.05, 'a real 0.05 reading is preserved (got ' + sc.floodRiskPercent + ')');
  check(sc.floodScore === 95, 'a real 0.05 reading scores 95 (got ' + sc.floodScore + ')');
  check(sc._dataAvailability.realSources.indexOf('flood') !== -1,
    'a real 0.05 reading counts as REAL, not stub — the old test discarded it');
  check(sc.floodUnavailableReason === null, 'no unavailable reason on real data');
}

// --- 4. Real data with no floodZones array is still real. ---
//     floodZones.length was previously part of the stub test, so a valid
//     hazardPercent derived from FemaFlood (which returns no zones) was
//     misclassified.
{
  const sc = build({ floodZones: [], hazardPercent: 0.42 }, {}, {}, {});
  check(sc.floodRiskPercent === 0.42, 'hazardPercent without zones is still real');
  check(sc.flags.highFloodRisk === true, 'a 42% hazard trips the high-risk flag');
}

// --- 5. Absence must not drag the composite. ---
{
  const withFlood = build({ floodZones: [], hazardPercent: 0.0 }, {}, { sewerHeadroom: 0.8, waterCapacity: 0.8 }, {});
  const noFlood   = build({ floodZones: [], hazardPercent: null, _stub: true }, {}, { sewerHeadroom: 0.8, waterCapacity: 0.8 }, {});
  check(noFlood.compositeScore !== null, 'composite still computes from the dimensions that do have data');
  check(noFlood._dataAvailability.coverageRatio < withFlood._dataAvailability.coverageRatio,
    'coverage ratio drops when flood is unavailable, disclosing the gap');
}

// --- 6. No fabricated default remains in the source. ---
{
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'pma-infrastructure.js'), 'utf8');
  const dss = fs.readFileSync(path.join(__dirname, '..', 'js', 'data-service-portable.js'), 'utf8');
  check(!/hazardPercent:\s*0\.05/.test(src), 'pma-infrastructure.js has no hazardPercent: 0.05');
  check(!/hazardPercent:\s*0\.05/.test(dss), 'data-service-portable.js has no hazardPercent: 0.05');
  check(!/hazardPercent === 0\.05/.test(src), 'stub detection no longer compares against a magic value');
}

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
