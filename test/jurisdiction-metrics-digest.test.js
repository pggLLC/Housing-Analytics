#!/usr/bin/env node

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RANKING_PATH = path.join(ROOT, 'data/hna/ranking-index.json');
const DIGEST_DIR = path.join(ROOT, 'data/hna/jurisdiction-metrics-digest');
const OWNERSHIP_PATH = path.join(ROOT, 'data/hna/ownership-need.json');
const HOME_VALUE_CASCADE_PATH = path.join(ROOT, 'data/hna/home-value-cascade.json');
const COVERAGE_PATH = path.join(ROOT, 'docs/qa/metric-digest-coverage-2026-06-30.md');
const BUILDER = path.join(ROOT, 'scripts/hna/build_jurisdiction_metrics_digest.mjs');
const REGIONAL_METRICS = [
  'pct_ami_lte30',
  'pct_ami_31to50',
  'pct_ami_51to80',
  'pct_ami_gt80',
  'pct_housing_built_pre1970',
  'pct_no_hs_degree_25plus',
  'pct_single_parent_households',
  'pct_age_65_plus',
  'pct_bipoc_population',
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function runBuilder() {
  const result = spawnSync(process.execPath, [BUILDER], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('Jurisdiction metrics digest — B1 data spine');

test('builder is non-scoring and leaves ranking-index unchanged', () => {
  const before = sha256(RANKING_PATH);
  runBuilder();
  const after = sha256(RANKING_PATH);
  assert.strictEqual(after, before, 'ranking-index.json changed after digest rebuild');
});

const ranking = readJson(RANKING_PATH);
const files = fs.readdirSync(DIGEST_DIR).filter((f) => f.endsWith('.json'));

test('one digest exists for every ranked geography', () => {
  assert.strictEqual(files.length, ranking.rankings.length);
});

test('Silt digest has required schema and tagged metrics', () => {
  const digest = readJson(path.join(DIGEST_DIR, '0870195.json'));
  assert.strictEqual(digest.schema, 'jurisdiction-metrics-digest/v1');
  assert.strictEqual(digest.geography.geoid, '0870195');
  assert.ok(digest.metric_count > 55, `unexpected metric_count ${digest.metric_count}`);
  for (const key of [
    'housing_gap_units',
    'pct_cost_burdened',
    'median_home_value',
    'in_commuters',
    'overall_need_score',
    'workforce_housing_pressure_score',
    'ownership_need_recommendation',
    'ownership_need_renter_cost_burdened',
    'ownership_need_moderate_income_renter_households',
    'rank',
  ]) {
    const metric = digest.metrics[key];
    assert.ok(metric, `missing metric ${key}`);
    for (const required of ['value', 'geography_level', 'confidence', 'source_id', 'as_of', 'measure_type']) {
      assert.ok(Object.prototype.hasOwnProperty.call(metric, required), `${key} missing ${required}`);
    }
  }
});

test('ownership need metrics match the shared ownership artifact', () => {
  const digest = readJson(path.join(DIGEST_DIR, '0870195.json'));
  const ownership = readJson(OWNERSHIP_PATH);
  assert.strictEqual(ownership.schema, 'hna-ownership-need/v1');
  const silt = ownership.records['0870195'];
  assert.ok(silt, 'missing Silt ownership record');
  assert.strictEqual(digest.metrics.ownership_need_recommendation.value, silt.recommendation);
  assert.strictEqual(digest.metrics.ownership_need_rental_pressure_tier.value, silt.rental_pressure_tier);
  assert.strictEqual(digest.metrics.ownership_need_ownership_pressure_tier.value, silt.ownership_pressure_tier);
  assert.strictEqual(digest.metrics.ownership_need_moderate_income_renter_households.value, silt.moderate_income_renter_households);
  assert.strictEqual(digest.metrics.ownership_need_recommendation.source_id, 'hna-affordable-ownership-need');
  assert.strictEqual(digest.metrics.ownership_need_recommendation.measure_type, 'derived');
});

test('county ownership metrics are labeled county-level', () => {
  const digest = readJson(path.join(DIGEST_DIR, '08013.json'));
  assert.strictEqual(digest.geography.type, 'county');
  assert.strictEqual(digest.metrics.ownership_need_recommendation.geography_level, 'county');
  assert.strictEqual(digest.metrics.ownership_need_affordability_classification.geography_level, 'county');
});

test('home-value review flags suppress downstream affordability classification', () => {
  const cascade = readJson(HOME_VALUE_CASCADE_PATH);
  const ownership = readJson(OWNERSHIP_PATH);
  const flaggedGeoids = Object.values(cascade.review_flags || {})
    .flat()
    .map((row) => String(row.geoid))
    .filter(Boolean);
  assert.ok(flaggedGeoids.includes('0803620'), 'expected Aspen to remain in the review-flag set');
  for (const geoid of flaggedGeoids) {
    const rec = ownership.records[geoid];
    assert.ok(rec, `missing ownership record for flagged geoid ${geoid}`);
    assert.strictEqual(rec.affordability_classification, null, `${geoid} should not have a modeled affordability classification`);
  }
});

test('B3 workforce housing metrics are bounded and honestly labeled', () => {
  const digest = readJson(path.join(DIGEST_DIR, '0870195.json'));
  const pressure = digest.metrics.workforce_housing_pressure_score;
  assert.ok(pressure.value >= 0 && pressure.value <= 100, `pressure out of bounds: ${pressure.value}`);
  assert.strictEqual(pressure.geography_level, 'place');
  assert.strictEqual(pressure.source_id, 'economic-housing-bridge');
  assert.strictEqual(pressure.measure_type, 'derived');
  assert.ok(pressure.formula_note.includes('Not used for ranking'));

  const serviceShare = digest.metrics.county_service_sector_share_pct;
  assert.strictEqual(serviceShare.geography_level, 'county_context');
  assert.strictEqual(serviceShare.source_id, 'lehd-lodes-county');
  assert.strictEqual(serviceShare.measure_type, 'level');

  const rentTrend = digest.metrics.county_trend_rent_change_2009_2024_pct;
  assert.strictEqual(rentTrend.geography_level, 'county_context');
  assert.strictEqual(rentTrend.measure_type, 'trend');
});

test('regional comparison metrics are present, bounded, and source-tagged for counties and places', () => {
  const fixtures = [
    ['08045', 'county'],
    ['08097', 'county'],
    ['0803620', 'place'],
    ['0812045', 'place'],
  ];
  for (const [geoid, level] of fixtures) {
    const digest = readJson(path.join(DIGEST_DIR, `${geoid}.json`));
    assert.strictEqual(digest.geography.type === 'county' ? 'county' : 'place', level);
    for (const key of REGIONAL_METRICS) {
      const metric = digest.metrics[key];
      assert.ok(metric, `${geoid} missing regional metric ${key}`);
      assert.ok(Number.isFinite(metric.value), `${geoid} ${key} value should be numeric`);
      assert.ok(metric.value >= 0 && metric.value <= 100, `${geoid} ${key} out of percent bounds: ${metric.value}`);
      assert.strictEqual(metric.geography_level, level, `${geoid} ${key} geography_level`);
      assert.strictEqual(metric.measure_type, 'level', `${geoid} ${key} measure_type`);
      assert.strictEqual(metric.as_of, 'ACS 2020-2024 5-year', `${geoid} ${key} as_of`);
    }
    const sourcePrefix = level === 'county' ? 'hud-chas-county' : 'hud-chas-place-apportioned';
    for (const key of ['pct_ami_lte30', 'pct_ami_31to50', 'pct_ami_51to80', 'pct_ami_gt80']) {
      assert.strictEqual(digest.metrics[key].source_id, sourcePrefix, `${geoid} ${key} source`);
      assert.strictEqual(digest.metrics[key].denominator_key, 'chas_households_with_ami', `${geoid} ${key} denominator`);
    }
    assert.strictEqual(digest.metrics.pct_housing_built_pre1970.source_id, 'acs-profile-dp04');
    assert.strictEqual(digest.metrics.pct_no_hs_degree_25plus.source_id, 'acs-profile-dp02');
    assert.strictEqual(digest.metrics.pct_single_parent_households.source_id, 'acs-profile-dp02');
    assert.strictEqual(digest.metrics.pct_age_65_plus.source_id, 'acs-profile-dp05');
    assert.strictEqual(digest.metrics.pct_bipoc_population.source_id, 'acs-profile-dp05');
  }
});

test('regional BIPOC population share recomputes from raw DP05 fields', () => {
  const fixtures = ['08045', '0803620'];
  for (const geoid of fixtures) {
    const digest = readJson(path.join(DIGEST_DIR, `${geoid}.json`));
    const summary = readJson(path.join(ROOT, 'data/hna/summary', `${geoid}.json`));
    const total = Number(summary.acsProfile.DP05_0033E);
    const notHispanicWhite = Number(summary.acsProfile.DP05_0096E);
    assert.ok(Number.isFinite(total) && total > 0, `${geoid} total population`);
    assert.ok(Number.isFinite(notHispanicWhite), `${geoid} non-Hispanic White alone population`);
    const expected = Math.round(((total - notHispanicWhite) / total * 100) * 10) / 10;
    assert.strictEqual(digest.metrics.pct_bipoc_population.value, expected, `${geoid} pct_bipoc_population raw DP05 recompute`);
  }
});

test('regional comparison fixture values stay stable for Garfield County and Roaring Fork places', () => {
  const expected = {
    '08045': {
      pct_ami_lte30: 10.9,
      pct_housing_built_pre1970: 14.1,
      pct_no_hs_degree_25plus: 10.6,
      pct_single_parent_households: 5.9,
      pct_age_65_plus: 14.8,
      // ACS 2020-2024 DP05 complement method; cross-checked against Census Reporter B03002.
      pct_bipoc_population: 38.5,
    },
    '0803620': {
      pct_ami_gt80: 60.8,
      pct_housing_built_pre1970: 18.2,
      pct_no_hs_degree_25plus: 1.2,
      pct_single_parent_households: 4.1,
      pct_age_65_plus: 17.4,
      // ACS 2020-2024 DP05 complement method; cross-checked against Census Reporter B03002.
      pct_bipoc_population: 21.0,
    },
    '0812045': {
      pct_ami_gt80: 64.4,
      pct_housing_built_pre1970: 7.9,
      pct_no_hs_degree_25plus: 12.4,
      pct_single_parent_households: 3.7,
      pct_age_65_plus: 19.9,
    },
  };
  for (const [geoid, metrics] of Object.entries(expected)) {
    const digest = readJson(path.join(DIGEST_DIR, `${geoid}.json`));
    for (const [key, value] of Object.entries(metrics)) {
      assert.strictEqual(digest.metrics[key].value, value, `${geoid} ${key}`);
    }
  }
});

test('regional BIPOC population row is labeled as population, not households', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/hna/hna-renderers.js'), 'utf8');
  assert.ok(src.includes("label: 'BIPOC population share', key: 'pct_bipoc_population'"), 'population row label is present');
  assert.ok(!src.includes("label: 'BIPOC households', key: 'pct_bipoc_population'"), 'population row is not mislabeled as households');
});

test('bipocPopulationPct returns null when required DP05 fields are missing', () => {
  const probe = [
    `import { bipocPopulationPct } from ${JSON.stringify(`file://${BUILDER}`)};`,
    `const value = bipocPopulationPct({ DP05_0033E: 1000 });`,
    `if (value !== null) throw new Error('expected null, got ' + value);`,
  ].join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
});

test('county-derived metrics are explicitly labeled county_context for places/CDPs', () => {
  let countyContextCount = 0;
  for (const file of files) {
    const digest = readJson(path.join(DIGEST_DIR, file));
    if (digest.geography.type === 'county') continue;
    for (const metric of Object.values(digest.metrics)) {
      if (metric.geography_level === 'county_context') countyContextCount += 1;
      assert.notStrictEqual(metric.geography_level, 'county', `${file} uses county instead of county_context`);
    }
  }
  assert.ok(countyContextCount > 0, 'expected at least one county_context metric on place/CDP digests');
});

test('rate metrics carry denominator floor metadata', () => {
  const digest = readJson(path.join(DIGEST_DIR, '0870195.json'));
  for (const key of ['housing_gap_rate_lte30', 'pct_cost_burdened', 'vacancy_rate']) {
    const metric = digest.metrics[key];
    assert.ok(metric.denominator_key, `${key} missing denominator_key`);
    assert.strictEqual(metric.min_denominator, 50, `${key} min denominator changed`);
    assert.ok(Object.prototype.hasOwnProperty.call(metric, 'denominator_floor_applied'), `${key} missing floor flag`);
  }
});

test('single-vintage source metrics are levels, not trends', () => {
  const digest = readJson(path.join(DIGEST_DIR, '0870195.json'));
  assert.strictEqual(digest.metrics.population.measure_type, 'level');
  assert.strictEqual(digest.metrics.median_hh_income.measure_type, 'level');
  assert.strictEqual(digest.metrics.gross_rent_median.measure_type, 'level');
  assert.strictEqual(digest.metrics.future_units_needed_20yr.measure_type, 'projection');
});

test('coverage report exists and summarizes county-context tags', () => {
  const text = fs.readFileSync(COVERAGE_PATH, 'utf8');
  assert.ok(text.includes('Jurisdiction Metrics Digest Coverage'));
  assert.ok(text.includes('county_context'));
  assert.ok(text.includes('Min denominator floor: 50'));
});

console.log('Done.');
