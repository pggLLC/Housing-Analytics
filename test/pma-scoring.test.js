// test/pma-scoring.test.js
//
// Unit tests for PMA scoring helpers shared by js/market-analysis.js.
//
// Usage:
//   node test/pma-scoring.test.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Scoring = require('../js/market-analysis-scoring.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function assertClose(actual, expected, tolerance, message) {
  assert(Math.abs(actual - expected) <= tolerance,
    `${message} (got ${actual}, expected ${expected} ±${tolerance})`);
}

test('PROV-1 does not modify PMA scoring constants/helper', () => {
  const scoringPath = path.resolve(__dirname, '..', 'js', 'market-analysis-scoring.js');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(scoringPath)).digest('hex');
  assert(hash === '17a4388a411e4c08c6a25765cb757661e9d34d9da6f820a21019ea11acf5e701',
    'js/market-analysis-scoring.js remains byte-identical for provenance-only work');
});

function test(name, fn) {
  console.log(`\n[test] ${name}`);
  try {
    fn();
  } catch (err) {
    console.error(`  ❌ FAIL: threw unexpected error — ${err.message}`);
    failed++;
  }
}

const SAMPLE_ACS = {
  pop: 50000,
  renter_hh: 8000,
  total_hh: 20000,
  vacant: 600,
  median_gross_rent: 1200,
  median_hh_income: 55000,
  cost_burden_rate: 0.38,
  severe_cost_burden_rate: 0.16,
  poverty_rate: 0.12,
  vacancy_rate: 0.03,
  // #1163 — rental-vacancy fields so composition tests exercise the
  // preferred (rental) scoring path, matching regenerated tract data.
  vacant_for_rent: 330,
  rented_not_occupied: 20,
  rental_vacancy_rate: 0.04,
  tract_count: 12,
};

function computePmaFromSharedHelpers(acs, existingLihtcUnits, proposedUnits, countyAmi) {
  const demandScore = Scoring.scoreDemand(acs);
  const captureObj = Scoring.scoreCaptureRisk(acs, existingLihtcUnits, proposedUnits);
  const rentPressureObj = Scoring.scoreRentPressure(acs, countyAmi);
  const marketTightnessScore = Scoring.scoreMarketTightness(acs);
  const workforceScore = 60;

  const overall = Math.round(
    demandScore * Scoring.WEIGHTS.demand +
    captureObj.score * Scoring.WEIGHTS.captureRisk +
    rentPressureObj.score * Scoring.WEIGHTS.rentPressure +
    marketTightnessScore * Scoring.WEIGHTS.landSupply +
    workforceScore * Scoring.WEIGHTS.workforce
  );

  return {
    overall,
    demand: demandScore,
    captureRisk: captureObj.score,
    rentPressure: rentPressureObj.score,
    marketTightness: marketTightnessScore,
    workforce: workforceScore,
    captureRate: captureObj.capture,
    rentRatio: rentPressureObj.ratio,
  };
}

test('market-analysis.js source file exists and delegates to shared scoring helpers', () => {
  const srcPath = path.resolve(__dirname, '..', 'js', 'market-analysis.js');
  const helperPath = path.resolve(__dirname, '..', 'js', 'market-analysis-scoring.js');
  assert(fs.existsSync(srcPath), 'js/market-analysis.js exists');
  assert(fs.existsSync(helperPath), 'js/market-analysis-scoring.js exists');
  const content = fs.readFileSync(srcPath, 'utf8');
  assert(content.includes('PMAMarketScoring'), 'market-analysis.js reads window.PMAMarketScoring');
  assert(content.includes('PMAScoring.scoreCaptureRisk'), 'scoreCaptureRisk delegates to shared helper');
  assert(content.includes('PMAScoring.chasLihtcEligibleRenters'), 'CHAS LIHTC denominator delegates to shared helper');
  assert(content.includes('PMAScoring.scoreRentPressure'), 'scoreRentPressure delegates to shared helper');
  assert(content.includes('PMAScoring.scoreMarketTightness'), 'scoreMarketTightness delegates to shared helper');
  assert(content.includes('lihtcLoadError'), 'source contains lihtcLoadError flag');
  assert(content.includes('LIHTC data is unavailable'), 'source contains guard-clause error message');
});

