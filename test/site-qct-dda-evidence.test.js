// test/site-qct-dda-evidence.test.js
//
// The site QCT/DDA lookup must say WHAT matched and WHICH HUD vintage said so,
// not only yes/no (#1931).
//
// HudEgis.checkDesignation() returned in_qct / in_dda flags and a reason. The
// Subsidy card showed Yes / No / Unknown with no tract, no DDA and no source,
// and the saved PMA snapshot kept nothing of it. This runs the real connector
// against the real data files and checks every answer against something
// independent of it:
//
//   1. the tract GEOID returned is the tract whose polygon contains the point,
//      found by a separate point-in-polygon pass over data/qct-colorado.json;
//   2. the DDA name/code returned is the DDA feature whose polygon contains the
//      point, found the same way over data/dda-colorado.json;
//   3. the HUD year is the one the data file's own `source` metadata names;
//   4. no coordinates → every flag null with a reason, never false;
//   5. a jurisdiction centroid (the ?auto=1 deep-link run) is not a site: the
//      real controller reports QCT/DDA unknown for it even when the centroid
//      falls inside a QCT, and the page's auto-run passes the siteSource value
//      the controller recognises;
//   6. the Subsidy card renders the matched tract / DDA and "HUD <year> QCT";
//   7. the saved PMA snapshot persists the evidence object.
//
// Run: node test/site-qct-dda-evidence.test.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const HUD_SRC = process.env.HUD_EGIS_SRC || 'js/data-connectors/hud-egis.js';
const read = (f) => fs.readFileSync(path.resolve(ROOT, f), 'utf8');
const QCT = JSON.parse(read('data/qct-colorado.json'));
const DDA = JSON.parse(read('data/dda-colorado.json'));

