'use strict';

/**
 * EPA SLD D4A must reach market-analysis.html as a distance, never as a score.
 *
 * data/market/epa_sld_co.json's `transitAccess` is EPA Smart Location Database
 * D4A — "Distance from the population-weighted centroid to nearest transit stop
 * (meters)" in EPA's own field alias — blank beyond ~3/4 mile. The fetch script
 * labelled it "D4a - transit service frequency" (the NAME of EPA's layer 14,
 * which describes D4C), and js/data-connectors/epa-walkability.js believed the
 * label: it divided D4A by a 1200 "frequency cap" and added it to the walk
 * score at 20%, so being farther from transit scored higher, and the Market
 * Analysis page printed the metres under "Transit Frequency". PR #1997 fixed
 * the same misreading in data-service-portable.js.
 *
 * What each check has to agree with:
 *   - the distance the connector returns  <-> the mean D4A of those block groups
 *     in epa_sld_co.json, computed here independently;
 *   - the walk / bike scores               <-> the scores with D4A deleted from
 *     the data (D4A must not move them);
 *   - the rendered row                     <-> the connector's distance, and
 *     "None reported" (never "0 m") where EPA left D4A blank;
 *   - the weights in data/glossary.json    <-> the weights the connector
 *     actually applies, measured by probing it, not read from its source;
 *   - the fetch script's field label       <-> what the values in the data
 *     file are shaped like (metres in (0, ~1207], half blank).
 *
 * Source paths can be overridden (EPA_WALK_SRC, MA_RENDERERS_SRC, GLOSSARY_PATH,
 * EPA_FETCH_SCRIPT) so a mutated copy can be sabotage-tested without touching
 * the tree.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CONNECTOR = process.env.EPA_WALK_SRC || path.join(ROOT, 'js/data-connectors/epa-walkability.js');
const RENDERERS = process.env.MA_RENDERERS_SRC || path.join(ROOT, 'js/market-analysis/market-report-renderers.js');
const GLOSSARY = process.env.GLOSSARY_PATH || path.join(ROOT, 'data/glossary.json');
const FETCH_SCRIPT = process.env.EPA_FETCH_SCRIPT || path.join(ROOT, 'scripts/market/fetch_epa_sld.py');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/market/epa_sld_co.json'), 'utf8'));

// 3/4 mile is 1207 m; allow rounding slack, not a second definition.
const D4A_CUTOFF_M = 1210;
const LEGACY_LABEL = 'D4a - transit service frequency';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ✅ PASS: ' + msg); }
  else { failed++; console.log('  ❌ FAIL: ' + msg); }
}

/**
 * Run the real connector. A tract is chosen by handing loadGeometry() one
 * square per block group of that tract, all covering the probe point, so the
 * connector's own point-in-polygon lookup selects exactly those block groups.
 */
function loadConnector(data) {
  const window = {};
  const sandbox = {
    window, document: { readyState: 'complete' },
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout() {}, Math, Object, Array, Number, String, isFinite
  };
  vm.runInNewContext(fs.readFileSync(CONNECTOR, 'utf8'), sandbox, { filename: CONNECTOR });
  window.EpaWalkability.load(data);
  const square = [[[-105.01, 39.69], [-104.99, 39.69], [-104.99, 39.71], [-105.01, 39.71], [-105.01, 39.69]]];
  return function scoresFor(tractGeoids) {
    const bgs = Object.keys(data.blockGroups).filter(id => tractGeoids.includes(id.slice(0, 11)));
    window.EpaWalkability.loadGeometry({ features: bgs.map(geoid => ({
      properties: { geoid }, geometry: { type: 'Polygon', coordinates: square }
    })) });
    return window.EpaWalkability.getScores(39.7, -105);
  };
}

