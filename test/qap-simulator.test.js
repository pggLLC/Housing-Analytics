'use strict';
/**
 * test/qap-simulator.test.js
 *
 * Unit tests for js/qap-simulator.js — CHFA QAP Competitiveness Simulator.
 * Tests the scoring engine, state management, and factor driver math.
 *
 * Run: node test/qap-simulator.test.js
 * Dependencies: jsdom (devDependency — npm ci)
 */

const { JSDOM } = require('jsdom');

// Set up a minimal DOM before requiring the module so that render() can mount.
const dom = new JSDOM('<!DOCTYPE html><body><div id="qsim-mount"></div></body>');
global.document = dom.window.document;
global.window   = dom.window;
global.self     = dom.window;

const QAPSimulator = require('../js/qap-simulator.js');

/* ── tiny test harness ───────────────────────────────────────────────────── */
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log('  ✅ ' + message);
    passed++;
  } else {
    console.error('  ❌ FAIL: ' + message);
    failed++;
  }
}

function assertClose(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    console.log('  ✅ ' + message + ' (' + actual.toFixed(2) + ')');
    passed++;
  } else {
    console.error('  ❌ FAIL: ' + message +
      ' — got ' + actual.toFixed(2) + ', expected ~' + expected + ' ±' + tolerance);
    failed++;
  }
}

/* ── test runner ─────────────────────────────────────────────────────────── */
console.log('\nQAPSimulator — Unit Tests\n' + '='.repeat(45));

// Initialise the simulator (required before getScores/getState/setState work)
QAPSimulator.render('qsim-mount');

// ── 1. Public API surface ─────────────────────────────────────────────────
console.log('\n1. Public API surface');
assert(typeof QAPSimulator === 'object',              'module exports an object');
assert(typeof QAPSimulator.render    === 'function',  'render is a function');
assert(typeof QAPSimulator.getScores === 'function',  'getScores is a function');
assert(typeof QAPSimulator.getState  === 'function',  'getState is a function');
assert(typeof QAPSimulator.setState  === 'function',  'setState is a function');

// ── 2. Initial state ──────────────────────────────────────────────────────
console.log('\n2. Initial state values');
const state0 = QAPSimulator.getState();
assert(state0 !== null && typeof state0 === 'object', 'getState() returns an object');
assert(state0.isQct          === false, 'isQct defaults to false');
assert(state0.isDda          === false, 'isDda defaults to false');
assert(state0.pmaHigh        === false, 'pmaHigh defaults to false');
assert(state0.pmaMod         === false, 'pmaMod defaults to false');
assert(state0.isRural        === false, 'isRural defaults to false');
assert(state0.gapOver200     === false, 'gapOver200 defaults to false');
assert(state0.gapOver50      === false, 'gapOver50 defaults to false');
assert(state0.ami30Need      === false, 'ami30Need defaults to false');
assert(state0.hasHnaData     === false, 'hasHnaData defaults to false');
assert(state0.softOver500k   === false, 'softOver500k defaults to false');
assert(state0.greenBuilding  === false, 'greenBuilding defaults to false');
assertClose(state0.devScore,    11.4, 0.01, 'devScore defaults to 11.4');
assertClose(state0.designScore,  5.2, 0.01, 'designScore defaults to 5.2');

// ── 3. Score shape ────────────────────────────────────────────────────────
console.log('\n3. Score object shape');
const s0 = QAPSimulator.getScores();
assert(typeof s0 === 'object',          'getScores() returns an object');
['geography', 'communityNeed', 'localSupport', 'developer', 'design', 'other', '_total']
  .forEach(function (key) {
    assert(key in s0,                   'scores include "' + key + '"');
    assert(typeof s0[key] === 'number', 'score for "' + key + '" is a number');
  });

// Base scores: geography=avgLoser(12.1), communityNeed=avgLoser(14.3),
// localSupport=avgLoser(11.2), developer=devScore(11.4), design=designScore(5.2),
// other=avgLoser(3.8)
assertClose(s0.geography,     12.1, 0.5, 'geography base ≈ avgLoser (12.1)');
assertClose(s0.communityNeed, 14.3, 0.5, 'communityNeed base ≈ avgLoser (14.3)');
assertClose(s0.localSupport,  11.2, 0.5, 'localSupport base ≈ avgLoser (11.2)');
assertClose(s0.developer,     11.4, 0.1, 'developer base = devScore (11.4)');
assertClose(s0.design,         5.2, 0.1, 'design base = designScore (5.2)');
assertClose(s0.other,          3.8, 0.5, 'other base ≈ avgLoser (3.8)');
assert(s0._total >= 0,  '_total is non-negative');
assert(s0._total <= 100, '_total ≤ 100 (sum of all maxPts capped)');

// ── 4. Geography factor drivers ───────────────────────────────────────────
console.log('\n4. Geography factor drivers');

// QCT adds +2.5
const geoBase = QAPSimulator.getScores().geography;
QAPSimulator.setState({ isQct: true });
assertClose(QAPSimulator.getScores().geography, geoBase + 2.5, 0.1, 'isQct adds +2.5 pts');

