// scripts/audit/inventory-count-paths.cjs
//
// Single source of truth for *how* each inventory source's `features:` count
// is derived from its committed data file.
//
// Two consumers, and they must never disagree:
//   - test/data-source-inventory-drift.test.js  — the gate. Asserts the
//     declared `features:` equals what the committed file actually holds.
//   - scripts/audit/refresh-inventory-mtimes.mjs — the fixer. Recomputes
//     `features:` from the same files so append-only series don't turn main
//     red on every refresh (fred-mortgage30 gains one weekly observation).
//
// It lives here rather than in the test because the test executes its
// assertions at import time; an ESM script can't `import` it without running
// the whole suite as a side effect.

// Source id → dotted path into the parsed JSON whose collection size is the
// feature count. Arrays count by `.length`, plain objects by
// `Object.keys().length`.
//
// A value may also be an ARRAY of paths, whose counts are summed. epa-cleanup-co
// needed this: its count is superfundSites + brownfieldSites, which the gate
// expressed as a hand-written special case while this module could only hold a
// single path — so the fixer could not repair what the gate asserted, and an
// EPA refresh that added two brownfield sites turned main red with no automated
// way back. The header above promises these two consumers never disagree; this
// is what keeping that promise requires.
const JSON_COUNT_PATHS = {
  'epa-cleanup-co': ['superfundSites', 'brownfieldSites'],
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

// These count per-county files present in a directory against the geo-config
// registry, not a path inside a single JSON document. The refresher leaves
// them alone — see the note in refresh-inventory-mtimes.mjs.
const COUNTY_DIRECTORY_IDS = new Set([
  'dola-sya',
  'lehd-wac',
  'hna-projections',
  'hna-county-profiles',
]);

function valueAt(obj, dottedPath) {
  return dottedPath.split('.').reduce((value, key) => value && value[key], obj);
}

function collectionCount(value, sourceId) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  throw new Error(`${sourceId} count target is not an array or object`);
}

/**
 * countFor — resolve a source's feature count from its parsed data, handling
 * both a single dotted path and a summed list of them.
 * @returns {number|null} null when the source has no registered path
 */
function countFor(sourceId, data) {
  const spec = JSON_COUNT_PATHS[sourceId];
  if (!spec) return null;
  const paths = Array.isArray(spec) ? spec : [spec];
  return paths.reduce(
    (total, path) => total + collectionCount(valueAt(data, path), sourceId),
    0
  );
}

module.exports = { JSON_COUNT_PATHS, COUNTY_DIRECTORY_IDS, valueAt, collectionCount, countFor };