test('market-analysis.html loads shared scoring helper before market-analysis.js', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'market-analysis.html'), 'utf8');
  const helperIdx = html.indexOf('js/market-analysis-scoring.js');
  const marketIdx = html.indexOf('js/market-analysis.js');
  assert(helperIdx !== -1, 'market-analysis-scoring.js is loaded');
  assert(marketIdx !== -1, 'market-analysis.js is loaded');
  assert(helperIdx < marketIdx, 'shared scoring helper loads before market-analysis.js');
});

test('PMA weights sum to 1.0', () => {
  const total = Object.values(Scoring.WEIGHTS).reduce((s, w) => s + w, 0);
  assert(Math.abs(total - 1.0) < 1e-9, `WEIGHTS sum to 1.0 (got ${total})`);
});

test('shared scoring helper exports real scoring functions', () => {
  [
    'scoreDemand',
    'scoreCaptureRisk',
    'chasLihtcEligibleRenters',
    'scoreRentPressure',
    'scoreMarketTightness',
    'scoreTier',
  ].forEach((name) => {
    assert(typeof Scoring[name] === 'function', `${name} is exported`);
  });
});

function chasCounty(tiers) {
  return {
    renter_hh_by_ami: {
      lte30: { total: tiers.lte30 },
      '31to50': { total: tiers['31to50'] },
      '51to80': { total: tiers['51to80'] },
      '81to100': { total: tiers['81to100'] },
      '100plus': { total: tiers['100plus'] },
    },
  };
}

test('chasLihtcEligibleRenters scales one-county CHAS tiers to buffer renters', () => {
  const result = Scoring.chasLihtcEligibleRenters({
    '08031': chasCounty({
      lte30: 2500,
      '31to50': 2500,
      '51to80': 2500,
      '81to100': 1250,
      '100plus': 1250,
    }),
  }, [
    { geoid: '08031000100', _bufferShare: 0.5 },
    { geoid: '08031000200', _bufferShare: 0.5 },
  ], {
    '08031000100': { renter_hh: 1000 },
    '08031000200': { renter_hh: 1000 },
  });

  assert(result.source === 'chas', 'scaled CHAS result is available');
  assert(result.value === 750, 'one-county buffer uses 750 eligible renters, not full county 7,500');
  assert(result.tier_breakdown.lte30 === 250, 'lte30 tier scales to 250');
  assert(result.tier_breakdown['31to50'] === 250, '31to50 tier scales to 250');
  assert(result.tier_breakdown['51to80'] === 250, '51to80 tier scales to 250');
  assertClose(result.counties[0].share, 0.10, 1e-12, 'county scale is buffer renters / CHAS county renters');
});

test('chasLihtcEligibleRenters caps county scale at one', () => {
  const result = Scoring.chasLihtcEligibleRenters({
    '08001': chasCounty({
      lte30: 100,
      '31to50': 200,
      '51to80': 300,
      '81to100': 200,
      '100plus': 200,
    }),
  }, [
    { geoid: '08001000100', _bufferShare: 1 },
  ], {
    '08001000100': { renter_hh: 1500 },
  });

  assert(result.value === 600, 'scale cap returns full <=80% pool, never inflated');
  assert(result.counties[0].share === 1, 'county scale is capped at 1');
});

test('chasLihtcEligibleRenters sums independently scaled multi-county pools', () => {
  const result = Scoring.chasLihtcEligibleRenters({
    '08001': chasCounty({
      lte30: 1000,
      '31to50': 1000,
      '51to80': 1000,
      '81to100': 1000,
      '100plus': 1000,
    }),
    '08005': chasCounty({
      lte30: 2000,
      '31to50': 1000,
      '51to80': 500,
      '81to100': 1000,
      '100plus': 500,
    }),
  }, [
    { geoid: '08001000100', _bufferShare: 1 },
    { geoid: '08005000100', _bufferShare: 0.5 },
  ], {
    '08001000100': { renter_hh: 500 },
    '08005000100': { renter_hh: 1000 },
  });

  assert(result.value === 650,
    'multi-county total is sum of county A 300 and county B 350, not a cross-county blend');
  assert(result.tier_breakdown.lte30 === 300, 'lte30 sums scaled county contributions');
  assert(result.tier_breakdown['31to50'] === 200, '31to50 sums scaled county contributions');
  assert(result.tier_breakdown['51to80'] === 150, '51to80 sums scaled county contributions');
});

