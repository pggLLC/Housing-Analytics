'use strict';
// Three accessibility defects a fresh axe run found on the guided path after
// the 2026-10-17 audit fixes merged. Each check pins the agreement the defect
// broke, not the markup that fixed it:
// 1. aria-expanded on a text input is only valid when the input has a role
//    that supports it (combobox), so every such input on a top-level page
//    must carry that role.
// 2. The rent-burden confidence badge draws its colours from the site tokens
//    the contrast gate checks, so every colour it uses must be one of them.
// 3. A table whose wrapper scrolls at phone width (the table opts out of the
//    mobile table scroll in responsive.css) needs a focusable wrapper, or a
//    keyboard user cannot reach the hidden columns.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// 1
let expandable = 0;
for (const f of fs.readdirSync(ROOT).filter((n) => n.endsWith('.html'))) {
  const doc = new JSDOM(read(f)).window.document;
  for (const el of doc.querySelectorAll('input[aria-expanded]')) {
    expandable++;
    assert.equal(el.getAttribute('role'), 'combobox',
      `${f} #${el.id}: aria-expanded on an input needs role="combobox"`);
  }
}
assert(expandable >= 2, `the scan found expandable inputs to check (${expandable})`);

// 2
const theme = read('css/site-theme.css');
const w = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' }).window;
w.eval(read('js/rent-burden-reliability.js'));
const api = w.RentBurdenReliability || w.RBR;
assert(api && typeof api.confidenceBadge === 'function', 'found the confidence badge');
let colours = 0;
for (const tier of ['high', 'medium', 'low', 'insufficient']) {
  const html = api.confidenceBadge({ combined: tier });
  for (const m of html.matchAll(/(?:^|[;"\s])(color|background):\s*([^;"]+)/g)) {
    colours++;
    const v = m[2].trim();
    if (v === 'transparent' || v === 'currentColor') continue;
    const token = v.match(/^var\((--[\w-]+)\)$/);
    assert(token, `${tier} badge ${m[1]} is "${v}", not a site colour token`);
    assert(new RegExp('\\n\\s*' + token[1] + '\\s*:').test(theme), `${token[1]} is defined in site-theme.css`);
  }
}
assert(colours >= 8, `the scan found badge colours to check (${colours})`);

// 3
let wraps = 0;
for (const f of fs.readdirSync(path.join(ROOT, 'js/components')).filter((n) => n.endsWith('.js'))) {
  const src = read('js/components/' + f);
  for (const m of src.matchAll(/var (\w+) = \$h\('table', \{[^}]*no-mobile-scroll/g)) {
    // the wrapper is the element the table is appended to
    const parent = src.slice(m.index).match(new RegExp('(\\w+)\\.appendChild\\(' + m[1] + '\\)'));
    assert(parent, `${f}: found the wrapper of ${m[1]}`);
    const decl = src.match(new RegExp('var ' + parent[1] + " = \\$h\\('div', \\{([\\s\\S]*?)\\}\\s*\\}\\);"));
    assert(decl, `${f}: found the declaration of ${parent[1]}`);
    if (!/overflowX:\s*'auto'/.test(decl[1])) continue;
    wraps++;
    assert(/tabindex:\s*'0'/.test(decl[1]), `${f}: ${parent[1]} scrolls the table at phone width but is not focusable`);
  }
}
assert(wraps >= 2, `the scan found scrolling table wrappers to check (${wraps})`);

console.log(`guided-path-a11y: PASS (${expandable} expandable inputs, ${colours} badge colours, ${wraps} table wrappers)`);