function renderAccess(walkability) {
  const el = { innerHTML: '' };
  const window = {};
  const sandbox = {
    window, document: { getElementById: id => (id === 'maNeighborhoodAccessContent' ? el : null) },
    console: { log() {}, warn() {}, error() {} }, Math, Object, Array, Number, String, isNaN, isFinite
  };
  vm.runInNewContext(fs.readFileSync(RENDERERS, 'utf8'), sandbox, { filename: RENDERERS });
  window.MARenderers.renderNeighborhoodAccess({ amenities: {}, walkability, access_score: 50 });
  return el.innerHTML;
}

const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

// ── Pick tracts from the data (non-vacuity is on the scan) ─────────────
const byTract = {};
Object.keys(DATA.blockGroups).sort().forEach(k => {
  (byTract[k.slice(0, 11)] = byTract[k.slice(0, 11)] || []).push(DATA.blockGroups[k]);
});
const tractIds = Object.keys(byTract);
const mixed = tractIds.find(t => byTract[t].some(b => b.transitAccess == null) && byTract[t].some(b => b.transitAccess != null));
const blank = tractIds.find(t => byTract[t].every(b => b.transitAccess == null));
const full = tractIds.find(t => byTract[t].length > 1 && byTract[t].every(b => b.transitAccess != null));

console.log('\n1. The data file is D4A-shaped');
const d4aAll = Object.values(DATA.blockGroups).map(b => b.transitAccess);
const d4aVals = d4aAll.filter(v => v != null);
check(d4aVals.length > 1000, `scan found D4A values to check (${d4aVals.length})`);
check(d4aVals.every(v => v > 0 && v <= D4A_CUTOFF_M),
  `every D4A value is a distance within EPA's ~3/4 mi cutoff (max ${Math.max(...d4aVals)} m)`);
check(d4aAll.length - d4aVals.length > 0, `block groups beyond the cutoff are blank, not 0 (${d4aAll.length - d4aVals.length} blank)`);
check(mixed && blank && full, `found a part-blank (${mixed}), an all-blank (${blank}) and a no-blank (${full}) tract`);

console.log('\n2. The fetch script labels D4A as the distance the data holds');
const py = fs.readFileSync(FETCH_SCRIPT, 'utf8');
const fieldsBlock = (py.split('"fields": {')[1] || '').split('}')[0];
const pyLabel = (fieldsBlock.match(/"transitAccess":\s*"([^"]+)"/) || [])[1] || '';
check(/distance/i.test(pyLabel) && /met(er|re)s/i.test(pyLabel) && /stop/i.test(pyLabel),
  `script meta label describes distance to a stop in metres ("${pyLabel.slice(0, 70)}…")`);
