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

  // Coverage alone does not catch a manifest that lists the right files with
  // the WRONG sizes. On 2026-08-16, #1411 edited 18 jurisdiction briefs without
  // running scripts/rebuild_manifest.py; every entry still existed, so coverage
  // passed, while data/manifest.json under-reported two of them by ~12.5 KB
  // each. Assert the recorded byte counts actually match what is on disk.
  // NOTE: the two manifests have different shapes. data/_manifest.json (above)
  // exposes `files` as an ARRAY of entries; data/manifest.json keys `files` as
  // an OBJECT of path -> {bytes, ...}. Do not assume one shape for both.
  // Audit outputs under */reports/ are rewritten BY this very test suite (the
  // link audit inflates data/reports/repo-link-audit.json from ~2MB to ~11MB
  // mid-run), so their on-disk size depends on whether their generator has run
  // yet. Comparing those would make this assertion order-dependent and flaky.
  // Skip them; they are regenerated artifacts, not hand-maintained data.
  const CHURNS_DURING_TESTS = /(^|\/)(reports)\//;
  const stale = [];
  for (const [filePath, entry] of Object.entries(readJson('data/manifest.json').files ?? {})) {
    if (typeof entry?.bytes !== 'number') continue;
    if (CHURNS_DURING_TESTS.test(filePath)) continue;
    const abs = path.join(ROOT, filePath);
    if (!fs.existsSync(abs)) continue;
    const actual = fs.statSync(abs).size;
    if (actual !== entry.bytes) stale.push(`${filePath}: manifest=${entry.bytes} disk=${actual}`);
  }
  assert.strictEqual(
    stale.length,
    0,
    `data/manifest.json byte counts are stale — run \`python scripts/rebuild_manifest.py\`:\n  ${stale.slice(0, 10).join('\n  ')}`
  );

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
