// test/hna-chas-rerender.test.js
//
// The HNA controller draws the extended analysis (housing gap summary and
// housing-type ranking) before county CHAS and place CHAS are loaded. Without
// a second draw, the "flags N renter households" line never printed and the
// type ranking scored places without CHAS (Fruita's deeply affordable rental
// 69 with 2 of 5 indicators instead of 76 with 4). This checks that update()
// draws both again after the CHAS loads, and that the renderers export them.
//
// Run: node test/hna-chas-rerender.test.js

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(ok, msg) { if (ok) { console.log('  ✅ PASS: ' + msg); passed++; } else { console.error('  ❌ FAIL: ' + msg); failed++; } }

const ctl = fs.readFileSync(path.join(__dirname, '..', 'js/hna/hna-controller.js'), 'utf8');
const rnd = fs.readFileSync(path.join(__dirname, '..', 'js/hna/hna-renderers.js'), 'utf8');

const start = ctl.indexOf('async function update(){');
assert(start > -1, 'update() found');
const body = ctl.slice(start);
const firstDraw = body.indexOf('window.HNARenderers.renderExtendedAnalysis(profile, geoType)');
const chasLoad = body.indexOf('window.HNAState.state.chasData = await loadJson(window.HNAUtils.PATHS.chasCostBurden)');
const placeInit = body.indexOf('await window.PlaceChas.init()');
const gapAgain = body.indexOf('window.HNARenderers.renderHousingGapSummary(profile, geoType)');
const typesAgain = body.indexOf('window.HNARenderers.tryRenderHousingTypeNeedFromState(profile)');

assert(firstDraw > -1 && chasLoad > firstDraw, 'the first draw comes before county CHAS loads (why the second draw is needed)');
assert(placeInit > chasLoad, 'place CHAS loads after county CHAS');
assert(gapAgain > placeInit, 'the housing gap summary is drawn again after both CHAS files load');
assert(typesAgain > placeInit, 'the housing-type ranking is drawn again after both CHAS files load');

const exp = rnd.slice(rnd.lastIndexOf('renderExtendedAnalysis,'));
assert(/\brenderHousingGapSummary,/.test(exp), 'HNARenderers exports renderHousingGapSummary');
assert(/\btryRenderHousingTypeNeedFromState,/.test(exp), 'HNARenderers exports tryRenderHousingTypeNeedFromState');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