check(!/frequen/i.test(pyLabel), 'script meta label does not call D4A a frequency');
const sldFieldLine = (py.match(/^\s*"D4A",\s*#(.*)$/m) || [])[1] || '';
check(/distance/i.test(sldFieldLine) && !/frequen/i.test(sldFieldLine), `SLD_FIELDS comment for D4A says distance ("${sldFieldLine.trim()}")`);
const dataLabel = DATA.meta && DATA.meta.fields && DATA.meta.fields.transitAccess;
check(dataLabel === pyLabel || dataLabel === LEGACY_LABEL,
  `data meta label is the script's, or the legacy one pending regeneration ("${dataLabel}")`);
if (dataLabel === LEGACY_LABEL) console.log('     note: data/market/epa_sld_co.json still carries the legacy label; the next fetch corrects it');

console.log('\n3. The connector carries D4A as a distance equal to the data file');
const scoresFor = loadConnector(DATA);
function expected(t) {
  const v = byTract[t].map(b => b.transitAccess).filter(x => x != null);
  return { m: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null, n: v.length, of: byTract[t].length };
}
[mixed, full].forEach(t => {
  const r = scoresFor([t]); const e = expected(t);
  check(r && r.nearestTransitStopMeters === e.m, `${t}: nearestTransitStopMeters ${r && r.nearestTransitStopMeters} = mean D4A ${e.m}`);
  check(r && r.transitStopBlockGroupCount === e.n && r.blockGroupCount === e.of,
    `${t}: averaged over ${e.n} of ${e.of} block groups (got ${r && r.transitStopBlockGroupCount} of ${r && r.blockGroupCount})`);
});
const rb = scoresFor([blank]);
check(rb && rb.nearestTransitStopMeters === null && rb.transitStopBlockGroupCount === 0,
  `${blank}: all-blank tract gives null, not 0 (got ${rb && rb.nearestTransitStopMeters})`);
const rm = scoresFor([mixed]);
check(rm && !('transitFrequency' in rm), 'no transitFrequency field is emitted');
check(rm && typeof rm.transitScoreUnavailableReason === 'string' && /D4A/.test(rm.transitScoreUnavailableReason) &&
  /distance/i.test(rm.transitScoreUnavailableReason), 'a reason says D4A is a distance and not scored');

// The walk score is EPA's National Walkability Index, which includes EPA's own
// ranking of D4A (d4aRanked); what must not move it is COHO reading the raw
// distance. Deleting transitAccess leaves walkIndex and d4aRanked in place.
console.log('\n4. The raw D4A distance does not move the walk or bike score');
const stripped = JSON.parse(JSON.stringify(DATA));
Object.values(stripped.blockGroups).forEach(b => { delete b.transitAccess; });
const scoresStripped = loadConnector(stripped);
const probe = tractIds.filter(t => byTract[t].some(b => b.transitAccess != null));
const moved = probe.filter(t => {
  const a = scoresFor([t]), b = scoresStripped([t]);
  return !a || !b || a.walkScore !== b.walkScore || a.bikeScore !== b.bikeScore;
});
check(probe.length > 100, `scan covers every tract with a D4A value (${probe.length})`);
check(moved.length === 0, `walk/bike scores identical with D4A deleted (${moved.length} tracts differ${moved.length ? ', e.g. ' + moved[0] : ''})`);

console.log('\n5. Absent inputs are dropped, not scored as 0');
const probeAbsent = loadConnector({ blockGroups: { '080010000001': { walkability: 200, autoNetDensity: 0 } } });
const pa = probeAbsent(['08001000000']);
check(pa && pa.bikeScore === 100, `bike score with land-use mix missing uses what was measured (got ${pa && pa.bikeScore})`);
check(pa && pa.walkScore === null,
  `no EPA walkability index gives no walk score, not a blend of what else was measured (got ${pa && pa.walkScore})`);
const probeNone = loadConnector({ blockGroups: { '080010000001': {} } });
check(probeNone(['08001000000']) === null || probeNone(['08001000000']).walkScore === null,
  'nothing measured gives no walk score, not 0');

console.log('\n6. The rendered row shows the connector\'s distance');
const html = renderAccess(rm);
const t = text(html);
check(t.includes('Nearest Transit Stop ' + rm.nearestTransitStopMeters.toLocaleString('en-US') + ' m'),
  `row shows "${rm.nearestTransitStopMeters.toLocaleString('en-US')} m" under Nearest Transit Stop`);
check(!/frequency/i.test(t.replace(rm.transitScoreUnavailableReason, '')), 'no "frequency" wording besides the reason saying D4A is not one');
check(t.includes(expected(mixed).n + ' of ' + expected(mixed).of + ' block group'), 'row discloses how many block groups have a value');
const tb = text(renderAccess(rb));
check(tb.includes('Nearest Transit Stop None reported') && !/Nearest Transit Stop 0\b/.test(tb), 'all-blank tract renders "None reported", not 0 m');
const tn = text(renderAccess({ walkScore: null, bikeScore: null, nearestTransitStopMeters: null }));
check(/Walkability Unavailable/.test(tn) && !/Walkability 0\b/.test(tn), 'a null walk score renders Unavailable, not 0');

console.log('\n7. The glossary states what the connector and the data actually do');
// Bike: weights measured by probing, one component at 100, the others at 0.
function measured(bg) { return loadConnector({ blockGroups: { '080010000001': Object.assign({ walkability: 0 }, bg) } })(['08001000000']); }
const bikeW = {
  auto: measured({ walkability: 0, landUseMix: 0, autoNetDensity: 0 }).bikeScore,
  mix: measured({ walkability: 0, landUseMix: 1, autoNetDensity: 48 }).bikeScore,
  intersection: measured({ walkability: 200, landUseMix: 0, autoNetDensity: 48 }).bikeScore
};
const gloss = JSON.parse(fs.readFileSync(GLOSSARY, 'utf8'));
const entries = gloss.terms || gloss.entries || gloss;
const find = term => (Array.isArray(entries) ? entries : Object.values(entries)).find(e => e && e.term === term);
function statedWeights(def) {
  const out = {};
  const re = /([A-Za-z\- ]+?)\s*\((\d+)%(?: weight)?\)/g;
  let m;
  while ((m = re.exec(def))) {
    const name = m[1].toLowerCase();
    const key = /intersection/.test(name) ? 'intersection' : /mix/.test(name) ? 'mix'
      : /auto/.test(name) ? 'auto' : name.trim();
    out[key] = Number(m[2]);
  }
  return out;
}
const walkDef = (find('Walkability Score') || {}).definition || '';
const bikeDef = (find('Bikeability Score') || {}).definition || '';
check(walkDef && bikeDef, 'glossary has Walkability Score and Bikeability Score entries');
const gb = statedWeights(bikeDef);
check(JSON.stringify(Object.keys(gb).sort().map(k => [k, gb[k]])) === JSON.stringify(Object.keys(bikeW).sort().map(k => [k, bikeW[k]])),
  `bikeability weights: glossary ${JSON.stringify(gb)} = connector ${JSON.stringify(bikeW)}`);

// Walk: the glossary's stated index weights must reproduce EPA's index in the
// data file for every block group, and the connector's walk score must be that
// index on the stated 1-20 -> 0-100 scale.
const fracRe = /(intersection density|proximity to the nearest transit stop|employment and household mix|employment mix)\s*\((\d+)\/(\d+)\)/g;
const gwk = {}; let fm;
while ((fm = fracRe.exec(walkDef))) gwk[fm[1]] = Number(fm[2]) / Number(fm[3]);
const rankKey = { 'intersection density': 'd3bRanked', 'proximity to the nearest transit stop': 'd4aRanked',
  'employment and household mix': 'd2aRanked', 'employment mix': 'd2bRanked' };
check(Object.keys(gwk).length === 4, `glossary states four walkability index weights (${JSON.stringify(gwk)})`);
const withIndex = Object.entries(DATA.blockGroups).filter(([, b]) => b.walkIndex != null);
const offFormula = withIndex.filter(([, b]) =>
  Math.abs(Object.entries(gwk).reduce((s, [k, w]) => s + b[rankKey[k]] * w, 0) - b.walkIndex) > 0.01);
check(withIndex.length === Object.keys(DATA.blockGroups).length,
  `every block group carries EPA's walkability index (${withIndex.length} of ${Object.keys(DATA.blockGroups).length})`);
check(offFormula.length === 0, `glossary weights reproduce the data file's index for every block group (${offFormula.length} differ)`);
const scaleM = /rescaled from EPA's (\d+)[–-](\d+) scale to (\d+)[–-](\d+)/.exec(walkDef);
check(!!scaleM, 'glossary states the rescaling');
if (scaleM) {
  const [lo, hi, a, b] = scaleM.slice(1).map(Number);
  const probes = [lo, hi, (lo + hi) / 2, 7.25, 16];
  const off = probes.filter(ix => measured({ walkIndex: ix }).walkScore !== Math.round(a + (ix - lo) / (hi - lo) * (b - a)));
  check(off.length === 0, `connector walk score = glossary rescaling at ${JSON.stringify(probes)} (${off.length} differ)`);
}
const labelOf = ix => measured({ walkIndex: ix }).walkLabel;
check([[16, 'Most walkable'], [12, 'Above average'], [8, 'Below average'], [3, 'Least walkable']]
  .every(([ix, l]) => labelOf(ix) === l && walkDef.includes(l)), 'walk labels are EPA\'s categories, as the glossary states');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
