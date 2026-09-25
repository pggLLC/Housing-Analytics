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
    buildManifest,
    carryCommittedMtimes,
    changedSinceManifest,
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

  // A checkout's mtimes are not change times. Regenerating the manifest after
  // a merge rewrote all ~1,600 entries (2026-09-25, the first post-merge
  // refresh after #1887) and conflicted every open PR touching it. An entry
  // keeps its committed mtime unless the file is uncommitted or changed.
  const prevM = { files: [
    { path: 'a.json', kind: 'json', size_bytes: 10, mtime: '2026-01-01T00:00:00.000Z' },
    { path: 'b.json', kind: 'json', size_bytes: 10, mtime: '2026-01-01T00:00:00.000Z' },
    { path: 'c.json', kind: 'json', size_bytes: 10, mtime: '2026-01-01T00:00:00.000Z' },
  ] };
  const NOW = '2026-09-25T12:00:00.000Z';
  const built = [
    { path: 'a.json', kind: 'json', size_bytes: 10, mtime: NOW }, // untouched
    { path: 'b.json', kind: 'json', size_bytes: 10, mtime: NOW }, // rewritten, not yet committed
    { path: 'c.json', kind: 'json', size_bytes: 12, mtime: NOW }, // content changed
    { path: 'd.json', kind: 'json', size_bytes: 10, mtime: NOW }, // new file
  ];
  const carried = Object.fromEntries(carryCommittedMtimes(built, prevM, new Set(['b.json'])).map((e) => [e.path, e.mtime]));
  assert.strictEqual(carried['a.json'], '2026-01-01T00:00:00.000Z', 'an unchanged, committed file keeps its committed mtime');
  assert.strictEqual(carried['b.json'], NOW, 'an uncommitted file gets its new mtime');
  assert.strictEqual(carried['c.json'], NOW, 'a file whose recorded fields changed gets its new mtime');
  assert.strictEqual(carried['d.json'], NOW, 'a new file gets its mtime');
  assert(carryCommittedMtimes(built, prevM, null).every((e) => e.mtime === NOW),
    'when git cannot say what is uncommitted, nothing is carried over');

  // A data change committed without regenerating _manifest.json must still
  // count as changed, even at the same size (Codex, #1891: jobs commit a data
  // file and rebuild only data/manifest.json).
  {
    const os = require('os');
    const { execFileSync } = require('child_process');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mtime-carry-'));
    const g = (...a) => execFileSync('git', a, { cwd: tmp, stdio: 'pipe' });
    try {
      g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
      fs.mkdirSync(path.join(tmp, 'data'));
      fs.writeFileSync(path.join(tmp, 'data/_manifest.json'), '{}');
      fs.writeFileSync(path.join(tmp, 'data/x.json'), '{"v":1}');
      fs.writeFileSync(path.join(tmp, 'data/y.json'), '{"v":1}');
      g('add', '.'); g('commit', '-qm', 'manifest');
      fs.writeFileSync(path.join(tmp, 'data/x.json'), '{"v":2}'); // same size
      g('commit', '-qam', 'data only, manifest not regenerated');
      const changed = changedSinceManifest(tmp);
      assert(changed && changed.has('x.json'), 'a same-size data change committed after the manifest counts as changed');
      assert(!changed.has('y.json'), 'an untouched file does not count as changed');
      fs.writeFileSync(path.join(tmp, 'data/y.json'), '{"v":3}');
      assert(changedSinceManifest(tmp).has('y.json'), 'an uncommitted change counts as changed');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // End to end on the real tree: a clean file whose mtime a checkout reset is
  // still recorded with its committed mtime. The probe is chosen by the scan,
  // and the scan must find one (Codex, #1891: an `if` that skips the only
  // end-to-end assertion lets a regression pass).
  const { spawnSync } = require('child_process');
  const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout || '';
  const since = git(['log', '-1', '--format=%H', '--', 'data/_manifest.json']).trim();
  const touched = new Set(
    (since ? git(['diff', '--name-only', since, 'HEAD', '--', 'data']) : '').split('\n')
      .concat(git(['status', '--porcelain', '--untracked-files=all', '--', 'data']).split('\n').map((l) => l.slice(3)))
      .map((p) => p.trim().replace(/^data\//, '')).filter(Boolean));
  const before = await buildManifest({ write: false });
  const byPath = new Map(before.files.map((e) => [e.path, e]));
  const probe = manifest.files.find((c) => {
    if (touched.has(c.path) || /\/reports?\//.test('/' + c.path)) return false;
    const e = byPath.get(c.path);
    return e && JSON.stringify({ ...e, mtime: null }) === JSON.stringify({ ...c, mtime: null });
  });
  assert(since, 'git history reaches the commit that wrote data/_manifest.json');
  assert(probe, 'the scan found a committed, unchanged data file to probe');
  const probeAbs = path.join(ROOT, 'data', probe.path);
  const st = fs.statSync(probeAbs);
  try {
    fs.utimesSync(probeAbs, new Date(), new Date('2031-01-01T00:00:00Z'));
    const fresh = await buildManifest({ write: false });
    const e = fresh.files.find((x) => x.path === probe.path);
    assert.strictEqual(e.mtime, probe.mtime, `${probe.path}: a clean file with a reset mtime keeps its committed mtime`);
  } finally {
    fs.utimesSync(probeAbs, st.atime, st.mtime);
  }

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
