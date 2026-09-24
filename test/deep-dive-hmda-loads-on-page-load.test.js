'use strict';

// The HMDA "Mortgage Credit Access" section on colorado-deep-dive.html sits
// outside the tab panels and is visible on every tab. Its loader used to run
// only when the Market Conditions tab was activated, so a reader who never
// clicked that tab saw "Loading HMDA data…" forever (walked on production,
// 2026-09-24). The section must fill on page load, and the loader must not
// fetch twice when the tab is later opened.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'colorado-deep-dive.html'), 'utf8');
const src = fs.readFileSync(path.join(root, 'js', 'colorado-deep-dive.js'), 'utf8');
const stateTrends = JSON.parse(fs.readFileSync(path.join(root, 'data', 'hmda', 'co-state-trends.json'), 'utf8'));

console.log('\nDeep dive: HMDA section loads on page load, not only on tab activation');
console.log('='.repeat(62));

const dom = new JSDOM(html, { url: 'http://127.0.0.1/colorado-deep-dive.html', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
global.window = w; global.document = w.document;
const calls = [];
w.DataService = {
  getJSON: (p) => {
    calls.push(p);
    return new Promise((res, rej) => {
      try { res(JSON.parse(fs.readFileSync(path.join(root, p.split('?')[0]), 'utf8'))); } catch (e) { rej(e); }
    });
  }
};
w.MoneyFormatter = require('../js/utils/format-money.js');
w.APP_CONFIG = {};
w.eval(src);

const section = w.document.getElementById('hmdaSection');
assert(section, 'HMDA section exists');
assert(!section.closest('.tab-panel'), 'HMDA section is outside every tab panel (visible on all tabs)');

w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));

const years = Object.keys(stateTrends.years).sort();
const latest = years[years.length - 1];

setTimeout(() => {
  const g = (id) => w.document.getElementById(id);
  assert.strictEqual(g('hmdaLoading').style.display, 'none', 'loading message hides without any tab click');
  assert.strictEqual(g('hmdaContent').style.display, '', 'content shows without any tab click');
  assert.notStrictEqual(g('hmdaOriginations').textContent.trim(), '—', 'originations card is filled');
  assert(/%$/.test(g('hmdaDenialRate').textContent.trim()), 'denial rate card is a percentage');
  assert(g('hmdaFreshness').textContent.includes('Latest: ' + latest), 'freshness names the latest HMDA year (' + latest + ')');
  const hmdaCallsBefore = calls.filter((p) => /hmda/.test(p)).length;
  assert.strictEqual(hmdaCallsBefore, 2, 'exactly the two HMDA files are fetched on load');

  // Opening the Market Conditions tab must not refetch.
  const btn = w.document.getElementById('tab-btn-policy-simulator');
  assert(btn, 'policy tab button exists');
  btn.click();
  setTimeout(() => {
    const hmdaCallsAfter = calls.filter((p) => /hmda/.test(p)).length;
    assert.strictEqual(hmdaCallsAfter, hmdaCallsBefore, 'activating the tab does not fetch HMDA again');
    assert.strictEqual(g('hmdaLoading').style.display, 'none', 'loading stays hidden after tab activation');
    console.log('  ✓ HMDA cards fill on page load; tab activation is idempotent');
    console.log('\nAll tests passed');
  }, 300);
}, 800);
