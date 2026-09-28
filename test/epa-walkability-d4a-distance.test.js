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

/** Run the real connector; tracts are chosen through its declared PMAEngine hook. */
function loadConnector(data) {
  let tracts = [];
  const window = { PMAEngine: { tractsInBuffer: () => tracts.map(g => ({ geoid: g })) } };
  const sandbox = {
    window, document: { readyState: 'complete' },
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout() {}, Math, Object, Array, Number, String, isFinite
  };
  vm.runInNewContext(fs.readFileSync(CONNECTOR, 'utf8'), sandbox, { filename: CONNECTOR });
  window.EpaWalkability.load(data);
  return function scoresFor(geoids) { tracts = geoids; return window.EpaWalkability.getScores(39.7, -105); };
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

console.log('\n4. D4A does not move the walk or bike score');
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
const probeAbsent = loadConnector({ blockGroups: { '080010000001': { walkability: 200 } } });
const pa = probeAbsent(['08001000000']);
check(pa && pa.walkScore === 100, `walk score with land-use mix missing uses what was measured (got ${pa && pa.walkScore})`);
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

console.log('\n7. The glossary states the weights the connector applies');
// Measure weights by probing: one component at 100, the others at 0.
function measured(bg) { return loadConnector({ blockGroups: { '080010000001': bg } })(['08001000000']); }
const walkW = { intersection: measured({ walkability: 200, landUseMix: 0 }).walkScore, mix: measured({ walkability: 0, landUseMix: 1 }).walkScore };
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
const gw = statedWeights(walkDef), gb = statedWeights(bikeDef);
check(JSON.stringify(gw) === JSON.stringify(walkW),
  `walkability weights: glossary ${JSON.stringify(gw)} = connector ${JSON.stringify(walkW)}`);
check(JSON.stringify(Object.keys(gb).sort().map(k => [k, gb[k]])) === JSON.stringify(Object.keys(bikeW).sort().map(k => [k, bikeW[k]])),
  `bikeability weights: glossary ${JSON.stringify(gb)} = connector ${JSON.stringify(bikeW)}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
