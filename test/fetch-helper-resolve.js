// test/fetch-helper-resolve.js
//
// Unit tests for the resolveAssetUrl() function in js/fetch-helper.js.
//
// Specifically validates the fix for the double base-path prefix bug:
//   Root-relative paths (starting with "/") must be returned unchanged so that
//   an already-resolved path like /Housing-Analytics/data/foo.json is NOT
//   double-prefixed to /Housing-Analytics/Housing-Analytics/data/foo.json.
//
// Usage:
//   node test/fetch-helper-resolve.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '..', 'js', 'fetch-helper.js');

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

// ---------------------------------------------------------------------------
// Extract and re-implement resolveAssetUrl for Node.js testing
// ---------------------------------------------------------------------------
// The function is defined inside an IIFE and not exported, so we read the
// source and extract the implementation body for isolated testing.

const src = fs.readFileSync(SCRIPT, 'utf8');

// Build a minimal test harness that runs resolveAssetUrl with a given BASE.
function makeResolver(basePath) {
  // Inline the function body from the actual source, parameterised by BASE.
  const fn = new Function('BASE', `
    function resolveAssetUrl(relativePath) {
      if (/^https?:\\/\\//i.test(relativePath) || /^data:/i.test(relativePath)) {
        return relativePath;
      }
      if (relativePath && relativePath.charAt(0) === '/') {
        return relativePath;
      }
      var clean = (relativePath || '').replace(/^\\.\\//,'');
      return BASE + clean;
    }
    return resolveAssetUrl;
  `);
  return fn(basePath);
}

// Also build an inline copy from the actual source text to catch any drift.
function makeResolverFromSource(basePath) {
  // Extract the resolveAssetUrl function from the actual file source.
  const match = src.match(/function resolveAssetUrl\(relativePath\)[\s\S]*?^  \}/m);
  if (!match) return null;
  const fn = new Function('BASE', `
    ${match[0]}
    return resolveAssetUrl;
  `);
  return fn(basePath);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('fetch-helper.js source file exists and is non-empty', () => {
  assert(fs.existsSync(SCRIPT), 'fetch-helper.js exists at js/fetch-helper.js');
  assert(src.length > 100, 'fetch-helper.js is non-empty');
});

test('resolveAssetUrl is exported onto window', () => {
  assert(src.includes('window.resolveAssetUrl = resolveAssetUrl'), 'window.resolveAssetUrl is assigned');
});

test('resolveAssetUrl: relative paths get BASE prepended (GitHub Pages sub-path)', () => {
  const resolve = makeResolver('/Housing-Analytics/');
  assert(
    resolve('data/chfa-lihtc.json') === '/Housing-Analytics/data/chfa-lihtc.json',
    'relative path "data/chfa-lihtc.json" → /Housing-Analytics/data/chfa-lihtc.json'
  );
  assert(
    resolve('maps/us-states.geojson') === '/Housing-Analytics/maps/us-states.geojson',
    'relative path "maps/us-states.geojson" → /Housing-Analytics/maps/us-states.geojson'
  );
  assert(
    resolve('js/vendor/images/marker-icon.png') === '/Housing-Analytics/js/vendor/images/marker-icon.png',
    'relative path "js/vendor/images/marker-icon.png" → /Housing-Analytics/js/vendor/images/marker-icon.png'
  );
  assert(
    resolve('data/hna/lihtc/08031.json') === '/Housing-Analytics/data/hna/lihtc/08031.json',
    'nested relative path → correct prefixed URL'
  );
});

test('resolveAssetUrl: dot-slash prefixed paths get BASE prepended', () => {
  const resolve = makeResolver('/Housing-Analytics/');
  assert(
    resolve('./data/chfa-lihtc.json') === '/Housing-Analytics/data/chfa-lihtc.json',
    '"./data/chfa-lihtc.json" strips ./ and prepends BASE'
  );
  assert(
    resolve('./js/vendor/images/marker-icon.png') === '/Housing-Analytics/js/vendor/images/marker-icon.png',
    '"./js/..." strips ./ and prepends BASE'
  );
});

test('resolveAssetUrl: root-relative paths are returned unchanged (bug fix)', () => {
  const resolve = makeResolver('/Housing-Analytics/');
  // This was the bug: '/Housing-Analytics/data/foo.json' was being re-prefixed
  // to '/Housing-Analytics/Housing-Analytics/data/foo.json'
  assert(
    resolve('/Housing-Analytics/data/chfa-lihtc.json') === '/Housing-Analytics/data/chfa-lihtc.json',
    'already-resolved root-relative path is NOT double-prefixed'
  );
  assert(
    resolve('/Housing-Analytics/data/chfa-lihtc.json') !== '/Housing-Analytics/Housing-Analytics/data/chfa-lihtc.json',
    'double-prefix bug is eliminated'
  );
});

test('resolveAssetUrl: relative paths work on custom domain (BASE = /)', () => {
  const resolve = makeResolver('/');
  assert(
    resolve('data/chfa-lihtc.json') === '/data/chfa-lihtc.json',
    'custom domain: "data/chfa-lihtc.json" → /data/chfa-lihtc.json'
  );
  assert(
    resolve('./data/chfa-lihtc.json') === '/data/chfa-lihtc.json',
    'custom domain: "./data/chfa-lihtc.json" → /data/chfa-lihtc.json'
  );
});

test('resolveAssetUrl: absolute https:// URLs are returned unchanged', () => {
  const resolve = makeResolver('/Housing-Analytics/');
  const absUrl = 'https://services.arcgis.com/VTyQ9soqVukalItT/ArcGIS/rest/services/LIHTC/FeatureServer/0/query';
  assert(resolve(absUrl) === absUrl, 'https:// URL unchanged');
  assert(resolve('https://api.census.gov/data?key=abc') === 'https://api.census.gov/data?key=abc', 'census API URL unchanged');
});

test('resolveAssetUrl: data: URLs are returned unchanged', () => {
  const resolve = makeResolver('/Housing-Analytics/');
  assert(resolve('data:text/plain,hello') === 'data:text/plain,hello', 'data: URL unchanged');
});

test('resolveAssetUrl source matches extracted implementation', () => {
  const resolveFromSource = makeResolverFromSource('/Housing-Analytics/');
  if (!resolveFromSource) {
    console.error('  ❌ FAIL: Could not extract resolveAssetUrl from source');
    failed++;
    return;
  }
  // Spot-check a few cases against the actual implementation.
  assert(
    resolveFromSource('data/chfa-lihtc.json') === '/Housing-Analytics/data/chfa-lihtc.json',
    'source-extracted resolver: relative path'
  );
  assert(
    resolveFromSource('/Housing-Analytics/data/chfa-lihtc.json') === '/Housing-Analytics/data/chfa-lihtc.json',
    'source-extracted resolver: root-relative not double-prefixed'
  );
  assert(
    resolveFromSource('https://example.com/api') === 'https://example.com/api',
    'source-extracted resolver: https URL unchanged'
  );
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
  console.log('\nAll checks passed ✅');
}
