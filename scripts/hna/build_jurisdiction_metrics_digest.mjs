#!/usr/bin/env node
/**
 * Build per-jurisdiction metric digests for future brief generation.
 *
 * This is a non-scoring data spine: it reads the committed ranking index and
 * summaries, tags each affordable-housing-relevant metric with provenance, and
 * writes one digest per ranked geography. It must not rebuild or rewrite
 * data/hna/ranking-index.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const RANKING_PATH = path.join(ROOT, 'data', 'hna', 'ranking-index.json');
const SUMMARY_DIR = path.join(ROOT, 'data', 'hna', 'summary');
const OUT_DIR = path.join(ROOT, 'data', 'hna', 'jurisdiction-metrics-digest');
const COVERAGE_PATH = path.join(ROOT, 'docs', 'qa', 'metric-digest-coverage-2026-06-30.md');

const MIN_RATE_DENOMINATOR = 50;
const ACS_AS_OF = 'ACS 2020-2024 5-year';

const INTERNAL_METRICS = new Set([
  '_ami_gap_source',
  '_chas_source',
  '_lehd_source',
  'amenity_access_context',
  'home_value_confidence',
  'missing_ami_tiers',
  'opportunity_geography_level',
]);

const RATE_DENOMINATORS = {
  housing_gap_rate_lte30: 'low_income_households_lte30',
  pct_cost_burdened: 'renter_households',
  pct_renter_severe_burdened: 'renter_households',
  pct_deep_tier_burdened: 'low_income_households_lte30',
  pct_burdened_lte30: 'low_income_households_lte30',
  pct_burdened_31to50: 'low_income_households_lte30',
  pct_burdened_51to80: 'low_income_households_lte30',
  pct_burdened_81to100: 'low_income_households_lte30',
  pct_burdened_100plus: 'low_income_households_lte30',
  pct_owner_burdened_30plus: 'owner_households',
  vacancy_rate: 'housing_units',
  pct_renters: 'occupied_households',
  pct_multifamily: 'housing_units',
  pct_sf_detached: 'housing_units',
  pct_2to4_units: 'housing_units',
  overcrowding_rate: 'occupied_households',
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function confidenceFromMultiplier(multiplier) {
  if (typeof multiplier !== 'number') return 'medium';
  if (multiplier >= 0.97) return 'high';
  if (multiplier >= 0.90) return 'medium';
  return 'low';
}

function valueConfidence(value, fallback = 'medium') {
  if (value === null || value === undefined || Number.isNaN(value)) return 'missing';
  return fallback;
}

function loadSummary(geoid) {
  const file = path.join(SUMMARY_DIR, `${geoid}.json`);
  if (!fs.existsSync(file)) return null;
  return readJson(file);
}

function denominators(summary) {
  const acs = summary?.acsProfile || {};
  const housingUnits = numberOrNull(acs.DP04_0001E);
  const occupied = numberOrNull(acs.DP04_0002E);
  const renter = numberOrNull(acs.DP04_0047E);
  const owner = numberOrNull(acs.DP04_0046E);
  return {
    housing_units: housingUnits,
    occupied_households: occupied,
    renter_households: renter,
    owner_households: owner,
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function localLevel(entry) {
  if (entry.type === 'county') return 'county';
  return 'place';
}

function contextLevel(entry, source) {
  if (entry.type === 'county') return 'county';
  if (source === 'county' || source === 'county_direct' || source === 'county_proportional' || source === 'county_context') {
    return 'county_context';
  }
  return 'place';
}

function sourceForMetric(metric, entry, summary) {
  const m = entry.metrics || {};
  if (metric.startsWith('ami_gap_') || metric === 'housing_gap_units' || metric === 'low_income_households_lte30' || metric === 'housing_gap_rate_lte30') {
    const src = m._ami_gap_source || 'none';
    return {
      source_id: src.startsWith('place') ? 'ami-gap-place-acs' : src.startsWith('county') ? 'ami-gap-county-acs' : 'ami-gap-unknown',
      geography_level: contextLevel(entry, src.startsWith('county') ? 'county_context' : 'place'),
      as_of: ACS_AS_OF,
    };
  }
  if (metric.includes('burdened') || metric === 'cost_burden_pressure_score') {
    const src = m._chas_source || 'county';
    return {
      source_id: src === 'place' ? 'hud-chas-place-apportioned' : 'hud-chas-county',
      geography_level: contextLevel(entry, src),
      as_of: ACS_AS_OF,
    };
  }
  if (metric === 'in_commuters' || metric === 'commute_ratio' || metric === 'commuter_pressure_score') {
    const src = m._lehd_source || 'county';
    return {
      source_id: src === 'place' ? 'lehd-lodes-place-apportioned' : 'lehd-lodes-county',
      geography_level: contextLevel(entry, src),
      as_of: 'LEHD LODES latest committed vintage',
    };
  }
  if (metric === 'median_home_value' || metric === 'home_value_to_income') {
    const home = summary?.acsProfile?.median_home_value;
    const src = home?.source || 'acs_raw';
    return {
      source_id: src === 'zhvi' ? 'zillow-zhvi-city-index' : src === 'county_zhvi_adjusted' ? 'zillow-zhvi-county-adjusted' : 'acs-profile-dp04',
      geography_level: src === 'county_zhvi_adjusted' ? 'county_context' : localLevel(entry),
      as_of: home?.as_of || ACS_AS_OF,
      confidence: home?.confidence || m.home_value_confidence || 'medium',
    };
  }
  if (metric === 'population_projection_20yr' || metric === 'future_units_needed_20yr' || metric === 'future_pressure_score' || metric === 'senior_share_growth_pp') {
    return { source_id: 'dola-demographic-projections', geography_level: contextLevel(entry, entry.type === 'county' ? 'county' : 'county_context'), as_of: 'DOLA projection cache' };
  }
  if (metric.includes('opportunity') || metric === 'walkability_score' || metric === 'amenity_access_score' || metric === 'qct_dda_score' || metric === 'qct_share' || metric === 'dda_share') {
    return {
      source_id: metric.includes('qct') || metric.includes('dda') ? 'hud-qct-dda' : 'opportunity-amenity-context',
      geography_level: contextLevel(entry, m.opportunity_geography_level || 'place'),
      as_of: 'latest committed opportunity context',
    };
  }
  if (metric.includes('score')) {
    return { source_id: 'hna-ranking-index-derived', geography_level: localLevel(entry), as_of: readJson(RANKING_PATH).metadata.generatedAt };
  }
  return { source_id: 'acs-profile', geography_level: localLevel(entry), as_of: ACS_AS_OF };
}

function measureType(metric) {
  if (metric === 'population_projection_20yr' || metric === 'future_units_needed_20yr') return 'projection';
  if (metric.includes('score') || metric === 'rank') return 'derived';
  return 'level';
}

function digestMetric(metric, value, entry, summary, denom) {
  const source = sourceForMetric(metric, entry, summary);
  const denominatorKey = RATE_DENOMINATORS[metric] || null;
  const denominator = denominatorKey === 'low_income_households_lte30'
    ? numberOrNull(entry.metrics.low_income_households_lte30)
    : denominatorKey
      ? denom[denominatorKey]
      : null;
  const floorApplies = denominatorKey ? denominator !== null && denominator < MIN_RATE_DENOMINATOR : false;
  const sourceConfidence = source.confidence || confidenceFromMultiplier(entry.metrics.score_confidence_multiplier);
  return {
    value: value === undefined ? null : value,
    geography_level: source.geography_level,
    confidence: floorApplies ? 'low' : valueConfidence(value, sourceConfidence),
    source_id: source.source_id,
    as_of: source.as_of,
    measure_type: measureType(metric),
    ...(denominatorKey ? {
      denominator_key: denominatorKey,
      denominator,
      min_denominator: MIN_RATE_DENOMINATOR,
      denominator_floor_applied: floorApplies,
    } : {}),
  };
}

function buildDigest(entry, rankingMeta) {
  const summary = loadSummary(entry.geoid);
  const denom = denominators(summary);
  const metrics = {};
  for (const [metric, value] of Object.entries(entry.metrics || {})) {
    if (INTERNAL_METRICS.has(metric)) continue;
    metrics[metric] = digestMetric(metric, value, entry, summary, denom);
  }
  metrics.rank = {
    value: entry.rank,
    geography_level: localLevel(entry),
    confidence: 'high',
    source_id: 'hna-ranking-index-derived',
    as_of: rankingMeta.generatedAt,
    measure_type: 'derived',
  };
  return {
    schema: 'jurisdiction-metrics-digest/v1',
    generated_from: {
      ranking_index_generated_at: rankingMeta.generatedAt,
      ranking_index_version: rankingMeta.version || 'unknown',
      builder: 'scripts/hna/build_jurisdiction_metrics_digest.mjs',
    },
    geography: {
      geoid: entry.geoid,
      name: entry.name,
      type: entry.type,
      region: entry.region,
      containingCounty: entry.containingCounty || null,
    },
    metric_count: Object.keys(metrics).length,
    min_rate_denominator: MIN_RATE_DENOMINATOR,
    metrics,
  };
}

function buildCoverage(digests) {
  const byLevel = {};
  const bySource = {};
  let totalMetrics = 0;
  let countyContextMetrics = 0;
  let denominatorTagged = 0;
  for (const digest of digests) {
    for (const metric of Object.values(digest.metrics)) {
      totalMetrics += 1;
      byLevel[metric.geography_level] = (byLevel[metric.geography_level] || 0) + 1;
      bySource[metric.source_id] = (bySource[metric.source_id] || 0) + 1;
      if (metric.geography_level === 'county_context') countyContextMetrics += 1;
      if (metric.denominator_key) denominatorTagged += 1;
    }
  }
  return { byLevel, bySource, totalMetrics, countyContextMetrics, denominatorTagged };
}

function coverageMarkdown(digests, coverage) {
  const lines = [];
  lines.push('# Jurisdiction Metrics Digest Coverage');
  lines.push('');
  lines.push('Date: 2026-06-30');
  lines.push('');
  lines.push('B1 metric-digest data spine generated from the committed HNA ranking index and per-geography summaries. This is non-scoring and does not rewrite `data/hna/ranking-index.json`.');
  lines.push('');
  lines.push(`- Digest files: ${digests.length}`);
  lines.push(`- Total tagged metrics: ${coverage.totalMetrics}`);
  lines.push(`- County-context metric tags: ${coverage.countyContextMetrics}`);
  lines.push(`- Rate metrics with denominator metadata: ${coverage.denominatorTagged}`);
  lines.push(`- Min denominator floor: ${MIN_RATE_DENOMINATOR}`);
  lines.push('');
  lines.push('## Geography-Level Tags');
  lines.push('');
  lines.push('| geography_level | metric tags |');
  lines.push('|---|---:|');
  for (const [level, count] of Object.entries(coverage.byLevel).sort()) lines.push(`| ${level} | ${count} |`);
  lines.push('');
  lines.push('## Source Tags');
  lines.push('');
  lines.push('| source_id | metric tags |');
  lines.push('|---|---:|');
  for (const [source, count] of Object.entries(coverage.bySource).sort()) lines.push(`| ${source} | ${count} |`);
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- `county_context` means the selected jurisdiction is a place/CDP but the metric is inherited from a county-level or county-apportioned source.');
  lines.push('- Single-vintage ACS and source-cache values are tagged as `measure_type: level`, not trend.');
  lines.push('- Future household/unit fields are tagged as `projection`; composite ranking fields are tagged as `derived`.');
  return lines.join('\n') + '\n';
}

function main() {
  const ranking = readJson(RANKING_PATH);
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const digests = ranking.rankings.map((entry) => buildDigest(entry, ranking.metadata || {}));
  for (const digest of digests) {
    writeJson(path.join(OUT_DIR, `${digest.geography.geoid}.json`), digest);
  }
  const coverage = buildCoverage(digests);
  fs.writeFileSync(COVERAGE_PATH, coverageMarkdown(digests, coverage));
  console.log(`[metric-digest] wrote ${digests.length} files to ${path.relative(ROOT, OUT_DIR)}`);
  console.log(`[metric-digest] wrote ${path.relative(ROOT, COVERAGE_PATH)}`);
}

main();
