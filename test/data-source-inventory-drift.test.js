#!/usr/bin/env node
// test/data-source-inventory-drift.test.js
// Executable reconciliation between Data Trust Center counts and committed data.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ROOT,
  loadSources,
  resolveLocalFile,
  assertInventoryPaths,
} = require('./data-source-inventory-paths.test.js');

const JSON_COUNT_PATHS = {
  'lihtc-trends-county': 'counties',
  'co-historical-allocations': 'allocations',
  'prop123-jurisdictions': 'jurisdictions',
  'fred-data': 'series',
  'acs-state': 'data',
  'acs-tract-metrics': 'tracts',
  'tract-centroids-co': 'tracts',
  'lodes-co': 'tracts',
  'cde-schools-co': 'districts',
  'cdle-job-postings-co': 'counties',
  'cdot-traffic-co': 'stations',
  'car-market-report': 'metro_areas',
  'ami-gap': 'counties',
  'hud-fair-market-rents': 'counties',
  'hud-income-limits': 'counties',
  'zillow-zhvi': 'zhvi_metro',
  'zillow-zori': 'zori_metro',
  'bls-laus': 'counties',
  'market-reference-projects': 'projects',
  'fred-cpi': 'series.CPIAUCSL.observations',
  'fred-housing-cpi': 'series.CUUR0000SAH1.observations',
  'fred-unrate': 'series.UNRATE.observations',
  'fred-mortgage30': 'series.MORTGAGE30US.observations',
  'fred-co-housing-permits': 'series.COBPPRIV.observations',
  'kalshi-housing': 'items',
  'data-manifest': 'files',
  'housing-legislation-2026': 'entries',
  'regrid-parcels': 'counties',
};

const COUNTY_DIRECTORY_IDS = new Set([
  'dola-sya',
  'lehd-wac',
  'hna-projections',
  'hna-county-profiles',
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function valueAt(obj, dottedPath) {
  return dottedPath.split('.').reduce((value, key) => value && value[key], obj);
}

function collectionCount(value, sourceId) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  throw new Error(`${sourceId} count target is not an array or object`);
}

function coloradoCountyDirectoryCount(directory) {
  const registry = readJson(path.join(ROOT, 'data/hna/geo-config.json'));
  return registry.counties.filter((county) => (
    fs.existsSync(path.join(directory, `${county.geoid}.json`))
  )).length;
}

function actualFeatureCount(source) {
  const file = resolveLocalFile(source.localFile);
  if (COUNTY_DIRECTORY_IDS.has(source.id)) return coloradoCountyDirectoryCount(file);

  if (file.endsWith('.csv')) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    return lines.slice(1).filter((line) => line.trim()).length;
  }

  const data = readJson(file);
  if (source.id === 'co-demographics') return 1;
  if (source.id === 'projection-scenarios') return Object.keys(data).length;
  if (source.id === 'epa-cleanup-co') {
    return collectionCount(data.superfundSites, source.id)
      + collectionCount(data.brownfieldSites, source.id);
  }
  if (JSON_COUNT_PATHS[source.id]) {
    return collectionCount(valueAt(data, JSON_COUNT_PATHS[source.id]), source.id);
  }
  if (Array.isArray(data.features)) return data.features.length;
  throw new Error(`${source.id} has no executable feature-count strategy`);
}

function verifySource(source) {
  if (source.features === null) {
    assert.equal(source.featuresCountable, false, `${source.id} must explicitly disable its count`);
    assert.equal(source.localFile, null, `${source.id} must not advertise an uncounted local file`);
    assert.match(source.featuresUnavailableReason || '', /no .*count|stable record count/i,
      `${source.id} must carry a reason for its unavailable count`);
    assert.match(source.description || '', /no .*count|stable record count/i,
      `${source.id} must show the unavailable-count reason in the rendered description`);
    return;
  }

  assert.equal(typeof source.features, 'number', `${source.id} features must be numeric or null`);
  assert(source.localFile, `${source.id} declares a count without a localFile`);
  const actual = actualFeatureCount(source);
  assert.equal(
    source.features,
    actual,
    `${source.id} declares ${source.features} features but committed data contains ${actual}`,
  );
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

function verifyCsvCounts(sources) {
  const lines = global.DataSourceInventory.toCSV().split('\n');
  const headers = parseCsvLine(lines.shift());
  assert.equal(headers.at(-1), 'features', 'CSV column order must retain features as the final column');
  assert.equal(lines.length, sources.length, 'CSV must contain one row per inventory source');

  const rowsById = new Map(lines.map((line) => {
    const values = parseCsvLine(line);
    return [values[0], Object.fromEntries(headers.map((header, index) => [header, values[index]]))];
  }));

  sources.forEach((source) => {
    const row = rowsById.get(source.id);
    assert(row, `${source.id} must appear in the CSV export`);
    const expected = source.features === null ? '' : String(actualFeatureCount(source));
    assert.equal(
      row.features,
      expected,
      `${source.id} CSV features value must agree with its committed localFile`,
    );
  });

  const ddaRow = rowsById.get('dda-colorado');
  assert.equal(ddaRow.features, '10', 'DDA CSV row must report the 10 records in data/dda-colorado.json');
}

const sources = loadSources();
assertInventoryPaths(sources);
sources.forEach(verifySource);
verifyCsvCounts(sources);

for (const id of ['cde-schools-co', 'cdle-job-postings-co', 'cdot-traffic-co']) {
  const source = sources.find((entry) => entry.id === id);
  assert.match(source.description, /excluded from production PMA scoring/i,
    `${id} must disclose its exclusion from production scoring`);
  assert.doesNotMatch(source.description, /used for .*scoring/i,
    `${id} must not claim to drive production scoring`);
}

const scoringDoc = fs.readFileSync(path.join(ROOT, 'docs/PMA_SCORING.md'), 'utf8');
for (const label of ['CDLE vacancy rates', 'CDE school quality', 'CDOT traffic connectivity']) {
  assert.match(scoringDoc, new RegExp(`\\| ${label} \\| Excluded \\|`),
    `${label} must be documented as excluded`);
}
assert.match(scoringDoc, /measured terms are renormalized/i,
  'workforce methodology must disclose measured-term renormalization');

// Non-vacuous sabotage guard: a one-record DDA drift must be rejected.
const dda = sources.find((source) => source.id === 'dda-colorado');
assert.throws(
  () => verifySource(Object.assign({}, dda, { features: dda.features + 1 })),
  /declares 11 features but committed data contains 10/,
);

console.log(`data-source-inventory drift: PASS (${sources.length} sources reconciled)`);
