'use strict';

/**
 * Guards for the guided reading path.
 *
 * The page has 54 sections and changes subject 33 times. The contents rail made
 * that navigable; the path says which sections form the argument and in what
 * order. Since it reorders nothing, its only job is to be RIGHT about the page
 * it points at — so these tests are mostly about the ways a route can lie:
 * pointing somewhere that does not exist, somewhere the reader cannot see, or
 * backwards up a page they are scrolling down.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const RP = require('../js/hna/reading-path.js');
const HTML = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

console.log('hna-reading-path');

run('every step targets an id that exists in the page', () => {
  for (const step of RP.STEPS) {
    const re = new RegExp('id="' + step.id + '"');
    assert.match(HTML, re,
      step.id + ' is not in housing-needs-assessment.html — the path must only ' +
      'use anchors that already exist, because an invented one silently stops matching');
  }
});

run('the route never sends the reader backwards', () => {
  // The failure this caught for real: an argument-ordered draft jumped from
  // screen 20 back to screen 7 between two consecutive steps.
  const dom = new JSDOM(HTML);
  const doc = dom.window.document;
  const present = RP.STEPS.filter((s) => doc.getElementById(s.id));
  assert.ok(present.length >= 6, 'expected most steps to resolve, got ' + present.length);
  assert.equal(RP.followsDocumentOrder(doc, present), true,
    'the path must run forwards through the document');
});

run('a hidden step is dropped, not offered as a dead destination', () => {
  // countyComparisonSection ships hidden and is only revealed for a place.
  const dom = new JSDOM('<!doctype html><body>' +
    '<div id="a">A</div><div id="b" hidden>B</div><div id="c">C</div></body>');
  const doc = dom.window.document;
  const steps = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
  const r = RP.resolve(doc, { steps });
  assert.deepEqual(r.steps.map((s) => s.id), ['a', 'c']);
  assert.deepEqual(r.dropped.map((s) => s.id), ['b']);
});

run('a step inside a hidden ancestor is also dropped', () => {
  const dom = new JSDOM('<!doctype html><body><section hidden><div id="x">X</div></section></body>');
  assert.equal(RP.isReachable(dom.window.document, 'x'), false);
});

run('a missing step is dropped rather than throwing', () => {
  const dom = new JSDOM('<!doctype html><body><div id="a">A</div></body>');
  const r = RP.resolve(dom.window.document, { steps: [{ id: 'a' }, { id: 'nope' }] });
  assert.deepEqual(r.steps.map((s) => s.id), ['a']);
  assert.deepEqual(r.dropped.map((s) => s.id), ['nope']);
});

run('followsDocumentOrder actually detects a backwards route', () => {
  // Non-vacuity: prove the check fails on a route that goes backwards, or it
  // proves nothing about the real one.
  const dom = new JSDOM('<!doctype html><body><div id="first">1</div><div id="second">2</div></body>');
  const doc = dom.window.document;
  assert.equal(RP.followsDocumentOrder(doc, [{ id: 'first' }, { id: 'second' }]), true);
  assert.equal(RP.followsDocumentOrder(doc, [{ id: 'second' }, { id: 'first' }]), false);
});

run('the route covers the argument, not just the easy stops', () => {
  const ids = RP.STEPS.map((s) => s.id);
  // The two ends are what a practitioner arrives for and leaves with; without
  // them this is an index, not an argument.
  assert.ok(ids.includes('hnaDecisionStrip'), 'must start at the headline answers');
  assert.ok(ids.includes('housing-need-projection'), 'must include the central need figure');
  assert.ok(ids.includes('housing-action-plan'), 'must end at what to do');
  assert.ok(RP.STEPS.length >= 6 && RP.STEPS.length <= 9,
    'a route of ' + RP.STEPS.length + ' steps is either not a route or a second contents list');
});

run('every step states the question it answers', () => {
  for (const step of RP.STEPS) {
    assert.ok(step.label && step.label.length <= 28, step.id + ' needs a short label');
    assert.ok(step.question && /\?$/.test(step.question),
      step.id + ' must carry the question a reader is asking at that point');
  }
});

run('the page loads the module before the rail that renders it', () => {
  const rp = HTML.indexOf('js/hna/reading-path.js');
  const rail = HTML.indexOf('js/hna/section-rail.js');
  assert.ok(rp > 0 && rail > 0, 'both scripts are loaded');
  assert.ok(rp < rail, 'reading-path.js must load before section-rail.js');
  const railSrc = fs.readFileSync(path.join(ROOT, 'js/hna/section-rail.js'), 'utf8');
  assert.match(railSrc, /HNAReadingPath/, 'the rail renders the path');
  assert.match(railSrc, /resolved\.steps\.length < 4/,
    'the rail declines to render a path too short to be a path');
  const css = fs.readFileSync(path.join(ROOT, 'css/pages/housing-needs-assessment.css'), 'utf8');
  assert.match(css, /\.hna-rail__path\b/, 'the path is styled');
});

if (failures) { console.error('hna-reading-path: FAIL'); process.exitCode = 1; }
else console.log('hna-reading-path: PASS');
