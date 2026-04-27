// test/unit/site-selection-score.test.js
//
// Unit tests for js/market-analysis/site-selection-score.js
//
// Verifies:
//   1. Public API is fully exposed on window.
//   2. Component weights sum to 1.0.
//   3. scoreDemand — null/missing input returns { score: null, unavailable: true }.
//   4. scoreDemand — high cost burden, renter share, poverty yields high score.
//   5. scoreDemand — all-zero inputs yield 0.
//   6. scoreSubsidy — QCT flag awards 30 pts without basis_boost_eligible.
//   7. scoreSubsidy — DDA flag awards 20 pts without basis_boost_eligible.
//   8. scoreSubsidy — basis_boost_eligible awards unified 40 pts regardless of flags.
//   9. scoreSubsidy — high FMR ratio contributes pts.
//  10. scoreSubsidy — fewer nearby subsidized units increase score.
//  11. scoreFeasibility — zero flood risk, max soil, no cleanup = high score.
//  12. scoreFeasibility — high flood risk drives score down.
//  13. scoreFeasibility — cleanupFlag deducts 10 pts.
//  14. scoreAccess — all amenities close scores near 100.
//  15. scoreAccess — all amenities far scores 0.
//  16. scoreAccess — null input returns { score: null, unavailable: true }.
//  17. scorePolicy — public ownership adds 30 pts.
//  18. scorePolicy — overlayCount contributes up to 20 pts.
//  19. scoreMarket — all drivers at ceiling = 100.
//  20. scoreMarket — all drivers at 0 = 0.
//  21. computeScore — output has all required fields.
//  22. computeScore — final_score is within [0, 100].
//  23. computeScore — opportunity_band matches final_score tier.
//  24. computeScore — narrative is a non-empty string referencing score.
//  25. computeScore — unavailable demand/access redistributes weight (no fabricated 50).
//  26. computeScore — unavailableDimensions array surfaces missing inputs.
//
// Usage: node test/unit/site-selection-score.test.js

'use strict';

const path = require('path');

// site-selection-score.js exposes window.SiteSelectionScore
global.window   = global;
global.MAUtils  = null; // no external MAUtils dependency — falls back to internal _band()

require(path.join(__dirname, '../../js/market-analysis/site-selection-score.js'));
const SSS = global.SiteSelectionScore;

let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}

function test(name, fn) {
  console.log('\n[test]', name);
  try { fn(); }
  catch (e) { console.error('  ❌ FAIL: threw —', e.message); failed++; }
}

// ---------------------------------------------------------------------------
// 1. API exposure
// ---------------------------------------------------------------------------

test('SiteSelectionScore API fully exposed on window', function () {
  assert(typeof SSS                  === 'object',   'SiteSelectionScore is an object');
  assert(typeof SSS.COMPONENT_WEIGHTS === 'object',  'COMPONENT_WEIGHTS exposed');
  assert(typeof SSS.scoreDemand      === 'function', 'scoreDemand exported');
  assert(typeof SSS.scoreSubsidy     === 'function', 'scoreSubsidy exported');
  assert(typeof SSS.scoreFeasibility === 'function', 'scoreFeasibility exported');
  assert(typeof SSS.scoreAccess      === 'function', 'scoreAccess exported');
  assert(typeof SSS.scorePolicy      === 'function', 'scorePolicy exported');
  assert(typeof SSS.scoreMarket      === 'function', 'scoreMarket exported');
  assert(typeof SSS.computeScore     === 'function', 'computeScore exported');
});

// ---------------------------------------------------------------------------
// 2. Component weights sum to 1.0
// ---------------------------------------------------------------------------

test('COMPONENT_WEIGHTS sum to exactly 1.0', function () {
  const W = SSS.COMPONENT_WEIGHTS;
  const sum = Object.values(W).reduce(function (a, b) { return a + b; }, 0);
  // Floating-point comparison with tolerance
  assert(Math.abs(sum - 1.0) < 1e-9, 'weights sum to 1.0 (got ' + sum + ')');
  assert(W.demand      === 0.25, 'demand weight = 0.25');
  assert(W.subsidy     === 0.20, 'subsidy weight = 0.20');
  assert(W.feasibility === 0.15, 'feasibility weight = 0.15');
  assert(W.access      === 0.15, 'access weight = 0.15');
  assert(W.policy      === 0.15, 'policy weight = 0.15');
  assert(W.market      === 0.10, 'market weight = 0.10');
});

