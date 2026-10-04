'use strict';

// The pages that read the statewide transit-stop file must read what the file
// actually holds (#1937 Phase 1). The TOD check compares `reliability` to
// 'unconfirmed' and the data-map browser pops up agency / sources /
// reliability; rename a property in the builder and those comparisons go
// silently false (every stop "confirmed", every popup blank) with nothing red.
// So this pins the agreement between the consumers and the committed file,
// not either side's wording.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// Run the source fixtures and independent published-data guard in ci:part-4,
// alongside the other transit-stop consumer checks (also discovered by pytest).
const schoolTransport = spawnSync('python3', ['-m', 'pytest', '-q', 'tests/test_school_transport_exclusion.py'],
  { cwd: root, encoding: 'utf8' });
assert.equal(schoolTransport.status, 0, schoolTransport.stdout + schoolTransport.stderr);
process.stdout.write(schoolTransport.stdout);

// ── The file the consumers point at ─────────────────────────────────────────
const ma = read('js/market-analysis.js');
const layerSrc = (ma.match(/transitStops:\s*\{\s*src:\s*'([^']+)'/) || [])[1];
assert.ok(layerSrc, 'transitStops layer source not found in js/market-analysis.js');

const dmb = read('data-map-browser.html');
const dmbBlock = (dmb.match(/\{ key: 'transit', name: 'Transit stops'[\s\S]*?\} \},/) || [])[0];
assert.ok(dmbBlock, 'transit-stops layer not found in data-map-browser.html');
const dmbUrl = (dmbBlock.match(/url: '([^']+)'/) || [])[1];

assert.equal('data/' + layerSrc, dmbUrl, 'the market-analysis page and the data-map browser read different stop files');
const stops = JSON.parse(read(dmbUrl));
assert.ok(Array.isArray(stops.features) && stops.features.length > 0, `${dmbUrl} holds no stops`);

// Every property either consumer reads must exist on the file's features.
const props = new Set();
const values = {};
for (const f of stops.features) {
  for (const [k, v] of Object.entries(f.properties || {})) {
    props.add(k);
    if (typeof v === 'string') (values[k] = values[k] || new Set()).add(v);
    if (Array.isArray(v)) v.forEach((x) => (values[k] = values[k] || new Set()).add(x));
  }
}

const dmbProps = [...dmbBlock.matchAll(/\bp\.([a-z_]+)/g)].map((m) => m[1]);
assert.ok(dmbProps.length >= 3, 'data-map-browser popup reads too few properties to be checking anything');
for (const p of dmbProps) assert.ok(props.has(p), `data-map-browser reads p.${p}, which no stop has`);

// The source labels the popup maps must be the source values the file uses.
const srcKeys = [...(dmbBlock.match(/var SRC = \{([^}]*)\}/) || ['', ''])[1].matchAll(/(\w+):/g)].map((m) => m[1]);
assert.deepEqual(srcKeys.sort(), [...values.sources].sort(), 'popup source labels disagree with the file\'s source values');

// ── The TOD check ───────────────────────────────────────────────────────────
const todFn = (ma.match(/function _highlightTodTransit[\s\S]*?\n  \}\n/) || [])[0];
assert.ok(todFn, '_highlightTodTransit not found');
const compared = [...todFn.matchAll(/f\.properties\.(\w+) === '([^']+)'/g)].map((m) => [m[1], m[2]]);
assert.ok(compared.length > 0, 'the TOD check compares no stop property — the scan found nothing to check');
for (const [k, v] of compared) {
  assert.ok(values[k] && values[k].has(v), `the TOD check compares ${k} to '${v}', a value no stop in ${dmbUrl} has`);
}
// H1: comparison VALUES must be in the real file too, including inequality
// checks in TransitZone and reliability in the popup. The HNA renderer now
// reads areaSummary rather than comparing stop tokens; scan it as well so a
// later reintroduced comparison cannot escape this check.
const comparisonFiles = ['js/transit-zone.js', 'js/market-analysis.js',
  'js/hna/hna-renderers.js', 'data-map-browser.html'];
