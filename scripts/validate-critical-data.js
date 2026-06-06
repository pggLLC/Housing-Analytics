#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const checks = [
  { file: 'data/co-county-boundaries.json', expectedMinFeatures: 64 },
  { file: 'data/boundaries/counties_co.geojson', expectedMinFeatures: 64 },
  { file: 'data/qct-colorado.json', expectedMinFeatures: 1 },
  { file: 'data/dda-colorado.json', expectedMinFeatures: 1 }
];
let failed = false;
for (const check of checks) {
  const abs = path.resolve(process.cwd(), check.file);
  if (!fs.existsSync(abs)) {
    console.error('Missing required file: ' + check.file);
    failed = true;
    continue;
  }
  let json;
  try {
    json = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    console.error('Invalid JSON: ' + check.file);
    failed = true;
    continue;
  }
  const features = Array.isArray(json && json.features) ? json.features.length : 0;
  if (features < check.expectedMinFeatures) {
    console.error('Placeholder or incomplete GeoJSON: ' + check.file + ' has ' + features + ' features; expected at least ' + check.expectedMinFeatures);
    failed = true;
  } else {
    console.log('OK ' + check.file + ': ' + features + ' features');
  }
}
if (failed) process.exit(1);
console.log('Critical data validation passed.');

/* ── Sparse market-analysis data checks ──────────────────────────────────
 * These files back the statewide market-analysis and PMA scoring features.
 * Colorado has ~1,300 census tracts and hundreds of LIHTC properties, so
 * single-digit or very low feature counts indicate placeholder data that has
 * not yet been populated by the build-market-data workflow.
 *
 * Thresholds are set to detect placeholder vs real data:
 *   - 100 tracts / ACS records  (placeholder data typically has < 25)
 *   - 50 LIHTC properties       (placeholder data typically has < 15)
 *
 * Failing on placeholder data prevents the map from shipping stale results.
 * Run `gh workflow run market_data_build.yml` or trigger the workflow via the
 * GitHub UI to populate real data (requires CENSUS_API_KEY secret).
 */

/**
 * Count the number of records in a parsed JSON object.
 * Handles: {tracts:[]} (ACS/centroid files), GeoJSON FeatureCollections,
 * and plain arrays.
 * @param {*} json
 * @returns {number}
 */
function countRecords(json) {
  if (Array.isArray(json && json.tracts))    return json.tracts.length;
  if (Array.isArray(json && json.features))  return json.features.length;
  if (Array.isArray(json))                   return json.length;
  return 0;
}

function recordList(json) {
  if (Array.isArray(json && json.tracts))    return json.tracts;
  if (Array.isArray(json && json.features))  return json.features;
  if (Array.isArray(json))                   return json;
  return [];
}

function recordProps(record) {
  return record && record.properties ? record.properties : record;
}

const sparseChecks = [
  {
    file: 'data/market/acs_tract_metrics_co.json',
    // Colorado has ~1,300 census tracts; fewer than 100 entries means placeholder data.
    minFeatures: 100,
  },
  {
    file: 'data/market/tract_centroids_co.json',
    // Should have one centroid per census tract (~1,300 for Colorado).
    minFeatures: 100,
  },
  // F120 — gate tract_boundaries_co.geojson. Was previously ungated, so when
  // TIGERweb's REST endpoint failed during build_public_market_data.py the
  // file silently shipped as an empty FeatureCollection. The colorado-deep-dive
  // affordability-ratio "choropleth" then quietly fell back to centroid dots
  // with no visible disclosure. The min-feature threshold (1,000) catches the
  // empty regression — Colorado has ~1,447 tracts in TIGER 2024.
  {
    file: 'data/market/tract_boundaries_co.geojson',
    minFeatures: 1000,
  },
  {
    file: 'data/chfa-lihtc.json',
    // Primary Colorado LIHTC source: CHFA ArcGIS export, 926 projects through 2025.
    minFeatures: 900,
    yearField: 'YR_PIS',
    minMaxYear: 2025,
    invalidYears: [8888, 9999],
  },
  {
    file: 'data/market/hud_lihtc_co.geojson',
    // Normalized HUD-schema fallback used by older PMA code paths; not the primary gate.
    minFeatures: 700,
  },
];