// ---------------------------------------------------------------------------
// 3. scoreDemand — null/missing input signals unavailability (no fabricated 50)
// ---------------------------------------------------------------------------

test('scoreDemand returns { score:null, unavailable:true } for missing input', function () {
  const nullResult = SSS.scoreDemand(null);
  assert(nullResult && typeof nullResult === 'object',      'null → object');
  assert(nullResult.score === null,                         'null → score === null');
  assert(nullResult.unavailable === true,                   'null → unavailable === true');
  assert(typeof nullResult.reason === 'string',             'null → reason string present');

  const undefResult = SSS.scoreDemand(undefined);
  assert(undefResult.score === null && undefResult.unavailable === true,
    'undefined → { score:null, unavailable:true }');

  const strResult = SSS.scoreDemand('string');
  assert(strResult.score === null && strResult.unavailable === true,
    'string → { score:null, unavailable:true }');
});

// ---------------------------------------------------------------------------
// 4. scoreDemand — high stress inputs
// ---------------------------------------------------------------------------

test('scoreDemand returns high score for high cost burden / renter share / poverty', function () {
  const result = SSS.scoreDemand({
    cost_burden_rate: 0.55, // above 0.45 ceiling
    renter_share:     0.70, // above 0.60 ceiling
    poverty_rate:     0.25, // above 0.20 ceiling
  });
  // Expected: cbPts=50 + rsPts=30 + povPts=20 = 100 (clamped)
  assert(result.unavailable === false, 'with data → unavailable === false');
  assert(result.score === 100, 'max stress inputs → 100 (got ' + result.score + ')');
});

// ---------------------------------------------------------------------------
// 5. scoreDemand — all-zero inputs
// ---------------------------------------------------------------------------

test('scoreDemand returns 0 for all-zero ACS fields', function () {
  const result = SSS.scoreDemand({ cost_burden_rate: 0, renter_share: 0, poverty_rate: 0 });
  assert(result.unavailable === false, 'zeros → unavailable === false');
  assert(result.score === 0, 'all zeros → 0 (got ' + result.score + ')');
});

// ── 4-factor scoring (when severe_burden_rate present) ────────────────

test('scoreDemand uses 4-factor scoring when severe_burden_rate is present', function () {
  // Same 3 inputs as Test 4 + max severe burden → still 100 (all ceilings met)
  const result = SSS.scoreDemand({
    cost_burden_rate:   0.55,
    renter_share:       0.70,
    poverty_rate:       0.25,
    severe_burden_rate: 0.30,  // above 0.25 ceiling
  });
  assert(result.score === 100, 'all 4 ceilings → 100 (got ' + result.score + ')');
});

test('scoreDemand 4-factor: severe burden boosts score over 3-factor case', function () {
  const baseInputs = {
    cost_burden_rate: 0.30,  // mid
    renter_share:     0.35,  // mid
    poverty_rate:     0.10,  // mid
  };
  const without = SSS.scoreDemand(baseInputs);
  const with10  = SSS.scoreDemand(Object.assign({}, baseInputs, { severe_burden_rate: 0.10 }));
  const with20  = SSS.scoreDemand(Object.assign({}, baseInputs, { severe_burden_rate: 0.20 }));
  // The 3-factor and 4-factor weightings differ so the no-severe vs has-severe
  // scores aren't directly comparable, but: more severe burden should always
  // produce a higher 4-factor score than less severe burden.
  assert(with20.score > with10.score,
    'higher severe burden → higher demand score (with10=' + with10.score + ', with20=' + with20.score + ')');
  assert(without.unavailable === false,             'without severe → still scored (3-factor fallback)');
  assert(typeof without.score === 'number',         '3-factor returns numeric score');
});