test('chasLihtcEligibleRenters unavailable result lets capture risk fall back to ACS', () => {
  const chasResult = Scoring.chasLihtcEligibleRenters({
    '08031': chasCounty({
      lte30: 2500,
      '31to50': 2500,
      '51to80': 2500,
      '81to100': 1250,
      '100plus': 1250,
    }),
  }, [
    { geoid: '08031000100', _bufferShare: 1 },
  ], {});
  const capture = Scoring.scoreCaptureRisk({ renter_hh: 8000 }, 100, 100, chasResult);

  assert(chasResult.source === 'unavailable', 'missing ACS tract metrics make CHAS denominator unavailable');
  assert(capture.denominatorSource === 'acs_total_renter_hh', 'capture risk falls back to ACS renter households');
  assert(capture.qualRenters === 8000, 'ACS fallback denominator is preserved');
});

test('scoreCaptureRisk prefers CHAS LIHTC-eligible renter households as denominator', () => {
  const acsOnly = Scoring.scoreCaptureRisk(SAMPLE_ACS, 50, 150, null);
  const chas = Scoring.scoreCaptureRisk(SAMPLE_ACS, 50, 150, {
    value: 1000,
    tier_breakdown: { lte30: 250, '31to50': 350, '51to80': 400 },
  });

  assert(acsOnly.denominatorSource === 'acs_total_renter_hh',
    'missing CHAS falls back to ACS renter households');
  assert(acsOnly.qualRenters === SAMPLE_ACS.renter_hh,
    'ACS fallback denominator equals acs.renter_hh');
  assert(chas.denominatorSource === 'chas_lihtc_eligible',
    'CHAS denominator source is reported');
  assert(chas.qualRenters === 1000,
    'CHAS denominator uses chasEligible.value, not acs.renter_hh');
  assertClose(chas.capture, 0.20, 1e-12,
    'CHAS capture uses (existing + proposed) / CHAS eligible renters');
  assert(chas.score < acsOnly.score,
    `smaller CHAS denominator increases capture risk (${chas.score} < ${acsOnly.score})`);
  assert(chas.chasBreakdown && chas.chasBreakdown.lte30 === 250,
    'CHAS tier breakdown is carried through');
});

test('buffer-scaled CHAS denominator lowers or preserves capture score versus old county-wide denominator', () => {
  const scaled = Scoring.chasLihtcEligibleRenters({
    '08031': chasCounty({
      lte30: 2500,
      '31to50': 2500,
      '51to80': 2500,
      '81to100': 1250,
      '100plus': 1250,
    }),
  }, [
    { geoid: '08031000100', _bufferShare: 1 },
  ], {
    '08031000100': { renter_hh: 1000 },
  });
  const oldCountyWide = {
    value: 7500,
    tier_breakdown: { lte30: 2500, '31to50': 2500, '51to80': 2500 },
  };
  const fixed = Scoring.scoreCaptureRisk({ renter_hh: 8000 }, 100, 100, scaled);
  const old = Scoring.scoreCaptureRisk({ renter_hh: 8000 }, 100, 100, oldCountyWide);

  assert(fixed.qualRenters < old.qualRenters,
    `scaled denominator is smaller than old county-wide denominator (${fixed.qualRenters} < ${old.qualRenters})`);
  assert(fixed.score <= old.score,
    `smaller denominator lowers or preserves capture score (${fixed.score} <= ${old.score})`);
});

test('scoreCaptureRisk falls back to denominator 1 when ACS renter households are missing', () => {
  const result = Scoring.scoreCaptureRisk({}, 0, 0, null);
  assert(result.denominatorSource === 'fallback_1', 'fallback denominator source is reported');
  assert(result.qualRenters === 1, 'fallback denominator is 1');
  assert(result.score === 100, 'zero units over fallback denominator gives max headroom');
});

test('scoreRentPressure requires county AMI instead of statewide fallback', () => {
  const missing = Scoring.scoreRentPressure(SAMPLE_ACS, null);
  const present = Scoring.scoreRentPressure(SAMPLE_ACS, 95000);

  assert(missing.unavailable === true, 'missing county AMI returns unavailable');
  assert(missing.score === null, 'missing county AMI does not fabricate a score');
  assert(present.unavailable === false, 'county AMI produces available score');
  assert(present.amiSource === 'county', 'county AMI source is reported');
  assert(typeof present.score === 'number', 'county AMI score is numeric');
});

