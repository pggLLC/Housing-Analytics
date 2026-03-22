// test/integration/hna-ranking.test.js
//
// Unit tests for js/hna/hna-ranking-index.js and data/hna/ranking-index.json.
//
// Tests the ranking data structure, metric calculations, sort/filter logic,
// and the build script output without requiring a browser.
//
// Usage:
//   node test/integration/hna-ranking.test.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function test(name, fn) {
  console.log(`\n[test] ${name}`);
  try {
    fn();
  } catch (err) {
    console.error(`  ❌ FAIL: threw unexpected error — ${err.message}`);
    failed++;
  }
}

// ── Load ranking-index.json ──────────────────────────────────────────────────

const RANKING_PATH = path.join(ROOT, 'data', 'hna', 'ranking-index.json');

test('ranking-index.json exists', () => {
  assert(fs.existsSync(RANKING_PATH), `File exists at ${RANKING_PATH}`);
});

let rankingData = null;
test('ranking-index.json is valid JSON', () => {
  const raw = fs.readFileSync(RANKING_PATH, 'utf-8');
  rankingData = JSON.parse(raw);
  assert(typeof rankingData === 'object', 'Parsed as object');
});

test('metadata fields are present', () => {
  const meta = rankingData.metadata;
  assert(typeof meta === 'object', 'metadata is object');
  assert(typeof meta.generatedAt === 'string', 'generatedAt is string');
  assert(meta.generatedAt.endsWith('Z'), 'generatedAt ends with Z (UTC)');
  assert(typeof meta.totalCounties === 'number', 'totalCounties is number');
  assert(typeof meta.totalPlaces   === 'number', 'totalPlaces is number');
  assert(typeof meta.totalCDPs     === 'number', 'totalCDPs is number');
  assert(typeof meta.totalEntries  === 'number', 'totalEntries is number');
  assert(meta.version === '1.0', 'version is 1.0');
});

test('metrics config is present and non-empty', () => {
  const metrics = rankingData.metrics;
  assert(Array.isArray(metrics), 'metrics is array');
  assert(metrics.length >= 4, 'At least 4 metric definitions');
  const ids = metrics.map(m => m.id);
  assert(ids.includes('housing_gap_units'), 'housing_gap_units metric defined');
  assert(ids.includes('pct_cost_burdened'), 'pct_cost_burdened metric defined');
  assert(ids.includes('ami_gap_30pct'),     'ami_gap_30pct metric defined');
  assert(ids.includes('population_projection_20yr'), 'population_projection_20yr metric defined');
});

test('rankings array is non-empty', () => {
  const rankings = rankingData.rankings;
  assert(Array.isArray(rankings), 'rankings is array');
  assert(rankings.length > 0, `rankings has entries (got ${rankings.length})`);
});

test('Colorado has exactly 64 counties', () => {
  assert(rankingData.metadata.totalCounties === 64,
    `totalCounties === 64 (got ${rankingData.metadata.totalCounties})`);
});

test('each entry has required fields', () => {
  const required = ['geoid', 'name', 'type', 'region', 'metrics', 'rank', 'percentileRank', 'medianComparison'];
  let bad = 0;
  rankingData.rankings.forEach(e => {
    required.forEach(field => {
      if (!(field in e)) bad++;
    });
  });
  assert(bad === 0, `All entries have required fields (violations: ${bad})`);
});

test('entry types are valid', () => {
  const validTypes = new Set(['county', 'place', 'cdp']);
  const invalid = rankingData.rankings.filter(e => !validTypes.has(e.type));
  assert(invalid.length === 0, `All entries have valid type (invalid: ${invalid.length})`);
});

test('county FIPS codes are 5-digit strings', () => {
  const counties = rankingData.rankings.filter(e => e.type === 'county');
  const bad = counties.filter(e => !/^\d{5}$/.test(e.geoid));
  assert(bad.length === 0,
    `All county geoids are 5-digit strings (bad: ${bad.map(e => e.geoid).join(', ') || 'none'})`);
});

test('ranks are sequential starting at 1', () => {
  const ranks = rankingData.rankings.map(e => e.rank);
  const min = Math.min(...ranks);
  const max = Math.max(...ranks);
  assert(min === 1, `Minimum rank is 1 (got ${min})`);
  assert(max === rankingData.rankings.length, `Maximum rank equals entry count`);
});

test('housing_gap_units is non-negative integer for counties', () => {
  const counties = rankingData.rankings.filter(e => e.type === 'county');
  const bad = counties.filter(e =>
    typeof e.metrics.housing_gap_units !== 'number' || e.metrics.housing_gap_units < 0
  );
  assert(bad.length === 0, `All county housing_gap_units are non-negative (bad: ${bad.length})`);
});

test('pct_cost_burdened is between 0 and 100', () => {
  const bad = rankingData.rankings.filter(e => {
    const v = e.metrics.pct_cost_burdened;
    return typeof v !== 'number' || v < 0 || v > 100;
  });
  assert(bad.length === 0, `All pct_cost_burdened values in [0,100] (bad: ${bad.length})`);
});

test('percentileRank is between 0 and 100', () => {
  const bad = rankingData.rankings.filter(e =>
    typeof e.percentileRank !== 'number' || e.percentileRank < 0 || e.percentileRank > 100
  );
  assert(bad.length === 0, `All percentileRank values in [0,100] (bad: ${bad.length})`);
});