test('scoreDemand: severe_burden_rate=0 explicitly uses 4-factor (not falls back to 3-factor)', function () {
  // When severe_burden_rate is present but zero, the 4-factor path runs
  // and contributes 0 pts from that component. NOT the same as omitting
  // the field (which falls back to 3-factor).
  const explicit = SSS.scoreDemand({
    cost_burden_rate:   0.45, renter_share: 0.60, poverty_rate: 0.20,
    severe_burden_rate: 0,
  });
  // 4-factor max for the first 3 components: 40+25+15=80 (severe contributes 0)
  assert(explicit.score === 80,
    'explicit severe=0 → 4-factor max minus severe (80, got ' + explicit.score + ')');
});

test('scoreDemand: null/undefined/NaN severe_burden_rate falls back to 3-factor', function () {
  const baseInputs = {
    cost_burden_rate: 0.45, renter_share: 0.60, poverty_rate: 0.20,
  };
  const noField = SSS.scoreDemand(baseInputs);
  // 3-factor max: 50+30+20=100
  assert(noField.score === 100,
    'no severe field → 3-factor max=100 (got ' + noField.score + ')');

  const nullField = SSS.scoreDemand(Object.assign({}, baseInputs, { severe_burden_rate: null }));
  assert(nullField.score === 100, 'null severe → 3-factor (got ' + nullField.score + ')');

  const undefField = SSS.scoreDemand(Object.assign({}, baseInputs, { severe_burden_rate: undefined }));
  assert(undefField.score === 100, 'undefined severe → 3-factor (got ' + undefField.score + ')');

  const nanField = SSS.scoreDemand(Object.assign({}, baseInputs, { severe_burden_rate: NaN }));
  assert(nanField.score === 100, 'NaN severe → 3-factor (got ' + nanField.score + ')');
});

// ---------------------------------------------------------------------------
// 6. scoreSubsidy — QCT flag
// ---------------------------------------------------------------------------

test('scoreSubsidy awards 30 pts for QCT flag (no basis_boost_eligible)', function () {
  // Only QCT, neutral FMR ratio, no nearby subsidized units
  const scoreQct = SSS.scoreSubsidy(true,  false, 1.0, 100);
  const scoreNone = SSS.scoreSubsidy(false, false, 1.0, 100);
  assert(Math.round(scoreQct - scoreNone) === 30, 'QCT adds 30 pts (got diff: ' + (scoreQct - scoreNone) + ')');
});

// ---------------------------------------------------------------------------
// 7. scoreSubsidy — DDA flag
// ---------------------------------------------------------------------------

test('scoreSubsidy awards 20 pts for DDA flag (no basis_boost_eligible)', function () {
  const scoreDda  = SSS.scoreSubsidy(false, true,  1.0, 100);
  const scoreNone = SSS.scoreSubsidy(false, false, 1.0, 100);
  assert(Math.round(scoreDda - scoreNone) === 20, 'DDA adds 20 pts (got diff: ' + (scoreDda - scoreNone) + ')');
});

// ---------------------------------------------------------------------------
// 8. scoreSubsidy — basis_boost_eligible unified bonus
// ---------------------------------------------------------------------------

test('scoreSubsidy awards unified 40 pts when basis_boost_eligible', function () {
  // With basis_boost_eligible true, QCT/DDA flags are ignored
  const scoreBoost    = SSS.scoreSubsidy(false, false, 1.0, 100, true);
  const scoreNoBoost  = SSS.scoreSubsidy(false, false, 1.0, 100, false);
  assert(scoreBoost - scoreNoBoost === 40, 'basis_boost_eligible adds 40 pts (got diff: ' + (scoreBoost - scoreNoBoost) + ')');

  // QCT+DDA together (fallback branch) should award 30+20=50 pts
  const scoreQctDda = SSS.scoreSubsidy(true, true, 1.0, 100, false);
  assert(scoreQctDda - scoreNoBoost === 50, 'QCT+DDA both adds 50 pts in fallback branch');

  // basis_boost_eligible wins over QCT+DDA combination (gives 40 not 50)
  const scoreBoostWithFlags = SSS.scoreSubsidy(true, true, 1.0, 100, true);
  assert(scoreBoostWithFlags - scoreNoBoost === 40, 'basis_boost_eligible caps at 40 even with both flags');
});