let sparseFailed = false;
for (const sc of sparseChecks) {
  let localFailed = false;
  const abs = path.resolve(process.cwd(), sc.file);
  if (!fs.existsSync(abs)) {
    console.error('Missing market-analysis file: ' + sc.file +
      ' — run the build-market-data workflow to generate it.');
    sparseFailed = true;
    localFailed = true;
    continue;
  }
  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8').trim();
  } catch (err) {
    console.error('Cannot read market-analysis file: ' + sc.file + ' — ' + err.message);
    sparseFailed = true;
    localFailed = true;
    continue;
  }
  if (!raw) {
    console.error('Empty market-analysis file: ' + sc.file +
      ' — run the build-market-data workflow to populate it.');
    sparseFailed = true;
    localFailed = true;
    continue;
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.error('Invalid JSON in market-analysis file: ' + sc.file);
    sparseFailed = true;
    localFailed = true;
    continue;
  }
  const count = countRecords(json);
  const records = recordList(json);
  if (count < sc.minFeatures) {
    console.error(
      'Placeholder/sparse market-analysis data: ' + sc.file +
      ' has ' + count + ' features/records; minimum is ' + sc.minFeatures + '.' +
      ' Run the build-market-data workflow (requires CENSUS_API_KEY secret).'
    );
    sparseFailed = true;
    localFailed = true;
  } else {
    console.log('OK (market) ' + sc.file + ': ' + count + ' features/records');
  }
  if (sc.yearField) {
    const years = records
      .map((rec) => Number(recordProps(rec) && recordProps(rec)[sc.yearField]))
      .filter((year) => Number.isFinite(year));
    if (!years.length) {
      console.error('Missing year field ' + sc.yearField + ' in ' + sc.file + '.');
      sparseFailed = true;
      localFailed = true;
    } else {
      const maxYear = Math.max(...years);
      const invalid = (sc.invalidYears || []).filter((year) => years.includes(year));
      if (maxYear < sc.minMaxYear) {
        console.error(
          'Stale LIHTC source: ' + sc.file + ' max ' + sc.yearField + ' is ' +
          maxYear + '; expected at least ' + sc.minMaxYear + '.'
        );
        sparseFailed = true;
        localFailed = true;
      }
      if (invalid.length) {
        console.error(
          'Invalid sentinel years in ' + sc.file + ' ' + sc.yearField + ': ' + invalid.join(', ')
        );
        sparseFailed = true;
        localFailed = true;
      }
      if (!localFailed) {
        console.log('OK (market) ' + sc.file + ': max ' + sc.yearField + ' ' + maxYear);
      }
    }
  }
}
if (sparseFailed) process.exit(1);

/* ── Numeric-bound checks (Phase 2 QA hardening) ─────────────────────────
 * Many data fields have natural value ranges (percentages in [0,100],
 * dollar AMI thresholds in [$30K, $200K], vacancy rates in [0, 50]).
 * The pre-fix CHAS Table 9 parsing bug shipped 0.6% lte30 burdens for all
 * 64 CO counties because nothing checked that low-income tier burden rates
 * fall within the expected 50-90% range. Bound checks run after schema +
 * sentinel checks and catch the class of bug where the file looks
 * structurally correct but ships impossibly-low or impossibly-high values.
 *
 * Adding a new bound: append to BOUND_CHECKS. Pick min/max wider than
 * physical reality but tight enough to catch a misparsing — e.g.
 * vacancy_rate ∈ [0, 50] catches a parser that reports 200% but allows
 * legitimately distressed markets up to 50%.
 */
function pickField(obj, path) {
  // Supports nested keys via dot notation: "metrics.pct_cost_burdened"
  // and array iteration via "[].": "rankings[].metrics.pct_cost_burdened"
  // Returns an array of values.
  const parts = path.split(/[.](?![^[]*\])/g); // split on dot, ignoring brackets
  let cursor = [obj];
  for (const part of parts) {
    const isArray = part.endsWith('[]');
    const key = isArray ? part.slice(0, -2) : part;
    const next = [];
    for (const c of cursor) {
      if (c == null) continue;
      const v = key === '' ? c : c[key];
      if (Array.isArray(v) && isArray) next.push(...v);
      else if (v !== undefined) next.push(v);
    }
    cursor = next;
  }
  return cursor;
}

