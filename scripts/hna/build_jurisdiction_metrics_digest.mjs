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
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const RANKING_PATH = path.join(ROOT, 'data', 'hna', 'ranking-index.json');
const SUMMARY_DIR = path.join(ROOT, 'data', 'hna', 'summary');
const LEHD_DIR = path.join(ROOT, 'data', 'hna', 'lehd');
const PLACE_CHAS_PATH = path.join(ROOT, 'data', 'hna', 'place-chas.json');
const COUNTY_CHAS_PATH = path.join(ROOT, 'data', 'hna', 'chas_affordability_gap.json');
const AMI_GAP_PLACE_PATH = path.join(ROOT, 'data', 'co_ami_gap_by_place.json');
const AMI_GAP_COUNTY_PATH = path.join(ROOT, 'data', 'co_ami_gap_by_county.json');
const OWNERSHIP_JS = path.join(ROOT, 'js', 'hna', 'hna-ownership-need.js');
const OWNERSHIP_OUT_PATH = path.join(ROOT, 'data', 'hna', 'ownership-need.json');
const HOME_VALUE_CASCADE_PATH = path.join(ROOT, 'data', 'hna', 'home-value-cascade.json');
const BRIEFS_DIR = path.join(ROOT, 'data', 'jurisdiction-briefs');
const COUNTY_TRENDS_PATH = path.join(ROOT, 'data', 'co-housing-costs', 'county-trends.json');
const OUT_DIR = path.join(ROOT, 'data', 'hna', 'jurisdiction-metrics-digest');
const COVERAGE_PATH = path.join(ROOT, 'docs', 'qa', 'metric-digest-coverage-2026-06-30.md');
const ECONOMIC_BRIDGE = path.join(ROOT, 'scripts', 'hna', 'economic_housing_bridge.py');

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

const ECONOMIC_METRICS = {
  workforce_housing_pressure_score: {
    source_id: 'economic-housing-bridge',
    measure_type: 'derived',
    geography_level: 'place',
  },
  workforce_housing_home_value_pressure: {
    source_id: 'economic-housing-bridge',
    measure_type: 'derived',
    geography_level: 'place',
  },
  workforce_housing_commute_pressure: {
    source_id: 'economic-housing-bridge',
    measure_type: 'derived',
    geography_level: 'place',
  },
  workforce_housing_service_sector_pressure: {
    source_id: 'economic-housing-bridge',
    measure_type: 'derived',
    geography_level: 'county_context',
  },
  workforce_housing_wage_gap_pressure: {
    source_id: 'economic-housing-bridge',
    measure_type: 'derived',
    geography_level: 'county_context',
  },
  wage_affordability_rent_gap_dollars: {
    source_id: 'economic-housing-bridge',
    measure_type: 'level',
    geography_level: 'place',
  },
  wage_affordability_ownership_gap_dollars: {
    source_id: 'economic-housing-bridge',
    measure_type: 'level',
    geography_level: 'place',
  },
  wage_affordability_rent_burden_pct: {
    source_id: 'economic-housing-bridge',
    measure_type: 'rate',
    geography_level: 'place',
  },
  county_service_sector_share_pct: {
    source_id: 'lehd-lodes-county',
    measure_type: 'level',
    geography_level: 'county_context',
  },
  county_median_annual_wage_estimate: {
    source_id: 'lehd-lodes-county-earnings-bin-estimate',
    measure_type: 'level',
    geography_level: 'county_context',
  },
  county_trend_rent_change_2009_2024_pct: {
    source_id: 'county-housing-cost-trends-acs-cohorts',
    measure_type: 'trend',
    geography_level: 'county_context',
  },
  county_trend_income_change_2009_2024_pct: {
    source_id: 'county-housing-cost-trends-acs-cohorts',
    measure_type: 'trend',
    geography_level: 'county_context',
  },
  county_trend_rent_burden_2024_pct: {
    source_id: 'county-housing-cost-trends-acs-cohorts',
    measure_type: 'level',
    geography_level: 'county_context',
  },
  county_trend_vacancy_rate_2024_pct: {
    source_id: 'county-housing-cost-trends-acs-cohorts',
    measure_type: 'level',
    geography_level: 'county_context',
  },
  county_trend_total_housing_units_2024: {
    source_id: 'county-housing-cost-trends-acs-cohorts',
    measure_type: 'level',
    geography_level: 'county_context',
  },
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

function loadOptionalJson(file) {
  if (!fs.existsSync(file)) return null;
  return readJson(file);
}

function loadOwnershipEngine() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(OWNERSHIP_JS, 'utf8'), sandbox, { filename: OWNERSHIP_JS });
  return sandbox.window.HNAOwnershipNeed;
}