// ---------------------------------------------------------------------------
// 9. scoreSubsidy — FMR ratio contribution
// ---------------------------------------------------------------------------

test('scoreSubsidy — high FMR ratio (>1.20) contributes 30 pts', function () {
  const highFmr = SSS.scoreSubsidy(false, false, 1.25, 100, false);
  const lowFmr  = SSS.scoreSubsidy(false, false, 0.75, 100, false);
  assert(highFmr > lowFmr, 'high FMR ratio scores higher than low ratio (' + highFmr + ' > ' + lowFmr + ')');
  // At fmrRatio=1.20 the full 30 pts should apply
  const maxFmr  = SSS.scoreSubsidy(false, false, 1.20, 100, false);
  const zeroFmr = SSS.scoreSubsidy(false, false, 0.80, 100, false);
  assert(Math.round(maxFmr - zeroFmr) === 30, 'FMR range 0.80→1.20 covers 30 pts');
});

// ---------------------------------------------------------------------------
// 10. scoreSubsidy — nearby subsidized units
// ---------------------------------------------------------------------------

test('scoreSubsidy scores higher with fewer nearby subsidized units', function () {
  const fewNearby  = SSS.scoreSubsidy(false, false, 1.0, 0,   false);
  const manyNearby = SSS.scoreSubsidy(false, false, 1.0, 200, false);
  assert(fewNearby > manyNearby, 'fewer nearby subsidized units → higher score');
  // At nearbySubsidized=0, max 20 pts; at 200, 0 pts
  assert(Math.round(fewNearby - manyNearby) === 20, 'full 20 pts range for 0 vs 200 nearby units');
});

// ---------------------------------------------------------------------------
// 11. scoreFeasibility — ideal site
// ---------------------------------------------------------------------------

test('scoreFeasibility returns near-maximum for ideal site', function () {
  // floodRisk=0, soilScore=100, cleanupFlag=false
  const score = SSS.scoreFeasibility(0, 100, false);
  // Expected: floodPts=60, soilPts=30, no penalty → 90
  assert(score === 90, 'ideal site scores 90 (got ' + score + ')');
});

// ---------------------------------------------------------------------------
// 12. scoreFeasibility — high flood risk
// ---------------------------------------------------------------------------

test('scoreFeasibility penalizes flood risk (level 3 = worst)', function () {
  const noFlood  = SSS.scoreFeasibility(0, 50, false);
  const maxFlood = SSS.scoreFeasibility(3, 50, false);
  assert(maxFlood < noFlood, 'floodRisk=3 scores lower than floodRisk=0');
  // floodPts at level 3 = max(0, 60 - 3*20) = 0
  const delta = noFlood - maxFlood;
  assert(delta === 60, 'flood level 3 removes exactly 60 pts from the floor component');
});

// ---------------------------------------------------------------------------
// 13. scoreFeasibility — cleanupFlag deduction
// ---------------------------------------------------------------------------

test('scoreFeasibility deducts 10 pts for cleanupFlag=true', function () {
  const clean   = SSS.scoreFeasibility(0, 100, false);
  const cleanup = SSS.scoreFeasibility(0, 100, true);
  assert(clean - cleanup === 10, 'cleanupFlag deducts 10 pts (got diff: ' + (clean - cleanup) + ')');
});

// ---------------------------------------------------------------------------
// 14. scoreAccess — all amenities close
// ---------------------------------------------------------------------------

test('scoreAccess returns 100 when all amenities are at or below near threshold', function () {
  const result = SSS.scoreAccess({
    grocery:    0.3,  // ≤0.5
    transit:    0.2,  // ≤0.25
    parks:      0.2,  // ≤0.25
    healthcare: 0.9,  // ≤1.0
    schools:    0.4,  // ≤0.5
  });
  assert(result.unavailable === false, 'with data → unavailable === false');
  assert(result.score === 100, 'all close amenities → 100 (got ' + result.score + ')');
});

// ---------------------------------------------------------------------------
// 15. scoreAccess — all amenities far
// ---------------------------------------------------------------------------