// #1160: three sources declare the default PMA buffer radius — the HTML
// select's `selected` option, market-analysis.js's module-level fallback,
// and pma-ui-controller.js's _bufferMiles. They silently disagreed (5 vs 3)
// until #1160; this guards against re-drift. bindBufferSelect() also
// re-syncs the module var from the live select at init, but these static
// defaults are what programmatic callers hit before/without DOM.
test('default PMA buffer radius agrees across HTML select, engine, and UI controller (#1160)', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'market-analysis.html'), 'utf8');
  const selStart = html.indexOf('id="pmaBufferSelect"');
  const selEnd = html.indexOf('</select>', selStart);
  assert(selStart !== -1 && selEnd > selStart, 'pmaBufferSelect found in market-analysis.html');
  const selectedOpt = html.slice(selStart, selEnd).match(/<option value="(\d+)"\s+selected/);
  assert(selectedOpt, 'pmaBufferSelect has a selected default option');

  const engine = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'market-analysis.js'), 'utf8');
  const engineDefault = engine.match(/var bufferMiles\s*=\s*(\d+)\s*;/);
  assert(engineDefault, 'module-level bufferMiles default found in market-analysis.js');

  const uic = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'pma-ui-controller.js'), 'utf8');
  const uicDefault = uic.match(/var _bufferMiles\s*=\s*(\d+)\s*;/);
  assert(uicDefault, '_bufferMiles default found in pma-ui-controller.js');

  assert(engineDefault[1] === selectedOpt[1],
    `engine default (${engineDefault[1]}) matches HTML selected option (${selectedOpt[1]})`);
  assert(uicDefault[1] === selectedOpt[1],
    `UI controller default (${uicDefault[1]}) matches HTML selected option (${selectedOpt[1]})`);
});

// #1163: when BOTH vacancy inputs are absent/suppressed, scoring routes
// through the legacy fallback (total vacancy, 0.12 ceiling, 0.05 neutral
// default) — deliberately preserving the historical 58, not the 50 the
// rental ceiling would give. Full weight-redistribution for suppressed
// data in computePma's composite was considered and deferred (see #1163).
test('scoreMarketTightness treats suppressed vacancy as neutral default, not max-tight', () => {
  const suppressed = Scoring.scoreMarketTightness({ vacancy_rate: null });
  const explicitZero = Scoring.scoreMarketTightness({ vacancy_rate: 0 });

  assert(suppressed === 58, `suppressed vacancy gets neutral-ish legacy score 58 (got ${suppressed})`);
  assert(explicitZero === 100, 'explicit zero vacancy still scores as max tightness');
});

// ── #1163: Land/Supply scores RENTAL vacancy at a single 0.10 ceiling ──────

test('scoreMarketTightness prefers rental vacancy over resort-inflated total vacancy', () => {
  // Resort-style aggregate: 63% total "vacancy" (seasonal homes) but a
  // genuinely tight 5% rental market. Old behavior scored this 0.
  const detail = Scoring.scoreMarketTightnessDetail({ vacancy_rate: 0.63, rental_vacancy_rate: 0.05 });
  assert(detail.basis === 'rental_vacancy', 'rental basis is reported');
  assert(detail.score === 50, `5% rental vacancy scores 50 under the 0.10 ceiling (got ${detail.score})`);
  assert(Scoring.scoreMarketTightness({ vacancy_rate: 0.63, rental_vacancy_rate: 0.05 }) === 50,
    'plain scoreMarketTightness returns the same rental-based score');
});

test('scoreMarketTightness prefers STR-adjusted rental vacancy when present', () => {
  const detail = Scoring.scoreMarketTightnessDetail({
    vacancy_rate: 0.69,
    rental_vacancy_rate: 0.51,
    str_adjusted_rental_vacancy_rate: 0.075
  });
  assert(detail.basis === 'rental_vacancy_str_adjusted', 'STR-adjusted rental basis is reported');
  assert(detail.score === 25, `7.5% adjusted rental vacancy scores 25 under the 0.10 ceiling (got ${detail.score})`);
  assert(Scoring.scoreMarketTightness({
    rental_vacancy_rate: 0.51,
    str_adjusted_rental_vacancy_rate: 0.075
  }) === 25, 'plain scoreMarketTightness uses the adjusted basis');
});

