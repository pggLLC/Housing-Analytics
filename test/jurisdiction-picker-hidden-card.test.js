#!/usr/bin/env node
// test/jurisdiction-picker-hidden-card.test.js
//
// On select-jurisdiction.html the "selected jurisdiction" card is `hidden`
// until a county is chosen. Its injected style set display:flex, and an author
// rule beats the `hidden` attribute's UA display:none — so every first-time
// visitor saw a card reading "Adams County / Change" next to a disabled
// Continue button (found on production 2026-09-23). The attribute must win,
// computed with the page's real injected CSS, and the markup must not carry a
// county name nobody picked.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const selectorSrc = fs.readFileSync(path.join(ROOT, 'js', 'jurisdiction-selector.js'), 'utf8');
const pageHtml = fs.readFileSync(path.join(ROOT, 'select-jurisdiction.html'), 'utf8');

// Pull the injected stylesheet out of the IIFE the same way the browser gets
// it: run injectStyles against a bare document and read back the <style>.
function injectedCss() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'outside-only' });
  // The selector's init() needs page elements; only the style injection runs
  // unconditionally at load, so guard init from throwing.
  dom.window.document.addEventListener = () => {};
  try { dom.window.eval(selectorSrc); } catch (_) { /* init() may throw without the page; styles are already injected */ }
  const styles = [...dom.window.document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  assert.ok(styles.includes('.sj-selection{'), 'the selector injected its stylesheet');
  return styles;
}

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

console.log('jurisdiction-picker-hidden-card');

run('the injected stylesheet gives the hidden state a rule that outranks the flex rule', () => {
  // jsdom resolves `hidden` with its own precedence, so a computed-style
  // assertion passes with or without the fix (sabotage-tested: it did not
  // fire). Assert the mechanism the bug is about instead: an author rule for
  // .sj-selection[hidden] that sets display:none, with higher specificity
  // than the .sj-selection{display:flex} rule it must beat, marked !important
  // so no later rule can reopen the hole.
  const css = injectedCss();
  const flexRule = /\.sj-selection\{[^}]*display:\s*flex[^}]*\}/.exec(css);
  assert.ok(flexRule, 'the card is laid out with display:flex (the rule that overrode `hidden`)');
  const hiddenRule = /\.sj-selection\[hidden\]\{[^}]*display:\s*none\s*!important[^}]*\}/.exec(css);
  assert.ok(hiddenRule, '.sj-selection[hidden] must set display:none !important');
  assert.ok(hiddenRule.index > flexRule.index, 'and come after the flex rule, so order can never decide against it');
  // A shown card must still lay out as flex.
  const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body><div class="sj-selection" id="shown"><strong>Mesa County</strong></div></body></html>`);
  assert.equal(dom.window.getComputedStyle(dom.window.document.getElementById('shown')).display, 'flex');
});

run('the markup carries no county name before one is chosen', () => {
  const m = /<strong id="sjSelectionName">([^<]*)<\/strong>/.exec(pageHtml);
  assert.ok(m, 'selection name element exists');
  assert.equal(m[1].trim(), '', 'placeholder county name must be empty, got: ' + JSON.stringify(m[1]));
  assert.match(pageHtml, /<div class="sj-selection" id="sjSelection" hidden>/, 'card starts hidden');
});

if (failures) { console.error('jurisdiction-picker-hidden-card: FAIL'); process.exitCode = 1; }
else console.log('jurisdiction-picker-hidden-card: PASS');