// DDA adds another +2.0
QAPSimulator.setState({ isDda: true });
assertClose(QAPSimulator.getScores().geography, geoBase + 4.5, 0.1, 'isDda adds +2.0 more pts');

// pmaHigh adds +2.0 on top
QAPSimulator.setState({ pmaHigh: true });
assertClose(QAPSimulator.getScores().geography, geoBase + 6.5, 0.1, 'pmaHigh adds +2.0 more pts');

// pmaMod is ignored when pmaHigh is set (code uses else if)
QAPSimulator.setState({ pmaMod: true });
assertClose(QAPSimulator.getScores().geography, geoBase + 6.5, 0.1, 'pmaMod adds 0 when pmaHigh is true (else-if branch)');

// isRural subtracts 1.5
const beforeRural = QAPSimulator.getScores().geography;
QAPSimulator.setState({ isRural: true });
assertClose(QAPSimulator.getScores().geography, beforeRural - 1.5, 0.1, 'isRural subtracts 1.5 pts');

// Score does not exceed maxPts (20)
assert(QAPSimulator.getScores().geography <= 20, 'geography score capped at maxPts (20)');

// Reset geography flags
QAPSimulator.setState({ isQct: false, isDda: false, pmaHigh: false, pmaMod: false, isRural: false });

// ── 5. Community need drivers ─────────────────────────────────────────────
console.log('\n5. Community need drivers');
const needBase = QAPSimulator.getScores().communityNeed;

QAPSimulator.setState({ gapOver200: true });
assertClose(QAPSimulator.getScores().communityNeed, needBase + 4.0, 0.1, 'gapOver200 adds +4.0 pts');

// gapOver50 is ignored when gapOver200 is true (else-if)
QAPSimulator.setState({ gapOver50: true });
assertClose(QAPSimulator.getScores().communityNeed, needBase + 4.0, 0.1, 'gapOver50 adds 0 when gapOver200 is true');

QAPSimulator.setState({ gapOver200: false });
assertClose(QAPSimulator.getScores().communityNeed, needBase + 2.0, 0.1, 'gapOver50 adds +2.0 pts when gapOver200 is false');

QAPSimulator.setState({ ami30Need: true });
assertClose(QAPSimulator.getScores().communityNeed, needBase + 4.0, 0.1, 'ami30Need adds +2.0 pts');

QAPSimulator.setState({ hasHnaData: true });
assertClose(QAPSimulator.getScores().communityNeed, needBase + 5.5, 0.1, 'hasHnaData adds +1.5 pts');

QAPSimulator.setState({ gapOver50: false, ami30Need: false, hasHnaData: false });

// ── 6. Local support drivers ──────────────────────────────────────────────
console.log('\n6. Local support drivers');
const suppBase = QAPSimulator.getScores().localSupport;

QAPSimulator.setState({ softOver500k: true });
assertClose(QAPSimulator.getScores().localSupport, suppBase + 5.0, 0.1, 'softOver500k adds +5.0 pts');

// softOver100k is ignored when softOver500k is true
QAPSimulator.setState({ softOver100k: true });
assertClose(QAPSimulator.getScores().localSupport, suppBase + 5.0, 0.1, 'softOver100k adds 0 when softOver500k is true');

QAPSimulator.setState({ softOver500k: false });
assertClose(QAPSimulator.getScores().localSupport, suppBase + 2.5, 0.1, 'softOver100k adds +2.5 when softOver500k is false');

QAPSimulator.setState({ govSupport: true });
assertClose(QAPSimulator.getScores().localSupport, suppBase + 5.5, 0.1, 'govSupport adds +3.0 pts');

QAPSimulator.setState({ publicLand: true });
assertClose(QAPSimulator.getScores().localSupport, suppBase + 8.0, 0.1, 'publicLand adds +2.5 pts');

// Score does not exceed maxPts (22)
assert(QAPSimulator.getScores().localSupport <= 22, 'localSupport capped at maxPts (22)');

QAPSimulator.setState({ softOver100k: false, govSupport: false, publicLand: false });

// ── 7. Design factor ──────────────────────────────────────────────────────
console.log('\n7. Design factor drivers');
const designBase = QAPSimulator.getScores().design;
QAPSimulator.setState({ greenBuilding: true });
assertClose(QAPSimulator.getScores().design, designBase + 2.0, 0.1, 'greenBuilding adds +2.0 pts');
QAPSimulator.setState({ greenBuilding: false });

// ── 8. setState only updates valid keys ───────────────────────────────────
console.log('\n8. setState key validation');
const beforeUnknown = QAPSimulator.getScores()._total;
QAPSimulator.setState({ unknownKey: 99, anotherFakeKey: true });
assertClose(QAPSimulator.getScores()._total, beforeUnknown, 0.0,
  'setState ignores keys not in the state schema');

// ── 9. Assessment boundaries ──────────────────────────────────────────────
console.log('\n9. Total score is a valid number');
const final = QAPSimulator.getScores();
assert(Number.isFinite(final._total), '_total is a finite number');
assert(final._total >= 0,             '_total >= 0');
assert(final._total <= 100,           '_total <= 100');

// ── summary ───────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(45));
console.log('QAPSimulator: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
