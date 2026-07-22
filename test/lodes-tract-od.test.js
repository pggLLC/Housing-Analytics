const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

const doc = readJson('data/market/lodes_tract_od_co.json');
const builder = fs.readFileSync(path.join(ROOT, 'scripts', 'hna', 'build_tract_od_matrix.py'), 'utf8');
const freshnessSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'audit', 'benchmark-freshness-check.mjs'), 'utf8');
const scoringSource = fs.readFileSync(path.join(ROOT, 'js', 'market-analysis-scoring.js'), 'utf8');
const pmaSource = fs.readFileSync(path.join(ROOT, 'js', 'market-analysis.js'), 'utf8');
const commuteShapedSource = fs.readFileSync(path.join(ROOT, 'js', 'pma-commute-shaped.js'), 'utf8');

assert(doc.meta, 'artifact exposes meta');
assert.equal(doc.meta.source, 'LEHD LODES8 Origin-Destination (OD Main, All Jobs)');
assert.equal(doc.meta.lodes_version, 'LODES8');
assert.equal(doc.meta.vintage, '2023');
assert.equal(doc.meta.year, 2023);
assert.equal(doc.meta.generated_by, 'scripts/hna/build_tract_od_matrix.py');
assert.equal(doc.meta.context_only, true, 'artifact is context-only');
assert.equal(doc.meta.not_scoring_input, true, 'artifact is not a scoring input');
assert.equal(doc.meta.source_url, 'https://lehd.ces.census.gov/data/lodes/LODES8/co/od/co_od_main_JT00_2023.csv.gz');
assert.match(doc.meta.fetch_date, /^\d{4}-\d{2}-\d{2}$/, 'fetch_date is ISO');
assert.match(doc.meta.last_verified, /^\d{4}-\d{2}-\d{2}$/, 'last_verified is ISO');
assert.match(doc.meta.review_by, /^\d{4}-\d{2}-\d{2}$/, 'review_by is ISO');
assert.match(doc.meta.citation, /U\.S\. Census Bureau/, 'LODES public-domain citation is pinned');
assert(doc.meta.limitations.some((line) => /synthetic-noise-protected jobs data/.test(line)), 'LODES limitation is pinned');
assert.equal(doc.meta.coverage_floor, 0.95, '95% materiality floor was retained');

const pairs = doc.pairs || [];
assert(Array.isArray(pairs), 'pairs is an array');
assert.equal(pairs.length, doc.meta.retained_pair_count, 'retained_pair_count matches committed rows');
assert(pairs.length >= 400000 && pairs.length <= 550000, `pair shrink guard: ${pairs.length}`);
assert(doc.meta.unique_pair_count >= pairs.length, 'unique_pair_count covers retained rows');
assert(doc.meta.unique_pair_count >= 550000 && doc.meta.unique_pair_count <= 700000, `unique pair shrink guard: ${doc.meta.unique_pair_count}`);
assert(doc.meta.rows_streamed >= 2400000 && doc.meta.rows_streamed <= 2700000, `source row shrink guard: ${doc.meta.rows_streamed}`);
assert(doc.meta.total_flow >= 2600000 && doc.meta.total_flow <= 2900000, `statewide flow shrink guard: ${doc.meta.total_flow}`);
assert.equal(doc.meta.minimum_jobs_cutoff, 1, '95% coverage keeps the implied cutoff disclosed');

let retainedFlow = 0;
let lastJobs = Infinity;
const pairMap = new Map();
for (const row of pairs) {
  assert(Array.isArray(row) && row.length === 3, 'pair row is [home_tract, work_tract, jobs]');
  const [homeTract, workTract, jobs] = row;
  assert.match(homeTract, /^08\d{9}$/, `${homeTract} is an 11-digit Colorado tract GEOID`);
  assert.match(workTract, /^08\d{9}$/, `${workTract} is an 11-digit Colorado tract GEOID`);
  assert(Number.isInteger(jobs) && jobs > 0, `${homeTract}->${workTract} has positive integer jobs`);
  assert(jobs <= lastJobs, 'pairs are sorted descending by S000 jobs');
  lastJobs = jobs;
  retainedFlow += jobs;
  pairMap.set(`${homeTract}->${workTract}`, jobs);
}

assert.equal(retainedFlow, doc.meta.retained_flow, 'retained_flow recomputes from committed rows');
const retainedShare = retainedFlow / doc.meta.total_flow;
assert(retainedShare >= doc.meta.coverage_floor, `retained share ${retainedShare} meets declared floor ${doc.meta.coverage_floor}`);
assert(Math.abs(retainedShare - doc.meta.retained_flow_share) <= 0.000001, 'retained_flow_share recomputes from committed rows');
assert.equal(doc.meta.dropped_flow, doc.meta.total_flow - retainedFlow, 'dropped_flow recomputes from committed rows');

const fruitaToGj = pairMap.get('08077001503->08077000900');
assert(fruitaToGj >= 300 && fruitaToGj <= 600, `Fruita-area home tract to Grand Junction work tract flow is plausible: ${fruitaToGj}`);

const gjToFruitaArea = [
  '08077000900->08077001504',
  '08077000900->08077001502',
  '08077000900->08077001600',
].map((key) => pairMap.get(key) || 0);
assert(gjToFruitaArea.some((jobs) => jobs >= 45), `Grand Junction to Fruita-area reverse flows are present: ${gjToFruitaArea.join(', ')}`);

assert(builder.includes('from build_place_od_flows import OD_URL_TMPL, RAW_DIR, _download'), 'builder reuses the existing place-OD download/cache path');
assert(builder.includes('DEFAULT_COVERAGE_FLOOR = 0.95'), 'builder pins the coverage-defined 95% floor');
assert(builder.includes('FALLBACK_COVERAGE_FLOOR = 0.90'), 'builder discloses the 90% size fallback path');
assert(freshnessSrc.includes('data/market/lodes_tract_od_co.json'), 'benchmark freshness audit includes tract OD artifact');

assert(!scoringSource.includes('lodes_tract_od_co.json'), 'tract OD artifact is not wired into PMA scoring');
assert(!pmaSource.includes('lodes_tract_od_co.json'), 'tract OD artifact is not fetched by default PMA runtime');
assert(commuteShapedSource.includes('data/market/lodes_tract_od_co.json'), 'D-F2 commute-shaped module is the intentional OD artifact consumer');
assert(commuteShapedSource.includes('Commute-shaped PMA (beta)'), 'OD consumer is labeled as the opt-in beta mode');

console.log(`lodes-tract-od: PASS (${pairs.length} retained pairs, ${(retainedShare * 100).toFixed(2)}% coverage)`);
