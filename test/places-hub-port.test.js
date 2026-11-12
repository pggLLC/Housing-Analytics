#!/usr/bin/env node
/**
 * places-hub-port — the Places and need hub (places-hub.html + hub/) is built by
 * coho-pathfinder-visual-lab scripts/build-port.js and must stay what was built,
 * running on this repo's own engines and data.
 *
 * What this holds, each against the file it must agree with:
 *   1. hub/PORT.json records a sha256 for every file the build wrote; the files on
 *      disk still match it (a hand edit here would drift from the lab, so it fails).
 *   2. Every engine places-hub.html loads is a file in this repo (no lab copy).
 *   3. Every data file the hub names by a fixed path is a file in this repo.
 *   4. Every public page the hub forwards a route to, and every old HNA page a
 *      chapter links to, exists (option A, 12 Nov 2026: the old pages stay live).
 *   5. A forwarded route keeps the place and its own settings (independent QA/QC F01,
 *      12 Nov 2026: the Deal Calculator step opened on a county saved earlier).
 *   6. The scorecard has no second formula here: if js/hna/need-scorecard.js does
 *      not load, the hub scores nothing and says why (QA/QC F03).
 */
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));
const manifest = JSON.parse(read('hub/PORT.json'));
const page = read('places-hub.html');
const hubJs = fs.readdirSync(path.join(ROOT, 'hub')).filter((f) => f.endsWith('.js'))
  .map((f) => [f, read('hub/' + f)]);

test('the build manifest covers the hub page and its files', () => {
  const listed = Object.keys(manifest.files);
  assert.ok(listed.includes('places-hub.html'), 'PORT.json does not list places-hub.html');
  assert.ok(listed.filter((f) => f.startsWith('hub/')).length >= 20, 'PORT.json lists too few hub files');
  const onDisk = fs.readdirSync(path.join(ROOT, 'hub')).map((f) => 'hub/' + f).filter((f) => f !== 'hub/PORT.json');
  const unlisted = onDisk.filter((f) => !manifest.files[f]);
  assert.deepEqual(unlisted, [], 'files in hub/ the build did not write: ' + unlisted.join(', '));
});

test('every built file still matches its recorded sha256', () => {
  const changed = Object.entries(manifest.files).filter(([f, sum]) =>
    !exists(f) || crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex') !== sum)
    .map(([f]) => f);
  assert.deepEqual(changed, [], 'edited by hand or missing (change the lab and rebuild): ' + changed.join(', '));
});

test('every script the hub page loads is a file in this repo', () => {
  const srcs = [...page.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.length > 30, 'the scan found only ' + srcs.length + ' scripts');
  const missing = srcs.filter((s) => !exists(s));
  assert.deepEqual(missing, [], 'scripts the hub loads that are not here: ' + missing.join(', '));
  const engines = srcs.filter((s) => s.startsWith('js/'));
  assert.ok(engines.includes('js/hna/need-scorecard.js'), 'the hub must score with js/hna/need-scorecard.js');
  const lazy = /LAB_LAZY_VENDOR = (\[[^\]]*\])/.exec(page);
  assert.ok(lazy, 'the lazy engine list is gone from places-hub.html');
  const lazyMissing = JSON.parse(lazy[1]).filter((s) => !exists(s));
  assert.deepEqual(lazyMissing, [], 'lazy engines that are not here: ' + lazyMissing.join(', '));
});

test('every data file the hub names by a fixed path is in this repo', () => {
  const named = new Set();
  hubJs.forEach(([, src]) => { for (const m of src.matchAll(/'(data\/[A-Za-z0-9_./-]+\.(?:json|geojson|csv))'/g)) named.add(m[1]); });
  assert.ok(named.size > 20, 'the scan found only ' + named.size + ' data paths');
  const missing = [...named].filter((f) => !exists(f));
  assert.deepEqual(missing, [], 'data files the hub reads that are not here: ' + missing.join(', '));
});

