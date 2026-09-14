#!/usr/bin/env node
/**
 * county-demographics-contract — data/co-county-demographics.json must carry
 * the fields its consumers actually read.
 *
 * scripts/fetch-county-demographics.js had been a no-op for months: keyless
 * Census requests answer 302, the script exited 0 anyway, and the workflow's
 * validator only checked that the file was SHAPED like an object. Giving it a
 * key woke the live path up, and the live path emits DIFFERENT field names than
 * the stale committed file everyone had been reading. One green workflow run
 * renamed every field and blanked the county KPIs on market-intelligence.html.
 *
 * This asserts the contract from the consumer side, so the next schema change
 * fails here instead of in a chart.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'data/co-county-demographics.json';

// field -> the consumers that read it, so a failure names who breaks
const CONTRACT = {
  median_gross_rent:        ['js/market-intelligence.js'],
  median_household_income:  ['js/market-intelligence.js', 'js/housing-need-projector.js'],
  households:               ['js/market-intelligence.js', 'js/housing-need-projector.js', 'housing-needs-assessment.html'],
  cost_burdened_pct:        ['js/market-intelligence.js', 'js/housing-need-projector.js'],
  severely_burdened_pct:    ['js/market-intelligence.js', 'js/housing-need-projector.js'],
  total_housing_units:      ['js/market-intelligence.js'],
  overcrowded:              ['js/market-intelligence.js'],
};

let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };

console.log('\ncounty-demographics contract');
const doc = JSON.parse(fs.readFileSync(path.join(ROOT, FILE), 'utf8'));
const counties = doc.counties || {};
const names = Object.keys(counties);
if (names.length < 60) fail(`${FILE} has ${names.length} counties; Colorado has 64 (+1 statewide row)`);

for (const [field, readers] of Object.entries(CONTRACT)) {
  const present = names.filter((n) => counties[n] && counties[n][field] != null).length;
  if (present === 0) {
    fail(`every county is missing "${field}" — read by ${readers.join(', ')}`);
  } else if (present < names.length * 0.5) {
    fail(`"${field}" is set on only ${present}/${names.length} counties — read by ${readers.join(', ')}`);
  }
}

// A rate that is really a different quantity is worse than a missing one: the
// chart renders and lies. Overcrowding above ~10% statewide is not credible.
const rates = names.map((n) => counties[n] && counties[n].overcrowding_rate).filter((v) => typeof v === 'number');
const overMax = rates.length ? Math.max(...rates) : null;
if (overMax !== null && overMax > 0.15) {
  const worst = names.find((n) => counties[n] && counties[n].overcrowding_rate === overMax);
  fail(`overcrowding_rate peaks at ${(overMax * 100).toFixed(1)}% (${worst}). Above ~15% means the numerator `
     + `is not an overcrowding count — B25014_008E is "Renter occupied: total", not a bucket.`);
}


// ---------------------------------------------------------------------------
// Scale convention. Two scripts write this file on different schedules --
// scripts/refresh-data-pipeline.js (daily, data-refresh.yml) and
// scripts/fetch-county-demographics.js (weekly, fetch-county-data.yml) -- and
// they disagreed about vacancy_rate: one emitted 6.7, the other 0.0653. The
// committed scale therefore flipped day to day, and js/housing-need-projector.js
// (which divides by 100) inflated every county's projected need by ~1.47x on
// the fraction days. The convention is: *_pct is 0-100, *_rate and *_share are
// fractions 0-1.
const FRACTION_FIELDS = ['vacancy_rate', 'overcrowding_rate', 'cost_burden_share', 'severe_burden_share'];
const PERCENT_FIELDS  = ['cost_burdened_pct', 'severely_burdened_pct'];

for (const field of FRACTION_FIELDS) {
  const offenders = names.filter((n) => {
    const v = counties[n] && counties[n][field];
    return typeof v === 'number' && v > 1;
  });
  if (offenders.length) {
    const sample = offenders.slice(0, 3).map((n) => `${n}=${counties[n][field]}`).join(', ');
    fail(`"${field}" exceeds 1.0 on ${offenders.length} counties (${sample}) — `
       + `*_rate/*_share must be fractions. A percentage here means one of the two `
       + `producers wrote this file with the other one's scale.`);
  }
}
for (const field of PERCENT_FIELDS) {
  const offenders = names.filter((n) => {
    const v = counties[n] && counties[n][field];
    return typeof v === 'number' && v > 0 && v <= 1;
  });
  if (offenders.length > names.length * 0.5) {
    fail(`"${field}" is <= 1.0 on ${offenders.length}/${names.length} counties — `
       + `*_pct must be 0-100, not a fraction.`);
  }
}

// Paired fields must agree: cost_burdened_pct is cost_burden_share * 100.
for (const n of names) {
  const c = counties[n] || {};
  if (typeof c.cost_burden_share === 'number' && typeof c.cost_burdened_pct === 'number') {
    const implied = c.cost_burden_share * 100;
    if (Math.abs(implied - c.cost_burdened_pct) > 0.15) {
      fail(`${n}: cost_burdened_pct=${c.cost_burdened_pct} contradicts `
         + `cost_burden_share=${c.cost_burden_share} (implies ${implied.toFixed(1)})`);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// A real zero is a finding, not missing data. `overcrowded || null` in
// scripts/fetch-county-demographics.js converted a genuine 0 to null, leaving
// Jackson and San Juan with overcrowding_rate 0 and overcrowded null -- a count
// and a rate that contradict each other.
const zeroContradictions = names.filter((n) => {
  const c = counties[n] || {};
  return c.overcrowding_rate === 0 && c.overcrowded == null;
});
if (zeroContradictions.length) {
  fail(`${zeroContradictions.join(', ')}: overcrowding_rate is 0 but overcrowded is null. `
     + `A county with no >1.00-per-room households has a count of 0, not "unknown".`);
}

// ---------------------------------------------------------------------------
// Real-data anchors. A schema test passes on plausible-shaped nonsense; these
// pin actual published numbers for counties with known, different housing
// markets, so a numerator swap moves one of them.
//   Mesa   -- mid-size Western Slope metro
//   Denver -- the state's largest urban county
//   Summit -- resort county, ~61% of units seasonally vacant
//   Jackson/San Juan -- the smallest counties, genuine zero overcrowding
const ANCHORS = [
  { name: 'Mesa',   vacancy: [0.03, 0.12], overcrowd: [0.005, 0.06] },
  { name: 'Denver', vacancy: [0.03, 0.12], overcrowd: [0.010, 0.06] },
  { name: 'Summit', vacancy: [0.40, 0.80], overcrowd: [0.005, 0.08] },
];
for (const a of ANCHORS) {
  const c = counties[a.name];
  if (!c) { fail(`anchor county "${a.name}" is missing from ${FILE}`); continue; }
  const v = c.vacancy_rate;
  const o = c.overcrowding_rate;
  if (typeof v !== 'number' || v < a.vacancy[0] || v > a.vacancy[1]) {
    fail(`${a.name}: vacancy_rate ${v} outside the expected ${a.vacancy[0]}-${a.vacancy[1]} `
       + `(B25002_003E / B25002_001E, as a fraction)`);
  }
  if (typeof o !== 'number' || o < a.overcrowd[0] || o > a.overcrowd[1]) {
    fail(`${a.name}: overcrowding_rate ${o} outside the expected ${a.overcrowd[0]}-${a.overcrowd[1]} `
       + `((B25014_005E+006E+007E+011E+012E+013E) / B25014_001E). Denver read 0.512 when the `
       + `numerator was B25014_008E, the renter total.`);
  }
}

// Summit must stay far above Denver on vacancy: if the two converge, the field
// has stopped carrying a signal (which is what the projector's /100 did to it).
const summitV = counties.Summit && counties.Summit.vacancy_rate;
const denverV = counties.Denver && counties.Denver.vacancy_rate;
if (typeof summitV === 'number' && typeof denverV === 'number' && summitV < denverV * 3) {
  fail(`Summit vacancy (${summitV}) should be several times Denver's (${denverV}) — `
     + `a resort county and an urban core must not converge`);
}

const zeroCounties = names.filter((n) => counties[n] && counties[n].overcrowded === 0);


// ---------------------------------------------------------------------------
// The consumer side of the same contract. js/housing-need-projector.js turns
// vacancy_rate into a need multiplier; it read the fraction as a percentage and
// divided by 100 again, which pinned every county between 1.43x and 1.50x --
// Summit (61.2% vacant) and Douglas (3.1% vacant) landed 0.004 apart. The bug
// is invisible to a schema check because every number stays in range; what dies
// is the metric's ability to tell counties apart. So assert the SPREAD, not the
// absence of a "/100".
const projectorSrc = fs.readFileSync(path.join(ROOT, 'js/housing-need-projector.js'), 'utf8');
const fnMatch = projectorSrc.match(/function _vacancyDeficitFactor[\s\S]*?\n  \}/);
if (!fnMatch) {
  fail('could not locate _vacancyDeficitFactor in js/housing-need-projector.js');
} else {
  // eslint-disable-next-line no-eval
  const _vacancyDeficitFactor = eval('(' + fnMatch[0] + ')');

  if (_vacancyDeficitFactor(null) !== null) {
    fail('_vacancyDeficitFactor(null) must return null — a missing vacancy rate '
       + 'must not be indistinguishable from 0% vacancy (= maximum shortage)');
  }

  const mults = names
    .map((n) => counties[n] && counties[n].vacancy_rate)
    .filter((v) => typeof v === 'number')
    .map((v) => 1 + _vacancyDeficitFactor(v));
  const spread = Math.max(...mults) - Math.min(...mults);
  if (spread < 0.05) {
    fail(`vacancy need-multiplier spans only ${spread.toFixed(3)} across ${mults.length} counties `
       + `(${Math.min(...mults).toFixed(3)}-${Math.max(...mults).toFixed(3)}). The vacancy signal is `
       + `dead — every county gets the same shortage adjustment regardless of vacancy. `
       + `Check for a unit mismatch between vacancy_rate (a fraction) and the consumer.`);
  }

  // A slack market must receive no shortage adjustment at all.
  const summit = counties.Summit && counties.Summit.vacancy_rate;
  if (typeof summit === 'number' && _vacancyDeficitFactor(summit) !== 0) {
    fail(`Summit is ${(summit * 100).toFixed(1)}% vacant but still receives a vacancy shortage `
       + `adjustment of ${_vacancyDeficitFactor(summit).toFixed(3)} — should be 0`);
  }
  // A tight market must receive one.
  const douglas = counties.Douglas && counties.Douglas.vacancy_rate;
  if (typeof douglas === 'number' && !(_vacancyDeficitFactor(douglas) > 0)) {
    fail(`Douglas is ${(douglas * 100).toFixed(1)}% vacant (below the 5% healthy threshold) but `
       + `receives no vacancy shortage adjustment`);
  }
}


// ---------------------------------------------------------------------------
// Producer side. TWO scripts write this file on different schedules:
//   scripts/refresh-data-pipeline.js      daily  (data-refresh.yml, 06:23 UTC)
//   scripts/fetch-county-demographics.js  weekly (fetch-county-data.yml, Sat 06:41)
// so whichever ran last decides what the site serves. They disagreed on both
// the vacancy scale and the overcrowding numerator, and the committed file
// flipped between them day to day. Neither script exports its parser, so guard
// the two exact defects at the source instead.
const PRODUCERS = [
  'scripts/refresh-data-pipeline.js',
  'scripts/fetch-county-demographics.js',
];
for (const rel of PRODUCERS) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // Strip line comments so the explanatory notes about the old bug don't trip this.
  const code = src.replace(/^\s*\/\/.*$/gm, '');

  if (/B25014_008E/.test(code)) {
    fail(`${rel} still reads B25014_008E. That is "Renter occupied:" — the renter `
       + `TOTAL — not an overcrowding bucket; over B25014_001E it published Denver at 51.2%.`);
  }
  for (const bin of ['005', '006', '007', '011', '012', '013']) {
    if (!code.includes(`B25014_${bin}`)) {
      fail(`${rel} is missing overcrowding bucket B25014_${bin}E — the >1.00-occupants-per-room `
         + `buckets are 005-007 (owner) and 011-013 (renter); all six are required.`);
      break;
    }
  }
  // The percentage idiom: Math.round(x * 1000) / 10 yields 0-100 with one decimal.
  const vacancyLine = code.split('\n').find((l) => /vacancy_rate\s*:/.test(l)) || '';
  if (/\*\s*1000\s*\)\s*\/\s*10|\*\s*100\b/.test(vacancyLine)) {
    fail(`${rel} emits vacancy_rate as a percentage (${vacancyLine.trim().slice(0, 80)}). `
       + `The convention is a fraction; the other producer writes the same file.`);
  }
}

if (failures) { console.error(`\ncounty-demographics-contract: FAIL (${failures})`); process.exit(1); }
console.log(`  ✓ ${Object.keys(CONTRACT).length} consumer-read fields present across ${names.length} counties`);
console.log(`  ✓ overcrowding_rate peaks at ${(overMax * 100).toFixed(1)}% — plausible`);
console.log(`  ✓ scale convention holds: *_rate/*_share fractions, *_pct 0-100`);
console.log(`  ✓ anchors: Mesa/Denver/Summit vacancy + overcrowding in range`);
console.log(`  ✓ ${zeroCounties.length} county(ies) carry a real overcrowded=0 rather than null`);
console.log(`  ✓ vacancy need-multiplier still discriminates across counties`);
console.log(`  ✓ both producers agree on scale and overcrowding numerator`);
console.log('county-demographics-contract: PASS');
