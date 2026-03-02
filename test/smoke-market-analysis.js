/**
 * test/smoke-market-analysis.js
 *
 * CI/CD smoke test that verifies:
 *  1. market-analysis.html exists and references js/market-analysis.js
 *  2. Required data artifacts exist (data/market/*)
 *  3. Prop 123 fallback file exists: data/prop123_jurisdictions.json
 *  4. js/market-analysis.js exists and is non-empty
 *  5. css/pages/market-analysis.css exists and is non-empty
 *
 * Usage:
 *   node test/smoke-market-analysis.js
 *
 * Exit code 0 = all checks passed; non-zero = one or more failures.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

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

function fileExists(relPath) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) return false;
  const dir  = path.dirname(full);
  const base = path.basename(full);
  return fs.readdirSync(dir).includes(base);
}

function fileNonEmpty(relPath) {
  const full = path.join(ROOT, relPath);
  try { return fs.statSync(full).size > 0; } catch (_) { return false; }
}

function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

// ---------------------------------------------------------------------------
// market-analysis.html
// ---------------------------------------------------------------------------
test('market-analysis.html: page exists at repository root', () => {
  assert(fileExists('market-analysis.html'), 'market-analysis.html exists');
  assert(fileNonEmpty('market-analysis.html'), 'market-analysis.html is non-empty');
});

test('market-analysis.html: references js/market-analysis.js', () => {
  if (!fileExists('market-analysis.html')) {
    assert(false, 'market-analysis.html missing — cannot check script references');
    return;
  }
  const html = readFile('market-analysis.html');
  assert(html.includes('js/market-analysis.js'), 'js/market-analysis.js is referenced');
});

// ---------------------------------------------------------------------------
// js/market-analysis.js
// ---------------------------------------------------------------------------
test('js/market-analysis.js: module exists and is non-empty', () => {
  assert(fileExists('js/market-analysis.js'), 'js/market-analysis.js exists');
  assert(fileNonEmpty('js/market-analysis.js'), 'js/market-analysis.js is non-empty');
});

// ---------------------------------------------------------------------------
// css/pages/market-analysis.css
// ---------------------------------------------------------------------------
test('css/pages/market-analysis.css: stylesheet exists and is non-empty', () => {
  assert(fileExists('css/pages/market-analysis.css'), 'css/pages/market-analysis.css exists');
  assert(fileNonEmpty('css/pages/market-analysis.css'), 'css/pages/market-analysis.css is non-empty');
});

// ---------------------------------------------------------------------------
// Data artifacts
// ---------------------------------------------------------------------------
test('data/market: directory and artifact files exist', () => {
  assert(fileExists('data/market'), 'data/market/ directory exists');
  assert(fileExists('data/market/tract_centroids_co.json'), 'tract_centroids_co.json exists');
  assert(fileExists('data/market/acs_tract_metrics_co.json'), 'acs_tract_metrics_co.json exists');
  assert(fileExists('data/market/hud_lihtc_co.geojson'), 'hud_lihtc_co.geojson exists');
});

test('data/market: artifact files are non-empty', () => {
  const files = [
    'data/market/tract_centroids_co.json',
    'data/market/acs_tract_metrics_co.json',
    'data/market/hud_lihtc_co.geojson',
  ];
  for (const f of files) {
    if (fileExists(f)) {
      assert(fileNonEmpty(f), `${f} is non-empty`);
    }
  }
});

test('data/market: artifact files contain valid JSON', () => {
  const files = [
    'data/market/tract_centroids_co.json',
    'data/market/acs_tract_metrics_co.json',
    'data/market/hud_lihtc_co.geojson',
  ];
  for (const f of files) {
    if (fileExists(f) && fileNonEmpty(f)) {
      try {
        const data = JSON.parse(readFile(f));
        assert(data !== null, `${f} parses as valid JSON`);
      } catch (e) {
        assert(false, `${f} is valid JSON — ${e.message}`);
      }
    }
  }
});

test('data/market/hud_lihtc_co.geojson: is a valid GeoJSON FeatureCollection', () => {
  const f = 'data/market/hud_lihtc_co.geojson';
  if (!fileExists(f)) return;
  const data = JSON.parse(readFile(f));
  assert(data.type === 'FeatureCollection', 'type is FeatureCollection');
  assert(Array.isArray(data.features), 'features is an array');
});

// ---------------------------------------------------------------------------
// Prop 123 fallback file
// ---------------------------------------------------------------------------
test('data/prop123_jurisdictions.json: fallback file exists', () => {
  assert(fileExists('data/prop123_jurisdictions.json'), 'data/prop123_jurisdictions.json exists');
  assert(fileNonEmpty('data/prop123_jurisdictions.json'), 'data/prop123_jurisdictions.json is non-empty');
});

// ---------------------------------------------------------------------------
// Navigation update
// ---------------------------------------------------------------------------
test('js/navigation.js: contains Market Analysis link', () => {
  if (!fileExists('js/navigation.js')) {
    assert(false, 'js/navigation.js missing');
    return;
  }
  const js = readFile('js/navigation.js');
  assert(js.includes('market-analysis.html'), 'Market Analysis link (market-analysis.html) present in navigation.js');
  assert(js.includes('Market Analysis'), '"Market Analysis" label present in navigation.js');
});

// ---------------------------------------------------------------------------
// GitHub Actions workflow
// ---------------------------------------------------------------------------
test('.github/workflows/build-market-data.yml: workflow file exists', () => {
  assert(fileExists('.github/workflows/build-market-data.yml'), 'build-market-data.yml exists');
  if (fileExists('.github/workflows/build-market-data.yml')) {
    const yml = readFile('.github/workflows/build-market-data.yml');
    assert(yml.includes('workflow_dispatch'), 'workflow_dispatch trigger present');
    assert(yml.includes('build_public_market_data.py'), 'Python builder referenced');
  }
});

// ---------------------------------------------------------------------------
// Python builder script
// ---------------------------------------------------------------------------
test('scripts/market/build_public_market_data.py: script exists', () => {
  assert(fileExists('scripts/market/build_public_market_data.py'), 'build_public_market_data.py exists');
  assert(fileNonEmpty('scripts/market/build_public_market_data.py'), 'build_public_market_data.py is non-empty');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\nSome checks failed. Review the output above for details.');
  process.exitCode = 1;
} else {
  console.log('\nAll smoke tests passed ✅');
}