test('scoreAccess returns 0 when all amenities exceed far threshold', function () {
  const result = SSS.scoreAccess({
    grocery:    5.0,
    transit:    5.0,
    parks:      5.0,
    healthcare: 5.0,
    schools:    5.0,
  });
  assert(result.unavailable === false, 'far amenities → unavailable === false');
  assert(result.score === 0, 'all far amenities → 0 (got ' + result.score + ')');
});

// ---------------------------------------------------------------------------
// 16. scoreAccess — null input signals unavailability (no fabricated 50)
// ---------------------------------------------------------------------------

test('scoreAccess returns { score:null, unavailable:true } for missing input', function () {
  const nullResult = SSS.scoreAccess(null);
  assert(nullResult && typeof nullResult === 'object', 'null → object');
  assert(nullResult.score === null,                    'null → score === null');
  assert(nullResult.unavailable === true,              'null → unavailable === true');

  const undefResult = SSS.scoreAccess();
  assert(undefResult.score === null && undefResult.unavailable === true,
    'undefined → { score:null, unavailable:true }');
});

// ---------------------------------------------------------------------------
// 17. scorePolicy — public ownership bonus
// ---------------------------------------------------------------------------

test('scorePolicy awards 30 pts for public ownership', function () {
  const pub  = SSS.scorePolicy(0, true,  0);
  const priv = SSS.scorePolicy(0, false, 0);
  assert(pub - priv === 30, 'publicOwnership adds 30 pts (got diff: ' + (pub - priv) + ')');
});

// ---------------------------------------------------------------------------
// 18. scorePolicy — overlay count capped at 4
// ---------------------------------------------------------------------------

test('scorePolicy overlayCount contributes up to 20 pts (cap at 4)', function () {
  const four    = SSS.scorePolicy(0, false, 4);
  const many    = SSS.scorePolicy(0, false, 10);
  const none    = SSS.scorePolicy(0, false, 0);
  assert(four   - none === 20, '4 overlays → +20 pts');
  assert(many   - none === 20, '10 overlays also → +20 pts (capped at 4×5)');
});

// ---------------------------------------------------------------------------
// 19. scoreMarket — all drivers at ceiling
// ---------------------------------------------------------------------------

test('scoreMarket returns 100 when all drivers at ceiling', function () {
  // rentTrend=0.05+, jobTrend=0.03+, concentration=0 (competitive), serviceStrength=0.30+
  const score = SSS.scoreMarket(0.10, 0.05, 0.0, 0.50);
  assert(score === 100, 'all drivers at ceiling → 100 (got ' + score + ')');
});

// ---------------------------------------------------------------------------
// 20. scoreMarket — all drivers at 0
// ---------------------------------------------------------------------------

test('scoreMarket returns 0 when all drivers are 0', function () {
  const score = SSS.scoreMarket(0, 0, 1.0, 0);
  assert(score === 0, 'all zero drivers → 0 (got ' + score + ')');
});

// ---------------------------------------------------------------------------
// 21. computeScore — required output fields
// ---------------------------------------------------------------------------

test('computeScore returns all required fields', function () {
  const result = SSS.computeScore({
    acs:             { cost_burden_rate: 0.35, renter_share: 0.45, poverty_rate: 0.15 },
    qctFlag:         true,
    ddaFlag:         false,
    fmrRatio:        1.10,
    nearbySubsidized: 50,
    floodRisk:       1,
    soilScore:       70,
    cleanupFlag:     false,
    amenities:       { grocery: 0.8, transit: 0.5, parks: 0.5, healthcare: 2.0, schools: 1.0 },
    zoningCapacity:  100,
    publicOwnership: false,
    overlayCount:    2,
    rentTrend:       0.04,
    jobTrend:        0.02,
    concentration:   0.3,
    serviceStrength: 0.25,
  });

  const required = [
    'demand_score', 'subsidy_score', 'feasibility_score', 'access_score',
    'policy_score', 'market_score', 'final_score', 'opportunity_band',
    'component_weights', 'narrative',
  ];
  required.forEach(function (field) {
    assert(Object.prototype.hasOwnProperty.call(result, field),
      'output has field: ' + field);
  });
});

