'use strict';

// Phone-width walk, 2026-09-25: in the soft-funding program reference the
// HUD trust-fund link (a bare URL as link text) measured 443px inside a
// 375px viewport, and the enclosing <details> has overflow:hidden, so its
// tail was cut off and unreachable. A bare URL must be allowed to wrap, and
// the grid card must be allowed to shrink below its longest unbroken word.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const themeCss = fs.readFileSync(path.join(root, 'css', 'site-theme.css'), 'utf8');

console.log('\nDeal Calculator: soft-funding reference links wrap at phone width');
console.log('='.repeat(62));

assert(/details\s*\{[^}]*overflow:\s*hidden/.test(themeCss), 'the premise holds: <details> clips overflow, so a wide link is cut, not scrolled');

const dom = new JSDOM('<!DOCTYPE html><body><div id="dealCalcMount"></div></body>', { url: 'http://127.0.0.1/deal-calculator.html' });
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.Event = dom.window.Event;
window.DealCalculatorMath = require('../js/deal-calculator-math.js');
require('../js/hna/hna-ownership-need.js');
require('../js/hna/ownership-resale.js');
require('../js/deal-calculator.js');
document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));

setTimeout(() => {
  const list = document.getElementById('dc-soft-funding-ref-list');
  assert(list, 'soft-funding reference list mounts');
  const links = Array.from(list.querySelectorAll('a[href^="http"]'));
  assert(links.length >= 8, 'the reference renders its external links (got ' + links.length + ')');
  const bare = links.filter((a) => /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(a.textContent.trim()));
  assert(bare.length >= 1, 'at least one link shows a bare URL as its text, the case that cannot break naturally');
  links.forEach((a) => {
    assert(/overflow-wrap:\s*anywhere/.test(a.getAttribute('style') || ''), 'link "' + a.textContent.slice(0, 40) + '" allows wrapping anywhere');
  });
  const cards = Array.from(list.children);
  assert(cards.length >= 8, 'cards render');
  cards.forEach((c) => assert(/min-width:\s*0/.test(c.getAttribute('style') || ''), 'card can shrink below its longest unbroken word'));
  console.log('  ✓ every reference link can wrap and every card can shrink; nothing is clipped at phone width');
  console.log('\nAll tests passed');
}, 700);