test('STR-adjusted vacancy formula fixtures match buffer-count method', () => {
  function adjustedRate(renterHh, vacant, vacantForRent, rentedNotOccupied, vacantSeasonal) {
    const seasonalShare = vacant > 0 ? Math.min(1, Math.max(0, vacantSeasonal / vacant)) : 0;
    const adjustedForRent = vacantForRent * (1 - seasonalShare);
    const universe = renterHh + adjustedForRent + rentedNotOccupied;
    return universe > 0 ? adjustedForRent / universe : null;
  }

  const seasonalDominated = adjustedRate(3801, 19502, 2447, 182, 15847);
  assertClose(seasonalDominated, 0.1033, 0.0002,
    'Summit-style seasonal-dominated fixture discounts raw 38.1% rental vacancy to low-teens');
  assert(Scoring.scoreMarketTightness({
    rental_vacancy_rate: 2447 / (3801 + 2447 + 182),
    str_adjusted_rental_vacancy_rate: seasonalDominated
  }) === 0, 'low-teens adjusted rate still hits the 0.10 ceiling');

  const zeroSeasonal = adjustedRate(900, 100, 50, 10, 0);
  assertClose(zeroSeasonal, 50 / (900 + 50 + 10), 1e-12,
    'zero-seasonal fixture leaves raw rental vacancy unchanged');
  assert(Scoring.scoreMarketTightnessDetail({
    rental_vacancy_rate: zeroSeasonal,
    str_adjusted_rental_vacancy_rate: zeroSeasonal
  }).basis === 'rental_vacancy_str_adjusted', 'zero-seasonal current data still reports adjusted basis');

  const zeroVacant = adjustedRate(800, 0, 20, 5, 30);
  assertClose(zeroVacant, 20 / (800 + 20 + 5), 1e-12,
    'zero-vacant fixture clamps seasonal share to 0 instead of dividing by zero');
});

test('rental-vacancy ceiling boundaries', () => {
  assert(Scoring.scoreMarketTightness({ rental_vacancy_rate: 0.10 }) === 0,
    '10% rental vacancy scores 0 (ceiling)');
  assert(Scoring.scoreMarketTightness({ rental_vacancy_rate: 0 }) === 100,
    '0% rental vacancy scores 100 (max tight)');
  assert(Scoring.RENTAL_VACANCY_CEILING === 0.10, 'exported rental ceiling is 0.10');
});

test('legacy fallback preserves historical total-vacancy behavior when rental fields absent', () => {
  const detail = Scoring.scoreMarketTightnessDetail({ vacancy_rate: 0.03 });
  assert(detail.basis === 'legacy_total_vacancy', 'legacy basis is reported');
  assert(detail.score === 75, `3% total vacancy at the legacy 0.12 ceiling scores 75 (got ${detail.score})`);
  assert(Scoring.LEGACY_TOTAL_VACANCY_CEILING === 0.12, 'exported legacy ceiling is 0.12');
  // null rental_vacancy_rate (no rental universe in buffer) also routes legacy
  const nullRental = Scoring.scoreMarketTightnessDetail({ vacancy_rate: 0.03, rental_vacancy_rate: null });
  assert(nullRental.basis === 'legacy_total_vacancy', 'null rental universe routes to legacy fallback');
});

// #1171 — STR-distortion disclosure predicate. After the seasonal-share
// discount, flags only residual cases where the adjusted score is still
// materially depressed (adjusted rental >= 0.08) AND the market is seasonal-
// dominated (total >= 0.25). Raw rental vacancy remains the stale-data fallback.
test('isStrDistorted evaluates adjusted rental vacancy when present', () => {
  assert(Scoring.isStrDistorted({
    rental_vacancy_rate: 0.51,
    str_adjusted_rental_vacancy_rate: 0.06,
    vacancy_rate: 0.69
  }) === false, 'Breckenridge-style buffer stops flagging when adjusted rate drops below 8%');
  assert(Scoring.isStrDistorted({
    rental_vacancy_rate: 0.51,
    str_adjusted_rental_vacancy_rate: 0.11,
    vacancy_rate: 0.69
  }) === true, 'residual high adjusted vacancy still flags');
  assert(Scoring.isStrDistorted({ rental_vacancy_rate: 0.51, vacancy_rate: 0.69 }) === true,
    'stale data without adjusted rate falls back to raw rental vacancy');
  assert(Scoring.isStrDistorted({ rental_vacancy_rate: 0.05, vacancy_rate: 0.077 }) === false,
    'Denver-style buffer (5% / 7.7%) is not flagged');
  assert(Scoring.isStrDistorted({ rental_vacancy_rate: 0.16, vacancy_rate: 0.10 }) === false,
    'genuinely soft non-seasonal market (16% rental / 10% total) is NOT flagged — real oversupply');
  assert(Scoring.isStrDistorted({ rental_vacancy_rate: 0.0, vacancy_rate: 0.27 }) === false,
    'tight-but-seasonal town (0% rental / 27% total) is not flagged — score not depressed');
  assert(Scoring.isStrDistorted({ vacancy_rate: 0.40 }) === false,
    'missing rental field never flags (legacy data)');
  assert(Scoring.isStrDistorted(null) === false, 'null acs never flags');
  assert(Scoring.scoreMarketTightness({
    rental_vacancy_rate: 0.51,
    str_adjusted_rental_vacancy_rate: 0.06,
    vacancy_rate: 0.69
  }) === 40, 'adjusted fixture moves score off 0');
  // the dimension note wiring exists in computePma
  const engine = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'market-analysis.js'), 'utf8');
  assert(engine.includes('isStrDistorted'), 'computePma consults isStrDistorted for the dimension note');
  assert(engine.includes('seasonal-share discount applied as an STR proxy'),
    'dimension note discloses the STR proxy basis');
});