test('top-ranked entry has highest housing_gap_units', () => {
  const top = rankingData.rankings.find(e => e.rank === 1);
  const allGaps = rankingData.rankings.map(e => e.metrics.housing_gap_units);
  const maxGap = Math.max(...allGaps);
  assert(top && top.metrics.housing_gap_units === maxGap,
    `Rank #1 has highest housing_gap_units (${top ? top.metrics.housing_gap_units : 'N/A'} === ${maxGap})`);
});

// ── Test sort/filter logic (inline, no DOM) ──────────────────────────────────

test('sort descending by housing_gap_units', () => {
  const entries = rankingData.rankings.slice(0, 20);
  const sorted = [...entries].sort((a, b) =>
    b.metrics.housing_gap_units - a.metrics.housing_gap_units
  );
  let monotone = true;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].metrics.housing_gap_units > sorted[i - 1].metrics.housing_gap_units) {
      monotone = false;
      break;
    }
  }
  assert(monotone, 'Descending sort produces monotonically non-increasing values');
});

test('filter by type=county', () => {
  const filtered = rankingData.rankings.filter(e => e.type === 'county');
  assert(filtered.every(e => e.type === 'county'), 'All filtered entries are counties');
  assert(filtered.length === rankingData.metadata.totalCounties,
    `County filter returns ${rankingData.metadata.totalCounties} entries`);
});

test('filter by region=Front Range', () => {
  const filtered = rankingData.rankings.filter(e => e.region === 'Front Range');
  assert(filtered.length > 0, 'Front Range has at least 1 entry');
  assert(filtered.every(e => e.region === 'Front Range'), 'All entries are Front Range');
});

test('name search is case-insensitive', () => {
  const query = 'denver';
  const filtered = rankingData.rankings.filter(e =>
    e.name.toLowerCase().includes(query)
  );
  assert(filtered.length > 0, `Search for "${query}" returns results`);
  assert(filtered.every(e => e.name.toLowerCase().includes(query)), 'All results match query');
});

// ── Validate HNA page HTML ───────────────────────────────────────────────────

const HNA_RANK_HTML = path.join(ROOT, 'hna-comparative-analysis.html');

test('hna-comparative-analysis.html exists', () => {
  assert(fs.existsSync(HNA_RANK_HTML), 'HTML file exists');
});

test('hna-comparative-analysis.html has required landmark elements', () => {
  const html = fs.readFileSync(HNA_RANK_HTML, 'utf-8');
  assert(html.includes('<main'), 'Has <main> landmark');
  assert(html.includes('id="main-content"'), 'main has id="main-content"');
  assert(html.includes('href="#main-content"'), 'Skip link targets #main-content');
});

test('hna-comparative-analysis.html has aria-live region', () => {
  const html = fs.readFileSync(HNA_RANK_HTML, 'utf-8');
  assert(html.includes('aria-live="polite"'), 'Has aria-live="polite" region');
});

test('hna-comparative-analysis.html loads hna-ranking-index.js', () => {
  const html = fs.readFileSync(HNA_RANK_HTML, 'utf-8');
  assert(html.includes('hna-ranking-index.js'), 'Script tag for hna-ranking-index.js present');
});

test('hna-comparative-analysis.html has table with aria-label', () => {
  const html = fs.readFileSync(HNA_RANK_HTML, 'utf-8');
  assert(html.includes('<table'), 'Has <table> element');
  assert(html.includes('aria-label='), 'Table has aria-label');
});

// ── Validate JS module ───────────────────────────────────────────────────────

const JS_PATH = path.join(ROOT, 'js', 'hna', 'hna-ranking-index.js');

test('hna-ranking-index.js exists', () => {
  assert(fs.existsSync(JS_PATH), 'JS module exists');
});

test('hna-ranking-index.js exposes window.HNARanking', () => {
  const src = fs.readFileSync(JS_PATH, 'utf-8');
  assert(src.includes('window.HNARanking'), 'Exposes window.HNARanking');
});

test('hna-ranking-index.js has exportCSV function', () => {
  const src = fs.readFileSync(JS_PATH, 'utf-8');
  assert(src.includes('exportCSV'), 'Has exportCSV function');
});

test('hna-ranking-index.js has sortEntries function', () => {
  const src = fs.readFileSync(JS_PATH, 'utf-8');
  assert(src.includes('sortEntries'), 'Has sortEntries function');
});

test('hna-ranking-index.js has applyFilters function', () => {
  const src = fs.readFileSync(JS_PATH, 'utf-8');
  assert(src.includes('applyFilters'), 'Has applyFilters function');
});

// ── Validate build script ────────────────────────────────────────────────────

const BUILD_SCRIPT = path.join(ROOT, 'scripts', 'hna', 'build_ranking_index.py');

test('build_ranking_index.py exists', () => {
  assert(fs.existsSync(BUILD_SCRIPT), 'Build script exists');
});

test('build_ranking_index.py has 5-digit FIPS enforcement', () => {
  const src = fs.readFileSync(BUILD_SCRIPT, 'utf-8');
  assert(src.includes('.zfill(5)'), 'Uses zfill(5) for FIPS padding (Rule 1)');
});

// ── Final summary ────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(55)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