function countyFipsForEntry(entry) {
  if (entry.type === 'county') return entry.geoid;
  return entry.containingCounty || null;
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

function roundPct(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
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

function pctFromCounts(numerator, denominator) {
  const num = numberOrNull(numerator);
  const den = numberOrNull(denominator);
  if (num == null || den == null || den <= 0) return null;
  return roundPct(num / den * 100);
}

function sumNumbers(values) {
  let total = 0;
  let seen = false;
  for (const value of values) {
    const n = numberOrNull(value);
    if (n == null) continue;
    total += n;
    seen = true;
  }
  return seen ? total : null;
}

function chasForEntry(entry, chasSources) {
  if (entry.type === 'county') {
    return {
      entry: chasSources.countyChas[String(entry.geoid)] || null,
      source_id: 'hud-chas-county',
      geography_level: 'county',
    };
  }
  return {
    entry: chasSources.placeChas[String(entry.geoid)] || null,
    source_id: 'hud-chas-place-apportioned',
    geography_level: 'place',
  };
}

function amiTierTotal(chas, tier) {
  return sumNumbers([
    chas?.owner_hh_by_ami?.[tier]?.total,
    chas?.renter_hh_by_ami?.[tier]?.total,
  ]);
}

function amiShareMetrics(entry, chasSources) {
  const chasInfo = chasForEntry(entry, chasSources);
  const chas = chasInfo.entry;
  const tierTotals = {
    lte30: amiTierTotal(chas, 'lte30'),
    '31to50': amiTierTotal(chas, '31to50'),
    '51to80': amiTierTotal(chas, '51to80'),
    '81to100': amiTierTotal(chas, '81to100'),
    '100plus': amiTierTotal(chas, '100plus'),
  };
  const total = sumNumbers(Object.values(tierTotals));
  const metric = (numerator) => ({
    value: pctFromCounts(numerator, total),
    geography_level: chasInfo.geography_level,
    confidence: total && total < MIN_RATE_DENOMINATOR ? 'low' : valueConfidence(pctFromCounts(numerator, total), 'medium'),
    source_id: chasInfo.source_id,
    as_of: ACS_AS_OF,
    measure_type: 'level',
    denominator_key: 'chas_households_with_ami',
    denominator: total,
    min_denominator: MIN_RATE_DENOMINATOR,
    denominator_floor_applied: total !== null && total < MIN_RATE_DENOMINATOR,
  });
  return {
    pct_ami_lte30: metric(tierTotals.lte30),
    pct_ami_31to50: metric(tierTotals['31to50']),
    pct_ami_51to80: metric(tierTotals['51to80']),
    pct_ami_gt80: metric(sumNumbers([tierTotals['81to100'], tierTotals['100plus']])),
  };
}

function acsRegionalMetric(value, entry, sourceId, denominatorKey, denominator, confidence = 'high') {
  const denom = numberOrNull(denominator);
  const floorApplies = denom !== null && denom < MIN_RATE_DENOMINATOR;
  return {
    value,
    geography_level: localLevel(entry),
    confidence: floorApplies ? 'low' : valueConfidence(value, confidence),
    source_id: sourceId,
    as_of: ACS_AS_OF,
    measure_type: 'level',
    denominator_key: denominatorKey,
    denominator: denom,
    min_denominator: MIN_RATE_DENOMINATOR,
    denominator_floor_applied: floorApplies,
  };
}

function housingBuiltPre1970Pct(acs) {
  const pe = sumNumbers(['DP04_0023PE', 'DP04_0024PE', 'DP04_0025PE', 'DP04_0026PE'].map((key) => acs[key]));
  if (pe != null) return roundPct(pe);
  return pctFromCounts(
    sumNumbers(['DP04_0023E', 'DP04_0024E', 'DP04_0025E', 'DP04_0026E'].map((key) => acs[key])),
    acs.DP04_0001E,
  );
}

function regionalComparisonMetrics(entry, summary, chasSources) {
  const acs = summary?.acsProfile || {};
  const builtPre1970 = housingBuiltPre1970Pct(acs);
  return {
    ...amiShareMetrics(entry, chasSources),
    pct_housing_built_pre1970: acsRegionalMetric(
      builtPre1970,
      entry,
      'acs-profile-dp04',
      'housing_units',
      acs.DP04_0001E,
    ),
    pct_no_hs_degree_25plus: acsRegionalMetric(
      pctFromCounts(sumNumbers([acs.DP02_0060E, acs.DP02_0061E]), acs.DP02_0059E),
      entry,
      'acs-profile-dp02',
      'population_25plus',
      acs.DP02_0059E,
    ),
    pct_single_parent_households: acsRegionalMetric(
      pctFromCounts(sumNumbers([acs.DP02_0007E, acs.DP02_0011E]), acs.DP02_0001E),
      entry,
      'acs-profile-dp02',
      'households',
      acs.DP02_0001E,
    ),
    pct_age_65_plus: acsRegionalMetric(
      pctFromCounts(acs.DP05_0024E, acs.DP05_0033E),
      entry,
      'acs-profile-dp05',
      'total_population',
      acs.DP05_0033E,
    ),
  };
}

function economicGeographyLevel(entry, config) {
  if (entry.type === 'county' && config.geography_level === 'county_context') return 'county';
  return config.geography_level;
}

function economicDigestMetric(metric, value, entry, rankingMeta) {
  const config = ECONOMIC_METRICS[metric];
  return {
    value: value === undefined ? null : value,
    geography_level: economicGeographyLevel(entry, config),
    confidence: valueConfidence(value, metric.includes('estimate') ? 'medium' : 'high'),
    source_id: config.source_id,
    as_of: metric.startsWith('county_trend_')
      ? 'County housing-cost ACS cohorts 2009/2014/2024'
      : metric.startsWith('county_') || metric.includes('service_sector') || metric.includes('wage_gap')
        ? 'LEHD LODES latest committed vintage'
        : rankingMeta.generatedAt,
    measure_type: config.measure_type,
    ...(metric === 'workforce_housing_pressure_score' ? {
      formula_note: 'Bounded 0-100 descriptive blend: place home-value pressure (30%), county service-sector share pressure (25%), place commute-ratio pressure (25%), county wage-gap pressure (20%). Not used for ranking.',
    } : {}),
  };
}

function homeValueFromSummary(summary) {
  const home = summary?.acsProfile?.median_home_value;
  if (home && typeof home === 'object') return numberOrNull(home.value);
  return numberOrNull(home);
}

function reviewFlagSet(reviewFlags) {
  const flagged = new Set();
  for (const arr of Object.values(reviewFlags || {})) {
    if (!Array.isArray(arr)) continue;
    for (const row of arr) {
      if (row?.geoid) flagged.add(String(row.geoid));
    }
  }
  return flagged;
}

function homeValueEntry(entry, summary, homeValueCascade, flaggedHomeValues) {
  if (entry.type !== 'county' && homeValueCascade?.places) {
    if (flaggedHomeValues.has(String(entry.geoid))) return null;
    const rec = homeValueCascade.places[String(entry.geoid)];
    if (rec) return { geography_level: 'place', ...rec };
  }
  const home = summary?.acsProfile?.median_home_value;
  if (home && typeof home === 'object') return home;
  const value = numberOrNull(home) ?? numberOrNull(entry.metrics?.median_home_value);
  return value == null ? null : { value, source: 'summary-or-ranking-index' };
}

function countyAmiGap(amiGapCounty, fips) {
  const counties = amiGapCounty?.counties || [];
  if (Array.isArray(counties)) return counties.find((row) => String(row.fips) === String(fips)) || null;
  return counties[String(fips)] || null;
}

function buildOwnershipRecords(ranking) {
  const Ownership = loadOwnershipEngine();
  const placeChas = loadOptionalJson(PLACE_CHAS_PATH)?.places || {};
  const countyChas = loadOptionalJson(COUNTY_CHAS_PATH)?.counties || {};
  const amiGapPlace = loadOptionalJson(AMI_GAP_PLACE_PATH)?.places || {};
  const amiGapCounty = loadOptionalJson(AMI_GAP_COUNTY_PATH) || {};
  const homeValueCascade = loadOptionalJson(HOME_VALUE_CASCADE_PATH) || {};
  const flaggedHomeValues = reviewFlagSet(homeValueCascade.review_flags);
  const records = {};
  for (const entry of ranking.rankings || []) {
    const summary = loadSummary(entry.geoid);
    const isCounty = entry.type === 'county';
    const chasEntry = isCounty ? countyChas[entry.geoid] : placeChas[entry.geoid];
    const amiGapEntry = isCounty
      ? Object.assign({ gapSource: 'county' }, countyAmiGap(amiGapCounty, entry.geoid) || {})
      : Object.assign({ gapSource: 'place' }, amiGapPlace[entry.geoid] || {});
    const result = Ownership.computeOwnershipNeed({
      placeChasEntry: isCounty ? null : chasEntry,
      countyChasEntry: isCounty ? chasEntry : null,
      geographyId: entry.geoid,
      geographyName: entry.name,
      geoLevel: isCounty ? 'county' : 'place',
      amiGapEntry,
      homeValueEntry: homeValueEntry(entry, summary, homeValueCascade, flaggedHomeValues),
    });
    records[entry.geoid] = {
      geoid: entry.geoid,
      name: entry.name,
      type: entry.type,
      recommendation: result.tenureMixRecommendation,
      recommendation_detail: result.recommendationDetail,
      data_quality: result.dataQuality,
      renter_cost_burdened: result.renterCostBurdened,
      owner_cost_burdened: result.ownerCostBurdened,
      severe_renter_cost_burdened: result.severeRenterCostBurdened,
      moderate_income_renter_households: result.moderateIncomeRenterHouseholds,
      moderate_income_owner_cost_burdened: result.moderateIncomeOwnerCostBurdened,
      existing_rental_gap_lte80: result.existingRentalGap,
      rental_pressure_tier: result.rentalPressure?.tier || null,
      ownership_pressure_tier: result.ownershipPressure?.tier || null,
      ownership_fit_tier: result.ownershipFit?.tier || null,
      affordability_classification: result.affordabilityTest?.classification || null,
      caveats: result.caveats || [],
    };
  }
  return records;
}

function buildEconomicRecords(ranking) {
  const countyTrends = loadOptionalJson(COUNTY_TRENDS_PATH)?.counties || {};
  return ranking.rankings.map((entry) => {
    const summary = loadSummary(entry.geoid);
    const countyFips = countyFipsForEntry(entry);
    const lehd = countyFips ? loadOptionalJson(path.join(LEHD_DIR, `${countyFips}.json`)) : null;
    return {
      geoid: entry.geoid,
      type: entry.type,
      county_fips: countyFips,
      median_home_value: homeValueFromSummary(summary) ?? numberOrNull(entry.metrics?.median_home_value),
      gross_rent_median: numberOrNull(entry.metrics?.gross_rent_median ?? summary?.acsProfile?.DP04_0134E),
      in_commuters: numberOrNull(entry.metrics?.in_commuters),
      commute_ratio: numberOrNull(entry.metrics?.commute_ratio),
      population: numberOrNull(entry.metrics?.population ?? summary?.acsProfile?.DP05_0001E),
      county_lehd: lehd || {},
      county_trends: countyFips ? (countyTrends[countyFips] || {}) : {},
    };
  });
}

function buildEconomicLayer(ranking) {
  const input = JSON.stringify(buildEconomicRecords(ranking));
  const result = spawnSync('python3', [ECONOMIC_BRIDGE, '--compute-workforce-layer'], {
    cwd: ROOT,
    input,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'economic_housing_bridge.py failed');
  }
  return JSON.parse(result.stdout || '{}');
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

function ownershipDigestMetric(metric, value, entry, rankingMeta) {
  return {
    value: value === undefined ? null : value,
    geography_level: entry.type === 'county' ? 'county' : 'place',
    confidence: valueConfidence(value, 'medium'),
    source_id: 'hna-affordable-ownership-need',
    as_of: rankingMeta.generatedAt,
    measure_type: metric.includes('recommendation') || metric.includes('tier') ? 'derived' : 'level',
  };
}

function buildDigest(entry, rankingMeta, economicLayer, ownershipRecords, chasSources) {
  const summary = loadSummary(entry.geoid);
  const denom = denominators(summary);
  const metrics = {};
  for (const [metric, value] of Object.entries(entry.metrics || {})) {
    if (INTERNAL_METRICS.has(metric)) continue;
    metrics[metric] = digestMetric(metric, value, entry, summary, denom);
  }
  Object.assign(metrics, regionalComparisonMetrics(entry, summary, chasSources));
  const economic = economicLayer[entry.geoid] || {};
  for (const [metric, config] of Object.entries(ECONOMIC_METRICS)) {
    const sourceField = metric === 'county_service_sector_share_pct' ? 'service_sector_share_pct' : metric;
    if (Object.prototype.hasOwnProperty.call(economic, sourceField)) {
      metrics[metric] = economicDigestMetric(metric, economic[sourceField], entry, rankingMeta);
    } else {
      metrics[metric] = economicDigestMetric(metric, null, entry, rankingMeta);
    }
  }
  const own = ownershipRecords[entry.geoid] || {};
  for (const metric of [
    'recommendation',
    'data_quality',
    'renter_cost_burdened',
    'owner_cost_burdened',
    'severe_renter_cost_burdened',
    'moderate_income_renter_households',
    'moderate_income_owner_cost_burdened',
    'existing_rental_gap_lte80',
    'rental_pressure_tier',
    'ownership_pressure_tier',
    'ownership_fit_tier',
    'affordability_classification',
  ]) {
    metrics['ownership_need_' + metric] = ownershipDigestMetric(metric, own[metric], entry, rankingMeta);
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
      economic_bridge: 'scripts/hna/economic_housing_bridge.py',
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

function fmtNum(value) {
  const n = numberOrNull(value);
  if (n == null) return '0';
  return Math.round(n).toLocaleString('en-US');
}

function ensureBriefSource(sources, geoid, id, label, field) {
  const existing = sources.find((source) => source.id === id);
  const source = {
    id,
    label,
    url: `data/hna/jurisdiction-metrics-digest/${geoid}.json`,
    kind: 'data',
    dataset: 'jurisdiction-metrics-digest',
    field,
    accessed: '2026-07-07',
  };
  if (existing) Object.assign(existing, source);
  else sources.push(source);
}

function refreshBriefTenureStrategy(ownershipRecords) {
  if (!fs.existsSync(BRIEFS_DIR)) return;
  for (const file of fs.readdirSync(BRIEFS_DIR).filter((name) => /^\d+\.json$/.test(name))) {
    const full = path.join(BRIEFS_DIR, file);
    const brief = readJson(full);
    const own = ownershipRecords[brief.geoid];
    if (!own) continue;
    const sources = Array.isArray(brief.sources) ? brief.sources : [];
    brief.sources = sources;
    ensureBriefSource(sources, brief.geoid, 'own1', 'Affordable Ownership Need recommendation', 'ownership_need_recommendation');
    ensureBriefSource(sources, brief.geoid, 'own2', 'Affordable Ownership Need rental pressure tier', 'ownership_need_rental_pressure_tier');
    ensureBriefSource(sources, brief.geoid, 'own3', 'Affordable Ownership Need ownership pressure tier', 'ownership_need_ownership_pressure_tier');
    ensureBriefSource(sources, brief.geoid, 'own4', 'Affordable Ownership Need moderate-income renter households', 'ownership_need_moderate_income_renter_households');
    ensureBriefSource(sources, brief.geoid, 'own5', 'Affordable Ownership Need renter cost burdened households', 'ownership_need_renter_cost_burdened');
    ensureBriefSource(sources, brief.geoid, 'own6', 'Affordable Ownership Need owner cost burdened households', 'ownership_need_owner_cost_burdened');
    const section = {
      id: 'tenure-strategy-screening',
      heading: 'Tenure strategy screening',
      paragraphs: [
        {
          text: `The Affordable Ownership Need screening module recommends ${own.recommendation} for ${brief.jurisdiction}. It classifies rental pressure as ${own.rental_pressure_tier}, ownership pressure as ${own.ownership_pressure_tier}, and identifies ${fmtNum(own.moderate_income_renter_households)} moderate-income renter households as the ownership-fit base.`,
          cites: ['own1', 'own2', 'own3', 'own4'],
        },
        {
          text: `The same screening run counts ${fmtNum(own.renter_cost_burdened)} renter households and ${fmtNum(own.owner_cost_burdened)} owner households as cost-burdened. This is a screening estimate only; verify local prices, financing assumptions, assistance programs, household size, and local deed-restriction policy before using it for a project decision.`,
          cites: ['own5', 'own6'],
        },
      ],
    };
    const sections = Array.isArray(brief.sections) ? brief.sections : [];
    const idx = sections.findIndex((s) => s.id === section.id);
    if (idx >= 0) sections[idx] = section;
    else sections.push(section);
    brief.sections = sections;
    writeJson(full, brief);
  }
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
  lines.push('- B3 workforce-housing metrics are descriptive context only and do not change `data/hna/ranking-index.json`.');
  return lines.join('\n') + '\n';
}

function main() {
  const ranking = readJson(RANKING_PATH);
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const chasSources = {
    placeChas: loadOptionalJson(PLACE_CHAS_PATH)?.places || {},
    countyChas: loadOptionalJson(COUNTY_CHAS_PATH)?.counties || {},
  };
  const economicLayer = buildEconomicLayer(ranking);
  const ownershipRecords = buildOwnershipRecords(ranking);
  writeJson(OWNERSHIP_OUT_PATH, {
    schema: 'hna-ownership-need/v1',
    generated_from: {
      ranking_index_generated_at: ranking.metadata?.generatedAt || null,
      engine: 'js/hna/hna-ownership-need.js',
      builder: 'scripts/hna/build_jurisdiction_metrics_digest.mjs',
    },
    records: ownershipRecords,
  });
  refreshBriefTenureStrategy(ownershipRecords);
  const digests = ranking.rankings.map((entry) => buildDigest(entry, ranking.metadata || {}, economicLayer, ownershipRecords, chasSources));
  for (const digest of digests) {
    writeJson(path.join(OUT_DIR, `${digest.geography.geoid}.json`), digest);
  }
  const coverage = buildCoverage(digests);
  fs.writeFileSync(COVERAGE_PATH, coverageMarkdown(digests, coverage));
  console.log(`[metric-digest] wrote ${path.relative(ROOT, OWNERSHIP_OUT_PATH)}`);
  console.log(`[metric-digest] wrote ${digests.length} files to ${path.relative(ROOT, OUT_DIR)}`);
  console.log(`[metric-digest] wrote ${path.relative(ROOT, COVERAGE_PATH)}`);
}

main();