// ---------------------------------------------------------------------------
// 22. computeScore — final_score within [0, 100]
// ---------------------------------------------------------------------------

test('computeScore final_score is always in [0, 100]', function () {
  // Worst-case inputs
  const worst = SSS.computeScore({
    acs: { cost_burden_rate: 0, renter_share: 0, poverty_rate: 0 },
    qctFlag: false, ddaFlag: false, fmrRatio: 0.5, nearbySubsidized: 999,
    floodRisk: 3, soilScore: 0, cleanupFlag: true,
    amenities: { grocery: 99, transit: 99, parks: 99, healthcare: 99, schools: 99 },
    zoningCapacity: 0, publicOwnership: false, overlayCount: 0,
    rentTrend: 0, jobTrend: 0, concentration: 1.0, serviceStrength: 0,
  });
  assert(worst.final_score >= 0,   'worst case final_score >= 0 (got ' + worst.final_score + ')');

  // Best-case inputs
  const best = SSS.computeScore({
    acs: { cost_burden_rate: 0.55, renter_share: 0.70, poverty_rate: 0.25 },
    qctFlag: true, ddaFlag: true, fmrRatio: 1.5, nearbySubsidized: 0,
    floodRisk: 0, soilScore: 100, cleanupFlag: false,
    amenities: { grocery: 0.1, transit: 0.1, parks: 0.1, healthcare: 0.5, schools: 0.3 },
    zoningCapacity: 200, publicOwnership: true, overlayCount: 10,
    rentTrend: 0.10, jobTrend: 0.05, concentration: 0.0, serviceStrength: 0.50,
  });
  assert(best.final_score <= 100, 'best case final_score <= 100 (got ' + best.final_score + ')');
  assert(best.final_score > worst.final_score, 'best > worst score');
});

// ---------------------------------------------------------------------------
// 23. computeScore — opportunity_band matches tier
// ---------------------------------------------------------------------------

test('computeScore opportunity_band matches final_score tier', function () {
  // High score (≥70) → 'High'
  const highResult = SSS.computeScore({
    acs: { cost_burden_rate: 0.55, renter_share: 0.70, poverty_rate: 0.25 },
    qctFlag: true, ddaFlag: true, fmrRatio: 1.5, nearbySubsidized: 0,
    floodRisk: 0, soilScore: 100, cleanupFlag: false,
    amenities: { grocery: 0.1, transit: 0.1, parks: 0.1, healthcare: 0.5, schools: 0.3 },
    zoningCapacity: 200, publicOwnership: true, overlayCount: 10,
    rentTrend: 0.10, jobTrend: 0.05, concentration: 0.0, serviceStrength: 0.50,
  });
  if (highResult.final_score >= 70) {
    assert(highResult.opportunity_band === 'High', 'score ≥70 → "High" band');
  }

  // Low score (<45) → 'Lower'
  const lowResult = SSS.computeScore({
    acs: { cost_burden_rate: 0, renter_share: 0, poverty_rate: 0 },
    qctFlag: false, ddaFlag: false, fmrRatio: 0.5, nearbySubsidized: 999,
    floodRisk: 3, soilScore: 0, cleanupFlag: true,
    amenities: { grocery: 99, transit: 99, parks: 99, healthcare: 99, schools: 99 },
    zoningCapacity: 0, publicOwnership: false, overlayCount: 0,
    rentTrend: 0, jobTrend: 0, concentration: 1.0, serviceStrength: 0,
  });
  if (lowResult.final_score < 45) {
    assert(lowResult.opportunity_band === 'Lower', 'score <45 → "Lower" band');
  }
});

// ---------------------------------------------------------------------------
// 24. computeScore — narrative mentions score
// ---------------------------------------------------------------------------