// Anti-re-divergence guard (#1149/#1163/#1171): both scoring files must prefer
// the STR-adjusted rental basis and normalize against the same 0.10 ceiling.
test('both Land/Supply code paths prefer STR-adjusted rental vacancy at the 0.10 ceiling', () => {
  const sss = fs.readFileSync(
    path.resolve(__dirname, '..', 'js', 'market-analysis', 'site-selection-score.js'), 'utf8');
  assert(sss.includes('str_adjusted_rental_vacancy_rate'), 'site-selection-score.js consumes adjusted rental vacancy');
  assert(/adjusted\s*\/\s*0\.10/.test(sss), 'site-selection-score.js normalizes adjusted vacancy against 0.10');
  assert(sss.includes('rental_vacancy_rate'), 'site-selection-score.js consumes rental_vacancy_rate');
  assert(/rental\s*\/\s*0\.10/.test(sss), 'site-selection-score.js normalizes rental vacancy against 0.10');

  const helper = fs.readFileSync(
    path.resolve(__dirname, '..', 'js', 'market-analysis-scoring.js'), 'utf8');
  assert(/RENTAL_VACANCY_CEILING\s*=\s*0\.10/.test(helper),
    'shared helper declares RENTAL_VACANCY_CEILING = 0.10');

  const engine = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'market-analysis.js'), 'utf8');
  assert(engine.includes('rental_vacancy_rate'), 'aggregateAcs derives buffer-level rental_vacancy_rate');
  assert(engine.includes('str_adjusted_rental_vacancy_rate'), 'aggregateAcs derives buffer-level adjusted rental vacancy');
  assert(engine.includes('vacant_seasonal'), 'aggregateAcs sums vacant_seasonal counts');
  assert(engine.includes('scoreMarketTightnessDetail'), 'computePma uses the basis-aware detail for disclosure');
});

test('computePma composition uses shared helpers and returns valid score object', () => {
  const result = computePmaFromSharedHelpers(SAMPLE_ACS, 50, 0, 95000);
  assert(typeof result.overall === 'number', 'overall is a number');
  assert(result.overall >= 0 && result.overall <= 100, `overall in [0,100]: ${result.overall}`);
  assert(typeof result.demand === 'number', 'demand is a number');
  assert(typeof result.captureRisk === 'number', 'captureRisk is a number');
  assert(typeof result.rentPressure === 'number', 'rentPressure is a number');
  assert(typeof result.marketTightness === 'number', 'marketTightness is a number');
  assert(typeof result.workforce === 'number', 'workforce is a number');
});

test('captureRisk score drops as LIHTC saturation rises', () => {
  const low = Scoring.scoreCaptureRisk(SAMPLE_ACS, 100, 0);
  const high = Scoring.scoreCaptureRisk(SAMPLE_ACS, 5000, 0);
  assert(low.score > high.score,
    `captureRisk decreases with more existing units (${low.score} > ${high.score})`);
});

test('scoreTier assigns current production labels', () => {
  assert(Scoring.scoreTier(80).label === 'Strong', 'score 80 -> Strong');
  assert(Scoring.scoreTier(60).label === 'Moderate', 'score 60 -> Moderate');
  assert(Scoring.scoreTier(40).label === 'Marginal', 'score 40 -> Marginal');
  assert(Scoring.scoreTier(10).label === 'Weak', 'score 10 -> Weak');
  assert(Scoring.scoreTier(79).label === 'Moderate', 'score 79 boundary -> Moderate');
  assert(Scoring.scoreTier(59).label === 'Marginal', 'score 59 boundary -> Marginal');
  assert(Scoring.scoreTier(39).label === 'Weak', 'score 39 boundary -> Weak');
});

