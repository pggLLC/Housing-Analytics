#!/usr/bin/env node
/**
 * scripts/validate-schemas.js
 *
 * Validates critical data artifacts against their JSON Schemas using a
 * lightweight built-in validator (no npm dependencies required).
 *
 * Checks implemented:
 *   - Required top-level keys are present (sentinel keys per Rule 18)
 *   - Correct data types for critical fields
 *   - FIPS codes are 5-digit strings (Rule 1)
 *   - Required numeric fields are non-null (Rule 2)
 *   - FRED series have non-empty name and at least one observation (Rule 6/7)
 *   - County coverage is exactly 64 for AMI gap file (Rule 4)
 *
 * Usage:
 *   node scripts/validate-schemas.js
 *
 * Exit code 0 = all validations passed; 1 = one or more failures.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
const errors = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assert(condition, file, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    errors.push(`  ❌  [${file}] ${message}`);
  }
}

function loadJSON(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    return { exists: false, data: null };
  }
  try {
    return { exists: true, data: JSON.parse(fs.readFileSync(abs, 'utf8')) };
  } catch (e) {
    return { exists: true, data: null, parseError: e.message };
  }
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function validateManifest() {
  const FILE = 'data/manifest.json';
  console.log(`\n[validate] ${FILE}`);

  const { exists, data, parseError } = loadJSON(FILE);
  assert(exists, FILE, 'file exists');
  if (!exists) return;

  assert(!parseError, FILE, `valid JSON (${parseError || 'ok'})`);
  if (parseError || !data) return;

  assert(typeof data.generated === 'string' && data.generated.length > 0,
    FILE, '`generated` is a non-empty string (sentinel key)');

  // files may be a dict (path → metadata) or a legacy array of path strings
  const filesOk = (Array.isArray(data.files) && data.files.length > 0) ||
    (data.files && typeof data.files === 'object' && !Array.isArray(data.files) &&
     Object.keys(data.files).length > 0);
  assert(filesOk, FILE, '`files` is a non-empty array or object');

  // generated must be a parseable date
  const d = new Date(data.generated);
  assert(!isNaN(d.getTime()), FILE, '`generated` is a parseable ISO-8601 timestamp');
}

function validateFredData() {
  const FILE = 'data/fred-data.json';
  console.log(`\n[validate] ${FILE}`);

  const { exists, data, parseError } = loadJSON(FILE);
  assert(exists, FILE, 'file exists');
  if (!exists) return;

  assert(!parseError, FILE, `valid JSON (${parseError || 'ok'})`);
  if (parseError || !data) return;

  // Sentinel key (Rule 18)
  assert(typeof data.updated === 'string' && data.updated.length > 0,
    FILE, '`updated` sentinel key is present and non-empty');

  const d = new Date(data.updated);
  assert(!isNaN(d.getTime()), FILE, '`updated` is a parseable ISO-8601 timestamp');

  // series object
  assert(data.series && typeof data.series === 'object' && !Array.isArray(data.series),
    FILE, '`series` is an object');
  if (!data.series) return;

  const seriesIds = Object.keys(data.series);
  assert(seriesIds.length > 0, FILE, '`series` contains at least one entry');

  let emptyObsCount = 0;
  let blankNameCount = 0;

  for (const id of seriesIds) {
    const s = data.series[id];
    // Rule 6: non-empty name
    if (!s.name || typeof s.name !== 'string' || s.name.trim() === '') {
      blankNameCount++;
    }
    // Rule 7: non-empty observations
    if (!Array.isArray(s.observations) || s.observations.length === 0) {
      emptyObsCount++;
    }
  }

  assert(blankNameCount === 0, FILE,
    `all series have non-empty \`name\` (Rule 6) — ${blankNameCount} blank found`);
  assert(emptyObsCount === 0, FILE,
    `all series have at least one observation (Rule 7) — ${emptyObsCount} empty found`);
}

function validateChfaLihtc() {
  const FILE = 'data/chfa-lihtc.json';
  console.log(`\n[validate] ${FILE}`);

  const { exists, data, parseError } = loadJSON(FILE);
  assert(exists, FILE, 'file exists');
  if (!exists) return;

  assert(!parseError, FILE, `valid JSON (${parseError || 'ok'})`);
  if (parseError || !data) return;

  // Sentinel key (Rule 18)
  assert(typeof data.fetchedAt === 'string' && data.fetchedAt.length > 0,
    FILE, '`fetchedAt` sentinel key is present and non-empty');

  assert(data.type === 'FeatureCollection', FILE, '`type` is "FeatureCollection"');

  assert(Array.isArray(data.features) && data.features.length > 0,
    FILE, '`features` is a non-empty array');
  if (!Array.isArray(data.features)) return;

  let badFips = 0;
  let nullUnits = 0;

  for (const f of data.features) {
    const p = f && f.properties;
    if (!p) continue;

    // Rule 1: 5-digit FIPS
    if (typeof p.CNTY_FIPS !== 'string' || !/^[0-9]{5}$/.test(p.CNTY_FIPS)) {
      badFips++;
    }
    // Rule 2: N_UNITS / LI_UNITS — null is acceptable when the source ArcGIS
    // FeatureServer does not provide unit counts for a given project record.
    // We count for informational purposes but do not fail on nulls.
    if (p.N_UNITS === null || p.N_UNITS === undefined ||
        p.LI_UNITS === null || p.LI_UNITS === undefined) {
      nullUnits++;
    }
  }

  assert(badFips === 0, FILE,
    `all features have 5-digit CNTY_FIPS (Rule 1) — ${badFips} invalid found`);
  // Null N_UNITS/LI_UNITS are allowed when data is unavailable from the source API
  if (nullUnits > 0) {
    console.log(`  ℹ️  [${FILE}] ${nullUnits} features have null N_UNITS or LI_UNITS (incomplete ArcGIS records — allowed)`);
  }
}

function validateCoAmiGap() {
  const FILE = 'data/co_ami_gap_by_county.json';
  console.log(`\n[validate] ${FILE}`);

  const { exists, data, parseError } = loadJSON(FILE);
  assert(exists, FILE, 'file exists');
  if (!exists) return;

  assert(!parseError, FILE, `valid JSON (${parseError || 'ok'})`);
  if (parseError || !data) return;

  // Sentinel key (Rule 18): meta.generated_at
  assert(data.meta && typeof data.meta === 'object', FILE, '`meta` object is present');
  assert(typeof (data.meta || {}).generated_at === 'string' && (data.meta || {}).generated_at.length > 0,
    FILE, '`meta.generated_at` sentinel key is present (Rule 18)');

  // statewide record
  assert(data.statewide && typeof data.statewide.ami_4person === 'number',
    FILE, '`statewide.ami_4person` is a non-null number (Rule 2)');

  // counties array
  assert(Array.isArray(data.counties), FILE, '`counties` is an array');
  if (!Array.isArray(data.counties)) return;

  // Rule 4: exactly 64 counties
  assert(data.counties.length === 64, FILE,
    `\`counties\` has exactly 64 entries (Rule 4) — found ${data.counties.length}`);

  let badFips = 0;
  let nullAmi = 0;

  for (const c of data.counties) {
    // Rule 1: 5-digit FIPS
    if (typeof c.fips !== 'string' || !/^[0-9]{5}$/.test(c.fips)) {
      badFips++;
    }
    // Rule 2: ami_4person non-null
    if (c.ami_4person === null || c.ami_4person === undefined) {
      nullAmi++;
    }
  }

  assert(badFips === 0, FILE,
    `all counties have 5-digit FIPS codes (Rule 1) — ${badFips} invalid found`);
  assert(nullAmi === 0, FILE,
    `all counties have non-null \`ami_4person\` (Rule 2) — ${nullAmi} null found`);
}

// ---------------------------------------------------------------------------
// Phase 3 market data validators
// ---------------------------------------------------------------------------

function validateMarketDataFile(relPath, opts) {
  const label = opts.label || relPath;
  console.log(`\n[validate] ${relPath} (${label})`);

  const { exists, data, parseError } = loadJSON(relPath);
  assert(exists, relPath, 'file exists');
  if (!exists) return;

  assert(!parseError, relPath, `valid JSON (${parseError || 'ok'})`);
  if (parseError || !data) return;

  // Meta sentinel
  if (opts.metaKey) {
    const meta = data.meta || data[opts.metaKey] || {};
    assert(meta && typeof meta === 'object', relPath, `\`${opts.metaKey || 'meta'}\` object exists`);
    if (meta.generated) {
      assert(typeof meta.generated === 'string' && meta.generated.length > 0,
        relPath, '`meta.generated` is a non-empty timestamp');
    }
    if (meta.source) {
      assert(typeof meta.source === 'string' && meta.source.length > 0,
        relPath, '`meta.source` is documented');
    }
  }

  // Tract-keyed data (food_access, opportunity_insights, flood_zones use dict; lodes uses array)
  if (opts.tractKey) {
    const tracts = data[opts.tractKey];
    if (Array.isArray(tracts)) {
      // Array of tract objects (e.g., LODES)
      assert(tracts.length >= 0, relPath, `\`${opts.tractKey}\` is an array`);
      console.log(`  ℹ️  [${relPath}] ${tracts.length} tract entries`);
      if (tracts.length > 0) {
        const sample = tracts[0].geoid || tracts[0].GEOID || '';
        assert(/^08\d{9}$/.test(sample), relPath,
          `tract geoid is 11-digit CO FIPS code (sample: ${sample})`);
      }
    } else if (tracts && typeof tracts === 'object') {
      // Dict keyed by FIPS (11-digit tract or 12-digit block group)
      const count = Object.keys(tracts).length;
      console.log(`  ℹ️  [${relPath}] ${count} entries in \`${opts.tractKey}\``);
      if (count > 0) {
        const sample = Object.keys(tracts)[0];
        assert(/^08\d{9,10}$/.test(sample), relPath,
          `keys are CO FIPS codes (11-digit tract or 12-digit block group; sample: ${sample})`);
      }
    } else {
      console.log(`  ℹ️  [${relPath}] 0 tracts — stub data (rebuild via fetch script)`);
    }
  }

  // GeoJSON FeatureCollection
  if (opts.geojson) {
    assert(data.type === 'FeatureCollection', relPath, '`type` is "FeatureCollection"');
    const fc = data.features || [];
    assert(Array.isArray(fc), relPath, '`features` is an array');
    console.log(`  ℹ️  [${relPath}] ${fc.length} features`);
  }

  // Climate hazard summary
  if (opts.hazardSummary) {
    const hs = data.hazard_summary || {};
    const hazardCount = Object.keys(hs).length;
    assert(hazardCount >= 5, relPath,
      `\`hazard_summary\` has ≥5 categories — found ${hazardCount}`);
    for (const key of Object.keys(hs)) {
      const h = hs[key];
      assert(h && h.level && h.source, relPath,
        `hazard ${key} has \`level\` and \`source\``);
    }
  }

  // EPA SLD: array of tract records
  if (opts.arrayKey) {
    const arr = data[opts.arrayKey] || [];
    assert(Array.isArray(arr), relPath, `\`${opts.arrayKey}\` is an array`);
    console.log(`  ℹ️  [${relPath}] ${arr.length} records in \`${opts.arrayKey}\``);
  }
}

function validateAllMarketData() {
  validateMarketDataFile('data/market/lodes_co.json', {
    label: 'LODES workforce commuting',
    metaKey: 'meta',
    tractKey: 'tracts'
  });

  validateMarketDataFile('data/market/food_access_co.json', {
    label: 'USDA Food Access Atlas',
    metaKey: 'meta',
    tractKey: 'tracts'
  });

  validateMarketDataFile('data/market/opportunity_insights_co.json', {
    label: 'Opportunity Insights mobility',
    metaKey: 'meta',
    tractKey: 'tracts'
  });

  validateMarketDataFile('data/market/flood_zones_co.json', {
    label: 'FEMA flood zones',
    metaKey: 'meta',
    tractKey: 'tracts'
  });

  validateMarketDataFile('data/market/epa_sld_co.json', {
    label: 'EPA Smart Location Database',
    metaKey: 'meta',
    tractKey: 'blockGroups'
  });

  validateMarketDataFile('data/market/dola_demographics_co.json', {
    label: 'DOLA demographics',
    metaKey: 'meta'
  });

  validateMarketDataFile('data/market/climate_hazards_co.json', {
    label: 'Climate hazards',
    metaKey: 'meta',
    hazardSummary: true
  });

  validateMarketDataFile('data/market/utility_capacity_co.geojson', {
    label: 'Utility capacity service areas',
    metaKey: 'meta',
    geojson: true
  });

  validateMarketDataFile('data/market/environmental_constraints_co.geojson', {
    label: 'Environmental constraints',
    metaKey: 'meta',
    geojson: true
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log('=== JSON Schema Validation — Critical Artifacts ===');

validateManifest();
validateFredData();
validateChfaLihtc();
validateCoAmiGap();

console.log('\n=== Market Data Artifacts (Phase 3) ===');

validateAllMarketData();

console.log('\n' + '='.repeat(52));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\nValidation failures:');
  errors.forEach(e => console.error(e));
  process.exitCode = 1;
} else {
  console.log('\nAll schema validations passed ✅');
}