test('computeScore narrative is non-empty and references the score', function () {
  const result = SSS.computeScore({
    acs: { cost_burden_rate: 0.30, renter_share: 0.40, poverty_rate: 0.10 },
    qctFlag: false, ddaFlag: false, fmrRatio: 1.05, nearbySubsidized: 80,
    floodRisk: 1, soilScore: 60, cleanupFlag: false,
    amenities: { grocery: 1.0, transit: 0.5, parks: 0.8, healthcare: 2.0, schools: 1.2 },
    zoningCapacity: 80, publicOwnership: false, overlayCount: 1,
    rentTrend: 0.03, jobTrend: 0.02, concentration: 0.4, serviceStrength: 0.20,
  });
  assert(typeof result.narrative === 'string' && result.narrative.length > 0,
    'narrative is a non-empty string');
  assert(result.narrative.includes(String(result.final_score)),
    'narrative references the final score');
  assert(result.narrative.includes(result.opportunity_band),
    'narrative references the opportunity band');
});

// ---------------------------------------------------------------------------
// 25. computeScore — unavailable demand/access redistributes weight
// ---------------------------------------------------------------------------

test('computeScore redistributes weight when demand+access unavailable (no fabricated 50)', function () {
  // Same site with and without ACS + amenities. Composite should be
  // computed from ONLY the available dimensions — no neutral 50
  // silently averaged in.
  const baseInputs = {
    qctFlag: true, ddaFlag: true, fmrRatio: 1.2, nearbySubsidized: 50,
    floodRisk: 0, soilScore: 80, cleanupFlag: false,
    zoningCapacity: 120, publicOwnership: true, overlayCount: 3,
    rentTrend: 0.05, jobTrend: 0.03, concentration: 0.2, serviceStrength: 0.30,
  };

  const allAvail = SSS.computeScore(Object.assign({}, baseInputs, {
    acs: { cost_burden_rate: 0.30, renter_share: 0.40, poverty_rate: 0.10 },
    amenities: { grocery: 1.0, transit: 0.5, parks: 0.5, healthcare: 2.0, schools: 1.0 },
  }));

  const demandMissing = SSS.computeScore(Object.assign({}, baseInputs, {
    amenities: { grocery: 1.0, transit: 0.5, parks: 0.5, healthcare: 2.0, schools: 1.0 },
    // no acs
  }));

  const bothMissing = SSS.computeScore(baseInputs);
  // (no acs, no amenities)

  assert(allAvail.dimensionsAvailable === 6, 'all 6 dims available when inputs complete');
  assert(demandMissing.dimensionsAvailable === 5, 'demand missing → 5 dims available');
  assert(demandMissing.dimensionsUnavailable === 1, 'demand missing → 1 unavailable');
  assert(demandMissing.unavailableDimensions.indexOf('demand') >= 0,
    'unavailableDimensions lists demand');
  assert(demandMissing.demand_score === null, 'demand_score is null when ACS missing');
  assert(typeof demandMissing.final_score === 'number' && demandMissing.final_score >= 0,
    'final_score is still a valid number when a dim is unavailable');

  assert(bothMissing.dimensionsAvailable === 4, 'both missing → 4 dims');
  assert(bothMissing.demand_score === null && bothMissing.access_score === null,
    'both null when both inputs missing');
  assert(bothMissing.unavailableDimensions.length === 2,
    'unavailableDimensions lists both');
});

// ---------------------------------------------------------------------------
// 26. computeScore — narrative discloses unavailable dimensions
// ---------------------------------------------------------------------------

test('computeScore narrative mentions unavailable dimensions when present', function () {
  const result = SSS.computeScore({
    qctFlag: true, ddaFlag: false, fmrRatio: 1.0, nearbySubsidized: 50,
    floodRisk: 0, soilScore: 70, cleanupFlag: false,
    zoningCapacity: 100, publicOwnership: false, overlayCount: 1,
    rentTrend: 0.02, jobTrend: 0.02, concentration: 0.4, serviceStrength: 0.25,
    // no acs, no amenities
  });
  assert(result.unavailableDimensions.length === 2, 'two dims unavailable');
  assert(result.narrative.indexOf('demand') >= 0,
    'narrative references missing demand dimension');
  assert(result.narrative.indexOf('access') >= 0,
    'narrative references missing access dimension');
  assert(result.narrative.indexOf('4 of 6') >= 0,
    'narrative says "scored on 4 of 6 dimensions"');
});

// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(60));
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) process.exitCode = 1;