test('guard clause: market-analysis.js blocks scoring when lihtcLoadError is set', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'market-analysis.js'), 'utf8');
  const guardIdx = src.indexOf('lihtcLoadError');
  const callMatch = /var\s+pma\s*=\s*computePma\s*\(/.exec(src);
  assert(guardIdx !== -1, 'lihtcLoadError guard exists in source');
  assert(callMatch !== null, 'computePma() call site (var pma = ...) exists');
  assert(guardIdx < callMatch.index,
    'lihtcLoadError check appears before computePma call (prevents false scores)');
});

// ── Inline tractInBuffer for bbox-intersection testing ─────────────────────

var EARTH_RADIUS_MI = 3958.8;
function haversineTest(lat1, lon1, lat2, lon2) {
  var dL = (lat2 - lat1) * Math.PI / 180;
  var dO = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dL / 2) * Math.sin(dL / 2) +
           Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
           Math.sin(dO / 2) * Math.sin(dO / 2);
  return EARTH_RADIUS_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function tractInBufferTest(tract, lat, lon, miles) {
  if (tract.bbox && tract.bbox.length === 4) {
    var nearestLat = Math.max(tract.bbox[1], Math.min(lat, tract.bbox[3]));
    var nearestLon = Math.max(tract.bbox[0], Math.min(lon, tract.bbox[2]));
    return haversineTest(lat, lon, nearestLat, nearestLon) <= miles;
  }
  return haversineTest(lat, lon, tract.lat, tract.lon) <= miles;
}

test('tractInBuffer: bbox-based inclusion catches tracts whose centroid is outside buffer', () => {
  var siteLat = 39.7392;
  var siteLon = -104.9903;
  var miles = 3;

  var tractCentroidOnly = { geoid: 'TEST01', lat: 39.76, lon: -105.04 };
  var tractWithBbox = {
    geoid: 'TEST01',
    lat: 39.76, lon: -105.04,
    bbox: [-105.04, 39.70, -104.95, 39.80]
  };

  var centroidDist = haversineTest(siteLat, siteLon, tractCentroidOnly.lat, tractCentroidOnly.lon);
  assert(centroidDist > miles,
    `centroid distance (${centroidDist.toFixed(2)} mi) exceeds buffer radius (${miles} mi)`);
  assert(!tractInBufferTest(tractCentroidOnly, siteLat, siteLon, miles),
    'centroid-only: tract correctly excluded when centroid is outside buffer');
  assert(tractInBufferTest(tractWithBbox, siteLat, siteLon, miles),
    'bbox-based: tract correctly included when bbox edge is inside buffer');
});

test('tractInBuffer: bbox-based test excludes tracts that are truly outside buffer', () => {
  var siteLat = 39.7392;
  var siteLon = -104.9903;
  var miles = 3;

  var farTract = {
    geoid: 'TEST02',
    lat: 38.27, lon: -104.61,
    bbox: [-104.70, 38.20, -104.55, 38.34]
  };
  assert(!tractInBufferTest(farTract, siteLat, siteLon, miles),
    'bbox-based: far tract correctly excluded');
});

test('tractInBuffer: falls back to centroid when bbox is absent', () => {
  var siteLat = 39.7392;
  var siteLon = -104.9903;
  var miles = 5;

  var nearTract = { geoid: 'TEST03', lat: 39.7392, lon: -104.9903 };
  var farTract = { geoid: 'TEST04', lat: 38.27, lon: -104.61 };

  assert(tractInBufferTest(nearTract, siteLat, siteLon, miles),
    'centroid fallback: near tract included');
  assert(!tractInBufferTest(farTract, siteLat, siteLon, miles),
    'centroid fallback: far tract excluded');
});

test('market-analysis.js: tractInBuffer source uses bbox clamp logic', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'market-analysis.js'), 'utf8');
  assert(src.includes('tractInBuffer'), 'tractInBuffer function exists');
  assert(src.includes('t.bbox'), 'bbox branch is present');
  assert(src.includes('t.bbox.length === 4'), 'bbox length guard is present');
  assert(src.includes('nearestLat'), 'nearestLat clamping exists');
  assert(src.includes('nearestLon'), 'nearestLon clamping exists');
});