// ── Independent geometry (not the connector's) ───────────────────────────────
function inRing(x, y, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function inPoly(x, y, rings) {
  return inRing(x, y, rings[0]) && !rings.slice(1).some((h) => inRing(x, y, h));
}
function containing(fc, lat, lon) {
  return fc.features.filter((f) => {
    const g = f.geometry;
    if (!g) return false;
    if (g.type === 'Polygon') return inPoly(lon, lat, g.coordinates);
    if (g.type === 'MultiPolygon') return g.coordinates.some((p) => inPoly(lon, lat, p));
    return false;
  });
}
// A point strictly inside a feature: walk a grid over its bbox until the
// independent test says inside. Picked from the data, not typed.
function interiorPoint(feature) {
  const rings = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates : feature.geometry.coordinates[0];
  const xs = rings[0].map((p) => p[0]);
  const ys = rings[0].map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (let n = 2; n <= 40; n++) {
    for (let i = 1; i < n; i++) {
      for (let j = 1; j < n; j++) {
        const lon = x0 + ((x1 - x0) * i) / n;
        const lat = y0 + ((y1 - y0) * j) / n;
        if (inPoly(lon, lat, rings)) return { lat, lon };
      }
    }
  }
  return null;
}
// The year the file's own metadata names (HUD layer name, e.g. ..._2026).
function metaYear(fc) {
  const m = /_(\d{4})\b/.exec(String(fc.source || ''));
  return m ? Number(m[1]) : null;
}

function loadHudEgis(withData) {
  const ctx = {
    console: { log() {}, info() {}, warn() {} },
    document: { readyState: 'complete', addEventListener() {} },
    setTimeout() {},
    window: {},
  };
  vm.createContext(ctx);
  vm.runInContext(read(HUD_SRC), ctx, { filename: HUD_SRC });
  const H = ctx.window.HudEgis;
  if (withData) { H.loadLocalQct(QCT); H.loadLocalDda(DDA); }
  return H;
}

// ── Points, all derived from the data ────────────────────────────────────────
const qctFeature = QCT.features.find((f) => f.properties && /^08031/.test(String(f.properties.GEOID)));
assert(qctFeature, 'data/qct-colorado.json has a Denver (08031) QCT to test against');
const IN_QCT = interiorPoint(qctFeature);
assert(IN_QCT, 'found an interior point of QCT ' + qctFeature.properties.GEOID);
const ddaFeature = DDA.features.find((f) => f.geometry && interiorPoint(f));
const IN_DDA = interiorPoint(ddaFeature);
// Outside both: a coarse grid over Colorado, first point in no QCT and no DDA.
let OUTSIDE = null;
for (let lat = 37.2; lat < 40.9 && !OUTSIDE; lat += 0.37) {
  for (let lon = -108.9; lon < -102.2 && !OUTSIDE; lon += 0.41) {
    if (!containing(QCT, lat, lon).length && !containing(DDA, lat, lon).length) OUTSIDE = { lat, lon };
  }
}
assert(OUTSIDE, 'found a Colorado point outside every QCT and DDA');

// ── 1–4. The connector ───────────────────────────────────────────────────────
function checkConnector() {
  const H = loadHudEgis(true);
  const QY = metaYear(QCT);
  const DY = metaYear(DDA);
  assert(Number.isInteger(QY) && Number.isInteger(DY), 'both data files name a HUD year in their source metadata (non-vacuous)');

  // Inside a QCT.
  let r = H.checkDesignation(IN_QCT.lat, IN_QCT.lon);
  const hits = containing(QCT, IN_QCT.lat, IN_QCT.lon);
  assert.strictEqual(hits.length >= 1, true, 'independent check finds the point inside a QCT polygon');
  assert.strictEqual(r.in_qct, true, 'point inside QCT ' + qctFeature.properties.GEOID + ' → in_qct true');
  assert(r.evidence && r.evidence.qct, 'checkDesignation returns an evidence object');
  assert.strictEqual(r.evidence.qct.tractGeoid, String(hits[0].properties.GEOID),
    'returned tract GEOID is the tract whose polygon contains the point');
  assert.strictEqual(r.evidence.qct.tractGeoid.length, 11, 'tract GEOID is an 11-digit string');
  assert.strictEqual(r.evidence.qct.year, QY, 'QCT year agrees with data/qct-colorado.json source metadata (' + QY + ')');
  assert.strictEqual(r.evidence.qct.source, QCT.source, 'QCT source is the file\'s own source string');
  assert.strictEqual(r.evidence.qct.fetchedAt, QCT.fetchedAt, 'QCT fetchedAt is the file\'s own');

  // Inside a DDA.
  r = H.checkDesignation(IN_DDA.lat, IN_DDA.lon);
  const ddaHits = containing(DDA, IN_DDA.lat, IN_DDA.lon);
  assert.strictEqual(r.in_dda, true, 'point inside DDA ' + ddaFeature.properties.DDA_NAME + ' → in_dda true');
  assert.strictEqual(r.evidence.dda.ddaCode, String(ddaHits[0].properties.DDA_CODE), 'DDA code is the containing DDA\'s');
  assert.strictEqual(r.evidence.dda.ddaName, String(ddaHits[0].properties.DDA_NAME), 'DDA name is the containing DDA\'s');
  assert.strictEqual(r.evidence.dda.year, DY, 'DDA year agrees with data/dda-colorado.json source metadata (' + DY + ')');

  // Outside both: a verified no, with no match and the vintage still stated.
  r = H.checkDesignation(OUTSIDE.lat, OUTSIDE.lon);
  assert.deepStrictEqual([r.in_qct, r.in_dda, r.basis_boost_eligible], [false, false, false], 'outside both → verified false');
  assert.strictEqual(r.evidence.qct.tractGeoid, null, 'outside a QCT → no tract GEOID');
  assert.strictEqual(r.evidence.dda.ddaName, null, 'outside a DDA → no DDA name');
  assert.strictEqual(r.evidence.qct.year, QY, 'a "no" still names the HUD vintage it was checked against');

  // Unknown input → null with a reason, never false.
  for (const [lat, lon] of [[null, null], [undefined, undefined], [NaN, NaN], ['39.7', '-105']]) {
    r = H.checkDesignation(lat, lon);
    assert.strictEqual(r.in_qct, null, 'coords ' + lat + ',' + lon + ': in_qct null, not false');
    assert.strictEqual(r.in_dda, null, 'coords ' + lat + ',' + lon + ': in_dda null, not false');
    assert.strictEqual(r.basis_boost_eligible, null, 'coords ' + lat + ',' + lon + ': basis boost null');
    assert.match(r.unavailableReason || '', /No site coordinates/, 'no coordinates carries a reason');
    assert.strictEqual(r.evidence.qct.tractGeoid, null);
    assert.strictEqual(r.evidence.qct.year, null, 'no lookup → no vintage claimed');
  }

  // Layers not loaded → null with a reason, and no year claimed.
  r = loadHudEgis(false).checkDesignation(IN_QCT.lat, IN_QCT.lon);
  assert.deepStrictEqual([r.in_qct, r.in_dda], [null, null], 'no data loaded → unknown');
  assert.strictEqual(r.evidence.qct.year, null, 'no data loaded → no year');
  assert.match(r.evidence.qct.unavailableReason || '', /QCT data not loaded/);

  // A file whose source names no year → year null (never assumed).
  const H2 = loadHudEgis(false);
  H2.loadLocalQct(Object.assign({}, QCT, { source: 'HUD ArcGIS FeatureServer' }));
  H2.loadLocalDda(DDA);
  r = H2.checkDesignation(IN_QCT.lat, IN_QCT.lon);
  assert.strictEqual(r.in_qct, true);
  assert.strictEqual(r.evidence.qct.year, null, 'source without a year → year null, not a typed default');

  // The evidence is plain data the snapshot can persist.
  r = H.checkDesignation(IN_QCT.lat, IN_QCT.lon);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.evidence)), JSON.parse(JSON.stringify(r.evidence)));
  assert.strictEqual(JSON.parse(JSON.stringify(r.evidence)).qct.tractGeoid, r.evidence.qct.tractGeoid, 'evidence survives JSON');
}