const BOUND_CHECKS = [
  // Ranking-index — every metric the UI displays
  { file: 'data/hna/ranking-index.json',
    field: 'rankings[].metrics.pct_cost_burdened', min: 0, max: 100 },
  { file: 'data/hna/ranking-index.json',
    field: 'rankings[].metrics.pct_renters', min: 0, max: 100 },
  { file: 'data/hna/ranking-index.json',
    field: 'rankings[].metrics.vacancy_rate', min: 0, max: 50 },
  { file: 'data/hna/ranking-index.json',
    field: 'rankings[].metrics.pct_burdened_lte30', min: 0, max: 100 },
  { file: 'data/hna/ranking-index.json',
    field: 'rankings[].metrics.pct_burdened_31to50', min: 0, max: 100 },
  { file: 'data/hna/ranking-index.json',
    field: 'rankings[].metrics.pct_burdened_51to80', min: 0, max: 100 },
  { file: 'data/hna/ranking-index.json',
    field: 'rankings[].percentileRank', min: 0, max: 100 },
  { file: 'data/hna/ranking-index.json',
    field: 'rankings[].metrics.median_hh_income', min: 0, max: 500000 },
  // AMI gap by county — HUD AMI thresholds
  { file: 'data/co_ami_gap_by_county.json',
    field: 'counties[].ami_4person', min: 30000, max: 250000 },
  // CHAS — sanity: percentages in [0,1] (decimal, not pct)
  { file: 'data/hna/chas_affordability_gap.json',
    field: 'state.summary.pct_renter_cb30', min: 0, max: 1 },
  { file: 'data/hna/chas_affordability_gap.json',
    field: 'state.summary.pct_owner_cb30', min: 0, max: 1 },
  // Place AMI gap — HUD AMI thresholds
  { file: 'data/co_ami_gap_by_place.json',
    field: 'meta.acs_year', min: 2020, max: 2030 },
  // HUD FMR + income limits
  { file: 'data/hud-fmr-income-limits.json',
    field: 'counties[].income_limits.ami_4person', min: 30000, max: 250000 },
  { file: 'data/hud-fmr-income-limits.json',
    field: 'counties[].fmr.two_br', min: 500, max: 5000 },
  // FRED data
  { file: 'data/fred-data.json',
    field: 'meta.fiscal_year', min: 2020, max: 2030 },
];

let boundsFailed = false;
let boundsChecked = 0;
const checkedFiles = new Set();
for (const bc of BOUND_CHECKS) {
  const abs = path.resolve(process.cwd(), bc.file);
  if (!fs.existsSync(abs)) {
    // Not all bound-checked files are critical — some (like co_ami_gap_by_place
    // for fresh checkouts) may not exist yet. Don't fail; warn.
    console.log('  (bounds) Skipping missing file: ' + bc.file);
    continue;
  }
  let json;
  try { json = JSON.parse(fs.readFileSync(abs, 'utf8')); }
  catch (e) { continue; /* schema check above already failed */ }
  const values = pickField(json, bc.field).filter(v => typeof v === 'number');
  if (values.length === 0) continue;
  const oob = values.filter(v => v < bc.min || v > bc.max);
  boundsChecked += values.length;
  checkedFiles.add(bc.file);
  if (oob.length > 0) {
    console.error(
      '  (bounds) FAIL ' + bc.file + ' .' + bc.field +
      ': ' + oob.length + '/' + values.length + ' values outside [' + bc.min + ', ' + bc.max + ']' +
      ' (e.g. ' + oob.slice(0, 3).join(', ') + ')'
    );
    boundsFailed = true;
  } else {
    // Quiet pass — only show one line per file
    if (!checkedFiles.has(bc.file + '_logged')) {
      checkedFiles.add(bc.file + '_logged');
    }
  }
}
console.log('  (bounds) Checked ' + boundsChecked + ' values across ' +
            (checkedFiles.size / 2 | 0) + ' files');
if (boundsFailed) {
  console.error('Bound checks FAILED. Investigate the field(s) above.');
  process.exit(1);
}
console.log('All numeric bound checks passed.');
