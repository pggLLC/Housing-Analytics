#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const normalize = (text) => String(text || '').replace(/\s+/g, ' ').trim();

const html = read('market-analysis.html');
const dom = new JSDOM(html);
const doc = dom.window.document;

const tabs = Array.from(doc.querySelectorAll('.pma-tab')).map((tab) => ({
  method: tab.getAttribute('data-pma-method'),
  text: normalize(tab.textContent),
}));

const byMethod = Object.fromEntries(tabs.map((tab) => [tab.method, tab.text]));

['hybrid', 'commuting', 'buffer'].forEach((method) => {
  const text = byMethod[method] || '';
  assert.match(text, /buffer/i, `${method} tab should disclose buffer-scored geography`);
  assert.match(text, /screening/i, `${method} tab should carry screening qualifier`);
});

assert(!/^Tract-based\b/i.test(byMethod.commuting || ''), 'commuting tab should not be labeled bare Tract-based');
assert(!tabs.some((tab) => tab.method !== 'tract' && /^Tract-based\b/i.test(tab.text)), 'no buffer-scored tab should have a bare Tract-based label');
assert(!html.includes('(CHFA submittal)'), 'Tract picker should not carry an uncaveated CHFA submittal badge');
assert.match(byMethod.tract || '', /whole-tract/i, 'Tract picker still names the whole-tract shape');
assert.match(byMethod.tract || '', /screening/i, 'Tract picker badge should remain caveated as screening');

const radius = doc.querySelector('#pmaBufferSelect');
assert(radius, 'buffer radius select exists');
const radiusLabel = radius.getAttribute('aria-label') || '';
assert.match(radiusLabel, /Screening buffer radius/i, 'radius aria-label should describe the screening buffer control');
assert.match(radiusLabel, /not a CHFA-delineated PMA/i, 'radius aria-label should carry the CHFA-delineation caveat');
assert(!/not a radius/i.test(radiusLabel), 'radius aria-label should not say the radius control is not a radius');

const engineSource = read('js/market-analysis.js');
assert(
  engineSource.includes("var bufTracts = analysisMethod === 'tract'"),
  'analysis method branch remains the existing tract-vs-buffer branch'
);
assert(
  engineSource.includes('tractsInBuffer(lat, lon, bufferMiles)'),
  'buffer-scored methods still use the existing circular buffer helper'
);
assert(
  engineSource.includes('computePma(acs, lihtcUnits, 0, lat, lon, bufTracts, _pmaCountyAmi, nearbyLihtc, acsIdx)'),
  'PMA scoring call signature remains unchanged'
);

const workflowDom = new JSDOM(
  '<!doctype html><main><section class="hero"><h1>Market Analysis</h1></section></main>',
  { url: 'https://cohoanalytics.com/market-analysis.html', runScripts: 'outside-only' }
);
workflowDom.window.WorkflowState = {
  getProgress() {
    return { completedSteps: ['opportunity', 'jurisdiction'] };
  },
};
workflowDom.window.eval(read('js/components/workflow-next-action.js'));
workflowDom.window.WorkflowNextAction.render();

const banner = workflowDom.window.document.querySelector('#workflowNextAction');
assert(banner, 'workflow next-action banner is created on market-analysis.html');
const bannerText = normalize(banner.textContent);
assert(!bannerText.includes('Earlier Step Incomplete'), 'market analysis should not show a false prior-step-incomplete banner when HNA is incomplete');
assert.match(bannerText, /Run a PMA scoring analysis/i, 'market analysis should prefer current-step guidance');
assert.match(banner.className, /wf-next-action--current/, 'market analysis banner should render as current-step guidance');

console.log('pma-methodology-language: PASS');
