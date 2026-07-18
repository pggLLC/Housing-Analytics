const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = process.env.HUD_ZIP_TRACT_CROSSWALK_PATH
  ? path.resolve(process.env.HUD_ZIP_TRACT_CROSSWALK_PATH)
  : path.join(ROOT, 'data', 'market', 'hud_zip_tract_crosswalk_co.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assertIsoDate(value, label) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')), `${label} must be YYYY-MM-DD`);
}

function run() {
  const doc = readJson(DATA_PATH);
  assert(doc && typeof doc === 'object', 'crosswalk artifact is a JSON object');
  assert(doc.meta && typeof doc.meta === 'object', 'crosswalk artifact exposes meta');
  assert(Array.isArray(doc.rows), 'crosswalk artifact exposes rows');
  assert(doc.rows.length > 2000, `crosswalk row count is non-vacuous (${doc.rows.length})`);

  assert.strictEqual(doc.meta.source, 'HUD-USPS ZIP Code Crosswalk API');
  assert.strictEqual(doc.meta.source_url, 'https://www.huduser.gov/hudapi/public/usps');
  assert.strictEqual(doc.meta.source_docs_url, 'https://www.huduser.gov/portal/dataset/uspszip-api.html');
  assert.strictEqual(doc.meta.state_fips, '08');
  assert.strictEqual(doc.meta.crosswalk_type, 'zip-tract');
  assert.strictEqual(doc.meta.api_type, '1');
  assert.strictEqual(doc.meta.api_query, 'CO');
  assertIsoDate(doc.meta.last_verified, 'meta.last_verified');
  assertIsoDate(doc.meta.review_by, 'meta.review_by');
  assert.strictEqual(doc.meta.row_count, doc.rows.length, 'meta.row_count matches rows.length');

  const zips = new Set();
  const tracts = new Set();
  const seen = new Set();
  for (const row of doc.rows) {
    assert(/^\d{5}$/.test(row.zip), `ZIP is five digits: ${row.zip}`);
    assert(/^08\d{9}$/.test(row.tract), `tract is an 11-digit Colorado GEOID: ${row.tract}`);
    const key = `${row.zip}:${row.tract}`;
    assert(!seen.has(key), `duplicate ZIP/tract row ${key}`);
    seen.add(key);
    zips.add(row.zip);
    tracts.add(row.tract);
    for (const field of ['res_ratio', 'bus_ratio', 'oth_ratio', 'tot_ratio']) {
      assert(Number.isFinite(row[field]), `${field} is numeric for ${key}`);
      assert(row[field] >= 0 && row[field] <= 1, `${field} in [0,1] for ${key}`);
    }
  }

  assert(zips.size > 300, `ZIP coverage is non-vacuous (${zips.size})`);
  assert(tracts.size > 1000, `tract coverage is non-vacuous (${tracts.size})`);
  assert.strictEqual(doc.meta.zip_count, zips.size, 'meta.zip_count matches unique ZIPs');
  assert.strictEqual(doc.meta.tract_count, tracts.size, 'meta.tract_count matches unique tracts');

  const fetcher = fs.readFileSync(
    path.join(ROOT, 'scripts', 'market', 'fetch_hud_zip_tract_crosswalk.py'),
    'utf8',
  );
  assert(fetcher.includes('HUD_API_TOKEN'), 'fetcher uses the HUD_API_TOKEN credential gate');
  assert(fetcher.includes('type=1') || fetcher.includes('TYPE_ZIP_TRACT = "1"'), 'fetcher pins ZIP-to-tract type=1');
  assert(fetcher.includes('query=CO') || fetcher.includes('QUERY_STATE = "CO"'), 'fetcher pins Colorado query=CO');

  console.log(`hud-zip-tract-crosswalk: PASS (${doc.rows.length} rows, ${zips.size} ZIPs, ${tracts.size} tracts)`);
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exit(1);
}