test('tractBufferShare uses polygon intersection before bbox fallback (#1232 PR B)', () => {
  global.window = { PMAMarketScoring: Scoring };
  global.document = {
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const modulePath = path.resolve(__dirname, '..', 'js', 'market-analysis.js');
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);

  const engine = global.window.PMAEngine;
  assert(typeof engine.tractBufferShare === 'function', 'tractBufferShare is exposed for regression testing');
  assert(typeof engine._setTractGeometryIndexForTest === 'function', 'test hook can inject tract geometry');
  assert(typeof engine._polygonBufferShareFromGeometry === 'function', 'polygon intersection helper is exposed');

  const siteLat = 39;
  const siteLon = -105;
  const miles = 1;
  const tract = {
    geoid: 'TESTPOLY',
    lat: siteLat,
    lon: siteLon,
    bbox: [
      siteLon - (2 / (69 * Math.cos(siteLat * Math.PI / 180))),
      siteLat - (2 / 69),
      siteLon + (2 / (69 * Math.cos(siteLat * Math.PI / 180))),
      siteLat + (2 / 69)
    ]
  };
  const narrowTractThroughSite = {
    type: 'Polygon',
    coordinates: [[
      [siteLon - (0.25 / (69 * Math.cos(siteLat * Math.PI / 180))), tract.bbox[1]],
      [siteLon + (0.25 / (69 * Math.cos(siteLat * Math.PI / 180))), tract.bbox[1]],
      [siteLon + (0.25 / (69 * Math.cos(siteLat * Math.PI / 180))), tract.bbox[3]],
      [siteLon - (0.25 / (69 * Math.cos(siteLat * Math.PI / 180))), tract.bbox[3]],
      [siteLon - (0.25 / (69 * Math.cos(siteLat * Math.PI / 180))), tract.bbox[1]]
    ]]
  };

  engine._setTractGeometryIndexForTest({ TESTPOLY: narrowTractThroughSite });
  const polygonShare = engine.tractBufferShare(tract, siteLat, siteLon, miles);
  const bboxShare = engine._bboxBufferShare(tract, siteLat, siteLon, miles);
  assert(polygonShare > 0.45 && polygonShare < 0.55,
    `polygon share reflects the narrow tract geometry (got ${polygonShare})`);
  assert(Math.abs(polygonShare - bboxShare) > 0.02,
    'polygon share is measurably different from bbox approximation');

  engine._setTractGeometryIndexForTest(null);
  const fallbackShare = engine.tractBufferShare(tract, siteLat, siteLon, miles);
  assertClose(fallbackShare, bboxShare, 1e-12,
    'missing geometry falls back to bbox approximation for offline resilience');
});

test('loadData fetches PMA tract display geometry for analytic apportionment', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'market-analysis.js'), 'utf8');
  assert(src.includes("fetchFile('market/pma_tract_display_geometry.geojson')"),
    'loadData fetches lightweight PMA tract geometry');
  assert(src.includes('_indexTractGeometry(geometryData)'),
    'loadData indexes tract geometry for runAnalysis');
  assert(src.includes("window.PMADataCache.set('pmaTractGeometryIndex'"),
    'geometry index is cached for repeated runs');
});

test('build_public_market_data.py: _bbox function exists', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', 'scripts', 'market', 'build_public_market_data.py'), 'utf8');
  assert(src.includes('def _bbox('), '_bbox() function defined');
  assert(src.includes('"bbox"'), 'bbox key written to tract record');
});

test('build_public_market_data.py: emits additive vacant_seasonal field', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', 'scripts', 'market', 'build_public_market_data.py'), 'utf8');
  assert(src.includes('"B25004_006E"'), 'ACS variable B25004_006E is fetched');
  assert(src.includes('vacant_seasonal     = safe_int(row[idx.get("B25004_006E", -1)])'),
    'vacant_seasonal is parsed with safe_int');
  assert(src.includes('"vacant_seasonal":      vacant_seasonal'),
    'vacant_seasonal is emitted on each tract');
  assert(src.includes('"vacant_seasonal":   "B25004_006E'),
    'vacant_seasonal is documented in meta.fields');
});

test('generate_tract_centroids.py: compute_bbox function exists', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', 'scripts', 'generate_tract_centroids.py'), 'utf8');
  assert(src.includes('def compute_bbox('), 'compute_bbox() function defined');
  assert(src.includes('"bbox"'), 'bbox key written to tract record');
});

console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\nSome checks failed. Review the output above for details.');
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed ✅');
}
