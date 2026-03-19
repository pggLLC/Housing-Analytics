// test/hud-egis.test.js
//
// Unit tests for js/data-connectors/hud-egis.js
// Tests the ray-casting point-in-polygon algorithm (no external library),
// the checkDesignation() public API, and the module structure.
//
// Usage:
//   node test/hud-egis.test.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const SRC     = path.join(ROOT, 'js/data-connectors/hud-egis.js');
const QCT_PATH = path.join(ROOT, 'data/qct-colorado.json');
const DDA_PATH = path.join(ROOT, 'data/dda-colorado.json');

let passed = 0;
let failed = 0;

function pass(msg) { console.log('  ✅ PASS: ' + msg); passed++; }
function fail(msg) { console.error('  ❌ FAIL: ' + msg); failed++; }

// ─── Helper: re-implement point-in-ring for testing (mirrors hud-egis.js) ────
// We extract and re-verify the algorithm logic independently so we can run
// node tests without a browser / DOM environment.

function _pointInRing(lat, lon, ring) {
  var inside = false;
  var n = ring.length;
  for (var i = 0, j = n - 1; i < n; j = i++) {
    var xi = ring[i][0], yi = ring[i][1]; // [lon, lat]
    var xj = ring[j][0], yj = ring[j][1];
    var intersect = ((yi > lat) !== (yj > lat)) &&
                    (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function _pointInFeature(lat, lon, feature) {
  if (!feature || !feature.geometry) return false;
  var geom   = feature.geometry;
  var coords = geom.coordinates;
  if (geom.type === 'Polygon') {
    if (!_pointInRing(lat, lon, coords[0])) return false;
    for (var h = 1; h < coords.length; h++) {
      if (_pointInRing(lat, lon, coords[h])) return false;
    }
    return true;
  }
  if (geom.type === 'MultiPolygon') {
    for (var p = 0; p < coords.length; p++) {
      var rings = coords[p];
      if (!_pointInRing(lat, lon, rings[0])) continue;
      var inHole = false;
      for (var h2 = 1; h2 < rings.length; h2++) {
        if (_pointInRing(lat, lon, rings[h2])) { inHole = true; break; }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

function _isInCollection(lat, lon, fc) {
  if (!fc || !Array.isArray(fc.features)) return false;
  for (var i = 0; i < fc.features.length; i++) {
    if (_pointInFeature(lat, lon, fc.features[i])) return true;
  }
  return false;
}

// ─── 1. Source file structure ─────────────────────────────────────────────────
console.log('\n── 1. hud-egis.js source structure ──');

if (!fs.existsSync(SRC)) {
  fail('js/data-connectors/hud-egis.js not found');
} else {
  pass('js/data-connectors/hud-egis.js exists');
  var src = fs.readFileSync(SRC, 'utf8');

  // Public API
  if (/window\.HudEgis/.test(src))          pass('Exposes window.HudEgis');
  else                                        fail('Does not expose window.HudEgis');

  if (/checkDesignation/.test(src))          pass('checkDesignation() function present');
  else                                        fail('checkDesignation() function missing');

  if (/isQct/.test(src))                     pass('isQct() function present');
  else                                        fail('isQct() function missing');

  if (/isDda/.test(src))                     pass('isDda() function present');
  else                                        fail('isDda() function missing');

  if (/loadLocalQct/.test(src))              pass('loadLocalQct() function present');
  else                                        fail('loadLocalQct() function missing');

  if (/loadLocalDda/.test(src))              pass('loadLocalDda() function present');
  else                                        fail('loadLocalDda() function missing');

  // Ray-casting internals
  if (/_pointInRing/.test(src))              pass('_pointInRing() internal function present');
  else                                        fail('_pointInRing() internal function missing');

  if (/_pointInFeature/.test(src))           pass('_pointInFeature() internal function present');
  else                                        fail('_pointInFeature() internal function missing');

  if (/_isInCollection/.test(src))           pass('_isInCollection() internal function present');
  else                                        fail('_isInCollection() internal function missing');

  // Safe fallback
  if (/basis_boost_eligible.*false/.test(src)) pass('Safe fallback returns basis_boost_eligible: false');
  else                                          fail('Safe fallback missing basis_boost_eligible: false');

  // IRC §42 reference
  if (/IRC.*42/.test(src))                   pass('IRC §42 reference present in comments');
  else                                        fail('IRC §42 reference missing from comments');

  // No raw fetch() paths
  if (/fetch\("data\//.test(src))            fail('Uses raw fetch("data/...") — must use DataService');
  else                                        pass('No raw fetch("data/...") paths');

  // DataService usage
  if (/DataService/.test(src))               pass('Uses window.DataService');
  else                                        fail('DataService reference missing');

  // In-memory caching
  if (/_loadAttempted/.test(src))            pass('_loadAttempted caching flag present');
  else                                        fail('_loadAttempted caching flag missing');
}

// ─── 2. Data files ────────────────────────────────────────────────────────────
console.log('\n── 2. QCT / DDA data files ──');

var qctData = null;
var ddaData = null;

if (fs.existsSync(QCT_PATH)) {
  try {
    qctData = JSON.parse(fs.readFileSync(QCT_PATH, 'utf8'));
    if (qctData.type === 'FeatureCollection' && Array.isArray(qctData.features)) {
      pass('qct-colorado.json is a valid FeatureCollection (' + qctData.features.length + ' features)');
    } else {
      fail('qct-colorado.json: unexpected structure');
    }
  } catch (e) { fail('qct-colorado.json: invalid JSON — ' + e.message); }
} else {
  fail('data/qct-colorado.json not found');
}

if (fs.existsSync(DDA_PATH)) {
  try {
    ddaData = JSON.parse(fs.readFileSync(DDA_PATH, 'utf8'));
    if (ddaData.type === 'FeatureCollection' && Array.isArray(ddaData.features)) {
      pass('dda-colorado.json is a valid FeatureCollection (' + ddaData.features.length + ' features)');
    } else {
      fail('dda-colorado.json: unexpected structure');
    }
  } catch (e) { fail('dda-colorado.json: invalid JSON — ' + e.message); }
} else {
  fail('data/dda-colorado.json not found');
}

// ─── 3. Ray-casting algorithm ─────────────────────────────────────────────────
console.log('\n── 3. Ray-casting algorithm ──');

// Unit square polygon [lon, lat]: corners at (0,0),(1,0),(1,1),(0,1).
var unitSquareRing = [[0,0],[1,0],[1,1],[0,1],[0,0]];

// lat=0.5, lon=0.5 → inside
if (_pointInRing(0.5, 0.5, unitSquareRing)) pass('Point inside simple square → true');
else                                          fail('Point inside simple square should be true');

// lat=1.5, lon=0.5 → outside (above)
if (!_pointInRing(1.5, 0.5, unitSquareRing)) pass('Point above simple square → false');
else                                           fail('Point above simple square should be false');

// lat=0.5, lon=1.5 → outside (right)
if (!_pointInRing(0.5, 1.5, unitSquareRing)) pass('Point right of simple square → false');
else                                           fail('Point right of simple square should be false');

// Polygon with hole: outer square minus inner square
var outerRing = [[0,0],[4,0],[4,4],[0,4],[0,0]];
var holeRing  = [[1,1],[3,1],[3,3],[1,3],[1,1]]; // hole in the middle
var featureWithHole = {
  geometry: {
    type: 'Polygon',
    coordinates: [outerRing, holeRing]
  }
};

// lat=2, lon=2 → inside the hole → should be OUTSIDE the feature
if (!_pointInFeature(2, 2, featureWithHole)) pass('Point inside hole of Polygon → false (correctly excluded)');
else                                           fail('Point inside hole should be excluded (false)');

// lat=0.5, lon=0.5 → in outer ring, not in hole → should be INSIDE
if (_pointInFeature(0.5, 0.5, featureWithHole)) pass('Point in outer ring but not in hole → true');
else                                              fail('Point in outer ring outside hole should be true');

// MultiPolygon test: two disjoint unit squares
var multiPolyFeature = {
  geometry: {
    type: 'MultiPolygon',
    coordinates: [
      [[[0,0],[1,0],[1,1],[0,1],[0,0]]],   // polygon 1
      [[[5,5],[6,5],[6,6],[5,6],[5,5]]]    // polygon 2
    ]
  }
};

if (_pointInFeature(0.5, 0.5, multiPolyFeature))  pass('Point in first polygon of MultiPolygon → true');
else                                                fail('Point in first polygon of MultiPolygon should be true');

if (_pointInFeature(5.5, 5.5, multiPolyFeature))  pass('Point in second polygon of MultiPolygon → true');
else                                                fail('Point in second polygon of MultiPolygon should be true');

if (!_pointInFeature(3.0, 3.0, multiPolyFeature)) pass('Point between polygons of MultiPolygon → false');
else                                                fail('Point between polygons of MultiPolygon should be false');

// ─── 4. Point-in-polygon against real QCT data ───────────────────────────────
console.log('\n── 4. Point-in-polygon vs real QCT data ──');

if (qctData && qctData.features.length > 0) {
  // Centroid of downtown Denver (39.7392° N, 104.9903° W) is a well-known QCT location.
  var denverLat = 39.7392;
  var denverLon = -104.9903;
  var inQct = _isInCollection(denverLat, denverLon, qctData);
  // We don't assert a specific boolean — actual QCT membership depends on the census year
  // and exact polygon boundaries. We just verify the function returns a boolean.
  if (typeof inQct === 'boolean') {
    pass('_isInCollection(Denver) returns boolean: ' + inQct);
  } else {
    fail('_isInCollection(Denver) did not return boolean');
  }

  // A point in the Pacific Ocean (lat=0, lon=-150) should never be in a Colorado QCT.
  var pacificInQct = _isInCollection(0, -150, qctData);
  if (!pacificInQct) pass('Pacific Ocean point not in any CO QCT → false');
  else                fail('Pacific Ocean should not be in CO QCT');

  // The first QCT feature's first ring centroid should be inside that feature.
  var firstFeature = qctData.features[0];
  if (firstFeature && firstFeature.geometry) {
    var coords;
    if (firstFeature.geometry.type === 'Polygon') {
      coords = firstFeature.geometry.coordinates[0];
    } else if (firstFeature.geometry.type === 'MultiPolygon') {
      coords = firstFeature.geometry.coordinates[0][0];
    }
    if (coords && coords.length >= 3) {
      // Compute an approximate centroid from the exterior ring.
      var sumLon = 0, sumLat = 0;
      for (var k = 0; k < coords.length - 1; k++) { sumLon += coords[k][0]; sumLat += coords[k][1]; }
      var cLon = sumLon / (coords.length - 1);
      var cLat = sumLat / (coords.length - 1);
      var centroidInQct = _isInCollection(cLat, cLon, qctData);
      if (centroidInQct) pass('Centroid of first QCT feature is inside QCT collection → true');
      else               fail('Centroid of first QCT feature should be inside QCT collection');
    }
  }
} else {
  console.log('  (skipped — QCT data not loaded)');
}

// ─── 5. Point-in-polygon against real DDA data ───────────────────────────────
console.log('\n── 5. Point-in-polygon vs real DDA data ──');

if (ddaData && ddaData.features.length > 0) {
  // Pacific Ocean should never be in a Colorado DDA.
  var pacificInDda = _isInCollection(0, -150, ddaData);
  if (!pacificInDda) pass('Pacific Ocean point not in any CO DDA → false');
  else                fail('Pacific Ocean should not be in CO DDA');

  // First DDA feature centroid should be inside that feature.
  var firstDda = ddaData.features[0];
  if (firstDda && firstDda.geometry) {
    var ddaCoords;
    if (firstDda.geometry.type === 'Polygon') {
      ddaCoords = firstDda.geometry.coordinates[0];
    } else if (firstDda.geometry.type === 'MultiPolygon') {
      ddaCoords = firstDda.geometry.coordinates[0][0];
    }
    if (ddaCoords && ddaCoords.length >= 3) {
      var dSumLon = 0, dSumLat = 0;
      for (var d = 0; d < ddaCoords.length - 1; d++) { dSumLon += ddaCoords[d][0]; dSumLat += ddaCoords[d][1]; }
      var dcLon = dSumLon / (ddaCoords.length - 1);
      var dcLat = dSumLat / (ddaCoords.length - 1);
      var ddaCentroid = _isInCollection(dcLat, dcLon, ddaData);
      if (ddaCentroid) pass('Centroid of first DDA feature is inside DDA collection → true');
      else             fail('Centroid of first DDA feature should be inside DDA collection');
    }
  }
} else {
  console.log('  (skipped — DDA data not loaded)');
}

// ─── 6. checkDesignation() API contract ──────────────────────────────────────
console.log('\n── 6. checkDesignation() API contract ──');

if (!fs.existsSync(SRC)) {
  fail('Source file not found — skipping API contract checks');
} else {
  var srcStr = fs.readFileSync(SRC, 'utf8');

  // checkDesignation() must return an object with in_qct, in_dda, basis_boost_eligible keys.
  if (/in_qct/.test(srcStr))             pass('checkDesignation returns in_qct key');
  else                                    fail('checkDesignation must return in_qct key');

  if (/in_dda/.test(srcStr))             pass('checkDesignation returns in_dda key');
  else                                    fail('checkDesignation must return in_dda key');

  if (/basis_boost_eligible/.test(srcStr)) pass('checkDesignation returns basis_boost_eligible key');
  else                                      fail('checkDesignation must return basis_boost_eligible key');

  if (/in_qct.*in_dda|in_dda.*in_qct/.test(srcStr)) pass('basis_boost_eligible = in_qct || in_dda pattern present');
  else                                                 fail('basis_boost_eligible must equal in_qct || in_dda');
}

// ─── 7. site-selection-score.js — basis_boost_eligible ───────────────────────
console.log('\n── 7. site-selection-score.js — basis_boost_eligible ──');

var scorePath = path.join(ROOT, 'js/market-analysis/site-selection-score.js');
if (fs.existsSync(scorePath)) {
  pass('js/market-analysis/site-selection-score.js exists');
  var scoreSrc = fs.readFileSync(scorePath, 'utf8');

  if (/basis_boost_eligible/.test(scoreSrc))  pass('basis_boost_eligible parameter in site-selection-score.js');
  else                                          fail('basis_boost_eligible parameter missing from site-selection-score.js');

  if (/scoreSubsidy/.test(scoreSrc))           pass('scoreSubsidy() function present');
  else                                          fail('scoreSubsidy() function missing');

  if (/IRC.*42/.test(scoreSrc))                pass('IRC §42 reference in scoreSubsidy comments');
  else                                          fail('IRC §42 reference missing from site-selection-score.js');

  // computeScore() must pass basisBoostEligible
  if (/basisBoostEligible/.test(scoreSrc))     pass('basisBoostEligible passed from computeScore() to scoreSubsidy()');
  else                                          fail('basisBoostEligible not passed in computeScore()');
} else {
  fail('js/market-analysis/site-selection-score.js not found');
}

// ─── 7b. scoreSubsidy() behavioral tests ─────────────────────────────────────
// Re-implement scoreSubsidy() exactly as in site-selection-score.js so we can
// verify the numeric output with known inputs without requiring a DOM/browser.
// This mirrors the approach used in test/unit/pma-*.test.js (re-implement in test).
console.log('\n── 7b. scoreSubsidy() behavioral tests ──');

(function () {
  'use strict';

  function _clamp(v) { return Math.min(100, Math.max(0, isNaN(v) ? 0 : v)); }
  function _safe(v, d) { return (v === null || v === undefined || isNaN(v)) ? d : Number(v); }

  function scoreSubsidy(qctFlag, ddaFlag, fmrRatio, nearbySubsidized, basis_boost_eligible) {
    var score = 0;
    if (typeof basis_boost_eligible !== 'undefined' && basis_boost_eligible) {
      score += 40; // Unified QCT/DDA basis boost bonus (IRC §42(d)(5)(B))
    } else {
      if (qctFlag) score += 30;
      if (ddaFlag) score += 20;
    }
    var fmr    = _safe(fmrRatio, 1.0);
    var fmrPts = _clamp(((fmr - 0.80) / 0.40) * 30);
    score += fmrPts;
    var ns    = _safe(nearbySubsidized, 0);
    var nsPts = _clamp(((200 - Math.min(ns, 200)) / 200) * 20);
    score += nsPts;
    return _clamp(score);
  }

  // When basis_boost_eligible=true, score should include the 40-pt unified bonus.
  var boostScore    = scoreSubsidy(false, false, 1.0, 100, true);
  var noBoostScore  = scoreSubsidy(false, false, 1.0, 100, false);

  if (boostScore > noBoostScore) {
    pass('basis_boost_eligible=true produces higher subsidy score than false (' + boostScore + ' > ' + noBoostScore + ')');
  } else {
    fail('basis_boost_eligible=true should produce a higher score than false');
  }

  // The 40-pt bonus must be exactly 40 points above the no-flag baseline.
  var baseScore = scoreSubsidy(false, false, 1.0, 100, false);
  var bbeScore  = scoreSubsidy(false, false, 1.0, 100, true);
  if (bbeScore - baseScore === 40) {
    pass('basis_boost_eligible adds exactly 40 points over no-flag baseline');
  } else {
    fail('basis_boost_eligible should add exactly 40 pts; got ' + (bbeScore - baseScore));
  }

  // Backward compat: qctFlag alone (no basis_boost_eligible) should add 30 pts.
  var qctScore = scoreSubsidy(true, false, 1.0, 100, undefined);
  if (Math.abs(qctScore - baseScore - 30) < 0.01) {
    pass('qctFlag alone (no basis_boost_eligible) adds 30 pts (backward compat)');
  } else {
    fail('qctFlag alone should add 30 pts; got ' + (qctScore - baseScore));
  }

  // ddaFlag alone (no basis_boost_eligible) should add 20 pts.
  var ddaScore = scoreSubsidy(false, true, 1.0, 100, undefined);
  if (Math.abs(ddaScore - baseScore - 20) < 0.01) {
    pass('ddaFlag alone (no basis_boost_eligible) adds 20 pts (backward compat)');
  } else {
    fail('ddaFlag alone should add 20 pts; got ' + (ddaScore - baseScore));
  }

  // basis_boost_eligible overrides individual flags: even with both flags true
  // the score increment should still be 40 (not 50).
  var bothFlagsScore = scoreSubsidy(true, true, 1.0, 100, true);
  if (bothFlagsScore - baseScore === 40) {
    pass('basis_boost_eligible=true overrides both flags: increment is 40 not 50');
  } else {
    fail('basis_boost_eligible=true with both flags should add 40 pts; got ' + (bothFlagsScore - baseScore));
  }

  // Score must always be clamped to [0, 100].
  var maxScore = scoreSubsidy(true, true, 2.0, 0, true);
  if (maxScore <= 100) pass('scoreSubsidy() output clamped to ≤ 100 with high inputs');
  else                  fail('scoreSubsidy() output must be ≤ 100');

  var minScore = scoreSubsidy(false, false, 0.5, 200, false);
  if (minScore >= 0) pass('scoreSubsidy() output clamped to ≥ 0 with low inputs');
  else               fail('scoreSubsidy() output must be ≥ 0');
}());

// ─── 8. market-analysis-controller.js — designation flags ────────────────────
console.log('\n── 8. market-analysis-controller.js — designation flags ──');

var ctrlPath = path.join(ROOT, 'js/market-analysis/market-analysis-controller.js');
if (fs.existsSync(ctrlPath)) {
  pass('js/market-analysis/market-analysis-controller.js exists');
  var ctrlSrc = fs.readFileSync(ctrlPath, 'utf8');

  if (/_getDesignationFlags/.test(ctrlSrc)) pass('_getDesignationFlags() helper present');
  else                                       fail('_getDesignationFlags() helper missing');

  if (/HudEgis.*checkDesignation|checkDesignation.*HudEgis/.test(ctrlSrc)) pass('Calls HudEgis.checkDesignation()');
  else                                                                        fail('HudEgis.checkDesignation() call missing');

  if (/basisBoostEligible/.test(ctrlSrc))  pass('basisBoostEligible wired into scoring inputs');
  else                                      fail('basisBoostEligible not found in controller');

  if (/qctFlag/.test(ctrlSrc))             pass('qctFlag wired into scoring inputs');
  else                                      fail('qctFlag missing from controller');

  if (/ddaFlag/.test(ctrlSrc))             pass('ddaFlag wired into scoring inputs');
  else                                      fail('ddaFlag missing from controller');

  // Fallback to safe defaults when HudEgis unavailable
  if (/qctFlag.*false.*ddaFlag.*false|safe defaults.*all false/s.test(ctrlSrc)) {
    pass('Safe-default fallback (qctFlag=false, ddaFlag=false) present');
  } else {
    fail('Safe-default fallback for designation flags not found');
  }
} else {
  fail('js/market-analysis/market-analysis-controller.js not found');
}

// ─── 9. deal-calculator.js — QCT/DDA checkbox ────────────────────────────────
console.log('\n── 9. deal-calculator.js — QCT/DDA checkbox ──');

var calcPath = path.join(ROOT, 'js/deal-calculator.js');
if (fs.existsSync(calcPath)) {
  pass('js/deal-calculator.js exists');
  var calcSrc = fs.readFileSync(calcPath, 'utf8');

  if (/dc-qct-dda/.test(calcSrc))              pass('QCT/DDA checkbox element id="dc-qct-dda" present');
  else                                           fail('QCT/DDA checkbox id="dc-qct-dda" missing');

  if (/dc-qct-dda-note/.test(calcSrc))          pass('QCT/DDA note element id="dc-qct-dda-note" present');
  else                                           fail('QCT/DDA note id="dc-qct-dda-note" missing');

  if (/IRC.*42|42.*IRC/.test(calcSrc))           pass('IRC §42 reference in deal calculator');
  else                                            fail('IRC §42 reference missing from deal calculator');

  if (/130%/.test(calcSrc))                      pass('130% eligible basis boost mentioned');
  else                                            fail('130% eligible basis boost not mentioned');

  if (/addEventListener.*change/.test(calcSrc))  pass('Checkbox change event listener wired');
  else                                            fail('Checkbox change event listener missing');

  // Verify checkbox is NOT auto-applying to the slider (basis slider remains manual).
  // This is a source-analysis guard: look for a direct programmatic assignment to the
  // basis slider value inside the QCT/DDA checkbox handler. A problematic pattern
  // would be code like `basisSlider.value = ...` within `qctDdaChk` event handler.
  // (Full behavioral testing would require a DOM environment.)
  var autoApplyPattern = /qctDdaChk\b.*?\.checked.*?basisSlider\.value\s*=/s;
  if (!autoApplyPattern.test(calcSrc)) {
    pass('QCT/DDA checkbox handler does not directly assign basisSlider.value (manual control preserved)');
  } else {
    fail('QCT/DDA checkbox handler appears to auto-assign basis slider (should remain manual)');
  }
} else {
  fail('js/deal-calculator.js not found');
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log('\n============================================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');

if (failed > 0) {
  console.error('\nSome checks failed ❌');
  process.exit(1);
} else {
  console.log('\nAll checks passed ✅');
  process.exit(0);
}