let valueComparisons = 0;
for (const file of comparisonFiles) {
  const source = read(file);
  const comparisons = [...source.matchAll(/\.(operator(?:_type)?|reliability)\s*(?:===|!==|==|!=)\s*(['"])([^'"]+)\2/g)];
  for (const m of comparisons) {
    assert.ok(values[m[1]] && values[m[1]].has(m[3]),
      `${file}: compares ${m[1]} to '${m[3]}', absent from the real stop file`);
    valueComparisons++;
  }
  // Non-vacuity at every current comparison site; the renderer has none.
  if (file !== 'js/hna/hna-renderers.js') {
    assert.ok(comparisons.some(m => m[1] === 'reliability'), `${file}: no reliability comparison scanned`);
  }
  if (file.endsWith('transit-zone.js') || file.endsWith('market-analysis.js')) {
    assert.ok(comparisons.some(m => m[1] === 'operator'), `${file}: no operator comparison scanned`);
  }
}
assert.ok(valueComparisons >= 6, `only ${valueComparisons} consumer value comparisons checked`);

// The committed cache alone cannot catch a producer rename before the next
// refresh. Exercise Phase 1's pure merge with rows taken from that SAME file,
// through direct CDOT, feed-only, agency-name backfill and OSM-only paths.
// No invented operator/reliability values and no fetch or generated output.
const privateStop = stops.features.find(f => f.properties.operator === 'private_shuttle');
const publicStop = stops.features.find(f => f.properties.operator === 'public' && f.properties.sources.includes('cdot'));
const osmStop = stops.features.find(f => f.properties.sources.length === 1 && f.properties.sources[0] === 'osm');
assert.ok(privateStop && publicStop && osmStop, 'real stop file must exercise every producer class');
const builderCases = [
  { path: 'cdot', feature: privateStop },
  { path: 'feed', feature: privateStop },
  { path: 'backfill', feature: privateStop },
  { path: 'cdot', feature: publicStop },
  { path: 'osm', feature: osmStop },
];
const built = spawnSync('python3', ['-c', `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('stops', 'scripts/market/build_transit_stops_co.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
counties = b.load_counties()
results = []
for case in json.load(sys.stdin):
    f = case['feature']
    p = f['properties']
    lon, lat = f['geometry']['coordinates'][:2]
    row = dict(p, lon=lon, lat=lat)
    route = case['path']
    cdot = [dict(row, agency='')] if route == 'backfill' else [row] if route == 'cdot' else []
    feed = [row] if route in ('backfill', 'feed') else []
    osm = [row] if route == 'osm' else []
    features, _ = b.merge(cdot, feed, osm, counties)
    results.append([f['properties'] for f in features])
print(json.dumps(results))
`], { cwd: root, encoding: 'utf8', input: JSON.stringify(builderCases),
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
assert.equal(built.status, 0, built.stdout + built.stderr);
const produced = JSON.parse(built.stdout);
assert.equal(produced.length, builderCases.length);
for (const [i, c] of builderCases.entries()) {
  assert.equal(produced[i].length, 1, `${c.path}: expected one real stop to survive merge`);
  for (const key of ['operator', 'reliability']) {
    assert.equal(produced[i][0][key], c.feature.properties[key],
      `${c.path}: builder ${key} differs from the real stop file and its consumers`);
  }
}
console.log(`  ✓ ${valueComparisons} consumer comparisons and ${builderCases.length} live builder paths agree with real stop values`);

// Run the real popup against the file, independently classifying the source.
// This catches a renamed reliability token without pinning builder source
// text, and permits harmless rewrites of the explanatory copy.
const popup = vm.runInNewContext('(' + dmbBlock.replace(/,$/, '') + ')');
let osmChecked = 0;
let confirmedChecked = 0;
for (const f of stops.features) {
  const p = f.properties;
  const osmOnly = p.sources.length === 1 && p.sources[0] === 'osm';
  const row = popup.popupRows(p).find(r => r.k === 'Reliability');
  assert.ok(row, 'popup omitted the reliability claim');
  assert.equal(/unconfirmed/i.test(row.v), osmOnly, `popup reliability disagrees with sources for ${p.name}`);
  if (osmOnly) osmChecked++; else confirmedChecked++;
}
assert.ok(osmChecked > 0 && confirmedChecked > 0, 'popup check must exercise both source classes');

// Both outputs are produced in one build; their freshness monitor must use
// the same canonical window that the Data Trust Center publishes.
const inventoryWindow = {};
vm.runInNewContext(read('js/data-source-inventory.js'), { window: inventoryWindow });
const source = inventoryWindow.DataSourceInventory.getSources().find(s => s.localFile === dmbUrl);
assert.ok(source && Number.isFinite(source.maxAgeDays) && source.maxAgeDays > 0);
const freshness = spawnSync(process.execPath, ['scripts/audit/data-freshness-check.mjs', '--json'], { cwd: root, encoding: 'utf8' });
assert.ok([0, 1].includes(freshness.status), freshness.stderr || 'freshness check could not run');
const checks = JSON.parse(freshness.stdout).results;
for (const file of [dmbUrl, 'data/market/transit_stops_coverage_co.json']) {
  const check = checks.find(r => r.file === file);
  assert.ok(check && check.present, `missing freshness check for ${file}`);
  assert.equal(check.slaDays, source.maxAgeDays, `${file}: monitor SLA disagrees with the source inventory`);
}

// The weekly job that commits the stop file must refresh BOTH manifests, in
// order, and stage both (AGENTS.md "two manifests"; bot commits trigger no
// other workflow that would repair data/_manifest.json).
const wf = read('.github/workflows/fetch-parcel-zoning-data.yml');
const commitStep = wf.slice(wf.indexOf('- name: Commit updated data files'));
assert.ok(commitStep.includes('data/amenities/transit_stops_statewide_co.geojson'), 'weekly job does not commit the stop file');
const iAudit = commitStep.indexOf('npm run audit:file-manifest');
const iRebuild = commitStep.indexOf('scripts/rebuild_manifest.py');
assert.ok(iAudit >= 0 && iRebuild > iAudit, 'weekly job must run audit:file-manifest before rebuild_manifest.py');
assert.ok(/data\/_manifest\.json/.test(commitStep) && /data\/manifest\.json/.test(commitStep), 'weekly job must stage both manifests');

console.log(`transit-stops-consumers: ${stops.features.length} stops; ${dmbProps.length} popup fields and ${compared.length} TOD comparison(s) agree with ${dmbUrl} — OK`);
