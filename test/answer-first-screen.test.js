#!/usr/bin/env node
'use strict';
// Walkthrough 2026-10-20 (R2): the first phone screen of each workflow page
// gives an answer (a sourced figure) or one instruction, ahead of menus and
// explainer text. The rent-schedule suite guards Market Analysis's empty state.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = (p) => fs.readFileSync(p, 'utf8');

const hnaPages = ['housing-needs-assessment.html', 'hna-what-housing-exists.html', 'hna-who-lives-here.html',
  'hna-what-households-can-afford.html', 'hna-where-its-heading.html', 'hna-what-to-do.html'];
for (const p of hnaPages) {
  const html = read(p);
  const strip = html.indexOf('id="hnaDecisionStrip"');
  const hero = html.indexOf('<section class="hero"');
  assert(strip > 0 && hero > 0, p + ' keeps the short answer and the hero');
  assert(strip < hero, p + ': the short answer comes before the hero');
}

const dc = read('deal-calculator.html');
const start = dc.indexOf('class="dc-start"');
assert(start > 0, 'Deal Calculator has a start instruction');
assert(start < dc.indexOf('class="dc-lead"'), 'the instruction comes before the explainer');
assert.match(dc.slice(start, start + 400), /href="#dc-inputs-col"/, 'the instruction links to the inputs');
assert(read('js/deal-calculator.js').includes('id="dc-inputs-col"'), 'the link target exists');

console.log('Answer-first screen: ' + (hnaPages.length + 1) + ' pages checked');
