#!/usr/bin/env node
// test/data-status-footer-live-date.test.js
//
// "Data last updated" must come from the data, not a typed date. On
// 2026-09-22 every HNA page showed "March 21, 2026" — a static
// data-page-last-updated="2026-03-22" on the canonical page, copied into all
// five views — on the day the data was rebuilt. Pins the agreement (#1746):
// each update key resolves to a real timestamp in the file it names; the HNA
// pages use a live key; and a date-only string renders as the day it says.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const footerSrc = read('js/data-status-footer.js');

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

// Parse UPDATE_SOURCES out of the IIFE by evaluating just that literal.
const m = /var UPDATE_SOURCES = (\{[\s\S]*?\n  \});/.exec(footerSrc);
assert.ok(m, 'UPDATE_SOURCES literal must be findable');
const UPDATE_SOURCES = new Function('return ' + m[1])();

console.log('data-status-footer-live-date');

run('every update key resolves to a parseable timestamp in the file it names', () => {
  for (const [key, src] of Object.entries(UPDATE_SOURCES)) {
    const file = path.join(ROOT, src.file);
    assert.ok(fs.existsSync(file), `${key}: ${src.file} exists`);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const fields = Array.isArray(src.field) ? src.field : [src.field];
    const val = fields.reduce((o, k) => (o == null ? o : o[k]), data);
    assert.ok(typeof val === 'string' && !Number.isNaN(Date.parse(val)), `${key}: ${src.file} → ${fields.join('.')} is a timestamp (got ${JSON.stringify(val)})`);
  }
});

run('every HNA page takes its date from the live hna key, never a static date', () => {
  const pages = ['housing-needs-assessment.html', ...fs.readdirSync(ROOT).filter((f) => /^hna-.*\.html$/.test(f))];
  const bad = [];
  for (const p of pages) {
    const body = /<body\b[^>]*>/.exec(read(p));
    if (!body) continue;
    const tag = body[0];
    const hasDateBar = /data-page-(update-key|last-updated)=/.test(tag);
    if (!hasDateBar) continue; // pages without the bar (comparative, scenario builder) are not in scope
    if (!/data-page-update-key="hna"/.test(tag) || /data-page-last-updated=/.test(tag)) bad.push(p + ': ' + tag.slice(0, 90));
  }
  assert.deepEqual(bad, [], 'HNA pages with a static or missing update key');
  assert.ok(UPDATE_SOURCES.hna, 'the hna key exists');
});

run('the hna key reads the vintage the badge reads: ranking-index generatedAt via the snapshot sidecar', () => {
  const snapshot = JSON.parse(read('data/home-snapshot.json'));
  const ranking = JSON.parse(read('data/hna/ranking-index.json'));
  const viaKey = UPDATE_SOURCES.hna.field.reduce((o, k) => o[k], snapshot);
  assert.equal(viaKey, ranking.metadata.generatedAt, 'sidecar vintage equals the index generatedAt');
});

run('a date-only static string renders as the day it says, not the day before', () => {
  const dom = new JSDOM('<!doctype html><html><body data-page-last-updated="2026-03-22"><main id="main-content"></main></body></html>', { url: 'http://127.0.0.1/x.html', runScripts: 'outside-only' });
  dom.window.fetch = () => Promise.reject(new Error('no network in test'));
  dom.window.eval(footerSrc);
  // render() defers insertion by 50ms when the document is already loaded
  return new Promise((resolve) => setTimeout(resolve, 80)).then(() => {
    const value = dom.window.document.querySelector('.dsb-value');
    assert.ok(value, 'status bar rendered');
    assert.equal(value.textContent, 'March 22, 2026');
  });
});

// The last case is async; wait for it before reporting.
setTimeout(() => {
  if (failures) { console.error('data-status-footer-live-date: FAIL'); process.exitCode = 1; }
  else console.log('data-status-footer-live-date: PASS');
}, 200);