// ── 5. Controller: a jurisdiction centroid is not a site ────────────────────
async function checkController() {
  const rendered = [];
  const states = [];
  const zero = [];
  const win = {
    APP_CONFIG: {},
    console: { log() {}, warn() {}, info() {}, error() {} },
    setTimeout: (fn, ms) => { if (!ms) zero.push(fn); return 1; },
  };
  win.window = win;
  win.CustomEvent = function (t, o) { this.type = t; this.detail = o && o.detail; };
  win.document = { readyState: 'complete', getElementById: () => null, addEventListener() {}, dispatchEvent() {},
    querySelector: () => null, querySelectorAll: () => [] };
  win.MAState = { setState(s) { states.push(s); }, getState: () => ({}) };
  win.MARenderers = new Proxy({}, { get: (t, k) => (k === 'renderSubsidyOpportunities' ? (d) => rendered.push(d) : () => {}) });
  const ctx = vm.createContext(win);
  vm.runInContext(read(HUD_SRC), ctx, { filename: HUD_SRC });
  win.HudEgis.loadLocalQct(QCT);
  win.HudEgis.loadLocalDda(DDA);
  for (const m of ['js/market-analysis/site-selection-score.js', process.env.MA_CONTROLLER_SRC || 'js/market-analysis/market-analysis-controller.js']) {
    vm.runInContext(read(m), ctx, { filename: m });
  }
  const flush = async () => {
    for (let i = 0; i < 30; i++) {
      while (zero.length) zero.shift()();
      await new Promise((r) => setImmediate(r));
    }
  };

  // The siteSource value the page's auto-run sends, read from the page and
  // from market-analysis.js — the controller must recognise exactly that.
  const html = read('market-analysis.html');
  const engine = read('js/market-analysis.js');
  const autoRun = html.slice(html.indexOf('function _autoRunIfRequested'), html.indexOf('function _autoRunIfRequested') + 4000);
  assert.match(autoRun, /placeSiteMarker\(lat, lng, \{ jurisdictionCentroid: true \}\)/,
    'the ?auto=1 run marks its point as a jurisdiction centroid');
  const htmlSource = (/MAController\.runAnalysis\([^)]*\{\s*siteSource:\s*'([a-z_]+)'/.exec(autoRun) || [])[1];
  const engineSource = (/siteSource: _isCentroid \? '([a-z_]+)'/.exec(engine) || [])[1];
  assert(htmlSource && engineSource, 'found the siteSource value in the page and in market-analysis.js (non-vacuous)');
  assert.strictEqual(htmlSource, engineSource, 'page and market-analysis.js send the same centroid siteSource');

  // Same point, inside a real QCT: as a site → Yes + tract; as a centroid → unknown.
  await flush();
  win.MAController.runAnalysis(IN_QCT.lat, IN_QCT.lon, 3);
  await flush();
  const asSite = rendered.pop();
  assert(asSite, 'controller rendered the Subsidy section for a site (non-vacuous)');
  assert.strictEqual(asSite.qctFlag, true, 'a chosen site inside a QCT → qctFlag true');
  assert.strictEqual(asSite.designationEvidence.qct.tractGeoid, String(qctFeature.properties.GEOID),
    'the rendered evidence names the containing tract');
  const subState = states.map((s) => s.sections && s.sections.subsidy).filter(Boolean).pop();
  assert(subState && subState.designationEvidence && subState.designationEvidence.qct.tractGeoid === asSite.designationEvidence.qct.tractGeoid,
    'MAState sections.subsidy carries the same evidence (what the snapshot reads)');

  win.MAController.runAnalysis(IN_QCT.lat, IN_QCT.lon, 3, { siteSource: htmlSource });
  await flush();
  const asCentroid = rendered.pop();
  assert(asCentroid, 'controller rendered the Subsidy section for a centroid (non-vacuous)');
  assert.strictEqual(asCentroid.qctFlag, null, 'a jurisdiction centroid cannot produce a QCT yes/no');
  assert.strictEqual(asCentroid.ddaFlag, null, 'a jurisdiction centroid cannot produce a DDA yes/no');
  assert.strictEqual(asCentroid.basisBoostEligible, null);
  assert.strictEqual(asCentroid.designationEvidence, null, 'no evidence for a centroid');
  assert.match(asCentroid.designationUnavailableReason || '', /No site selected/, 'the centroid case says why');
  const centroidSite = win.MAController.getCurrentSite();

  // Saved while a new site's lookup is still pending: the controller's current
  // site has no designation yet, whatever the previous run found.
  win.MAController.runAnalysis(IN_QCT.lat, IN_QCT.lon, 3);
  await flush();
  const resolvedSite = win.MAController.getCurrentSite();
  win.MAController.runAnalysis(OUTSIDE.lat, OUTSIDE.lon, 3);
  const pendingSite = win.MAController.getCurrentSite();
  await flush();
  return { asSite, resolvedSite, pendingSite, centroidSite };
}

// ── 6. Subsidy card ──────────────────────────────────────────────────────────
function checkRenderer(asSite) {
  const dom = new JSDOM('<!doctype html><body><div id="maSubsidyOppContent"></div></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.console = { log() {}, info() {}, warn() {}, error() {} };
  w.eval(read('js/market-analysis/market-report-renderers.js'));
  const box = w.document.getElementById('maSubsidyOppContent');
  const H = loadHudEgis(true);

  w.MARenderers.renderSubsidyOpportunities(asSite);
  const QY = metaYear(QCT);
  const tract = asSite.designationEvidence.qct.tractGeoid;
  assert.match(box.textContent, new RegExp('\\(QCT\\)Yes Tract ' + tract + 'HUD ' + QY + ' QCT'),
    'QCT row shows Yes, the matched tract and "HUD ' + QY + ' QCT" (got: ' + box.textContent + ')');
  assert.match(box.textContent, new RegExp('\\(DDA\\)NoHUD ' + metaYear(DDA) + ' DDA'), 'DDA row shows No with its HUD vintage');

  const d = H.checkDesignation(IN_DDA.lat, IN_DDA.lon);
  w.MARenderers.renderSubsidyOpportunities({ qctFlag: d.in_qct, ddaFlag: d.in_dda, designationEvidence: d.evidence });
  assert(box.textContent.includes('(DDA)Yes ' + d.evidence.dda.ddaName + 'HUD ' + metaYear(DDA) + ' DDA'),
    'DDA row shows Yes, the matched DDA name and its HUD vintage (got: ' + box.textContent + ')');

  const u = H.checkDesignation(null, null);
  w.MARenderers.renderSubsidyOpportunities({ qctFlag: u.in_qct, ddaFlag: u.in_dda,
    designationUnavailableReason: u.unavailableReason, designationEvidence: u.evidence });
  assert.match(box.textContent, /\(QCT\)Unknown/, 'no coordinates → Unknown');
  assert.doesNotMatch(box.textContent, /HUD \d{4}/, 'Unknown does not claim a HUD vintage');
}

// ── 7. Saved PMA snapshot ────────────────────────────────────────────────────
// savePmaToProject() as the page defines it, fed the controller's real
// getCurrentSite() result for each case.
function saveSnapshot(site) {
  const html = read('market-analysis.html');
  const start = html.indexOf('function savePmaToProject()');
  const end = html.indexOf('document.addEventListener(\'DOMContentLoaded\'', start);
  assert(start > 0 && end > start, 'market-analysis.html defines savePmaToProject');
  const saved = [];
  const ctx = vm.createContext({
    window: { MAController: { getCurrentSite: () => site } },
    WorkflowState: { setStep: (k, v) => saved.push([k, v]) },
    Number, console,
  });
  ctx.window.WorkflowState = ctx.WorkflowState;
  vm.runInContext(html.slice(start, end) + '\nthis.__ok = savePmaToProject();', ctx);
  assert.strictEqual(ctx.__ok, true, 'savePmaToProject ran');
  assert.strictEqual(saved[0] && saved[0][0], 'market');
  return saved[0][1];
}

function checkSnapshot({ asSite, resolvedSite, pendingSite, centroidSite }) {
  // Saved for the site the evidence belongs to.
  const snap = saveSnapshot(resolvedSite);
  assert(snap && snap.qctDdaEvidence, 'the saved snapshot carries qctDdaEvidence');
  assert.strictEqual(snap.qctDdaEvidence.qctFlag, true);
  assert.strictEqual(snap.qctDdaEvidence.evidence.qct.tractGeoid, asSite.designationEvidence.qct.tractGeoid,
    'the snapshot keeps the matched tract GEOID');
  assert.strictEqual(snap.qctDdaEvidence.evidence.qct.year, metaYear(QCT), 'the snapshot keeps the HUD year');
  // The canonical fields the next steps read agree with the evidence.
  const hos = read('js/housing-outcome-score.js');
  assert(/market\.qctFlag/.test(hos) && /market\.ddaFlag/.test(hos),
    'HousingOutcomeScore no longer reads market.qctFlag/ddaFlag; update this guard to what it reads');
  assert.strictEqual(snap.qctFlag, snap.qctDdaEvidence.qctFlag, 'market.qctFlag agrees with the evidence');
  assert.strictEqual(snap.ddaFlag, snap.qctDdaEvidence.ddaFlag, 'market.ddaFlag agrees with the evidence');
  assert.strictEqual(snap.siteLat, IN_QCT.lat, 'the snapshot records the current site');

  // Saved while a new site's lookup is pending: nothing from the previous
  // site's tract is saved as this site's designation.
  const pending = saveSnapshot(pendingSite);
  assert.strictEqual(pending.siteLat, OUTSIDE.lat, 'the pending snapshot is for the new site');
  assert.strictEqual(pending.qctFlag, null, 'another site\'s QCT answer is not this site\'s');
  assert.strictEqual(pending.ddaFlag, null);
  assert.strictEqual(pending.qctDdaEvidence, null, 'another site\'s tract is not saved');

  // A jurisdiction centroid saves unknown flags with the reason, no tract.
  const centroid = saveSnapshot(centroidSite);
  assert.strictEqual(centroid.qctFlag, null);
  assert.strictEqual(centroid.qctDdaEvidence.evidence, null, 'no tract saved for a centroid');
  assert.match(centroid.qctDdaEvidence.unavailableReason || '', /No site selected/);
}

(async () => {
  checkConnector();
  const sites = await checkController();
  const asSite = sites.asSite;
  checkRenderer(asSite);
  checkSnapshot(sites);
  console.log('site-qct-dda-evidence: PASS (tract ' + qctFeature.properties.GEOID + ' @ ' +
    IN_QCT.lat.toFixed(4) + ',' + IN_QCT.lon.toFixed(4) + '; DDA ' + ddaFeature.properties.DDA_NAME +
    '; outside @ ' + OUTSIDE.lat.toFixed(2) + ',' + OUTSIDE.lon.toFixed(2) + '; HUD ' + metaYear(QCT) + ')');
})().catch((e) => { console.error(e); process.exit(1); });
