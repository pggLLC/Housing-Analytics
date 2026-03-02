// test/split-lihtc-by-county.js
//
// Unit tests for scripts/split-lihtc-by-county.js
//
// Exercises the core logic (grouping features by CNTY_FIPS, writing one file
// per county) without executing network calls or touching the real data files.
//
// Usage:
//   node test/split-lihtc-by-county.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

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
// Helpers — run the script in a temporary directory
// ---------------------------------------------------------------------------

/**
 * Execute the split script against a synthetic chfa-lihtc.json placed in a
 * temporary directory tree that mirrors the real layout.
 *
 * @param {object} sourceGeojson  Object to write as chfa-lihtc.json.
 * @returns {{ outDir: string, tmpRoot: string }}
 *   outDir   – path to the data/hna/lihtc directory that was written.
 *   tmpRoot  – root of the temp tree (caller may inspect or clean up).
 */
function runScript(sourceGeojson) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'split-lihtc-test-'));

  // Build minimal repo layout: <tmpRoot>/data/hna/lihtc/  and  <tmpRoot>/scripts/
  const dataDir  = path.join(tmpRoot, 'data');
  const hnaDir   = path.join(dataDir, 'hna', 'lihtc');
  const scriptsDir = path.join(tmpRoot, 'scripts');

  fs.mkdirSync(hnaDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });

  // Write the source file.
  fs.writeFileSync(
    path.join(dataDir, 'chfa-lihtc.json'),
    JSON.stringify(sourceGeojson),
    'utf8',
  );

  // Copy the real split script into the temp scripts dir so require paths work.
  const realScript = path.resolve(__dirname, '..', 'scripts', 'split-lihtc-by-county.js');
  const tmpScript  = path.join(scriptsDir, 'split-lihtc-by-county.js');
  fs.copyFileSync(realScript, tmpScript);

  // Patch the script's ROOT to point at our temp tree by overriding __dirname
  // via a tiny wrapper module written into the same temp dir.
  const wrapperPath = path.join(tmpRoot, '_run-split.js');
  fs.writeFileSync(wrapperPath, `
    // Override __dirname seen by the script so ROOT resolves to tmpRoot.
    const Module = require('module');
    const origCompile = Module.prototype._compile;
    Module.prototype._compile = function(content, filename) {
      if (filename === ${JSON.stringify(tmpScript)}) {
        content = content.replace(
          "path.resolve(__dirname, '..')",
          ${JSON.stringify(JSON.stringify(tmpRoot))}
        );
      }
      return origCompile.call(this, content, filename);
    };
    require(${JSON.stringify(tmpScript)});
  `, 'utf8');

  // Run the wrapper synchronously in a child process.
  const { execFileSync } = require('child_process');
  execFileSync(process.execPath, [wrapperPath], { stdio: 'pipe' });

  return { outDir: hnaDir, tmpRoot };
}

/** Read and parse a JSON file; returns null on error. */
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/** Recursively delete a directory (Node ≥14). */
function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('writes exactly 64 county files for empty source', () => {
  const { outDir, tmpRoot } = runScript({
    type: 'FeatureCollection',
    fetchedAt: null,
    features: [],
  });

  const files = fs.readdirSync(outDir).filter(f => f.endsWith('.json'));
  assert(files.length === 64, `64 files written (got ${files.length})`);
  rmrf(tmpRoot);
});

test('all 64 files are valid GeoJSON FeatureCollections', () => {
  const { outDir, tmpRoot } = runScript({
    type: 'FeatureCollection',
    fetchedAt: null,
    features: [],
  });

  const files = fs.readdirSync(outDir).filter(f => f.endsWith('.json'));
  const invalid = files.filter(f => {
    const data = readJson(path.join(outDir, f));
    return !data || data.type !== 'FeatureCollection' || !Array.isArray(data.features);
  });
  assert(invalid.length === 0, `All files are valid FeatureCollections (bad: ${invalid.join(', ') || 'none'})`);
  rmrf(tmpRoot);
});

test('features are routed to the correct county file', () => {
  const denverFeature = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-104.99, 39.74] },
    properties: {
      PROJECT: 'Test Denver Project',
      CNTY_FIPS: '08031',
      COUNTYFP: '031',
    },
  };
  const boulderFeature = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-105.28, 40.01] },
    properties: {
      PROJECT: 'Test Boulder Project',
      CNTY_FIPS: '08013',
      COUNTYFP: '013',
    },
  };

  const { outDir, tmpRoot } = runScript({
    type: 'FeatureCollection',
    fetchedAt: '2025-01-01T00:00:00.000Z',
    features: [denverFeature, boulderFeature],
  });

  const denver  = readJson(path.join(outDir, '08031.json'));
  const boulder = readJson(path.join(outDir, '08013.json'));
  const adams   = readJson(path.join(outDir, '08001.json'));

  assert(denver  !== null, 'Denver file exists');
  assert(boulder !== null, 'Boulder file exists');
  assert(adams   !== null, 'Adams file exists');

  assert(denver.features.length  === 1, 'Denver has 1 feature');
  assert(boulder.features.length === 1, 'Boulder has 1 feature');
  assert(adams.features.length   === 0, 'Adams has 0 features');

  assert(
    denver.features[0].properties.PROJECT === 'Test Denver Project',
    'Denver feature has correct PROJECT name',
  );
  assert(
    boulder.features[0].properties.PROJECT === 'Test Boulder Project',
    'Boulder feature has correct PROJECT name',
  );

  rmrf(tmpRoot);
});

test('fetchedAt is propagated to county files', () => {
  const timestamp = '2025-06-15T12:00:00.000Z';
  const { outDir, tmpRoot } = runScript({
    type: 'FeatureCollection',
    fetchedAt: timestamp,
    features: [],
  });

  const denver = readJson(path.join(outDir, '08031.json'));
  assert(denver !== null, 'Denver file exists');
  assert(denver.fetchedAt === timestamp, `fetchedAt is "${timestamp}"`);
  rmrf(tmpRoot);
});

test('features with unknown CNTY_FIPS are skipped gracefully', () => {
  const unknownFeature = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-100.0, 38.0] },
    properties: { PROJECT: 'Unknown County Project', CNTY_FIPS: '99999' },
  };
  const validFeature = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-104.99, 39.74] },
    properties: { PROJECT: 'Valid Project', CNTY_FIPS: '08031' },
  };

  const { outDir, tmpRoot } = runScript({
    type: 'FeatureCollection',
    fetchedAt: null,
    features: [unknownFeature, validFeature],
  });

  const denver = readJson(path.join(outDir, '08031.json'));
  assert(denver !== null, 'Denver file exists');
  assert(denver.features.length === 1, 'Valid feature is present in Denver file');
  rmrf(tmpRoot);
});

test('multiple features for the same county are all written', () => {
  const makeFeature = (project) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-104.99, 39.74] },
    properties: { PROJECT: project, CNTY_FIPS: '08031' },
  });

  const { outDir, tmpRoot } = runScript({
    type: 'FeatureCollection',
    fetchedAt: null,
    features: [makeFeature('Project A'), makeFeature('Project B'), makeFeature('Project C')],
  });

  const denver = readJson(path.join(outDir, '08031.json'));
  assert(denver !== null, 'Denver file exists');
  assert(denver.features.length === 3, 'All 3 Denver features are written');
  rmrf(tmpRoot);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
