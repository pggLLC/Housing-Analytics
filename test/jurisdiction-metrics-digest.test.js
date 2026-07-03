#!/usr/bin/env node

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RANKING_PATH = path.join(ROOT, 'data/hna/ranking-index.json');
const DIGEST_DIR = path.join(ROOT, 'data/hna/jurisdiction-metrics-digest');
const COVERAGE_PATH = path.join(ROOT, 'docs/qa/metric-digest-coverage-2026-06-30.md');
const BUILDER = path.join(ROOT, 'scripts/hna/build_jurisdiction_metrics_digest.mjs');

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
  for (const key of ['housing_gap_units', 'pct_cost_burdened', 'median_home_value', 'in_commuters', 'overall_need_score', 'workforce_housing_pressure_score', 'rank']) {
    const metric = digest.metrics[key];
    assert.ok(metric, `missing metric ${key}`);
    for (const required of ['value', 'geography_level', 'confidence', 'source_id', 'as_of', 'measure_type']) {
      assert.ok(Object.prototype.hasOwnProperty.call(metric, required), `${key} missing ${required}`);
    }
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
