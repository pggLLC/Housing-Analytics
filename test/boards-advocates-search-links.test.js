#!/usr/bin/env node
// test/boards-advocates-search-links.test.js
//
// Regression: the HNA "Local boards & advocates — search" section derived its
// jurisdiction name from S().state.current.geoLabel, which is NEVER assigned
// (state.current is the ACS profile). For any jurisdiction without a curated
// housingLead (e.g. Fruita), jurisName was null, so the board search links
// collapsed to a bare https://www.google.com/ and the advocate/faith search
// links were dropped entirely. The fix reads S().state.lastGeoLabel.
//
// Run: node test/boards-advocates-search-links.test.js
'use strict';

const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const dom = new JSDOM('<!DOCTYPE html><body><div id="lr"></div></body>', { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;

// Load the real SearchLinks component + the renderer under test.
new Function(fs.readFileSync(path.join(ROOT, 'js/components/search-links.js'), 'utf8')).call(dom.window);
new Function(fs.readFileSync(path.join(ROOT, 'js/hna/hna-renderers.js'), 'utf8')).call(dom.window);

const container = document.getElementById('lr');

// A place record with a gov domain (via housingPlans) but NO housingLead —
// exactly the shape that exposed the bug. Pre-seed the cache so the renderer
// runs synchronously (no fetch).
window.HNAState = {
  els: { localResources: container },
  state: {
    lastGeoLabel: 'Fruita (city)',
    current: { NAME: 'Fruita city, Colorado' }, // has NO geoLabel, like production
    localResources: {
      'place:0828745': {
        // Loopback fixture URLs only — the source-url-sweep probes URLs in
        // changed files and skips localhost, so real hosts must not appear.
        housingPlans: [{ name: 'Comprehensive Plan', url: 'http://localhost/fruita/comprehensive-plan' }],
        advocacy: [{ name: 'Placeholder Advocate', url: 'http://localhost/advocate' }]
      }
    }
  }
};

window.HNARenderers.renderLocalResources('place', '0828745');
const html = container.innerHTML;

assert(/Local boards &amp; advocates/i.test(html), 'boards & advocates section rendered');

// Every board/advocate search link must be a real query, never bare google.
assert(/google\.com\/search\?q=/.test(html), 'search links carry a ?q= query');
assert(!/href="https:\/\/www\.google\.com\/"/.test(html),
  'no board link collapses to a bare https://www.google.com/');

// jurisName resolved from lastGeoLabel (with the (city) suffix stripped), so
// the jurisdiction-only advocate + faith links appear and are Fruita-scoped.
assert(/advocates near "Fruita"/.test(html) || /advocates near &quot;Fruita&quot;/.test(html),
  'jurisdiction-scoped advocate link is present and names Fruita');
assert(/q=[^"]*Fruita/.test(html), 'search query contains the jurisdiction name');
assert(!/Fruita%20\(city\)|Fruita \(city\)/.test(html.replace(/&quot;/g, '"')),
  'the (city) suffix is stripped from the search query');

console.log('boards-advocates-search-links: PASS');
