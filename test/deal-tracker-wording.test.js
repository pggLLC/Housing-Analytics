#!/usr/bin/env node
// test/deal-tracker-wording.test.js
//
// Phase 2.2: keep the public "Affordable Housing Pipeline" methodology
// distinct from the gated internal Deal Tracker affordance.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PUBLIC_MOUNTS = [
  { page: 'compare.html', mountId: 'cmpDealTrackerMount' },
  { page: 'deal-calculator.html', mountId: 'dcDealTrackerMount' },
  { page: 'market-analysis.html', mountId: 'pmaDealTrackerMount' }
];

function scriptsFor(html) {
  const scripts = [];
  const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = re.exec(html))) {
    if (match[1].includes('PipelineAddButton.attach') && match[1].includes('_isIBAuthed')) {
      scripts.push(match[1]);
    }
  }
  return scripts;
}

for (const { page, mountId } of PUBLIC_MOUNTS) {
  const html = read(page);

  assert(!html.includes('Developer Pipeline add button'), `${page} no longer labels the gated mount Developer Pipeline`);
  assert(!html.includes('Add to Developer Pipeline'), `${page} no longer contains the old gated button label`);
  assert(!html.includes('Deal Tracker'), `${page} does not expose the renamed internal label in public HTML`);
  assert(html.includes(`id="${mountId}"`), `${page} uses the renamed ${mountId} mount`);

  const scripts = scriptsFor(html);
  assert.equal(scripts.length, 1, `${page} has exactly one gated Deal Tracker hydration script`);

  const dom = new JSDOM(`<!doctype html><body><div id="${mountId}">stale gated content</div></body>`, {
    url: `https://cohoanalytics.com/${page}`,
    runScripts: 'outside-only'
  });
  const { window } = dom;
  window.PipelineAddButton = { attach() { throw new Error('logged-out page must not attach Deal Tracker'); } };
  window.PipelineStore = {};
  window.eval(scripts[0]);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

  assert.equal(
    window.document.getElementById(mountId).innerHTML,
    '',
    `${page} clears the gated Deal Tracker mount for logged-out visitors`
  );
}

const component = read('js/components/pipeline-add-button.js');
assert(component.includes('+ Add to Deal Tracker'), 'gated button now says Add to Deal Tracker');
assert(component.includes('In Deal Tracker'), 'canonical state now says In Deal Tracker');
assert(!component.includes('Add to Developer Pipeline'), 'component no longer uses the old internal feature label');
assert(!component.includes('+ Add to Pipeline'), 'component no longer uses the ambiguous short pipeline label');

const hna = read('housing-needs-assessment.html');
const opportunityFinder = read('lihtc-opportunity-finder.html');
for (const [label, html] of [
  ['housing-needs-assessment.html', hna],
  ['lihtc-opportunity-finder.html', opportunityFinder]
]) {
  assert(
    html.includes('The Affordable Housing Pipeline') && html.includes('pipeline.html'),
    `${label} keeps the public Affordable Housing Pipeline methodology teaser`
  );
}

console.log('Deal Tracker wording and public gating: PASS');
