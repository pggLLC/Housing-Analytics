const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

(async () => {
  const {
    assertManifestCoverage,
    assertNoUnsafeShrink,
    discoverDataFilePaths,
  } = await import('../scripts/audit/build-data-manifest.mjs');

  const manifest = readJson('data/_manifest.json');
  const diskPaths = await discoverDataFilePaths();

  assert(diskPaths.length > 1500, `manifest file discovery is non-vacuous (${diskPaths.length} files)`);
  assert(Array.isArray(manifest.files), 'data/_manifest.json exposes a files array');
  assert(manifest.files.length > 1500, `manifest is non-vacuous (${manifest.files.length} entries)`);

  const report = assertManifestCoverage(manifest, diskPaths, { tolerance: 0 });
  assert.strictEqual(report.missing.length, 0, 'manifest has no missing discoverable data files');
  assert.strictEqual(report.extra.length, 0, 'manifest has no extra stale file entries');
  assert.strictEqual(manifest.meta.file_count, manifest.files.length, 'meta.file_count matches files.length');

  const dropped = {
    ...manifest,
    files: manifest.files.slice(1),
  };
  assert.throws(
    () => assertManifestCoverage(dropped, diskPaths, { tolerance: 0 }),
    /coverage drift/,
    'dropping a manifest entry must fail the coverage guard'
  );

  const previous = { files: Array.from({ length: 100 }, (_, i) => ({ path: `old-${i}.json` })) };
  const tolerated = { files: Array.from({ length: 95 }, (_, i) => ({ path: `new-${i}.json` })) };
  const shortBuild = { files: Array.from({ length: 80 }, (_, i) => ({ path: `short-${i}.json` })) };
  assert.doesNotThrow(
    () => assertNoUnsafeShrink(previous, tolerated, { toleranceRatio: 0.05, toleranceMin: 1 }),
    'shrink at the configured tolerance is allowed'
  );
  assert.throws(
    () => assertNoUnsafeShrink(previous, shortBuild, { toleranceRatio: 0.05, toleranceMin: 1 }),
    /refusing to write/,
    'short/null nightly manifests must be refused before write'
  );

  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/data-refresh.yml'), 'utf8');
  assert(workflow.includes('npm run audit:file-manifest'), 'daily data refresh regenerates data/_manifest.json');

  const explorerHtml = fs.readFileSync(path.join(ROOT, 'data-explorer.html'), 'utf8');
  const explorerJs = fs.readFileSync(path.join(ROOT, 'js/data-explorer.js'), 'utf8');
  assert(explorerHtml.includes('dex-stale-pill'), 'Data Explorer includes stale-manifest pill styles');
  assert(explorerJs.includes('MANIFEST_STALE_MS = 7 * 24 * 60 * 60 * 1000'), 'Data Explorer has the 7-day stale threshold');
  assert(explorerJs.includes('npm run audit:file-manifest'), 'Data Explorer points maintainers to the npm manifest alias');

  console.log('file-manifest automation: PASS');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