test('every forwarded route and every chapter link opens a page that exists', () => {
  const config = read('hub/lab-config.js');
  const targets = [...config.matchAll(/'#\/[a-z0-9/-]*': '([^']+)'/g)].map((m) => m[1]);
  const guides = JSON.parse((/var GUIDES = (\{[^;]*\});/.exec(config) || [])[1] || '{}');
  const all = targets.concat(Object.values(guides)).filter((t) => !/^https:\/\//.test(t));
  assert.ok(all.length > 30, 'the scan found only ' + all.length + ' forwarding targets');
  const missing = all.filter((t) => !exists(t.split(/[?#]/)[0]));
  assert.deepEqual(missing, [], 'routes forwarded to pages that do not exist: ' + missing.join(', '));
  const hna = hubJs.find(([f]) => f === 'hna.js')[1];
  const chapters = [...hna.matchAll(/live: '([a-z-]+\.html)'/g)].map((m) => m[1]);
  assert.equal(chapters.length, 5, 'expected five chapter links to the old HNA pages');
  const gone = chapters.concat(['housing-needs-assessment.html', 'hna-scenario-builder.html', 'hna-comparative-analysis.html']).filter((p) => !exists(p));
  assert.deepEqual(gone, [], 'old HNA pages the hub links to are gone: ' + gone.join(', '));
});

const vm = require('node:vm');
function runHub(file, extra) {
  const win = Object.assign({ URLSearchParams, location: { hash: '#/places' }, document: { querySelector: () => null } }, extra || {});
  win.window = win;
  vm.runInNewContext(read('hub/' + file), win);
  return win;
}

test('a forwarded route keeps the place and its own settings', () => {
  const P = runHub('lab-config.js').LAB_PORT;
  const cases = [
    ['#/deal-calculator?g=0828745', 'deal-calculator.html?geoid=0828745'],
    ['#/finder?q=Fruita&g=0828745', 'lihtc-opportunity-finder.html?geoid=0828745&q=Fruita'],
    ['#/data/map?layer=qct', 'data-map-browser.html?layer=qct'],
    ['#/deal-calculator?g=08x', 'deal-calculator.html'],
  ];
  for (const [from, want] of cases) assert.equal(P.href(from), want, from);
  assert.ok(/^https:\/\//.test(P.href('#/members?g=08077')) && !/geoid/.test(P.href('#/members?g=08077')), 'a member-site link gains a place');
  // Every lab step on a place page names the place (stepPath in hub/hna.js).
  const hna = hubJs.find(([f]) => f === 'hna.js')[1];
  for (const step of ['#/deal-calculator', '#/recommendation', '#/finder']) {
    const re = new RegExp("s\\[2\\] === '" + step.replace(/\//g, '\\/') + "'\\) s = \\[s\\[0\\], s\\[1\\], '" + step.replace(/\//g, '\\/') + "\\?[^\\]]*g=' \\+ g");
    assert.ok(re.test(hna), 'the ' + step + ' step does not carry the working place');
  }
});

test('the scorecard has no second formula on this site', () => {
  const fn = function () {};
  const withSite = runHub('need-scorecard.js', { LAB_PORT: {}, HNANeedScorecard: { score: fn, components: fn, percentile: fn, distributions: fn, MIN_RENTER_HH: 50 } });
  assert.equal(withSite.LabNeedScorecard.score, fn, 'the hub does not score with js/hna/need-scorecard.js');
  const without = runHub('need-scorecard.js', { LAB_PORT: {} });
  assert.ok(without.LabNeedScorecard.unavailable && !without.LabNeedScorecard.score, 'with the site module missing, the hub still scores (' + without.LabNeedScorecard.source + ')');
  assert.ok(/LabNeedScorecard[\s\S]{0,80}S\.unavailable/.test(hubJs.find(([f]) => f === 'hna.js')[1]), 'hna.js does not show the unavailable reason');
});
